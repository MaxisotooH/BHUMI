// Arma la carpeta que se entrega: dist/BHUMI (se abre con doble clic en "Abrir BHUMI.html").
// Solo la usa quien prepara una versión nueva del programa; quien usa BHUMI no necesita nada de esto.
//
// Uso:  node navegador/construir.mjs [--salida dist/BHUMI] [--sin-sqljs]
//   --sin-sqljs  empaqueta con un SQLite de pruebas (solo Node) para comprobar que el armado funciona. NO sirve para abrirlo en un navegador.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (n) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : null; };
const salida = path.resolve(raiz, arg('--salida') ?? 'dist/BHUMI');
const sinSqlJs = process.argv.includes('--sin-sqljs');

async function cargarEsbuild() {
  const candidatos = ['esbuild', '/opt/npm-tools/node_modules/esbuild/lib/main.js'];
  for (const c of candidatos) {
    try { return await import(c.startsWith('/') ? pathToFileURL(c).href : c); } catch { /* prueba el siguiente */ }
  }
  throw new Error('No se encontró esbuild (herramienta de armado).');
}

const modulo = (nombre, sub = '') => {
  const ruta = path.join(raiz, 'node_modules', nombre, sub);
  if (!fs.existsSync(ruta)) throw new Error(`Falta ${nombre} en node_modules (ejecuta npm install).`);
  return ruta;
};

if (!sinSqlJs) {
  if (!fs.existsSync(path.join(raiz, 'node_modules/sql.js/dist/sql-wasm-browser.wasm'))) throw new Error('Falta sql.js (el SQLite para el navegador). Instálalo con: npm i -D sql.js');
}

const esbuild = await cargarEsbuild();
fs.rmSync(salida, { recursive: true, force: true });
const app = path.join(salida, 'app');
fs.mkdirSync(app, { recursive: true });

const vacio = path.join(raiz, 'navegador/shims/vacio.js');
const alias = {
  'node:sqlite': path.join(raiz, 'navegador/sqlite-wasm.js'),
  'node:fs': vacio, fs: vacio, 'node:path': vacio, path: vacio, 'node:os': vacio, os: vacio, 'node:crypto': vacio, crypto: vacio,
  events: path.join(raiz, 'navegador/shims/events.js'),
  express: path.join(raiz, 'navegador/mini-express.js'),
  pdfkit: modulo('pdfkit', 'js/pdfkit.standalone.js'),
  exceljs: modulo('exceljs', 'dist/exceljs.min.js'),
};
if (sinSqlJs) {
  alias['sql.js'] = path.join(raiz, 'navegador/shims/sqljs-armado.js');
  alias['sql.js/dist/sql-wasm-browser.wasm'] = vacio;
}

await esbuild.build({
  entryPoints: [path.join(raiz, 'navegador/entrada.js')],
  outfile: path.join(app, 'bhumi.js'),
  bundle: true,
  format: 'iife',          // script clásico: Chrome no permite módulos ES desde file://
  platform: 'browser',
  target: 'chrome100',
  minifyWhitespace: true,
  minifySyntax: true,
  loader: { '.wasm': 'binary' },
  alias,
  inject: [path.join(raiz, 'navegador/shims/buffer-global.js')],
  define: { global: 'globalThis', 'process.env.NODE_ENV': '"production"' },
  banner: { js: 'window.BHUMI_CARGADO = true;' },
  legalComments: 'none',
  logLevel: 'warning',
});

