import test from 'node:test';
import assert from 'node:assert/strict';
import { openDb, setSettings } from '../server/db.js';
import { panelAnalisis } from '../server/services/panel.js';
import { controlCostos } from '../server/services/control-costos.js';
import { resolverPeriodo } from '../server/services/periodo.js';

function escenario() {
  const db = openDb(':memory:');
  setSettings(db, { costo_hora_conductor: 4000, meta_carga_min: 20, meta_preparacion_min: 30, meta_cumplimiento_pct: 95, meta_utilizacion_pct: 70, tiempo_servicio_min: 10 });
  db.prepare("INSERT INTO fuel_prices (combustible, precio, vigente_desde) VALUES ('Bencina', 1300, '2020-01-01')").run();
  // Vehículo 1: gasta más (8 km/L); vehículo 2: gasta menos (12 km/L)
  db.prepare('UPDATE vehicles SET rendimiento_km_l = 8, capacidad_kg = 800, costo_km_neumaticos = 20, costo_km_mantencion = 30, costo_km_depreciacion = 25, km_actual = 30000 WHERE id = 1').run();
  db.prepare('UPDATE vehicles SET rendimiento_km_l = 12, capacidad_kg = 1000, costo_km_neumaticos = 15, costo_km_mantencion = 25, costo_km_depreciacion = 20, km_actual = 20000 WHERE id = 2').run();
  const chofer = Number(db.prepare("INSERT INTO drivers (nombre, costo_hora, rol) VALUES ('Conductor A', 4000, 'conductor')").run().lastInsertRowid);
  const bodega = Number(db.prepare("INSERT INTO drivers (nombre, costo_hora, rol) VALUES ('Bodeguero B', 3000, 'preparador')").run().lastInsertRowid);
  const c = db.prepare("INSERT INTO clients (nombre, comuna, lat, lng) VALUES (?, ?, ?, ?)");
  const cli = { a: Number(c.run('Cliente A', 'Quinta Normal', -33.43, -70.70).lastInsertRowid), b: Number(c.run('Cliente B', 'Pudahuel', -33.44, -70.76).lastInsertRowid), d: Number(c.run('Cliente D', 'Puente Alto', -33.61, -70.57).lastInsertRowid) };
  const trip = (fecha, veh, paradas, { km, min, costo, comb, des, alt = 'optima', plan = null, peso = null }) => {
    const t = Number(db.prepare(`INSERT INTO trips (fecha, vehicle_id, driver_id, preparador_id, estado, alternativa, n_paradas, distancia_km, tiempo_min, peso_kg, costo_combustible, costo_desgaste, costo_otros, costo_total, plan_json)
      VALUES (?, ?, ?, ?, 'completado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(fecha, veh, chofer, bodega, alt, paradas.length, km, min, peso, comb, des, costo - comb - des, costo, plan ? JSON.stringify(plan) : null).lastInsertRowid);
    paradas.forEach((cl, i) => db.prepare("INSERT INTO trip_stops (trip_id, client_id, orden, km_tramo, costo_asignado, resultado) VALUES (?, ?, ?, ?, ?, ?)").run(t, cl.id, i + 1, km / paradas.length, costo / paradas.length, cl.ok === false ? 'no_entregada' : 'entregada'));
    return t;
  };
  const t1 = trip('2026-11-03', 1, [{ id: cli.a }, { id: cli.b }], { km: 40, min: 120, costo: 40000, comb: 6500, des: 3000 });
  const t2 = trip('2026-11-05', 1, [{ id: cli.d }, { id: cli.a, ok: false }], { km: 80, min: 200, costo: 70000, comb: 13000, des: 6000, alt: 'manual', plan: { alternativas: [{ codigo: 'A', km: 60, total: 62000 }, { codigo: 'B', km: 70, total: 66000 }] } });
  const ev = db.prepare('INSERT INTO trip_events (trip_id, stop_id, tipo, momento) VALUES (?, NULL, ?, ?)');
  ev.run(t1, 'preparacion_inicio', '2026-11-03T06:00'); ev.run(t1, 'preparacion_fin', '2026-11-03T06:50'); // 50 min (meta 30 → 20 sobre)
  ev.run(t1, 'carga_inicio', '2026-11-03T06:50'); ev.run(t1, 'carga_fin', '2026-11-03T07:20');             // 30 min (meta 20 → 10 sobre)
  return { db, t1, t2, chofer, bodega, cli };
}

test('periodo: mes, rango y valores por defecto', () => {
  assert.deepEqual(resolverPeriodo({ mes: '2026-02' }), { desde: '2026-02-01', hasta: '2026-02-28', hasta_excl: '2026-03-01', mes: '2026-02', etiqueta: '2026-02' });
  const r = resolverPeriodo({ desde: '2026-11-10', hasta: '2026-11-20' });
  assert.equal(r.hasta_excl, '2026-11-21');
  assert.equal(r.mes, null);
  assert.equal(resolverPeriodo({}, '2026-11-25').mes, '2026-11');
});

test('control de costos: compara lo modelado con lo gastado de verdad', () => {
  const { db } = escenario();
  db.prepare("INSERT INTO fuel_logs (vehicle_id, fecha, litros, monto, km_odometro) VALUES (1, '2026-11-04', 20, 26000, 30000)").run();
  db.prepare("INSERT INTO fuel_logs (vehicle_id, fecha, litros, monto, km_odometro) VALUES (1, '2026-11-12', 15, 19500, 30120)").run();
  db.prepare("INSERT INTO gastos (vehicle_id, fecha, categoria, monto, km_odometro) VALUES (1, '2026-11-08', 'mantencion_preventiva', 80000, 30050)").run();
  db.prepare("INSERT INTO gastos (vehicle_id, fecha, categoria, monto) VALUES (1, '2026-11-09', 'seguro', 50000)").run();
  const r = controlCostos(db, { mes: '2026-11' });
  assert.equal(r.despachos, 2);
  assert.equal(r.modelado.combustible, 19500);
  assert.equal(r.modelado.desgaste, 9000);
  assert.equal(r.modelado.total, 110000);
  assert.equal(r.real.combustible, 45500);
  assert.equal(r.real.mantencion_y_desgaste, 80000);
  assert.equal(r.real.fijos, 50000);
  const comb = r.comparacion.find((c) => c.concepto === 'Combustible');
  assert.equal(comb.dif, 26000);
  assert.ok(Math.abs(comb.dif_pct - (26000 / 19500) * 100) < 1e-9);
  assert.equal(r.costo_km.modelado, 110000 / 120);
  // el costo total real exige combustible real; aquí existe
  assert.ok(r.total_con_conductor.real > 0);
  assert.equal(r.por_vehiculo.find((v) => v.vehicle_id === 1).despachos, 2);
  assert.equal(r.por_vehiculo.find((v) => v.vehicle_id === 2).real, null);
  assert.equal(r.serie.length, 6);
  assert.equal(r.serie.at(-1).mes, '2026-11');
});

test('control de costos: sin cargas de combustible no inventa un total real', () => {
  const { db } = escenario();
  const r = controlCostos(db, { mes: '2026-11' });
  assert.equal(r.total_con_conductor.real, null);
  assert.equal(r.costo_km.real, null);
  assert.equal(r.comparacion.find((c) => c.concepto === 'Combustible').real, null);
  assert.ok(r.avisos.some((a) => /cargas de combustible/.test(a)));
  const vacio = controlCostos(db, { mes: '2026-01' });
  assert.equal(vacio.despachos, 0);
  assert.ok(vacio.avisos.some((a) => /No hay despachos completados/.test(a)));
});

test('panel: las siete vistas con datos del período', () => {
  const { db, t2 } = escenario();
  db.prepare("INSERT INTO sectores (comuna, zona, seguridad) VALUES ('Puente Alto', 'Sur', 'alto_riesgo')").run();
  const r = panelAnalisis(db, { mes: '2026-11' });
  assert.equal(r.resumen.despachos, 2);
  assert.equal(r.resumen.entregas, 4);
  assert.equal(r.resumen.km, 120);
  assert.equal(r.resumen.costo_total, 110000);
  assert.equal(r.resumen.costo_entrega, 27500);
  assert.equal(r.resumen.cumplimiento_pct, 75); // 3 de 4

  // 1. rutas más costosas: el despacho 2 primero
  assert.equal(r.rutas_costosas.despachos[0].trip_id, t2);
  assert.deepEqual(r.rutas_costosas.despachos[0].sectores, ['Puente Alto', 'Quinta Normal']);
  assert.equal(r.rutas_costosas.por_ruta[0].ruta, 'Puente Alto · Quinta Normal');

  // 2. conductores
  const cond = r.conductores.filas.find((f) => f.nombre === 'Conductor A');
  assert.equal(cond.despachos, 2);
  assert.equal(cond.costo_entrega, 27500);
  assert.equal(cond.cumplimiento_pct, 75);

  // 3. costo por cliente y sector
  const sq = r.costo_cliente_sector.sectores.find((s) => s.clave === 'Quinta Normal');
  assert.equal(sq.entregas, 1);
  assert.equal(sq.no_entregadas, 1); // la segunda visita al Cliente A no se entregó
  assert.equal(r.costo_cliente_sector.zonas.find((z) => z.clave === 'Sur').entregas, 1);

  // 4. vehículos
  const v1 = r.vehiculos.find((v) => v.vehicle_id === 1);
  assert.equal(v1.km_despachos, 120);
  assert.equal(v1.desgaste_modelado, 9000);
  assert.equal(r.vehiculos.find((v) => v.vehicle_id === 2).despachos, 0);

  // 5. combustible: el vehículo 2 gasta menos (12 km/L contra 8 km/L): 120 km → 15 L vs 10 L → 5 L x 1300 = 6.500
  assert.ok(Math.abs(r.combustible.ahorro_vehiculo - 6500) < 1e-6, `ahorro vehículo ${r.combustible.ahorro_vehiculo}`);
  assert.equal(r.combustible.oportunidades.some((o) => o.tipo === 'vehiculo'), true);

  // 7. ahorro potencial: rutas (70.000 → 62.000 = 8.000) + vehículo + procesos
  assert.equal(r.ahorro_potencial.rutas.total, 8000);
  // procesos: preparación 20 min sobre la meta a $3.000/h = 1.000; carga 10 min a $3.000/h = 500
  assert.ok(Math.abs(r.ahorro_potencial.procesos.detalle.preparacion.costo - 1000) < 1e-9);
  assert.ok(Math.abs(r.ahorro_potencial.procesos.detalle.carga.costo - 500) < 1e-9);
  const piezas = Object.fromEntries(r.ahorro_potencial.piezas.map((p) => [p.id, p.monto]));
  assert.equal(piezas.rutas, 8000);
  assert.equal(piezas.cubicaje, null); // sin entregas pendientes: no hay nada que consolidar
  assert.equal(r.ahorro_potencial.completo, false);
  assert.ok(Math.abs(r.ahorro_potencial.total - (8000 + 6500 + 1500)) < 1e-6);
  assert.equal(r.proyeccion.mes, '2026-11');
  assert.equal(r.serie.at(-1).mes, '2026-11');
});

test('panel: sin datos no inventa cifras', () => {
  const db = openDb(':memory:');
  const r = panelAnalisis(db, { mes: '2026-11' });
  assert.equal(r.resumen.despachos, 0);
  assert.equal(r.resumen.costo_total, null);
  assert.equal(r.resumen.cumplimiento_pct, null);
  assert.equal(r.resumen.ahorro_potencial, null);
  assert.equal(r.combustible.ahorro_vehiculo, null);
  assert.ok(r.datos_faltantes.length > 0);
});
