// Inicio de sesión, usuarios, permisos por rol y auditoría del servidor central.
// La versión de doble clic (un solo navegador) no usa este módulo.
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import expressReal from 'express';

const scrypt = promisify(crypto.scrypt);

export const ROLES_USUARIO = [
  { id: 'admin', nombre: 'Administrador', detalle: 'Todo, incluidos usuarios, Google, punto de partida y respaldo.' },
  { id: 'planificador', nombre: 'Planificador', detalle: 'Rutas, clientes, flota, costos, KPI, combustible, metas y personal.' },
  { id: 'bodega', nombre: 'Operador de bodega', detalle: 'Despachos y entregas del día, tiempos, km y cargas de combustible. No entra al Panel, Control de costos, KPI ni Configuración, y no planifica rutas.' },
];
const ROL_VALIDO = new Set(ROLES_USUARIO.map((r) => r.id));

export const CLAVE_MIN = 10;
const COOKIE = 'bhumi_sesion';
const INACTIVIDAD_MS = 12 * 3600_000; // la sesión vence tras 12 h sin uso…
const MAXIMO_MS = 7 * 24 * 3600_000; // …y siempre a los 7 días
const REFRESCO_MS = 5 * 60_000; // ultimo_uso se actualiza como mucho cada 5 min
// Intentos fallidos permitidos en la ventana. Por correo + IP: así quien se equivoca no bloquea a sus
// compañeros de oficina (que salen a internet con la misma IP). Por IP, un límite alto que frena a quien
// prueba muchos correos o contraseñas sin afectar a una oficina normal.
const INTENTOS_CUENTA = 5;
const INTENTOS_IP = 50;
const VENTANA_MS = 15 * 60_000;

// ---------- Contraseñas (scrypt, parámetros guardados junto al hash para poder subirlos después) ----------
const PARAMS = { N: 2 ** 15, r: 8, p: 3 };
const maxmem = (N, r) => 256 * N * r; // el doble de lo que necesita scrypt

export async function hashClave(clave) {
  const sal = crypto.randomBytes(16);
  const { N, r, p } = PARAMS;
  const h = await scrypt(clave.normalize('NFC'), sal, 64, { N, r, p, maxmem: maxmem(N, r) });
  return `scrypt$${N}$${r}$${p}$${sal.toString('base64url')}$${h.toString('base64url')}`;
}

export async function verificarClave(clave, guardado) {
  const [alg, N, r, p, sal, h] = String(guardado).split('$');
  if (alg !== 'scrypt' || !h) return false;
  const esperado = Buffer.from(h, 'base64url');
  const calc = await scrypt(String(clave).normalize('NFC'), Buffer.from(sal, 'base64url'), esperado.length, { N: +N, r: +r, p: +p, maxmem: maxmem(+N, +r) });
  return crypto.timingSafeEqual(calc, esperado);
}
// Para que un correo inexistente tarde lo mismo que uno real (no revela qué correos existen).
const HASH_SEÑUELO = await hashClave(crypto.randomBytes(12).toString('hex'));

export function validarClave(clave) {
  if (typeof clave !== 'string' || clave.length < CLAVE_MIN) return `La contraseña debe tener al menos ${CLAVE_MIN} caracteres.`;
  if (clave.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}
const emailValido = (e) => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim()) && e.length <= 200;

// ---------- Permisos por rol ----------
// Rutas relativas a /api. Admin puede todo; el resto se decide aquí, en el servidor, no solo ocultando el menú.
const SOLO_ADMIN = [/^\/usuarios(\/|$)/, /^\/auditoria$/, /^\/respaldo/, /^\/settings\/(probar-google|geolocalizar-deposito)$/];
/** Ajustes que solo cambia Admin. Si otro rol los envía en PUT /settings, se ignoran. */
export const AJUSTES_SOLO_ADMIN = ['google_api_key', 'google_map_id', 'usar_trafico', 'cache_horas', 'empresa_nombre', 'deposito_nombre', 'deposito_direccion', 'deposito_comuna', 'deposito_region', 'deposito_lat', 'deposito_lng'];

