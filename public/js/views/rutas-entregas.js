// Entregas: lo que hay que entregar a cada cliente, con sus productos, agrupado por comuna.
import { html, raw, pintar, get, post, put, del, qs, toast, falla, modal, confirmar, campo, opciones, num0, num1, fecha, hoy, mañana, insigniaEstado, vacio, alHacer, debounce, pluralizar, nombresRegiones } from '../lib.js';

const ESTADOS = [['pendientes', 'Pendientes y reprogramadas'], ['pendiente', 'Solo pendientes'], ['reprogramada', 'Reprogramadas'], ['realizada', 'Realizadas'], ['cancelada', 'Canceladas'], ['', 'Todas']];

const agrupar = (lista) => { const m = new Map(); for (const e of lista) { const k = e.comuna ?? 'Sin comuna'; if (!m.has(k)) m.set(k, []); m.get(k).push(e); } return [...m]; };

export async function pintarEntregas(ctx, root) {
  const { params, estado, navegar } = ctx;
  const meta = estado.meta;
  const f = { estado: 'pendientes', region: '', comuna: '', agrupar: true };
  const sel = new Set();
  let entregas = [];
  let productos = [];

  pintar(root, html`<div class="fila entre" style="margin-bottom:12px"><p class="muted" style="margin:0;max-width:70ch">Registra lo que hay que entregar, con productos y cantidades. Con las medidas de los productos el sistema calcula si la carga cabe en el vehículo. Elige varias entregas y calcula la ruta.</p>
    <div class="acciones"><button class="btn btn-primario" id="nueva">Nueva entrega</button></div></div>
    <div id="cuerpo"></div><div id="barra"></div>`);
  const cuerpo = root.querySelector('#cuerpo');
  const barra = root.querySelector('#barra');

  // ---------- Entregas ----------
  async function cargarEntregas() {
    productos = productos.length ? productos : await get('/productos');
    entregas = await get(`/entregas${qs({ estado: f.estado, region: f.region, comuna: f.comuna })}`);
    for (const id of [...sel]) if (!entregas.some((e) => e.id === id && !e.trip_id && ['pendiente', 'reprogramada'].includes(e.estado))) sel.delete(id);
    pintarEntregas();
  }

  const productosTxt = (e) => (e.items.length ? e.items.map((i) => `${num0(i.cantidad)} × ${i.producto ?? i.descripcion}`).join(', ') : '—');
  const seleccionable = (e) => !e.trip_id && ['pendiente', 'reprogramada'].includes(e.estado);

  function filaEntrega(e) {
    const sinUbic = (e.lat ?? e.cliente_lat) == null;
    return html`<tr class="${sel.has(e.id) ? 'sel' : ''}">
      <td style="width:36px">${seleccionable(e) ? html`<input type="checkbox" data-sel="${e.id}" ${sel.has(e.id) ? raw('checked') : ''} aria-label="Seleccionar entrega de ${e.cliente}" style="width:17px;height:17px;accent-color:var(--senal)">` : ''}</td>
      <td><b>${e.cliente}</b>${e.empresa ? html`<div class="muted" style="font-size:13px">${e.empresa}</div>` : ''}${sinUbic ? html`<div><span class="insignia error">Sin ubicación</span></div>` : ''}</td>
      <td>${e.comuna ?? html`<span class="tenue">Sin comuna</span>`}</td>
      <td style="max-width:280px">${productosTxt(e)}${e.peso_kg != null ? html`<div class="muted" style="font-size:13px">${num1(e.peso_kg)} kg</div>` : ''}</td>
      <td>${e.fecha ? fecha(e.fecha) : html`<span class="tenue">Sin fecha</span>`}${e.ventana_desde ? html`<div class="muted" style="font-size:13px">${e.ventana_desde}${e.ventana_hasta ? `–${e.ventana_hasta}` : ''}</div>` : ''}</td>
      <td>${insigniaEstado(e.estado)}${e.motivo_reprogramacion ? html`<div class="muted" style="font-size:12.5px">${e.motivo_reprogramacion}</div>` : ''}${e.trip_id ? html`<div><a href="#/rutas?tab=despachos&trip=${e.trip_id}">Despacho N° ${e.trip_id}</a></div>` : ''}</td>
      <td class="der" style="white-space:nowrap">${e.estado !== 'realizada' && e.estado !== 'cancelada' && !e.trip_id ? html`<button class="btn btn-texto btn-chico" data-editar="${e.id}" data-requiere="PUT /entregas/:id">Editar</button><button class="btn btn-texto btn-chico" data-reprog="${e.id}">Reprogramar</button>` : ''}
        ${!e.trip_id && e.estado !== 'realizada' ? html`<button class="btn btn-texto btn-chico" data-hecha="${e.id}">Marcar realizada</button>` : ''}
        ${e.estado === 'cancelada' ? html`<button class="btn btn-texto btn-chico" data-reabrir="${e.id}">Reabrir</button>` : ''}
        ${!e.trip_id && e.estado !== 'realizada' ? html`<button class="btn btn-texto btn-chico" data-borrar="${e.id}" data-requiere="DELETE /entregas/:id">Eliminar</button>` : ''}</td></tr>`;
  }

  function pintarEntregas() {
    const comunas = f.region ? meta.regiones.find((r) => r.nombre === f.region)?.comunas ?? [] : meta.regiones.flatMap((r) => r.comunas);
    const head = html`<div class="card"><div class="card-cuerpo fila" style="border-bottom:1px solid var(--linea)">
      <select id="f-estado" style="max-width:240px" aria-label="Estado">${opciones(ESTADOS, f.estado, { valor: (x) => x[0], texto: (x) => x[1] })}</select>
      <select id="f-region" style="max-width:230px" aria-label="Región">${opciones(nombresRegiones(meta), f.region, { vacio: 'Todas las regiones' })}</select>
      <select id="f-comuna" style="max-width:200px" aria-label="Comuna">${opciones(comunas, f.comuna, { vacio: 'Todas las comunas' })}</select>
      <label class="check"><input type="checkbox" id="f-agrupar" ${f.agrupar ? raw('checked') : ''}> Agrupar por comuna</label>
      <span class="espacio"></span><span class="muted">${pluralizar(entregas.length, 'entrega', 'entregas')}</span></div>`;
    if (!entregas.length) {
      pintar(cuerpo, html`${head}${vacio(f.estado === 'pendientes' && !f.region && !f.comuna ? 'No hay entregas pendientes' : 'No hay entregas con esos filtros', 'Registra lo que debes entregar: elige el cliente, los productos y las cantidades.', html`<button class="btn btn-primario" data-nueva data-requiere="POST /entregas">Nueva entrega</button>`)}</div>`);
    } else {
      const grupos = f.agrupar ? agrupar(entregas).sort((a, b) => a[0].localeCompare(b[0], 'es')) : [['', entregas]];
      pintar(cuerpo, html`${head}<div class="tabla-wrap"><table><thead><tr><th></th><th>Cliente</th><th>Comuna</th><th>Productos</th><th>Fecha y horario</th><th>Estado</th><th></th></tr></thead>
        ${grupos.map(([comuna, lista]) => html`<tbody>${f.agrupar ? html`<tr><td colspan="7" style="background:var(--senal-suave);font-weight:600;color:var(--senal)">
          ${lista.some(seleccionable) ? html`<label class="check" style="display:inline-flex"><input type="checkbox" data-grupo="${comuna}" style="width:17px;height:17px;accent-color:var(--senal)" ${lista.filter(seleccionable).every((e) => sel.has(e.id)) ? raw('checked') : ''}> ${comuna}</label>` : comuna}
          <span class="muted" style="font-weight:400"> · ${pluralizar(lista.length, 'entrega', 'entregas')}${lista.some((e) => e.peso_kg != null) ? ` · ${num1(lista.reduce((a, e) => a + (e.peso_kg ?? 0), 0))} kg` : ''}</span></td></tr>` : ''}${lista.map(filaEntrega)}</tbody>`)}</table></div></div>`);
    }
    pintarBarra();
  }

  function pintarBarra() {
    if (!sel.size) { pintar(barra, ''); return; }
    const elegidas = entregas.filter((e) => sel.has(e.id));
    const kg = elegidas.every((e) => e.peso_kg != null) ? elegidas.reduce((a, e) => a + e.peso_kg, 0) : null;
    pintar(barra, html`<div class="barra-fija"><b>${pluralizar(sel.size, 'entrega seleccionada', 'entregas seleccionadas')}</b>
      <span>${kg != null ? `${num1(kg)} kg · ` : ''}${[...new Set(elegidas.map((e) => e.comuna).filter(Boolean))].join(', ')}</span><span class="espacio"></span>
      <button class="btn" data-limpiar>Quitar selección</button>${ctx.estado.usuario?.rol === 'bodega' ? '' : html`<button class="btn btn-ambar" data-planificar>Calcular rutas y costos</button>`}</div>`);
  }

  // ---------- Formulario de entrega ----------
  async function formularioEntrega(e = null, clienteId = null) {
    let cliente = e ? { id: e.client_id, nombre: e.cliente } : null;
    if (!e && clienteId) { try { const c = await get(`/clientes/${clienteId}`); cliente = { id: c.id, nombre: c.nombre }; } catch { /* se elige a mano */ } }
    const items = e?.items?.length ? e.items.map((i) => ({ product_id: i.product_id, descripcion: i.descripcion, cantidad: i.cantidad })) : [{ cantidad: 1 }];
    const filaItem = (it, i) => html`<tr data-fila="${i}"><td><select data-prod aria-label="Producto">${opciones(productos, it.product_id ?? '', { vacio: productos.length ? 'Elegir producto' : 'Sin productos registrados', valor: (p) => p.id, texto: (p) => p.nombre + (p.peso_kg ? ` (${p.peso_kg} kg)` : '') })}<option value="otro" ${it.descripcion && !it.product_id ? raw('selected') : ''}>Otro (escribir)</option></select>
      <input type="text" data-desc placeholder="Descripción" value="${it.descripcion ?? ''}" style="margin-top:4px;${it.descripcion && !it.product_id ? '' : 'display:none'}"></td>
      <td style="width:120px"><input type="number" min="0" step="any" data-cant value="${it.cantidad ?? ''}" aria-label="Cantidad"></td><td style="width:60px"><button type="button" class="btn btn-texto btn-chico" data-quitar="${i}">Quitar</button></td></tr>`;
    const m = modal({
      titulo: e ? `Editar entrega · ${e.cliente}` : 'Nueva entrega', ancho: 760,
      cuerpo: html`<form id="fe" class="apilar">
        <div class="campo"><label for="busca">Cliente</label>${cliente ? html`<div class="fila" id="cli-elegido"><b>${cliente.nombre}</b>${e ? '' : html`<button type="button" class="btn btn-texto btn-chico" id="cambiar-cli">Cambiar</button>`}</div>` : ''}
          <div id="cli-buscar" ${cliente ? raw('hidden') : ''}><input type="search" id="busca" placeholder="Escribe el nombre, la empresa o la comuna" autocomplete="off"><div id="cli-res" style="max-height:170px;overflow:auto;border:1px solid var(--linea);border-radius:6px;margin-top:4px" hidden></div></div></div>
        <div class="form-grid">${campo('fecha', 'Fecha de despacho', e?.fecha ?? '', { type: 'date' })}${campo('ventana_desde', 'Entregar desde', e?.ventana_desde ?? '', { type: 'time' })}${campo('ventana_hasta', 'Entregar hasta', e?.ventana_hasta ?? '', { type: 'time' })}
          ${campo('direccion_entrega', 'Dirección de entrega (si es distinta a la del cliente)', e?.direccion_entrega ?? '', { cls: 'ancho' })}</div>
        <div><div class="seccion-form">Productos y cantidades</div><table class="tabla-compacta"><tbody id="items">${items.map(filaItem)}</tbody></table>
          <div class="fila" style="margin-top:6px"><button type="button" class="btn btn-chico" id="add-item">Agregar producto</button>${productos.length ? '' : html`<a class="btn btn-texto btn-chico" href="#/cubicaje?tab=productos">Registrar productos</a>`}</div></div>
        ${campo('observaciones', 'Observaciones', e?.observaciones ?? '', { type: 'textarea' })}</form>`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: e ? 'Guardar cambios' : 'Registrar entrega', clase: 'btn-primario', accion: async (mm) => {
        if (!cliente) throw new Error('Elige el cliente de la entrega.');
        const lineas = [...mm.el.querySelectorAll('#items tr')].map((tr) => {
          const p = tr.querySelector('[data-prod]').value;
          return { product_id: p && p !== 'otro' ? Number(p) : null, descripcion: p === 'otro' ? tr.querySelector('[data-desc]').value.trim() : null, cantidad: tr.querySelector('[data-cant]').value };
        }).filter((l) => l.product_id || l.descripcion);
        if (!lineas.length) throw new Error('Agrega al menos un producto con su cantidad.');
        const d = mm.datos();
        const body = { client_id: cliente.id, fecha: d.fecha, ventana_desde: d.ventana_desde, ventana_hasta: d.ventana_hasta, direccion_entrega: d.direccion_entrega, observaciones: d.observaciones, items: lineas };
        e ? await put(`/entregas/${e.id}`, { ...body, version: e.version }) : await post('/entregas', body);
        mm.cerrar(); toast(e ? 'Entrega actualizada' : 'Entrega registrada'); cargarEntregas();
      } }],
    });
    const el = m.el;
    const tbody = el.querySelector('#items');
    const sincronizar = (tr) => { const otro = tr.querySelector('[data-prod]').value === 'otro'; tr.querySelector('[data-desc]').style.display = otro ? '' : 'none'; };
    tbody.addEventListener('change', (ev) => { if (ev.target.matches('[data-prod]')) sincronizar(ev.target.closest('tr')); });
    el.querySelector('#add-item').addEventListener('click', () => { tbody.insertAdjacentHTML('beforeend', filaItem({ cantidad: 1 }, tbody.children.length).s); });
    alHacer(el, 'click', '[data-quitar]', (ev, b) => { if (tbody.children.length > 1) b.closest('tr').remove(); });
    el.querySelector('#cambiar-cli')?.addEventListener('click', () => { cliente = null; el.querySelector('#cli-elegido').remove(); el.querySelector('#cli-buscar').hidden = false; el.querySelector('#busca').focus(); });
    const res = el.querySelector('#cli-res');
    const buscar = debounce(async () => {
      const q = el.querySelector('#busca').value.trim();
      if (q.length < 2) { res.hidden = true; return; }
      const lista = (await get(`/clientes${qs({ q })}`)).slice(0, 30);
      res.hidden = false;
      pintar(res, lista.length ? html`${lista.map((c) => html`<div class="item-cliente" style="grid-template-columns:minmax(0,1fr)" data-elegir="${c.id}" data-nombre="${c.nombre}" tabindex="0" role="button"><div><span class="nom">${c.nombre}</span><div class="sec">${[c.empresa, c.comuna].filter(Boolean).join(' · ')}</div></div></div>`)}` : html`<div class="vacio" style="padding:12px">Sin resultados. Registra el cliente en Clientes y zonas.</div>`);
    }, 220);
    el.querySelector('#busca')?.addEventListener('input', buscar);
    alHacer(el, 'click', '[data-elegir]', (ev, b) => {
      cliente = { id: Number(b.dataset.elegir), nombre: b.dataset.nombre };
      el.querySelector('#cli-buscar').hidden = true;
      el.querySelector('#cli-buscar').insertAdjacentHTML('beforebegin', `<div class="fila" id="cli-elegido"><b></b></div>`);
      el.querySelector('#cli-elegido b').textContent = cliente.nombre;
    });
  }

  function reprogramar(e) {
    modal({ titulo: `Reprogramar entrega · ${e.cliente}`, ancho: 480,
      cuerpo: html`<form class="apilar">${campo('fecha', 'Nueva fecha', mañana(), { type: 'date', required: true })}${campo('motivo', 'Motivo', '', { placeholder: 'Ej.: cliente cerrado, falta de stock' })}</form>`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Reprogramar', clase: 'btn-primario', accion: async (m) => { const d = m.datos(); if (!d.fecha) throw new Error('Indica la nueva fecha.'); await post(`/entregas/${e.id}/estado`, { estado: 'reprogramada', fecha: d.fecha, motivo: d.motivo, version: e.version }); m.cerrar(); toast('Entrega reprogramada'); cargarEntregas(); } }] });
  }

  // ---------- Eventos ----------
  root.querySelector('#nueva').addEventListener('click', () => formularioEntrega());
  alHacer(root, 'click', '[data-nueva]', () => formularioEntrega());
  alHacer(root, 'change', '[data-sel]', (ev, c) => { const id = Number(c.dataset.sel); c.checked ? sel.add(id) : sel.delete(id); c.closest('tr').classList.toggle('sel', c.checked); pintarBarra(); });
  alHacer(root, 'change', '[data-grupo]', (ev, c) => {
    const lista = entregas.filter((e) => (e.comuna ?? 'Sin comuna') === c.dataset.grupo && seleccionable(e));
    lista.forEach((e) => (c.checked ? sel.add(e.id) : sel.delete(e.id)));
    pintarEntregas();
  });
  root.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'f-estado') { f.estado = t.value; cargarEntregas().catch(falla); }
    if (t.id === 'f-region') { f.region = t.value; f.comuna = ''; cargarEntregas().catch(falla); }
    if (t.id === 'f-comuna') { f.comuna = t.value; cargarEntregas().catch(falla); }
    if (t.id === 'f-agrupar') { f.agrupar = t.checked; pintarEntregas(); }
  });
  alHacer(root, 'click', '[data-limpiar]', () => { sel.clear(); pintarEntregas(); });
  alHacer(root, 'click', '[data-planificar]', () => navegar(`#/rutas?tab=nueva&entregas=${[...sel].join(',')}`));
  alHacer(root, 'click', '[data-editar]', (ev, b) => formularioEntrega(entregas.find((e) => e.id === Number(b.dataset.editar))));
  alHacer(root, 'click', '[data-reprog]', (ev, b) => reprogramar(entregas.find((e) => e.id === Number(b.dataset.reprog))));
  alHacer(root, 'click', '[data-hecha]', async (ev, b) => {
    const e = entregas.find((x) => x.id === Number(b.dataset.hecha));
    if (!await confirmar({ titulo: 'Marcar como realizada', mensaje: `¿La entrega a ${e.cliente} ya se realizó? Si fue parte de un despacho, ciérralo desde Despachos para que se sume su costo.`, textoOk: 'Marcar realizada' })) return;
    await post(`/entregas/${e.id}/estado`, { estado: 'realizada', fecha: hoy(), version: e.version }).then(() => { toast('Entrega realizada'); cargarEntregas(); }).catch(falla);
  });
  alHacer(root, 'click', '[data-reabrir]', (ev, b) => post(`/entregas/${b.dataset.reabrir}/estado`, { estado: 'pendiente' }).then(() => cargarEntregas()).catch(falla));
  alHacer(root, 'click', '[data-borrar]', async (ev, b) => {
    const e = entregas.find((x) => x.id === Number(b.dataset.borrar));
    if (!await confirmar({ titulo: 'Eliminar entrega', mensaje: `Se eliminará la entrega de ${e.cliente}. Si solo quieres descartarla, puedes cancelarla en lugar de eliminarla.`, textoOk: 'Eliminar', peligro: true })) return;
    await del(`/entregas/${e.id}`).then(() => { sel.delete(e.id); toast('Entrega eliminada'); cargarEntregas(); }).catch(falla);
  });

  await cargarEntregas();
  if (params.get('nueva')) formularioEntrega(null, Number(params.get('nueva')));
}
