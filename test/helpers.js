// Arranque común de las pruebas. Con BHUMI_LOCAL=1 se usa el enrutador local del navegador (sin Express ni HTTP);
// sin esa variable se usa el servidor real. Las mismas pruebas validan las dos formas de ejecutar el sistema.
import { crearApp } from '../server/index.js';
import { openDb, getSettings, prepararDb } from '../server/db.js';
import { createGoogle } from '../server/services/google.js';
import { crearRuntime } from '../navegador/runtime.js';
import { DatabaseSync as DbWasm, configurarSql } from '../navegador/sqlite-wasm.js';
import { crearFakeGoogle } from './fake-google.js';

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

export async function iniciar({ fake = crearFakeGoogle(), demo = false } = {}) {
  if (MODO_LOCAL) {
    const db = MODO_WASM ? await dbWasm() : openDb(':memory:');
    const google = createGoogle({ getKey: () => getSettings(db).google_api_key, fetchImpl: fake.fetchImpl });
    const { client } = crearRuntime({ db, google, demo });
    const call = async (method, ruta, body) => { const r = await client.request(method, `/api${ruta}`, body); return respuesta(r.status, r.headers, r.body); };
    return { call, subir: (ruta, bytes) => call('POST', ruta, new Uint8Array(bytes)), fake, db, cerrar: () => {} };
  }
  const { app, db } = crearApp({ dbFile: ':memory:', fetchImpl: fake.fetchImpl, demo });
  const server = await new Promise((ok) => { const s = app.listen(0, '127.0.0.1', () => ok(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const call = async (method, ruta, body) => {
    const res = await fetch(base + ruta, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const tipo = res.headers.get('content-type') ?? '';
    const data = tipo.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
    return { status: res.status, data };
  };
  const subir = async (ruta, bytes) => {
    const res = await fetch(base + ruta, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
    return { status: res.status, data: await res.json() };
  };
  return { call, subir, fake, db, cerrar: () => server.close() };
}
