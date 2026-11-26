// Utilidades compartidas de la interfaz: plantillas seguras, formato, API, modales y gráficos.

// ---------- Plantillas HTML con escape automático ----------
class Seguro { constructor(s) { this.s = s; } toString() { return this.s; } }
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const raw = (s) => new Seguro(String(s ?? ''));
const parte = (v) => (v == null || v === false ? '' : v instanceof Seguro ? v.s : Array.isArray(v) ? v.map(parte).join('') : esc(v));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += parte(vals[i]); });
  return new Seguro(out);
}
export const pintar = (el, contenido) => { el.innerHTML = contenido instanceof Seguro ? contenido.s : String(contenido); return el; };

// ---------- Formato ----------
const nf0 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const num0 = (n) => (n == null ? '—' : nf0.format(n));
export const num1 = (n) => (n == null ? '—' : nf1.format(n));
export const clp = (n) => (n == null ? '—' : `${n < 0 ? '−' : ''}$${nf0.format(Math.abs(Math.round(n)))}`);
export const kmTxt = (n) => (n == null ? '—' : `${nf1.format(n)} km`);
export const pct = (n, d = 0) => (n == null ? '—' : `${new Intl.NumberFormat('es-CL', { maximumFractionDigits: d }).format(n)}%`);
export function duracion(min) {
  if (min == null) return '—';
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}
export function fecha(iso) {
  if (!iso) return '—';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}
export const hoy = () => new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const mesActual = () => hoy().slice(0, 7);
export const mañana = () => new Date(Date.now() + 86400000 - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
export const nombreMes = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('es-CL', { month: 'long', year: 'numeric' });
};
/** Diferencia en minutos con signo: "+6 min", "−3 min" o "igual". Vacío si no hay dato. */
export const difMin = (n) => (n == null ? '' : Math.round(n) === 0 ? 'igual' : `${n > 0 ? '+' : '−'}${num0(Math.abs(n))} min`);
/** Clase de color para una diferencia de tiempo: más minutos que lo previsto es peor. */
export const claseDif = (n) => (n == null || Math.round(n) === 0 ? '' : n > 0 ? 'dif-mas' : 'dif-menos');
export const pluralizar = (n, uno, varios) => `${num0(n)} ${n === 1 ? uno : varios}`;
export const nombreVehiculo = (v) => v.nombre ? `${v.nombre} · ${v.marca} ${v.modelo}` : `${v.marca} ${v.modelo}`;

// ---------- API ----------
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch(`/api${url}`, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  } catch {
    const e = new Error('BHUMI no pudo atender la solicitud. Recarga la página; si sigue igual, restaura tu último respaldo desde Configuración → Respaldo.');
    e.code = 'sin_servidor';
    throw e;
  }
  const esJson = (res.headers.get('content-type') ?? '').includes('json');
  const data = esJson ? await res.json() : null;
  if (!res.ok) {
    const e = new Error(data?.error?.mensaje ?? `Error ${res.status}`);
    e.code = data?.error?.code;
    e.extra = data?.error?.extra;
    e.status = res.status;
    // Servidor central: la sesión venció o se cerró desde otro lado. La aplicación muestra el inicio de sesión.
    if (res.status === 401 && e.code === 'sin_sesion') window.dispatchEvent(new CustomEvent('bhumi:sin-sesion', { detail: e.message }));
    throw e;
  }
  return data;
}
export const get = (u) => api('GET', u);
export const post = (u, b) => api('POST', u, b ?? {});
export const put = (u, b) => api('PUT', u, b ?? {});
export const del = (u) => api('DELETE', u);
export const qs = (o) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v !== '' && v != null && v !== false) p.set(k, v === true ? '1' : v);
  const s = p.toString();
  return s ? `?${s}` : '';
};

// ---------- Avisos y modales ----------
export function toast(texto, tipo = 'ok', ms = 4200) {
  const cont = document.getElementById('toasts');
  const t = document.createElement('div');
  t.className = `toast ${tipo === 'ok' ? '' : tipo}`;
  t.textContent = texto;
  cont.appendChild(t);
  setTimeout(() => t.remove(), tipo === 'error' ? Math.max(ms, 7000) : ms);
}
// Sin sesión no hace falta el aviso: la pantalla de inicio de sesión ya lo explica.
export const falla = (e) => { if (e?.code !== 'sin_sesion') toast(e?.message ?? String(e), 'error'); };

