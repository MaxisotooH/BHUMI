// Pruebas de las funciones del proyecto vistas desde la API: cubicaje al despachar, zonas y seguridad, ruta del conductor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.js';

const ymd = (atras) => { const d = new Date(Date.now() - atras * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function base(call) {
  await call('PUT', '/settings', { google_api_key: 'CLAVE_DE_PRUEBA', costo_hora_conductor: 4000, tiempo_servicio_min: 10 });
  await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' });
  await call('PUT', '/vehiculos/1', { rendimiento_km_l: 10, capacidad_kg: 2000, costo_km_neumaticos: 20, costo_km_mantencion: 30, costo_km_depreciacion: 25, carga_largo_cm: 300, carga_ancho_cm: 150, carga_alto_cm: 150 });
  await call('PUT', '/vehiculos/2', { rendimiento_km_l: 14, capacidad_kg: 1000, costo_km_neumaticos: 18, costo_km_mantencion: 25, costo_km_depreciacion: 20, carga_largo_cm: 100, carga_ancho_cm: 100, carga_alto_cm: 100 });
}

test('cubicaje: calcula, compara vehículos y bloquea despachos que no caben', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await base(call);
    const caja = (await call('POST', '/productos', { nombre: 'Caja 50', peso_kg: 10, largo_cm: 50, ancho_cm: 50, alto_cm: 50 })).data;
    const sinMedidas = (await call('POST', '/productos', { nombre: 'Sin medidas', peso_kg: 3 })).data;

    // Cálculo directo: el vehículo 2 (1 m³) recibe como máximo 8 cajas de 0,125 m³
    const ok = await call('POST', '/cubicaje/calcular', { vehicle_id: 2, items: [{ product_id: caja.id, cantidad: 8 }] });
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
    assert.equal(ok.data.cabe, true);
    assert.equal(ok.data.unidades_colocadas, 8);
    const no = (await call('POST', '/cubicaje/calcular', { vehicle_id: 2, items: [{ product_id: caja.id, cantidad: 9 }] })).data;
    assert.equal(no.cabe, false);
    assert.equal(no.unidades_colocadas, 8);
    // Sin medidas no se inventan: se dice qué falta
    const falta = await call('POST', '/cubicaje/calcular', { vehicle_id: 1, items: [{ product_id: sinMedidas.id, cantidad: 2 }] });
    assert.equal(falta.status, 422);
    assert.equal(falta.data.error.code, 'datos_faltantes');
    assert.equal((await call('POST', '/cubicaje/calcular', { vehicle_id: 1, items: [] })).status, 400);
    assert.equal((await call('POST', '/cubicaje/calcular', { vehicle_id: 1, items: [{ product_id: caja.id, cantidad: 0 }] })).status, 400);

    const comp = (await call('POST', '/cubicaje/comparar', { items: [{ product_id: caja.id, cantidad: 20 }] })).data;
    assert.deepEqual(comp.map((v) => [v.vehicle_id, v.cabe]), [[1, true], [2, false]]);
    const cap = (await call('GET', '/cubicaje/capacidad?vehicle_id=2')).data;
    assert.equal(cap.productos.find((p) => p.nombre === 'Caja 50').maximo, 8);
    assert.equal(cap.productos.find((p) => p.nombre === 'Sin medidas').calculable, false);

    // Al despachar: 12 cajas no caben en el vehículo 2, aunque el peso (120 kg) sí lo permite
    const c1 = (await call('POST', '/clientes', { nombre: 'A', comuna: 'Santiago', lat: -33.45, lng: -70.66 })).data;
    const c2 = (await call('POST', '/clientes', { nombre: 'B', comuna: 'Maipú', lat: -33.51, lng: -70.75 })).data;
    const e1 = (await call('POST', '/entregas', { client_id: c1.id, fecha: '2026-11-24', items: [{ product_id: caja.id, cantidad: 6 }] })).data;
    const e2 = (await call('POST', '/entregas', { client_id: c2.id, fecha: '2026-11-24', items: [{ product_id: caja.id, cantidad: 6 }] })).data;
    const plan = (await call('POST', '/plan', { entrega_ids: [e1.id, e2.id], vehicle_ids: [1, 2], fecha: '2026-11-24', trazar: false })).data;
    assert.deepEqual(plan.cubicaje.map((v) => [v.vehicle_id, v.cabe]), [[1, true], [2, false]], 'el plan informa en cuál vehículo cabe');
    const g2 = await call('POST', '/despachos', { entrega_ids: [e1.id, e2.id], vehicle_id: 2, fecha: '2026-11-24' });
    assert.equal(g2.status, 422);
    assert.equal(g2.data.error.code, 'capacidad');
    assert.match(g2.data.error.mensaje, /no cabe/);
    const g1 = await call('POST', '/despachos', { entrega_ids: [e1.id, e2.id], vehicle_id: 1, fecha: '2026-11-24' });
    assert.equal(g1.status, 201, JSON.stringify(g1.data));
    const t = (await call('GET', `/despachos/${g1.data.trip_id}`)).data;
    assert.equal(t.cubicaje.cabe, true);
    assert.ok(t.cubicaje.ocupacion_volumen_pct > 0);
  } finally { cerrar(); }
});