// ---- Los dos archivos que se abren con doble clic: cada uno trae TODO adentro (estilos, fuentes, gráficos y programa) ----
// Así abren bien aunque se muevan de carpeta o se abran desde dentro del .zip sin extraer.
const leer = (...r) => fs.readFileSync(path.join(raiz, ...r), 'utf8');
const dentroDeScript = (js) => js.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const fuentesCss = (css) => css.replace(/url\('\/vendor\/fonts\/([a-z-]+)\/([^']+)'\)/g, (_, pkg, archivo) => {
  const f = modulo(pkg === 'barlow' ? '@fontsource/barlow' : '@fontsource/barlow-condensed', `files/${archivo}`);
  return `url('data:font/woff2;base64,${fs.readFileSync(f).toString('base64')}')`;
});
const programa = fs.readFileSync(path.join(app, 'bhumi.js'), 'utf8');
const graficos = fs.readFileSync(modulo('chart.js', 'dist/chart.umd.js'), 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
const mapaDemo = fs.readFileSync(path.join(raiz, 'public/demo/maps-demo.js'), 'utf8');
const estilos = fuentesCss(leer('public/css/app.css'));
const avisoSinPrograma = `<script>
if (!window.BHUMI_CARGADO) {
  document.body.innerHTML = '<div style="font:16px/1.5 Segoe UI,Arial,sans-serif;max-width:640px;margin:48px auto;padding:0 20px"><h1 style="font-size:24px">BHUMI no pudo abrirse en este navegador</h1><p>Abre este archivo con Google Chrome o Microsoft Edge actualizados (clic derecho sobre el archivo → Abrir con).</p></div>';
}
</script>`;

const base = leer('public/index.html');
function pagina(modo) {
  let h = base
    .replace('<link rel="stylesheet" href="/css/app.css">', () => `<style>\n${estilos}\n</style>`)
    .replace('<script src="/vendor/chart.js/chart.umd.js"></script>', () => `<script>${dentroDeScript(graficos)}</script>`)
    .replace('<script type="module" src="/js/app.js"></script>', () => `<script>window.BHUMI_MODO = '${modo}';${modo === 'demo' ? ` window.BHUMI_MAPS_DEMO_CODIGO = ${dentroDeScript(JSON.stringify(mapaDemo))};` : ''}</script>\n  <script>${dentroDeScript(programa)}</script>\n  ${avisoSinPrograma}`);
  if (/(href|src)="\/(css|js|vendor)\//.test(h)) throw new Error('Quedó una ruta externa en la página: no abriría sola.');
  if (modo === 'demo') h = h.replace('<title>BHUMI · Logística y distribución</title>', '<title>BHUMI · Demostración</title>');
  return h;
}
fs.writeFileSync(path.join(salida, 'Abrir BHUMI.html'), pagina('real'));
fs.writeFileSync(path.join(salida, 'Abrir DEMO.html'), pagina('demo'));
fs.copyFileSync(path.join(raiz, 'LEEME.txt'), path.join(salida, 'LEEME.txt'));
fs.rmSync(app, { recursive: true, force: true }); // el programa ya viene dentro de los dos archivos

// ---- Código fuente (para quien deba modificar el programa; no hace falta para usarlo) ----
const fuente = path.join(salida, 'codigo-fuente');
// Solo se omiten en la carpeta principal (server/data tiene código y sí se copia)
const omitir = new Set(['node_modules', 'dist', '.git', 'data']);
function copiar(de, a, nivel = 0) {
  fs.mkdirSync(a, { recursive: true });
  for (const e of fs.readdirSync(de, { withFileTypes: true })) {
    if ((nivel === 0 && omitir.has(e.name)) || e.name.endsWith('.db') || e.name.endsWith('.db-wal') || e.name.endsWith('.db-shm')) continue;
    const o = path.join(de, e.name), d = path.join(a, e.name);
    if (e.isDirectory()) copiar(o, d, nivel + 1); else fs.copyFileSync(o, d);
  }
}
copiar(raiz, fuente);

const kb = (f) => Math.round(fs.statSync(f).size / 1024);
console.log(`Listo: ${salida}\n  Abrir BHUMI.html ${kb(path.join(salida, 'Abrir BHUMI.html'))} KB · Abrir DEMO.html ${kb(path.join(salida, 'Abrir DEMO.html'))} KB${sinSqlJs ? '  (armado de prueba: sin SQLite de navegador)' : ''}`);
