// Zonas de distribución, seguridad de los sectores y concentración de entregas.
// Un sector es una comuna. Cada comuna puede pertenecer a una zona que define el usuario (por ejemplo "Poniente")
// y tener una evaluación de seguridad que ingresa el usuario; los incidentes que registre la complementan.
import { hoyLocal, sumarDias } from './vehiculos-estado.js';

export const SEGURIDAD = [
  { id: 'sin_evaluar', nombre: 'Sin evaluar', peso: 0 },
  { id: 'normal', nombre: 'Normal', peso: 1 },
  { id: 'precaucion', nombre: 'Con precaución', peso: 2 },
  { id: 'alto_riesgo', nombre: 'Alto riesgo', peso: 3 },
];
export const TIPOS_INCIDENTE = [
  { id: 'robo', nombre: 'Robo o hurto' },
  { id: 'asalto', nombre: 'Asalto' },
  { id: 'amenaza', nombre: 'Amenaza o agresión' },
  { id: 'vandalismo', nombre: 'Vandalismo' },
  { id: 'acceso_dificil', nombre: 'Acceso difícil o inseguro' },
  { id: 'otro', nombre: 'Otro' },
];
const peso = (n) => SEGURIDAD.find((s) => s.id === n)?.peso ?? 0;
const nivelPeor = (a, b) => (peso(b) > peso(a) ? b : a);
const clave = (c) => String(c ?? '').trim().toLowerCase();
const sum = (a, f) => a.reduce((x, y) => x + (f(y) ?? 0), 0);

function incidentesPorComuna(db, hoy) {
  const desde = sumarDias(hoy, -90);
  const m = new Map();
  for (const r of db.prepare('SELECT comuna, COUNT(*) AS n FROM incidentes WHERE comuna IS NOT NULL AND fecha >= ? GROUP BY comuna').all(desde)) m.set(clave(r.comuna), r.n);
  return m;
}

/** Todas las comunas con clientes o con evaluación, con su zona, seguridad e incidentes de los últimos 90 días. */
export function listarSectores(db, { hoy = hoyLocal() } = {}) {
  const filas = new Map();
  for (const s of db.prepare('SELECT * FROM sectores').all()) filas.set(clave(s.comuna), { ...s });
  const clientes = db.prepare('SELECT comuna, region, COUNT(*) AS n FROM clients WHERE activo = 1 AND comuna IS NOT NULL AND comuna != \'\' GROUP BY comuna, region').all();
  const inc = incidentesPorComuna(db, hoy);
  const out = new Map();
  for (const c of clientes) {
    const k = clave(c.comuna);
    const base = filas.get(k) ?? { id: null, comuna: c.comuna, region: c.region ?? '', zona: null, seguridad: 'sin_evaluar', horario_recomendado: null, observaciones: null, fuente: null, actualizado: null };
    const previo = out.get(k);
    out.set(k, { ...base, clientes: (previo?.clientes ?? 0) + c.n, incidentes_90d: inc.get(k) ?? 0 });
  }
  for (const [k, s] of filas) if (!out.has(k)) out.set(k, { ...s, clientes: 0, incidentes_90d: inc.get(k) ?? 0 });
  return [...out.values()].sort((a, b) => peso(b.seguridad) - peso(a.seguridad) || b.clientes - a.clientes || a.comuna.localeCompare(b.comuna, 'es'));
}

/** Advertencias de seguridad para las paradas de una ruta: qué sectores requieren precaución antes de salir. */
export function seguridadDeParadas(db, paradas, { hoy = hoyLocal() } = {}) {
  const sectores = new Map(listarSectores(db, { hoy }).map((s) => [clave(s.comuna), s]));
  const porComuna = new Map();
  for (const p of paradas) {
    const k = clave(p.comuna);
    if (!k) continue;
    const g = porComuna.get(k) ?? { comuna: String(p.comuna).trim(), nombres: [] };
    g.nombres.push(p.nombre);
    porComuna.set(k, g);
  }
  const alertas = [];
  const sinEvaluar = [];
  let nivelMax = 'sin_evaluar';
  for (const [k, g] of porComuna) {
    const s = sectores.get(k);
    if (!s || s.seguridad === 'sin_evaluar') sinEvaluar.push(g.comuna);
    if (!s) continue;
    nivelMax = nivelPeor(nivelMax, s.seguridad);
    if (peso(s.seguridad) >= 2 || s.incidentes_90d > 0) {
      alertas.push({ comuna: s.comuna, nivel: s.seguridad, horario_recomendado: s.horario_recomendado, observaciones: s.observaciones, incidentes_90d: s.incidentes_90d, paradas: g.nombres });
    }
  }
  alertas.sort((a, b) => peso(b.nivel) - peso(a.nivel) || b.incidentes_90d - a.incidentes_90d);
  return { nivel_max: nivelMax, alertas, sin_evaluar: sinEvaluar };
}