export function modal({ titulo, cuerpo, ancho = 640, acciones = [], alAbrir, cerrarAlFondo = true }) {
  const raiz = document.getElementById('modales');
  const fondo = document.createElement('div');
  fondo.className = 'modal-fondo';
  fondo.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(titulo)}" style="--ancho:${ancho}px">
    <div class="modal-cab"><h2>${esc(titulo)}</h2><button type="button" aria-label="Cerrar" data-cerrar>×</button></div>
    <div class="modal-cuerpo"></div>
    ${acciones.length ? '<div class="modal-pie"></div>' : ''}
  </div>`;
  fondo.querySelector('.modal-cuerpo').innerHTML = cuerpo instanceof Seguro ? cuerpo.s : cuerpo;
  const previo = document.activeElement;
  const api_ = {
    el: fondo,
    cuerpo: fondo.querySelector('.modal-cuerpo'),
    cerrar() { fondo.remove(); document.removeEventListener('keydown', teclas); previo?.focus?.(); },
    datos() { const f = fondo.querySelector('form'); return f ? leerForm(f) : {}; },
  };
  const teclas = (e) => { if (e.key === 'Escape') api_.cerrar(); };
  document.addEventListener('keydown', teclas);
  fondo.addEventListener('click', (e) => { if ((e.target === fondo && cerrarAlFondo) || e.target.closest('[data-cerrar]')) api_.cerrar(); });
  const pie = fondo.querySelector('.modal-pie');
  acciones.forEach((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn ${a.clase ?? ''}`;
    b.textContent = a.texto;
    b.addEventListener('click', async () => {
      if (a.cerrar) return api_.cerrar();
      b.disabled = true;
      try { await a.accion?.(api_); } catch (e) { falla(e); } finally { b.disabled = false; }
    });
    pie.appendChild(b);
  });
  raiz.appendChild(fondo);
  alAbrir?.(api_);
  (fondo.querySelector('input:not([type=hidden]), select, textarea') ?? fondo.querySelector('.modal'))?.focus?.();
  return api_;
}

export function confirmar({ titulo = 'Confirmar', mensaje, textoOk = 'Aceptar', peligro = false }) {
  return new Promise((ok) => {
    modal({
      titulo, ancho: 460, cuerpo: html`<p>${mensaje}</p>`,
      acciones: [
        { texto: 'Cancelar', cerrar: true, accion: () => ok(false) },
        { texto: textoOk, clase: peligro ? 'btn-peligro' : 'btn-primario', accion: (m) => { m.cerrar(); ok(true); } },
      ],
    }).el.addEventListener('click', (e) => { if (e.target.closest('[data-cerrar]') || e.target.classList.contains('modal-fondo')) ok(false); });
  });
}

export function leerForm(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name || el.disabled) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value;
  }
  return o;
}

// ---------- Componentes pequeños ----------
export function opciones(lista, sel, { vacio = null, valor = (x) => x, texto = (x) => x } = {}) {
  return html`${vacio != null ? html`<option value="">${vacio}</option>` : ''}${lista.map((x) => html`<option value="${valor(x)}" ${String(valor(x)) === String(sel ?? '') ? raw('selected') : ''}>${texto(x)}</option>`)}`;
}
export function insigniaEstado(estado) {
  const m = {
    pendiente: ['aviso', 'Pendiente'], reprogramada: ['info', 'Reprogramada'], realizada: ['ok', 'Realizada'], cancelada: ['error', 'Cancelada'],
    planificado: ['info', 'Planificado'], en_ruta: ['aviso', 'En ruta'], completado: ['ok', 'Completado'], cancelado: ['error', 'Cancelado'],
    activo: ['ok', 'Activo'], 'en mantención': ['aviso', 'En mantención'], 'fuera de servicio': ['error', 'Fuera de servicio'],
  };
  const [c, t] = m[estado] ?? ['', estado];
  return html`<span class="insignia ${c}">${t}</span>`;
}
export const vacio = (titulo, texto, accion = '') => html`<div class="vacio"><h3>${titulo}</h3><p>${texto}</p>${accion}</div>`;

export function lineaRuta({ clase = 'ruta-a', base, paradas, retorno, mostrarCosto = true }) {
  return html`<ol class="linea-ruta ${clase}">
    <li><span class="nodo base" aria-hidden="true">B</span><div class="parada"><b>Base</b><div class="sec">${base}</div></div></li>
    ${paradas.map((p, i) => html`<li><span class="nodo" aria-hidden="true">${i + 1}</span><div class="parada">
      <b>${p.nombre}</b>${p.empresa ? html` <span class="sec">· ${p.empresa}</span>` : ''}
      <div class="sec">${[p.direccion, p.comuna].filter(Boolean).join(', ') || 'Sin dirección'}${p.ventana ? ` · horario ${p.ventana}` : ''}</div>
      <div class="tramo"><span>${kmTxt(p.km_tramo)}</span><span>${duracion(p.min_tramo)}</span>${mostrarCosto && p.costo_asignado != null ? html`<span>${clp(p.costo_asignado)} asignado</span>` : ''}${p.peso_kg != null ? html`<span>${num1(p.peso_kg)} kg</span>` : ''}</div>
    </div></li>`)}
    ${retorno ? html`<li><span class="nodo base" aria-hidden="true">B</span><div class="parada"><b>Regreso a la base</b><div class="tramo"><span>${kmTxt(retorno.km)}</span><span>${duracion(retorno.min)}</span></div></div></li>` : ''}
  </ol>`;
}

