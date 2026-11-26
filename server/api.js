// API REST de BHUMI.
import expressReal from 'express';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { getSettings, setSettings, SETTINGS_DEFAULTS, limpiar, tx, num, precioCombustible, prepararDb } from './db.js';
import { REGIONES, buscarComuna, buscarRegion, normalizar } from './data/chile.js';
import { GoogleError } from './services/google.js';
import { PlanError, MAX_PARADAS } from './services/planner.js';
import { costoRealPorKm, consumoL100, consumoReal, desgastePorKm, COMPONENTES_DESGASTE } from './services/costs.js';
import { haversineKm } from './services/optimizer.js';
import { stopsDesdeClientes, stopsDesdeEntregas, itemsDeEntrega, NoEncontrado } from './services/stops.js';
import { panelAnalisis } from './services/panel.js';
import { controlCostos, listarGastos } from './services/control-costos.js';
import { guardarTiempos, tiemposDespacho, kpisPersonal } from './services/tiempos.js';
import { estadoFlota, alertasFlota, CATEGORIAS_GASTO, lunesDe, hoyLocal } from './services/vehiculos-estado.js';
import { listarSectores, concentracionEntregas, entregasPorCliente, seguridadDeParadas, SEGURIDAD, TIPOS_INCIDENTE } from './services/zonas.js';
import { cubicar, capacidadPorProducto, medidasVehiculo, medidasProducto, CubicajeError } from './services/cubicaje.js';
import { cubicarEntregas, sugerirConsolidacion } from './services/consolidacion.js';
import { rutaParaConductor } from './services/ruta-conductor.js';
import { resolverPeriodo } from './services/periodo.js';
import { excelDe, pdfDe, reportePanel, reporteCostos, reporteKpi, reporteFlota, reporteZonas, pdfHojaDeRuta } from './services/reportes.js';
import { exportarJson, restaurarJson, esArchivoSqlite, RespaldoError } from './services/respaldo.js';

