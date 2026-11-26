// Integración con Google Maps y optimización de rutas: planificar, ver los despachos y entregar la ruta al conductor.
import { html, pintar, falla } from '../lib.js';
import { pestanas, activarPestanas } from '../componentes.js';
import { pintarNueva } from './rutas-nueva.js';
import { pintarDespachos } from './rutas-despachos.js';
import { pintarEntregas } from './rutas-entregas.js';

const TABS = [['nueva', 'Nueva ruta'], ['despachos', 'Despachos'], ['entregas', 'Entregas']];

export default async function (ctx) {
  const { root, params, navegar, estado } = ctx;
  // Bodega no planifica rutas: trabaja con los despachos y las entregas del día.
  const bodega = estado.usuario?.rol === 'bodega';
  const tabs = bodega ? TABS.filter(([id]) => id !== 'nueva') : TABS;
  const pedida = params.get('tab');
  const tab = tabs.some(([id]) => id === pedida) ? pedida : params.get('trip') || bodega ? 'despachos' : 'nueva';
  pintar(root, html`${pestanas('rutas', tabs, tab)}<div id="tab-contenido"><div class="cargando"><span class="spinner"></span></div></div>`);
  activarPestanas(root, navegar);
  const cont = root.querySelector('#tab-contenido');
  try {
    cont.innerHTML = '';
    if (tab === 'nueva') await pintarNueva(ctx, cont);
    else if (tab === 'despachos') await pintarDespachos(ctx, cont);
    else await pintarEntregas(ctx, cont);
  } catch (e) { falla(e); throw e; }
}
