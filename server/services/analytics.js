// Rendimiento real de combustible por vehículo y proyección del gasto del mes, calculados con los registros guardados.
import { getSettings, num } from '../db.js';
import { consumoReal, costoRealPorKm, consumoL100 } from './costs.js';
import { precioCombustible } from '../db.js';

const mesActual = () => new Date().toISOString().slice(0, 7);

export function rangoMes(mes) {
  const m = /^\d{4}-\d{2}$/.test(mes ?? '') ? mes : mesActual();
  const [y, mm] = m.split('-').map(Number);
  const desde = `${m}-01`;
  const hasta = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 10); // primer día del mes siguiente
  return { mes: m, desde, hasta };
}

export function rendimientoVehiculos(db) {
  const vehs = db.prepare('SELECT * FROM vehicles WHERE activo = 1 ORDER BY id').all();
  return vehs.map((v) => {
    const logs = db.prepare('SELECT * FROM fuel_logs WHERE vehicle_id = ?').all(v.id);
    const real = consumoReal(logs);
    const precio = precioCombustible(db, v.combustible)?.precio ?? null;
    const ck = costoRealPorKm(v, precio);
    const umbral = num(getSettings(db).umbral_consumo_pct) ?? 10;
    const conf = num(v.rendimiento_km_l);
    const desvio = real && conf ? ((conf - real.kmPorLitro) / conf) * 100 : null;
    return {
      vehicle_id: v.id,
      nombre: v.nombre ?? `${v.marca} ${v.modelo}`,
      marca: v.marca,
      modelo: v.modelo,
      configurado_km_l: conf,
      consumo_l_100km: consumoL100(v),
      real_km_l: real?.kmPorLitro ?? null,
      cargas: real?.cargas ?? 0,
      desvio_pct: desvio,
      consumo_alto: desvio != null ? desvio > umbral : null,
      costo_km: ck.totalKm,
      costo_combustible_km: ck.combustibleKm,
      costo_desgaste_km: ck.desgasteKm,
      costo_km_completo: ck.completo,
      faltantes: ck.faltantes,
    };
  });
}

/**
 * Cuánto gastará BHUMI en distribución en el mes:
 * lo ya realizado + lo planificado + las entregas pendientes sin ruta valoradas al costo promedio histórico.
 */
export function proyeccion(db, mes) {
  const r = rangoMes(mes);
  const sumEstado = (cond) => db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(costo_total),0) AS total FROM trips t WHERE ${cond} AND t.fecha >= ? AND t.fecha < ?`).get(r.desde, r.hasta);
  const realizado = sumEstado("t.estado = 'completado'");
  const planificado = sumEstado("t.estado IN ('planificado', 'en_ruta')");
  const sinRuta = db.prepare(`SELECT COUNT(*) AS n FROM deliveries WHERE estado IN ('pendiente', 'reprogramada') AND trip_id IS NULL
    AND (fecha IS NULL OR (fecha >= ? AND fecha < ?))`).get(r.desde, r.hasta).n;
  const hist = db.prepare("SELECT COALESCE(SUM(costo_total),0) AS total, COALESCE(SUM(n_paradas),0) AS paradas, COUNT(*) AS n FROM trips WHERE estado = 'completado'").get();
  const promedioEntrega = hist.paradas > 0 ? hist.total / hist.paradas : null;
  const estimadoPendientes = promedioEntrega != null ? sinRuta * promedioEntrega : null;
  const proy = realizado.total + planificado.total + (estimadoPendientes ?? 0);
  return {
    mes: r.mes,
    realizado: realizado.total,
    despachos_realizados: realizado.n,
    planificado: planificado.total,
    despachos_planificados: planificado.n,
    entregas_sin_ruta: sinRuta,
    costo_promedio_entrega: promedioEntrega,
    estimado_pendientes: estimadoPendientes,
    total: proy,
    completa: sinRuta === 0 || promedioEntrega != null,
    nota:
      sinRuta > 0 && promedioEntrega == null
        ? `Hay ${sinRuta} entregas sin ruta, pero aún no hay despachos realizados para estimar su costo.`
        : null,
  };
}
