import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSettings } from '../server/db.js';
import { cubicarEntregas, sugerirConsolidacion, utilizacionCarga, itemsDeEntregas } from '../server/services/consolidacion.js';

// Vehículo 1: furgón 300 x 150 x 150 cm (6,75 m3), 800 kg. Vehículo 2: más chico, 150 x 100 x 100 cm (1,5 m3), 300 kg.
function preparar() {
  const db = openDb(':memory:');
  setSettings(db, { radio_cercania_km: 5, deposito_lat: -33.43, deposito_lng: -70.69 });
  db.prepare('UPDATE vehicles SET carga_largo_cm = 300, carga_ancho_cm = 150, carga_alto_cm = 150, capacidad_kg = 800 WHERE id = 1').run();
  db.prepare('UPDATE vehicles SET carga_largo_cm = 150, carga_ancho_cm = 100, carga_alto_cm = 100, capacidad_kg = 300 WHERE id = 2').run();
  const prod = db.prepare('INSERT INTO products (nombre, peso_kg, largo_cm, ancho_cm, alto_cm, apilable, rotable) VALUES (?, ?, ?, ?, ?, 1, 0)');
  const cajaA = Number(prod.run('Caja A', 10, 50, 50, 50).lastInsertRowid); // 0,125 m3
  const cajaB = Number(prod.run('Caja B', 20, 100, 50, 50).lastInsertRowid); // 0,25 m3
  const c = db.prepare("INSERT INTO clients (nombre, comuna, lat, lng) VALUES (?, ?, ?, ?)");
  const cli = (n, comuna, lat, lng) => Number(c.run(n, comuna, lat, lng).lastInsertRowid);
  const ids = { c1: cli('Cliente 1', 'Quinta Normal', -33.43, -70.70), c2: cli('Cliente 2', 'Quinta Normal', -33.44, -70.69), c3: cli('Cliente 3', 'Pudahuel', -33.45, -70.71), lejos: cli('Lejos', 'Puente Alto', -33.61, -70.57) };
  const entrega = (client, items) => {
    const d = Number(db.prepare("INSERT INTO deliveries (client_id, fecha) VALUES (?, '2026-11-26')").run(client).lastInsertRowid);
    for (const [pid, q] of items) db.prepare('INSERT INTO delivery_items (delivery_id, product_id, cantidad) VALUES (?, ?, ?)').run(d, pid, q);
    return d;
  };
  return { db, cajaA, cajaB, ids, entrega };
}

test('cubicar entregas: junta los productos de varias entregas y avisa si faltan medidas', () => {
  const { db, cajaA, cajaB, ids, entrega } = preparar();
  const d1 = entrega(ids.c1, [[cajaA, 4]]);
  const d2 = entrega(ids.c2, [[cajaA, 4], [cajaB, 2]]);
  const v1 = db.prepare('SELECT * FROM vehicles WHERE id = 1').get();
  const r = cubicarEntregas(db, v1, [d1, d2]);
  assert.equal(r.ok, true);
  assert.equal(r.resultado.cabe, true);
  assert.equal(r.resultado.unidades_total, 10);
  assert.equal(r.resultado.peso_kg, 4 * 10 + 4 * 10 + 2 * 20);
  // una línea sin producto del catálogo no tiene medidas: se informa
  db.prepare("INSERT INTO delivery_items (delivery_id, descripcion, cantidad) VALUES (?, 'Varios', 1)").run(d1);
  const conLibre = cubicarEntregas(db, v1, [d1]);
  assert.equal(conLibre.ok, true);
  assert.deepEqual(conLibre.sin_producto, ['Varios']);
  // producto sin medidas
  const p = Number(db.prepare("INSERT INTO products (nombre, peso_kg) VALUES ('Sin medidas', 5)").run().lastInsertRowid);
  const d3 = entrega(ids.c3, [[p, 1]]);
  const falta = cubicarEntregas(db, v1, [d3]);
  assert.equal(falta.ok, false);
  assert.equal(falta.motivo, 'faltan_medidas');
  assert.equal(falta.faltan.productos[0].nombre, 'Sin medidas');
  assert.equal(itemsDeEntregas(db, [d1, d2]).items.length, 3);
});

test('consolidación: agrupa entregas cercanas y dice qué vehículo las lleva completas', () => {
  const { db, cajaA, cajaB, ids, entrega } = preparar();
  entrega(ids.c1, [[cajaA, 6]]);                 // un solo producto
  entrega(ids.c2, [[cajaA, 6], [cajaB, 4]]);
  entrega(ids.c3, [[cajaB, 2]]);                 // un solo producto
  entrega(ids.lejos, [[cajaA, 1]]);              // fuera del radio: no se agrupa
  const r = sugerirConsolidacion(db);
  assert.equal(r.grupos.length, 1);
  const g = r.grupos[0];
  assert.equal(g.n, 3);
  assert.deepEqual(g.comunas.sort(), ['Pudahuel', 'Quinta Normal']);
  assert.equal(g.con_un_solo_producto, 2);
  // Carga: 12 cajas A (1,5 m3) + 6 cajas B (1,5 m3) = 3 m3, 360 kg. El vehículo 2 (1,5 m3, 300 kg) no la lleva; el 1 sí.
  const o1 = g.vehiculos.find((v) => v.vehicle_id === 1);
  const o2 = g.vehiculos.find((v) => v.vehicle_id === 2);
  assert.equal(o1.cabe, true);
  assert.equal(o2.cabe, false);
  assert.equal(g.vehiculo_sugerido.vehicle_id, 1);
  assert.equal(g.despachos_evitables, 2);
  assert.equal(r.resumen.despachos_evitables, 2);
  assert.equal(r.resumen.entregas_en_grupos, 3);
  // sin distancias guardadas no se inventa un ahorro
  assert.equal(g.ahorro_estimado, null);
  assert.equal(r.resumen.ahorro_estimado, null);
});

