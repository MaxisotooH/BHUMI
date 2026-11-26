import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { iniciar } from './helpers.js';

const PUNTOS = [['Cliente 1', -33.41, -70.57], ['Cliente 2', -33.45, -70.66], ['Cliente 3', -33.51, -70.75]];

/** Deja el sistema listo para planificar y devuelve helpers para crear despachos. */
async function preparar(call) {
  await call('PUT', '/settings', { google_api_key: 'CLAVE_DE_PRUEBA', costo_hora_conductor: 4000, tiempo_servicio_min: 10, meta_carga_min: 20, meta_preparacion_min: 30, meta_cumplimiento_pct: 95 });
  await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' });
  await call('PUT', '/vehiculos/1', { rendimiento_km_l: 10, capacidad_kg: 800, costo_km_neumaticos: 20, costo_km_mantencion: 30, costo_km_depreciacion: 25 });
  const clientes = [];
  for (const [nombre, lat, lng] of PUNTOS) clientes.push((await call('POST', '/clientes', { nombre, lat, lng, comuna: 'Santiago' })).data);
  const nuevoDespacho = async ({ driver_id, preparador_id, retorna = true, ventanas = [], n = 3, fecha = '2026-11-24' }) => {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const e = await call('POST', '/entregas', { client_id: clientes[i].id, fecha, ventana_hasta: ventanas[i] ?? null });
      ids.push(e.data.id);
    }
    const g = await call('POST', '/despachos', { entrega_ids: ids, orden: ids, alternativa: 'manual', vehicle_id: 1, driver_id, preparador_id, fecha, hora: '08:00', retorna });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    return g.data.trip_id;
  };
  return { clientes, nuevoDespacho };
}

const ev = (tipo, hora, stop_id) => ({ tipo, hora, ...(stop_id != null ? { stop_id } : {}) });

