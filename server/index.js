// Servidor de BHUMI: API + archivos de la interfaz.
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, getSettings } from './db.js';
import { createGoogle } from './services/google.js';
import { createPlanner } from './services/planner.js';
import { createApi } from './api.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 13)) {
  console.error(`\nBHUMI necesita Node.js 22.13 o superior (tienes ${process.versions.node}).\nDescarga la versión LTS desde https://nodejs.org y vuelve a abrir el programa.\n`);
  process.exit(1);
}

export function crearApp({ dbFile = path.join(raiz, 'data', 'bhumi.db'), fetchImpl, demo = false } = {}) {
  const db = openDb(dbFile);
  const google = createGoogle({ getKey: () => getSettings(db).google_api_key, fetchImpl });
  const planner = createPlanner({ db, google });
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10mb' }));
  app.use('/api', createApi({ db, google, planner, demo }));

  const pub = path.join(raiz, 'public');
  app.use('/vendor/chart.js', express.static(path.join(raiz, 'node_modules', 'chart.js', 'dist')));
  app.use('/vendor/fonts/barlow', express.static(path.join(raiz, 'node_modules', '@fontsource', 'barlow', 'files')));
  app.use('/vendor/fonts/barlow-condensed', express.static(path.join(raiz, 'node_modules', '@fontsource', 'barlow-condensed', 'files')));
  app.use(express.static(pub));
  app.get('*', (req, res) => res.sendFile(path.join(pub, 'index.html')));
  return { app, db, google, planner };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const puerto = Number(process.env.PORT) || 3000;
  const { app } = crearApp();
  app.listen(puerto, '127.0.0.1', () => {
    console.log(`\n  BHUMI está funcionando.\n  Abre http://localhost:${puerto} en tu navegador.\n  (Para cerrar el programa presiona Ctrl + C)\n`);
  });
}