const BODEGA_LEE = [
  /^\/meta$/, /^\/settings$/, /^\/setup$/, /^\/combustible\/precios$/,
  /^\/vehiculos(\/\d+(\/cargas)?)?$/, /^\/flota$/, /^\/km-semanal$/, /^\/personal$/, /^\/productos$/,
  /^\/clientes(\/\d+)?$/, /^\/entregas$/, /^\/despachos(\/\d+(\/(ruta-conductor|tiempos))?)?$/,
  /^\/reportes\/despacho\/\d+\.pdf$/, /^\/cubicaje\/capacidad$/, /^\/consolidacion$/,
  /^\/zonas\/(concentracion|mapa|sectores|incidentes)$/,
];
const BODEGA_ESCRIBE = [
  ['PUT', /^\/despachos\/\d+\/(tiempos|personal)$/],
  ['POST', /^\/despachos\/\d+\/estado$/],
  ['POST', /^\/entregas\/\d+\/estado$/],
  ['POST', /^\/vehiculos\/\d+\/cargas$/],
  ['PUT', /^\/km-semanal$/],
  ['POST', /^\/cubicaje\/(calcular|comparar)$/],
];

/**
 * Ruta en la forma en que Express la compara: sin distinguir mayúsculas y sin barra final.
 * Sin esto, "/USUARIOS" o "/auditoria/" esquivaban las reglas pero Express igual las atendía.
 */
export function normalizarRuta(ruta) {
  let r = String(ruta ?? '');
  try { r = decodeURIComponent(r); } catch { /* se revisa tal cual */ }
  return r.toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';
}

/** ¿Puede este rol hacer `metodo` sobre `ruta` (relativa a /api)? */
export function permitido(rol, metodo, ruta) {
  ruta = normalizarRuta(ruta);
  metodo = String(metodo).toUpperCase();
  if (rol === 'admin') return true;
  if (SOLO_ADMIN.some((re) => re.test(ruta))) return false;
  if (rol === 'planificador') return true;
  if (rol === 'bodega') {
    if (metodo === 'GET' || metodo === 'HEAD') return BODEGA_LEE.some((re) => re.test(ruta));
    return BODEGA_ESCRIBE.some(([m, re]) => m === metodo && re.test(ruta));
  }
  return false;
}

/** Reglas que miran el cuerpo: Bodega cierra o inicia despachos, pero no los cancela (no tiene vuelta atrás). */
export function permitidoCuerpo(rol, metodo, ruta, cuerpo) {
  ruta = normalizarRuta(ruta);
  if (rol === 'bodega' && String(metodo).toUpperCase() === 'POST' && /^\/despachos\/\d+\/estado$/.test(ruta)) {
    return ['en_ruta', 'completado'].includes(cuerpo?.estado);
  }
  return true;
}

// ---------- Utilidades HTTP ----------
const sha256 = (t) => crypto.createHash('sha256').update(t).digest('hex');
function leerCookie(req, nombre) {
  for (const parte of (req.headers.cookie ?? '').split(';')) {
    const i = parte.indexOf('=');
    if (i > 0 && parte.slice(0, i).trim() === nombre) return decodeURIComponent(parte.slice(i + 1).trim());
  }
  return null;
}
function ponerCookie(req, res, valor, maxAgeS) {
  const partes = [`${COOKIE}=${valor}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeS}`];
  if (req.secure) partes.push('Secure');
  res.setHeader('Set-Cookie', partes.join('; '));
}
const error = (res, status, code, mensaje, extra = null) => res.status(status).json({ error: { code, mensaje, extra } });
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const usuarioPublico = (u) => u && ({ id: u.id, email: u.email, nombre: u.nombre, rol: u.rol, activo: !!u.activo, creado_en: u.creado_en, ultimo_acceso: u.ultimo_acceso });

/**
 * Crea las piezas de autenticación sobre la base `db`.
 *  - `publico`: inicio y cierre de sesión (no exigen sesión).
 *  - `exigirSesion`: middleware que deja pasar solo con sesión válida y rol permitido; también audita las escrituras.
 *  - `privado`: datos de la sesión, cambio de contraseña, usuarios y auditoría.
 */
