// Panel de análisis y comparación.
// Reúne en un solo lugar lo que el proyecto pide medir: rutas más costosas, rendimiento de conductores, costo por cliente y sector,
// kilometraje y desgaste de vehículos, oportunidades de ahorro de combustible, utilización de la carga y ahorro potencial.
// Todo sale de despachos y registros reales. Cuando falta un dato, el indicador queda en blanco y se explica qué falta.
import { getSettings, num, precioCombustible } from '../db.js';
import { rendimientoEfectivo, costoRealPorKm } from './costs.js';
import { rendimientoVehiculos, proyeccion } from './analytics.js';
import { resolverPeriodo } from './periodo.js';
import { kpisPersonal } from './tiempos.js';
import { estadoFlota, alertasFlota, hoyLocal } from './vehiculos-estado.js';
import { concentracionEntregas, listarSectores } from './zonas.js';
import { cubicarEntregas, sugerirConsolidacion, utilizacionCarga } from './consolidacion.js';

const sum = (a, f) => a.reduce((x, y) => x + (f(y) ?? 0), 0);
const prom = (a) => (a.length ? sum(a, (x) => x) / a.length : null);

function tripsDelPeriodo(db, p) {
  return db.prepare(`SELECT t.*, v.marca, v.modelo, v.nombre AS vehiculo_nombre, v.capacidad_kg, dr.nombre AS conductor
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id
    WHERE t.estado = 'completado' AND t.fecha >= ? AND t.fecha <= ? ORDER BY t.fecha, t.id`).all(p.desde, p.hasta);
}

const comunasDe = (db, tripId) => db.prepare(`SELECT c.comuna FROM trip_stops s JOIN clients c ON c.id = s.client_id WHERE s.trip_id = ? ORDER BY s.orden`).all(tripId).map((x) => x.comuna).filter(Boolean);
const unicos = (xs) => [...new Set(xs)];

/** 1. Rutas más costosas: por despacho y agrupadas por los sectores que recorren. */
function rutasCostosas(db, trips) {
  const filas = trips.map((t) => {
    const comunas = comunasDe(db, t.id);
    return {
      trip_id: t.id, fecha: t.fecha, vehiculo: t.vehiculo_nombre ?? `${t.marca} ${t.modelo}`, conductor: t.conductor ?? null,
      sectores: unicos(comunas), paradas: t.n_paradas, km: t.distancia_km, tiempo_min: t.tiempo_min,
      costo_total: t.costo_total, costo_km: t.distancia_km > 0 ? t.costo_total / t.distancia_km : null, costo_entrega: t.n_paradas > 0 ? t.costo_total / t.n_paradas : null,
    };
  }).filter((f) => f.costo_total != null);
  const porRuta = new Map();
  for (const f of filas) {
    const firma = [...f.sectores].sort((a, b) => a.localeCompare(b, 'es')).join(' · ') || 'Sin sector';
    const e = porRuta.get(firma) ?? { ruta: firma, despachos: 0, km: 0, costo_total: 0, paradas: 0, tiempo_min: 0 };
    e.despachos++; e.km += f.km ?? 0; e.costo_total += f.costo_total; e.paradas += f.paradas ?? 0; e.tiempo_min += f.tiempo_min ?? 0;
    porRuta.set(firma, e);
  }
  return {
    despachos: [...filas].sort((a, b) => b.costo_total - a.costo_total).slice(0, 10),
    por_ruta: [...porRuta.values()].map((e) => ({ ...e, costo_promedio: e.costo_total / e.despachos, costo_km: e.km > 0 ? e.costo_total / e.km : null, costo_entrega: e.paradas > 0 ? e.costo_total / e.paradas : null }))
      .sort((a, b) => b.costo_total - a.costo_total).slice(0, 10),
  };
}