test('clientes y zonas: seguridad evaluada por el usuario, incidentes y concentración de entregas', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await base(call);
    // Sectores: el usuario evalúa y dice de dónde sale la evaluación
    const mal = await call('PUT', '/zonas/sectores', { comuna: 'nunoa', seguridad: 'alto_riesgo' });
    assert.equal(mal.status, 400, 'una evaluación de seguridad exige indicar su fuente');
    assert.equal((await call('PUT', '/zonas/sectores', { comuna: 'Maipú', seguridad: 'extrema', fuente: 'x' })).status, 400);
    const s = await call('PUT', '/zonas/sectores', { comuna: 'nunoa', seguridad: 'precaucion', fuente: 'Conductores', zona: 'Oriente', horario_recomendado: 'Antes de las 18:00' });
    assert.equal(s.status, 200, JSON.stringify(s.data));
    assert.equal(s.data.comuna, 'Ñuñoa', 'normaliza el nombre de la comuna');
    await call('PUT', '/zonas/sectores', { comuna: 'Ñuñoa', seguridad: 'alto_riesgo', fuente: 'Conductores', zona: 'Oriente' });
    assert.equal((await call('GET', '/zonas/sectores')).data.filter((x) => x.comuna === 'Ñuñoa').length, 1, 'se actualiza, no se duplica');

    const cn = (await call('POST', '/clientes', { nombre: 'Cliente Ñuñoa', comuna: 'Ñuñoa', lat: -33.46, lng: -70.60 })).data;
    const cs = (await call('POST', '/clientes', { nombre: 'Cliente Santiago', comuna: 'Santiago', lat: -33.45, lng: -70.66 })).data;
    const segura = (await call('POST', '/zonas/seguridad-ruta', { cliente_ids: [cn.id, cs.id] })).data;
    assert.equal(segura.nivel_max, 'alto_riesgo');
    assert.equal(segura.alertas.length, 1);
    assert.deepEqual(segura.alertas[0].paradas, ['Cliente Ñuñoa']);
    assert.deepEqual(segura.sin_evaluar, ['Santiago'], 'Santiago no se evaluó: se dice, no se asume que es segura');

    // Incidentes
    assert.equal((await call('POST', '/zonas/incidentes', { fecha: ymd(5), tipo: 'inventado', comuna: 'Santiago' })).status, 400);
    assert.equal((await call('POST', '/zonas/incidentes', { tipo: 'robo', comuna: 'Santiago' })).status, 400, 'falta la fecha');
    assert.equal((await call('POST', '/zonas/incidentes', { fecha: ymd(5), tipo: 'robo' })).status, 400, 'falta la comuna');
    const inc = await call('POST', '/zonas/incidentes', { fecha: ymd(5), tipo: 'robo', client_id: cs.id, descripcion: 'Robo en descarga' });
    assert.equal(inc.status, 201);
    const lista = (await call('GET', '/zonas/incidentes')).data;
    assert.equal(lista[0].comuna, 'Santiago', 'toma la comuna del cliente');
    assert.equal(lista[0].tipo_nombre, 'Robo o hurto');
    const tras = (await call('POST', '/zonas/seguridad-ruta', { cliente_ids: [cs.id] })).data;
    assert.equal(tras.alertas[0].incidentes_90d, 1, 'un incidente reciente genera alerta aunque el sector no esté evaluado');

    // Concentración de entregas y mapa
    const prod = (await call('POST', '/productos', { nombre: 'Saco', peso_kg: 5 })).data;
    const e = [];
    for (const c of [cn, cn, cs]) e.push((await call('POST', '/entregas', { client_id: c.id, fecha: ymd(2), items: [{ product_id: prod.id, cantidad: 1 }] })).data.id);
    const g = await call('POST', '/despachos', { entrega_ids: e, orden: e, alternativa: 'manual', vehicle_id: 1, fecha: ymd(2) });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    await call('POST', `/despachos/${g.data.trip_id}/estado`, { estado: 'completado' });
    const conc = (await call('GET', '/zonas/concentracion?por=comuna')).data;
    assert.equal(conc.grupos[0].clave, 'Ñuñoa');
    assert.equal(conc.grupos[0].entregas, 2);
    assert.equal(conc.grupos.reduce((a, x) => a + x.entregas, 0), 3);
    const porZona = (await call('GET', '/zonas/concentracion?por=zona')).data;
    assert.ok(porZona.grupos.some((x) => x.clave === 'Oriente'));
    const mapa = (await call('GET', '/zonas/mapa')).data;
    assert.equal(mapa.clientes.find((c) => c.id === cn.id).entregas, 2);
    assert.equal(mapa.clientes.find((c) => c.id === cn.id).seguridad, 'alto_riesgo');
    assert.equal(mapa.clientes.find((c) => c.id === cs.id).seguridad, 'sin_evaluar');

    assert.equal((await call('DELETE', `/zonas/incidentes/${inc.data.id}`)).status, 200);
    assert.equal((await call('GET', '/zonas/incidentes')).data.length, 0);
  } finally { cerrar(); }
});

