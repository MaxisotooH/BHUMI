// Control de costos de transporte y distribución.
// Pone lado a lado lo que el modelo calcula para cada despacho y lo que realmente se gastó:
// cargas de combustible, mantenciones, neumáticos, seguros, permisos, peajes y estacionamientos.
// Lo que el usuario no registró queda como "sin registro": no se estima.
import { CATEGORIAS_GASTO, grupoDeCategoria } from './vehiculos-estado.js';
import { resolverPeriodo, ultimosMeses } from './periodo.js';

const sum = (a, f) => a.reduce((x, y) => x + (f(y) ?? 0), 0);
const dif = (real, modelo) => (real != null && modelo != null ? real - modelo : null);
const difPct = (real, modelo) => (real != null && modelo ? ((real - modelo) / modelo) * 100 : null);

/** Lo que el modelo calculó para los despachos completados del período. */
function modelado(trips) {
  const peajes = sum(trips, (t) => t.peajes);
  const estac = sum(trips, (t) => t.estacionamientos);
  const otrosDesp = sum(trips, (t) => t.otros_gastos);
  const conductor = sum(trips, (t) => (t.costo_otros ?? 0) - (t.peajes ?? 0) - (t.estacionamientos ?? 0) - (t.otros_gastos ?? 0));
  return {
    combustible: sum(trips, (t) => t.costo_combustible),
    desgaste: sum(trips, (t) => t.costo_desgaste),
    conductor,
    peajes, estacionamientos: estac, otros: otrosDesp,
    total: sum(trips, (t) => t.costo_total),
  };
}

/** Lo que realmente se gastó en el período, desde cargas de combustible, gastos de vehículos y gastos de despacho. */
function real(db, p, trips, { vehicle_id } = {}) {
  const filtroV = vehicle_id ? ' AND vehicle_id = ?' : '';
  const args = vehicle_id ? [p.desde, p.hasta, vehicle_id] : [p.desde, p.hasta];
  const cargas = db.prepare(`SELECT monto, litros FROM fuel_logs WHERE fecha >= ? AND fecha <= ?${filtroV}`).all(...args);
  const gastos = db.prepare(`SELECT categoria, monto, vehicle_id FROM gastos WHERE fecha >= ? AND fecha <= ?${filtroV}`).all(...args);
  const porGrupo = { mantencion: 0, desgaste: 0, fijo: 0, otro: 0 };
  const porCategoria = new Map();
  for (const g of gastos) {
    porGrupo[grupoDeCategoria(g.categoria)] += g.monto;
    const e = porCategoria.get(g.categoria) ?? { monto: 0, n: 0 };
    e.monto += g.monto; e.n++;
    porCategoria.set(g.categoria, e);
  }
  const combustible = sum(cargas, (c) => c.monto);
  const peajes = sum(trips, (t) => t.peajes);
  const estac = sum(trips, (t) => t.estacionamientos);
  const otrosDesp = sum(trips, (t) => t.otros_gastos);
  const desgasteReal = porGrupo.mantencion + porGrupo.desgaste;
  return {
    combustible, litros: sum(cargas, (c) => c.litros),
    cargas: cargas.length, cargas_sin_monto: cargas.filter((c) => c.monto == null).length,
    mantencion_y_desgaste: desgasteReal,
    fijos: porGrupo.fijo,
    otros_vehiculo: porGrupo.otro,
    peajes, estacionamientos: estac, otros_despacho: otrosDesp,
    gastos_registrados: gastos.length,
    total: combustible + desgasteReal + porGrupo.fijo + porGrupo.otro + peajes + estac + otrosDesp,
    por_categoria: CATEGORIAS_GASTO.filter((c) => porCategoria.has(c.id)).map((c) => ({ id: c.id, nombre: c.nombre, grupo: c.grupo, ...porCategoria.get(c.id) })).sort((a, b) => b.monto - a.monto),
  };
}

/**
 * @param filtros { mes | desde, hasta, vehicle_id? }
 */