/** 2. Conductores: tiempos, rendimiento y costo por entrega. */
function conductores(db, p, trips) {
  const k = kpisPersonal(db, { desde: p.desde, hasta: p.hasta });
  return {
    objetivos: k.objetivos,
    filas: k.conductores.map((c) => {
      const t = trips.filter((x) => (x.driver_id ?? null) === c.driver_id);
      const km = sum(t, (x) => x.distancia_km);
      const costo = sum(t, (x) => x.costo_total);
      const paradas = sum(t, (x) => x.n_paradas);
      return {
        driver_id: c.driver_id, nombre: c.nombre, despachos: c.despachos_total, medidos: c.despachos, km, paradas,
        costo_total: t.length ? costo : null, costo_entrega: paradas ? costo / paradas : null, costo_km: km ? costo / km : null,
        ruta_prom_min: c.ruta.prom_min, ruta_vs_estimado_min: c.ruta.dif_prom_min, transito_ratio_pct: c.transito.ratio_pct,
        entrega_prom_min: c.entrega.prom_min, paradas_por_hora: c.productividad.paradas_por_hora,
        puntualidad_pct: c.puntualidad.pct, atraso_salida_min: c.salida.atraso_prom_min,
        cumplimiento_pct: c.cumplimiento.pct, entregadas: c.cumplimiento.entregadas, programadas: c.cumplimiento.programadas,
      };
    }),
    sin_registro: k.sin_registro_total,
    k,
  };
}

/** 3. Costo por cliente y por sector. */
function costoClienteSector(db, p) {
  const clientes = db.prepare(`SELECT c.id AS client_id, c.nombre, c.empresa, c.comuna, COUNT(*) AS entregas,
      SUM(s.costo_asignado) AS costo_total, SUM(s.km_tramo) AS km
    FROM trip_stops s JOIN trips t ON t.id = s.trip_id JOIN clients c ON c.id = s.client_id
    WHERE t.estado = 'completado' AND s.costo_asignado IS NOT NULL AND t.fecha >= ? AND t.fecha <= ?
    GROUP BY c.id ORDER BY costo_total DESC`).all(p.desde, p.hasta).map((c) => ({ ...c, costo_promedio: c.entregas ? c.costo_total / c.entregas : null }));
  const totalEnt = sum(clientes, (c) => c.entregas);
  const promGeneral = totalEnt ? sum(clientes, (c) => c.costo_total) / totalEnt : null;
  const sectores = concentracionEntregas(db, { desde: p.desde, hasta: p.hasta_excl, por: 'comuna' });
  const zonas = concentracionEntregas(db, { desde: p.desde, hasta: p.hasta_excl, por: 'zona' });
  return {
    promedio_entrega: promGeneral,
    clientes: clientes.slice(0, 10).map((c) => ({ ...c, veces_promedio: promGeneral ? c.costo_promedio / promGeneral : null })),
    clientes_total: clientes.length,
    sectores: sectores.filter((s) => s.costo != null).sort((a, b) => b.costo - a.costo).slice(0, 10),
    zonas: zonas.filter((s) => s.costo != null).sort((a, b) => b.costo - a.costo),
  };
}

/** 4. Vehículos: kilómetros y desgaste. */
function vehiculos(db, p, trips, flota) {
  return flota.map((e) => {
    const t = trips.filter((x) => x.vehicle_id === e.vehicle_id);
    const kmDespachos = sum(t, (x) => x.distancia_km);
    const regs = db.prepare('SELECT km FROM km_semanal WHERE vehicle_id = ? AND semana_inicio >= ? AND semana_inicio <= ?').all(e.vehicle_id, p.desde, p.hasta);
    const mant = db.prepare("SELECT COALESCE(SUM(monto), 0) AS n FROM gastos WHERE vehicle_id = ? AND categoria IN ('mantencion_preventiva','mantencion_correctiva','neumaticos','frenos','aceite','repuestos') AND fecha >= ? AND fecha <= ?").get(e.vehicle_id, p.desde, p.hasta).n;
    const consumido = [e.neumaticos.consumido_pct, e.vida_util?.consumido_pct].filter((x) => x != null);
    return {
      vehicle_id: e.vehicle_id, nombre: e.nombre, modelo: e.modelo, patente: e.patente,
      km_periodo: regs.length ? sum(regs, (x) => x.km) : null, km_despachos: kmDespachos, despachos: t.length,
      km_prom_semanal: e.km_prom_semanal, odometro_km: e.odometro_km,
      desgaste_modelado: t.length ? sum(t, (x) => x.costo_desgaste) : null, mantencion_real: mant || null,
      desgaste_pct: consumido.length ? Math.max(...consumido) : null,
      neumaticos_pct: e.neumaticos.consumido_pct, vida_util_pct: e.vida_util?.consumido_pct ?? null,
      mantencion: e.mantencion, costo_km: e.costo_km,
    };
  });
}

