import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSettings } from '../server/db.js';
import { estadoFlota, alertasFlota, lunesDe, ultimasSemanas, sumarDias } from '../server/services/vehiculos-estado.js';
import { listarSectores, seguridadDeParadas, concentracionEntregas } from '../server/services/zonas.js';

const HOY = '2026-11-25'; // miércoles; la semana parte el lunes 23

test('semanas: el lunes de cada fecha y las últimas semanas en orden', () => {
  assert.equal(lunesDe('2026-11-25'), '2026-11-23');
  assert.equal(lunesDe('2026-11-23'), '2026-11-23');
  assert.equal(lunesDe('2026-11-29'), '2026-11-23'); // el domingo cierra la semana
  assert.equal(sumarDias('2026-12-30', 3), '2027-01-02');
  assert.deepEqual(ultimasSemanas(3, HOY), ['2026-11-09', '2026-11-16', '2026-11-23']);
});

function flota() {
  const db = openDb(':memory:');
  db.prepare('UPDATE vehicles SET km_actual = 50000, intervalo_mantencion_km = 10000, vida_neumaticos_km = 40000, valor_neumaticos = 400000 WHERE id = 1').run();
  db.prepare("INSERT INTO gastos (vehicle_id, fecha, categoria, monto, km_odometro) VALUES (1, '2026-06-01', 'mantencion_preventiva', 90000, 42000)").run();
  db.prepare("INSERT INTO gastos (vehicle_id, fecha, categoria, monto, km_odometro) VALUES (1, '2026-03-01', 'neumaticos', 400000, 40000)").run();
  const sem = db.prepare('INSERT INTO km_semanal (vehicle_id, semana_inicio, km, odometro) VALUES (1, ?, ?, ?)');
  sem.run('2026-11-02', 500, null);
  sem.run('2026-11-09', 500, null);
  sem.run('2026-11-16', 500, null);
  sem.run('2026-11-23', 999, null); // semana en curso: no entra al promedio
  return db;
}

test('mantención preventiva: al día, próxima y vencida según el odómetro y los km por semana', () => {
  const db = flota();
  let v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 1);
  assert.equal(v.odometro_km, 50000);
  assert.equal(v.km_prom_semanal, 500); // solo semanas cerradas
  assert.equal(v.semanas_con_registro, 3);
  assert.equal(v.km_semana_actual, 999);
  assert.equal(v.mantencion.proxima_km, 52000); // última mantención 42.000 + intervalo 10.000
  assert.equal(v.mantencion.restantes_km, 2000);
  assert.equal(v.mantencion.estado, 'al_dia');

  db.prepare("UPDATE km_semanal SET odometro = 51500 WHERE semana_inicio = '2026-11-16'").run();
  v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 1);
  assert.equal(v.odometro_km, 51500);
  assert.equal(v.mantencion.restantes_km, 500);
  assert.equal(v.mantencion.estado, 'proxima'); // menos del 10 % del intervalo
  assert.equal(v.mantencion.fecha_estimada, '2026-12-02'); // 500 km a 500 km por semana = 7 días
  assert.match(alertasFlota(estadoFlota(db, { hoy: HOY })).find((a) => a.vehicle_id === 1).texto, /próxima/);

  db.prepare("UPDATE km_semanal SET odometro = 52100 WHERE semana_inicio = '2026-11-16'").run();
  v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 1);
  assert.equal(v.mantencion.estado, 'vencida');
  const alerta = alertasFlota(estadoFlota(db, { hoy: HOY })).find((a) => a.vehicle_id === 1 && a.nivel === 'alta');
  assert.match(alerta.texto, /vencida \(pasó 100 km\)/);
});

test('una próxima mantención indicada en el registro manda sobre el intervalo', () => {
  const db = flota();
  db.prepare("INSERT INTO gastos (vehicle_id, fecha, categoria, monto, km_odometro, proximo_km) VALUES (1, '2026-10-01', 'mantencion_preventiva', 90000, 48000, 60000)").run();
  const v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 1);
  assert.equal(v.mantencion.proxima_km, 60000);
  assert.equal(v.mantencion.estado, 'al_dia');
});

