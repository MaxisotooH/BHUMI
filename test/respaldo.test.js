import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.js';

const bytesDe = (obj) => new TextEncoder().encode(typeof obj === 'string' ? obj : JSON.stringify(obj));

/** Crea un conjunto de datos completo: vehículo, clientes, productos, entrega, despacho con horas reales. */
async function poblar(call) {
  await call('PUT', '/settings', { google_api_key: 'CLAVE_ORIGEN', costo_hora_conductor: 4000, tiempo_servicio_min: 10, meta_carga_min: 20 });
  await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' });
  await call('PUT', '/vehiculos/1', { rendimiento_km_l: 10, capacidad_kg: 800, costo_km_neumaticos: 20, costo_km_mantencion: 30, costo_km_depreciacion: 25 });
  const cond = (await call('POST', '/personal', { nombre: 'Conductor Ñ', costo_hora: 4000 })).data;
  const bodega = (await call('POST', '/personal', { nombre: 'Bodeguera Á', rol: 'preparador' })).data;
  await call('PUT', '/vehiculos/1', { carga_largo_cm: 300, carga_ancho_cm: 150, carga_alto_cm: 150 });
  const prod = (await call('POST', '/productos', { nombre: 'Caja grande', peso_kg: 12, largo_cm: 60, ancho_cm: 40, alto_cm: 40, apilable: true })).data;
  const cs = [];
  for (const [nombre, lat, lng] of [['Cliente 1', -33.41, -70.57], ['Cliente 2', -33.45, -70.66]]) cs.push((await call('POST', '/clientes', { nombre, lat, lng, comuna: 'Santiago' })).data);
  const ids = [];
  for (const c of cs) ids.push((await call('POST', '/entregas', { client_id: c.id, fecha: '2026-11-24', items: [{ product_id: prod.id, cantidad: 2 }] })).data.id);
  const g = await call('POST', '/despachos', { entrega_ids: ids, orden: ids, alternativa: 'manual', vehicle_id: 1, driver_id: cond.id, preparador_id: bodega.id, fecha: '2026-11-24', hora: '08:00', retorna: true });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const t = (await call('GET', `/despachos/${g.data.trip_id}`)).data;
  await call('PUT', `/despachos/${g.data.trip_id}/tiempos`, { eventos: [
    { tipo: 'preparacion_inicio', hora: '06:30' }, { tipo: 'preparacion_fin', hora: '07:05' }, { tipo: 'carga_inicio', hora: '07:10' }, { tipo: 'carga_fin', hora: '07:35' }, { tipo: 'salida', hora: '08:05' },
    { tipo: 'llegada', hora: '08:35', stop_id: t.paradas[0].id }, { tipo: 'fin', hora: '08:50', stop_id: t.paradas[0].id },
  ] });
  // Datos de los demás pilares: gastos reales, kilometraje semanal, seguridad de sectores e incidentes
  await call('POST', '/gastos', { vehicle_id: 1, fecha: '2026-11-10', categoria: 'mantencion_preventiva', monto: 80000, km_odometro: 51000, proveedor: 'Taller Ñuñoa' });
  await call('PUT', '/km-semanal', { vehicle_id: 1, fecha: '2026-11-12', km: 310, odometro: 51300 });
  await call('PUT', '/zonas/sectores', { comuna: 'Santiago', zona: 'Centro', seguridad: 'precaucion', fuente: 'Experiencia de los conductores', horario_recomendado: 'Antes de las 18:00' });
  await call('POST', '/zonas/incidentes', { fecha: '2026-11-05', comuna: 'Santiago', tipo: 'robo', descripcion: 'Intento de robo en descarga' });
  await call('POST', `/despachos/${g.data.trip_id}/estado`, { estado: 'completado', no_entregadas: [t.paradas[1].delivery_id], nueva_fecha: '2026-11-30', motivo: 'Local cerrado' });
  return { trip: g.data.trip_id };
}