test('ruta del conductor: enlaces de Google Maps en orden, partida desde la base y texto para WhatsApp', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await base(call);
    const cond = (await call('POST', '/personal', { nombre: 'Conductor Z', telefono: '9 8765 4321' })).data;
    const pts = [[-33.41, -70.57], [-33.45, -70.66], [-33.51, -70.75], [-33.52, -70.60], [-33.43, -70.70]];
    const cl = [];
    for (const [i, [lat, lng]] of pts.entries()) cl.push((await call('POST', '/clientes', { nombre: `Cliente ${i + 1}`, direccion: `Calle ${i + 1}`, comuna: 'Santiago', telefono: '+56 9 1111 000' + i, lat, lng })).data);
    const e = [];
    for (const c of cl) e.push((await call('POST', '/entregas', { client_id: c.id, fecha: '2026-11-24', ventana_hasta: '12:00' })).data.id);
    await call('PUT', '/zonas/sectores', { comuna: 'Santiago', seguridad: 'precaucion', fuente: 'Conductores', horario_recomendado: 'Antes de las 18:00' });
    const g = await call('POST', '/despachos', { entrega_ids: e, orden: e, alternativa: 'manual', vehicle_id: 1, driver_id: cond.id, fecha: '2026-11-24', hora: '08:00', retorna: true });
    assert.equal(g.status, 201, JSON.stringify(g.data));

    const r9 = (await call('GET', `/despachos/${g.data.trip_id}/ruta-conductor`)).data;
    assert.equal(r9.paradas.length, 5);
    assert.equal(r9.enlaces.length, 1, '5 paradas + regreso caben en un solo enlace');
    const u = new URL(r9.enlaces[0].url);
    const dep = (await call('GET', '/settings')).data;
    assert.equal(u.searchParams.get('origin'), `${Number(dep.deposito_lat).toFixed(6)},${Number(dep.deposito_lng).toFixed(6)}`, 'parte desde la base');
    assert.equal(u.searchParams.get('destination'), u.searchParams.get('origin'), 'vuelve a la base');
    const way = u.searchParams.get('waypoints').split('|');
    assert.equal(way.length, 5);
    assert.equal(way[0], '-33.410000,-70.570000', 'sigue el orden del despacho');
    assert.equal(u.searchParams.get('travelmode'), 'driving');
    assert.equal(r9.whatsapp_numero, '56987654321');
    assert.match(r9.whatsapp_url, /^https:\/\/wa\.me\/56987654321\?text=/);
    assert.match(r9.texto, /Precauciones/);
    assert.match(r9.texto, /Antes de las 18:00/);
    assert.match(r9.texto, /1\. \*Cliente 1\*/);
    assert.match(r9.texto, /Horario: hasta 12:00/);
    assert.ok(r9.texto.includes(r9.enlaces[0].url));

    // Máximo 3 paradas por enlace (navegador del celular): se encadenan, cada tramo parte donde terminó el anterior
    const r3 = (await call('GET', `/despachos/${g.data.trip_id}/ruta-conductor?max=3`)).data;
    assert.ok(r3.enlaces.length >= 2);
    for (let i = 1; i < r3.enlaces.length; i++) {
      assert.equal(new URL(r3.enlaces[i].url).searchParams.get('origin'), new URL(r3.enlaces[i - 1].url).searchParams.get('destination'));
    }
    for (const x of r3.enlaces) assert.ok((new URL(x.url).searchParams.get('waypoints') ?? '').split('|').filter(Boolean).length <= 3);
    const todas = r3.enlaces.flatMap((x) => x.paradas.map((p) => p.nombre));
    assert.deepEqual(todas, ['Cliente 1', 'Cliente 2', 'Cliente 3', 'Cliente 4', 'Cliente 5'], 'ninguna parada se pierde ni se repite');
  } finally { cerrar(); }
});

