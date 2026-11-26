// Arranque de la interfaz: menú, enrutador y estado compartido.
import { html, raw, pintar, get, clp, destruirGraficos, falla, esc, descargar } from './lib.js';
import { activarDemo } from './maps.js';

const icono = (d) => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const SECCIONES = [
  { id: 'panel', titulo: 'Panel de análisis', corto: 'Compara rutas, conductores, clientes y vehículos', icono: '<rect x="3" y="12" width="4" height="9" rx="1"/><rect x="10" y="7" width="4" height="14" rx="1"/><rect x="17" y="3" width="4" height="18" rx="1"/>' },
  { id: 'costos', titulo: 'Control de costos', corto: 'Lo modelado frente a lo gastado de verdad', icono: '<circle cx="12" cy="12" r="9"/><path d="M14.8 9.2c-.5-1-1.6-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2 0 3 5.6 1.4 5.6 4.4 0 1.2-1.2 2-2.8 2-1.3 0-2.4-.6-2.9-1.6M12 6v1.7M12 16.3V18"/>' },
  { id: 'kpi', titulo: 'Indicadores KPI', corto: 'Tiempos y cumplimiento del equipo', icono: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 1.5M9.5 2.5h5M12 2.5V6"/>' },
  { id: 'clientes', titulo: 'Clientes y zonas', corto: 'Dónde se entrega y qué tan seguro es', icono: '<path d="M12 21s-7-5.6-7-11a7 7 0 0 1 14 0c0 5.4-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/>' },
  { id: 'rutas', titulo: 'Rutas y despachos', corto: 'Planifica, optimiza y entrega la ruta al conductor', icono: '<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.5 18H15a3.5 3.5 0 0 0 0-7H9a3.5 3.5 0 0 1 0-7h6.5"/>' },
  { id: 'vehiculos', titulo: 'Vehículos y kilometraje', corto: 'Kilómetros por semana, desgaste y mantención', icono: '<path d="M2.5 16V7.5a1 1 0 0 1 1-1H14v9.5M14 10h4.2l3.3 3.5V16"/><circle cx="7" cy="17.5" r="2"/><circle cx="17.5" cy="17.5" r="2"/><path d="M9 16h6"/>' },
  { id: 'cubicaje', titulo: 'Cubicaje y consolidación', corto: 'Cuánto cabe en cada vehículo y qué despachos juntar', icono: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/>' },
  { id: 'configuracion', titulo: 'Configuración', corto: 'Google Maps, base, combustible, metas, personal y respaldo', icono: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>' },
];

export const estado = { settings: null, meta: null, setup: null };
let limpiezaVista = null;
let tokenNav = 0;

export async function refrescarEstado() {
  const [settings, setup, precios] = await Promise.all([get('/settings'), get('/setup'), get('/combustible/precios')]);
  estado.settings = settings;
  estado.setup = setup;
  estado.precios = precios;
  pintarMarco();
}

function pintarMarco() {
  const actual = ruta().id;
  pintar(document.getElementById('nav'), html`${SECCIONES.map((s) => html`<a class="nav-item" href="#/${s.id}" ${s.id === actual ? raw('aria-current="page"') : ''}>${raw(icono(s.icono))}<span>${s.titulo}</span></a>`)}`);
  const s = estado.settings;
  const bencina = estado.precios?.vigentes?.find((p) => p.combustible === 'Bencina' && p.precio != null) ?? estado.precios?.vigentes?.find((p) => p.precio != null);
  const chips = [];
  if (estado.meta?.demo) chips.push(html`<span class="dato-chip alerta" title="Datos de prueba, mapa simulado y distancias aproximadas. Nada se guarda al cerrar el programa.">Modo demostración</span>`);
  chips.push(bencina
    ? html`<a class="dato-chip" href="#/configuracion?tab=combustible" title="Precio vigente desde ${bencina.vigente_desde}">${bencina.combustible} <b class="num">${clp(bencina.precio)}/L</b></a>`
    : html`<a class="dato-chip alerta" href="#/configuracion?tab=combustible">Falta el precio del combustible</a>`);
  chips.push(html`<a class="dato-chip" href="#/configuracion?tab=base" title="Punto de partida de las rutas">Base <b>${s.deposito_comuna || 'sin definir'}</b></a>`);
  if (!s.google_api_key) chips.push(html`<a class="dato-chip alerta" href="#/configuracion?tab=google">Falta API key de Google</a>`);
  pintar(document.getElementById('topbar-datos'), html`${chips}`);
  const p = estado.setup?.pendientes ?? 0;
  pintar(document.getElementById('sidebar-pie'), p
    ? html`<a href="#/panel" style="color:#fff">Faltan <b>${p}</b> ${p === 1 ? 'dato' : 'datos'} para calcular costos reales</a>`
    : html`Configuración al día`);
}

function ruta() {
  const h = location.hash.replace(/^#\/?/, '') || 'panel';
  const [id, query = ''] = h.split('?');
  return { id: SECCIONES.some((s) => s.id === id) ? id : 'panel', params: new URLSearchParams(query) };
}

export function navegar(hash) { location.hash = hash; }

async function mostrar() {
  const mi = ++tokenNav;
  const { id, params } = ruta();
  const sec = SECCIONES.find((s) => s.id === id);
  document.getElementById('titulo-pagina').textContent = sec.titulo;
  document.getElementById('subtitulo-pagina').textContent = sec.corto ?? '';
  document.title = `${sec.titulo} · BHUMI`;
  document.getElementById('sidebar').classList.remove('abierto');
  if (limpiezaVista) { try { limpiezaVista(); } catch { /* vista ya cerrada */ } limpiezaVista = null; }
  destruirGraficos();
  // Cada pantalla recibe un contenedor nuevo: así no se acumulan los eventos de las pantallas anteriores.
  const anterior = document.getElementById('vista');
  const vista = anterior.cloneNode(false);
  anterior.replaceWith(vista);
  vista.className = 'vista';
  vista.innerHTML = '<div class="cargando"><span class="spinner"></span> Cargando…</div>';
  if (estado.settings) pintarMarco();
  try {
    const mod = await import(`./views/${id}.js`);
    if (mi !== tokenNav) return;
    vista.innerHTML = '';
    const ctx = {
      root: vista, params, estado, navegar, refrescarEstado,
      pantallaCompleta: () => vista.classList.add('sin-padding'),
    };
    const r = await mod.default(ctx);
    if (mi !== tokenNav) { r?.(); return; }
    if (typeof r === 'function') limpiezaVista = r;
    vista.focus({ preventScroll: true });
  } catch (e) {
    console.error(e);
    vista.className = 'vista';
    vista.innerHTML = `<div class="aviso rojo"><h3>No se pudo abrir esta sección</h3><p>${esc(e.message)}</p></div>`;
  }
}

/** Recuerda descargar un respaldo: los datos viven solo en este navegador. */
async function avisoRespaldo() {
  const almacen = window.BHUMI_ALMACEN;
  if (!almacen || estado.meta?.demo) return;
  const ultimo = await almacen.ultimoRespaldo();
  const referencia = ultimo ?? await almacen.primerUso();
  const dias = Math.floor((Date.now() - new Date(referencia)) / 86400000);
  if (dias < (ultimo ? 7 : 3)) return;
  const caja = document.createElement('div');
  caja.className = 'aviso ambar aviso-respaldo';
  caja.innerHTML = `<p><b>${ultimo ? `Hace ${dias} días que no descargas un respaldo.` : 'Aún no has descargado ningún respaldo.'}</b> Tus datos están guardados solo en este navegador; una copia en OneDrive o en un pendrive los protege si algo falla.</p>
    <div class="fila"><button class="btn btn-primario btn-chico" type="button" data-ahora>Descargar respaldo ahora</button><button class="btn btn-chico" type="button" data-despues>Recordármelo más tarde</button></div>`;
  caja.querySelector('[data-ahora]').addEventListener('click', async () => { await descargar('/api/respaldo.db'); caja.remove(); });
  caja.querySelector('[data-despues]').addEventListener('click', () => caja.remove());
  document.querySelector('.principal').insertBefore(caja, document.getElementById('vista'));
}

async function iniciar() {
  document.getElementById('btn-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('abierto'));
  try {
    estado.meta = await get('/meta');
    activarDemo(estado.meta.demo);
    await refrescarEstado();
    avisoRespaldo().catch(() => {});
  } catch (e) {
    document.getElementById('vista').innerHTML = `<div class="aviso rojo"><h3>BHUMI no pudo arrancar</h3><p>${esc(e.message)}</p></div>`;
    falla(e);
    return;
  }
  window.addEventListener('hashchange', mostrar);
  mostrar();
}
iniciar();
