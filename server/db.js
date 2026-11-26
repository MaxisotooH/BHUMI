// Base de datos SQLite (módulo integrado de Node: no requiere compilar nada).
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { REGIONES } from './data/chile.js';

export const SETTINGS_DEFAULTS = {
  empresa_nombre: 'BHUMI',
  deposito_nombre: 'Casa matriz BHUMI',
  deposito_direccion: 'Poeta Pedro Prado 1536',
  deposito_comuna: 'Quinta Normal',
  deposito_region: 'Metropolitana de Santiago',
  deposito_lat: '',
  deposito_lng: '',
  google_api_key: '',
  google_map_id: '',
  usar_trafico: '1',
  costo_hora_conductor: '',
  jornada_horas: '',
  recargo_horas_extra_pct: '',
  tiempo_servicio_min: '',
  meta_carga_min: '',
  meta_preparacion_min: '',
  meta_cumplimiento_pct: '',
  meta_utilizacion_pct: '',
  alerta_mantencion_pct: '10',
  radio_cercania_km: '5',
  cache_horas: '12',
  peso_distancia: '1',
  peso_tiempo: '1',
  peso_costo: '1',
  umbral_consumo_pct: '10',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);

CREATE TABLE IF NOT EXISTS regiones (id INTEGER PRIMARY KEY, codigo TEXT, nombre TEXT NOT NULL, orden INTEGER);
CREATE TABLE IF NOT EXISTS comunas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  region_id INTEGER NOT NULL REFERENCES regiones(id)
);

CREATE TABLE IF NOT EXISTS fuel_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  combustible TEXT NOT NULL,
  precio REAL NOT NULL,
  vigente_desde TEXT NOT NULL,
  nota TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS vehicles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT,
  patente TEXT,
  marca TEXT NOT NULL,
  modelo TEXT NOT NULL,
  anio INTEGER,
  motor TEXT,
  combustible TEXT NOT NULL DEFAULT 'Bencina',
  km_actual REAL,
  rendimiento_km_l REAL,
  ajuste_carga_pct REAL,
  ajuste_condicion_pct REAL,
  capacidad_kg REAL,
  estado TEXT NOT NULL DEFAULT 'activo',
  proxima_mantencion_fecha TEXT,
  proxima_mantencion_km REAL,
  costo_mantencion REAL,
  intervalo_mantencion_km REAL,
  valor_neumaticos REAL,
  vida_neumaticos_km REAL,
  valor_vehiculo REAL,
  valor_residual REAL,
  vida_util_km REAL,
  vida_util_anios REAL,
  costo_km_motor REAL,
  costo_km_neumaticos REAL,
  costo_km_frenos REAL,
  costo_km_aceite REAL,
  costo_km_mantencion REAL,
  costo_km_depreciacion REAL,
  notas TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fuel_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  fecha TEXT NOT NULL,
  litros REAL NOT NULL,
  monto REAL,
  km_odometro REAL NOT NULL,
  nota TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  telefono TEXT,
  costo_hora REAL,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  empresa TEXT,
  direccion TEXT,
  comuna TEXT,
  region TEXT,
  lat REAL,
  lng REAL,
  geo_precision TEXT,
  telefono TEXT,
  frecuencia_compra TEXT,
  observaciones TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_clients_comuna ON clients(comuna);
CREATE INDEX IF NOT EXISTS idx_clients_region ON clients(region);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  sku TEXT,
  unidad TEXT DEFAULT 'un',
  peso_kg REAL,
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  hora_salida TEXT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
  driver_id INTEGER REFERENCES drivers(id),
  estado TEXT NOT NULL DEFAULT 'planificado',
  alternativa TEXT,
  retorna_base INTEGER NOT NULL DEFAULT 1,
  n_paradas INTEGER NOT NULL DEFAULT 0,
  distancia_km REAL,
  tiempo_min REAL,
  peso_kg REAL,
  costo_combustible REAL,
  costo_desgaste REAL,
  costo_otros REAL,
  costo_total REAL,
  peajes REAL DEFAULT 0,
  estacionamientos REAL DEFAULT 0,
  otros_gastos REAL DEFAULT 0,
  precio_combustible REAL,
  baseline_km REAL,
  baseline_total REAL,
  ahorro REAL,
  polyline TEXT,
  plan_json TEXT,
  notas TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  direccion_entrega TEXT,
  lat REAL,
  lng REAL,
  fecha TEXT,
  ventana_desde TEXT,
  ventana_hasta TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente',
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  orden INTEGER,
  fecha_realizada TEXT,
  motivo_reprogramacion TEXT,
  observaciones TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_deliveries_estado ON deliveries(estado);