export function crearAuth({ db, express = expressReal, ahora = () => Date.now() }) {
  const intentos = new Map(); // clave → { n, desde }

  const auditar = (usuarioId, accion, { ruta = null, estado = null, ip = null, detalle = null } = {}) => {
    try {
      db.prepare('INSERT INTO auditoria (usuario_id, accion, ruta, estado, ip, detalle) VALUES (?, ?, ?, ?, ?, ?)').run(usuarioId, accion, ruta, estado, ip, detalle);
    } catch (e) { console.error('No se pudo registrar en la auditoría:', e.message); }
  };

  const bloqueado = (clave, max) => {
    const r = intentos.get(clave);
    if (!r) return false;
    if (ahora() - r.desde > VENTANA_MS) { intentos.delete(clave); return false; }
    return r.n >= max;
  };
  const fallo = (clave) => {
    const r = intentos.get(clave);
    if (!r || ahora() - r.desde > VENTANA_MS) intentos.set(clave, { n: 1, desde: ahora() });
    else r.n++;
    if (intentos.size > 10_000) for (const [k, v] of intentos) if (ahora() - v.desde > VENTANA_MS) intentos.delete(k);
  };

  const cerrarSesionesDe = (usuarioId, excepto = null) =>
    db.prepare('DELETE FROM sesiones WHERE usuario_id = ? AND id IS NOT ?').run(usuarioId, excepto);
  const adminsActivos = () => db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1").get().n;

  /** Sesión válida para la cookie de la solicitud, o null. Renueva `ultimo_uso` y borra la sesión si venció. */
  function sesionDe(req) {
    const token = leerCookie(req, COOKIE);
    if (!token) return null;
    const id = sha256(token);
    const s = db.prepare(`SELECT s.id AS sesion_id, s.creada_en, s.ultimo_uso, u.* FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
      WHERE s.id = ? AND u.activo = 1`).get(id);
    if (!s) return null;
    const t = ahora();
    if (t - s.ultimo_uso > INACTIVIDAD_MS || t - s.creada_en > MAXIMO_MS) {
      db.prepare('DELETE FROM sesiones WHERE id = ?').run(id);
      return null;
    }
    if (t - s.ultimo_uso > REFRESCO_MS) db.prepare('UPDATE sesiones SET ultimo_uso = ? WHERE id = ?').run(t, id);
    return s;
  }

  // ---------- Rutas públicas ----------
  const publico = express.Router();

  publico.post('/auth/login', wrap(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const clave = String(req.body?.clave ?? '');
    const ip = req.ip;
    if (!email || !clave) return error(res, 400, 'datos_incompletos', 'Ingresa tu correo y tu contraseña.');
    const cuenta = `cuenta:${email}|${ip}`;
    if (bloqueado(cuenta, INTENTOS_CUENTA) || bloqueado(`ip:${ip}`, INTENTOS_IP)) {
      auditar(null, 'login_bloqueado', { ip, detalle: email });
      return error(res, 429, 'demasiados_intentos', 'Demasiados intentos fallidos. Espera 15 minutos y vuelve a intentar.');
    }
    const u = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    const ok = await verificarClave(clave, u?.clave_hash ?? HASH_SEÑUELO);
    if (!u || !ok || !u.activo) {
      fallo(cuenta);
      fallo(`ip:${ip}`);
      auditar(u?.id ?? null, 'login_fallido', { ip, detalle: email });
      return error(res, 401, 'credenciales', 'Correo o contraseña incorrectos.');
    }
    intentos.delete(cuenta);
    const t = ahora();
    db.prepare('DELETE FROM sesiones WHERE ultimo_uso < ? OR creada_en < ?').run(t - INACTIVIDAD_MS, t - MAXIMO_MS);
    const token = crypto.randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sesiones (id, usuario_id, creada_en, ultimo_uso, ip, agente) VALUES (?, ?, ?, ?, ?, ?)')
      .run(sha256(token), u.id, t, t, ip, String(req.headers['user-agent'] ?? '').slice(0, 300));
    db.prepare('UPDATE usuarios SET ultimo_acceso = CURRENT_TIMESTAMP WHERE id = ?').run(u.id);
    auditar(u.id, 'login', { ip });
    ponerCookie(req, res, token, Math.floor(MAXIMO_MS / 1000));
    res.json({ usuario: usuarioPublico(u) });
  }));

  publico.post('/auth/logout', (req, res) => {
    const token = leerCookie(req, COOKIE);
    if (token) db.prepare('DELETE FROM sesiones WHERE id = ?').run(sha256(token));
    ponerCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  // ---------- Exigir sesión y permiso ----------
  const RUTAS_LIBRES = new Set(['GET /meta']);
  const ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  function exigirSesion(req, res, next) {
    const ruta = normalizarRuta(req.path);
    if (RUTAS_LIBRES.has(`${req.method} ${ruta}`)) return next();
    // Defensa adicional contra CSRF (además de SameSite=Lax): una escritura con Origin de otro sitio se rechaza.
    if (ESCRITURA.has(req.method) && req.headers.origin) {
      let host = null;
      try { host = new URL(req.headers.origin).host; } catch { /* origen inválido */ }
      if (host !== req.headers.host) return error(res, 403, 'origen', 'Solicitud rechazada: viene de otro sitio.');
    }
    const s = sesionDe(req);
    if (!s) return error(res, 401, 'sin_sesion', 'Tu sesión terminó. Vuelve a iniciar sesión.');
    req.usuario = { id: s.id, email: s.email, nombre: s.nombre, rol: s.rol, sesion_id: s.sesion_id };
    if (!['/auth/yo', '/auth/clave'].includes(ruta) && !permitido(s.rol, req.method, ruta)) {
      return error(res, 403, 'prohibido', 'Tu rol no permite esta acción. Pídesela a un administrador.');
    }
    // Reglas que dependen del contenido de la solicitud, no solo de la ruta.
    if (!permitidoCuerpo(s.rol, req.method, ruta, req.body)) {
      return error(res, 403, 'prohibido', 'Tu rol no permite esta acción. Pídesela a un administrador.');
    }
    if (req.method === 'PUT' && ruta === '/settings' && s.rol !== 'admin' && req.body && typeof req.body === 'object') {
      for (const k of AJUSTES_SOLO_ADMIN) delete req.body[k];
    }
    if (ESCRITURA.has(req.method)) {
      res.on('finish', () => auditar(s.id, req.method, { ruta: req.originalUrl.split('?')[0].replace(/^\/api/, ''), estado: res.statusCode, ip: req.ip }));
    }
    next();
  }

  // ---------- Rutas privadas ----------
  const privado = express.Router();

  privado.get('/auth/yo', (req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    res.json({ usuario: usuarioPublico(u), roles: ROLES_USUARIO });
  });

  privado.put('/auth/clave', wrap(async (req, res) => {
    const { actual, nueva } = req.body ?? {};
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(req.usuario.id);
    if (!(await verificarClave(String(actual ?? ''), u.clave_hash))) return error(res, 400, 'clave_actual', 'La contraseña actual no es correcta.');
    const problema = validarClave(nueva);
    if (problema) return error(res, 400, 'clave_debil', problema);
    db.prepare('UPDATE usuarios SET clave_hash = ? WHERE id = ?').run(await hashClave(nueva), u.id);
    cerrarSesionesDe(u.id, req.usuario.sesion_id); // cierra las demás sesiones abiertas con la clave anterior
    res.json({ ok: true });
  }));

  privado.get('/usuarios', (req, res) => {
    const filas = db.prepare(`SELECT u.*, (SELECT COUNT(*) FROM sesiones s WHERE s.usuario_id = u.id) AS sesiones
      FROM usuarios u ORDER BY u.activo DESC, u.nombre`).all();
    res.json({ usuarios: filas.map((u) => ({ ...usuarioPublico(u), sesiones: u.sesiones })), roles: ROLES_USUARIO, clave_min: CLAVE_MIN });
  });

  privado.post('/usuarios', wrap(async (req, res) => {
    const email = String(req.body?.email ?? '').trim().toLowerCase();
    const nombre = String(req.body?.nombre ?? '').trim();
    const { rol, clave } = req.body ?? {};
    if (!emailValido(email)) return error(res, 400, 'email', 'Ingresa un correo válido.');
    if (!nombre) return error(res, 400, 'nombre', 'Ingresa el nombre.');
    if (!ROL_VALIDO.has(rol)) return error(res, 400, 'rol', 'Elige un rol.');
    const problema = validarClave(clave);
    if (problema) return error(res, 400, 'clave_debil', problema);
    if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) return error(res, 409, 'email_repetido', 'Ya existe un usuario con ese correo.');
    const r = db.prepare('INSERT INTO usuarios (email, nombre, rol, clave_hash) VALUES (?, ?, ?, ?)').run(email, nombre, rol, await hashClave(clave));
    res.status(201).json({ usuario: usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(r.lastInsertRowid)) });
  }));

  privado.put('/usuarios/:id', wrap(async (req, res) => {
    const u = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(Number(req.params.id));
    if (!u) return error(res, 404, 'no_encontrado', 'El usuario no existe.');
    const b = req.body ?? {};
    const cambios = {};
    if ('nombre' in b) {
      cambios.nombre = String(b.nombre ?? '').trim();
      if (!cambios.nombre) return error(res, 400, 'nombre', 'Ingresa el nombre.');
    }
    if ('rol' in b) {
      if (!ROL_VALIDO.has(b.rol)) return error(res, 400, 'rol', 'Elige un rol.');
      cambios.rol = b.rol;
    }
    if ('activo' in b) cambios.activo = b.activo ? 1 : 0;
    if ('clave' in b && b.clave !== '' && b.clave != null) {
      const problema = validarClave(b.clave);
      if (problema) return error(res, 400, 'clave_debil', problema);
      cambios.clave_hash = await hashClave(b.clave);
    }
    const quedaSinAdmin = u.rol === 'admin' && u.activo && ((cambios.rol && cambios.rol !== 'admin') || cambios.activo === 0) && adminsActivos() <= 1;
    if (quedaSinAdmin) return error(res, 409, 'ultimo_admin', 'Debe quedar al menos un administrador activo.');
    const cols = Object.keys(cambios);
    if (cols.length) db.prepare(`UPDATE usuarios SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...cols.map((c) => cambios[c]), u.id);
    // Desactivar o cambiar la clave cierra sus sesiones (si es uno mismo, se conserva la actual).
    if (cambios.activo === 0 || cambios.clave_hash) cerrarSesionesDe(u.id, u.id === req.usuario.id ? req.usuario.sesion_id : null);
    res.json({ usuario: usuarioPublico(db.prepare('SELECT * FROM usuarios WHERE id = ?').get(u.id)) });
  }));

  privado.get('/auditoria', (req, res) => {
    const limite = Math.min(Math.max(Number(req.query.limite) || 100, 1), 500);
    const filas = db.prepare(`SELECT a.id, a.ts, a.accion, a.ruta, a.estado, a.ip, a.detalle, u.nombre AS usuario, u.email
      FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id ORDER BY a.id DESC LIMIT ?`).all(limite);
    res.json({ registros: filas });
  });

  return { publico, exigirSesion, privado, sesionDe };
}

/** Crea un usuario desde código (comando crear-admin y pruebas). Devuelve su id. */
export async function crearUsuario(db, { email, nombre, rol = 'admin', clave }) {
  email = String(email ?? '').trim().toLowerCase();
  if (!emailValido(email)) throw new Error('Correo no válido.');
  if (!String(nombre ?? '').trim()) throw new Error('Falta el nombre.');
  if (!ROL_VALIDO.has(rol)) throw new Error(`Rol no válido: ${rol}.`);
  const problema = validarClave(clave);
  if (problema) throw new Error(problema);
  if (db.prepare('SELECT 1 FROM usuarios WHERE email = ?').get(email)) throw new Error('Ya existe un usuario con ese correo.');
  return Number(db.prepare('INSERT INTO usuarios (email, nombre, rol, clave_hash) VALUES (?, ?, ?, ?)').run(email, nombre.trim(), rol, await hashClave(clave)).lastInsertRowid);
}