test('gastos reales: se editan y el odómetro solo sube', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await base(call);
    const g = (await call('POST', '/gastos', { vehicle_id: 2, fecha: '2026-11-03', categoria: 'neumaticos', monto: 120000, km_odometro: 20000 })).data;
    assert.equal((await call('GET', '/vehiculos/2')).data.km_actual, 20000);
    await call('POST', '/gastos', { vehicle_id: 2, fecha: '2026-11-04', categoria: 'lavado', monto: 8000, km_odometro: 15000 });
    assert.equal((await call('GET', '/vehiculos/2')).data.km_actual, 20000, 'un odómetro menor no lo retrocede');
    const up = await call('PUT', `/gastos/${g.id}`, { monto: 125000 });
    assert.equal(up.data.monto, 125000);
    assert.equal((await call('PUT', `/gastos/${g.id}`, { monto: -1 })).status, 400);
    assert.equal((await call('POST', '/gastos', { fecha: '2026-11-03', categoria: 'mantencion_preventiva', monto: 5000 })).status, 400, 'la mantención preventiva exige vehículo');
    assert.equal((await call('POST', '/gastos', { categoria: 'seguro', monto: 5000, vehicle_id: 2, fecha: 'ayer' })).status, 400);
    const lista = (await call('GET', '/gastos?mes=2026-11&categoria=neumaticos')).data;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].categoria_nombre.length > 0, true);
  } finally { cerrar(); }
});
