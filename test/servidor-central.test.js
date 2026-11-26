// Servidor central (Fase 1): configuración por variables de entorno, claves de Google separadas y endpoint de salud.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { leerConfig, ErrorConfig } from '../server/config.js';
import { crearFakeGoogle } from './fake-google.js';
import { MODO_LOCAL, iniciar } from './helpers.js';

test('config: sin variables queda como antes (solo este equipo, puerto 3000, data/bhumi.db)', () => {
  const c = leerConfig({}, '/app');
  assert.equal(c.host, '127.0.0.1');
  assert.equal(c.puerto, 3000);
  assert.equal(c.dbFile, path.join('/app', 'data', 'bhumi.db'));
  assert.equal(c.trustProxy, false);
  assert.equal(c.clavesGoogle, null);
});

test('config: lee HOST, PORT, DB_FILE, TRUST_PROXY y las dos claves de Google', () => {
  const c = leerConfig({ HOST: '0.0.0.0', PORT: '8080', DB_FILE: '/datos/bhumi.db', TRUST_PROXY: '1', GOOGLE_SERVER_KEY: ' srv ', GOOGLE_BROWSER_KEY: 'nav' }, '/app');
  assert.equal(c.host, '0.0.0.0');
  assert.equal(c.puerto, 8080);
  assert.equal(c.dbFile, path.resolve('/datos/bhumi.db'));
  assert.equal(c.trustProxy, 1);
  assert.deepEqual(c.clavesGoogle, { servidor: 'srv', navegador: 'nav' });
});

test('config: advierte si el servidor está abierto a otros equipos sin las claves de Google en variables de entorno', () => {
  assert.deepEqual(leerConfig({}).advertencias, []);
  assert.deepEqual(leerConfig({ HOST: '0.0.0.0', GOOGLE_SERVER_KEY: 'srv', GOOGLE_BROWSER_KEY: 'nav' }).advertencias, []);
  const [a] = leerConfig({ HOST: '0.0.0.0' }).advertencias;
  assert.match(a, /GOOGLE_SERVER_KEY/);
});

test('openDb: en disco espera hasta 5 s si otro proceso tiene la base tomada', async () => {
  const fs = await import('node:fs');
  const os = await import('node:os');
  const { openDb } = await import('../server/db.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bhumi-'));
  const db = openDb(path.join(dir, 'bhumi.db'));
  try {
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('config: rechaza un puerto inválido o una sola clave de Google', () => {
  assert.throws(() => leerConfig({ PORT: 'abc' }), ErrorConfig);
  assert.throws(() => leerConfig({ PORT: '70000' }), ErrorConfig);
  assert.throws(() => leerConfig({ GOOGLE_SERVER_KEY: 'srv' }), ErrorConfig);
  assert.throws(() => leerConfig({ GOOGLE_BROWSER_KEY: 'nav' }), ErrorConfig);
});

// Lo que sigue usa el servidor HTTP real (Express); el enrutador del navegador no tiene /api/salud.
const http = { skip: MODO_LOCAL ? 'solo aplica al servidor HTTP' : false };

/** Servidor HTTP con sesión de administrador y un Google simulado que anota con qué clave se le consulta. */
async function levantar(opciones) {
  const fake = crearFakeGoogle();
  const clavesUsadas = [];
  const espia = {
    ...fake,
    fetchImpl: (url, opts = {}) => {
      clavesUsadas.push(opts.headers?.['X-Goog-Api-Key'] ?? new URL(url).searchParams.get('key'));
      return fake.fetchImpl(url, opts);
    },
  };
  return { ...(await iniciar({ fake: espia, ...opciones })), clavesUsadas };
}

test('salud: responde ok con la versión mientras la base funciona', http, async () => {
  const s = await levantar({});
  try {
    const { status, data } = await s.call('GET', '/salud');
    assert.equal(status, 200);
    assert.equal(data.ok, true);
    assert.match(data.version, /^\d+\.\d+\.\d+/);
    s.db.close();
    assert.equal((await s.call('GET', '/salud')).status, 503);
  } finally { s.cerrar(); }
});

test('claves por servidor: el navegador recibe solo la clave del mapa y Google se consulta con la del servidor', http, async () => {
  const s = await levantar({ clavesGoogle: { servidor: 'CLAVE_SERVIDOR', navegador: 'CLAVE_MAPA' } });
  try {
    assert.equal((await s.call('GET', '/meta')).data.google_por_servidor, true);
    const ajustes = await s.call('GET', '/settings');
    assert.equal(ajustes.data.google_api_key, 'CLAVE_MAPA');
    assert.ok(!JSON.stringify(ajustes.data).includes('CLAVE_SERVIDOR'));

    // Intentar cambiar la clave desde la interfaz no tiene efecto, y la respuesta tampoco expone la del servidor.
    const put = await s.call('PUT', '/settings', { google_api_key: 'OTRA', costo_hora_conductor: 4000 });
    assert.equal(put.status, 200);
    assert.equal(put.data.google_api_key, 'CLAVE_MAPA');
    assert.equal(put.data.costo_hora_conductor, '4000');
    assert.ok(!JSON.stringify(put.data).includes('CLAVE_SERVIDOR'));

    // La base se geolocaliza al guardar y la prueba de conexión funciona sin clave guardada en Configuración.
    const prueba = await s.call('POST', '/settings/probar-google');
    assert.equal(prueba.status, 200);
    assert.equal(prueba.data.geocoding.ok, true);
    assert.ok(s.clavesUsadas.length > 0);
    assert.ok(s.clavesUsadas.every((k) => k === 'CLAVE_SERVIDOR'));
    assert.notEqual((await s.call('GET', '/settings')).data.deposito_lat, '');
    assert.equal((await s.call('GET', '/setup')).data.items.find((i) => i.id === 'google').estado, 'ok');
  } finally { s.cerrar(); }
});

test('sin claves por servidor: se usa la clave guardada en Configuración, como en un solo equipo', http, async () => {
  const s = await levantar({});
  try {
    assert.equal((await s.call('GET', '/meta')).data.google_por_servidor, false);
    await s.call('PUT', '/settings', { google_api_key: 'CLAVE_GUARDADA' });
    assert.equal((await s.call('GET', '/settings')).data.google_api_key, 'CLAVE_GUARDADA');
    await s.call('POST', '/settings/probar-google');
    assert.ok(s.clavesUsadas.length > 0 && s.clavesUsadas.every((k) => k === 'CLAVE_GUARDADA'));
  } finally { s.cerrar(); }
});
