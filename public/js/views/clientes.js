// Geolocalización de clientes: mapa y concentración de entregas, ficha de clientes y evaluación de seguridad por sector.
import { html, pintar, falla } from '../lib.js';
import { pestanas, activarPestanas } from '../componentes.js';
import { pintarMapa } from './clientes-mapa.js';
import { pintarClientes } from './clientes-lista.js';
import { pintarZonas } from './clientes-zonas.js';

const TABS = [['mapa', 'Mapa y concentración'], ['lista', 'Clientes'], ['zonas', 'Zonas y seguridad']];

export default async function (ctx) {
  const { root, params, navegar } = ctx;
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'mapa';
  pintar(root, html`${pestanas('clientes', TABS, tab)}<div id="tab-contenido"><div class="cargando"><span class="spinner"></span></div></div>`);
  activarPestanas(root, navegar);
  const cont = root.querySelector('#tab-contenido');
  try {
    if (tab === 'mapa') await pintarMapa(ctx, cont);
    else if (tab === 'lista') await pintarClientes(ctx, cont);
    else await pintarZonas(ctx, cont);
  } catch (e) { falla(e); throw e; }
}