export function controlCostos(db, filtros = {}) {
  const p = resolverPeriodo(filtros);
  const vehicle_id = filtros.vehicle_id ? Number(filtros.vehicle_id) : null;
  const filtroTrips = vehicle_id ? ' AND t.vehicle_id = ?' : '';
  const consultaTrips = `SELECT t.* FROM trips t WHERE t.estado = 'completado' AND t.fecha >= ? AND t.fecha <= ?${filtroTrips}`;
  const trips = db.prepare(consultaTrips).all(...(vehicle_id ? [p.desde, p.hasta, vehicle_id] : [p.desde, p.hasta]));

  const m = modelado(trips);
  const r = real(db, p, trips, { vehicle_id });
  const km = sum(trips, (t) => t.distancia_km);
  const paradas = sum(trips, (t) => t.n_paradas);

  // Qué se compara: solo lo que el modelo y el registro real miden de la misma manera.
  const hayCombustible = r.cargas > 0 && r.cargas_sin_monto < r.cargas;
  const hayDesgaste = r.mantencion_y_desgaste > 0;
  const comparacion = [
    { concepto: 'Combustible', modelado: m.combustible, real: hayCombustible ? r.combustible : null, nota: hayCombustible ? (r.cargas_sin_monto ? `${r.cargas_sin_monto} carga(s) sin monto` : null) : 'Sin cargas de combustible con monto en el período' },
    { concepto: 'Desgaste y mantención', modelado: m.desgaste, real: hayDesgaste ? r.mantencion_y_desgaste : null, nota: hayDesgaste ? null : 'Sin mantenciones ni repuestos registrados en el período' },
    { concepto: 'Peajes, estacionamientos y otros del despacho', modelado: m.peajes + m.estacionamientos + m.otros, real: r.peajes + r.estacionamientos + r.otros_despacho, nota: 'Se ingresan en cada despacho: coinciden por definición' },
  ].map((c) => ({ ...c, dif: dif(c.real, c.modelado), dif_pct: difPct(c.real, c.modelado) }));
  const comparables = comparacion.filter((c) => c.real != null);

  const avisos = [];
  if (!trips.length) avisos.push('No hay despachos completados en el período: el costo modelado queda en cero.');
  if (!r.cargas) avisos.push('No hay cargas de combustible en el período. Regístralas en Vehículos y kilometraje para comparar con lo real.');
  if (r.cargas_sin_monto) avisos.push(`${r.cargas_sin_monto} carga(s) de combustible no tienen monto: el combustible real está incompleto.`);
  if (m.conductor) avisos.push('El costo del conductor es el modelado (horas del despacho por el costo por hora). No se compara con un gasto real porque el sistema no registra sueldos.');

  // Costos fijos y variables del período
  const variables = { combustible: hayCombustible ? r.combustible : m.combustible, desgaste: hayDesgaste ? r.mantencion_y_desgaste : m.desgaste, peajes_y_otros: m.peajes + m.estacionamientos + m.otros + r.otros_vehiculo };
  const fijos = { conductor: m.conductor, seguros_permisos: r.fijos };

  // Sin cargas de combustible con monto el total real quedaría a medias: se deja en blanco en vez de mostrar un número engañoso
  const totalReal = hayCombustible ? r.total + m.conductor : null;
  return {
    periodo: p,
    vehicle_id,
    despachos: trips.length, km, paradas,
    modelado: m,
    real: r,
    comparacion,
    diferencia_total: comparables.length ? { real: sum(comparables, (c) => c.real), modelado: sum(comparables, (c) => c.modelado), dif: sum(comparables, (c) => c.real) - sum(comparables, (c) => c.modelado) } : null,
    total_con_conductor: { modelado: m.total, real: totalReal },
    costo_km: { modelado: km ? m.total / km : null, real: km && totalReal != null ? totalReal / km : null },
    costo_entrega: { modelado: paradas ? m.total / paradas : null, real: paradas && totalReal != null ? totalReal / paradas : null },
    variables, fijos,
    por_vehiculo: filtros.vehicle_id ? [] : porVehiculo(db, p),
    serie: serie(db, p.mes ?? p.desde.slice(0, 7)),
    avisos,
  };
}

function porVehiculo(db, p) {
  return db.prepare('SELECT id, nombre, marca, modelo, patente FROM vehicles WHERE activo = 1 ORDER BY id').all().map((v) => {
    const trips = db.prepare("SELECT * FROM trips WHERE vehicle_id = ? AND estado = 'completado' AND fecha >= ? AND fecha <= ?").all(v.id, p.desde, p.hasta);
    const r = real(db, p, trips, { vehicle_id: v.id });
    const m = modelado(trips);
    const km = sum(trips, (t) => t.distancia_km);
    const hayComb = r.cargas > 0 && r.cargas_sin_monto < r.cargas;
    const totalReal = hayComb ? r.total + m.conductor : null;
    return {
      vehicle_id: v.id, nombre: v.nombre ?? `${v.marca} ${v.modelo}`, patente: v.patente, despachos: trips.length, km,
      modelado: m.total, real: totalReal,
      costo_km_modelado: km ? m.total / km : null, costo_km_real: km && totalReal != null ? totalReal / km : null,
      combustible_real: hayComb ? r.combustible : null,
      mantencion_y_desgaste_real: r.mantencion_y_desgaste || null,
    };
  });
}

/** Seis meses de modelado y real para ver la tendencia. */
function serie(db, mes) {
  return ultimosMeses(6, mes).map((m) => {
    const p = resolverPeriodo({ mes: m });
    const trips = db.prepare("SELECT * FROM trips WHERE estado = 'completado' AND fecha >= ? AND fecha <= ?").all(p.desde, p.hasta);
    const mo = modelado(trips);
    const re = real(db, p, trips);
    const hayComb = re.cargas > 0 && re.cargas_sin_monto < re.cargas;
    return { mes: m, despachos: trips.length, km: sum(trips, (t) => t.distancia_km), modelado: mo.total, real: hayComb ? re.total + mo.conductor : null };
  });
}

/** Detalle de los gastos registrados (para la tabla del período). */
export function listarGastos(db, filtros = {}) {
  const p = resolverPeriodo(filtros);
  const where = ['g.fecha >= ?', 'g.fecha <= ?'];
  const args = [p.desde, p.hasta];
  if (filtros.vehicle_id) { where.push('g.vehicle_id = ?'); args.push(Number(filtros.vehicle_id)); }
  if (filtros.categoria) { where.push('g.categoria = ?'); args.push(filtros.categoria); }
  return db.prepare(`SELECT g.*, v.nombre AS vehiculo, v.patente FROM gastos g LEFT JOIN vehicles v ON v.id = g.vehicle_id WHERE ${where.join(' AND ')} ORDER BY g.fecha DESC, g.id DESC`).all(...args)
    .map((g) => ({ ...g, categoria_nombre: CATEGORIAS_GASTO.find((c) => c.id === g.categoria)?.nombre ?? g.categoria }));
}