class ApiError extends Error {
  constructor(status, code, message, extra = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}
const bad = (msg, code = 'datos_invalidos', extra) => { throw new ApiError(400, code, msg, extra); };
const n = (v) => {
  if (v === '' || v == null) return null;
  const x = Number(v);
  if (!Number.isFinite(x)) bad(`"${v}" no es un número válido.`);
  return x;
};
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const VEH_COLS = ['nombre', 'patente', 'marca', 'modelo', 'anio', 'motor', 'combustible', 'km_actual', 'rendimiento_km_l', 'ajuste_carga_pct',
  'ajuste_condicion_pct', 'capacidad_kg', 'estado', 'proxima_mantencion_fecha', 'proxima_mantencion_km', 'costo_mantencion', 'intervalo_mantencion_km',
  'valor_neumaticos', 'vida_neumaticos_km', 'valor_vehiculo', 'valor_residual', 'vida_util_km', 'vida_util_anios', 'costo_km_motor', 'costo_km_neumaticos',
  'costo_km_frenos', 'costo_km_aceite', 'costo_km_mantencion', 'costo_km_depreciacion', 'carga_largo_cm', 'carga_ancho_cm', 'carga_alto_cm', 'notas', 'activo'];
const VEH_TEXT = new Set(['nombre', 'patente', 'marca', 'modelo', 'motor', 'combustible', 'estado', 'proxima_mantencion_fecha', 'notas']);
const CLI_COLS = ['nombre', 'empresa', 'direccion', 'comuna', 'region', 'lat', 'lng', 'geo_precision', 'telefono', 'frecuencia_compra', 'observaciones', 'activo'];
const CLI_NUM = new Set(['lat', 'lng', 'activo']);

function armar(body, cols, textos, soloNumericos = null) {
  const o = {};
  for (const c of cols) {
    if (!(c in body)) continue;
    const v = body[c];
    const esTexto = soloNumericos ? !soloNumericos.has(c) : textos.has(c);
    o[c] = esTexto ? (v === '' || v == null ? null : String(v).trim()) : n(v);
  }
  return o;
}

function insertar(db, tabla, datos) {
  const ks = Object.keys(datos);
  if (!ks.length) bad('No hay datos para guardar.');
  const r = db.prepare(`INSERT INTO ${tabla} (${ks.join(', ')}) VALUES (${ks.map((k) => `$${k}`).join(', ')})`).run(limpiar(datos));
  return Number(r.lastInsertRowid);
}
function actualizar(db, tabla, id, datos) {
  const ks = Object.keys(datos);
  if (!ks.length) return;
  db.prepare(`UPDATE ${tabla} SET ${ks.map((k) => `${k} = $${k}`).join(', ')} WHERE id = $__id`).run({ ...limpiar(datos), __id: id });
}

const hoyStr = () => new Date().toISOString().slice(0, 10);
const FRECUENCIAS = ['semanal', 'quincenal', 'mensual', 'bimestral', 'ocasional'];
const COMBUSTIBLES = ['Bencina', 'Bencina 93', 'Bencina 95', 'Bencina 97', 'Diésel', 'GLP'];
const ESTADOS_VEH = ['activo', 'en mantención', 'fuera de servicio'];
const ROLES = [{ id: 'conductor', nombre: 'Conductor' }, { id: 'preparador', nombre: 'Bodega (preparación y carga)' }];

/** `express` se puede reemplazar por el enrutador local del navegador (modo de doble clic). */
export function createApi({ db, google, planner, demo = false, express = expressReal, clavesGoogle = null, autenticacion = false }) {
  const r = express.Router();

  // Con clavesGoogle (servidor central) la clave del servidor viene de variables de entorno y nunca sale al navegador:
  // la interfaz recibe solo la clave del mapa, restringida al dominio. Sin ellas, se usa la clave guardada en Configuración.
  const ajustes = () => {
    const s = getSettings(db);
    return clavesGoogle ? { ...s, google_api_key: clavesGoogle.servidor } : s;
  };
  const ajustesPublicos = () => {
    const s = getSettings(db);
    return clavesGoogle ? { ...s, google_api_key: clavesGoogle.navegador } : s;
  };

  // ---------- Meta, configuración y estado de la instalación ----------
  r.get('/meta', (req, res) => {
    res.json({
      regiones: REGIONES.map((x) => ({ codigo: x.codigo, nombre: x.nombre, comunas: x.comunas })),
      combustibles: COMBUSTIBLES,
      estados_vehiculo: ESTADOS_VEH,
      frecuencias: FRECUENCIAS,
      componentes_desgaste: COMPONENTES_DESGASTE,
      categorias_gasto: CATEGORIAS_GASTO,
      niveles_seguridad: SEGURIDAD,
      tipos_incidente: TIPOS_INCIDENTE,
      roles: ROLES,
      max_paradas: MAX_PARADAS,
      demo,
      google_por_servidor: !!clavesGoogle,
      autenticacion, // servidor central: la interfaz pide iniciar sesión
    });
  });

  r.get('/settings', (req, res) => res.json(ajustesPublicos()));
  r.put('/settings', wrap(async (req, res) => {
    const antes = getSettings(db);
    const patch = {};
    for (const k of Object.keys(SETTINGS_DEFAULTS)) if (k in req.body) patch[k] = req.body[k];
    for (const k of ['costo_hora_conductor', 'jornada_horas', 'recargo_horas_extra_pct', 'tiempo_servicio_min', 'meta_carga_min', 'meta_preparacion_min', 'meta_cumplimiento_pct', 'meta_utilizacion_pct', 'alerta_mantencion_pct', 'radio_cercania_km', 'cache_horas', 'peso_distancia', 'peso_tiempo', 'peso_costo', 'umbral_consumo_pct', 'deposito_lat', 'deposito_lng']) {
      if (k in patch) { const v = n(patch[k]); patch[k] = v == null ? '' : v; }
    }
    if (clavesGoogle) delete patch.google_api_key; // la definen las variables de entorno del servidor
    else if ('google_api_key' in patch) patch.google_api_key = String(patch.google_api_key ?? '').trim();
    const cambioDir = ['deposito_direccion', 'deposito_comuna', 'deposito_region'].some((k) => k in patch && String(patch[k]) !== String(antes[k]));
    if (cambioDir && !('deposito_lat' in patch)) { patch.deposito_lat = ''; patch.deposito_lng = ''; }
    setSettings(db, patch);
    const s = ajustes();
    // Con la clave ya guardada, ubica la base de inmediato para que el mapa y las rutas queden listos.
    const sinCoord = num(s.deposito_lat) == null || num(s.deposito_lng) == null;
    if (s.google_api_key && s.deposito_direccion && sinCoord) {
      try {
        const g = await google.geocode({ direccion: s.deposito_direccion, comuna: s.deposito_comuna, region: s.deposito_region });
        setSettings(db, { deposito_lat: g.lat, deposito_lng: g.lng });
      } catch { /* se vuelve a intentar al planificar o desde Configuración */ }
    }
    res.json(ajustesPublicos());
  }));
  r.post('/settings/probar-google', wrap(async (req, res) => {
    const s = ajustes();
    if (!s.google_api_key) throw new GoogleError('sin_clave', 'Primero pega tu API key de Google Maps y guarda.');
    const dir = [s.deposito_direccion, s.deposito_comuna, 'Chile'].filter(Boolean).join(', ') || 'Santiago, Chile';
    res.json(await google.probar(dir));
  }));
  r.post('/settings/geolocalizar-deposito', wrap(async (req, res) => {
    const s = getSettings(db);
    const g = await google.geocode({ direccion: s.deposito_direccion, comuna: s.deposito_comuna, region: s.deposito_region });
    setSettings(db, { deposito_lat: g.lat, deposito_lng: g.lng });
    res.json({ lat: g.lat, lng: g.lng, direccion: g.direccion_formateada, precision: g.precision });
  }));

  r.get('/setup', (req, res) => {
    const s = ajustes();
    const vehs = db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo'").all();
    const items = [];
    const add = (id, titulo, ok, detalle, href, opcional = false) => items.push({ id, titulo, estado: ok ? 'ok' : opcional ? 'opcional' : 'falta', detalle, href });
    add('google', 'API key de Google Maps', !!s.google_api_key, s.google_api_key ? 'Guardada. Usa “Probar conexión” para confirmar que Routes y Geocoding responden.' : 'Necesaria para el mapa, las rutas y la geolocalización de clientes.', '#/configuracion?tab=google');
    const tieneCoord = num(s.deposito_lat) != null && num(s.deposito_lng) != null;
    add('deposito', 'Punto de partida', tieneCoord, tieneCoord ? `${s.deposito_direccion}, ${s.deposito_comuna}` : `${s.deposito_direccion}, ${s.deposito_comuna}: se geolocaliza con Google al ingresar la API key.`, '#/configuracion?tab=base');
    for (const comb of [...new Set(vehs.map((v) => v.combustible))]) {
      add(`precio-${comb}`, `Precio de ${comb}`, !!precioCombustible(db, comb), 'Se usa para calcular el costo de combustible de cada ruta.', '#/configuracion?tab=combustible');
    }
    for (const v of vehs) {
      const nombre = v.nombre ?? `${v.marca} ${v.modelo}`;
      add(`rend-${v.id}`, `Rendimiento de ${nombre} (km/L)`, num(v.rendimiento_km_l) != null, `${v.marca} ${v.modelo} ${v.motor ?? ''}`.trim(), '#/vehiculos');
      add(`cap-${v.id}`, `Capacidad de carga de ${nombre} (kg)`, num(v.capacidad_kg) != null, 'Permite avisar cuando una carga supera el peso que soporta.', '#/vehiculos', true);
      const mv = medidasVehiculo(v);
      add(`med-${v.id}`, `Medidas de la carrocería de ${nombre}`, mv.faltan.length === 0, mv.faltan.length ? `Falta: ${mv.faltan.join(', ')}. Sin ellas no se puede cubicar.` : 'Largo, ancho y alto internos registrados.', '#/vehiculos', true);
      const des = desgastePorKm(v);
      add(`des-${v.id}`, `Desgaste de ${nombre}`, des.completo, des.completo ? 'Neumáticos, mantención y depreciación configurados.' : `Falta: ${des.faltantes.join(', ').toLowerCase()}.`, '#/vehiculos', true);
      add(`mant-${v.id}`, `Mantención preventiva de ${nombre}`, num(v.intervalo_mantencion_km) != null, 'El intervalo en km permite avisar cuándo toca la próxima mantención.', '#/vehiculos', true);
    }
    add('conductor', 'Costo por hora del conductor', num(s.costo_hora_conductor) != null, 'Incluye el tiempo de manejo en el costo de cada ruta.', '#/configuracion?tab=costos', true);
    add('servicio', 'Tiempo de servicio por cliente (min)', num(s.tiempo_servicio_min) != null, 'Minutos que toma descargar y entregar en cada parada.', '#/configuracion?tab=costos', true);
    add('metas', 'Metas de los indicadores', num(s.meta_preparacion_min) != null && num(s.meta_carga_min) != null && num(s.meta_cumplimiento_pct) != null, 'Tiempos objetivo de preparación y carga, y cumplimiento esperado de entregas.', '#/configuracion?tab=metas', true);
    const cli = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN lat IS NOT NULL THEN 1 ELSE 0 END) AS con_coord FROM clients WHERE activo = 1').get();
    add('clientes', 'Clientes con ubicación', cli.total > 0 && cli.con_coord === cli.total, cli.total ? `${cli.con_coord ?? 0} de ${cli.total} tienen coordenadas.` : 'Aún no hay clientes registrados.', '#/clientes');
    const sec = listarSectores(db).filter((x) => x.clientes > 0);
    add('seguridad', 'Seguridad de los sectores', sec.length > 0 && sec.every((x) => x.seguridad !== 'sin_evaluar'), sec.length ? `${sec.filter((x) => x.seguridad !== 'sin_evaluar').length} de ${sec.length} comunas con clientes están evaluadas.` : 'Se evalúa por comuna cuando hay clientes.', '#/clientes?tab=zonas', true);
    const prod = db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN largo_cm > 0 AND ancho_cm > 0 AND alto_cm > 0 THEN 1 ELSE 0 END) AS con_medidas, SUM(CASE WHEN peso_kg IS NOT NULL THEN 1 ELSE 0 END) AS con_peso FROM products WHERE activo = 1').get();
    add('productos', 'Medidas y peso de los productos', prod.total > 0 && prod.con_medidas === prod.total && prod.con_peso === prod.total, prod.total ? `${prod.con_medidas ?? 0} de ${prod.total} con medidas y ${prod.con_peso ?? 0} con peso.` : 'Sin productos: se usan para el cubicaje y para validar la carga.', '#/cubicaje', true);
    res.json({ items, completo: items.every((i) => i.estado !== 'falta'), pendientes: items.filter((i) => i.estado === 'falta').length });
  });

  // ---------- Combustible ----------
  r.get('/combustible/precios', (req, res) => {
    const historial = db.prepare('SELECT * FROM fuel_prices ORDER BY vigente_desde DESC, id DESC').all();
    const vigentes = COMBUSTIBLES.map((c) => ({ combustible: c, ...(precioCombustible(db, c) ?? { precio: null, vigente_desde: null }) }));
    res.json({ vigentes, historial });
  });
  r.post('/combustible/precios', (req, res) => {
    const precio = n(req.body.precio);
    if (!req.body.combustible) bad('Indica el tipo de combustible.');
    if (precio == null || precio <= 0) bad('El precio por litro debe ser mayor que cero.');
    const id = insertar(db, 'fuel_prices', { combustible: String(req.body.combustible), precio, vigente_desde: req.body.vigente_desde || hoyStr(), nota: req.body.nota ?? null });
    res.status(201).json({ id });
  });
  r.delete('/combustible/precios/:id', (req, res) => { db.prepare('DELETE FROM fuel_prices WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

  // ---------- Vehículos ----------
  function vehiculoEnriquecido(v) {
    const precio = precioCombustible(db, v.combustible)?.precio ?? null;
    const ck = costoRealPorKm(v, precio);
    const logs = db.prepare('SELECT * FROM fuel_logs WHERE vehicle_id = ?').all(v.id);
    return {
      ...v,
      precio_combustible: precio,
      consumo_l_100km: consumoL100(v),
      consumo_real: consumoReal(logs),
      costo_km: { combustible: ck.combustibleKm, desgaste: ck.desgasteKm, total: ck.totalKm, faltantes: ck.faltantes, calculable: ck.calculable, completo: ck.completo },
      desgaste: ck.desgaste,
      medidas_carga: medidasVehiculo(v).faltan.length === 0,
    };
  }
  r.get('/vehiculos', (req, res) => {
    const filas = db.prepare('SELECT * FROM vehicles WHERE activo = 1 ORDER BY id').all();
    res.json(filas.map(vehiculoEnriquecido));
  });
  r.get('/vehiculos/:id', (req, res) => {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id);
    if (!v) throw new NoEncontrado('Vehículo no encontrado.');
    res.json(vehiculoEnriquecido(v));
  });
  r.post('/vehiculos', (req, res) => {
    const d = armar(req.body, VEH_COLS, VEH_TEXT);
    if (!d.marca || !d.modelo) bad('Ingresa marca y modelo del vehículo.');
    d.combustible ??= 'Bencina';
    d.estado ??= 'activo';
    if (!ESTADOS_VEH.includes(d.estado)) bad('Estado de vehículo no válido.');
    const id = insertar(db, 'vehicles', d);
    res.status(201).json(vehiculoEnriquecido(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id)));
  });
  r.put('/vehiculos/:id', (req, res) => {
    const d = armar(req.body, VEH_COLS, VEH_TEXT);
    if ('marca' in d && !d.marca) bad('La marca no puede quedar vacía.');
    if ('modelo' in d && !d.modelo) bad('El modelo no puede quedar vacío.');
    if (d.estado && !ESTADOS_VEH.includes(d.estado)) bad('Estado de vehículo no válido.');
    if (d.rendimiento_km_l != null && d.rendimiento_km_l <= 0) bad('El rendimiento debe ser mayor que cero.');
    actualizar(db, 'vehicles', req.params.id, d);
    res.json(vehiculoEnriquecido(db.prepare('SELECT * FROM vehicles WHERE id = ?').get(req.params.id)));
  });
  r.delete('/vehiculos/:id', (req, res) => {
    const usos = db.prepare('SELECT COUNT(*) AS n FROM trips WHERE vehicle_id = ?').get(req.params.id).n;
    if (usos) { db.prepare('UPDATE vehicles SET activo = 0 WHERE id = ?').run(req.params.id); return res.json({ desactivado: true }); }
    db.prepare('DELETE FROM vehicles WHERE id = ?').run(req.params.id);
    res.json({ eliminado: true });
  });
  r.get('/vehiculos/:id/cargas', (req, res) => {
    res.json(db.prepare('SELECT * FROM fuel_logs WHERE vehicle_id = ? ORDER BY km_odometro DESC').all(req.params.id));
  });
  r.post('/vehiculos/:id/cargas', (req, res) => {
    const litros = n(req.body.litros), km = n(req.body.km_odometro);
    if (!litros || litros <= 0) bad('Ingresa los litros cargados.');
    if (km == null || km < 0) bad('Ingresa el kilometraje del tablero.');
    const id = insertar(db, 'fuel_logs', { vehicle_id: Number(req.params.id), fecha: req.body.fecha || hoyStr(), litros, monto: n(req.body.monto), km_odometro: km, nota: req.body.nota ?? null });
    db.prepare('UPDATE vehicles SET km_actual = ? WHERE id = ? AND (km_actual IS NULL OR km_actual < ?)').run(km, req.params.id, km);
    res.status(201).json({ id });
  });
  r.delete('/cargas/:id', (req, res) => { db.prepare('DELETE FROM fuel_logs WHERE id = ?').run(req.params.id); res.json({ ok: true }); });

  // ---------- Personal y productos ----------
  const PER_COLS = ['nombre', 'telefono', 'costo_hora', 'rol', 'activo'];
  const PER_NUM = new Set(['costo_hora', 'activo']);
  const PROD_COLS = ['nombre', 'sku', 'unidad', 'peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm', 'apilable', 'rotable', 'activo'];
  const PROD_NUM = new Set(['peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm', 'apilable', 'rotable', 'activo']);
  const validarRol = (d) => { if ('rol' in d && !ROLES.some((x) => x.id === d.rol)) bad('La función debe ser conductor o bodega.'); };
  const validarMedidas = (d) => {
    for (const k of ['peso_kg', 'largo_cm', 'ancho_cm', 'alto_cm']) if (d[k] != null && d[k] <= 0) bad('Las medidas y el peso deben ser mayores que cero.');
    for (const k of ['apilable', 'rotable']) if (k in d) d[k] = d[k] ? 1 : 0;
  };
  r.get('/personal', (req, res) => res.json(db.prepare('SELECT * FROM drivers WHERE activo = 1 ORDER BY rol, nombre').all()));
  r.post('/personal', (req, res) => {
    const d = armar(req.body, PER_COLS, null, PER_NUM);
    if (!d.nombre) bad('Ingresa el nombre.');
    d.rol ??= 'conductor';
    validarRol(d);
    res.status(201).json({ id: insertar(db, 'drivers', d) });
  });
  r.put('/personal/:id', (req, res) => {
    const d = armar(req.body, PER_COLS, null, PER_NUM);
    if ('nombre' in d && !d.nombre) bad('El nombre no puede quedar vacío.');
    validarRol(d);
    actualizar(db, 'drivers', req.params.id, d);
    res.json(db.prepare('SELECT * FROM drivers WHERE id = ?').get(req.params.id));
  });
  r.delete('/personal/:id', (req, res) => { db.prepare('UPDATE drivers SET activo = 0 WHERE id = ?').run(req.params.id); res.json({ desactivado: true }); });

  r.get('/productos', (req, res) => res.json(db.prepare('SELECT * FROM products WHERE activo = 1 ORDER BY nombre').all().map((p) => ({ ...p, medidas_completas: medidasProducto(p).faltan.length === 0 }))));
  r.post('/productos', (req, res) => {
    const d = armar(req.body, PROD_COLS, null, PROD_NUM);
    if (!d.nombre) bad('Ingresa el nombre del producto.');
    validarMedidas(d);
    res.status(201).json({ id: insertar(db, 'products', d) });
  });
  r.put('/productos/:id', (req, res) => {
    const d = armar(req.body, PROD_COLS, null, PROD_NUM);
    if ('nombre' in d && !d.nombre) bad('El nombre no puede quedar vacío.');
    validarMedidas(d);
    actualizar(db, 'products', req.params.id, d);
    const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json({ ...p, medidas_completas: medidasProducto(p).faltan.length === 0 });
  });
  r.delete('/productos/:id', (req, res) => { db.prepare('UPDATE products SET activo = 0 WHERE id = ?').run(req.params.id); res.json({ desactivado: true }); });

  // ---------- Clientes ----------
  function normalizarCliente(d) {
    if (d.comuna) {
      const hit = buscarComuna(d.comuna);
      if (hit) { d.comuna = hit.comuna; if (!d.region) d.region = hit.region; }
    }
    if (d.region) d.region = buscarRegion(d.region) ?? d.region;
    if (d.lat != null && (d.lat < -56 || d.lat > -17)) bad('La latitud debe estar dentro de Chile (entre -56 y -17).');
    if (d.lng != null && (d.lng < -110 || d.lng > -66)) bad('La longitud debe estar dentro de Chile (entre -110 y -66).');
    if ((d.lat == null) !== (d.lng == null) && ('lat' in d || 'lng' in d)) bad('Ingresa latitud y longitud juntas.');
    return d;
  }
  async function geolocalizarCliente(id) {
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!c.direccion) throw new ApiError(400, 'sin_direccion', `El cliente ${c.nombre} no tiene dirección.`);
    const g = await google.geocode({ direccion: c.direccion, comuna: c.comuna, region: c.region });
    actualizar(db, 'clients', id, { lat: g.lat, lng: g.lng, geo_precision: g.precision, comuna: c.comuna ?? g.comuna, region: c.region ?? g.region });
    return g;
  }
  const consultaClientes = `SELECT c.*,
      (SELECT COUNT(*) FROM deliveries d WHERE d.client_id = c.id AND d.estado IN ('pendiente', 'reprogramada')) AS pendientes,
      (SELECT COUNT(*) FROM deliveries d WHERE d.client_id = c.id AND d.estado = 'realizada') AS entregas_realizadas,
      (SELECT MAX(d.fecha_realizada) FROM deliveries d WHERE d.client_id = c.id AND d.estado = 'realizada') AS ultima_entrega
    FROM clients c`;

  r.get('/clientes', (req, res) => {
    const { q, comuna, region, pendiente, lat, lng, radio_km, incluir_inactivos, sin_coordenadas } = req.query;
    const where = [];
    const params = [];
    if (!incluir_inactivos) where.push('c.activo = 1');
    if (comuna) { where.push('c.comuna = ?'); params.push(comuna); }
    if (region) { where.push('c.region = ?'); params.push(region); }
    if (sin_coordenadas) where.push('c.lat IS NULL');
    let filas = db.prepare(`${consultaClientes} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY c.nombre`).all(...params);
    if (pendiente === '1') filas = filas.filter((c) => c.pendientes > 0);
    if (q) {
      const t = normalizar(q);
      filas = filas.filter((c) => normalizar([c.nombre, c.empresa, c.direccion, c.comuna, c.region, c.telefono].join(' ')).includes(t));
    }
    if (lat && lng) {
      const o = { lat: Number(lat), lng: Number(lng) };
      const radio = Number(radio_km) || Infinity;
      filas = filas
        .filter((c) => c.lat != null)
        .map((c) => ({ ...c, distancia_recta_km: haversineKm(o, c) }))
        .filter((c) => c.distancia_recta_km <= radio)
        .sort((a, b) => a.distancia_recta_km - b.distancia_recta_km);
    }
    res.json(filas);
  });

  r.get('/clientes/plantilla.xlsx', wrap(async (req, res) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Clientes');
    ws.columns = ['nombre', 'empresa', 'direccion', 'comuna', 'region', 'telefono', 'frecuencia_compra', 'observaciones', 'lat', 'lng'].map((h) => ({ header: h, key: h, width: 22 }));
    ws.getRow(1).font = { bold: true };
    const ayuda = wb.addWorksheet('Instrucciones');
    ayuda.addRow(['Completa una fila por cliente en la hoja "Clientes". Solo "nombre" es obligatorio.']);
    ayuda.addRow(['Si no incluyes lat y lng, usa "Geolocalizar pendientes" en Gestión de clientes para obtenerlas con Google.']);
    ayuda.addRow(['frecuencia_compra: semanal, quincenal, mensual, bimestral u ocasional.']);
    ayuda.getColumn(1).width = 110;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="plantilla_clientes_bhumi.xlsx"');
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  }));

  r.post('/clientes/importar', express.raw({ type: '*/*', limit: '25mb' }), wrap(async (req, res) => {
    if (!req.body?.length) bad('Adjunta un archivo Excel (.xlsx).');
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(req.body); } catch { bad('No se pudo leer el archivo. Debe ser un Excel .xlsx.'); }
    const ws = wb.getWorksheet('Clientes') ?? wb.worksheets[0];
    const cab = {};
    ws.getRow(1).eachCell((c, i) => { cab[normalizar(c.value).replace(/ /g, '_')] = i; });
    const alias = { latitud: 'lat', longitud: 'lng', lon: 'lng', frecuencia: 'frecuencia_compra', telefono_de_contacto: 'telefono', direccion_de_entrega: 'direccion', cliente: 'nombre' };
    for (const [a, real] of Object.entries(alias)) if (cab[a] && !cab[real]) cab[real] = cab[a];
    if (!cab.nombre) bad('El archivo debe tener una columna "nombre" en la primera fila.');
    const val = (row, k) => { const v = cab[k] ? row.getCell(cab[k]).value : null; return v == null ? null : typeof v === 'object' ? String(v.text ?? v.result ?? '') : v; };
    const ok = [];
    const errores = [];
    tx(db, () => {
      ws.eachRow((row, i) => {
        if (i === 1) return;
        const nombre = val(row, 'nombre');
        if (!nombre) return;
        try {
          const d = normalizarCliente({
            nombre: String(nombre).trim(), empresa: val(row, 'empresa'), direccion: val(row, 'direccion'), comuna: val(row, 'comuna'), region: val(row, 'region'),
            telefono: val(row, 'telefono') != null ? String(val(row, 'telefono')) : null, frecuencia_compra: val(row, 'frecuencia_compra'), observaciones: val(row, 'observaciones'),
            lat: val(row, 'lat') != null ? n(String(val(row, 'lat')).replace(',', '.')) : null, lng: val(row, 'lng') != null ? n(String(val(row, 'lng')).replace(',', '.')) : null,
          });
          if (d.lat != null) d.geo_precision = 'manual';
          ok.push(insertar(db, 'clients', d));
        } catch (e) { errores.push({ fila: i, nombre: String(nombre), error: e.message }); }
      });
    });
    res.json({ importados: ok.length, errores });
  }));

  r.post('/clientes/geolocalizar-pendientes', wrap(async (req, res) => {
    const filas = db.prepare('SELECT id, nombre FROM clients WHERE activo = 1 AND lat IS NULL AND direccion IS NOT NULL LIMIT 100').all();
    const resultado = { geolocalizados: 0, aproximados: 0, fallidos: [], restantes: 0 };
    for (const c of filas) {
      try {
        const g = await geolocalizarCliente(c.id);
        resultado.geolocalizados++;
        if (g.precision === 'aproximada') resultado.aproximados++;
      } catch (e) {
        if (e instanceof GoogleError && ['sin_clave', 'sin_permiso', 'cuota', 'red'].includes(e.code)) throw e;
        resultado.fallidos.push({ id: c.id, nombre: c.nombre, error: e.message });
      }
    }
    resultado.restantes = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE activo = 1 AND lat IS NULL AND direccion IS NOT NULL').get().n;
    res.json(resultado);
  }));

  r.post('/geocodificar', wrap(async (req, res) => {
    if (!req.body.direccion) bad('Ingresa una dirección.');
    res.json(await google.geocode({ direccion: req.body.direccion, comuna: req.body.comuna, region: req.body.region }));
  }));

  r.get('/clientes/:id', (req, res) => {
    const c = db.prepare(`${consultaClientes} WHERE c.id = ?`).get(req.params.id);
    if (!c) throw new NoEncontrado('Cliente no encontrado.');
    const entregas = db.prepare(`SELECT d.*, t.fecha AS fecha_despacho FROM deliveries d LEFT JOIN trips t ON t.id = d.trip_id
      WHERE d.client_id = ? ORDER BY COALESCE(d.fecha_realizada, d.fecha, d.created_at) DESC`).all(req.params.id)
      .map((d) => ({ ...d, items: itemsDeEntrega(db, d.id) }));
    const productos = db.prepare(`SELECT COALESCE(p.nombre, di.descripcion) AS producto, SUM(di.cantidad) AS cantidad
      FROM delivery_items di JOIN deliveries d ON d.id = di.delivery_id LEFT JOIN products p ON p.id = di.product_id
      WHERE d.client_id = ? AND d.estado = 'realizada' GROUP BY COALESCE(p.nombre, di.descripcion) ORDER BY cantidad DESC`).all(req.params.id);
    const costo = db.prepare(`SELECT COUNT(*) AS entregas, COALESCE(SUM(s.costo_asignado), 0) AS total FROM trip_stops s JOIN trips t ON t.id = s.trip_id
      WHERE s.client_id = ? AND t.estado != 'cancelado'`).get(req.params.id);
    res.json({ ...c, entregas, productos_despachados: productos, costo_entrega: { entregas: costo.entregas, total: costo.total, promedio: costo.entregas ? costo.total / costo.entregas : null } });
  });

  r.post('/clientes', wrap(async (req, res) => {
    const d = normalizarCliente(armar(req.body, CLI_COLS, null, CLI_NUM));
    if (!d.nombre) bad('Ingresa el nombre del cliente.');
    if (d.lat != null && !d.geo_precision) d.geo_precision = 'manual';
    const id = insertar(db, 'clients', d);
    let aviso = null;
    if (req.body.geolocalizar && d.lat == null && d.direccion) {
      try { await geolocalizarCliente(id); } catch (e) { aviso = `Cliente guardado sin ubicación: ${e.message}`; }
    }
    res.status(201).json({ ...db.prepare(`${consultaClientes} WHERE c.id = ?`).get(id), aviso });
  }));
  r.put('/clientes/:id', wrap(async (req, res) => {
    const d = normalizarCliente(armar(req.body, CLI_COLS, null, CLI_NUM));
    if ('nombre' in d && !d.nombre) bad('El nombre no puede quedar vacío.');
    const antes = db.prepare('SELECT * FROM clients WHERE id = ?').get(req.params.id);
    if (!antes) throw new NoEncontrado('Cliente no encontrado.');
    const cambioDir = ['direccion', 'comuna'].some((k) => k in d && d[k] !== antes[k]);
    if (cambioDir && !('lat' in d)) { d.lat = null; d.lng = null; d.geo_precision = null; }
    if ('lat' in d && d.lat != null && !('geo_precision' in d)) d.geo_precision = 'manual';
    actualizar(db, 'clients', req.params.id, d);
    let aviso = null;
    if (req.body.geolocalizar && d.lat == null && (d.direccion ?? antes.direccion)) {
      try { await geolocalizarCliente(req.params.id); } catch (e) { aviso = `Cambios guardados sin ubicación: ${e.message}`; }
    }
    res.json({ ...db.prepare(`${consultaClientes} WHERE c.id = ?`).get(req.params.id), aviso });
  }));
  r.post('/clientes/:id/geolocalizar', wrap(async (req, res) => {
    const g = await geolocalizarCliente(req.params.id);
    res.json({ lat: g.lat, lng: g.lng, precision: g.precision, direccion: g.direccion_formateada });
  }));
  r.delete('/clientes/:id', (req, res) => {
    const usos = db.prepare('SELECT COUNT(*) AS n FROM deliveries WHERE client_id = ?').get(req.params.id).n;
    if (usos) { db.prepare('UPDATE clients SET activo = 0 WHERE id = ?').run(req.params.id); return res.json({ desactivado: true }); }
    db.prepare('DELETE FROM clients WHERE id = ?').run(req.params.id);
    res.json({ eliminado: true });
  });

  // ---------- Entregas (pedidos por cliente) ----------
  function entregaCompleta(row) {
    const items = itemsDeEntrega(db, row.id);
    const conPeso = items.length && items.every((i) => i.peso_kg != null);
    return {
      ...row,
      items,
      peso_kg: conPeso ? items.reduce((a, i) => a + i.cantidad * i.peso_kg, 0) : null,
      unidades: items.reduce((a, i) => a + i.cantidad, 0),
    };
  }
  const consultaEntregas = `SELECT d.*, c.nombre AS cliente, c.empresa, c.comuna, c.region, c.direccion AS cliente_direccion, c.lat AS cliente_lat, c.lng AS cliente_lng,
      t.fecha AS fecha_despacho, t.estado AS estado_despacho FROM deliveries d JOIN clients c ON c.id = d.client_id LEFT JOIN trips t ON t.id = d.trip_id`;

  r.get('/entregas', (req, res) => {
    const { estado, comuna, region, desde, hasta, client_id, sin_ruta } = req.query;
    const where = [];
    const params = [];
    if (estado === 'pendientes') where.push("d.estado IN ('pendiente', 'reprogramada')");
    else if (estado) { where.push('d.estado = ?'); params.push(estado); }
    if (comuna) { where.push('c.comuna = ?'); params.push(comuna); }
    if (region) { where.push('c.region = ?'); params.push(region); }
    if (client_id) { where.push('d.client_id = ?'); params.push(client_id); }
    if (sin_ruta === '1') where.push('d.trip_id IS NULL');
    if (desde) { where.push('COALESCE(d.fecha_realizada, d.fecha) >= ?'); params.push(desde); }
    if (hasta) { where.push('COALESCE(d.fecha_realizada, d.fecha) <= ?'); params.push(hasta); }
    const filas = db.prepare(`${consultaEntregas} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY COALESCE(d.fecha, d.created_at), d.id`).all(...params);
    res.json(filas.map(entregaCompleta));
  });

  function guardarItems(entregaId, items) {
    db.prepare('DELETE FROM delivery_items WHERE delivery_id = ?').run(entregaId);
    const ins = db.prepare('INSERT INTO delivery_items (delivery_id, product_id, descripcion, cantidad) VALUES (?, ?, ?, ?)');
    for (const it of items ?? []) {
      const cant = n(it.cantidad);
      if (!cant || cant <= 0) bad('Cada producto necesita una cantidad mayor que cero.');
      if (!it.product_id && !it.descripcion) bad('Cada línea necesita un producto.');
      ins.run(entregaId, it.product_id ?? null, it.descripcion ?? null, cant);
    }
  }
  r.post('/entregas', (req, res) => {
    const b = req.body;
    const cliente = db.prepare('SELECT * FROM clients WHERE id = ?').get(b.client_id);
    if (!cliente) bad('Selecciona un cliente.');
    const lat = n(b.lat), lng = n(b.lng);
    const id = tx(db, () => {
      const nid = insertar(db, 'deliveries', {
        client_id: cliente.id, direccion_entrega: b.direccion_entrega || null, lat, lng, fecha: b.fecha || null,
        ventana_desde: b.ventana_desde || null, ventana_hasta: b.ventana_hasta || null, observaciones: b.observaciones || null,
      });
      guardarItems(nid, b.items);
      return nid;
    });
    res.status(201).json(entregaCompleta(db.prepare(`${consultaEntregas} WHERE d.id = ?`).get(id)));
  });
  r.put('/entregas/:id', (req, res) => {
    const b = req.body;
    const actual = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!actual) throw new NoEncontrado('Entrega no encontrada.');
    if (actual.estado === 'realizada') bad('Una entrega realizada no se puede modificar.');
    tx(db, () => {
      const d = {};
      for (const k of ['direccion_entrega', 'fecha', 'ventana_desde', 'ventana_hasta', 'observaciones']) if (k in b) d[k] = b[k] || null;
      if ('lat' in b) { d.lat = n(b.lat); d.lng = n(b.lng); }
      if ('client_id' in b && actual.trip_id == null) d.client_id = b.client_id;
      actualizar(db, 'deliveries', req.params.id, d);
      if ('items' in b) guardarItems(req.params.id, b.items);
    });
    res.json(entregaCompleta(db.prepare(`${consultaEntregas} WHERE d.id = ?`).get(req.params.id)));
  });
  r.post('/entregas/:id/estado', (req, res) => {
    const e = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!e) throw new NoEncontrado('Entrega no encontrada.');
    const { estado, fecha, motivo } = req.body;
    if (!['pendiente', 'realizada', 'reprogramada', 'cancelada'].includes(estado)) bad('Estado no válido.');
    if (e.trip_id && estado !== 'realizada') bad(`Esta entrega está en el despacho N° ${e.trip_id}. Cancela el despacho o márcala como no entregada al completarlo.`);
    if (estado === 'reprogramada' && !fecha) bad('Indica la nueva fecha para reprogramar.');
    db.prepare('UPDATE deliveries SET estado = ?, fecha = COALESCE(?, fecha), motivo_reprogramacion = ?, fecha_realizada = ? WHERE id = ?')
      .run(estado, estado === 'reprogramada' ? fecha : null, estado === 'reprogramada' ? motivo ?? null : null, estado === 'realizada' ? fecha || hoyStr() : null, e.id);
    res.json(entregaCompleta(db.prepare(`${consultaEntregas} WHERE d.id = ?`).get(e.id)));
  });
  r.delete('/entregas/:id', (req, res) => {
    const e = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(req.params.id);
    if (!e) throw new NoEncontrado('Entrega no encontrada.');
    if (e.trip_id) bad(`Esta entrega está en el despacho N° ${e.trip_id}. Cancela ese despacho primero.`);
    if (e.estado === 'realizada') bad('Una entrega realizada queda en el historial y no se elimina.');
    db.prepare('DELETE FROM deliveries WHERE id = ?').run(e.id);
    res.json({ eliminado: true });
  });

  // ---------- Planificación ----------
  function paradasDeBody(b) {
    if (b.entrega_ids?.length) return stopsDesdeEntregas(db, b.entrega_ids.map(Number));
    if (b.cliente_ids?.length) return stopsDesdeClientes(db, b.cliente_ids.map(Number));
    throw new PlanError('sin_paradas', 'Selecciona al menos un cliente o entrega.');
  }
  /** ¿Cabe la carga de las entregas en cada vehículo? Solo se calcula con entregas (no con clientes sueltos). */
  function cubicajePorVehiculo(entregaIds, vehicleIds) {
    if (!entregaIds?.length) return [];
    const vehs = db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo' ORDER BY id").all().filter((v) => !vehicleIds?.length || vehicleIds.includes(v.id));
    return vehs.map((v) => {
      const c = cubicarEntregas(db, v, entregaIds);
      const base = { vehicle_id: v.id, nombre: v.nombre ?? `${v.marca} ${v.modelo}` };
      if (!c.ok) return { ...base, calculable: false, faltan: c.faltan };
      const r = c.resultado;
      return { ...base, calculable: true, cabe: r.cabe, limitante: r.limitante, ocupacion_volumen_pct: r.ocupacion_volumen_pct, peso_pct: r.peso_pct, unidades_colocadas: r.unidades_colocadas, unidades_total: r.unidades_total, advertencias: r.advertencias };
    });
  }
  const opcionesPlan = (b) => ({ fecha: b.fecha, hora: b.hora, retorna: b.retorna !== false, extras: b.extras ?? {}, driver_id: b.driver_id ?? null });

  r.post('/plan', wrap(async (req, res) => {
    const b = req.body;
    const stops = paradasDeBody(b);
    const out = await planner.plan({ stops, vehicle_ids: b.vehicle_ids?.map(Number), trazar: b.trazar !== false, ...opcionesPlan(b) });
    res.json({ ...out, seguridad: seguridadDeParadas(db, stops), cubicaje: cubicajePorVehiculo(b.entrega_ids?.map(Number), b.vehicle_ids?.map(Number)) });
  }));
  r.post('/plan/ruta-manual', wrap(async (req, res) => {
    const b = req.body;
    res.json(await planner.rutaEnOrden({ stops: paradasDeBody(b), vehicle_id: Number(b.vehicle_id), trazar: b.trazar !== false, ...opcionesPlan(b) }));
  }));
  r.post('/plan/matriz', wrap(async (req, res) => {
    const stops = paradasDeBody(req.body);
    const m = await planner.matrizEntre(stops, req.body);
    res.json({ ...m, paradas: stops.map((s) => ({ key: s.key, nombre: s.nombre, comuna: s.comuna })) });
  }));
  r.post('/plan/dividir', wrap(async (req, res) => {
    const stops = paradasDeBody(req.body);
    const sinCoord = stops.filter((s) => s.lat == null);
    if (sinCoord.length) throw new PlanError('sin_coordenadas', `Faltan coordenadas de: ${sinCoord.map((s) => s.nombre).join(', ')}.`);
    const out = await planner.dividir({ stops, vehicle_id: req.body.vehicle_id ? Number(req.body.vehicle_id) : null });
    res.json({ ...out, paradas: stops.map((s) => ({ key: s.key, nombre: s.nombre, peso_kg: s.peso_kg })) });
  }));

  // ---------- Despachos (viajes) ----------
  const consultaTrips = `SELECT t.*, v.marca, v.modelo, v.nombre AS vehiculo_nombre, dr.nombre AS conductor, pr.nombre AS preparador
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id LEFT JOIN drivers pr ON pr.id = t.preparador_id`;

  r.get('/despachos', (req, res) => {
    const { desde, hasta, vehicle_id, estado } = req.query;
    const where = [];
    const params = [];
    if (desde) { where.push('t.fecha >= ?'); params.push(desde); }
    if (hasta) { where.push('t.fecha <= ?'); params.push(hasta); }
    if (vehicle_id) { where.push('t.vehicle_id = ?'); params.push(vehicle_id); }
    if (estado) { where.push('t.estado = ?'); params.push(estado); }
    const filas = db.prepare(`${consultaTrips} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.fecha DESC, t.id DESC`).all(...params);
    res.json(filas.map(({ plan_json, polyline, ...t }) => ({ ...t, costo_km: t.distancia_km ? t.costo_total / t.distancia_km : null, costo_cliente: t.n_paradas ? t.costo_total / t.n_paradas : null })));
  });
  r.get('/despachos/:id', (req, res) => {
    const t = db.prepare(`${consultaTrips} WHERE t.id = ?`).get(req.params.id);
    if (!t) throw new NoEncontrado('Despacho no encontrado.');
    const paradas = db.prepare(`SELECT s.*, c.nombre, c.empresa, c.direccion, c.comuna, c.region, c.telefono, COALESCE(d.lat, c.lat) AS lat, COALESCE(d.lng, c.lng) AS lng,
        d.estado AS estado_entrega, d.ventana_desde, d.ventana_hasta
      FROM trip_stops s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN deliveries d ON d.id = s.delivery_id WHERE s.trip_id = ? ORDER BY s.orden`).all(t.id)
      .map((p) => ({ ...p, items: p.delivery_id ? itemsDeEntrega(db, p.delivery_id) : [] }));
    const s = getSettings(db);
    const veh = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(t.vehicle_id);
    const idsEntrega = paradas.map((p) => p.delivery_id).filter(Boolean);
    const cub = idsEntrega.length ? cubicarEntregas(db, veh, idsEntrega) : null;
    res.json({
      ...t,
      seguridad: seguridadDeParadas(db, paradas),
      cubicaje: cub?.ok ? { calculable: true, cabe: cub.resultado.cabe, ocupacion_volumen_pct: cub.resultado.ocupacion_volumen_pct, peso_pct: cub.resultado.peso_pct } : cub ? { calculable: false, faltan: cub.faltan } : null,
      plan: t.plan_json ? JSON.parse(t.plan_json) : null,
      plan_json: undefined,
      costo_km: t.distancia_km ? t.costo_total / t.distancia_km : null,
      costo_cliente: t.n_paradas ? t.costo_total / t.n_paradas : null,
      paradas,
      deposito: { lat: num(s.deposito_lat), lng: num(s.deposito_lng), direccion: `${s.deposito_direccion}, ${s.deposito_comuna}` },
    });
  });
  r.post('/despachos', wrap(async (req, res) => {
    const b = req.body;
    const ids = (b.entrega_ids ?? []).map(Number);
    if (!ids.length) bad('Selecciona las entregas del despacho.');
    if (!b.vehicle_id) bad('Elige el vehículo del despacho.');
    if (!b.fecha) bad('Indica la fecha del despacho.');
    const stops = stopsDesdeEntregas(db, ids);
    for (const s of stops) {
      if (!['pendiente', 'reprogramada'].includes(s.estado) || s.trip_id) bad(`La entrega de ${s.nombre} ya está en un despacho o fue cerrada.`);
    }
    const vehiculo = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(b.vehicle_id));
    if (!vehiculo) bad('El vehículo elegido no existe.');
    // Si hay medidas de productos y del vehículo, la carga debe caber físicamente (no solo por peso)
    const cub = cubicarEntregas(db, vehiculo, ids);
    if (cub.ok && !cub.resultado.cabe) {
      const rr = cub.resultado;
      throw new PlanError('capacidad', `La carga no cabe en ${vehiculo.nombre ?? `${vehiculo.marca} ${vehiculo.modelo}`} según el cubicaje: caben ${rr.unidades_colocadas} de ${rr.unidades_total} unidades${rr.peso_pct != null ? ` y el peso llega al ${Math.round(rr.peso_pct)}% de su capacidad` : ''}. Elige otro vehículo o divide el despacho.`);
    }
    if (b.preparador_id && !db.prepare("SELECT 1 FROM drivers WHERE id = ? AND rol = 'preparador'").get(Number(b.preparador_id))) bad('El responsable de bodega elegido no existe.');
    const orden = (b.orden ?? ids).map(Number);
    const out = await planner.crearDespacho({
      stops, orden_keys: orden.map((i) => `d${i}`), alternativa: b.alternativa ?? 'manual', vehicle_id: Number(b.vehicle_id), driver_id: b.driver_id ? Number(b.driver_id) : null,
      fecha: b.fecha, hora: b.hora ?? null, retorna: b.retorna !== false, extras: b.extras ?? {}, notas: b.notas ?? null,
    });
    if (b.preparador_id) db.prepare('UPDATE trips SET preparador_id = ? WHERE id = ?').run(Number(b.preparador_id), out.trip_id);
    res.status(201).json({ ...out, cubicaje_aviso: cub.ok ? null : cub.faltan });
  }));
  r.post('/despachos/:id/estado', (req, res) => {
    const t = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!t) throw new NoEncontrado('Despacho no encontrado.');
    const { estado, no_entregadas = [], nueva_fecha, motivo, motivos = {} } = req.body;
    if (!['en_ruta', 'completado', 'cancelado'].includes(estado)) bad('Estado de despacho no válido.');
    if (t.estado === 'completado' || t.estado === 'cancelado') bad(`El despacho ya está ${t.estado}.`);
    tx(db, () => {
      if (estado === 'en_ruta') db.prepare("UPDATE trips SET estado = 'en_ruta' WHERE id = ?").run(t.id);
      if (estado === 'cancelado') {
        db.prepare("UPDATE trips SET estado = 'cancelado' WHERE id = ?").run(t.id);
        db.prepare('UPDATE deliveries SET trip_id = NULL, orden = NULL WHERE trip_id = ?').run(t.id);
      }
      if (estado === 'completado') {
        const fallidas = new Set(no_entregadas.map(Number));
        if (fallidas.size && !nueva_fecha) bad('Indica la nueva fecha para las entregas no realizadas.');
        const entregas = db.prepare('SELECT id FROM deliveries WHERE trip_id = ?').all(t.id);
        const marcar = db.prepare('UPDATE trip_stops SET resultado = ?, motivo_no_entrega = ? WHERE trip_id = ? AND delivery_id = ?');
        for (const e of entregas) marcar.run(fallidas.has(e.id) ? 'no_entregada' : 'entregada', fallidas.has(e.id) ? (motivos[e.id] || motivo) ?? null : null, t.id, e.id);
        // Paradas sin entrega asociada (despacho armado con clientes sueltos) se dan por entregadas
        db.prepare("UPDATE trip_stops SET resultado = 'entregada' WHERE trip_id = ? AND delivery_id IS NULL AND resultado IS NULL").run(t.id);
        for (const e of entregas) {
          if (fallidas.has(e.id)) {
            db.prepare("UPDATE deliveries SET estado = 'reprogramada', trip_id = NULL, orden = NULL, fecha = ?, motivo_reprogramacion = ? WHERE id = ?").run(nueva_fecha, (motivos[e.id] || motivo) ?? null, e.id);
          } else {
            db.prepare("UPDATE deliveries SET estado = 'realizada', fecha_realizada = ? WHERE id = ?").run(t.fecha, e.id);
          }
        }
        db.prepare("UPDATE trips SET estado = 'completado', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(t.id);
        db.prepare('UPDATE vehicles SET km_actual = km_actual + ? WHERE id = ? AND km_actual IS NOT NULL').run(t.distancia_km ?? 0, t.vehicle_id);
      }
    });
    res.json({ ok: true });
  });
  r.get('/despachos/:id/ruta-conductor', (req, res) => {
    const info = rutaParaConductor(db, Number(req.params.id), { max: n(req.query.max) ?? 9 });
    if (!info) throw new NoEncontrado('Despacho no encontrado.');
    res.json(info);
  });
  r.get('/despachos/:id/tiempos', (req, res) => res.json(tiemposDespacho(db, Number(req.params.id))));
  r.put('/despachos/:id/tiempos', (req, res) => {
    guardarTiempos(db, Number(req.params.id), req.body.eventos);
    res.json(tiemposDespacho(db, Number(req.params.id)));
  });
  r.put('/despachos/:id/personal', (req, res) => {
    const t = db.prepare('SELECT id FROM trips WHERE id = ?').get(req.params.id);
    if (!t) throw new NoEncontrado('Despacho no encontrado.');
    const conductor = req.body.driver_id ? Number(req.body.driver_id) : null;
    const preparador = req.body.preparador_id ? Number(req.body.preparador_id) : null;
    if (conductor && !db.prepare("SELECT 1 FROM drivers WHERE id = ? AND rol = 'conductor'").get(conductor)) bad('El conductor elegido no existe.');
    if (preparador && !db.prepare("SELECT 1 FROM drivers WHERE id = ? AND rol = 'preparador'").get(preparador)) bad('El responsable de bodega elegido no existe.');
    db.prepare('UPDATE trips SET driver_id = ?, preparador_id = ? WHERE id = ?').run(conductor, preparador, t.id);
    res.json({ ok: true });
  });
  r.post('/despachos/:id/gastos', (req, res) => {
    const t = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!t) throw new NoEncontrado('Despacho no encontrado.');
    const nuevo = { peajes: n(req.body.peajes) ?? 0, estacionamientos: n(req.body.estacionamientos) ?? 0, otros_gastos: n(req.body.otros_gastos) ?? 0 };
    const viejo = (t.peajes ?? 0) + (t.estacionamientos ?? 0) + (t.otros_gastos ?? 0);
    const base = (t.costo_otros ?? 0) - viejo;
    const costoOtros = base + nuevo.peajes + nuevo.estacionamientos + nuevo.otros_gastos;
    const total = (t.costo_combustible ?? 0) + (t.costo_desgaste ?? 0) + costoOtros;
    db.prepare('UPDATE trips SET peajes = ?, estacionamientos = ?, otros_gastos = ?, costo_otros = ?, costo_total = ? WHERE id = ?')
      .run(nuevo.peajes, nuevo.estacionamientos, nuevo.otros_gastos, costoOtros, total, t.id);
    res.json({ costo_otros: costoOtros, costo_total: total });
  });
  r.delete('/despachos/:id', (req, res) => {
    const t = db.prepare('SELECT * FROM trips WHERE id = ?').get(req.params.id);
    if (!t) throw new NoEncontrado('Despacho no encontrado.');
    if (t.estado === 'completado') bad('Un despacho completado queda en el historial y no se elimina.');
    tx(db, () => {
      db.prepare('UPDATE deliveries SET trip_id = NULL, orden = NULL WHERE trip_id = ?').run(t.id);
      db.prepare('DELETE FROM trips WHERE id = ?').run(t.id);
    });
    res.json({ eliminado: true });
  });

  // ---------- Panel de análisis ----------
  r.get('/panel', (req, res) => res.json(panelAnalisis(db, { mes: req.query.mes, desde: req.query.desde, hasta: req.query.hasta })));

  // ---------- Control de costos ----------
  r.get('/control-costos', (req, res) => res.json(controlCostos(db, { mes: req.query.mes, desde: req.query.desde, hasta: req.query.hasta, vehicle_id: req.query.vehicle_id })));
  r.get('/gastos', (req, res) => res.json(listarGastos(db, { mes: req.query.mes, desde: req.query.desde, hasta: req.query.hasta, vehicle_id: req.query.vehicle_id, categoria: req.query.categoria })));
  const GASTO_COLS = ['vehicle_id', 'fecha', 'categoria', 'monto', 'km_odometro', 'proximo_km', 'proveedor', 'detalle'];
  const GASTO_NUM = new Set(['vehicle_id', 'monto', 'km_odometro', 'proximo_km']);
  function validarGasto(d, completo) {
    if ((completo || 'categoria' in d) && !CATEGORIAS_GASTO.some((c) => c.id === d.categoria)) bad('Elige una categoría de gasto válida.');
    if ((completo || 'monto' in d) && !(d.monto > 0)) bad('El monto debe ser mayor que cero.');
    if ((completo || 'fecha' in d) && !/^\d{4}-\d{2}-\d{2}$/.test(d.fecha ?? '')) bad('Indica la fecha del gasto.');
    if (d.vehicle_id != null && !db.prepare('SELECT 1 FROM vehicles WHERE id = ?').get(d.vehicle_id)) bad('El vehículo no existe.');
    if (d.km_odometro != null && d.km_odometro < 0) bad('El kilometraje no puede ser negativo.');
    if (d.categoria === 'mantencion_preventiva' && d.vehicle_id == null && completo) bad('Una mantención preventiva debe asociarse a un vehículo.');
  }
  function subirKmActual(d) {
    if (d.vehicle_id != null && d.km_odometro != null) db.prepare('UPDATE vehicles SET km_actual = ? WHERE id = ? AND (km_actual IS NULL OR km_actual < ?)').run(d.km_odometro, d.vehicle_id, d.km_odometro);
  }
  r.post('/gastos', (req, res) => {
    const d = armar(req.body, GASTO_COLS, new Set(['fecha', 'categoria', 'proveedor', 'detalle']));
    d.fecha ??= hoyLocal();
    for (const k of GASTO_NUM) if (k in req.body) d[k] = n(req.body[k]);
    validarGasto(d, true);
    const id = insertar(db, 'gastos', d);
    subirKmActual(d);
    res.status(201).json({ id });
  });
  r.put('/gastos/:id', (req, res) => {
    const d = armar(req.body, GASTO_COLS, new Set(['fecha', 'categoria', 'proveedor', 'detalle']));
    for (const k of GASTO_NUM) if (k in req.body) d[k] = n(req.body[k]);
    validarGasto(d, false);
    actualizar(db, 'gastos', req.params.id, d);
    subirKmActual({ ...db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id) });
    res.json(db.prepare('SELECT * FROM gastos WHERE id = ?').get(req.params.id));
  });
  r.delete('/gastos/:id', (req, res) => { db.prepare('DELETE FROM gastos WHERE id = ?').run(req.params.id); res.json({ eliminado: true }); });

  // ---------- Indicadores KPI del personal ----------
  r.get('/kpi/personal', (req, res) => res.json(kpisPersonal(db, { mes: req.query.mes, desde: req.query.desde, hasta: req.query.hasta, driver_id: req.query.driver_id, vehicle_id: req.query.vehicle_id })));

  // ---------- Kilometraje y estado de la flota ----------
  r.get('/flota', (req, res) => {
    const estado = estadoFlota(db, { nSemanas: Math.min(26, Math.max(4, n(req.query.semanas) ?? 8)) });
    res.json({ vehiculos: estado, alertas: alertasFlota(estado), semana_actual: lunesDe(hoyLocal()) });
  });
  r.put('/km-semanal', (req, res) => {
    const vehicle_id = Number(req.body.vehicle_id);
    if (!db.prepare('SELECT 1 FROM vehicles WHERE id = ?').get(vehicle_id)) bad('Elige un vehículo.');
    const fecha = req.body.semana_inicio ?? req.body.fecha;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha ?? '')) bad('Indica la semana (cualquier día de esa semana sirve).');
    const km = n(req.body.km), odometro = n(req.body.odometro);
    if (km == null || km < 0) bad('Ingresa los kilómetros recorridos en la semana.');
    if (odometro != null && odometro < 0) bad('El odómetro no puede ser negativo.');
    const semana = lunesDe(fecha);
    db.prepare(`INSERT INTO km_semanal (vehicle_id, semana_inicio, km, odometro, nota) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(vehicle_id, semana_inicio) DO UPDATE SET km = excluded.km, odometro = excluded.odometro, nota = excluded.nota`).run(vehicle_id, semana, km, odometro, req.body.nota || null);
    if (odometro != null) db.prepare('UPDATE vehicles SET km_actual = ? WHERE id = ? AND (km_actual IS NULL OR km_actual < ?)').run(odometro, vehicle_id, odometro);
    res.json({ vehicle_id, semana_inicio: semana, km, odometro });
  });
  r.get('/km-semanal', (req, res) => {
    const filas = db.prepare(`SELECT k.*, v.nombre AS vehiculo FROM km_semanal k JOIN vehicles v ON v.id = k.vehicle_id ${req.query.vehicle_id ? 'WHERE k.vehicle_id = ?' : ''} ORDER BY k.semana_inicio DESC, k.vehicle_id LIMIT 200`).all(...(req.query.vehicle_id ? [Number(req.query.vehicle_id)] : []));
    res.json(filas);
  });
  r.delete('/km-semanal/:id', (req, res) => { db.prepare('DELETE FROM km_semanal WHERE id = ?').run(req.params.id); res.json({ eliminado: true }); });

  // ---------- Cubicaje y consolidación ----------
  function entregasParaCubicar(b) {
    if (b.entrega_ids?.length) return itemsDeEntregasPlano(b.entrega_ids.map(Number));
    return (b.items ?? []).map((it) => {
      const producto = db.prepare('SELECT * FROM products WHERE id = ?').get(Number(it.product_id));
      if (!producto) bad('Un producto de la lista ya no existe.');
      const cantidad = n(it.cantidad);
      if (!(cantidad > 0)) bad('Cada producto necesita una cantidad mayor que cero.');
      return { producto, cantidad };
    });
  }
  function itemsDeEntregasPlano(ids) {
    return ids.flatMap((id) => db.prepare('SELECT di.cantidad, p.* FROM delivery_items di JOIN products p ON p.id = di.product_id WHERE di.delivery_id = ?').all(id).map(({ cantidad, ...producto }) => ({ producto, cantidad })));
  }
  r.post('/cubicaje/calcular', (req, res) => {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(req.body.vehicle_id));
    if (!v) bad('Elige un vehículo.');
    const items = entregasParaCubicar(req.body);
    if (!items.length) bad('Agrega al menos un producto con su cantidad.');
    res.json({ vehiculo: { id: v.id, nombre: v.nombre ?? `${v.marca} ${v.modelo}` }, ...cubicar(v, items) });
  });
  r.post('/cubicaje/comparar', (req, res) => {
    const items = entregasParaCubicar(req.body);
    if (!items.length) bad('Agrega al menos un producto con su cantidad.');
    const vehs = db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo' ORDER BY id").all();
    res.json(vehs.map((v) => {
      const base = { vehicle_id: v.id, nombre: v.nombre ?? `${v.marca} ${v.modelo}` };
      try {
        const c = cubicar(v, items);
        return { ...base, calculable: true, cabe: c.cabe, limitante: c.limitante, ocupacion_volumen_pct: c.ocupacion_volumen_pct, peso_pct: c.peso_pct, unidades_colocadas: c.unidades_colocadas, unidades_total: c.unidades_total, advertencias: c.advertencias };
      } catch (e) {
        if (e instanceof CubicajeError) return { ...base, calculable: false, faltan: e.extra };
        throw e;
      }
    }));
  });
  r.get('/cubicaje/capacidad', (req, res) => {
    const v = db.prepare('SELECT * FROM vehicles WHERE id = ?').get(Number(req.query.vehicle_id));
    if (!v) bad('Elige un vehículo.');
    const filas = db.prepare('SELECT * FROM products WHERE activo = 1 ORDER BY nombre').all().map((p) => {
      try { return { ...capacidadPorProducto(v, p), calculable: true }; } catch (e) {
        if (e instanceof CubicajeError) return { id: p.id, nombre: p.nombre, calculable: false, faltan: e.extra };
        throw e;
      }
    });
    res.json({ vehiculo: { id: v.id, nombre: v.nombre ?? `${v.marca} ${v.modelo}`, faltan: medidasVehiculo(v).faltan }, productos: filas });
  });
  r.get('/consolidacion', (req, res) => res.json(sugerirConsolidacion(db)));

  // ---------- Clientes, zonas y seguridad ----------
  const periodoDe = (q) => resolverPeriodo({ mes: q.mes, desde: q.desde, hasta: q.hasta });
  r.get('/zonas/concentracion', (req, res) => {
    const p = periodoDe(req.query);
    const por = req.query.por === 'zona' ? 'zona' : 'comuna';
    const incluir = req.query.incluir === 'todos' ? 'todos' : 'realizados';
    const sinPeriodo = !req.query.mes && !req.query.desde && !req.query.hasta;
    res.json({ periodo: sinPeriodo ? { etiqueta: 'Todo el historial', desde: null, hasta: null } : p, por, incluir, grupos: concentracionEntregas(db, { desde: sinPeriodo ? undefined : p.desde, hasta: sinPeriodo ? undefined : p.hasta_excl, por, incluir }) });
  });
  r.get('/zonas/mapa', (req, res) => {
    const sinPeriodo = !req.query.mes && !req.query.desde && !req.query.hasta;
    const p = periodoDe(req.query);
    const entregas = new Map(entregasPorCliente(db, { desde: sinPeriodo ? undefined : p.desde, hasta: sinPeriodo ? undefined : p.hasta_excl, incluir: req.query.incluir === 'todos' ? 'todos' : 'realizados' }).map((x) => [x.client_id, x.entregas]));
    const sectores = new Map(listarSectores(db).map((x) => [String(x.comuna).trim().toLowerCase(), x]));
    const clientes = db.prepare(`SELECT c.id, c.nombre, c.empresa, c.direccion, c.comuna, c.lat, c.lng,
        (SELECT COUNT(*) FROM deliveries d WHERE d.client_id = c.id AND d.estado IN ('pendiente','reprogramada')) AS pendientes
      FROM clients c WHERE c.activo = 1 AND c.lat IS NOT NULL AND c.lng IS NOT NULL`).all().map((c) => {
      const s = sectores.get(String(c.comuna ?? '').trim().toLowerCase());
      return { ...c, entregas: entregas.get(c.id) ?? 0, zona: s?.zona ?? null, seguridad: s?.seguridad ?? 'sin_evaluar' };
    });
    const sinUbicacion = db.prepare('SELECT COUNT(*) AS n FROM clients WHERE activo = 1 AND lat IS NULL').get().n;
    res.json({ clientes, sin_ubicacion: sinUbicacion, deposito: num(getSettings(db).deposito_lat) != null ? { lat: num(getSettings(db).deposito_lat), lng: num(getSettings(db).deposito_lng) } : null });
  });
  r.get('/zonas/sectores', (req, res) => res.json(listarSectores(db)));
  r.put('/zonas/sectores', (req, res) => {
    const comuna = String(req.body.comuna ?? '').trim();
    if (!comuna) bad('Indica la comuna.');
    const hit = buscarComuna(comuna);
    const nombre = hit?.comuna ?? comuna;
    const seg = req.body.seguridad ?? 'sin_evaluar';
    if (!SEGURIDAD.some((x) => x.id === seg)) bad('Nivel de seguridad no válido.');
    const t = (v) => (v == null || String(v).trim() === '' ? null : String(v).trim());
    if (seg !== 'sin_evaluar' && !t(req.body.fuente)) bad('Indica de dónde sale la evaluación (por ejemplo, la experiencia de los conductores o datos de Carabineros).');
    const region = hit?.region ?? t(req.body.region) ?? '';
    db.prepare(`INSERT INTO sectores (comuna, region, zona, seguridad, horario_recomendado, observaciones, fuente, actualizado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(comuna, region) DO UPDATE SET zona = excluded.zona, seguridad = excluded.seguridad, horario_recomendado = excluded.horario_recomendado,
        observaciones = excluded.observaciones, fuente = excluded.fuente, actualizado = excluded.actualizado`)
      .run(nombre, region, t(req.body.zona), seg, t(req.body.horario_recomendado), t(req.body.observaciones), t(req.body.fuente), hoyLocal());
    res.json(listarSectores(db).find((x) => x.comuna === nombre));
  });
  r.delete('/zonas/sectores/:id', (req, res) => { db.prepare('DELETE FROM sectores WHERE id = ?').run(req.params.id); res.json({ eliminado: true }); });
  r.get('/zonas/incidentes', (req, res) => {
    res.json(db.prepare('SELECT i.*, c.nombre AS cliente FROM incidentes i LEFT JOIN clients c ON c.id = i.client_id ORDER BY i.fecha DESC, i.id DESC LIMIT 300').all()
      .map((i) => ({ ...i, tipo_nombre: TIPOS_INCIDENTE.find((t) => t.id === i.tipo)?.nombre ?? i.tipo })));
  });
  r.post('/zonas/incidentes', (req, res) => {
    const b = req.body;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(b.fecha ?? '')) bad('Indica la fecha del incidente.');
    if (!TIPOS_INCIDENTE.some((t) => t.id === (b.tipo ?? 'otro'))) bad('Tipo de incidente no válido.');
    let comuna = b.comuna ? String(b.comuna).trim() : null;
    const clienteId = b.client_id ? Number(b.client_id) : null;
    if (!comuna && clienteId) comuna = db.prepare('SELECT comuna FROM clients WHERE id = ?').get(clienteId)?.comuna ?? null;
    if (!comuna) bad('Indica la comuna donde ocurrió.');
    const hit = buscarComuna(comuna);
    const id = insertar(db, 'incidentes', { fecha: b.fecha, comuna: hit?.comuna ?? comuna, client_id: clienteId, trip_id: b.trip_id ? Number(b.trip_id) : null, tipo: b.tipo ?? 'otro', descripcion: b.descripcion ? String(b.descripcion).trim() : null });
    res.status(201).json({ id });
  });
  r.delete('/zonas/incidentes/:id', (req, res) => { db.prepare('DELETE FROM incidentes WHERE id = ?').run(req.params.id); res.json({ eliminado: true }); });
  r.post('/zonas/seguridad-ruta', (req, res) => res.json(seguridadDeParadas(db, paradasDeBody(req.body))));

  // ---------- Reportes ----------
  const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const filtrosDe = (q) => ({ mes: q.mes, desde: q.desde, hasta: q.hasta, vehicle_id: q.vehicle_id, driver_id: q.driver_id });
  const reportes = {
    panel: { rep: (q) => reportePanel(db, filtrosDe(q)), nombre: 'analisis' },
    costos: { rep: (q) => reporteCostos(db, filtrosDe(q)), nombre: 'control_de_costos' },
    kpi: { rep: (q) => reporteKpi(db, filtrosDe(q)), nombre: 'indicadores_kpi', horizontal: true },
    flota: { rep: () => reporteFlota(db), nombre: 'vehiculos_y_kilometraje', horizontal: true },
    zonas: { rep: (q) => reporteZonas(db, filtrosDe(q)), nombre: 'clientes_y_zonas', horizontal: true },
  };
  for (const [id, def] of Object.entries(reportes)) {
    r.get(`/reportes/${id}.xlsx`, wrap(async (req, res) => {
      const buf = await excelDe(db, def.rep(req.query));
      res.setHeader('Content-Type', XLSX);
      res.setHeader('Content-Disposition', `attachment; filename="bhumi_${def.nombre}.xlsx"`);
      res.send(Buffer.from(buf));
    }));
    r.get(`/reportes/${id}.pdf`, (req, res) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="bhumi_${def.nombre}.pdf"`);
      pdfDe(db, def.rep(req.query), res, { horizontal: !!def.horizontal });
    });
  }
  r.get('/reportes/despacho/:id.pdf', (req, res) => {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="bhumi_hoja_de_ruta_${req.params.id}.pdf"`);
    if (!pdfHojaDeRuta(db, req.params.id, res)) { res.removeHeader('Content-Disposition'); res.status(404).type('json').end(JSON.stringify({ error: { code: 'no_encontrado', mensaje: 'Despacho no encontrado.' } })); }
  });

  // ---------- Respaldo ----------
  r.get('/respaldo.json', (req, res) => {
    res.setHeader('Content-Disposition', 'attachment; filename="bhumi_respaldo.json"');
    res.json(exportarJson(db));
  });
  r.get('/respaldo.db', (req, res) => {
    if (typeof db.exportBytes === 'function') { // navegador: la base vive en memoria y se exporta completa
      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', 'attachment; filename="bhumi_respaldo.db"');
      res.send(Buffer.from(db.exportBytes()));
      return;
    }
    const tmp = path.join(os.tmpdir(), `bhumi_${Date.now()}.db`);
    db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
    res.download(tmp, 'bhumi_respaldo.db', () => fs.rm(tmp, { force: true }, () => {}));
  });
  // Restaura desde un respaldo: .json (todos los datos) o .db (copia completa; solo en el modo de doble clic).
  r.post('/respaldo/restaurar', express.raw({ type: '*/*', limit: '100mb' }), wrap(async (req, res) => {
    const bytes = req.body;
    if (!bytes?.length) bad('Elige un archivo de respaldo (.json o .db).');
    if (esArchivoSqlite(bytes)) {
      if (typeof db.cargarBytes !== 'function') bad('Los archivos .db se restauran desde la versión que se abre con doble clic. Aquí usa el respaldo .json.');
      db.cargarBytes(bytes);
      prepararDb(db);
      return res.json({ ok: true, tipo: 'db' });
    }
    let datos;
    try { datos = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new RespaldoError('El archivo no se pudo leer. Debe ser un respaldo de BHUMI (.json o .db).'); }
    res.json({ ok: true, tipo: 'json', filas: restaurarJson(db, datos) });
  }));

  // ---------- Errores ----------
  r.use((req, res) => res.status(404).json({ error: { code: 'no_encontrado', mensaje: 'Ruta de API no encontrada.' } }));
  // eslint-disable-next-line no-unused-vars
  r.use((err, req, res, next) => {
    let status = err.status ?? 500;
    let code = err.code ?? 'error';
    if (err instanceof PlanError) status = ['sin_paradas', 'demasiadas_paradas', 'sin_coordenadas', 'deposito', 'sin_vehiculo'].includes(err.code) ? 400 : 422;
    else if (err instanceof GoogleError) status = err.code === 'sin_clave' ? 400 : err.code === 'sin_resultados' ? 404 : 502;
    else if (err instanceof NoEncontrado) status = 404;
    else if (!err.status) {
      console.error(err);
      code = 'error_interno';
    }
    res.status(status).json({ error: { code, mensaje: status === 500 ? 'Ocurrió un error inesperado en el servidor.' : err.message, extra: err.extra ?? null } });
  });

  return r;
}
