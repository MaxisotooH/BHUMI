// Tiempos reales de cada despacho y KPIs de desempeño de los conductores.
// Todo sale de horas que el usuario registra. Lo que no se registró queda en blanco: no se estima ni se inventa.
import { resolverPeriodo } from './periodo.js';
import { getSettings, num, tx } from '../db.js';

export class TiemposError extends Error {
  constructor(message, code = 'tiempos_invalidos', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const BASE = ['preparacion_inicio', 'preparacion_fin', 'carga_inicio', 'carga_fin', 'salida', 'regreso'];
const PARADA = ['llegada', 'fin'];
const HORA = /^([01]\d|2[0-3]):[0-5]\d$/;

// Las horas se guardan como 'AAAA-MM-DDTHH:MM'. Se comparan como UTC para que el horario de verano no altere las diferencias.
const ms = (m) => Date.parse(`${m}:00Z`);
const minEntre = (a, b) => (a && b ? (ms(b) - ms(a)) / 60000 : null);
const hhmm = (m) => (m ? m.slice(11, 16) : null);
const esNum = (x) => typeof x === 'number' && Number.isFinite(x);
const dif = (real, ref) => (esNum(real) && esNum(ref) ? real - ref : null);
const suma = (xs) => xs.reduce((a, b) => a + b, 0);
const prom = (xs) => (xs.length ? suma(xs) / xs.length : null);

function paradasDe(db, tripId) {
  return db.prepare(`SELECT s.id, s.orden, s.client_id, s.delivery_id, s.km_tramo, s.min_tramo, s.resultado, s.motivo_no_entrega,
      COALESCE(c.nombre, 'Cliente') AS nombre, c.comuna, d.ventana_desde, d.ventana_hasta
    FROM trip_stops s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN deliveries d ON d.id = s.delivery_id
    WHERE s.trip_id = ? ORDER BY s.orden`).all(tripId);
}

function leerEventos(db, tripId) {
  const base = {};
  const paradas = new Map();
  for (const e of db.prepare('SELECT stop_id, tipo, momento FROM trip_events WHERE trip_id = ?').all(tripId)) {
    if (e.stop_id == null) base[e.tipo] = e.momento;
    else paradas.set(e.stop_id, { ...(paradas.get(e.stop_id) ?? {}), [e.tipo]: e.momento });
  }
  return { base, paradas };
}

/** Los hechos de un despacho en el orden en que ocurren. */
function secuencia(trip, stops, ev) {
  const s = [];
  const add = (tipo, momento, etiqueta) => s.push({ tipo, momento: momento ?? null, etiqueta });
  add('preparacion_inicio', ev.base.preparacion_inicio, 'inicio de preparación');
  add('preparacion_fin', ev.base.preparacion_fin, 'fin de preparación');
  add('carga_inicio', ev.base.carga_inicio, 'inicio de carga');
  add('carga_fin', ev.base.carga_fin, 'fin de carga');
  add('salida', ev.base.salida, 'salida de la base');
  for (const p of stops) {
    add('llegada', ev.paradas.get(p.id)?.llegada, `llegada a ${p.nombre}`);
    add('fin', ev.paradas.get(p.id)?.fin, `fin de entrega en ${p.nombre}`);
  }
  if (trip.retorna_base) add('regreso', ev.base.regreso, 'regreso a la base');
  return s;
}

function validarOrden(trip, stops, ev) {
  let previo = null;
  for (const e of secuencia(trip, stops, ev)) {
    if (!e.momento) continue;
    if (previo && e.momento < previo.momento) {
      throw new TiemposError(`La hora de ${e.etiqueta} (${hhmm(e.momento)}) no puede ser anterior a la hora de ${previo.etiqueta} (${hhmm(previo.momento)}).`);
    }
    previo = e;
  }
}

/**
 * Guarda o borra horas de un despacho. Cada evento: { tipo, stop_id?, hora: 'HH:MM' | '' }.
 * Las horas deben seguir el orden real del recorrido; si alguna no lo cumple, no se guarda ninguna.
 */
export function guardarTiempos(db, tripId, eventos) {
  const trip = db.prepare('SELECT * FROM trips WHERE id = ?').get(tripId);
  if (!trip) throw new TiemposError('Despacho no encontrado.', 'no_encontrado', 404);
  if (trip.estado === 'cancelado') throw new TiemposError('Un despacho cancelado no admite tiempos.');
  if (!Array.isArray(eventos) || !eventos.length) throw new TiemposError('No hay horas para guardar.');
  const stops = paradasDe(db, tripId);
  const ids = new Set(stops.map((s) => s.id));
  tx(db, () => {
    for (const e of eventos) {
      const esParada = PARADA.includes(e.tipo);
      if (!esParada && !BASE.includes(e.tipo)) throw new TiemposError('Tipo de hora no válido.');
      const stopId = esParada ? Number(e.stop_id) : null;
      if (esParada && !ids.has(stopId)) throw new TiemposError('Esa parada no pertenece a este despacho.');
      if (e.tipo === 'regreso' && !trip.retorna_base) throw new TiemposError('Este despacho no regresa a la base.');
      db.prepare('DELETE FROM trip_events WHERE trip_id = ? AND tipo = ? AND COALESCE(stop_id, 0) = ?').run(tripId, e.tipo, stopId ?? 0);
      const hora = e.hora == null ? '' : String(e.hora).trim();
      if (!hora) continue;
      if (!HORA.test(hora)) throw new TiemposError(`"${hora}" no es una hora válida. Usa el formato HH:MM, por ejemplo 08:30.`);
      db.prepare('INSERT INTO trip_events (trip_id, stop_id, tipo, momento) VALUES (?, ?, ?, ?)').run(tripId, stopId, e.tipo, `${trip.fecha}T${hora}`);
    }
    validarOrden(trip, stops, leerEventos(db, tripId));
  });
}

/**
 * Mide un despacho: compara lo real con lo planificado.
 * - Tránsito: desde la salida (o desde el fin de la entrega anterior) hasta la llegada. Se compara con los minutos de ruta calculados al planificar.
 * - Entrega: desde la llegada al cliente hasta el fin de la entrega. Se compara con el tiempo de servicio que se usó al planificar.
 * - Carga: inicio a fin de carga. Se compara con el tiempo objetivo solo si está configurado.
 */
export function medirDespacho(trip, stops, ev, { metaCargaMin = null, metaPreparacionMin = null } = {}) {
  const plan = trip.plan_json ? JSON.parse(trip.plan_json) : {};
  const seq = secuencia(trip, stops, ev);
  const b = ev.base;

  // Servicio previsto por parada = tiempo total planificado − conducción planificada. Es null si no estaba configurado al planificar.
  const conduccionPlan = suma(stops.map((p) => p.min_tramo ?? 0)) + (plan.retorno?.min ?? 0);
  const servicioTotal = esNum(trip.tiempo_min) ? trip.tiempo_min - conduccionPlan : null;
  const porParada = servicioTotal != null && stops.length ? Math.round((servicioTotal / stops.length) * 1000) / 1000 : null; // redondeo: evita el ruido de decimales de la resta
  const estandar = porParada != null && porParada > 0.05 ? porParada : null;

  const carga = { real_min: minEntre(b.carga_inicio, b.carga_fin), objetivo_min: metaCargaMin };
  carga.dif_min = dif(carga.real_min, carga.objetivo_min);
  const preparacion = { real_min: minEntre(b.preparacion_inicio, b.preparacion_fin), objetivo_min: metaPreparacionMin };
  preparacion.dif_min = dif(preparacion.real_min, preparacion.objetivo_min);

  // Cumplimiento: solo cuenta lo que el usuario marcó al cerrar el despacho
  const conResultado = trip.estado === 'completado' ? stops.filter((p) => p.resultado) : [];
  const cumplimiento = {
    programadas: conResultado.length,
    entregadas: conResultado.filter((p) => p.resultado === 'entregada').length,
    no_entregadas: conResultado.filter((p) => p.resultado === 'no_entregada').map((p) => ({ nombre: p.nombre, comuna: p.comuna ?? null, motivo: p.motivo_no_entrega ?? null })),
  };

  const salida = { plan: trip.hora_salida ?? null, real: hhmm(b.salida), atraso_min: trip.hora_salida ? minEntre(`${trip.fecha}T${trip.hora_salida}`, b.salida) : null };

  let ref = b.salida ?? null;
  const filas = stops.map((p) => {
    const e = ev.paradas.get(p.id) ?? {};
    const transito = { real_min: minEntre(ref, e.llegada), estimado_min: p.min_tramo ?? null };
    transito.dif_min = dif(transito.real_min, transito.estimado_min);
    const entrega = { real_min: minEntre(e.llegada, e.fin), estandar_min: estandar };
    entrega.dif_min = dif(entrega.real_min, entrega.estandar_min);
    let ventana = null;
    if (p.ventana_hasta && e.llegada) {
      const atraso = minEntre(`${trip.fecha}T${p.ventana_hasta}`, e.llegada);
      ventana = { desde: p.ventana_desde ?? null, hasta: p.ventana_hasta, a_tiempo: atraso <= 0, atraso_min: Math.max(0, atraso) };
    }
    ref = e.fin ?? null;
    return { stop_id: p.id, orden: p.orden, nombre: p.nombre, comuna: p.comuna ?? null, llegada: hhmm(e.llegada), fin: hhmm(e.fin), transito, entrega, ventana };
  });

  let retorno = null;
  if (trip.retorna_base) {
    retorno = { real_min: minEntre(ref, b.regreso), estimado_min: plan.retorno?.min ?? null, hora: hhmm(b.regreso) };
    retorno.dif_min = dif(retorno.real_min, retorno.estimado_min);
  }

  const ultimoFin = stops.length ? ev.paradas.get(stops.at(-1).id)?.fin ?? null : null;
  const ruta = {
    real_min: minEntre(b.salida, trip.retorna_base ? b.regreso ?? null : ultimoFin),
    estimado_min: estandar != null ? trip.tiempo_min : null,
    hasta: trip.retorna_base ? 'regreso' : 'ultima_entrega',
  };
  ruta.dif_min = dif(ruta.real_min, ruta.estimado_min);

  return {
    trip_id: trip.id,
    fecha: trip.fecha,
    estado: trip.estado,
    eventos: { preparacion_inicio: hhmm(b.preparacion_inicio), preparacion_fin: hhmm(b.preparacion_fin), carga_inicio: hhmm(b.carga_inicio), carga_fin: hhmm(b.carga_fin), salida: hhmm(b.salida), regreso: hhmm(b.regreso) },
    preparacion,
    carga,
    cumplimiento,
    salida,
    paradas: filas,
    retorno,
    ruta,
    paradas_por_hora: esNum(ruta.real_min) && ruta.real_min > 0 ? stops.length / (ruta.real_min / 60) : null,
    estandar_servicio_min: estandar,
    registro: { registrados: seq.filter((e) => e.momento).length, esperados: seq.length },
  };
}

const CONSULTA_TRIPS = `SELECT t.*, v.marca, v.modelo, v.nombre AS vehiculo_nombre, dr.nombre AS conductor, pr.nombre AS preparador
  FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id LEFT JOIN drivers pr ON pr.id = t.preparador_id`;

const metas = (db) => { const s = getSettings(db); return { metaCargaMin: num(s.meta_carga_min), metaPreparacionMin: num(s.meta_preparacion_min), metaCumplimientoPct: num(s.meta_cumplimiento_pct) }; };

/** Horas registradas y mediciones de un despacho. */
export function tiemposDespacho(db, tripId) {
  const trip = db.prepare(`${CONSULTA_TRIPS} WHERE t.id = ?`).get(tripId);
  if (!trip) throw new TiemposError('Despacho no encontrado.', 'no_encontrado', 404);
  const stops = paradasDe(db, tripId);
  const { metaCargaMin, metaPreparacionMin } = metas(db);
  return {
    despacho: {
      id: trip.id, fecha: trip.fecha, estado: trip.estado, hora_salida: trip.hora_salida, retorna_base: !!trip.retorna_base,
      conductor: trip.conductor ?? null, preparador: trip.preparador ?? null, vehiculo: `${trip.marca} ${trip.modelo}`, n_paradas: trip.n_paradas,
    },
    ...medirDespacho(trip, stops, leerEventos(db, tripId), { metaCargaMin, metaPreparacionMin }),
  };
}

/** Despachos del período (sin cancelados) con sus mediciones. */
export function medirDespachos(db, { desde, hasta, driver_id, vehicle_id } = {}) {
  const { metaCargaMin, metaPreparacionMin } = metas(db);
  const where = ["t.estado != 'cancelado'"];
  const params = [];
  if (desde) { where.push('t.fecha >= ?'); params.push(desde); }
  if (hasta) { where.push('t.fecha <= ?'); params.push(hasta); }
  if (driver_id) { where.push('t.driver_id = ?'); params.push(Number(driver_id)); }
  if (vehicle_id) { where.push('t.vehicle_id = ?'); params.push(Number(vehicle_id)); }
  const trips = db.prepare(`${CONSULTA_TRIPS} WHERE ${where.join(' AND ')} ORDER BY t.fecha DESC, t.id DESC`).all(...params);
  return trips.map((trip) => {
    const stops = paradasDe(db, trip.id);
    return { trip, stops, medida: medirDespacho(trip, stops, leerEventos(db, trip.id), { metaCargaMin, metaPreparacionMin }) };
  });
}

/** Cumplimiento de entregas de un conjunto de despachos: entregadas sobre programadas, con los motivos de las no entregadas. */
export function cumplimientoDe(medidas, { metaPct = null } = {}) {
  const programadas = suma(medidas.map((m) => m.cumplimiento.programadas));
  const entregadas = suma(medidas.map((m) => m.cumplimiento.entregadas));
  const pct = programadas > 0 ? (entregadas / programadas) * 100 : null;
  const motivos = new Map();
  for (const n of medidas.flatMap((m) => m.cumplimiento.no_entregadas)) motivos.set(n.motivo || 'Sin motivo indicado', (motivos.get(n.motivo || 'Sin motivo indicado') ?? 0) + 1);
  return {
    pct, programadas, entregadas, no_entregadas: programadas - entregadas, objetivo_pct: metaPct,
    dif_pct: metaPct != null && pct != null ? pct - metaPct : null,
    motivos: [...motivos].map(([motivo, n]) => ({ motivo, n })).sort((a, b) => b.n - a.n),
  };
}

/** Promedios de un conjunto de despachos medidos. Cada indicador trae `n`, la cantidad de datos con que se calculó. */
export function agregar(medidas, { metaCargaMin = null, metaPreparacionMin = null } = {}) {
  const cargas = medidas.map((m) => m.carga.real_min).filter(esNum);
  const preps = medidas.map((m) => m.preparacion.real_min).filter(esNum);
  const tramos = medidas
    .flatMap((m) => [...m.paradas.map((p) => p.transito), ...(m.retorno ? [m.retorno] : [])])
    .filter((t) => esNum(t.real_min) && esNum(t.estimado_min));
  const entregas = medidas.flatMap((m) => m.paradas.map((p) => p.entrega)).filter((e) => esNum(e.real_min));
  const conEstandar = entregas.filter((e) => esNum(e.estandar_min));
  const rutas = medidas.map((m) => m.ruta).filter((r) => esNum(r.real_min));
  const rutasConEst = rutas.filter((r) => esNum(r.estimado_min));
  const productivos = medidas.filter((m) => esNum(m.ruta.real_min) && m.ruta.real_min > 0);
  const ventanas = medidas.flatMap((m) => m.paradas.map((p) => p.ventana)).filter(Boolean);
  const atrasos = medidas.map((m) => m.salida.atraso_min).filter(esNum);
  const tramoReal = suma(tramos.map((t) => t.real_min));
  const tramoEst = suma(tramos.map((t) => t.estimado_min));
  const horas = suma(productivos.map((m) => m.ruta.real_min / 60));
  const aTiempo = ventanas.filter((v) => v.a_tiempo).length;
  return {
    despachos: medidas.length,
    paradas: suma(medidas.map((m) => m.paradas.length)),
    preparacion: { prom_min: prom(preps), n: preps.length, objetivo_min: metaPreparacionMin, dif_prom_min: metaPreparacionMin != null && preps.length ? prom(preps) - metaPreparacionMin : null },
    carga: { prom_min: prom(cargas), n: cargas.length, objetivo_min: metaCargaMin, dif_prom_min: metaCargaMin != null && cargas.length ? prom(cargas) - metaCargaMin : null },
    transito: { prom_min: tramos.length ? tramoReal / tramos.length : null, estimado_prom_min: tramos.length ? tramoEst / tramos.length : null, n: tramos.length, ratio_pct: tramoEst > 0 ? (tramoReal / tramoEst) * 100 : null },
    entrega: { prom_min: prom(entregas.map((e) => e.real_min)), n: entregas.length, estandar_prom_min: prom(conEstandar.map((e) => e.estandar_min)), dif_prom_min: prom(conEstandar.map((e) => e.dif_min)), n_estandar: conEstandar.length },
    ruta: { prom_min: prom(rutas.map((r) => r.real_min)), n: rutas.length, estimado_prom_min: prom(rutasConEst.map((r) => r.estimado_min)), dif_prom_min: prom(rutasConEst.map((r) => r.dif_min)), n_estimado: rutasConEst.length },
    productividad: { paradas_por_hora: horas > 0 ? suma(productivos.map((m) => m.paradas.length)) / horas : null, n: productivos.length },
    puntualidad: { pct: ventanas.length ? (aTiempo / ventanas.length) * 100 : null, a_tiempo: aTiempo, evaluadas: ventanas.length },
    salida: { atraso_prom_min: prom(atrasos), n: atrasos.length },
  };
}

/**
 * Indicadores del personal en un período:
 * - conductores: despacho (ruta, tránsito, entrega, puntualidad, productividad) y cumplimiento de entregas.
 * - bodega: tiempos de preparación de pedidos y de carga de quien figura como responsable de la bodega en cada despacho.
 * Los tiempos de carga y preparación se atribuyen al responsable de bodega; si el despacho no lo tiene, quedan como "Sin responsable de bodega".
 */
export function kpisPersonal(db, filtros = {}) {
  if (filtros.mes && !filtros.desde && !filtros.hasta) { const p = resolverPeriodo({ mes: filtros.mes }); filtros = { ...filtros, desde: p.desde, hasta: p.hasta }; }
  const { metaCargaMin, metaPreparacionMin, metaCumplimientoPct } = metas(db);
  const lista = medirDespachos(db, filtros);
  const medidos = lista.filter((x) => x.medida.registro.registrados > 0);
  const opciones = { metaCargaMin, metaPreparacionMin };

  const agrupar = (clave, nombre, vacio) => {
    const grupos = new Map();
    for (const x of lista) {
      const id = x.trip[clave] ?? 0;
      if (!grupos.has(id)) grupos.set(id, { id: x.trip[clave] ?? null, nombre: x.trip[nombre] ?? vacio, todos: [], medidos: [] });
      grupos.get(id).todos.push(x);
      if (x.medida.registro.registrados > 0) grupos.get(id).medidos.push(x);
    }
    return [...grupos.values()].sort((a, b) => (a.id == null) - (b.id == null) || a.nombre.localeCompare(b.nombre, 'es'));
  };

  const conductores = agrupar('driver_id', 'conductor', 'Sin conductor asignado').map((g) => ({
    driver_id: g.id, nombre: g.nombre, despachos_total: g.todos.length,
    ...agregar(g.medidos.map((x) => x.medida), opciones),
    cumplimiento: cumplimientoDe(g.todos.map((x) => x.medida), { metaPct: metaCumplimientoPct }),
  }));

  const bodega = agrupar('preparador_id', 'preparador', 'Sin responsable de bodega').map((g) => {
    const a = agregar(g.medidos.map((x) => x.medida), opciones);
    return { driver_id: g.id, nombre: g.nombre, despachos_total: g.todos.length, despachos: a.despachos, preparacion: a.preparacion, carga: a.carga };
  }).filter((g) => g.preparacion.n > 0 || g.carga.n > 0);

  const despachos = lista.map(({ trip, medida: m }) => {
    const tramos = [...m.paradas.map((p) => p.transito), ...(m.retorno ? [m.retorno] : [])].filter((t) => esNum(t.real_min) && esNum(t.estimado_min));
    const ents = m.paradas.map((p) => p.entrega.real_min).filter(esNum);
    const vent = m.paradas.map((p) => p.ventana).filter(Boolean);
    return {
      trip_id: trip.id, fecha: trip.fecha, estado: trip.estado, driver_id: trip.driver_id, conductor: trip.conductor ?? null, preparador: trip.preparador ?? null,
      vehiculo: `${trip.marca} ${trip.modelo}`, n_paradas: trip.n_paradas,
      registrados: m.registro.registrados, esperados: m.registro.esperados,
      preparacion_min: m.preparacion.real_min, carga_min: m.carga.real_min, ruta_min: m.ruta.real_min, ruta_estimado_min: m.ruta.estimado_min,
      transito_real_min: tramos.length ? suma(tramos.map((t) => t.real_min)) : null,
      transito_estimado_min: tramos.length ? suma(tramos.map((t) => t.estimado_min)) : null,
      entrega_prom_min: prom(ents), paradas_por_hora: m.paradas_por_hora,
      puntualidad_pct: vent.length ? (vent.filter((v) => v.a_tiempo).length / vent.length) * 100 : null,
      entregadas: m.cumplimiento.programadas ? m.cumplimiento.entregadas : null, programadas: m.cumplimiento.programadas || null,
    };
  });

  const sinRegistro = lista.filter((x) => x.medida.registro.registrados === 0 && ['completado', 'en_ruta'].includes(x.trip.estado));
  return {
    periodo: { desde: filtros.desde ?? null, hasta: filtros.hasta ?? null },
    objetivos: { carga_min: metaCargaMin, preparacion_min: metaPreparacionMin, cumplimiento_pct: metaCumplimientoPct },
    total: {
      despachos_total: lista.length, ...agregar(medidos.map((x) => x.medida), opciones),
      cumplimiento: cumplimientoDe(lista.map((x) => x.medida), { metaPct: metaCumplimientoPct }),
    },
    conductores,
    bodega,
    despachos,
    sin_registro: sinRegistro.slice(0, 20).map((x) => ({ trip_id: x.trip.id, fecha: x.trip.fecha, conductor: x.trip.conductor ?? null, estado: x.trip.estado })),
    sin_registro_total: sinRegistro.length,
    medidos_sin_conductor: medidos.filter((x) => x.trip.driver_id == null).length,
  };
}

/** Una fila por parada medida, para exportar a Excel. */
export function detalleParadas(lista) {
  return lista.flatMap(({ trip, medida: m }) => m.paradas
    .filter((p) => p.llegada || p.fin)
    .map((p) => ({
      trip_id: trip.id, fecha: trip.fecha, conductor: trip.conductor ?? '', orden: p.orden, cliente: p.nombre, comuna: p.comuna ?? '',
      llegada: p.llegada, fin: p.fin, transito_real: p.transito.real_min, transito_estimado: p.transito.estimado_min,
      entrega_real: p.entrega.real_min, entrega_estandar: p.entrega.estandar_min,
      ventana_hasta: p.ventana?.hasta ?? '', a_tiempo: p.ventana ? (p.ventana.a_tiempo ? 'Sí' : 'No') : '',
    })));
}
