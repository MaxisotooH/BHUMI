// Kilometraje semanal, mantención preventiva y desgaste de cada vehículo.
// Todo sale de lo que el usuario registra (kilómetros por semana, mantenciones, cargas de bencina, despachos):
// si falta un dato el indicador queda en blanco, no se estima.
import { getSettings, num, precioCombustible } from '../db.js';
import { costoRealPorKm } from './costs.js';

export const CATEGORIAS_GASTO = [
  { id: 'mantencion_preventiva', nombre: 'Mantención preventiva', grupo: 'mantencion' },
  { id: 'mantencion_correctiva', nombre: 'Reparación (mantención correctiva)', grupo: 'mantencion' },
  { id: 'neumaticos', nombre: 'Neumáticos', grupo: 'desgaste' },
  { id: 'frenos', nombre: 'Frenos', grupo: 'desgaste' },
  { id: 'aceite', nombre: 'Aceite y filtros', grupo: 'desgaste' },
  { id: 'repuestos', nombre: 'Repuestos', grupo: 'mantencion' },
  { id: 'seguro', nombre: 'Seguro', grupo: 'fijo' },
  { id: 'permiso_circulacion', nombre: 'Permiso de circulación', grupo: 'fijo' },
  { id: 'revision_tecnica', nombre: 'Revisión técnica', grupo: 'fijo' },
  { id: 'lavado', nombre: 'Lavado', grupo: 'otro' },
  { id: 'otro', nombre: 'Otro gasto', grupo: 'otro' },
];
export const grupoDeCategoria = (id) => CATEGORIAS_GASTO.find((c) => c.id === id)?.grupo ?? 'otro';

const aFecha = (iso) => new Date(`${iso}T00:00:00Z`);
const aISO = (d) => d.toISOString().slice(0, 10);
export const sumarDias = (iso, n) => aISO(new Date(aFecha(iso).getTime() + n * 86400000));
export const hoyLocal = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);

/** Lunes de la semana de una fecha (AAAA-MM-DD). */
export function lunesDe(iso) {
  const d = aFecha(iso);
  const dia = d.getUTCDay(); // 0 domingo
  return sumarDias(iso, -((dia + 6) % 7));
}

const sum = (a, f) => a.reduce((x, y) => x + (f(y) ?? 0), 0);

/** Las últimas `n` semanas, de la más antigua a la actual. */
export function ultimasSemanas(n, hoy = hoyLocal()) {
  const actual = lunesDe(hoy);
  return Array.from({ length: n }, (_, i) => sumarDias(actual, -7 * (n - 1 - i)));
}

/** Mayor lectura de odómetro conocida del vehículo y de dónde sale. */
function odometro(db, v) {
  const lecturas = [];
  if (num(v.km_actual) != null) lecturas.push({ km: num(v.km_actual), fecha: null, fuente: 'Kilometraje informado en el vehículo' });
  for (const l of db.prepare('SELECT fecha, km_odometro FROM fuel_logs WHERE vehicle_id = ?').all(v.id)) lecturas.push({ km: l.km_odometro, fecha: l.fecha, fuente: 'Carga de combustible' });
  for (const l of db.prepare('SELECT semana_inicio, odometro FROM km_semanal WHERE vehicle_id = ? AND odometro IS NOT NULL').all(v.id)) lecturas.push({ km: l.odometro, fecha: sumarDias(l.semana_inicio, 6), fuente: 'Registro semanal' });
  for (const l of db.prepare('SELECT fecha, km_odometro FROM gastos WHERE vehicle_id = ? AND km_odometro IS NOT NULL').all(v.id)) lecturas.push({ km: l.km_odometro, fecha: l.fecha, fuente: 'Gasto registrado' });
  return lecturas.length ? lecturas.reduce((a, b) => (b.km > a.km ? b : a)) : null;
}

/** Estado de la mantención preventiva. */
function mantencion(db, v, odo, kmSemProm, alertaPct, hoy) {
  const intervalo = num(v.intervalo_mantencion_km);
  const ultima = db.prepare("SELECT fecha, km_odometro, proximo_km FROM gastos WHERE vehicle_id = ? AND categoria = 'mantencion_preventiva' ORDER BY fecha DESC, id DESC LIMIT 1").get(v.id);
  let proximaKm = null;
  let fuente = null;
  if (ultima?.proximo_km != null) { proximaKm = ultima.proximo_km; fuente = 'Próxima mantención indicada en el último registro'; }
  else if (ultima?.km_odometro != null && intervalo != null) { proximaKm = ultima.km_odometro + intervalo; fuente = 'Última mantención + intervalo del vehículo'; }
  else if (num(v.proxima_mantencion_km) != null) { proximaKm = num(v.proxima_mantencion_km); fuente = 'Próxima mantención informada en el vehículo'; }
  const fechaProx = v.proxima_mantencion_fecha || null;
  const restantes = proximaKm != null && odo ? proximaKm - odo.km : null;
  const vencidaPorFecha = fechaProx != null && fechaProx <= hoy;
  let estado = 'sin_datos';
  if (restantes != null || fechaProx) {
    estado = 'al_dia';
    const margen = intervalo != null ? intervalo * (alertaPct / 100) : null;
    if ((restantes != null && restantes <= 0) || vencidaPorFecha) estado = 'vencida';
    else if ((restantes != null && margen != null && restantes <= margen) || (restantes != null && kmSemProm > 0 && restantes / kmSemProm <= 2)) estado = 'proxima';
  }
  return {
    intervalo_km: intervalo,
    ultima_fecha: ultima?.fecha ?? null,
    ultima_km: ultima?.km_odometro ?? null,
    proxima_km: proximaKm,
    proxima_fecha: fechaProx,
    restantes_km: restantes,
    fecha_estimada: restantes != null && restantes > 0 && kmSemProm > 0 ? sumarDias(hoy, Math.round(restantes / (kmSemProm / 7))) : null,
    estado,
    fuente,
  };
}