test('consolidación: cuando no cabe en un solo vehículo calcula en cuántos despachos se reparte', () => {
  const { db, cajaB, ids, entrega } = preparar();
  // 3 entregas de 12 cajas B (3 m3 y 240 kg cada una): el vehículo 1 (6,75 m3, 800 kg) lleva dos juntas, no tres
  entrega(ids.c1, [[cajaB, 12]]);
  entrega(ids.c2, [[cajaB, 12]]);
  entrega(ids.c3, [[cajaB, 12]]);
  const g = sugerirConsolidacion(db).grupos[0];
  assert.equal(g.vehiculos.every((v) => v.cabe === false), true);
  assert.equal(g.vehiculo_sugerido.despachos, 2);
  assert.equal(g.despachos_evitables, 1);
});

test('consolidación con ahorro: usa solo distancias ya calculadas', () => {
  const { db, cajaA, ids, entrega } = preparar();
  setSettings(db, { costo_hora_conductor: 4000 });
  db.prepare("INSERT INTO fuel_prices (combustible, precio, vigente_desde) VALUES ('Bencina', 1300, '2020-01-01')").run();
  db.prepare('UPDATE vehicles SET rendimiento_km_l = 10, costo_km_neumaticos = 20, costo_km_mantencion = 30, costo_km_depreciacion = 25 WHERE id = 1').run();
  const d1 = entrega(ids.c1, [[cajaA, 2]]);
  const d2 = entrega(ids.c2, [[cajaA, 2]]);
  const puntos = [{ lat: -33.43, lng: -70.69 }, { lat: -33.43, lng: -70.70 }, { lat: -33.44, lng: -70.69 }];
  const ins = db.prepare("INSERT INTO route_cache (o, d, bucket, dist_m, dur_s, static_s, fetched_at) VALUES (?, ?, 'b', ?, ?, ?, ?)");
  const key = (p) => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  const km = [[0, 2, 3], [2, 0, 1.2], [3, 1.2, 0]];
  puntos.forEach((a, i) => puntos.forEach((b, j) => { if (i !== j) ins.run(key(a), key(b), km[i][j] * 1000, km[i][j] * 120, km[i][j] * 120, Date.now()); }));
  const g = sugerirConsolidacion(db).grupos[0];
  assert.ok(g.ahorro_estimado > 0, `ahorro ${g.ahorro_estimado}`);
  assert.match(g.nota_ahorro, /distancias ya calculadas/);
  void d1; void d2;
});

test('entregas de un solo producto: sugiere despachos planificados cercanos donde caben', () => {
  const { db, cajaA, cajaB, ids, entrega } = preparar();
  const sola = entrega(ids.c3, [[cajaB, 2]]); // un solo producto
  // despacho planificado con una parada cerca (Cliente 1) en el vehículo 1, cargado a la mitad
  const dExistente = entrega(ids.c1, [[cajaA, 8]]);
  const t = Number(db.prepare("INSERT INTO trips (fecha, vehicle_id, estado, n_paradas) VALUES ('2026-11-27', 1, 'planificado', 1)").run().lastInsertRowid);
  db.prepare('INSERT INTO trip_stops (trip_id, delivery_id, client_id, orden) VALUES (?, ?, ?, 1)').run(t, dExistente, ids.c1);
  db.prepare("UPDATE deliveries SET trip_id = ?, orden = 1 WHERE id = ?").run(t, dExistente);
  const r = sugerirConsolidacion(db);
  const op = r.un_producto.find((x) => x.entrega.delivery_id === sola);
  assert.ok(op, 'debe sugerir el despacho planificado');
  assert.equal(op.despachos[0].trip_id, t);
  assert.equal(op.despachos[0].cabe, true);
  assert.ok(op.despachos[0].distancia_km < 5);
});

test('utilización de la carga: peso y volumen de los despachos completados por vehículo', () => {
  const { db, cajaA, ids, entrega } = preparar();
  const d = entrega(ids.c1, [[cajaA, 12]]); // 1,5 m3 y 120 kg en un vehículo de 6,75 m3 y 800 kg
  const t = Number(db.prepare("INSERT INTO trips (fecha, vehicle_id, estado, n_paradas, peso_kg) VALUES ('2026-11-10', 1, 'completado', 1, 120)").run().lastInsertRowid);
  db.prepare('INSERT INTO trip_stops (trip_id, delivery_id, client_id, orden) VALUES (?, ?, ?, 1)').run(t, d, ids.c1);
  const u = utilizacionCarga(db, { desde: '2026-11-01', hasta: '2026-11-30' });
  const v1 = u.por_vehiculo.find((v) => v.vehicle_id === 1);
  assert.equal(v1.despachos, 1);
  assert.ok(Math.abs(v1.peso_pct - 15) < 1e-9);
  assert.ok(Math.abs(v1.volumen_pct - (1.5 / 6.75) * 100) < 1e-6);
  assert.equal(u.por_vehiculo.find((v) => v.vehicle_id === 2).despachos, 0);
  assert.equal(u.volumen_pct, v1.volumen_pct);
});