test('tiempos reales: se calculan carga, tránsito, entrega, puntualidad y productividad', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { nuevoDespacho } = await preparar(call);
    const cond = (await call('POST', '/personal', { nombre: 'Conductor A' })).data;
    const trip = await nuevoDespacho({ driver_id: cond.id, ventanas: ['09:00', '09:10', null] });
    const t = (await call('GET', `/despachos/${trip}`)).data;
    const [s1, s2, s3] = t.paradas;

    // Sin horas registradas todo queda en blanco: no se inventa nada
    const vacio = (await call('GET', `/despachos/${trip}/tiempos`)).data;
    assert.equal(vacio.registro.registrados, 0);
    assert.equal(vacio.registro.esperados, 2 + 3 + 6 + 1, 'preparación (2), carga (2), salida, 6 de paradas y regreso');
    assert.equal(vacio.preparacion.real_min, null);
    assert.equal(vacio.preparacion.objetivo_min, 30);
    assert.equal(vacio.carga.real_min, null);
    assert.equal(vacio.carga.objetivo_min, 20);
    assert.equal(vacio.ruta.real_min, null);
    assert.equal(vacio.paradas_por_hora, null);

    const r = await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [
      ev('preparacion_inicio', '06:20'), ev('preparacion_fin', '07:05'),
      ev('carga_inicio', '07:10'), ev('carga_fin', '07:35'), ev('salida', '08:05'),
      ev('llegada', '08:35', s1.id), ev('fin', '08:50', s1.id),
      ev('llegada', '09:20', s2.id), ev('fin', '09:30', s2.id),
      ev('llegada', '10:00', s3.id), ev('fin', '10:12', s3.id),
      ev('regreso', '10:45'),
    ] });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const m = r.data;
    assert.equal(m.registro.registrados, m.registro.esperados);
    assert.equal(m.preparacion.real_min, 45);
    assert.equal(m.preparacion.dif_min, 15, 'preparación 45 min frente a la meta de 30');
    assert.equal(m.carga.real_min, 25);
    assert.equal(m.carga.dif_min, 5, 'carga 25 min frente al objetivo de 20');
    assert.equal(m.salida.atraso_min, 5, 'salió 5 min después de las 08:00');
    assert.deepEqual(m.paradas.map((p) => p.transito.real_min), [30, 30, 30]);
    assert.deepEqual(m.paradas.map((p) => p.entrega.real_min), [15, 10, 12]);
    assert.equal(m.retorno.real_min, 33);
    assert.equal(m.ruta.real_min, 160);
    // Lo estimado sale de lo guardado al planificar
    assert.deepEqual(m.paradas.map((p) => p.transito.estimado_min), [s1.min_tramo, s2.min_tramo, s3.min_tramo]);
    assert.equal(m.paradas[0].transito.dif_min, 30 - s1.min_tramo);
    assert.equal(m.estandar_servicio_min, 10, 'servicio previsto por parada = tiempo de servicio configurado al planificar');
    assert.equal(m.paradas[0].entrega.dif_min, 5);
    assert.equal(m.ruta.estimado_min, t.tiempo_min);
    assert.ok(Math.abs(m.paradas_por_hora - 3 / (160 / 60)) < 1e-9);
    // Puntualidad: 08:35 vs 09:00 llega a tiempo; 09:20 vs 09:10 llega 10 min tarde; la tercera no tiene ventana
    assert.equal(m.paradas[0].ventana.a_tiempo, true);
    assert.equal(m.paradas[1].ventana.a_tiempo, false);
    assert.equal(m.paradas[1].ventana.atraso_min, 10);
    assert.equal(m.paradas[2].ventana, null);

    // Borrar una hora la deja en blanco y los tramos que dependían de ella dejan de medirse
    const b = (await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('fin', '', s1.id)] })).data;
    assert.equal(b.paradas[0].fin, null);
    assert.equal(b.paradas[0].entrega.real_min, null);
    assert.equal(b.paradas[1].transito.real_min, null, 'sin fin de la entrega anterior no se puede medir el tramo siguiente');
    assert.equal(b.paradas[2].transito.real_min, 30);

    // La hoja de ruta en PDF se genera con las horas registradas y también sin ellas
    const hoja = await call('GET', `/reportes/despacho/${trip}.pdf`);
    assert.equal(hoja.status, 200);
    assert.equal(hoja.data.subarray(0, 4).toString(), '%PDF');
    await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('preparacion_inicio', ''), ev('preparacion_fin', ''), ev('carga_inicio', ''), ev('carga_fin', ''), ev('salida', ''), ev('regreso', ''), ev('llegada', '', s1.id), ev('llegada', '', s2.id), ev('fin', '', s2.id), ev('llegada', '', s3.id), ev('fin', '', s3.id)] });
    const hojaVacia = await call('GET', `/reportes/despacho/${trip}.pdf`);
    assert.equal(hojaVacia.status, 200);
    assert.equal(hojaVacia.data.subarray(0, 4).toString(), '%PDF');
  } finally { cerrar(); }
});

test('tiempos reales: validaciones y orden cronológico', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { nuevoDespacho } = await preparar(call);
    const trip = await nuevoDespacho({ retorna: false, n: 2 });
    const t = (await call('GET', `/despachos/${trip}`)).data;
    const [s1, s2] = t.paradas;
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('salida', '08:30'), ev('llegada', '09:00', s1.id)] })).status, 200);

    // Hora anterior a la salida: se rechaza con un mensaje claro y no se guarda nada
    const malo = await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('fin', '09:30', s1.id), ev('llegada', '08:00', s2.id)] });
    assert.equal(malo.status, 400);
    assert.match(malo.data.error.mensaje, /no puede ser anterior/);
    const tras = (await call('GET', `/despachos/${trip}/tiempos`)).data;
    assert.equal(tras.paradas[0].fin, null, 'el rechazo revierte todo el lote');
    assert.equal(tras.paradas[1].llegada, null);

    const formato = await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('salida', '8:30')] });
    assert.equal(formato.status, 400);
    assert.match(formato.data.error.mensaje, /HH:MM/);
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('salida', '25:00')] })).status, 400);
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('llegada', '09:00', 99999)] })).status, 400, 'la parada debe ser de este despacho');
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('regreso', '11:00')] })).status, 400, 'un despacho sin regreso no registra regreso');
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('almuerzo', '12:00')] })).status, 400);
    const prepMal = await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('preparacion_inicio', '07:30'), ev('preparacion_fin', '07:00')] });
    assert.equal(prepMal.status, 400, 'la preparación no puede terminar antes de empezar');
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [] })).status, 400);
    assert.equal((await call('GET', '/despachos/9999/tiempos')).status, 404);

    // Sin regreso, la ruta se mide hasta la última entrega y sirve igual para los promedios
    await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('fin', '09:10', s1.id), ev('llegada', '09:40', s2.id), ev('fin', '09:52', s2.id)] });
    const m = (await call('GET', `/despachos/${trip}/tiempos`)).data;
    assert.equal(m.retorno, null);
    assert.equal(m.ruta.hasta, 'ultima_entrega');
    assert.equal(m.ruta.real_min, 82);

    // Un despacho cancelado no admite horas
    await call('POST', `/despachos/${trip}/estado`, { estado: 'cancelado' });
    assert.equal((await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('salida', '08:00')] })).status, 400);
  } finally { cerrar(); }
});

