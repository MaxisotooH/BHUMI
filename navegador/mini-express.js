// Enrutador mínimo con la misma forma que Express: lo suficiente para ejecutar server/api.js sin servidor.
// En el modo de doble clic las llamadas a /api se atienden aquí, dentro de la misma página.
import { EventEmitter } from 'events';

const aBuffer = (u8) => (typeof Buffer !== 'undefined' ? Buffer.from(u8) : u8);

function compilar(ruta) {
  const claves = [];
  const fuente = ruta.replace(/[.+*?^${}()|[\]\\]/g, '\\$&').replace(/:([A-Za-z_]\w*)/g, (_, k) => { claves.push(k); return '([^/]+?)'; });
  return { regex: new RegExp(`^${fuente}/?$`), claves };
}

/** Respuesta: acumula estado, cabeceras y cuerpo. También es un "stream" de escritura para PDFKit (doc.pipe(res)). */
export class Respuesta extends EventEmitter {
  constructor(alTerminar) {
    super();
    this.statusCode = 200;
    this.cabeceras = {};
    this.trozos = [];
    this.terminada = false;
    this.alTerminar = alTerminar;
    this.writable = true;
  }
  status(c) { this.statusCode = c; return this; }
  setHeader(k, v) { this.cabeceras[String(k).toLowerCase()] = String(v); return this; }
  getHeader(k) { return this.cabeceras[String(k).toLowerCase()]; }
  removeHeader(k) { delete this.cabeceras[String(k).toLowerCase()]; return this; }
  type(t) { return this.setHeader('Content-Type', t === 'json' ? 'application/json; charset=utf-8' : t); }
  write(trozo) {
    if (trozo == null) return true;
    this.trozos.push(typeof trozo === 'string' ? new TextEncoder().encode(trozo) : Uint8Array.from(trozo));
    return true;
  }
  end(trozo) {
    if (this.terminada) return this;
    if (trozo != null) this.write(trozo);
    this.terminada = true;
    this.writable = false;
    const largo = this.trozos.reduce((n, t) => n + t.length, 0);
    const cuerpo = new Uint8Array(largo);
    let o = 0;
    for (const t of this.trozos) { cuerpo.set(t, o); o += t.length; }
    this.emit('finish');
    this.alTerminar({ status: this.statusCode, headers: this.cabeceras, body: cuerpo });
    return this;
  }
  json(obj) {
    if (!this.getHeader('content-type')) this.type('json');
    return this.end(JSON.stringify(obj));
  }
  send(dato) {
    if (dato == null) return this.end();
    if (typeof dato === 'string') { if (!this.getHeader('content-type')) this.setHeader('Content-Type', 'text/html; charset=utf-8'); return this.end(dato); }
    if (dato instanceof Uint8Array || dato instanceof ArrayBuffer) return this.end(dato instanceof ArrayBuffer ? new Uint8Array(dato) : dato);
    return this.json(dato);
  }
}

export function Router() {
  const pila = [];
  const agregar = (metodo, ruta, fns) => {
    const { regex, claves } = compilar(ruta);
    for (const fn of fns.flat()) pila.push({ metodo, regex, claves, fn });
  };
  const router = {
    get: (ruta, ...fns) => { agregar('GET', ruta, fns); return router; },
    post: (ruta, ...fns) => { agregar('POST', ruta, fns); return router; },
    put: (ruta, ...fns) => { agregar('PUT', ruta, fns); return router; },
    patch: (ruta, ...fns) => { agregar('PATCH', ruta, fns); return router; },
    delete: (ruta, ...fns) => { agregar('DELETE', ruta, fns); return router; },
    // r.use(fn): middleware o manejador de errores (4 argumentos) para cualquier ruta.
    use: (...fns) => { for (const fn of fns.flat()) pila.push({ metodo: null, regex: /^.*$/, claves: [], fn }); return router; },
    atender(req, res) {
      let i = 0;
      const siguiente = (err) => {
        while (i < pila.length) {
          const capa = pila[i++];
          if (capa.metodo && capa.metodo !== req.method) continue;
          const m = capa.regex.exec(req.path);
          if (!m) continue;
          const esError = capa.fn.length === 4;
          if (Boolean(err) !== esError) continue;
          req.params = {};
          capa.claves.forEach((k, n) => { req.params[k] = decodeURIComponent(m[n + 1]); });
          try {
            const r = esError ? capa.fn(err, req, res, siguiente) : capa.fn(req, res, siguiente);
            if (r && typeof r.catch === 'function') r.catch(siguiente);
          } catch (e) { siguiente(e); }
          return;
        }
        if (!res.terminada) res.status(err ? 500 : 404).json({ error: { code: err ? 'error_interno' : 'no_encontrado', mensaje: err ? String(err.message ?? err) : 'Ruta no encontrada.' } });
      };
      siguiente();
    },
  };
  return router;
}

/** Equivalente a express.raw(): el cuerpo llega como bytes (Buffer). Sin cuerpo queda como objeto vacío. */
export function raw() {
  return (req, res, next) => {
    req.body = req.cuerpoCrudo?.length ? aBuffer(req.cuerpoCrudo) : {};
    next();
  };
}

/**
 * Cliente en proceso: `request(método, url, cuerpo)` ejecuta la API y devuelve { status, headers, body }.
 * `url` incluye el prefijo "/api" y la query, igual que una llamada fetch.
 */
export function crearCliente(router, { prefijo = '/api' } = {}) {
  return {
    request(metodo, url, cuerpo) {
      return new Promise((ok) => {
        const u = new URL(url, 'http://local');
        const ruta = u.pathname.startsWith(prefijo) ? u.pathname.slice(prefijo.length) || '/' : u.pathname;
        const query = {};
        for (const [k, v] of u.searchParams) query[k] = k in query ? [].concat(query[k], v) : v;
        const crudo = cuerpo instanceof Uint8Array ? cuerpo : cuerpo instanceof ArrayBuffer ? new Uint8Array(cuerpo) : null;
        const req = {
          method: String(metodo).toUpperCase(), path: ruta, url: ruta, query, params: {},
          cuerpoCrudo: crudo,
          body: crudo ? {} : (cuerpo == null ? {} : JSON.parse(JSON.stringify(cuerpo))),
        };
        const res = new Respuesta(ok);
        router.atender(req, res);
      });
    },
  };
}

export default { Router, raw };