/** 5. Oportunidades de ahorro de combustible. */
function combustible(db, p, trips, vehs) {
  const rend = rendimientoVehiculos(db);
  const hoy = hoyLocal();
  const filas = rend.map((r) => {
    const v = vehs.find((x) => x.vehicle_id === r.vehicle_id);
    const km = v?.km_periodo ?? v?.km_despachos ?? 0;
    const precio = precioCombustible(db, db.prepare('SELECT combustible FROM vehicles WHERE id = ?').get(r.vehicle_id).combustible, hoy)?.precio ?? null;
    const extraL = r.real_km_l && r.configurado_km_l && r.real_km_l < r.configurado_km_l && km ? km / r.real_km_l - km / r.configurado_km_l : null;
    const litros = db.prepare('SELECT COALESCE(SUM(litros), 0) AS n FROM fuel_logs WHERE vehicle_id = ? AND fecha >= ? AND fecha <= ?').get(r.vehicle_id, p.desde, p.hasta).n;
    return { ...r, km_periodo: km || null, litros_periodo: litros || null, litros_extra: extraL, costo_extra: extraL != null && precio != null ? extraL * precio : null };
  });

  // ¿Habría gastado menos combustible otro vehículo con la misma ruta? Respeta capacidad y, si hay medidas, el cubicaje.
  const activos = db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo'").all();
  const swaps = [];
  for (const t of trips) {
    if (!(t.distancia_km > 0)) continue;
    const actual = activos.find((v) => v.id === t.vehicle_id) ?? db.prepare('SELECT * FROM vehicles WHERE id = ?').get(t.vehicle_id);
    const precioA = precioCombustible(db, actual.combustible, t.fecha)?.precio ?? null;
    const yA = rendimientoEfectivo(actual, null);
    if (precioA == null || yA == null) continue;
    const gastoA = (t.distancia_km / yA) * precioA;
    let mejor = null;
    for (const v of activos) {
      if (v.id === t.vehicle_id) continue;
      if (num(v.capacidad_kg) != null && t.peso_kg != null && t.peso_kg > v.capacidad_kg) continue;
      const ids = db.prepare('SELECT delivery_id FROM trip_stops WHERE trip_id = ? AND delivery_id IS NOT NULL').all(t.id).map((x) => x.delivery_id);
      const c = ids.length ? cubicarEntregas(db, v, ids) : null;
      if (c?.ok && !c.resultado.cabe) continue;
      const precio = precioCombustible(db, v.combustible, t.fecha)?.precio ?? null;
      const y = rendimientoEfectivo(v, null);
      if (precio == null || y == null) continue;
      const gasto = (t.distancia_km / y) * precio;
      if (gasto < gastoA && (!mejor || gasto < mejor.gasto)) mejor = { v, gasto };
    }
    if (mejor) swaps.push({ trip_id: t.id, fecha: t.fecha, vehiculo_usado: t.vehiculo_nombre ?? `${t.marca} ${t.modelo}`, vehiculo_sugerido: mejor.v.nombre ?? `${mejor.v.marca} ${mejor.v.modelo}`, ahorro: gastoA - mejor.gasto });
  }
  const swapsPorVeh = new Map();
  for (const s of swaps) {
    const e = swapsPorVeh.get(s.vehiculo_sugerido) ?? { vehiculo_sugerido: s.vehiculo_sugerido, despachos: 0, ahorro: 0 };
    e.despachos++; e.ahorro += s.ahorro;
    swapsPorVeh.set(s.vehiculo_sugerido, e);
  }

  const oportunidades = [];
  for (const f of filas.filter((x) => x.consumo_alto)) {
    oportunidades.push({ tipo: 'consumo', vehiculo: f.nombre, texto: `${f.nombre} rinde ${f.real_km_l.toFixed(1)} km/L y su configuración dice ${f.configurado_km_l} km/L (${f.desvio_pct.toFixed(0)}% menos). Revisa neumáticos, filtros y estilo de conducción.`, ahorro: f.costo_extra });
  }
  for (const e of swapsPorVeh.values()) {
    oportunidades.push({ tipo: 'vehiculo', vehiculo: e.vehiculo_sugerido, texto: `${e.vehiculo_sugerido} habría gastado menos combustible en ${e.despachos} despacho${e.despachos > 1 ? 's' : ''} del período, con las mismas rutas y respetando su capacidad.`, ahorro: e.ahorro });
  }
  const sinDatos = filas.filter((f) => f.cargas < 2).map((f) => f.nombre);
  return {
    vehiculos: filas,
    oportunidades,
    ahorro_vehiculo: swaps.length ? sum(swaps, (s) => s.ahorro) : null,
    ahorro_consumo: sum(filas, (f) => f.costo_extra) || null,
    litros_periodo: sum(filas, (f) => f.litros_periodo) || null,
    sin_datos: sinDatos,
  };
}

