import test from 'node:test';
import assert from 'node:assert/strict';
import { crearFakeGoogle } from './fake-google.js';
import { iniciar } from './helpers.js';

test('el sistema parte con la flota real de BHUMI y sin datos inventados', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { data: vehs } = await call('GET', '/vehiculos');
    assert.equal(vehs.length, 2);
    assert.deepEqual(vehs.map((v) => `${v.marca} ${v.modelo} ${v.motor} ${v.combustible}`), ['Chevrolet N400 1.5 Bencina', 'KYC X5 1.5 Bencina']);
    assert.equal(vehs[0].rendimiento_km_l, null);
    assert.equal(vehs[0].costo_km.calculable, false);
    const { data: meta } = await call('GET', '/meta');
    assert.equal(meta.regiones.length, 16);
    const { data: s } = await call('GET', '/settings');
    assert.equal(s.deposito_direccion, 'Poeta Pedro Prado 1536');
    assert.equal(s.deposito_comuna, 'Quinta Normal');
    const { data: setup } = await call('GET', '/setup');
    assert.equal(setup.completo, false);
    assert.ok(setup.items.find((i) => i.id === 'google').estado === 'falta');
    const { data: d } = await call('GET', '/panel');
    assert.equal(d.resumen.despachos, 0);
    assert.equal(d.resumen.costo_total, null, 'sin despachos no se inventa un costo');
    assert.equal(d.rutas_costosas.despachos.length, 0);
    assert.equal(d.ahorro_potencial.total, null, 'sin datos no hay ahorro que mostrar');
    const { data: f } = await call('GET', '/flota');
    assert.equal(f.vehiculos.length, 2);
    assert.equal(f.vehiculos[0].mantencion.estado, 'sin_datos');
    const { data: z } = await call('GET', '/zonas/mapa');
    assert.equal(z.clientes.length, 0);
  } finally { cerrar(); }
});

test('sin API key de Google se explica qué falta, no se inventan distancias', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const c = await call('POST', '/clientes', { nombre: 'Cliente A', direccion: 'Av. Apoquindo 4500', comuna: 'Las Condes', lat: -33.41, lng: -70.57 });
    assert.equal(c.status, 201);
    const r = await call('POST', '/plan', { cliente_ids: [c.data.id], vehicle_ids: [1] });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'sin_clave');
    const g = await call('POST', '/geocodificar', { direccion: 'Av. Apoquindo 4500' });
    assert.equal(g.data.error.code, 'sin_clave');
  } finally { cerrar(); }
});