/**
 * Dónde se concentran las entregas. `por`: 'comuna' o 'zona' (las comunas sin zona quedan como zona propia).
 * Cuenta las paradas de despachos completados ('realizados') o de todos los no cancelados ('todos').
 */
export function concentracionEntregas(db, { desde, hasta, por = 'comuna', incluir = 'realizados', hoy = hoyLocal() } = {}) {
  const filtro = incluir === 'todos' ? "t.estado != 'cancelado'" : "t.estado = 'completado'";
  const paradas = db.prepare(`SELECT ts.client_id, ts.km_tramo, ts.costo_asignado, ts.resultado, c.comuna, c.region
    FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id JOIN clients c ON c.id = ts.client_id
    WHERE ${filtro} AND (? IS NULL OR t.fecha >= ?) AND (? IS NULL OR t.fecha < ?)`).all(desde ?? null, desde ?? null, hasta ?? null, hasta ?? null);
  const sectores = new Map(listarSectores(db, { hoy }).map((s) => [clave(s.comuna), s]));
  const pendientes = db.prepare("SELECT c.comuna, COUNT(*) AS n FROM deliveries d JOIN clients c ON c.id = d.client_id WHERE d.estado IN ('pendiente','reprogramada') GROUP BY c.comuna").all();
  const grupos = new Map();
  const llave = (comuna) => {
    const s = sectores.get(clave(comuna));
    return por === 'zona' ? (s?.zona || comuna || 'Sin comuna') : (comuna || 'Sin comuna');
  };
  const nuevo = (k) => { if (!grupos.has(k)) grupos.set(k, { clave: k, comunas: new Set(), entregas: 0, no_entregadas: 0, km: 0, costo: 0, clientes: new Set(), pendientes: 0, seguridad: 'sin_evaluar', incidentes_90d: 0, costoConDato: 0, entregasConCosto: 0 }); return grupos.get(k); };
  for (const p of paradas) {
    const g = nuevo(llave(p.comuna));
    g.comunas.add(p.comuna);
    // Una parada marcada como no entregada no cuenta como entrega, pero su costo sí se gastó
    if (p.resultado === 'no_entregada') g.no_entregadas++; else { g.entregas++; g.clientes.add(p.client_id); }
    g.km += p.km_tramo ?? 0;
    if (p.costo_asignado != null) { g.costo += p.costo_asignado; g.entregasConCosto++; }
  }
  for (const p of pendientes) { const g = nuevo(llave(p.comuna)); g.comunas.add(p.comuna); g.pendientes += p.n; }
  for (const g of grupos.values()) {
    for (const c of g.comunas) {
      const s = sectores.get(clave(c));
      if (s) { g.seguridad = nivelPeor(g.seguridad, s.seguridad); g.incidentes_90d += s.incidentes_90d; }
    }
  }
  const total = sum([...grupos.values()], (g) => g.entregas);
  return [...grupos.values()].map((g) => ({
    clave: g.clave,
    comunas: [...g.comunas].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es')),
    entregas: g.entregas,
    no_entregadas: g.no_entregadas,
    clientes: g.clientes.size,
    pendientes: g.pendientes,
    km: g.km,
    costo: g.entregasConCosto ? g.costo : null,
    costo_por_entrega: g.entregasConCosto && g.entregas ? g.costo / g.entregas : null,
    pct_entregas: total ? (g.entregas / total) * 100 : null,
    seguridad: g.seguridad,
    incidentes_90d: g.incidentes_90d,
  }))
  .sort((a, b) => b.entregas - a.entregas || b.pendientes - a.pendientes || a.clave.localeCompare(b.clave, 'es'));
}

/** Cantidad de entregas por cliente (para dimensionar los puntos del mapa). */
export function entregasPorCliente(db, { desde, hasta, incluir = 'realizados' } = {}) {
  const filtro = incluir === 'todos' ? "t.estado != 'cancelado'" : "t.estado = 'completado'";
  return db.prepare(`SELECT ts.client_id, COUNT(*) AS entregas FROM trip_stops ts JOIN trips t ON t.id = ts.trip_id
    WHERE ${filtro} AND (? IS NULL OR t.fecha >= ?) AND (? IS NULL OR t.fecha < ?) GROUP BY ts.client_id`).all(desde ?? null, desde ?? null, hasta ?? null, hasta ?? null);
}