test('respaldo JSON: se restaura en un sistema vacío con los mismos datos y sin la API key', async () => {
  const origen = await iniciar();
  const destino = await iniciar();
  try {
    const { trip } = await poblar(origen.call);
    const resp = await origen.call('GET', '/respaldo.json');
    assert.equal(resp.status, 200);
    assert.ok(!resp.data.settings.some((s) => s.key === 'google_api_key'), 'el respaldo nunca lleva la API key');

    await destino.call('PUT', '/settings', { google_api_key: 'CLAVE_DESTINO' });
    const r = await destino.subir('/respaldo/restaurar', bytesDe(resp.data));
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.tipo, 'json');
    assert.equal(r.data.filas.clients, 2);

    for (const ruta of ['/clientes', '/vehiculos', '/productos', '/entregas', '/despachos', `/despachos/${trip}`, `/despachos/${trip}/tiempos`, '/combustible/precios', '/personal', '/gastos?mes=2026-11', '/km-semanal', '/zonas/sectores', '/zonas/incidentes', '/flota', '/kpi/personal?desde=2026-11-01&hasta=2026-11-30', '/panel?mes=2026-11', '/control-costos?mes=2026-11']) {
      const a = (await origen.call('GET', ruta)).data;
      const b = (await destino.call('GET', ruta)).data;
      assert.deepEqual(b, a, `${ruta} debe quedar igual tras restaurar`);
    }
    const s = (await destino.call('GET', '/settings')).data;
    assert.equal(s.google_api_key, 'CLAVE_DESTINO', 'conserva la API key que ya estaba en este sistema');
    assert.equal(s.costo_hora_conductor, '4000');
    assert.equal((await destino.call('GET', '/meta')).data.regiones.length, 16, 'no toca el catálogo de regiones');
    // Lo nuevo viaja completo: medidas, rol, responsable de bodega y resultado por parada
    const p = (await destino.call('GET', '/productos')).data.find((x) => x.nombre === 'Caja grande');
    assert.deepEqual([p.largo_cm, p.ancho_cm, p.alto_cm, p.apilable], [60, 40, 40, 1]);
    assert.equal((await destino.call('GET', '/vehiculos/1')).data.carga_alto_cm, 150);
    assert.deepEqual((await destino.call('GET', '/personal')).data.map((x) => x.rol).sort(), ['conductor', 'preparador']);
    const t = (await destino.call('GET', `/despachos/${trip}`)).data;
    assert.equal(t.preparador, 'Bodeguera Á');
    assert.deepEqual(t.paradas.map((x) => x.resultado), ['entregada', 'no_entregada']);
    assert.equal(t.paradas[1].motivo_no_entrega, 'Local cerrado');
  } finally { origen.cerrar(); destino.cerrar(); }
});

test('restaurar reemplaza lo que había y rechaza archivos que no son respaldos sin tocar nada', async () => {
  const sis = await iniciar();
  try {
    await poblar(sis.call);
    const antes = (await sis.call('GET', '/clientes')).data;
    assert.equal(antes.length, 2);

    for (const malo of [bytesDe('esto no es json'), bytesDe({ hola: 'mundo' }), bytesDe('[1,2,3]')]) {
      const r = await sis.subir('/respaldo/restaurar', malo);
      assert.equal(r.status, 400, JSON.stringify(r.data));
      assert.equal(r.data.error.code, 'respaldo_invalido');
    }
    assert.deepEqual((await sis.call('GET', '/clientes')).data, antes, 'un archivo inválido no cambia nada');

    // Un respaldo a medias que falla a mitad de camino revierte todo.
    const roto = { clients: [{ id: 1, nombre: 'Solo uno' }], trips: [{ id: 5, vehicle_id: 999, fecha: '2026-01-01' }] };
    const r2 = await sis.subir('/respaldo/restaurar', bytesDe(roto));
    assert.notEqual(r2.status, 200, 'una relación inexistente (vehículo 999) debe fallar');
    assert.deepEqual((await sis.call('GET', '/clientes')).data, antes, 'tras el fallo siguen los datos anteriores');

    // Un respaldo válido y pequeño reemplaza todo lo anterior.
    const chico = { clients: [{ id: 1, nombre: 'Único cliente', comuna: 'Arica' }] };
    const ok = await sis.subir('/respaldo/restaurar', bytesDe(chico));
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    const ahora = (await sis.call('GET', '/clientes')).data;
    assert.deepEqual(ahora.map((c) => c.nombre), ['Único cliente']);
    assert.equal((await sis.call('GET', '/despachos')).data.length, 0);
  } finally { sis.cerrar(); }
});
