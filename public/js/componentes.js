// Piezas de interfaz que se repiten en varias secciones.
import { html, raw, pintar, clp, pluralizar, mesActual, nombreMes, descargar, alHacer, qs, num0 } from './lib.js';

/** Tarjeta de indicador. `valor` puede ser texto o HTML; si es null muestra "Sin datos". */
export function kpi(titulo, valor, { unidad = '', detalle = '', vacio = 'Sin datos aún', tono = '' } = {}) {
  return html`<div class="kpi ${tono}"><dt>${titulo}</dt><dd class="valor num">${valor == null ? html`<span class="sin-dato">${vacio}</span>` : html`${valor}${unidad ? html`<small>${unidad}</small>` : ''}`}</dd>${detalle ? html`<div class="detalle">${detalle}</div>` : ''}</div>`;
}

/** Datos que faltan para calcular costos reales (viene de /api/setup). */
// Pasos que solo puede completar un administrador (en el servidor central esas pestañas son solo de Admin).
const PASO_SOLO_ADMIN = /tab=(google|base)\b/;

/** `esAdmin` en false: los pasos de Admin se muestran sin enlace, porque esa persona no puede abrirlos. */
export function checklistSetup(setup, { soloFaltantes = false, esAdmin = true } = {}) {
  const items = soloFaltantes ? setup.items.filter((i) => i.estado === 'falta') : setup.items;
  const marca = { ok: '✓', falta: '!', opcional: '·' };
  const accion = (i) => {
    if (i.estado === 'ok') return html`<span class="insignia ok">Listo</span>`;
    if (!esAdmin && PASO_SOLO_ADMIN.test(i.href ?? '')) return html`<span class="insignia">Lo completa un administrador</span>`;
    return html`<a class="btn btn-chico" href="${i.href}">Completar</a>`;
  };
  return html`<ul class="lista-pasos">${items.map((i) => html`<li><span class="marca-estado ${i.estado}" aria-hidden="true">${marca[i.estado]}</span>
    <div style="flex:1"><b>${i.titulo}</b>${i.estado === 'opcional' ? html` <span class="tenue">(recomendado)</span>` : ''}<div class="det">${i.detalle}</div></div>
    ${accion(i)}</li>`)}</ul>`;
}

export const textoClientes = (n) => pluralizar(n, 'cliente', 'clientes');

/** Pestañas de una sección. Cada pestaña es un enlace (#/seccion?tab=x), así se puede volver a ella y compartir. */
export function pestanas(seccion, defs, actual, extra = '') {
  return html`<div class="tabs" role="tablist">${defs.map(([id, texto]) => html`<button role="tab" type="button" data-tab="${id}" data-seccion="${seccion}" data-extra="${extra}" aria-selected="${id === actual}">${texto}</button>`)}</div>`;
}
export function activarPestanas(root, navegar) {
  alHacer(root, 'click', '[data-tab]', (e, b) => navegar(`#/${b.dataset.seccion}?tab=${b.dataset.tab}${b.dataset.extra ? `&${b.dataset.extra}` : ''}`));
}

// ---------- Período: un mes o un rango de fechas ----------
export function periodoDe(params) {
  const desde = params.get('desde') ?? '';
  const hasta = params.get('hasta') ?? '';
  if (desde || hasta) return { modo: 'rango', desde, hasta, mes: '', query: { desde, hasta } };
  const mes = params.get('mes') || mesActual();
  return { modo: 'mes', desde: '', hasta: '', mes, query: { mes } };
}
const mesDelta = (ym, d) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + d, 1)).toISOString().slice(0, 7); };