CREATE INDEX IF NOT EXISTS idx_deliveries_trip ON deliveries(trip_id);

CREATE TABLE IF NOT EXISTS delivery_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  delivery_id INTEGER NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id),
  descripcion TEXT,
  cantidad REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS trip_stops (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  delivery_id INTEGER REFERENCES deliveries(id) ON DELETE SET NULL,
  client_id INTEGER REFERENCES clients(id),
  orden INTEGER NOT NULL,
  km_tramo REAL,
  min_tramo REAL,
  peso_kg REAL,
  costo_asignado REAL
);
CREATE INDEX IF NOT EXISTS idx_trip_stops_trip ON trip_stops(trip_id);
CREATE INDEX IF NOT EXISTS idx_trip_stops_client ON trip_stops(client_id);

-- Horas reales de cada despacho (carga, salida, llegada y fin de entrega en cada cliente, regreso).
-- Una fila por hecho registrado; momento = 'AAAA-MM-DDTHH:MM' en hora local. stop_id es NULL en los hechos de la base.
CREATE TABLE IF NOT EXISTS trip_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trip_id INTEGER NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  stop_id INTEGER REFERENCES trip_stops(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  momento TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_trip_events_trip ON trip_events(trip_id);

-- Gastos de los vehículos que no vienen de un despacho: mantenciones, neumáticos, seguro, permisos, etc.
-- (la bencina se registra en fuel_logs y los peajes/estacionamientos en cada despacho).
CREATE TABLE IF NOT EXISTS gastos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER REFERENCES vehicles(id) ON DELETE SET NULL,
  fecha TEXT NOT NULL,
  categoria TEXT NOT NULL,
  monto REAL NOT NULL,
  km_odometro REAL,
  proximo_km REAL,
  proveedor TEXT,
  detalle TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gastos_vehiculo ON gastos(vehicle_id, fecha);

-- Kilómetros recorridos por cada vehículo, una fila por semana (semana_inicio = lunes, AAAA-MM-DD).
CREATE TABLE IF NOT EXISTS km_semanal (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
  semana_inicio TEXT NOT NULL,
  km REAL NOT NULL,
  odometro REAL,
  nota TEXT,
  UNIQUE (vehicle_id, semana_inicio)
);

-- Sectores de distribución: una fila por comuna, con su zona y la evaluación de seguridad que ingresa el usuario.
CREATE TABLE IF NOT EXISTS sectores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comuna TEXT NOT NULL,
  region TEXT NOT NULL DEFAULT '',
  zona TEXT,
  seguridad TEXT NOT NULL DEFAULT 'sin_evaluar',
  horario_recomendado TEXT,
  observaciones TEXT,
  fuente TEXT,
  actualizado TEXT,
  UNIQUE (comuna, region)
);

-- Incidentes de seguridad ocurridos durante la distribución.
CREATE TABLE IF NOT EXISTS incidentes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fecha TEXT NOT NULL,
  comuna TEXT,
  client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  trip_id INTEGER REFERENCES trips(id) ON DELETE SET NULL,
  tipo TEXT NOT NULL DEFAULT 'otro',
  descripcion TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidentes_comuna ON incidentes(comuna, fecha);

