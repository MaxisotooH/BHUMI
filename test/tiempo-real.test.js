// Fase 3: avisos en tiempo real (Server-Sent Events) y edición simultánea con número de versión.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, MODO_LOCAL } from './helpers.js';
import { recursoDe } from '../server/eventos.js';
import { registroEditado } from '../server/concurrencia.js';
import { openDb } from '../server/db.js';

const http = { skip: MODO_LOCAL ? 'solo aplica al servidor HTTP' : false };

// ---------- Reglas (sin servidor) ----------
test('eventos: cada escritura se traduce al recurso que cambia; los cálculos no avisan', () => {
  assert.deepEqual(recursoDe('PUT', '/vehiculos/3'), { recurso: 'vehiculos', id: 3 });
  assert.deepEqual(recursoDe('POST', '/vehiculos/3/cargas'), { recurso: 'vehiculos', id: 3 });
  assert.deepEqual(recursoDe('DELETE', '/cargas/9'), { recurso: 'vehiculos', id: null });
  assert.deepEqual(recursoDe('PUT', '/km-semanal'), { recurso: 'vehiculos', id: null });
  assert.deepEqual(recursoDe('POST', '/despachos/4/estado'), { recurso: 'despachos', id: 4 });
  assert.deepEqual(recursoDe('PUT', '/USUARIOS/2/'), { recurso: 'usuarios', id: 2 });
  assert.deepEqual(recursoDe('POST', '/respaldo/restaurar'), { recurso: 'todo', id: null });
  assert.deepEqual(recursoDe('PUT', '/settings'), { recurso: 'settings', id: null });
  for (const r of ['/plan', '/plan/dividir', '/cubicaje/calcular', '/geocodificar', '/settings/probar-google', '/zonas/seguridad-ruta', '/auth/clave']) {
    assert.equal(recursoDe('POST', r), null, r);
  }
  assert.equal(recursoDe('GET', '/vehiculos/3'), null);
});

test('versiones: qué escrituras se revisan (los tiempos del despacho no)', () => {
  assert.deepEqual(registroEditado('PUT', '/vehiculos/3'), { tabla: 'vehicles', id: 3, base: '/vehiculos/3' });
  assert.deepEqual(registroEditado('POST', '/Despachos/4/Estado/'), { tabla: 'trips', id: 4, base: '/despachos/4' });
  assert.deepEqual(registroEditado('PUT', '/despachos/4/personal'), { tabla: 'trips', id: 4, base: '/despachos/4' });
  assert.equal(registroEditado('PUT', '/despachos/4/tiempos'), null);
  assert.equal(registroEditado('POST', '/vehiculos'), null);
  assert.equal(registroEditado('GET', '/vehiculos/3'), null);
});

test('versiones: la base sube la versión en cada cambio; las paradas cuentan como cambio del despacho y los tiempos no', () => {
  const db = openDb(':memory:');
  const v = db.prepare('SELECT id, version FROM vehicles LIMIT 1').get();
  assert.equal(v.version, 1);
  db.prepare('UPDATE vehicles SET km_actual = 10 WHERE id = ?').run(v.id);
  db.prepare('UPDATE vehicles SET km_actual = 20 WHERE id = ?').run(v.id);
  assert.equal(db.prepare('SELECT version FROM vehicles WHERE id = ?').get(v.id).version, 3);
  const t = db.prepare("INSERT INTO trips (fecha, vehicle_id, estado) VALUES ('2026-11-26', ?, 'planificado')").run(v.id).lastInsertRowid;
  const versionTrip = () => db.prepare('SELECT version FROM trips WHERE id = ?').get(t).version;
  db.prepare("INSERT INTO trip_events (trip_id, tipo, momento) VALUES (?, 'inicio_carga', '2026-11-26T08:00')").run(t);
  assert.equal(versionTrip(), 1);
  db.prepare('INSERT INTO trip_stops (trip_id, orden) VALUES (?, 1)').run(t);
  assert.equal(versionTrip(), 2);
  db.close();
});

// ---------- Servidor ----------
test('canal de eventos: exige sesión y lo puede abrir cualquier rol', http, async () => {
  const s = await iniciar();
  try {
    assert.equal((await s.sinSesion.call('GET', '/eventos')).status, 401);
    for (const rol of ['planificador', 'bodega']) {
      const ev = await (await s.comoRol(rol)).eventos();
      assert.equal(ev.status, 200, rol);
      assert.ok(await ev.esperar((e) => e.tipo === 'listo'), rol);
      ev.cerrar();
    }
  } finally { s.cerrar(); }
});