/** Ahorro potencial por rutas: despachos hechos en el orden en que se eligieron cuando existía una alternativa más barata calculada al planificar. */
function ahorroRutas(trips) {
  let total = 0;
  const filas = [];
  for (const t of trips) {
    if (t.alternativa !== 'manual' || !t.plan_json) continue;
    const plan = JSON.parse(t.plan_json);
    if (!plan.alternativas?.length) continue;
    const mejor = [...plan.alternativas].sort((a, b) => a.total - b.total)[0];
    const d = t.costo_total - mejor.total;
    if (d > 0) { total += d; filas.push({ trip_id: t.id, fecha: t.fecha, alternativa: mejor.codigo, km_real: t.distancia_km, km_alternativa: mejor.km, ahorro: d }); }
  }
  return { total: filas.length ? total : null, filas };
}

/** Ahorro potencial por procesos: minutos sobre la meta valorizados al costo por hora de quien los hizo. */
function ahorroProcesos(db, k) {
  const s = getSettings(db);
  const costoHoraBase = num(s.costo_hora_conductor);
  const faltan = [];
  const ob = k.objetivos;
  const det = { preparacion: { minutos: 0, costo: 0, n: 0, calculable: false }, carga: { minutos: 0, costo: 0, n: 0, calculable: false }, ruta: { minutos: 0, costo: 0, n: 0, calculable: false } };
  const costoHora = (id) => (id != null ? num(db.prepare('SELECT costo_hora FROM drivers WHERE id = ?').get(id)?.costo_hora) : null);
  const trips = db.prepare('SELECT id, driver_id, preparador_id FROM trips').all();
  const quien = new Map(trips.map((t) => [t.id, t]));
  if (ob.preparacion_min == null) faltan.push('Meta de preparación de pedidos (Configuración › Metas)');
  if (ob.carga_min == null) faltan.push('Meta de tiempo de carga (Configuración › Metas)');
  for (const d of k.despachos) {
    const t = quien.get(d.trip_id);
    const horaBodega = costoHora(t?.preparador_id);
    if (ob.preparacion_min != null && d.preparacion_min != null && horaBodega != null) {
      det.preparacion.calculable = true; det.preparacion.n++;
      const ex = Math.max(0, d.preparacion_min - ob.preparacion_min); det.preparacion.minutos += ex; det.preparacion.costo += (ex / 60) * horaBodega;
    }
    if (ob.carga_min != null && d.carga_min != null && horaBodega != null) {
      det.carga.calculable = true; det.carga.n++;
      const ex = Math.max(0, d.carga_min - ob.carga_min); det.carga.minutos += ex; det.carga.costo += (ex / 60) * horaBodega;
    }
    const horaChofer = costoHora(t?.driver_id) ?? costoHoraBase;
    if (d.ruta_min != null && d.ruta_estimado_min != null && horaChofer != null) {
      det.ruta.calculable = true; det.ruta.n++;
      const ex = Math.max(0, d.ruta_min - d.ruta_estimado_min); det.ruta.minutos += ex; det.ruta.costo += (ex / 60) * horaChofer;
    }
  }
  if (!k.despachos.some((d) => d.preparador && (d.preparacion_min != null || d.carga_min != null))) faltan.push('Horas de preparación y carga con el responsable de bodega asignado');
  else if (!det.preparacion.calculable && !det.carga.calculable) faltan.push('Costo por hora del personal de bodega (Configuración › Personal)');
  const calculable = Object.values(det).some((x) => x.calculable);
  return { total: calculable ? sum(Object.values(det), (x) => x.costo) : null, detalle: det, faltan };
}