test('KPIs por conductor: promedios con los datos registrados y sin inventar el resto', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { nuevoDespacho } = await preparar(call);
    const a = (await call('POST', '/personal', { nombre: 'Ana' })).data;
    const b = (await call('POST', '/personal', { nombre: 'Beto' })).data;
    const carla = (await call('POST', '/personal', { nombre: 'Carla', rol: 'preparador' })).data;
    const registrar = async (trip, eventos) => (await call('PUT', `/despachos/${trip}/tiempos`, { eventos })).status;

    // Ana: dos despachos completos
    const t1 = await nuevoDespacho({ driver_id: a.id, preparador_id: carla.id, n: 2, ventanas: ['09:00', '09:30'] });
    const p1 = (await call('GET', `/despachos/${t1}`)).data.paradas;
    assert.equal(await registrar(t1, [ev('preparacion_inicio', '06:30'), ev('preparacion_fin', '07:00'), ev('carga_inicio', '07:00'), ev('carga_fin', '07:30'), ev('salida', '08:00'), ev('llegada', '08:30', p1[0].id), ev('fin', '08:45', p1[0].id), ev('llegada', '09:15', p1[1].id), ev('fin', '09:25', p1[1].id), ev('regreso', '10:00')]), 200);
    const t2 = await nuevoDespacho({ driver_id: a.id, preparador_id: carla.id, n: 2, fecha: '2026-11-25', ventanas: ['09:00', '09:05'] });
    const p2 = (await call('GET', `/despachos/${t2}`)).data.paradas;
    assert.equal(await registrar(t2, [ev('preparacion_inicio', '06:40'), ev('preparacion_fin', '07:00'), ev('carga_inicio', '07:00'), ev('carga_fin', '07:20'), ev('salida', '08:00'), ev('llegada', '08:40', p2[0].id), ev('fin', '08:50', p2[0].id), ev('llegada', '09:20', p2[1].id), ev('fin', '09:35', p2[1].id), ev('regreso', '10:20')]), 200);

    // Ana completa el primer despacho dejando una entrega sin hacer: eso mide el cumplimiento
    await call('POST', `/despachos/${t1}/estado`, { estado: 'completado', no_entregadas: [p1[1].delivery_id], nueva_fecha: '2026-12-01', motivo: 'Cliente cerrado' });

    // Beto: un despacho con solo la carga registrada
    const t3 = await nuevoDespacho({ driver_id: b.id, n: 2 });
    assert.equal(await registrar(t3, [ev('carga_inicio', '06:50'), ev('carga_fin', '07:20')]), 200);
    // Otro despacho de Beto sin ninguna hora, ya completado
    const t4 = await nuevoDespacho({ driver_id: b.id, n: 2, fecha: '2026-11-26' });
    await call('POST', `/despachos/${t4}/estado`, { estado: 'completado' });

    const k = (await call('GET', '/kpi/personal?desde=2026-11-01&hasta=2026-11-30')).data;
    assert.equal(k.objetivos.carga_min, 20);
    const ka = k.conductores.find((c) => c.nombre === 'Ana');
    const kb = k.conductores.find((c) => c.nombre === 'Beto');
    assert.equal(ka.despachos, 2);
    assert.equal(ka.despachos_total, 2);
    assert.equal(ka.carga.prom_min, 25, '(30 + 20) / 2');
    assert.equal(ka.carga.dif_prom_min, 5);
    assert.equal(ka.carga.n, 2);
    assert.equal(ka.cumplimiento.programadas, 2, 'solo cuenta el despacho completado');
    assert.equal(ka.cumplimiento.entregadas, 1);
    assert.equal(ka.cumplimiento.pct, 50);
    assert.deepEqual(ka.cumplimiento.motivos, [{ motivo: 'Cliente cerrado', n: 1 }]);
    assert.equal(ka.entrega.n, 4);
    assert.equal(ka.entrega.prom_min, 12.5, '(15 + 10 + 10 + 15) / 4');
    assert.equal(ka.entrega.estandar_prom_min, 10);
    assert.equal(ka.entrega.dif_prom_min, 2.5);
    assert.equal(ka.ruta.prom_min, 130, '(120 + 140) / 2');
    // 4 paradas en 4,33 h
    assert.ok(Math.abs(ka.productividad.paradas_por_hora - 4 / (260 / 60)) < 1e-9);
    // Puntualidad: 08:30<=09:00 sí, 09:15<=09:30 sí, 08:40<=09:00 sí, 09:20>09:05 no => 3 de 4
    assert.equal(ka.puntualidad.evaluadas, 4);
    assert.equal(ka.puntualidad.pct, 75);
    assert.equal(ka.salida.atraso_prom_min, 0);
    assert.ok(ka.transito.n === 6, 'cuatro tramos a clientes y dos de regreso');
    assert.ok(ka.transito.ratio_pct > 0);

    assert.equal(kb.despachos, 1, 'solo el despacho con horas cuenta como medido');
    assert.equal(kb.despachos_total, 2);
    assert.equal(kb.carga.prom_min, 30);
    assert.equal(kb.entrega.prom_min, null, 'sin horas de entrega no hay promedio');
    assert.equal(kb.entrega.n, 0);
    assert.equal(kb.productividad.paradas_por_hora, null);
    assert.equal(kb.puntualidad.pct, null);

    // Personal de bodega: la preparación y la carga se atribuyen al responsable del despacho
    const bc = k.bodega.find((x) => x.nombre === 'Carla');
    assert.equal(bc.despachos_total, 2);
    assert.equal(bc.preparacion.prom_min, 25, '(30 + 20) / 2');
    assert.equal(bc.preparacion.objetivo_min, 30);
    assert.equal(bc.preparacion.dif_prom_min, -5);
    assert.equal(bc.carga.prom_min, 25);
    const sinResp = k.bodega.find((x) => x.nombre === 'Sin responsable de bodega');
    assert.equal(sinResp.carga.prom_min, 30, 'la carga de Beto no tiene responsable de bodega');
    assert.equal(sinResp.preparacion.prom_min, null);
    assert.equal(k.total.preparacion.n, 2);
    assert.equal(k.total.cumplimiento.programadas, 4, 'el despacho completado de Ana (2) y el de Beto sin horas (2)');
    assert.equal(k.total.cumplimiento.entregadas, 3);

    assert.equal(k.total.despachos, 3);
    assert.equal(k.total.carga.n, 3);
    assert.ok(Math.abs(k.total.carga.prom_min - 80 / 3) < 1e-9);
    assert.equal(k.sin_registro_total, 1);
    assert.equal(k.sin_registro[0].trip_id, t4);
    assert.equal(k.despachos.length, 4);
    assert.equal(k.despachos.find((d) => d.trip_id === t1).ruta_min, 120);

    // Filtros por conductor y por fechas
    const soloAna = (await call('GET', `/kpi/personal?driver_id=${a.id}`)).data;
    assert.deepEqual(soloAna.conductores.map((c) => c.nombre), ['Ana']);
    const dia = (await call('GET', '/kpi/personal?desde=2026-11-25&hasta=2026-11-25')).data;
    assert.equal(dia.conductores.length, 1);
    assert.equal(dia.conductores[0].carga.prom_min, 20);
    const nada = (await call('GET', '/kpi/personal?desde=2030-01-01')).data;
    assert.equal(nada.conductores.length, 0);
    assert.equal(nada.total.carga.prom_min, null);

    // Reportes
    const x = await call('GET', '/reportes/kpi.xlsx?desde=2026-11-01&hasta=2026-11-30');
    assert.equal(x.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.data);
    assert.deepEqual(wb.worksheets.map((w) => w.name), ['Resumen', 'Conductores', 'Bodega', 'Motivos de no entrega', 'Despachos', 'Paradas']);
    const resumen = wb.getWorksheet('Conductores');
    assert.equal(resumen.getRow(2).getCell(1).value, 'Ana');
    assert.equal(resumen.getRow(2).getCell(6).value, 12.5, 'entrega en cliente');
    assert.equal(resumen.getRow(4).getCell(1).value, 'Todos');
    assert.equal(wb.getWorksheet('Bodega').getRow(2).getCell(1).value, 'Carla');
    assert.equal(wb.getWorksheet('Motivos de no entrega').getRow(2).getCell(1).value, 'Cliente cerrado');
    assert.equal(wb.getWorksheet('Paradas').rowCount, 1 + 4, 'una fila por parada con horas registradas (las 4 de Ana)');
    const pdf = await call('GET', '/reportes/kpi.pdf');
    assert.equal(pdf.status, 200);
    assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');

    // Respaldo y borrado: las horas viajan en el respaldo y se eliminan con el despacho
    assert.ok((await call('GET', '/respaldo.json')).data.trip_events.length > 0);
    assert.equal((await call('DELETE', `/despachos/${t3}`)).status, 200);
    assert.equal((await call('GET', '/kpi/personal')).data.total.carga.n, 2);
  } finally { cerrar(); }
});

