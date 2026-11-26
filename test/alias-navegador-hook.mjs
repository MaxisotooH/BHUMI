const raiz = new URL('../', import.meta.url);
const mapa = {
  pdfkit: new URL('node_modules/pdfkit/js/pdfkit.standalone.js', raiz).href,
  exceljs: new URL('node_modules/exceljs/dist/exceljs.min.js', raiz).href,
  events: new URL('navegador/shims/events.js', raiz).href,
  express: new URL('navegador/mini-express.js', raiz).href,
};
export async function resolve(especificador, contexto, siguiente) {
  if (especificador in mapa && !String(contexto.parentURL ?? '').includes('/node_modules/')) return { url: mapa[especificador], shortCircuit: true };
  return siguiente(especificador, contexto);
}
