// Tiempo real del servidor central: cada escritura exitosa se anuncia a todos los navegadores conectados
// (Server-Sent Events en GET /api/eventos), con qué cambió y quién lo cambió. La interfaz decide qué refrescar.
// El aviso solo dice "qué cambió"; los datos se vuelven a pedir por la API, que aplica los permisos de cada rol.
import { normalizarRuta } from './auth.js';

const ESCRITURA = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
// POST que calculan algo pero no guardan nada.
const NO_GUARDAN = [/^\/plan(\/|$)/, /^\/cubicaje\/(calcular|comparar)$/, /^\/geocodificar$/, /^\/settings\/probar-google$/, /^\/zonas\/seguridad-ruta$/, /^\/auth\//];
// Rutas cuyo primer tramo no es el nombre del recurso que cambia.
const ALIAS = { cargas: 'vehiculos', 'km-semanal': 'vehiculos', respaldo: 'todo' };

/** Qué recurso cambia una escritura: `{ recurso, id }`, o null si no guarda nada. */
export function recursoDe(metodo, ruta) {
  if (!ESCRITURA.has(metodo)) return null;
  ruta = normalizarRuta(ruta);
  if (NO_GUARDAN.some((re) => re.test(ruta))) return null;
  const [, primero, segundo] = ruta.split('/');
  if (!primero) return null;
  const recurso = ALIAS[primero] ?? primero;
  const id = recurso === primero && /^\d+$/.test(segundo ?? '') ? Number(segundo) : null;
  return { recurso, id };
}

const PING_MS = 25_000; // mantiene viva la conexión a través de proxies y revisa que la sesión siga vigente

export function crearEventos({ sesionDe, pingMs = PING_MS }) {
  const clientes = new Set();
  let siguienteId = 1;

  const escribir = (c, texto) => { try { c.res.write(texto); } catch { cerrar(c); } };
  const cerrar = (c) => { clientes.delete(c); try { c.res.end(); } catch { /* ya cerrada */ } };

  const ping = setInterval(() => {
    for (const c of clientes) {
      // Si al usuario lo desactivaron, le cambiaron la clave o su sesión venció, se le avisa y se corta.
      if (!sesionDe(c.req, { renovar: false })) { escribir(c, 'event: sin_sesion\ndata: {}\n\n'); cerrar(c); }
      else escribir(c, ': ping\n\n');
    }
  }, pingMs);
  ping.unref();

  /** GET /api/eventos (requiere sesión, ya revisada por exigirSesion). */
  function canal(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // que ningún proxy acumule los eventos
    });
    const c = { req, res, usuarioId: req.usuario.id };
    clientes.add(c);
    res.write(`retry: 3000\nevent: listo\ndata: ${JSON.stringify({ conectados: clientes.size })}\n\n`);
    req.on('close', () => clientes.delete(c));
  }

  function emitir(evento) {
    const texto = `id: ${siguienteId++}\ndata: ${JSON.stringify(evento)}\n\n`;
    for (const c of clientes) escribir(c, texto);
  }

  /** Middleware: después de cada escritura exitosa, avisa a todos qué cambió y quién fue. */
  function anunciar(req, res, next) {
    if (ESCRITURA.has(req.method) && req.usuario) {
      const r = recursoDe(req.method, req.path);
      if (r) {
        // La pestaña que hizo el cambio se identifica, para que no se refresque con su propio aviso.
        const pestana = /^[\w-]{1,40}$/.test(req.headers['x-bhumi-pestana'] ?? '') ? req.headers['x-bhumi-pestana'] : null;
        res.on('finish', () => {
          if (res.statusCode >= 400) return;
          emitir({ ...r, accion: req.method, usuario: { id: req.usuario.id, nombre: req.usuario.nombre }, pestana, ts: new Date().toISOString() });
        });
      }
    }
    next();
  }

  /** Cierra todas las conexiones (al apagar el servidor, para que no lo retengan). */
  function cerrarTodo() {
    clearInterval(ping);
    for (const c of clientes) cerrar(c);
  }

  return { canal, anunciar, emitir, cerrarTodo, conectados: () => clientes.size };
}