function neumaticos(db, v, odo) {
  const vida = num(v.vida_neumaticos_km);
  const ultimo = db.prepare("SELECT fecha, km_odometro FROM gastos WHERE vehicle_id = ? AND categoria = 'neumaticos' AND km_odometro IS NOT NULL ORDER BY km_odometro DESC LIMIT 1").get(v.id);
  if (vida == null || !ultimo || !odo) return { vida_km: vida, ultimo_cambio_km: ultimo?.km_odometro ?? null, ultimo_cambio_fecha: ultimo?.fecha ?? null, recorridos_km: null, consumido_pct: null };
  const recorridos = Math.max(0, odo.km - ultimo.km_odometro);
  return { vida_km: vida, ultimo_cambio_km: ultimo.km_odometro, ultimo_cambio_fecha: ultimo.fecha, recorridos_km: recorridos, consumido_pct: (recorridos / vida) * 100 };
}

/** Kilómetros y actividad por semana de un vehículo. */
function semanas(db, v, desdeSemanas, precio) {
  const ck = costoRealPorKm(v, precio);
  return desdeSemanas.map((ini) => {
    const fin = sumarDias(ini, 7);
    const reg = db.prepare('SELECT km, odometro, nota FROM km_semanal WHERE vehicle_id = ? AND semana_inicio = ?').get(v.id, ini);
    const trips = db.prepare("SELECT distancia_km, n_paradas, fecha FROM trips WHERE vehicle_id = ? AND estado = 'completado' AND fecha >= ? AND fecha < ?").all(v.id, ini, fin);
    return {
      semana_inicio: ini,
      km_registrado: reg?.km ?? null,
      odometro: reg?.odometro ?? null,
      nota: reg?.nota ?? null,
      km_despachos: trips.length ? sum(trips, (t) => t.distancia_km) : 0,
      despachos: trips.length,
      paradas: sum(trips, (t) => t.n_paradas),
      dias_con_despacho: new Set(trips.map((t) => t.fecha)).size,
      costo_operacion: reg && ck.totalKm != null ? reg.km * ck.totalKm : null,
    };
  });
}

/** Estado de cada vehículo activo: odómetro, km por semana, mantención y desgaste. */
export function estadoFlota(db, { hoy = hoyLocal(), nSemanas = 8 } = {}) {
  const alertaPct = num(getSettings(db).alerta_mantencion_pct) ?? 10;
  const lista = ultimasSemanas(nSemanas, hoy);
  return db.prepare('SELECT * FROM vehicles WHERE activo = 1 ORDER BY id').all().map((v) => {
    const precio = precioCombustible(db, v.combustible)?.precio ?? null;
    const odo = odometro(db, v);
    const sem = semanas(db, v, lista, precio);
    const registradas = sem.filter((s) => s.km_registrado != null && s.semana_inicio < lunesDe(hoy)).slice(-4);
    const kmSemProm = registradas.length ? sum(registradas, (s) => s.km_registrado) / registradas.length : null;
    const semActual = sem.find((s) => s.semana_inicio === lunesDe(hoy));
    const ck = costoRealPorKm(v, precio);
    return {
      vehicle_id: v.id,
      nombre: v.nombre ?? `${v.marca} ${v.modelo}`,
      modelo: `${v.marca} ${v.modelo}`,
      patente: v.patente,
      odometro_km: odo?.km ?? null,
      odometro_fuente: odo?.fuente ?? null,
      km_semana_actual: semActual?.km_registrado ?? null,
      km_prom_semanal: kmSemProm,
      semanas_con_registro: registradas.length,
      costo_km: ck.totalKm,
      costo_km_completo: ck.completo,
      semanas: sem,
      mantencion: mantencion(db, v, odo, kmSemProm ?? 0, alertaPct, hoy),
      neumaticos: neumaticos(db, v, odo),
      vida_util: num(v.vida_util_km) != null && odo ? { vida_km: num(v.vida_util_km), consumido_pct: (odo.km / num(v.vida_util_km)) * 100 } : null,
    };
  });
}

/** Alertas de mantención y neumáticos para el panel. */
export function alertasFlota(estado) {
  const out = [];
  for (const e of estado) {
    if (e.mantencion.estado === 'vencida') out.push({ vehicle_id: e.vehicle_id, nombre: e.nombre, nivel: 'alta', texto: `Mantención preventiva vencida${e.mantencion.restantes_km != null ? ` (pasó ${Math.round(-e.mantencion.restantes_km)} km)` : ''}.` });
    else if (e.mantencion.estado === 'proxima') out.push({ vehicle_id: e.vehicle_id, nombre: e.nombre, nivel: 'media', texto: `Mantención preventiva próxima${e.mantencion.restantes_km != null ? `: faltan ${Math.round(e.mantencion.restantes_km)} km` : ''}${e.mantencion.fecha_estimada ? ` (hacia el ${e.mantencion.fecha_estimada})` : ''}.` });
    if (e.neumaticos.consumido_pct != null && e.neumaticos.consumido_pct >= 90) out.push({ vehicle_id: e.vehicle_id, nombre: e.nombre, nivel: e.neumaticos.consumido_pct >= 100 ? 'alta' : 'media', texto: `Neumáticos al ${Math.round(e.neumaticos.consumido_pct)}% de su vida útil.` });
  }
  return out;
}