test('sin objetivo de carga ni tiempo de servicio no se comparan: se muestran solo los reales', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await call('PUT', '/settings', { google_api_key: 'K', costo_hora_conductor: 4000 }); // sin tiempo de servicio ni objetivo de carga
    await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' });
    await call('PUT', '/vehiculos/1', { rendimiento_km_l: 10 });
    const c = (await call('POST', '/clientes', { nombre: 'A', lat: -33.41, lng: -70.57 })).data;
    const e = (await call('POST', '/entregas', { client_id: c.id, fecha: '2026-11-24' })).data;
    const g = await call('POST', '/despachos', { entrega_ids: [e.id], vehicle_id: 1, fecha: '2026-11-24', retorna: true });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    const trip = g.data.trip_id;
    const stop = (await call('GET', `/despachos/${trip}`)).data.paradas[0];
    await call('PUT', `/despachos/${trip}/tiempos`, { eventos: [ev('carga_inicio', '07:00'), ev('carga_fin', '07:25'), ev('salida', '08:00'), ev('llegada', '08:20', stop.id), ev('fin', '08:31', stop.id), ev('regreso', '08:50')] });
    const m = (await call('GET', `/despachos/${trip}/tiempos`)).data;
    assert.equal(m.carga.real_min, 25);
    assert.equal(m.carga.objetivo_min, null);
    assert.equal(m.carga.dif_min, null);
    assert.equal(m.estandar_servicio_min, null);
    assert.equal(m.paradas[0].entrega.real_min, 11);
    assert.equal(m.paradas[0].entrega.dif_min, null);
    assert.equal(m.ruta.real_min, 50);
    assert.equal(m.ruta.estimado_min, null, 'sin tiempo de servicio planificado la ruta estimada no es comparable');
    const k = (await call('GET', '/kpi/personal')).data;
    assert.equal(k.conductores[0].nombre, 'Sin conductor asignado');
    assert.equal(k.medidos_sin_conductor, 1);
    assert.equal(k.total.entrega.estandar_prom_min, null);
  } finally { cerrar(); }
});