test('neumáticos: porcentaje de vida consumido desde el último cambio', () => {
  const db = flota();
  db.prepare("UPDATE km_semanal SET odometro = 51500 WHERE semana_inicio = '2026-11-16'").run();
  const v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 1);
  assert.equal(v.neumaticos.recorridos_km, 11500);
  assert.ok(Math.abs(v.neumaticos.consumido_pct - 28.75) < 1e-9);
  db.prepare('UPDATE vehicles SET vida_neumaticos_km = 12000 WHERE id = 1').run();
  const alertas = alertasFlota(estadoFlota(db, { hoy: HOY })).filter((a) => /Neumáticos/.test(a.texto));
  assert.equal(alertas.length, 1);
  assert.equal(alertas[0].nivel, 'media'); // 95,8 %
});

test('sin datos no se inventa nada: el vehículo sin registros queda en blanco', () => {
  const db = flota();
  const v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 2);
  assert.equal(v.odometro_km, null);
  assert.equal(v.km_prom_semanal, null);
  assert.equal(v.mantencion.estado, 'sin_datos');
  assert.equal(v.mantencion.restantes_km, null);
  assert.equal(v.neumaticos.consumido_pct, null);
  assert.equal(alertasFlota(estadoFlota(db, { hoy: HOY })).filter((a) => a.vehicle_id === 2).length, 0);
});

test('una mantención con fecha cumplida figura como vencida aunque falten kilómetros', () => {
  const db = openDb(':memory:');
  db.prepare("UPDATE vehicles SET proxima_mantencion_fecha = '2026-11-20' WHERE id = 2").run();
  const v = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 2);
  assert.equal(v.mantencion.estado, 'vencida');
});

test('los despachos completados se suman a la semana en que ocurrieron', () => {
  const db = flota();
  const ins = db.prepare("INSERT INTO trips (fecha, vehicle_id, estado, n_paradas, distancia_km) VALUES (?, 1, ?, ?, ?)");
  ins.run('2026-11-17', 'completado', 4, 60);
  ins.run('2026-11-18', 'completado', 3, 40);
  ins.run('2026-11-19', 'cancelado', 5, 90);
  const s = estadoFlota(db, { hoy: HOY }).find((e) => e.vehicle_id === 1).semanas.find((x) => x.semana_inicio === '2026-11-16');
  assert.equal(s.despachos, 2);
  assert.equal(s.km_despachos, 100);
  assert.equal(s.paradas, 7);
  assert.equal(s.dias_con_despacho, 2);
});

// ---------- Zonas, seguridad y concentración ----------

function conClientes() {
  const db = openDb(':memory:');
  const c = db.prepare("INSERT INTO clients (nombre, comuna, region, lat, lng) VALUES (?, ?, 'Metropolitana', -33.4, -70.6)");
  const ids = {};
  for (const [n, comuna] of [['A', 'Quinta Normal'], ['B', 'Quinta Normal'], ['C', 'Pudahuel'], ['D', 'Puente Alto'], ['E', 'Maipú']]) ids[n] = Number(c.run(n, comuna).lastInsertRowid);
  const s = db.prepare('INSERT INTO sectores (comuna, region, zona, seguridad, horario_recomendado, observaciones, fuente) VALUES (?, ?, ?, ?, ?, ?, ?)');
  s.run('Quinta Normal', '', 'Poniente', 'normal', null, null, 'Experiencia de conductores');
  s.run('Pudahuel', '', 'Poniente', 'precaucion', 'Antes de las 17:00', 'Evitar calles sin salida', 'Experiencia de conductores');
  s.run('Puente Alto', '', 'Sur', 'alto_riesgo', 'Solo de día', 'Ir con acompañante', 'Carabineros');
  return { db, ids };
}