/** Ahorro potencial: rutas + vehículo + cubicaje/consolidación + procesos, siempre con lo que falta para calcular cada parte. */
function ahorroPotencial(db, trips, comb, k) {
  const rutas = ahorroRutas(trips);
  const procesos = ahorroProcesos(db, k.k);
  const cons = sugerirConsolidacion(db);
  const piezas = [
    { id: 'rutas', nombre: 'Rutas', monto: rutas.total, detalle: `${rutas.filas.length} despacho(s) pudieron hacerse con un recorrido más corto`, falta: rutas.total == null ? 'Despachos hechos en orden manual con una alternativa más barata' : null },
    { id: 'vehiculo', nombre: 'Combustible: vehículo más eficiente', monto: comb.ahorro_vehiculo, detalle: 'Mismas rutas con el vehículo que gasta menos combustible', falta: comb.ahorro_vehiculo == null ? 'Rendimiento (km/L) y precio del combustible de al menos dos vehículos' : null },
    { id: 'cubicaje', nombre: 'Cubicaje y consolidación', monto: cons.resumen.ahorro_estimado, detalle: `${cons.resumen.despachos_evitables} despacho(s) evitables entre las entregas pendientes de hoy`, falta: cons.resumen.ahorro_estimado == null ? (cons.resumen.grupos ? 'Distancias calculadas con Google entre esos clientes (planifica el grupo para tenerlas)' : 'Entregas pendientes de sectores cercanos con productos medidos') : null },
    { id: 'procesos', nombre: 'Procesos (preparación, carga y despacho)', monto: procesos.total, detalle: 'Minutos sobre la meta valorizados al costo por hora', falta: procesos.total == null ? procesos.faltan.join('; ') : null },
  ];
  const calculadas = piezas.filter((x) => x.monto != null);
  return {
    total: calculadas.length ? sum(calculadas, (x) => x.monto) : null,
    piezas,
    completo: calculadas.length === piezas.length,
    rutas, procesos,
    consolidacion: cons,
  };
}

/**
 * @param filtros { mes | desde, hasta }
 */