export function barraPeriodo(per) {
  return html`<div class="filtros-kpi barra-periodo" id="barra-periodo">
    <div class="segmentado" role="group" aria-label="Tipo de período"><button type="button" data-per="mes" aria-pressed="${per.modo === 'mes'}">Un mes</button><button type="button" data-per="rango" aria-pressed="${per.modo === 'rango'}">Rango de fechas</button></div>
    ${per.modo === 'mes'
      ? html`<button type="button" class="btn btn-chico btn-icono" data-mes-delta="-1" aria-label="Mes anterior">‹</button><input type="month" id="per-mes" value="${per.mes}" aria-label="Mes"><button type="button" class="btn btn-chico btn-icono" data-mes-delta="1" aria-label="Mes siguiente">›</button><span class="muted mes-nombre">${nombreMes(per.mes)}</span>`
      : html`<label class="check">Desde <input type="date" id="per-desde" value="${per.desde}"></label><label class="check">Hasta <input type="date" id="per-hasta" value="${per.hasta}"></label>`}
  </div>`;
}
/** Conecta la barra de período: al cambiar, vuelve a abrir la sección con el nuevo período (conserva el resto de la dirección). */
export function activarPeriodo(root, seccion, params, navegar, conservar = []) {
  const ir = (q) => {
    const o = { ...q };
    for (const k of conservar) if (params.get(k)) o[k] = params.get(k);
    navegar(`#/${seccion}${qs(o)}`);
  };
  alHacer(root, 'click', '[data-per]', (e, b) => { if (b.dataset.per === 'mes') ir({ mes: mesActual() }); else { const hoy = new Date().toISOString().slice(0, 10); ir({ desde: `${mesActual()}-01`, hasta: hoy }); } });
  alHacer(root, 'click', '[data-mes-delta]', (e, b) => ir({ mes: mesDelta(root.querySelector('#per-mes').value || mesActual(), Number(b.dataset.mesDelta)) }));
  root.addEventListener('change', (e) => {
    if (e.target.id === 'per-mes' && e.target.value) ir({ mes: e.target.value });
    if (e.target.id === 'per-desde' || e.target.id === 'per-hasta') {
      const d = root.querySelector('#per-desde').value;
      const h = root.querySelector('#per-hasta').value;
      if (d && h && d <= h) ir({ desde: d, hasta: h });
    }
  });
}

/** Botones para bajar un informe en Excel o PDF. `base` es la ruta sin extensión, p. ej. /api/reportes/panel. */
export function botonesExportar(base, query = {}, { pdf = true } = {}) {
  const q = qs(query);
  const ruta = base.replace(/^\/api/, ''); // para ocultarlos a quien no puede descargar ese reporte
  return html`<div class="fila"><button class="btn btn-chico" type="button" data-descargar="${base}.xlsx${q}" data-requiere="GET ${ruta}.xlsx">Descargar Excel</button>${pdf ? html`<button class="btn btn-chico" type="button" data-descargar="${base}.pdf${q}" data-requiere="GET ${ruta}.pdf">Descargar PDF</button>` : ''}</div>`;
}
export function activarExportar(root) {
  alHacer(root, 'click', '[data-descargar]', async (e, b) => { b.disabled = true; try { await descargar(b.dataset.descargar); } finally { b.disabled = false; } });
}

/** Barra horizontal de proporción: `valor` frente a `max`. */
export function barra(valor, max, { color = 'var(--serie-1)', alto = 10 } = {}) {
  const p = max > 0 && valor != null ? Math.max(0, Math.min(100, (valor / max) * 100)) : 0;
  return html`<div class="barra-h" style="height:${alto}px" role="img" aria-label="${num0(p)}%"><i style="width:${p}%;background:${color}"></i></div>`;
}

/** Aviso con lo que falta para poder calcular algo. */
export function faltaDato(titulo, items, accion = null) {
  return html`<div class="aviso ambar"><h3>${titulo}</h3>${items?.length ? html`<ul>${items.map((x) => html`<li>${x}</li>`)}</ul>` : ''}${accion ? html`<p>${accion}</p>` : ''}</div>`;
}

/** Color de cada nivel de seguridad (mapa y etiquetas). */
export const COLOR_SEGURIDAD = { sin_evaluar: '#8a948f', normal: '#1F7A4D', precaucion: '#F2A900', alto_riesgo: '#C23B22' };
export function insigniaSeguridad(id, meta) {
  const nombre = meta.niveles_seguridad.find((x) => x.id === id)?.nombre ?? 'Sin evaluar';
  const clase = { normal: 'ok', precaucion: 'aviso', alto_riesgo: 'error' }[id] ?? '';
  return html`<span class="insignia ${clase}">${nombre}</span>`;
}

export { raw, pintar, clp };
