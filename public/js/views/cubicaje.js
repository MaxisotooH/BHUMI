// Cubicaje y optimización de la capacidad de carga, más consolidación de despachos.
import { html, pintar, falla } from '../lib.js';
import { pestanas, activarPestanas } from '../componentes.js';
import { pintarCalculadora } from './cubicaje-calculadora.js';
import { pintarProductos, pintarCapacidad } from './cubicaje-productos.js';
import { pintarConsolidacion } from './cubicaje-consolidacion.js';

const TABS = [['calculadora', 'Calculadora de carga'], ['consolidacion', 'Consolidar despachos'], ['capacidad', 'Capacidad por producto'], ['productos', 'Productos y medidas']];

export default async function (ctx) {
  const { root, params, navegar } = ctx;
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'calculadora';
  pintar(root, html`
    <div class="pagina-cab"><p>Calcula cuántos productos caben en cada vehículo según sus medidas y su peso, y descubre qué entregas conviene llevar juntas para hacer menos viajes. Usa solo las medidas que tú ingresas.</p></div>
    ${pestanas('cubicaje', TABS, tab)}<div id="tab-contenido"><div class="cargando"><span class="spinner"></span></div></div>`);
  activarPestanas(root, navegar);
  const cont = root.querySelector('#tab-contenido');
  try {
    if (tab === 'calculadora') await pintarCalculadora(ctx, cont);
    else if (tab === 'consolidacion') await pintarConsolidacion(ctx, cont);
    else if (tab === 'capacidad') await pintarCapacidad(ctx, cont);
    else await pintarProductos(ctx, cont);
  } catch (e) { falla(e); throw e; }
}
