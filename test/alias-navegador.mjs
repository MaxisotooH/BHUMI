// Ejecuta las pruebas con las mismas piezas que usa el navegador (PDFKit "standalone", ExcelJS de navegador,
// EventEmitter propio y el enrutador mini-express) para comprobar los reportes sin abrir un navegador.
import { register } from 'node:module';
register('./alias-navegador-hook.mjs', import.meta.url);
