// Arranque de BHUMI dentro del navegador: sin servidor, sin Node, sin instalar nada.
// 1) prepara SQLite (WebAssembly), 2) abre o crea la base guardada en este navegador,
// 3) conecta Google, 4) atiende las llamadas "/api" dentro de la misma página y 5) abre la interfaz.
// `window.BHUMI_MODO` lo define el archivo que se abrió: "real" (Abrir BHUMI.html) o "demo" (Abrir DEMO.html).
import initSqlJs from 'sql.js';
import wasmBinary from 'sql.js/dist/sql-wasm-browser.wasm';
import { configurarSql } from './sqlite-wasm.js';
import { openDb, getSettings } from '../server/db.js';
import { createGoogle } from '../server/services/google.js';
import { createGoogleNavegador } from './google-navegador.js';
import { crearRuntime } from './runtime.js';
import { cargarGoogle, claveRechazada } from '../public/js/maps.js';
import * as almacen from './almacenamiento.js';
import { crearFakeGoogle } from '../test/fake-google.js';
import { sembrarDemo } from '../test/demo-datos.js';

const demo = window.BHUMI_MODO === 'demo';
const sinCuerpo = new Set([101, 204, 205, 304]);

const pantalla = (titulo, texto, extra = '') => {
  const vista = document.getElementById('vista');
  vista.innerHTML = '';
  const caja = document.createElement('div');
  caja.className = 'aviso rojo';
  caja.style.margin = '24px';
  const h = document.createElement('h3');
  h.textContent = titulo;
  const p = document.createElement('p');
  p.textContent = texto;
  caja.append(h, p);
  if (extra) { const d = document.createElement('p'); d.textContent = extra; caja.append(d); }
  vista.append(caja);
  document.getElementById('titulo-pagina').textContent = 'BHUMI';
};

/** Reemplaza `fetch` para que las llamadas a "/api/…" se resuelvan dentro de la página, sin red. */
function instalarApi(client, { guardador = null } = {}) {
  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (entrada, opciones = {}) => {
    const url = typeof entrada === 'string' ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    if (!/^\/api(\/|\?|$)/.test(url)) return fetchOriginal(entrada, opciones);
    const metodo = String(opciones.method ?? 'GET').toUpperCase();
    let cuerpo = opciones.body;
    if (typeof cuerpo === 'string') cuerpo = JSON.parse(cuerpo);
    else if (cuerpo instanceof ArrayBuffer) cuerpo = new Uint8Array(cuerpo);
    else if (ArrayBuffer.isView(cuerpo)) cuerpo = new Uint8Array(cuerpo.buffer, cuerpo.byteOffset, cuerpo.byteLength);
    else if (cuerpo instanceof Blob) cuerpo = new Uint8Array(await cuerpo.arrayBuffer());
    const r = await client.request(metodo, url, cuerpo);
    if (guardador && r.status < 400) {
      if (metodo !== 'GET') {
        guardador.programar();
        if (url.startsWith('/api/respaldo/restaurar')) await guardador.guardarAhora(); // la página se recarga enseguida
      } else if (/^\/api\/respaldo\.(db|json)/.test(url)) {
        almacen.marcarRespaldo().catch(() => {});
      }
    }
    return new Response(sinCuerpo.has(r.status) ? null : r.body, { status: r.status, headers: r.headers });
  };
}

async function iniciar() {
  const problema = almacen.problemaDeNavegador();
  if (problema) return pantalla('Este navegador no puede abrir BHUMI', problema);

  if (!demo && !(await almacen.tomarCandado())) {
    return pantalla('BHUMI ya está abierto en otra pestaña', 'Para no mezclar ni pisar tus datos, BHUMI solo se puede usar en una pestaña a la vez. Cierra esta pestaña y sigue trabajando en la que ya tenías abierta.');
  }

  configurarSql(await initSqlJs({ wasmBinary }));

  let db;
  let guardador = null;
  if (demo) {
    db = openDb(':memory:');
  } else {
    await almacen.pedirPersistencia();
    const { bytes, anterior } = await almacen.cargarBase();
    try {
      db = openDb(bytes ?? ':memory:');
    } catch (e) {
      const copia = await anterior();
      if (!copia) throw e;
      db = openDb(copia); // la base principal no se pudo abrir: se usa la copia interna anterior
      console.warn('BHUMI abrió la copia interna anterior porque la base principal no se pudo leer.', e);
    }
    guardador = almacen.crearGuardador(() => db.exportBytes(), { alError: (e) => console.error('No se pudieron guardar los datos', e) });
    window.BHUMI_ALMACEN = { ultimoRespaldo: almacen.ultimoRespaldo, marcarRespaldo: almacen.marcarRespaldo, primerUso: almacen.primerUso };
    if (!bytes) guardador.programar(); // primera vez: deja la base creada
  }

  const google = demo
    ? createGoogle({ getKey: () => getSettings(db).google_api_key, fetchImpl: crearFakeGoogle().fetchImpl })
    : createGoogleNavegador({ getKey: () => getSettings(db).google_api_key, cargarMaps: cargarGoogle, claveRechazada });

  const { client } = crearRuntime({ db, google, demo });
  instalarApi(client, { guardador });

  if (demo) {
    const llamar = async (metodo, ruta, cuerpo) => {
      const r = await client.request(metodo, `/api${ruta}`, cuerpo);
      const datos = r.body.length ? JSON.parse(new TextDecoder().decode(r.body)) : null;
      if (r.status >= 400) throw new Error(`${metodo} ${ruta}: ${datos?.error?.mensaje ?? r.status}`);
      return datos;
    };
    await sembrarDemo(llamar);
  }

  await import('../public/js/app.js');
}

iniciar().catch((e) => {
  console.error(e);
  pantalla('BHUMI no pudo arrancar', e?.message ?? String(e), 'Recarga la página. Si sigue igual, vuelve a abrir el archivo desde la carpeta de BHUMI.');
});