// ---------- Gráficos (Chart.js) ----------
const charts = new Set();
export function destruirGraficos() { charts.forEach((c) => c.destroy()); charts.clear(); }
const TICK = '#7B8780';
const GRID = '#E4EAE7';
export function graficoBarras(canvas, { etiquetas, series, apilado = false, formato = clp, horizontal = false }) {
  const fuente = { family: 'Barlow', size: 12 };
  const ticksCategoria = { color: TICK, font: fuente };
  const ticksValor = { color: TICK, font: fuente, callback: (v) => formato(v) };
  const c = new window.Chart(canvas, {
    type: 'bar',
    data: {
      labels: etiquetas,
      datasets: series.map((s) => ({
        label: s.nombre, data: s.datos, backgroundColor: s.color, borderRadius: apilado ? 0 : 4, borderSkipped: false,
        maxBarThickness: 34, borderWidth: apilado ? 2 : 0, borderColor: '#fff',
      })),
    },
    options: {
      indexAxis: horizontal ? 'y' : 'x', responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: series.length > 1, position: 'top', align: 'start', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: 'rectRounded', color: '#4E5B55', font: { family: 'Barlow', size: 13 } } },
        tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formato(ctx.parsed[horizontal ? 'x' : 'y'])}` }, titleFont: { family: 'Barlow' }, bodyFont: { family: 'Barlow' } },
      },
      scales: {
        x: { stacked: apilado, grid: { display: horizontal, color: GRID }, border: { color: '#C3CEC8' }, ticks: horizontal ? ticksValor : ticksCategoria },
        y: { stacked: apilado, beginAtZero: true, grid: { color: horizontal ? 'transparent' : GRID }, border: { display: false }, ticks: horizontal ? ticksCategoria : ticksValor },
      },
    },
  });
  charts.add(c);
  return c;
}

// ---------- Descargas ----------
/** Genera el archivo (Excel, PDF, respaldo) y lo guarda en la carpeta de descargas del navegador. */
export async function descargar(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      let msg = `Error ${res.status}`;
      try { msg = (await res.json()).error.mensaje; } catch { /* sin detalle */ }
      throw new Error(msg);
    }
    const cab = res.headers.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cab);
    const nombre = m ? decodeURIComponent(m[1] ?? m[2]) : 'bhumi';
    const enlace = document.createElement('a');
    enlace.href = URL.createObjectURL(await res.blob());
    enlace.download = nombre;
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    setTimeout(() => URL.revokeObjectURL(enlace.href), 60000);
  } catch (e) { falla(e); }
}

// ---------- Delegación de eventos ----------
export function alHacer(raiz, tipo, selector, fn) {
  raiz.addEventListener(tipo, (e) => {
    const t = e.target.closest(selector);
    if (t && raiz.contains(t)) fn(e, t);
  });
}
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- Campos de formulario ----------
export function campo(name, label, value, { type = 'text', unit = null, prefix = null, help = null, options = null, cls = '', step = 'any', min = null, max = null, placeholder = '', required = false, rows = 3, extra = '' } = {}) {
  const id = `f-${name}`;
  let control;
  if (options) control = html`<select name="${name}" id="${id}" ${required ? raw('required') : ''} ${raw(extra)}>${options}</select>`;
  else if (type === 'textarea') control = html`<textarea name="${name}" id="${id}" rows="${rows}" placeholder="${placeholder}">${value ?? ''}</textarea>`;
  else if (type === 'checkbox') return html`<label class="check ${cls}"><input type="checkbox" name="${name}" id="${id}" ${value ? raw('checked') : ''}> ${label}</label>`;
  else control = html`<input type="${type}" name="${name}" id="${id}" value="${value ?? ''}" placeholder="${placeholder}" ${type === 'number' ? raw(`step="${step}"`) : ''} ${min != null ? raw(`min="${min}"`) : ''} ${max != null ? raw(`max="${max}"`) : ''} ${required ? raw('required') : ''} ${raw(extra)}>`;
  if (unit) control = html`<div class="input-unidad">${control}<span>${unit}</span></div>`;
  if (prefix) control = html`<div class="input-unidad antes"><span>${prefix}</span>${control}</div>`;
  return html`<div class="campo ${cls}"><label for="${id}">${label}</label>${control}${help ? html`<small>${help}</small>` : ''}</div>`;
}

/** <option>s de comunas agrupadas por región. */
export function opcionesComunas(meta, sel, vacio = 'Seleccionar comuna') {
  return html`<option value="">${vacio}</option>${meta.regiones.map((r) => html`<optgroup label="${r.nombre}">${r.comunas.map((c) => html`<option value="${c}" ${c === sel ? raw('selected') : ''}>${c}</option>`)}</optgroup>`)}`;
}
export const regionDeComuna = (meta, comuna) => meta.regiones.find((r) => r.comunas.includes(comuna))?.nombre ?? null;
export const nombresRegiones = (meta) => meta.regiones.map((r) => r.nombre);
