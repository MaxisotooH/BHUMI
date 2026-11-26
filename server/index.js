// Servidor de BHUMI: API + archivos de la interfaz.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings } from './db.js';
import { createGoogle } from './services/google.js';
import { createPlanner } from './services/planner.js';
import { createApi } from './api.js';
import { leerConfig, ErrorConfig } from './config.js';
import { crearAuth } from './auth.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version;

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nBHUMI necesita Node.js 22.13 o superior (tienes ${process.versions.node}).\nDescarga la versión LTS desde https://nodejs.org y vuelve a abrir el programa.\n`);
  process.exit(1);
}

/**
 * @param clavesGoogle  { servidor, navegador } cuando las claves vienen de variables de entorno (servidor central).
 *                      Sin ellas, se usa la clave guardada en Configuración, como en la versión de un solo equipo.
 */
export function crearApp({ dbFile = path.join(raiz, 'data', 'bhumi.db'), fetchImpl, demo = false, clavesGoogle = null, trustProxy = false } = {}) {
  const db = openDb(dbFile);
  const google = createGoogle({ getKey: () => clavesGoogle?.servidor ?? getSettings(db).google_api_key, fetchImpl });
  const planner = createPlanner({ db, google });
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxy);
  app.use(express.json({ limit: '10mb' }));

  // Salud del servicio, para Docker, el proxy y el monitoreo: confirma que la base responde.
  app.get('/api/salud', (req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ ok: true, version: VERSION });
    } catch (e) {
      res.status(503).json({ ok: false, error: 'La base de datos no responde.' });
    }
  });

  // Inicio de sesión y permisos por rol: todo /api exige sesión, salvo /api/salud, /api/meta y el propio login.
  const auth = crearAuth({ db });
  app.use('/api', auth.publico);
  app.use('/api', auth.exigirSesion);
  app.use('/api', auth.privado);
  app.use('/api', createApi({ db, google, planner, demo, clavesGoogle, autenticacion: true }));

  const pub = path.join(raiz, 'public');
  app.use('/vendor/chart.js', express.static(path.join(raiz, 'node_modules', 'chart.js', 'dist')));
  app.use('/vendor/fonts/barlow', express.static(path.join(raiz, 'node_modules', '@fontsource', 'barlow', 'files')));
  app.use('/vendor/fonts/barlow-condensed', express.static(path.join(raiz, 'node_modules', '@fontsource', 'barlow-condensed', 'files')));
  app.use(express.static(pub));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
  return { app, db, google, planner };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let config;
  try {
    config = leerConfig(process.env, raiz);
  } catch (e) {
    if (!(e instanceof ErrorConfig)) throw e;
    console.error(`\nNo se pudo iniciar BHUMI: ${e.message}\n`);
    process.exit(1);
  }
  for (const a of config.advertencias) console.warn(`ADVERTENCIA: ${a}`);
  const { app, db } = crearApp({ dbFile: config.dbFile, clavesGoogle: config.clavesGoogle, trustProxy: config.trustProxy });
  if (db.prepare('SELECT COUNT(*) AS n FROM usuarios').get().n === 0) {
    console.warn('AVISO: todavía no hay usuarios. Crea el primer administrador con:  npm run crear-admin  (en Docker: docker compose exec app npm run crear-admin)');
  }
  const servidor = app.listen(config.puerto, config.host, () => {
    const local = config.host === '127.0.0.1' || config.host === 'localhost';
    console.log(local
      ? `\n  BHUMI está funcionando.\n  Abre http://localhost:${config.puerto} en tu navegador.\n  (Para cerrar el programa presiona Ctrl + C)\n`
      : `BHUMI ${VERSION} escuchando en ${config.host}:${config.puerto} · base ${config.dbFile} · Google ${config.clavesGoogle ? 'por variables de entorno' : 'desde Configuración'}`);
  });

  // Cierre ordenado (Docker envía SIGTERM): termina las solicitudes en curso y cierra la base sin dejarla a medio escribir.
  let cerrando = false;
  const cerrar = (senal) => {
    if (cerrando) return;
    cerrando = true;
    console.log(`Recibido ${senal}: cerrando BHUMI…`);
    servidor.close(() => {
      try { db.close(); } catch { /* ya cerrada */ }
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => cerrar('SIGTERM'));
  process.on('SIGINT', () => cerrar('SIGINT'));
}
