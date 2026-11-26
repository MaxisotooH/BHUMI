// Datos de PRUEBA para el modo demostración. Todo es inventado y se identifica como tal (nombres "de prueba", fuente "Dato de prueba").
// Sirve para ver cada pantalla con contenido: clientes, productos con medidas, personal de conductores y bodega, entregas para mañana,
// historial de despachos con horas y entregas no realizadas, combustible, gastos, kilometraje semanal, sectores e incidentes.
// `call(método, ruta, cuerpo)` llama a la API de BHUMI; sirve con el servidor de pruebas y con la demostración del navegador.
import { DIRECCIONES } from './fake-google.js';

const ymd = (dias) => { const d = new Date(Date.now() + dias * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const hm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(Math.round(min % 60)).padStart(2, '0')}`;

export async function sembrarDemo(call) {
  const manana = ymd(1);
  await call('PUT', '/settings', {
    google_api_key: 'CLAVE_DE_PRUEBA', costo_hora_conductor: 4000, tiempo_servicio_min: 10, jornada_horas: 9, recargo_horas_extra_pct: 50,
    meta_preparacion_min: 30, meta_carga_min: 20, meta_cumplimiento_pct: 95, meta_utilizacion_pct: 70,
  });
  await call('POST', '/combustible/precios', { combustible: 'Bencina', precio: 1300, vigente_desde: '2020-01-01' });

  // Flota: rendimiento, costos, mantención y medidas del compartimiento de carga (largo x ancho x alto, en cm)
  await call('PUT', '/vehiculos/1', {
    rendimiento_km_l: 9.5, capacidad_kg: 1000, valor_neumaticos: 400000, vida_neumaticos_km: 40000, costo_mantencion: 80000, intervalo_mantencion_km: 10000,
    valor_vehiculo: 12000000, valor_residual: 4000000, vida_util_km: 250000, km_actual: 42000, proxima_mantencion_km: 42800,
    carga_largo_cm: 300, carga_ancho_cm: 150, carga_alto_cm: 150,
  });
  await call('PUT', '/vehiculos/2', {
    rendimiento_km_l: 12, capacidad_kg: 450, valor_neumaticos: 280000, vida_neumaticos_km: 40000, costo_mantencion: 60000, intervalo_mantencion_km: 10000,
    valor_vehiculo: 7000000, valor_residual: 2500000, vida_util_km: 200000, km_actual: 18000, proxima_mantencion_km: 28000,
    carga_largo_cm: 180, carga_ancho_cm: 110, carga_alto_cm: 110,
  });

  // Personal: conductores y responsables de bodega
  const c1 = await call('POST', '/personal', { nombre: 'Conductor de prueba 1', costo_hora: 4000, telefono: '+56 9 1111 0001' });
  const c2 = await call('POST', '/personal', { nombre: 'Conductor de prueba 2', costo_hora: 4200, telefono: '+56 9 1111 0002' });
  const b1 = await call('POST', '/personal', { nombre: 'Bodega de prueba 1', rol: 'preparador', costo_hora: 3000 });
  const b2 = await call('POST', '/personal', { nombre: 'Bodega de prueba 2', rol: 'preparador', costo_hora: 3200 });

  // Productos con peso y medidas
  const p1 = await call('POST', '/productos', { nombre: 'Producto de prueba A', peso_kg: 12, largo_cm: 60, ancho_cm: 40, alto_cm: 40, apilable: true });
  const p2 = await call('POST', '/productos', { nombre: 'Producto de prueba B', peso_kg: 5, largo_cm: 40, ancho_cm: 30, alto_cm: 30, apilable: true });

  // Clientes y entregas pendientes para mañana
  const nombres = ['Cliente de prueba 1', 'Cliente de prueba 2', 'Cliente de prueba 3', 'Cliente de prueba 4', 'Cliente de prueba 5', 'Cliente de prueba 6'];
  const dirs = Object.entries(DIRECCIONES).slice(1);
  for (const [i, [dir, d]] of dirs.entries()) {
    const c = await call('POST', '/clientes', { nombre: nombres[i], direccion: dir.split(',')[0], comuna: d.comuna, region: 'Metropolitana de Santiago', lat: d.lat, lng: d.lng, frecuencia_compra: 'semanal', telefono: `+56 9 2222 000${i}` });
    await call('POST', '/entregas', { client_id: c.id, fecha: manana, items: [{ product_id: p1.id, cantidad: 3 + i }, { product_id: p2.id, cantidad: 4 }] });
  }

  // Sectores y seguridad: evaluaciones de ejemplo, claramente marcadas como datos de prueba
  const fuente = 'Dato de prueba (demostración)';
  await call('PUT', '/zonas/sectores', { comuna: 'Las Condes', zona: 'Oriente', seguridad: 'normal', fuente });
  await call('PUT', '/zonas/sectores', { comuna: 'Providencia', zona: 'Oriente', seguridad: 'normal', fuente });
  await call('PUT', '/zonas/sectores', { comuna: 'La Florida', zona: 'Sur oriente', seguridad: 'precaucion', fuente, horario_recomendado: 'Entregar antes de las 18:00' });
  await call('PUT', '/zonas/sectores', { comuna: 'San Joaquín', zona: 'Sur', seguridad: 'alto_riesgo', fuente, horario_recomendado: 'Solo de día y con acompañante', observaciones: 'Dato de prueba' });
  await call('POST', '/zonas/incidentes', { fecha: ymd(-12), comuna: 'San Joaquín', tipo: 'robo', descripcion: 'Incidente de prueba' });
  await call('POST', '/zonas/incidentes', { fecha: ymd(-30), comuna: 'La Florida', tipo: 'acceso_dificil', descripcion: 'Incidente de prueba' });

  // Historial de PRUEBA: despachos de días anteriores con horas inventadas solo para la demostración.
  const clientes = await call('GET', '/clientes');
  const ventanas = ['08:35', '09:00', '09:45'];
  // Cada conductor y cada responsable de bodega tiene su ritmo: el 1 carga y prepara más lento; el 2 es más rápido.
  const perfiles = [
    { driver: c1.id, bodega: b1.id, vehiculo: 1, inicioPrep: 6 * 60 + 20, prep: [42, 38, 45], carga: [26, 29, 24], espera: 20, transito: 1.12, entrega: [9, 12, 8] },
    { driver: c2.id, bodega: b2.id, vehiculo: 2, inicioPrep: 6 * 60 + 35, prep: [24, 27, 22], carga: [18, 21, 17], espera: 15, transito: 0.95, entrega: [14, 11, 16] },
  ];
  const historial = [
    { dias: 9, perfil: 0, clientes: [0, 1, 2], horas: true, fallan: [] }, { dias: 8, perfil: 1, clientes: [3, 4, 5], horas: true, fallan: [] },
    { dias: 6, perfil: 0, clientes: [0, 3, 4], horas: true, fallan: [4] }, { dias: 5, perfil: 1, clientes: [1, 2, 5], horas: true, fallan: [] },
    { dias: 3, perfil: 0, clientes: [0, 1, 4], horas: true, fallan: [] }, { dias: 2, perfil: 1, clientes: [2, 3, 5], horas: true, fallan: [5] },
    { dias: 1, perfil: 0, clientes: [0, 3], horas: false, fallan: [] }, // completado sin horas: muestra el aviso de registro pendiente
  ];
  for (const [n, h] of historial.entries()) {
    const perfil = perfiles[h.perfil];
    const fecha = ymd(-h.dias);
    const ids = [];
    for (const [k, i] of h.clientes.entries()) {
      const e = await call('POST', '/entregas', { client_id: clientes[i].id, fecha, ventana_hasta: ventanas[k], items: [{ product_id: p1.id, cantidad: 1 + (i % 3) }, { product_id: p2.id, cantidad: 2 }] });
      ids.push({ id: e.id, cliente: i });
    }
    const g = await call('POST', '/despachos', { entrega_ids: ids.map((x) => x.id), orden: ids.map((x) => x.id), alternativa: 'manual', vehicle_id: perfil.vehiculo, driver_id: perfil.driver, preparador_id: perfil.bodega, fecha, hora: '08:00', retorna: true });
    if (h.horas) {
      const t = await call('GET', `/despachos/${g.trip_id}`);
      let reloj = perfil.inicioPrep + (n % 2);
      const ev = [{ tipo: 'preparacion_inicio', hora: hm(reloj) }];
      reloj += perfil.prep[n % 3];
      ev.push({ tipo: 'preparacion_fin', hora: hm(reloj) }, { tipo: 'carga_inicio', hora: hm(reloj) });
      reloj += perfil.carga[n % 3];
      ev.push({ tipo: 'carga_fin', hora: hm(reloj) });
      reloj += perfil.espera;
      ev.push({ tipo: 'salida', hora: hm(reloj) });
      t.paradas.forEach((p, k) => {
        reloj += Math.round(p.min_tramo * perfil.transito);
        ev.push({ tipo: 'llegada', stop_id: p.id, hora: hm(reloj) });
        reloj += perfil.entrega[(k + n) % 3];
        ev.push({ tipo: 'fin', stop_id: p.id, hora: hm(reloj) });
      });
      reloj += Math.round(t.plan.retorno.min * perfil.transito);
      ev.push({ tipo: 'regreso', hora: hm(reloj) });
      await call('PUT', `/despachos/${g.trip_id}/tiempos`, { eventos: ev });
    }
    const falladas = ids.filter((x) => h.fallan.includes(x.cliente)).map((x) => x.id);
    await call('POST', `/despachos/${g.trip_id}/estado`, falladas.length
      ? { estado: 'completado', no_entregadas: falladas, nueva_fecha: ymd(3), motivo: 'Local cerrado (dato de prueba)' }
      : { estado: 'completado' });
  }

  // Combustible, gastos y kilometraje semanal de PRUEBA para comparar lo modelado con lo gastado
  for (const [veh, km0, filas] of [[1, 41300, [[-20, 11], [-11, 12], [-3, 9]]], [2, 17400, [[-18, 8], [-9, 9]]]]) {
    let km = km0;
    for (const [dias, litros] of filas) {
      await call('POST', `/vehiculos/${veh}/cargas`, { fecha: ymd(dias), litros, monto: Math.round(litros * 1300), km_odometro: km });
      km += litros * (veh === 1 ? 9 : 11.5);
    }
  }
  await call('POST', '/gastos', { vehicle_id: 2, fecha: ymd(-15), categoria: 'mantencion_preventiva', monto: 18000, km_odometro: 17500, proximo_km: 28000, proveedor: 'Taller de prueba' });
  await call('POST', '/gastos', { vehicle_id: 1, fecha: ymd(-10), categoria: 'neumaticos', monto: 12000, km_odometro: 41800, proveedor: 'Taller de prueba' });
  await call('POST', '/gastos', { vehicle_id: 1, fecha: ymd(-8), categoria: 'seguro', monto: 45000 });
  const semanas = [[1, [90, 110, 95, 120]], [2, [60, 50, 70, 55]]];
  for (const [veh, kms] of semanas) {
    for (const [i, km] of kms.entries()) await call('PUT', '/km-semanal', { vehicle_id: veh, fecha: ymd(-7 * (kms.length - i)), km });
  }
}
