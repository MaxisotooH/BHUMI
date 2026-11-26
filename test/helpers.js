// Arranque común de las pruebas. Con BHUMI_LOCAL=1 se usa el enrutador local del navegador (sin Express ni HTTP);
// sin esa variable se usa el servidor real. Las mismas pruebas validan las dos formas de ejecutar el sistema.
import { crearApp } from '../server/index.js';
import { openDb, getSettings, prepararDb } from '../server/db.js';
import { createGoogle } from '../server/services/google.js';
import { crearRuntime } from '../navegador/runtime.js';
import { DatabaseSync as DbWasm, configurarSql } from '../navegador/sqlite-wasm.js';
import { crearFakeGoogle } from './fake-google.js';
import { crearUsuario } from '../server/auth.js';

// BHUMI_LOCAL=1     enrutador local + node:sqlite
// BHUMI_LOCAL=wasm  enrutador local + el adaptador de SQLite del navegador sobre sql.js (BHUMI_SQLJS=sustituto usa el sustituto de pruebas)
export const MODO_LOCAL = process.env.BHUMI_LOCAL === '1' || process.env.BHUMI_LOCAL === 'wasm';
const MODO_WASM = process.env.BHUMI_LOCAL === 'wasm';

async function dbWasm() {
  if (process.env.BHUMI_SQLJS === 'sustituto') {
    configurarSql((await import('./sqljs-sustituto.js')).sqljsSustituto);
  } else {
    const iniciarSql = (await import('sql.js')).default;
    configurarSql(await iniciarSql());
  }
  const db = new DbWasm();
  prepararDb(db);
  return db;
}

const respuesta = (status, headers, body) => {
  const tipo = headers['content-type'] ?? '';
  return { status, data: tipo.includes('json') ? JSON.parse(new TextDecoder().decode(body)) : Buffer.from(body) };
};

export async function iniciar({ fake = crearFakeGoogle(), demo = false, sinSesion = false, ...opcionesApp } = {}) {
  if (MODO_LOCAL) {
    const db = MODO_WASM ? await dbWasm() : openDb(':memory:');
    const google = createGoogle({ getKey: () => getSettings(db).google_api_key, fetchImpl: fake.fetchImpl });
    const { client } = crearRuntime({ db, google, demo });
    const call = async (method, ruta, body) => { const r = await client.request(method, `/api${ruta}`, body); return respuesta(r.status, r.headers, r.body); };
    return { call, subir: (ruta, bytes) => call('POST', ruta, new Uint8Array(bytes)), fake, db, cerrar: () => {} };
  }
  const { app, db, eventos } = crearApp({ dbFile: ':memory:', fetchImpl: fake.fetchImpl, demo, ...opcionesApp });
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  // El servidor central exige sesión: las pruebas actúan como un administrador (o sin sesión, con `sinSesion`).
  const cliente = (cookie) => ({
    call: async (method, ruta, body, headers = {}) => {
      const res = await fetch(base + ruta, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
      const tipo = res.headers.get('content-type') ?? '';
      const data = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
      return { status: res.status, data, headers: res.headers };
    },
    subir: async (ruta, bytes) => {
      const res = await fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', ...(cookie ? { Cookie: cookie } : {}) }, body: bytes });
      return { status: res.status, data: await res.json() };
    },
    /** Abre el canal de tiempo real (GET /eventos) como lo haría el navegador. */
    eventos: () => abrirEventos(`${base}/eventos`, cookie),
  });
  /** Inicia sesión y devuelve un cliente con esa cookie (o la respuesta del login si falló). */
  const entrar = async (email, clave) => {
    const r = await cliente(null).call('POST', '/auth/login', { email, clave });
    if (r.status !== 200) return { ...cliente(null), login: r };
    return { ...cliente(r.headers.get('set-cookie').split(';')[0]), login: r, usuario: r.data.usuario };
  };
  /** Crea un usuario con ese rol y devuelve un cliente con su sesión. */
  const comoRol = async (rol, email = `${rol}@prueba.cl`, clave = CLAVE_PRUEBA) => {
    await crearUsuario(db, { email, nombre: `Prueba ${rol}`, rol, clave });
    return entrar(email, clave);
  };
  const admin = sinSesion ? cliente(null) : await comoRol('admin');
  return {
    call: admin.call, subir: admin.subir, eventos: admin.eventos, fake, db, base, entrar, comoRol, sinSesion: cliente(null), canal: eventos,
    cerrar: () => { eventos.cerrarTodo(); server.closeAllConnections(); server.close(); },
  };
}
export const CLAVE_PRUEBA = 'clave-de-prueba-123';

/**
 * Cliente mínimo de Server-Sent Events sobre fetch. Junta los eventos recibidos en `lista` (con su `tipo`)
 * y permite esperar uno que cumpla una condición.
 */
async function abrirEventos(url, cookie) {
  const ctrl = new AbortController();
  const res = await fetch(url, { headers: cookie ? { Cookie: cookie } : {}, signal: ctrl.signal });
  const lista = [];
  const esperas = [];
  let terminado = false;
  if (res.ok) {
    (async () => {
      const lector = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      try {
        for (;;) {
          const { value, done } = await lector.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const bloque = buf.slice(0, i);
            buf = buf.slice(i + 2);
            let tipo = 'message';
            const datos = [];
            for (const linea of bloque.split('\n')) {
              if (linea.startsWith('event: ')) tipo = linea.slice(7);
              else if (linea.startsWith('data: ')) datos.push(linea.slice(6));
            }
            if (!datos.length) continue; // comentarios (ping) y "retry"
            lista.push({ tipo, ...JSON.parse(datos.join('\n')) });
            for (const w of [...esperas]) if (w.cond(lista.at(-1))) { esperas.splice(esperas.indexOf(w), 1); w.ok(lista.at(-1)); }
          }
        }
      } catch { /* cancelado */ }
      terminado = true;
      for (const w of esperas.splice(0)) w.ok(null);
    })();
  } else {
    await res.body?.cancel();
  }
  return {
    status: res.status,
    lista,
    get terminado() { return terminado; },
    /** El primer evento (ya recibido o futuro) que cumpla `cond`, o null si no llega en `ms`. */
    esperar(cond, ms = 2000) {
      const ya = lista.find(cond);
      if (ya) return Promise.resolve(ya);
      return new Promise((ok) => {
        const w = { cond, ok: (x) => { clearTimeout(t); ok(x); } };
        const t = setTimeout(() => { esperas.splice(esperas.indexOf(w), 1); ok(null); }, ms);
        esperas.push(w);
      });
    },
    cerrar: () => ctrl.abort(),
  };
}