export function panelAnalisis(db, filtros = {}) {
  const p = resolverPeriodo(filtros);
  const s = getSettings(db);
  const trips = tripsDelPeriodo(db, p);
  const flota = estadoFlota(db);
  const k = conductores(db, p, trips);
  const veh = vehiculos(db, p, trips, flota);
  const comb = combustible(db, p, trips, veh);
  const util = utilizacionCarga(db, p);
  const ahorro = ahorroPotencial(db, trips, comb, k);
  const km = sum(trips, (t) => t.distancia_km);
  const costo = sum(trips, (t) => t.costo_total);
  const paradas = sum(trips, (t) => t.n_paradas);
  const metaUtil = num(s.meta_utilizacion_pct);

  const alertas = [...alertasFlota(flota)];
  const riesgo = listarSectores(db).filter((x) => x.seguridad === 'alto_riesgo' && x.clientes > 0);
  const pendRiesgo = db.prepare("SELECT c.comuna, COUNT(*) AS n FROM deliveries d JOIN clients c ON c.id = d.client_id WHERE d.estado IN ('pendiente','reprogramada') GROUP BY c.comuna").all();
  for (const r of riesgo) {
    const n = pendRiesgo.find((x) => x.comuna === r.comuna)?.n ?? 0;
    if (n) alertas.push({ nombre: r.comuna, nivel: 'media', texto: `${n} entrega${n > 1 ? 's' : ''} pendiente${n > 1 ? 's' : ''} en ${r.comuna}, sector de alto riesgo${r.horario_recomendado ? ` (horario recomendado: ${r.horario_recomendado})` : ''}.` });
  }
  if (k.sin_registro) alertas.push({ nombre: 'Tiempos', nivel: 'info', texto: `${k.sin_registro} despacho(s) del período no tienen horas registradas: sus tiempos no entran a los indicadores.` });

  const faltantes = new Set();
  const ck = db.prepare('SELECT * FROM vehicles WHERE activo = 1').all().map((v) => costoRealPorKm(v, precioCombustible(db, v.combustible)?.precio ?? null));
  for (const c of ck) for (const f of c.faltantes) faltantes.add(f);
  if (num(s.costo_hora_conductor) == null) faltantes.add('Costo por hora del conductor');
  if (metaUtil == null) faltantes.add('Meta de utilización de la carga (opcional)');
  for (const f of ahorro.procesos.faltan) faltantes.add(f);

  return {
    periodo: p,
    resumen: {
      despachos: trips.length, entregas: paradas, km, costo_total: trips.length ? costo : null,
      costo_km: km ? costo / km : null, costo_entrega: paradas ? costo / paradas : null,
      cumplimiento_pct: k.k.total.cumplimiento.pct, cumplimiento_objetivo_pct: k.k.total.cumplimiento.objetivo_pct,
      utilizacion_peso_pct: util.peso_pct, utilizacion_volumen_pct: util.volumen_pct, utilizacion_objetivo_pct: metaUtil,
      ahorro_potencial: ahorro.total, ahorro_completo: ahorro.completo,
      tiempo_promedio_min: prom(trips.map((t) => t.tiempo_min).filter((x) => x != null)),
    },
    rutas_costosas: rutasCostosas(db, trips),
    conductores: { objetivos: k.objetivos, filas: k.filas, sin_registro: k.sin_registro },
    costo_cliente_sector: costoClienteSector(db, p),
    vehiculos: veh,
    combustible: comb,
    utilizacion: { ...util, objetivo_pct: metaUtil },
    ahorro_potencial: ahorro,
    serie: serieDeCostos(db, p),
    proyeccion: p.mes ? proyeccion(db, p.mes) : null,
    alertas,
    datos_faltantes: [...faltantes],
  };
}

/** Costo por mes de los últimos seis meses que terminan en el período. */
function serieDeCostos(db, p) {
  const mes = p.mes ?? p.hasta.slice(0, 7);
  const [y, m] = mes.split('-').map(Number);
  return Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(y, m - 1 - (5 - i), 1)).toISOString().slice(0, 7)).map((mm) => {
    const r = db.prepare("SELECT COUNT(*) AS despachos, COALESCE(SUM(distancia_km),0) AS km, COALESCE(SUM(costo_total),0) AS total, COALESCE(SUM(n_paradas),0) AS paradas FROM trips WHERE estado = 'completado' AND substr(fecha,1,7) = ?").get(mm);
    return { mes: mm, ...r, costo_entrega: r.paradas ? r.total / r.paradas : null };
  });
}