function despacho(db, fecha, estado, paradas) {
  const t = Number(db.prepare('INSERT INTO trips (fecha, vehicle_id, estado, n_paradas, distancia_km) VALUES (?, 1, ?, ?, 10)').run(fecha, estado, paradas.length).lastInsertRowid);
  paradas.forEach((p, i) => db.prepare('INSERT INTO trip_stops (trip_id, client_id, orden, km_tramo, costo_asignado) VALUES (?, ?, ?, ?, ?)').run(t, p.client, i + 1, p.km ?? null, p.costo ?? null));
  return t;
}

test('sectores: cada comuna con sus clientes, su zona, su seguridad y los incidentes de los últimos 90 días', () => {
  const { db } = conClientes();
  db.prepare("INSERT INTO incidentes (fecha, comuna, tipo, descripcion) VALUES ('2026-11-10', 'Maipú', 'robo', 'Intentaron abrir la puerta')").run();
  db.prepare("INSERT INTO incidentes (fecha, comuna, tipo, descripcion) VALUES ('2026-06-01', 'Pudahuel', 'robo', 'Muy antiguo')").run();
  const lista = listarSectores(db, { hoy: HOY });
  assert.deepEqual(lista.map((s) => s.comuna), ['Puente Alto', 'Pudahuel', 'Quinta Normal', 'Maipú']); // de más a menos riesgo
  const qn = lista.find((s) => s.comuna === 'Quinta Normal');
  assert.equal(qn.clientes, 2);
  assert.equal(qn.zona, 'Poniente');
  const maipu = lista.find((s) => s.comuna === 'Maipú');
  assert.equal(maipu.seguridad, 'sin_evaluar'); // nada se supone
  assert.equal(maipu.incidentes_90d, 1);
  assert.equal(lista.find((s) => s.comuna === 'Pudahuel').incidentes_90d, 0); // el incidente de junio ya no cuenta
});

test('seguridad de una ruta: avisa los sectores con precaución, con incidentes y los que nunca se evaluaron', () => {
  const { db } = conClientes();
  db.prepare("INSERT INTO incidentes (fecha, comuna, tipo) VALUES ('2026-11-10', 'Maipú', 'robo')").run();
  const r = seguridadDeParadas(db, [
    { nombre: 'A', comuna: 'Quinta Normal' }, { nombre: 'C', comuna: 'Pudahuel' }, { nombre: 'D', comuna: 'Puente Alto' }, { nombre: 'E', comuna: 'Maipú' }, { nombre: 'X', comuna: 'Colina' },
  ], { hoy: HOY });
  assert.equal(r.nivel_max, 'alto_riesgo');
  assert.deepEqual(r.alertas.map((a) => a.comuna), ['Puente Alto', 'Pudahuel', 'Maipú']);
  assert.equal(r.alertas[0].horario_recomendado, 'Solo de día');
  assert.deepEqual(r.alertas[2].paradas, ['E']);
  assert.deepEqual(r.sin_evaluar, ['Maipú', 'Colina']);
  const tranquila = seguridadDeParadas(db, [{ nombre: 'A', comuna: 'Quinta Normal' }], { hoy: HOY });
  assert.equal(tranquila.nivel_max, 'normal');
  assert.equal(tranquila.alertas.length, 0);
  assert.equal(tranquila.sin_evaluar.length, 0);
});

