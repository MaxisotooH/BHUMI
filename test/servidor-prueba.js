// Modo demostración: prueba toda la interfaz SIN Google Maps ni internet.
// Usa un Google simulado (distancias en línea recta x 1,3), un mapa de demostración y datos de PRUEBA que viven solo en memoria.
// No toca data/bhumi.db. Uso: npm run demo   (o: node --disable-warning=ExperimentalWarning test/servidor-prueba.js [puerto] [--vacio])
import { crearApp } from '../server/index.js';
import { crearFakeGoogle } from './fake-google.js';
import { sembrarDemo } from './demo-datos.js';

const puerto = Number(process.argv[2]) || 3100;
const fake = crearFakeGoogle();
const { app } = crearApp({ dbFile: ':memory:', fetchImpl: fake.fetchImpl, demo: true });
const server = await new Promise((ok) => { const s = app.listen(puerto, '127.0.0.1', () => ok(s)); });
const base = `http://127.0.0.1:${puerto}/api`;
const call = async (method, ruta, body) => {
  const res = await fetch(base + ruta, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${ruta}: ${data.error?.mensaje}`);
  return data;
};

if (!process.argv.includes('--vacio')) await sembrarDemo(call);
console.log(`\n  BHUMI en MODO DEMOSTRACIÓN.\n  Abre http://localhost:${puerto} en tu navegador.\n  Son datos de prueba y un mapa simulado: nada se guarda al cerrar.\n  (Para cerrar presiona Ctrl + C)\n`);
process.on('SIGTERM', () => server.close(() => process.exit(0)));