test('flujo completo: configurar, geolocalizar, planificar A/B/C/D, guardar, completar y analizar', async () => {
  const { call, fake, cerrar } = await iniciar();
  try {
    // Configuración que ingresa el usuario
    assert.equal((await call('PUT', '/settings', { google_api_key: 'CLAVE_DE_PRUEBA', costo_hora_conductor: 4000, tiempo_servicio_min: 10 })).status, 200);
    assert.equal((await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' })).status, 201);
    await call('PUT', '/vehiculos/1', { rendimiento_km_l: 10, capacidad_kg: 800, costo_km_neumaticos: 20, costo_km_mantencion: 30, costo_km_depreciacion: 25 });
    await call('PUT', '/vehiculos/2', { rendimiento_km_l: 14, capacidad_kg: 400, costo_km_neumaticos: 18, costo_km_mantencion: 25, costo_km_depreciacion: 20 });
    const { data: prod } = await call('POST', '/productos', { nombre: 'Saco 25 kg', sku: 'S25', peso_kg: 25 });
    assert.ok(prod.id);
    const { data: cond } = await call('POST', '/personal', { nombre: 'Conductor de prueba', costo_hora: 4000 });
    const { data: bodeguero } = await call('POST', '/personal', { nombre: 'Bodeguero de prueba', rol: 'preparador' });
    assert.equal((await call('POST', '/personal', { nombre: 'X', rol: 'jefe' })).status, 400, 'rol no válido');

    // Clientes por dirección: se geolocalizan con Google
    const nombres = [
      ['Las Condes', 'Av. Apoquindo 4500'], ['Providencia', 'Av. Providencia 1234'], ['Maipú', 'Av. Maipú 500'],
      ['La Florida', 'Av. Vicuña Mackenna 6000'], ['San Joaquín', 'Av. Departamental 100'],
    ];
    const ids = [];
    for (const [comuna, dir] of nombres) {
      const r = await call('POST', '/clientes', { nombre: `Cliente ${comuna}`, direccion: dir, comuna, geolocalizar: true });
      assert.equal(r.status, 201);
      assert.ok(r.data.lat != null, `${comuna} sin coordenadas: ${r.data.aviso}`);
      assert.equal(r.data.region, 'Metropolitana de Santiago');
      ids.push(r.data.id);
    }
    // Una dirección que Google no encuentra queda sin ubicación y avisa
    const mala = await call('POST', '/clientes', { nombre: 'Cliente perdido', direccion: 'Calle inexistente 9999', comuna: 'Maipú', geolocalizar: true });
    assert.equal(mala.status, 201);
    assert.equal(mala.data.lat, null);
    assert.match(mala.data.aviso, /no encontró/);

    // Entregas con productos (3 sacos = 75 kg c/u => 75 kg por entrega)
    const entregas = [];
    for (const id of ids) {
      const r = await call('POST', '/entregas', { client_id: id, fecha: '2026-11-24', items: [{ product_id: prod.id, cantidad: 3 }] });
      assert.equal(r.status, 201);
      assert.equal(r.data.peso_kg, 75);
      entregas.push(r.data.id);
    }

    // Plan: se calcula A, B, C, D para ambos vehículos
    const p = await call('POST', '/plan', { entrega_ids: entregas, vehicle_ids: [1, 2], fecha: '2026-11-24', hora: '08:00', retorna: true, extras: { peajes: 3000 } });
    assert.equal(p.status, 200, JSON.stringify(p.data));
    assert.equal(p.data.vehiculos.length, 2);
    assert.equal(p.data.deposito.lat != null, true, 'la base se geolocaliza sola');
    const v1 = p.data.vehiculos[0];
    assert.equal(v1.calculable, true);
    assert.equal(v1.alternativas.length, 4);
    for (const a of v1.alternativas) {
      assert.equal(a.orden.length, 5);
      assert.equal(new Set(a.orden).size, 5);
      assert.ok(a.costos.total > 0);
      // el total siempre es la suma de sus partes
      assert.equal(a.costos.total, a.costos.combustible + a.costos.desgaste + a.costos.otros);
      // el costo asignado a clientes suma el total
      assert.equal(a.paradas.reduce((x, s) => x + s.costo_asignado, 0), a.costos.total);
    }
    const A = v1.alternativas.find((a) => a.codigo === 'A');
    const B = v1.alternativas.find((a) => a.codigo === 'B');
    const C = v1.alternativas.find((a) => a.codigo === 'C');
    const todos = v1.alternativas;
    assert.ok(todos.every((a) => A.km <= a.km + 1e-9), 'A debe tener la menor distancia');
    assert.ok(todos.every((a) => B.minConduccion <= a.minConduccion + 1e-9), 'B debe tener el menor tiempo');
    assert.ok(todos.every((a) => C.costos.total <= a.costos.total + 1), 'C debe tener el menor costo (o empatar)');
    assert.ok(v1.baseline.costos.total >= C.costos.total - 1, 'ninguna alternativa es peor que la mejor');
    const rec = v1.alternativas.find((a) => a.codigo === v1.recomendada);
    assert.ok(todos.every((a) => rec.costos.total <= a.costos.total), 'la recomendada es la más económica');
    const mejorRes = p.data.vehiculos.find((v) => v.vehiculo.id === p.data.mejor_vehiculo_id);
    assert.ok(mejorRes.alternativas.find((a) => a.codigo === mejorRes.recomendada).polyline, 'el vehículo recomendado trae el trazado para el mapa');
    // Peaje: 3000 incluido en otros
    assert.ok(A.costos.otros >= 3000);
    // Fórmula de combustible verificada a mano para la ruta A: litros = km / rendimiento(carga); costo = litros x 1300
    assert.ok(Math.abs(A.costos.combustible - (A.costos.litros * 1300)) < 1);
    assert.ok(A.costos.litros * 10 >= A.km - 1e-6, 'con carga el rendimiento es menor que 10 km/L, así que gasta más de km/10');
    // El KYC (capacidad 400) carga 375 kg: cabe. Se elige el más barato entre los dos
    assert.equal(p.data.vehiculos[1].capacidad.excede, false);
    const baratos = p.data.vehiculos.map((v) => v.alternativas.find((a) => a.codigo === v.recomendada).costos.total);
    assert.equal(p.data.mejor_vehiculo_id, p.data.vehiculos[baratos[0] <= baratos[1] ? 0 : 1].vehiculo.id);

    // Segunda consulta usa la caché: no vuelve a pedir la matriz a Google
    const matricesAntes = fake.llamadas.matrix;
    await call('POST', '/plan', { entrega_ids: entregas, vehicle_ids: [1], fecha: '2026-11-24', hora: '08:00', trazar: false });
    assert.equal(fake.llamadas.matrix, matricesAntes, 'la matriz se reutiliza desde la caché');

    // Guardar el despacho con la alternativa recomendada
    const ordenIds = rec.orden.map((i) => entregas[i - 1]);
    const g = await call('POST', '/despachos', { entrega_ids: entregas, orden: ordenIds, alternativa: rec.codigo, vehicle_id: 1, driver_id: cond.id, preparador_id: bodeguero.id, fecha: '2026-11-24', hora: '08:00', extras: { peajes: 3000 } });
    assert.equal(g.status, 201, JSON.stringify(g.data));
    assert.equal(g.data.costos.total, rec.costos.total, 'el servidor recalcula y obtiene el mismo costo');
    const tripId = g.data.trip_id;
    const t = (await call('GET', `/despachos/${tripId}`)).data;
    assert.equal(t.paradas.length, 5);
    assert.equal(t.estado, 'planificado');
    assert.equal(t.preparador, 'Bodeguero de prueba');
    assert.equal(t.seguridad.nivel_max, 'sin_evaluar', 'sin evaluar: no se inventa seguridad');
    assert.equal(t.cubicaje.calculable, false, 'sin medidas de productos no se puede cubicar');

    // Enlaces de Google Maps para el conductor
    const rc = (await call('GET', `/despachos/${tripId}/ruta-conductor`)).data;
    assert.equal(rc.paradas.length, 5);
    assert.ok(rc.enlaces.length >= 1);
    assert.match(rc.enlaces[0].url, /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=/);
    assert.ok(rc.enlaces.every((e) => e.url.length <= 2048));
    const rc3 = (await call('GET', `/despachos/${tripId}/ruta-conductor?max=3`)).data;
    assert.ok(rc3.enlaces.length >= 2, 'con 3 paradas por enlace, 5 paradas necesitan más de un enlace');
    assert.equal((await call('GET', '/despachos/99999/ruta-conductor')).status, 404);
    assert.equal(t.ahorro, Math.max(0, v1.baseline.costos.total - rec.costos.total));
    assert.equal(t.paradas.reduce((x, s) => x + s.costo_asignado, 0), t.costo_total);

    // Una entrega ya despachada no se puede volver a despachar
    const dup = await call('POST', '/despachos', { entrega_ids: [entregas[0]], vehicle_id: 1, fecha: '2026-11-25' });
    assert.equal(dup.status, 400);

    // Completar: una entrega no se realizó y se reprograma
    const noEntregada = entregas[0];
    const comp = await call('POST', `/despachos/${tripId}/estado`, { estado: 'completado', no_entregadas: [noEntregada], nueva_fecha: '2026-11-26', motivo: 'Cliente cerrado' });
    assert.equal(comp.status, 200);
    const lista = (await call('GET', '/entregas?estado=reprogramada')).data;
    assert.equal(lista.length, 1);
    assert.equal(lista[0].fecha, '2026-11-26');
    assert.equal((await call('GET', '/entregas?estado=realizada')).data.length, 4);
    assert.equal((await call('POST', `/despachos/${tripId}/estado`, { estado: 'cancelado' })).status, 400, 'no se cancela uno ya completado');

    // Panel de análisis y control de costos
    const mes = '2026-11';
    const panel = (await call('GET', `/panel?mes=${mes}`)).data;
    assert.equal(panel.resumen.despachos, 1);
    assert.equal(panel.resumen.costo_total, t.costo_total);
    assert.equal(panel.rutas_costosas.despachos[0].trip_id, tripId);
    assert.equal(panel.costo_cliente_sector.clientes.length, 5);
    assert.equal(panel.costo_cliente_sector.clientes.reduce((a, c) => a + c.costo_total, 0), t.costo_total);
    assert.equal(panel.vehiculos.find((v) => v.vehicle_id === 1).km_despachos, t.distancia_km);
    assert.equal(panel.ahorro_potencial.completo, false, 'faltan datos de cubicaje y procesos: no se muestra como total cerrado');
    const cc = (await call('GET', `/control-costos?mes=${mes}`)).data;
    assert.equal(cc.despachos, 1);
    assert.equal(cc.modelado.combustible, t.costo_combustible);
    assert.equal(cc.total_con_conductor.real, null, 'sin cargas de combustible con monto no hay costo real total');
    assert.equal(cc.comparacion.find((c) => c.concepto === 'Combustible').real, null);
    // Gastos reales: validaciones y efecto en el control de costos
    assert.equal((await call('POST', '/gastos', { vehicle_id: 1, fecha: '2026-11-10', categoria: 'inventada', monto: 5000 })).status, 400);
    assert.equal((await call('POST', '/gastos', { vehicle_id: 1, fecha: '2026-11-10', categoria: 'seguro', monto: 0 })).status, 400);
    const gasto = await call('POST', '/gastos', { vehicle_id: 1, fecha: '2026-11-10', categoria: 'mantencion_preventiva', monto: 80000, km_odometro: 51000 });
    assert.equal(gasto.status, 201);
    assert.equal((await call('GET', '/vehiculos/1')).data.km_actual, 51000, 'el odómetro del gasto actualiza el del vehículo');
    const cc2 = (await call('GET', `/control-costos?mes=${mes}`)).data;
    assert.equal(cc2.real.mantencion_y_desgaste, 80000);
    assert.equal((await call('DELETE', `/gastos/${gasto.data.id}`)).status, 200);

    // Kilometraje semanal
    const km = await call('PUT', '/km-semanal', { vehicle_id: 1, fecha: '2026-11-12', km: 310, odometro: 51300 });
    assert.equal(km.data.semana_inicio, '2026-11-09', 'se normaliza al lunes de esa semana');
    await call('PUT', '/km-semanal', { vehicle_id: 1, fecha: '2026-11-11', km: 330 });
    const kms = (await call('GET', '/km-semanal?vehicle_id=1')).data;
    assert.equal(kms.length, 1, 'una semana por vehículo: se actualiza, no se duplica');
    assert.equal(kms[0].km, 330);
    assert.equal((await call('PUT', '/km-semanal', { vehicle_id: 1, fecha: '2026-11-11', km: -5 })).status, 400);

    // Indicadores del personal: el cumplimiento sale de lo entregado vs. lo programado
    const kpi = (await call('GET', `/kpi/personal?desde=2026-11-01&hasta=2026-11-30`)).data;
    assert.equal(kpi.conductores.length, 1);
    assert.equal(kpi.conductores[0].nombre, 'Conductor de prueba');
    const trip = (await call('GET', `/despachos/${tripId}`)).data;
    assert.equal(trip.paradas.length, 5);

    // Clientes y zonas
    const conc = (await call('GET', `/zonas/concentracion?mes=${mes}&por=comuna`)).data;
    assert.equal(conc.grupos.reduce((a, g) => a + g.entregas, 0), 4, 'solo cuentan las entregas realizadas');
    const mapa = (await call('GET', '/zonas/mapa')).data;
    assert.equal(mapa.clientes.length, 5, 'el cliente sin ubicación no aparece en el mapa');
    assert.equal(mapa.sin_ubicacion, 1);

    // Reportes
    for (const r of ['panel', 'costos', 'kpi', 'flota', 'zonas']) {
      const x = await call('GET', `/reportes/${r}.xlsx?mes=${mes}`);
      assert.equal(x.status, 200, r);
      assert.equal(x.data.subarray(0, 2).toString(), 'PK', `${r}.xlsx es un Excel`);
      const pdf = await call('GET', `/reportes/${r}.pdf?mes=${mes}`);
      assert.equal(pdf.status, 200, r);
      assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF', `${r}.pdf es un PDF`);
    }
    const hoja = await call('GET', `/reportes/despacho/${tripId}.pdf`);
    assert.equal(hoja.data.subarray(0, 4).toString(), '%PDF');
    assert.equal((await call('GET', '/reportes/despacho/99999.pdf')).status, 404);

    // Respaldo
    assert.equal((await call('GET', '/respaldo.json')).data.clients.length, 6);
    assert.equal((await call('GET', '/respaldo.json')).data.settings.some((s) => s.key === 'google_api_key'), false, 'el respaldo no incluye la API key');
  } finally { cerrar(); }
});

test('faltan datos: el plan lo avisa y no permite guardar un despacho sin costo calculable', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await call('PUT', '/settings', { google_api_key: 'K' });
    const c1 = (await call('POST', '/clientes', { nombre: 'A', lat: -33.41, lng: -70.57 })).data;
    const c2 = (await call('POST', '/clientes', { nombre: 'B', lat: -33.51, lng: -70.75 })).data;
    const e1 = (await call('POST', '/entregas', { client_id: c1.id, fecha: '2026-11-24' })).data;
    const e2 = (await call('POST', '/entregas', { client_id: c2.id, fecha: '2026-11-24' })).data;
    const p = await call('POST', '/plan', { entrega_ids: [e1.id, e2.id], vehicle_ids: [1], fecha: '2026-11-24' });
    assert.equal(p.status, 200);
    const v = p.data.vehiculos[0];
    assert.equal(v.calculable, false);
    assert.ok(v.faltantes.some((f) => f.includes('Rendimiento')));
    assert.ok(v.faltantes.some((f) => f.includes('Precio')));
    assert.equal(v.alternativas.find((a) => a.codigo === 'C').disponible, false, 'sin costos no hay alternativa por costo');
    assert.ok(v.alternativas.find((a) => a.codigo === 'A').km > 0, 'distancia sí se calcula');
    const g = await call('POST', '/despachos', { entrega_ids: [e1.id, e2.id], vehicle_id: 1, fecha: '2026-11-24' });
    assert.equal(g.status, 422);
    assert.equal(g.data.error.code, 'datos_faltantes');
  } finally { cerrar(); }
});