test('canal de eventos: los demás reciben qué cambió y quién fue; los errores no se anuncian', http, async () => {
  const s = await iniciar();
  try {
    const ana = await s.comoRol('planificador');
    const ev = await ana.eventos();
    await ev.esperar((e) => e.tipo === 'listo');
    const veh = (await s.call('GET', '/vehiculos')).data[0];

    assert.equal((await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 11 }, { 'X-Bhumi-Pestana': 'pestana-123' })).status, 200);
    const e = await ev.esperar((x) => x.recurso === 'vehiculos');
    assert.equal(e.id, veh.id);
    assert.equal(e.accion, 'PUT');
    assert.equal(e.usuario.nombre, 'Prueba admin');
    assert.equal(e.pestana, 'pestana-123'); // la pestaña que guardó se reconoce y no se refresca sola

    assert.equal((await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: -3 })).status, 400);
    assert.equal((await s.call('PUT', '/settings', { costo_hora_conductor: 4100 }, { 'X-Bhumi-Pestana': '<script>' })).status, 200);
    const ajustes = await ev.esperar((x) => x.recurso === 'settings');
    assert.equal(ajustes.pestana, null); // identificador inválido: se descarta
    assert.equal(ev.lista.filter((x) => x.recurso === 'vehiculos').length, 1); // el PUT rechazado no avisó
    ev.cerrar();
  } finally { s.cerrar(); }
});

test('canal de eventos: si desactivan al usuario, se le avisa y se corta la conexión', http, async () => {
  const s = await iniciar({ pingEventosMs: 100 });
  try {
    const pedro = await s.comoRol('bodega');
    const ev = await pedro.eventos();
    await ev.esperar((e) => e.tipo === 'listo');
    await s.call('PUT', `/usuarios/${pedro.usuario.id}`, { activo: false });
    assert.ok(await ev.esperar((e) => e.tipo === 'sin_sesion', 2000));
    for (let i = 0; i < 20 && !ev.terminado; i++) await new Promise((r) => setTimeout(r, 50));
    assert.equal(ev.terminado, true);
  } finally { s.cerrar(); }
});

test('canal de eventos: revisar la conexión no mantiene viva una sesión sin uso', http, async () => {
  const s = await iniciar({ pingEventosMs: 50 });
  try {
    const ana = await s.comoRol('planificador');
    const ev = await ana.eventos();
    await ev.esperar((e) => e.tipo === 'listo');
    const antes = s.db.prepare('SELECT ultimo_uso FROM sesiones WHERE usuario_id = ?').get(ana.usuario.id).ultimo_uso;
    s.db.prepare('UPDATE sesiones SET ultimo_uso = ultimo_uso - ? WHERE usuario_id = ?').run(10 * 60_000, ana.usuario.id);
    await new Promise((r) => setTimeout(r, 300)); // varios pings
    const despues = s.db.prepare('SELECT ultimo_uso FROM sesiones WHERE usuario_id = ?').get(ana.usuario.id).ultimo_uso;
    assert.equal(despues, antes - 10 * 60_000);
    ev.cerrar();
  } finally { s.cerrar(); }
});

test('conflicto: quien guarda con una versión vieja recibe 409 con el nombre de quien cambió, sin pisar nada', http, async () => {
  const s = await iniciar();
  try {
    const ana = await s.comoRol('planificador');
    const ev = await s.eventos();
    await ev.esperar((e) => e.tipo === 'listo');
    const veh = (await s.call('GET', '/vehiculos')).data[0];
    assert.equal(veh.version, 1);

    // Ana y el admin abren el mismo vehículo. Ana guarda primero.
    const r1 = await ana.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 12, version: veh.version });
    assert.equal(r1.status, 200);
    assert.equal(r1.data.version, 2);

    // El admin guarda con la versión que tenía al abrir: conflicto.
    const r2 = await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 9, version: veh.version });
    assert.equal(r2.status, 409);
    assert.equal(r2.data.error.code, 'conflicto');
    assert.equal(r2.data.error.extra.usuario, 'Prueba planificador');
    assert.equal(r2.data.error.extra.version_actual, 2);
    assert.match(r2.data.error.mensaje, /Prueba planificador/);
    assert.equal((await s.call('GET', `/vehiculos/${veh.id}`)).data.rendimiento_km_l, 12); // no se pisó

    // Con la versión actual, guarda bien. Sin versión (clientes antiguos) se acepta como antes.
    assert.equal((await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 9, version: 2 })).data.version, 3);
    assert.equal((await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 10 })).status, 200);

    // El 409 no se anunció como cambio: llegan exactamente los 3 guardados exitosos.
    const vehiculos = () => ev.lista.filter((e) => e.recurso === 'vehiculos').length;
    for (let i = 0; i < 40 && vehiculos() < 3; i++) await new Promise((ok) => setTimeout(ok, 25));
    await new Promise((ok) => setTimeout(ok, 100));
    assert.equal(vehiculos(), 3);
    ev.cerrar();
  } finally { s.cerrar(); }
});

