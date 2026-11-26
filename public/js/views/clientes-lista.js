// Clientes: alta, edición, importación desde Excel y ubicación con Google.
import { html, raw, pintar, get, post, put, qs, toast, falla, modal, campo, opciones, opcionesComunas, regionDeComuna, nombresRegiones, clp, fecha, num0, insigniaEstado, vacio, alHacer, debounce, pluralizar, descargar } from '../lib.js';

const precisionInsignia = (c) => {
  if (c.lat == null) return html`<span class="insignia error">Sin ubicación</span>`;
  if (c.geo_precision === 'aproximada') return html`<span class="insignia aviso">Aproximada</span>`;
  if (c.geo_precision === 'manual') return html`<span class="insignia info">Manual</span>`;
  return html`<span class="insignia ok">Ubicado</span>`;
};
const urlMapa = (c) => `https://www.google.com/maps/search/?api=1&query=${c.lat},${c.lng}`;

export async function pintarClientes(ctx, cont) {
  const { estado, params } = ctx;
  const meta = estado.meta;
  const f = { q: '', region: '', comuna: '', pendiente: false, sin_coordenadas: params.get('sinc') === '1' };
  let filas = [];

  pintar(cont, html`
    <div class="fila entre" style="margin-bottom:12px"><p class="muted" style="margin:0;max-width:70ch">Registra a cada cliente con su dirección. La ubicación se obtiene con Google y se puede corregir a mano; con ella se calculan rutas, concentración de entregas y seguridad del sector.</p>
      <div class="acciones fila"><button class="btn" id="plantilla" data-requiere="POST /clientes/importar">Plantilla Excel</button><button class="btn" id="geo-pend" data-requiere="POST /clientes/geolocalizar-pendientes">Geolocalizar pendientes</button><button class="btn" id="importar" data-requiere="POST /clientes/importar">Importar Excel</button><input type="file" id="archivo" accept=".xlsx" hidden><button class="btn btn-primario" id="nuevo" data-requiere="POST /clientes">Nuevo cliente</button></div></div>
    <div class="card"><div class="card-cuerpo fila" style="border-bottom:1px solid var(--linea)">
      <input type="search" id="q" placeholder="Buscar por nombre, empresa, dirección o teléfono" style="max-width:340px" aria-label="Buscar clientes">
      <select id="region" style="max-width:240px" aria-label="Región">${opciones(nombresRegiones(meta), '', { vacio: 'Todas las regiones' })}</select>
      <select id="comuna" style="max-width:200px" aria-label="Comuna"><option value="">Todas las comunas</option></select>
      <label class="check"><input type="checkbox" id="pend"> Con entregas pendientes</label>
      <label class="check"><input type="checkbox" id="sinc" ${f.sin_coordenadas ? raw('checked') : ''}> Sin ubicación</label>
      <span class="espacio"></span><span class="muted" id="resumen"></span></div>
      <div id="lista"><div class="cargando"><span class="spinner"></span></div></div></div>`);

  const lista = cont.querySelector('#lista');
  const hayFiltro = () => f.q || f.region || f.comuna || f.pendiente || f.sin_coordenadas;
  async function cargar() {
    filas = await get(`/clientes${qs({ q: f.q, region: f.region, comuna: f.comuna, pendiente: f.pendiente, sin_coordenadas: f.sin_coordenadas })}`);
    cont.querySelector('#resumen').textContent = `${pluralizar(filas.length, 'cliente', 'clientes')}${hayFiltro() ? '' : ` · ${filas.filter((c) => c.lat != null).length} con ubicación`}`;
    if (!filas.length) {
      pintar(lista, vacio(hayFiltro() ? 'No hay clientes con esos filtros' : 'Aún no hay clientes', hayFiltro() ? 'Prueba con otra búsqueda o quita los filtros.' : 'Agrega tu primer cliente o importa tu lista desde Excel (descarga la plantilla arriba).', hayFiltro() ? '' : html`<button class="btn btn-primario" data-nuevo data-requiere="POST /clientes">Nuevo cliente</button>`));
      return;
    }
    pintar(lista, html`<div class="tabla-wrap"><table><thead><tr><th>Cliente</th><th>Dirección</th><th>Teléfono</th><th>Frecuencia</th><th>Ubicación</th><th class="der">Pendientes</th><th>Última entrega</th><th></th></tr></thead><tbody>
      ${filas.map((c) => html`<tr class="clic" data-ficha="${c.id}"><td><b>${c.nombre}</b>${c.empresa ? html`<div class="muted" style="font-size:13px">${c.empresa}</div>` : ''}</td>
        <td>${c.direccion ?? html`<span class="tenue">Sin dirección</span>`}<div class="muted" style="font-size:13px">${[c.comuna, c.region].filter(Boolean).join(' · ')}</div></td>
        <td>${c.telefono ?? ''}</td><td>${c.frecuencia_compra ?? ''}</td><td>${precisionInsignia(c)}</td>
        <td class="der">${c.pendientes ? html`<span class="insignia aviso">${c.pendientes}</span>` : '0'}</td><td>${fecha(c.ultima_entrega)}</td>
        <td class="der" style="white-space:nowrap"><button class="btn btn-texto btn-chico" data-editar="${c.id}" data-requiere="PUT /clientes/:id">Editar</button>${c.lat == null && c.direccion ? html`<button class="btn btn-texto btn-chico" data-geo="${c.id}" data-requiere="POST /clientes/:id/geolocalizar">Geolocalizar</button>` : ''}</td></tr>`)}
      </tbody></table></div>`);
  }
  const recargar = debounce(() => cargar().catch(falla), 250);
  cont.querySelector('#q').addEventListener('input', (e) => { f.q = e.target.value; recargar(); });
  cont.querySelector('#region').addEventListener('change', (e) => {
    f.region = e.target.value; f.comuna = '';
    const r = meta.regiones.find((x) => x.nombre === f.region);
    pintar(cont.querySelector('#comuna'), html`<option value="">Todas las comunas</option>${(r?.comunas ?? meta.regiones.flatMap((x) => x.comunas)).map((c) => html`<option>${c}</option>`)}`);
    recargar();
  });
  cont.querySelector('#comuna').addEventListener('change', (e) => { f.comuna = e.target.value; recargar(); });
  cont.querySelector('#pend').addEventListener('change', (e) => { f.pendiente = e.target.checked; recargar(); });
  cont.querySelector('#sinc').addEventListener('change', (e) => { f.sin_coordenadas = e.target.checked; recargar(); });

  function formulario(c = null) {
    const m = modal({
      titulo: c ? `Editar ${c.nombre}` : 'Nuevo cliente', ancho: 760,
      cuerpo: html`<form class="form-grid" id="fc">
        ${campo('nombre', 'Nombre del cliente', c?.nombre, { required: true })}${campo('empresa', 'Empresa', c?.empresa)}
        ${campo('direccion', 'Dirección (calle y número)', c?.direccion, { cls: 'doble', placeholder: 'Ej.: Av. Apoquindo 4500' })}
        ${campo('comuna', 'Comuna', null, { options: opcionesComunas(meta, c?.comuna) })}
        ${campo('region', 'Región', null, { options: opciones(nombresRegiones(meta), c?.region, { vacio: 'Seleccionar región' }) })}
        ${campo('telefono', 'Teléfono de contacto', c?.telefono, { type: 'tel' })}
        ${campo('frecuencia_compra', 'Frecuencia de compra', null, { options: opciones(meta.frecuencias, c?.frecuencia_compra, { vacio: 'Sin definir', texto: (x) => x[0].toUpperCase() + x.slice(1) }) })}
        <div class="ancho seccion-form">Ubicación geográfica</div>
        ${campo('lat', 'Latitud', c?.lat, { type: 'number', step: 'any' })}${campo('lng', 'Longitud', c?.lng, { type: 'number', step: 'any' })}
        <div class="campo doble"><span class="etiqueta">&nbsp;</span><div class="fila"><button type="button" class="btn" id="buscar">Buscar con Google</button><a class="btn btn-texto" id="ver" target="_blank" rel="noopener" ${c?.lat != null ? raw(`href="${urlMapa(c)}"`) : raw('hidden')}>Ver en Google Maps</a></div></div>
        <div class="ancho" id="aviso-geo"></div>
        ${campo('observaciones', 'Observaciones', c?.observaciones, { type: 'textarea', cls: 'ancho' })}</form>`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, {
        texto: 'Guardar cliente', clase: 'btn-primario',
        accion: async (mm) => {
          const d = mm.datos();
          const body = { ...d, geolocalizar: !d.lat && !!d.direccion };
          const r = c ? await put(`/clientes/${c.id}`, { ...body, version: c.version }) : await post('/clientes', body);
          mm.cerrar();
          toast(r.aviso ?? (c ? 'Cliente actualizado' : 'Cliente creado'), r.aviso ? 'aviso' : 'ok');
          cargar();
        },
      }],
    });
    const fc = m.el.querySelector('#fc');
    fc.elements.comuna.addEventListener('change', () => { const r = regionDeComuna(meta, fc.elements.comuna.value); if (r) fc.elements.region.value = r; });
    m.el.querySelector('#buscar').addEventListener('click', async (e) => {
      const d = m.datos();
      if (!d.direccion) return toast('Escribe primero la dirección.', 'aviso');
      e.target.disabled = true;
      try {
        const g = await post('/geocodificar', { direccion: d.direccion, comuna: d.comuna, region: d.region });
        fc.elements.lat.value = g.lat; fc.elements.lng.value = g.lng;
        if (!fc.elements.comuna.value && g.comuna) fc.elements.comuna.value = g.comuna;
        if (!fc.elements.region.value && g.region) fc.elements.region.value = g.region;
        const ver = m.el.querySelector('#ver'); ver.hidden = false; ver.href = urlMapa(g);
        pintar(m.el.querySelector('#aviso-geo'), g.precision === 'aproximada'
          ? html`<div class="aviso ambar"><b>Ubicación aproximada.</b> Google encontró ${g.direccion_formateada}, pero no el número exacto. Verifícala con “Ver en Google Maps”.</div>`
          : html`<div class="aviso verde">Google encontró: ${g.direccion_formateada}.</div>`);
      } catch (er) { falla(er); } finally { e.target.disabled = false; }
    });
  }

  async function ficha(id) {
    const c = await get(`/clientes/${id}`);
    modal({
      titulo: c.nombre, ancho: 820,
      cuerpo: html`<div class="fila entre" style="align-items:flex-start"><div><div>${c.empresa ?? ''}</div><div class="muted">${[c.direccion, c.comuna, c.region].filter(Boolean).join(', ')}</div><div class="muted">${c.telefono ?? ''}${c.frecuencia_compra ? ` · compra ${c.frecuencia_compra}` : ''}</div></div><div>${precisionInsignia(c)}</div></div>
        ${c.observaciones ? html`<p class="muted" style="margin-top:8px">${c.observaciones}</p>` : ''}
        <dl class="kpis" style="margin:16px 0"><div class="kpi"><dt>Entregas realizadas</dt><dd class="valor num">${num0(c.entregas_realizadas)}</dd></div>
          <div class="kpi"><dt>Entregas pendientes</dt><dd class="valor num">${num0(c.pendientes)}</dd></div>
          <div class="kpi" data-costo><dt>Costo promedio por entrega</dt><dd class="valor num">${c.costo_entrega?.promedio != null ? clp(c.costo_entrega.promedio) : html`<span class="sin-dato">Sin despachos</span>`}</dd></div></dl>
        <h3 class="seccion-form">Productos despachados</h3>
        ${c.productos_despachados.length ? html`<table class="tabla-compacta"><tbody>${c.productos_despachados.map((p) => html`<tr><td>${p.producto}</td><td class="der">${num0(p.cantidad)}</td></tr>`)}</tbody></table>` : html`<p class="muted">Aún no se han despachado productos a este cliente.</p>`}
        <h3 class="seccion-form">Historial de entregas</h3>
        ${c.entregas.length ? html`<table class="tabla-compacta"><thead><tr><th>Fecha</th><th>Estado</th><th>Productos</th><th>Despacho</th></tr></thead><tbody>${c.entregas.slice(0, 30).map((d) => html`<tr><td>${fecha(d.fecha_realizada ?? d.fecha)}</td><td>${insigniaEstado(d.estado)}</td><td>${d.items.map((i) => `${i.cantidad} × ${i.producto ?? i.descripcion}`).join(', ') || '—'}</td><td>${d.trip_id ? html`<a href="#/rutas?tab=despachos&trip=${d.trip_id}" data-cerrar>N° ${d.trip_id}</a>` : '—'}</td></tr>`)}</tbody></table>` : html`<p class="muted">Sin entregas registradas.</p>`}`,
      acciones: [{ texto: 'Cerrar', cerrar: true }, { texto: 'Nueva entrega', clase: 'btn-primario', accion: (m) => { m.cerrar(); location.hash = `#/rutas?tab=entregas&nueva=${c.id}`; } }],
    });
  }

  cont.querySelector('#nuevo').addEventListener('click', () => formulario());
  cont.querySelector('#plantilla').addEventListener('click', () => descargar('/api/clientes/plantilla.xlsx'));
  alHacer(cont, 'click', '[data-nuevo]', () => formulario());
  alHacer(cont, 'click', '[data-editar]', (e, b) => { e.stopPropagation(); formulario(filas.find((c) => c.id === Number(b.dataset.editar))); });
  alHacer(cont, 'click', '[data-geo]', async (e, b) => {
    e.stopPropagation(); b.disabled = true;
    try { const r = await post(`/clientes/${b.dataset.geo}/geolocalizar`); toast(r.precision === 'aproximada' ? 'Ubicación aproximada: verifícala en el mapa.' : 'Cliente geolocalizado', r.precision === 'aproximada' ? 'aviso' : 'ok'); cargar(); } catch (er) { falla(er); b.disabled = false; }
  });
  alHacer(cont, 'click', '[data-ficha]', (e, tr) => { if (!e.target.closest('button')) ficha(tr.dataset.ficha).catch(falla); });
  cont.querySelector('#geo-pend').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try {
      const r = await post('/clientes/geolocalizar-pendientes');
      const msg = `${r.geolocalizados} geolocalizados${r.aproximados ? ` (${r.aproximados} aproximados)` : ''}${r.fallidos.length ? `, ${r.fallidos.length} sin resultado` : ''}${r.restantes ? `. Quedan ${r.restantes}: vuelve a presionar.` : '.'}`;
      toast(msg, r.fallidos.length ? 'aviso' : 'ok', 7000);
      if (r.fallidos.length) modal({ titulo: 'Direcciones que Google no encontró', cuerpo: html`<p>Revisa la dirección y la comuna de estos clientes, o ingresa sus coordenadas a mano.</p><ul>${r.fallidos.map((x) => html`<li><b>${x.nombre}</b>: ${x.error}</li>`)}</ul>`, acciones: [{ texto: 'Entendido', cerrar: true }] });
      cargar();
    } catch (er) { falla(er); } finally { e.target.disabled = false; }
  });
  const archivo = cont.querySelector('#archivo');
  cont.querySelector('#importar').addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    if (!archivo.files[0]) return;
    try {
      const res = await fetch('/api/clientes/importar', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await archivo.files[0].arrayBuffer() });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.mensaje);
      toast(`${d.importados} clientes importados${d.errores.length ? `, ${d.errores.length} con error` : ''}.`, d.errores.length ? 'aviso' : 'ok', 6000);
      if (d.errores.length) modal({ titulo: 'Filas con error', cuerpo: html`<ul>${d.errores.map((x) => html`<li>Fila ${x.fila} (${x.nombre}): ${x.error}</li>`)}</ul>`, acciones: [{ texto: 'Entendido', cerrar: true }] });
      cargar();
    } catch (er) { falla(er); } finally { archivo.value = ''; }
  });
  await cargar();
  const abrirFicha = params.get('ficha');
  if (abrirFicha) ficha(abrirFicha).catch(falla);
}