test('concentración de entregas por comuna y por zona, solo con despachos completados', () => {
  const { db, ids } = conClientes();
  despacho(db, '2026-11-02', 'completado', [{ client: ids.A, km: 5, costo: 3000 }, { client: ids.B, km: 3, costo: 2000 }, { client: ids.C, km: 8, costo: 6000 }]);
  despacho(db, '2026-11-09', 'completado', [{ client: ids.A, km: 4, costo: 2500 }, { client: ids.D, km: 20, costo: 12000 }]);
  despacho(db, '2026-11-10', 'planificado', [{ client: ids.E, km: 9, costo: 5000 }]); // no cuenta
  despacho(db, '2026-11-11', 'cancelado', [{ client: ids.E }]);
  db.prepare("INSERT INTO deliveries (client_id, fecha, estado) VALUES (?, '2026-11-26', 'pendiente')").run(ids.C);

  const porComuna = concentracionEntregas(db, { por: 'comuna', hoy: HOY });
  assert.deepEqual(porComuna.map((g) => [g.clave, g.entregas]), [['Quinta Normal', 3], ['Pudahuel', 1], ['Puente Alto', 1]]);
  const qn = porComuna[0];
  assert.equal(qn.clientes, 2);
  assert.equal(qn.km, 12);
  assert.equal(qn.costo, 7500);
  assert.equal(qn.costo_por_entrega, 2500);
  assert.equal(qn.pct_entregas, 60);
  assert.equal(porComuna.find((g) => g.clave === 'Pudahuel').pendientes, 1);
  assert.equal(porComuna.find((g) => g.clave === 'Puente Alto').seguridad, 'alto_riesgo');

  const porZona = concentracionEntregas(db, { por: 'zona', hoy: HOY });
  assert.deepEqual(porZona.map((g) => [g.clave, g.entregas]), [['Poniente', 4], ['Sur', 1]]);
  assert.deepEqual(porZona[0].comunas, ['Pudahuel', 'Quinta Normal']);
  assert.equal(porZona[0].seguridad, 'precaucion'); // la peor de sus comunas

  const todos = concentracionEntregas(db, { por: 'comuna', incluir: 'todos', hoy: HOY });
  assert.equal(todos.find((g) => g.clave === 'Maipú').entregas, 1); // el planificado cuenta; el cancelado no

  const acotado = concentracionEntregas(db, { por: 'comuna', desde: '2026-11-05', hasta: '2026-11-30', hoy: HOY });
  assert.deepEqual(acotado.map((g) => g.clave).sort(), ['Pudahuel', 'Puente Alto', 'Quinta Normal'].sort());
  assert.equal(acotado.find((g) => g.clave === 'Quinta Normal').entregas, 1);
});

test('una base creada antes de los cambios se actualiza sola sin perder datos', () => {
  const db = openDb(':memory:');
  // Se simula una base antigua: tablas con la forma anterior, sin las columnas ni tablas nuevas
  db.exec('DROP TABLE gastos; DROP TABLE km_semanal; DROP TABLE sectores; DROP TABLE incidentes;');
  db.exec('ALTER TABLE products DROP COLUMN largo_cm; ALTER TABLE products DROP COLUMN ancho_cm; ALTER TABLE products DROP COLUMN alto_cm; ALTER TABLE products DROP COLUMN apilable; ALTER TABLE products DROP COLUMN rotable;');
  db.exec('ALTER TABLE vehicles DROP COLUMN carga_largo_cm; ALTER TABLE drivers DROP COLUMN rol; ALTER TABLE trips DROP COLUMN preparador_id;');
  db.prepare("INSERT INTO products (nombre) VALUES ('Antiguo')").run();
  assert.throws(() => db.prepare('SELECT largo_cm FROM products').all());
  // Misma operación que hace prepararDb al abrir una base guardada
  return import('../server/db.js').then(({ prepararDb }) => {
    prepararDb(db);
    const p = db.prepare('SELECT nombre, largo_cm, apilable, rotable FROM products').get();
    assert.equal(p.nombre, 'Antiguo');
    assert.equal(p.largo_cm, null);
    assert.equal(p.apilable, 1);
    assert.equal(p.rotable, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sectores").get().n, 0);
    assert.ok(db.prepare('SELECT rol FROM drivers').all().every((d) => d.rol === 'conductor'));
    assert.equal(db.prepare('PRAGMA table_info(trips)').all().some((c) => c.name === 'preparador_id'), true);
  });
});