CREATE TABLE IF NOT EXISTS route_cache (
  o TEXT NOT NULL,
  d TEXT NOT NULL,
  bucket TEXT NOT NULL,
  dist_m REAL,
  dur_s REAL,
  static_s REAL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (o, d, bucket)
);
`;

// Convierte valores a algo que SQLite acepta (undefined → null, boolean → 0/1).
export function limpiar(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) out[k] = null;
    else if (typeof v === 'boolean') out[k] = v ? 1 : 0;
    else if (v === '') out[k] = null;
    else out[k] = v;
  }
  return out;
}

/** `file` es una ruta de archivo, ':memory:' o (solo en el navegador) los bytes de una base ya guardada. */
export function openDb(file) {
  const enDisco = typeof file === 'string' && file !== ':memory:';
  if (enDisco) fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  // Otro proceso (Litestream, al consolidar el respaldo) puede tomar la base por un instante:
  // en vez de fallar con "database is locked", la escritura espera hasta 5 segundos.
  if (enDisco) db.exec('PRAGMA busy_timeout = 5000;');
  prepararDb(db);
  return db;
}

/** Deja la base lista: relaciones activas, tablas al día y datos iniciales (solo se agrega lo que falta). */
export function prepararDb(db) {
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  migrar(db);
  seed(db);
}

/** Columnas agregadas después de la primera versión: se crean solo si faltan, así una base guardada antes sigue funcionando. */
const COLUMNAS_NUEVAS = {
  products: { largo_cm: 'REAL', ancho_cm: 'REAL', alto_cm: 'REAL', apilable: 'INTEGER NOT NULL DEFAULT 1', rotable: 'INTEGER NOT NULL DEFAULT 0' },
  vehicles: { carga_largo_cm: 'REAL', carga_ancho_cm: 'REAL', carga_alto_cm: 'REAL' },
  drivers: { rol: "TEXT NOT NULL DEFAULT 'conductor'" },
  trips: { preparador_id: 'INTEGER REFERENCES drivers(id)' },
  // Resultado de cada parada al cerrar el despacho: 'entregada' o 'no_entregada'
  trip_stops: { resultado: 'TEXT', motivo_no_entrega: 'TEXT' },
};
function migrar(db) {
  let faltabaResultado = false;
  for (const [tabla, columnas] of Object.entries(COLUMNAS_NUEVAS)) {
    const existentes = new Set(db.prepare(`PRAGMA table_info(${tabla})`).all().map((c) => c.name));
    for (const [col, def] of Object.entries(columnas)) {
      if (existentes.has(col)) continue;
      db.exec(`ALTER TABLE ${tabla} ADD COLUMN ${col} ${def}`);
      if (tabla === 'trip_stops' && col === 'resultado') faltabaResultado = true;
    }
  }
  // Despachos cerrados antes de existir el resultado por parada: se deduce de la entrega solo cuando es inequívoco
  if (faltabaResultado) {
    db.exec(`UPDATE trip_stops SET resultado = 'entregada' WHERE EXISTS (
        SELECT 1 FROM trips t JOIN deliveries d ON d.id = trip_stops.delivery_id
        WHERE t.id = trip_stops.trip_id AND t.estado = 'completado' AND d.estado = 'realizada' AND d.fecha_realizada = t.fecha)`);
    db.exec(`UPDATE trip_stops SET resultado = 'no_entregada' WHERE resultado IS NULL AND EXISTS (
        SELECT 1 FROM trips t JOIN deliveries d ON d.id = trip_stops.delivery_id
        WHERE t.id = trip_stops.trip_id AND t.estado = 'completado' AND d.estado = 'reprogramada' AND d.trip_id IS NULL)`);
  }
}

/** Ejecuta fn dentro de una transacción; revierte si lanza un error. */
export function tx(db, fn) {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ya revertida */ }
    throw e;
  }
}

function seed(db) {
  // Configuración inicial: solo se inserta lo que falta.
  const ins = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [k, v] of Object.entries(SETTINGS_DEFAULTS)) ins.run(k, v);

  // Catálogo de regiones y comunas.
  const nReg = db.prepare('SELECT COUNT(*) AS n FROM regiones').get().n;
  if (nReg === 0) {
    tx(db, () => {
      const insR = db.prepare('INSERT INTO regiones (id, codigo, nombre, orden) VALUES (?, ?, ?, ?)');
      const insC = db.prepare('INSERT INTO comunas (nombre, region_id) VALUES (?, ?)');
      REGIONES.forEach((r, i) => {
        insR.run(i + 1, r.codigo, r.nombre, i + 1);
        for (const c of r.comunas) insC.run(c, i + 1);
      });
    });
  }

  // Flota actual de BHUMI (solo los datos informados; el resto se completa en la app).
  const nVeh = db.prepare('SELECT COUNT(*) AS n FROM vehicles').get().n;
  if (nVeh === 0) {
    const insV = db.prepare(
      'INSERT INTO vehicles (nombre, marca, modelo, motor, combustible) VALUES (?, ?, ?, ?, ?)'
    );
    insV.run('Vehículo 1', 'Chevrolet', 'N400', '1.5', 'Bencina');
    insV.run('Vehículo 2', 'KYC', 'X5', '1.5', 'Bencina');
  }
}

export function getSettings(db) {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const s = { ...SETTINGS_DEFAULTS };
  for (const r of rows) s[r.key] = r.value;
  return s;
}

export function setSettings(db, patch) {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  tx(db, () => {
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in SETTINGS_DEFAULTS)) continue;
      up.run(k, v == null ? '' : String(v));
    }
  });
}

/** Número de un ajuste, o null si está vacío. */
export function num(v) {
  if (v === '' || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Precio vigente de un combustible a una fecha (YYYY-MM-DD). */
export function precioCombustible(db, combustible, fecha = null) {
  const f = fecha ?? new Date().toISOString().slice(0, 10);
  return db
    .prepare(
      'SELECT precio, vigente_desde FROM fuel_prices WHERE combustible = ? AND vigente_desde <= ? ORDER BY vigente_desde DESC, id DESC LIMIT 1'
    )
    .get(combustible, f) ?? null;
}