test('conflicto: al cerrar un despacho que otra persona ya cambió; anotar tiempos no genera conflictos', http, async () => {
  const s = await iniciar();
  try {
    const pedro = await s.comoRol('bodega');
    const veh = (await s.call('GET', '/vehiculos')).data[0];
    const tripId = Number(s.db.prepare("INSERT INTO trips (fecha, vehicle_id, estado) VALUES ('2026-11-26', ?, 'planificado')").run(veh.id).lastInsertRowid);
    const abierto = (await pedro.call('GET', `/despachos/${tripId}`)).data;
    const t = abierto.trip ?? abierto;
    assert.equal(t.version, 1);

    // Pedro anota un tiempo: no cambia la versión del despacho.
    const tiempos = await pedro.call('PUT', `/despachos/${tripId}/tiempos`, { eventos: [{ tipo: 'carga_inicio', hora: '08:00' }] });
    assert.equal(tiempos.status, 200);
    assert.equal(s.db.prepare('SELECT version FROM trips WHERE id = ?').get(tripId).version, 1);

    // El planificador inicia la ruta; Pedro, con la pantalla vieja, intenta iniciarla también.
    assert.equal((await s.call('POST', `/despachos/${tripId}/estado`, { estado: 'en_ruta', version: 1 })).status, 200);
    const r = await pedro.call('POST', `/despachos/${tripId}/estado`, { estado: 'en_ruta', version: 1 });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.extra.usuario, 'Prueba admin');
  } finally { s.cerrar(); }
});

test('conflicto: nombra a quien realmente cambió, aunque haya sido desde otra sección', http, async () => {
  const s = await iniciar();
  try {
    const ana = await s.comoRol('planificador', 'ana@empresa.cl');
    const pedro = await s.comoRol('bodega', 'pedro@empresa.cl');
    const veh = (await s.call('GET', '/vehiculos')).data[0];
    // Antes: Ana editó el vehículo (queda en la auditoría).
    await ana.call('PUT', `/vehiculos/${veh.id}`, { km_actual: 1000, version: veh.version });
    // El admin abre el formulario del vehículo.
    const abierto = (await s.call('GET', `/vehiculos/${veh.id}`)).data;
    // Pedro cierra un despacho de ese vehículo: suma los km al odómetro y así cambia el vehículo.
    const t = Number(s.db.prepare("INSERT INTO trips (fecha, vehicle_id, estado, distancia_km) VALUES ('2026-11-26', ?, 'en_ruta', 42)").run(veh.id).lastInsertRowid);
    assert.equal((await pedro.call('POST', `/despachos/${t}/estado`, { estado: 'completado' })).status, 200);

    const r = await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 10, version: abierto.version });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.extra.usuario, 'Prueba bodega'); // Pedro, no Ana
    assert.match(r.data.error.mensaje, /^Prueba bodega cambió este registro \(al guardar un despacho\)/);
  } finally { s.cerrar(); }
});

test('conflicto: sin una escritura que coincida, no se adivina un nombre', http, async () => {
  const s = await iniciar();
  try {
    const ana = await s.comoRol('planificador');
    const veh = (await s.call('GET', '/vehiculos')).data[0];
    await ana.call('PUT', `/vehiculos/${veh.id}`, { km_actual: 500, version: veh.version }); // edición antigua de Ana
    const abierto = (await s.call('GET', `/vehiculos/${veh.id}`)).data;
    // Un cambio sin solicitud asociada (p. ej. un script de mantenimiento), un rato después.
    s.db.prepare("UPDATE auditoria SET ts = datetime(ts, '-1 hour')").run();
    s.db.prepare('UPDATE vehicles SET km_actual = 900 WHERE id = ?').run(veh.id);
    const r = await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 10, version: abierto.version });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.extra.usuario, null);
    assert.match(r.data.error.mensaje, /^Otra persona guardó cambios/);
  } finally { s.cerrar(); }
});

test('conflicto: si fue la misma persona en otra pestaña, se lo dice así', http, async () => {
  const s = await iniciar();
  try {
    const veh = (await s.call('GET', '/vehiculos')).data[0];
    await s.call('PUT', `/vehiculos/${veh.id}`, { km_actual: 700, version: veh.version }); // "otra pestaña"
    const r = await s.call('PUT', `/vehiculos/${veh.id}`, { rendimiento_km_l: 10, version: veh.version });
    assert.equal(r.status, 409);
    assert.match(r.data.error.mensaje, /^Tú mismo cambiaste este registro en otra pestaña/);
  } finally { s.cerrar(); }
});