test('capacidad: avisa y bloquea cuando la carga no cabe', async () => {
  const { call, cerrar } = await iniciar();
  try {
    await call('PUT', '/settings', { google_api_key: 'K' });
    await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' });
    await call('PUT', '/vehiculos/2', { rendimiento_km_l: 12, capacidad_kg: 100 });
    const prod = (await call('POST', '/productos', { nombre: 'Caja', peso_kg: 60 })).data;
    const c1 = (await call('POST', '/clientes', { nombre: 'A', lat: -33.41, lng: -70.57 })).data;
    const c2 = (await call('POST', '/clientes', { nombre: 'B', lat: -33.51, lng: -70.75 })).data;
    const e1 = (await call('POST', '/entregas', { client_id: c1.id, items: [{ product_id: prod.id, cantidad: 1 }] })).data;
    const e2 = (await call('POST', '/entregas', { client_id: c2.id, items: [{ product_id: prod.id, cantidad: 1 }] })).data;
    const p = (await call('POST', '/plan', { entrega_ids: [e1.id, e2.id], vehicle_ids: [2], fecha: '2026-11-24', trazar: false })).data;
    assert.equal(p.vehiculos[0].capacidad.excede, true);
    assert.ok(p.advertencias.some((a) => a.includes('supera la capacidad')));
    const g = await call('POST', '/despachos', { entrega_ids: [e1.id, e2.id], vehicle_id: 2, fecha: '2026-11-24' });
    assert.equal(g.status, 422);
    assert.equal(g.data.error.code, 'capacidad');
    const div = (await call('POST', '/plan/dividir', { entrega_ids: [e1.id, e2.id], vehicle_id: 2 })).data;
    assert.equal(div.grupos.length, 2);
  } finally { cerrar(); }
});

