// Respaldo y restauración de datos (JSON). Funciona igual con node:sqlite y con SQLite en el navegador.
import { tx, TABLAS_CON_VERSION } from '../db.js';

/** Tablas con datos del usuario, en orden de dependencia (primero las que no apuntan a otras). */
export const TABLAS_RESPALDO = ['settings', 'fuel_prices', 'vehicles', 'fuel_logs', 'drivers', 'clients', 'products', 'trips', 'deliveries', 'delivery_items', 'trip_stops', 'trip_events', 'gastos', 'km_semanal', 'sectores', 'incidentes'];

export class RespaldoError extends Error {
  constructor(mensaje) {
    super(mensaje);
    this.status = 400;
    this.code = 'respaldo_invalido';
  }
}

/** Todos los datos en un objeto (la API key de Google nunca se incluye). */
export function exportarJson(db) {
  const out = { generado: new Date().toISOString(), version: 1 };
  for (const t of TABLAS_RESPALDO) out[t] = db.prepare(`SELECT * FROM ${t}`).all();
  out.settings = out.settings.filter((s) => s.key !== 'google_api_key');
  return out;
}

/** ¿Los primeros bytes son los de un archivo SQLite? */
export function esArchivoSqlite(bytes) {
  const cabecera = 'SQLite format 3\u0000';
  if (!bytes || bytes.length < 16) return false;
  for (let i = 0; i < 16; i++) if (bytes[i] !== cabecera.charCodeAt(i)) return false;
  return true;
}

/**
 * Reemplaza los datos actuales por los de un respaldo JSON.
 * Conserva la API key guardada (el respaldo no la trae) y el catálogo de regiones y comunas.
 * Todo ocurre en una transacción: si algo falla, los datos actuales quedan como estaban.
 */
export function restaurarJson(db, datos) {
  if (!datos || typeof datos !== 'object' || Array.isArray(datos) || !TABLAS_RESPALDO.some((t) => Array.isArray(datos[t]))) {
    throw new RespaldoError('El archivo no parece un respaldo de BHUMI (.json). Usa el que descargaste desde Configuración → Datos y respaldo.');
  }
  const resumen = {};
  tx(db, () => {
    // Se vacía en orden inverso para no violar las relaciones entre tablas.
    for (const t of [...TABLAS_RESPALDO].reverse()) if (t !== 'settings') db.exec(`DELETE FROM ${t}`);
    db.exec('DELETE FROM route_cache');
    for (const t of TABLAS_RESPALDO) {
      const filas = Array.isArray(datos[t]) ? datos[t] : [];
      const columnas = new Set(db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name));
      let n = 0;
      for (const fila of filas) {
        if (!fila || typeof fila !== 'object') continue;
        const ks = Object.keys(fila).filter((k) => columnas.has(k));
        if (!ks.length) continue;
        const valores = ks.map((k) => (fila[k] === undefined ? null : fila[k]));
        const sql = t === 'settings'
          ? 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
          : `INSERT INTO ${t} (${ks.join(', ')}) VALUES (${ks.map(() => '?').join(', ')})`;
        db.prepare(sql).run(...(t === 'settings' ? [fila.key, fila.value ?? null] : valores));
        n++;
      }
      resumen[t] = n;
    }
    // Insertar las paradas sube la versión de su despacho (trigger): se deja la que traía el respaldo.
    // Al fijar version y version_cambio juntos, el trigger no lo cuenta como otro cambio.
    for (const t of TABLAS_CON_VERSION) {
      const fijar = db.prepare(`UPDATE ${t} SET version = ?, version_cambio = ? WHERE id = ? AND (version <> ? OR version_cambio IS NOT ?)`);
      for (const fila of Array.isArray(datos[t]) ? datos[t] : []) {
        if (!Number.isInteger(fila?.version) || fila.id == null) continue;
        const cambio = fila.version_cambio ?? null;
        fijar.run(fila.version, cambio, fila.id, fila.version, cambio);
      }
    }
  });
  return resumen;
}