test('el personal de un despacho se puede cambiar, y cada entrega no realizada guarda su propio motivo', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { nuevoDespacho } = await preparar(call);
    const ana = (await call('POST', '/personal', { nombre: 'Ana' })).data;
    const beto = (await call('POST', '/personal', { nombre: 'Beto' })).data;
    const carla = (await call('POST', '/personal', { nombre: 'Carla', rol: 'preparador' })).data;
    const trip = await nuevoDespacho({ driver_id: ana.id, n: 3 });

    // Cambiar conductor y responsable de bodega
    assert.equal((await call('PUT', `/despachos/${trip}/personal`, { driver_id: beto.id, preparador_id: carla.id })).status, 200);
    let t = (await call('GET', `/despachos/${trip}`)).data;
    assert.equal(t.driver_id, beto.id);
    assert.equal(t.preparador_id, carla.id);
    // Los roles se respetan: una persona de bodega no puede ser conductora ni al revés
    assert.equal((await call('PUT', `/despachos/${trip}/personal`, { driver_id: carla.id })).status, 400);
    assert.equal((await call('PUT', `/despachos/${trip}/personal`, { preparador_id: ana.id })).status, 400);
    assert.equal((await call('PUT', '/despachos/9999/personal', { driver_id: ana.id })).status, 404);
    // Quitar la asignación también es válido
    assert.equal((await call('PUT', `/despachos/${trip}/personal`, {})).status, 200);
    t = (await call('GET', `/despachos/${trip}`)).data;
    assert.equal(t.driver_id, null);
    assert.equal(t.preparador_id, null);

    // Un motivo distinto por cada entrega que no se pudo hacer
    const [, p2, p3] = t.paradas;
    const r = await call('POST', `/despachos/${trip}/estado`, {
      estado: 'completado', no_entregadas: [p2.delivery_id, p3.delivery_id], nueva_fecha: '2026-12-01',
      motivo: 'Sin motivo específico', motivos: { [p2.delivery_id]: 'Cliente cerrado', [p3.delivery_id]: 'Dirección no existe' },
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const despues = (await call('GET', `/despachos/${trip}`)).data.paradas;
    assert.equal(despues.find((p) => p.delivery_id === p2.delivery_id).motivo_no_entrega, 'Cliente cerrado');
    assert.equal(despues.find((p) => p.delivery_id === p3.delivery_id).motivo_no_entrega, 'Dirección no existe');
    assert.equal(despues[0].resultado, 'entregada');
  } finally { cerrar(); }
});