test('clientes: búsqueda, importación desde Excel y validaciones', async () => {
  const { call, subir, cerrar } = await iniciar();
  try {
    assert.equal((await call('POST', '/clientes', { nombre: '' })).status, 400);
    assert.equal((await call('POST', '/clientes', { nombre: 'X', lat: 10, lng: 10 })).status, 400, 'coordenadas fuera de Chile');
    const r = await call('POST', '/clientes', { nombre: 'Ferretería Ñandú', empresa: 'Ñandú SpA', comuna: 'nunoa', telefono: '+56 9 1111 2222' });
    assert.equal(r.data.comuna, 'Ñuñoa', 'normaliza el nombre de la comuna');
    assert.equal(r.data.region, 'Metropolitana de Santiago');
    await call('POST', '/clientes', { nombre: 'Panadería Sur', comuna: 'Punta Arenas', lat: -53.16, lng: -70.91 });
    assert.equal((await call('GET', '/clientes?q=nandu')).data.length, 1, 'busca sin importar tildes');
    assert.equal((await call('GET', '/clientes?region=Magallanes y de la Antártica Chilena')).data.length, 1);
    assert.equal((await call('GET', '/clientes?lat=-53.1&lng=-70.9&radio_km=20')).data.length, 1, 'búsqueda por ubicación');

    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clientes');
    ws.addRow(['nombre', 'comuna', 'direccion', 'lat', 'lng']);
    ws.addRow(['Importado 1', 'Arica', 'Calle 1', '-18,4783', '-70,3126']);
    ws.addRow(['Importado 2', 'Puerto Montt', 'Calle 2']);
    ws.addRow(['Malo', 'Arica', 'x', '99', '-70']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const imp = await subir('/clientes/importar', buf);
    const out = imp.data;
    assert.equal(imp.status, 200, JSON.stringify(out));
    assert.equal(out.importados, 2);
    assert.equal(out.errores.length, 1);
    assert.equal(out.errores[0].nombre, 'Malo');
    const todos = (await call('GET', '/clientes')).data;
    const imp1 = todos.find((c) => c.nombre === 'Importado 1');
    assert.equal(imp1.lat, -18.4783, 'acepta coma decimal');
    assert.equal(imp1.region, 'Arica y Parinacota');
    assert.equal(todos.find((c) => c.nombre === 'Importado 2').lat, null);
    assert.equal((await call('GET', '/clientes?sin_coordenadas=1')).data.length, 2);
    const plantilla = await call('GET', '/clientes/plantilla.xlsx');
    assert.equal(plantilla.data.subarray(0, 2).toString(), 'PK');
  } finally { cerrar(); }
});

test('al guardar la API key se geolocaliza solo el punto de partida', async () => {
  const { call, cerrar } = await iniciar();
  try {
    const { data: antes } = await call('GET', '/settings');
    assert.ok(antes.deposito_lat === '' || antes.deposito_lat == null);
    const { status, data } = await call('PUT', '/settings', { google_api_key: 'CLAVE_DE_PRUEBA' });
    assert.equal(status, 200);
    assert.ok(data.deposito_lat !== '' && Number.isFinite(Number(data.deposito_lat)));
    assert.ok(data.deposito_lng !== '' && Number.isFinite(Number(data.deposito_lng)));
    const { data: setup } = await call('GET', '/setup');
    assert.equal(setup.items.find((i) => i.id === 'deposito').estado, 'ok');
  } finally { cerrar(); }
});

test('modo demostración: /meta lo informa y la polilínea simulada recorre los puntos reales', async () => {
  for (const [demo, esperado] of [[true, true], [false, false]]) {
    const { call, cerrar } = await iniciar({ demo });
    try {
      assert.equal((await call('GET', '/meta')).data.demo, esperado);
    } finally { cerrar(); }
  }
  const { codificarPolilinea } = await import('./fake-google.js');
  assert.equal(codificarPolilinea([{ lat: 38.5, lng: -120.2 }, { lat: 40.7, lng: -120.95 }, { lat: 43.252, lng: -126.453 }]), '_p~iF~ps|U_ulLnnqC_mqNvxq`@');
});