test('los indicadores por mes solo cuentan los despachos de ese mes', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { nuevoDespacho } = await preparar(call);
    const ana = (await call('POST', '/personal', { nombre: 'Ana' })).data;
    const registrar = (trip, eventos) => call('PUT', `/despachos/${trip}/tiempos`, { eventos });
    const nov = await nuevoDespacho({ driver_id: ana.id, n: 1, fecha: '2026-11-24' });
    const dic = await nuevoDespacho({ driver_id: ana.id, n: 1, fecha: '2026-12-10' });
    await registrar(nov, [ev('carga_inicio', '07:00'), ev('carga_fin', '07:20')]);
    await registrar(dic, [ev('carga_inicio', '07:00'), ev('carga_fin', '07:50')]);

    const soloNov = (await call('GET', '/kpi/personal?mes=2026-11')).data;
    const soloDic = (await call('GET', '/kpi/personal?mes=2026-12')).data;
    assert.equal(soloNov.total.carga.n, 1);
    assert.equal(soloNov.total.carga.prom_min, 20);
    assert.equal(soloDic.total.carga.n, 1);
    assert.equal(soloDic.total.carga.prom_min, 50);
    assert.equal((await call('GET', '/kpi/personal')).data.total.carga.n, 2, 'sin período cuenta todo el historial');
    assert.equal((await call('GET', '/kpi/personal?mes=2027-03')).data.total.carga.n, 0, 'un mes sin despachos queda en blanco');
  } finally { cerrar(); }
});
