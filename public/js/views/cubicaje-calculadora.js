// Calculadora de carga: ¿cabe esta carga en cada vehículo? Muestra el acomodo desde arriba y de lado.
import { html, raw, esc, pintar, get, post, num0, num1, pct, falla, opciones, vacio, alHacer, debounce, pluralizar } from '../lib.js';
import { kpi, faltaDato } from '../componentes.js';

const COLORES = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#b8860b', '#6b7771', '#c23b22', '#0f7a8a'];

export async function pintarCalculadora(ctx, cont) {
  const { params } = ctx;
  const [productos, vehiculos, entregas] = await Promise.all([get('/productos'), get('/vehiculos'), get('/entregas?estado=pendientes')]);
  const activos = vehiculos.filter((v) => v.activo && v.estado === 'activo');
  if (!productos.length) { pintar(cont, html`<div class="card">${vacio('Primero agrega productos', 'Para saber si una carga cabe, el sistema necesita las medidas y el peso de cada producto.', html`<a class="btn btn-primario" href="#/cubicaje?tab=productos">Agregar productos</a>`)}</div>`); return; }
  if (!activos.length) { pintar(cont, html`<div class="card">${vacio('No hay vehículos activos', 'Agrega un vehículo con las medidas de su espacio de carga.', html`<a class="btn btn-primario" href="#/vehiculos">Ir a vehículos</a>`)}</div>`); return; }

  const idsUrl = (params.get('entregas') ?? '').split(',').map(Number).filter(Boolean);
  const S = {
    modo: idsUrl.length ? 'entregas' : 'manual',
    lineas: [{ product_id: '', cantidad: '' }],
    sel: new Set(idsUrl),
    vehiculo: Number(params.get('vehiculo')) || null,
    comparacion: null,
  };

  pintar(cont, html`<div class="grid g-calc" style="align-items:start">
    <div class="card"><div class="card-cab"><h2>Qué se va a cargar</h2><div class="acciones"><div class="segmentado" role="group" aria-label="Origen de la carga"><button type="button" data-modo="manual">Elegir productos</button><button type="button" data-modo="entregas">Entregas pendientes</button></div></div></div>
      <div class="card-cuerpo" id="entrada"></div></div>
    <div id="resultado"></div></div>`);
  const entrada = cont.querySelector('#entrada');
  const resultado = cont.querySelector('#resultado');

  // ---------- Entrada ----------
  function pintarEntrada() {
    cont.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === S.modo)));
    if (S.modo === 'manual') {
      pintar(entrada, html`<table class="tabla-compacta"><thead><tr><th>Producto</th><th class="der" style="width:130px">Unidades</th><th style="width:40px"></th></tr></thead><tbody>
        ${S.lineas.map((l, i) => html`<tr><td><select data-linea="${i}" data-campo="product_id" aria-label="Producto">${opciones(productos, l.product_id, { vacio: 'Elegir producto', valor: (p) => p.id, texto: (p) => p.nombre })}</select></td>
          <td><input type="number" min="1" step="1" data-linea="${i}" data-campo="cantidad" value="${l.cantidad}" aria-label="Unidades" class="der"></td>
          <td>${S.lineas.length > 1 ? html`<button class="btn btn-texto btn-chico" data-quitar="${i}" aria-label="Quitar línea">×</button>` : ''}</td></tr>`)}</tbody></table>
        <button class="btn btn-chico" id="mas" style="margin-top:10px">Agregar otro producto</button>`);
    } else {
      pintar(entrada, entregas.length ? html`<p class="muted" style="margin-top:0;font-size:13px">Marca las entregas que irían juntas. Se usan los productos y cantidades de cada una.</p>
        <div class="tabla-wrap" style="max-height:340px;overflow:auto"><table class="tabla-compacta"><tbody>${entregas.map((e) => html`<tr><td style="width:32px"><input type="checkbox" data-ent="${e.id}" ${S.sel.has(e.id) ? raw('checked') : ''} aria-label="Elegir entrega de ${e.cliente}"></td>
          <td><b>${e.cliente}</b><div class="muted" style="font-size:13px">${[e.comuna, e.items.length ? e.items.map((i) => `${num0(i.cantidad)} × ${i.producto ?? i.descripcion}`).join(', ') : 'Sin productos'].filter(Boolean).join(' · ')}</div></td></tr>`)}</tbody></table></div>`
        : vacio('No hay entregas pendientes', 'Registra entregas con sus productos o usa “Elegir productos”.', html`<a class="btn btn-primario" href="#/rutas?tab=entregas">Ir a entregas</a>`));
    }
  }

  const carga = () => (S.modo === 'entregas'
    ? (S.sel.size ? { entrega_ids: [...S.sel] } : null)
    : (() => { const items = S.lineas.filter((l) => l.product_id && Number(l.cantidad) > 0).map((l) => ({ product_id: Number(l.product_id), cantidad: Number(l.cantidad) })); return items.length ? { items } : null; })());

  // ---------- Resultado ----------
  async function calcular() {
    const c = carga();
    if (!c) { pintar(resultado, html`<div class="card"><div class="card-cuerpo muted">${S.modo === 'entregas' ? 'Marca una o más entregas para ver en qué vehículos caben.' : 'Elige un producto y las unidades para ver en qué vehículos cabe.'}</div></div>`); return; }
    try {
      const comp = await post('/cubicaje/comparar', c);
      S.comparacion = comp;
      const calculables = comp.filter((x) => x.calculable);
      if (!calculables.some((x) => x.vehicle_id === S.vehiculo)) S.vehiculo = (calculables.find((x) => x.cabe) ?? calculables[0])?.vehicle_id ?? null;
      const detalle = S.vehiculo ? await post('/cubicaje/calcular', { ...c, vehicle_id: S.vehiculo }) : null;
      pintarResultado(comp, detalle);
    } catch (e) { pintar(resultado, html`<div class="aviso rojo">${e.message}</div>`); }
  }

  function pintarResultado(comp, d) {
    const faltanProd = [...new Map(comp.flatMap((x) => x.faltan?.productos ?? []).map((p) => [p.id, p])).values()];
    const faltanVeh = comp.filter((x) => !x.calculable && (x.faltan?.vehiculo ?? []).length);
    pintar(resultado, html`<div class="apilar">
      ${faltanProd.length ? faltaDato('Hay productos sin medidas', faltanProd.map((p) => `${p.nombre}: falta ${p.faltan.join(', ')}`), html`<a class="btn btn-chico" href="#/cubicaje?tab=productos">Completar productos</a>`) : ''}
      ${faltanVeh.length ? faltaDato('Hay vehículos sin medidas de carga', faltanVeh.map((x) => `${x.nombre}: falta ${x.faltan.vehiculo.join(', ')}`), html`<a class="btn btn-chico" href="#/vehiculos">Completar vehículos</a>`) : ''}
      <div class="card"><div class="card-cab"><h2>¿Cabe en cada vehículo?</h2></div><div class="tabla-wrap"><table><thead><tr><th>Vehículo</th><th>Resultado</th><th class="der">Espacio usado</th><th class="der">Peso</th><th class="der">Unidades</th></tr></thead><tbody>
        ${comp.map((x) => html`<tr data-veh="${x.vehicle_id}" style="${x.calculable ? 'cursor:pointer' : ''}${x.vehicle_id === S.vehiculo ? ';background:var(--papel)' : ''}">
          <td><b>${x.nombre}</b>${x.vehicle_id === S.vehiculo ? html` <span class="tenue">· en el dibujo</span>` : ''}</td>
          ${x.calculable ? html`<td>${x.cabe ? html`<span class="insignia ok">Cabe</span>` : html`<span class="insignia error">No cabe${x.limitante === 'peso' ? ' por peso' : ' por espacio'}</span>`}</td>
            <td class="der">${pct(x.ocupacion_volumen_pct)}</td><td class="der">${x.peso_pct != null ? pct(x.peso_pct) : html`<span class="tenue">Sin dato</span>`}</td><td class="der">${num0(x.unidades_colocadas)} de ${num0(x.unidades_total)}</td>`
          : html`<td colspan="4"><span class="insignia aviso">No se puede calcular</span></td>`}</tr>`)}</tbody></table></div></div>
      ${d ? detalleCarga(d) : ''}</div>`);
  }

  function detalleCarga(d) {
    const color = new Map(d.por_producto.map((p, i) => [p.id, COLORES[i % COLORES.length]]));
    const sinColocar = d.unidades_total - d.unidades_colocadas;
    return html`<div class="card"><div class="card-cab"><h2>Acomodo en ${d.vehiculo.nombre}</h2><span class="insignia ${d.cabe ? 'ok' : 'error'}">${d.cabe ? 'La carga cabe' : 'La carga no cabe'}</span></div>
      <dl class="kpis" style="border:0;border-radius:0">${kpi('Espacio ocupado', num0(d.ocupacion_volumen_pct), { unidad: '%', detalle: `${num1(d.volumen_ocupado_m3)} de ${num1(d.volumen_vehiculo_m3)} m³` })}${kpi('Peso de la carga', d.peso_pct != null ? num0(d.peso_pct) : null, { unidad: '%', vacio: 'Sin capacidad', detalle: `${num1(d.peso_kg)} kg${d.capacidad_kg ? ` de ${num0(d.capacidad_kg)} kg` : ''}`, tono: d.peso_pct > 100 ? 'bajo-meta' : '' })}</dl>
      <div class="card-cuerpo">
        ${sinColocar > 0 ? html`<div class="aviso rojo" style="margin:0 0 12px">No entran ${pluralizar(sinColocar, 'unidad', 'unidades')} en un solo viaje con este vehículo. Divide la carga en dos despachos o elige otro vehículo.</div>` : ''}
        ${d.limitante === 'peso' ? html`<div class="aviso rojo" style="margin:0 0 12px">Cabe por espacio, pero el peso supera la capacidad del vehículo.</div>` : ''}
        <div class="leyenda">${d.por_producto.map((p) => html`<span><i style="background:${color.get(p.id)}"></i>${p.nombre}</span>`)}</div>
        <div class="grid g2" style="gap:12px">${dibujo('Desde arriba', d, color, 'x', 'y')}${dibujo('De lado', d, color, 'x', 'z')}</div>
        <p class="muted" style="font-size:12.5px;margin:8px 0 12px">Largo ${num0(d.vehiculo_dim_cm.largo)} cm · ancho ${num0(d.vehiculo_dim_cm.ancho)} cm · alto ${num0(d.vehiculo_dim_cm.alto)} cm. La parte delantera del vehículo está a la izquierda.</p>
        <table class="tabla-compacta"><thead><tr><th>Producto</th><th class="der">Pedidas</th><th class="der">Caben</th><th class="der">Espacio</th><th class="der">Peso</th></tr></thead><tbody>
          ${d.por_producto.map((p) => html`<tr><td><i style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${color.get(p.id)};margin-right:6px"></i>${p.nombre}</td><td class="der">${num0(p.cantidad)}</td><td class="der">${p.faltan > 0 ? html`<b style="color:var(--rojo)">${num0(p.colocadas)}</b>` : num0(p.colocadas)}</td><td class="der">${num1(p.volumen_m3)} m³</td><td class="der">${p.peso_kg != null ? `${num1(p.peso_kg)} kg` : html`<span class="tenue">Sin peso</span>`}</td></tr>`)}</tbody></table>
        ${d.advertencias.length ? html`<div class="muted" style="font-size:13px;margin-top:10px">${d.advertencias.map((a) => html`<div>${a}</div>`)}</div>` : ''}</div></div>`;
  }

  // ---------- Eventos ----------
  const recalcular = debounce(() => calcular().catch(falla), 250);
  alHacer(cont, 'click', '[data-modo]', (e, b) => { S.modo = b.dataset.modo; pintarEntrada(); calcular().catch(falla); });
  alHacer(cont, 'click', '#mas', () => { S.lineas.push({ product_id: '', cantidad: '' }); pintarEntrada(); });
  alHacer(cont, 'click', '[data-quitar]', (e, b) => { S.lineas.splice(Number(b.dataset.quitar), 1); pintarEntrada(); calcular().catch(falla); });
  entrada.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.linea != null) { S.lineas[Number(t.dataset.linea)][t.dataset.campo] = t.value; recalcular(); }
  });
  entrada.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.ent) { const id = Number(t.dataset.ent); t.checked ? S.sel.add(id) : S.sel.delete(id); calcular().catch(falla); }
  });
  alHacer(resultado, 'click', '[data-veh]', (e, f) => {
    const x = S.comparacion?.find((c) => c.vehicle_id === Number(f.dataset.veh));
    if (!x?.calculable) return;
    S.vehiculo = x.vehicle_id; calcular().catch(falla);
  });

  pintarEntrada();
  await calcular();
}

/** Dibujo del acomodo en un plano: ejes 'x' (largo) con 'y' (ancho, vista desde arriba) o 'z' (alto, vista de lado). */
function dibujo(titulo, d, color, ejeH, ejeV) {
  const dim = { x: d.vehiculo_dim_cm.largo, y: d.vehiculo_dim_cm.ancho, z: d.vehiculo_dim_cm.alto };
  const tam = { x: 'bl', y: 'ba', z: 'bh' };
  const W = 340;
  const esc_ = W / dim[ejeH];
  const H = Math.max(40, dim[ejeV] * esc_);
  // Para verlo "de lado", lo que está más cerca (y menor) se dibuja encima; desde arriba, lo más alto.
  const orden = [...d.bloques].sort((a, b) => (ejeV === 'z' ? b.y - a.y : a.z - b.z));
  const rects = orden.map((b) => {
    const x = b[ejeH] * esc_;
    const w = b[tam[ejeH]] * esc_;
    const h = b[tam[ejeV]] * esc_;
    const y = ejeV === 'z' ? H - b.z * esc_ - h : b[ejeV] * esc_;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${color.get(b.id)}" fill-opacity=".78" stroke="#fff" stroke-width="1.5"><title>${esc(b.nombre)}: ${num0(b.unidades)} un.</title></rect>`
      + (w > 26 && h > 16 ? `<text x="${(x + w / 2).toFixed(1)}" y="${(y + h / 2 + 4).toFixed(1)}" text-anchor="middle" font-size="11" fill="#fff" font-weight="600">${num0(b.unidades)}</text>` : '');
  }).join('');
  return html`<figure style="margin:0"><figcaption class="muted" style="font-size:12.5px;margin-bottom:4px">${titulo}</figcaption>
    <svg viewBox="0 0 ${W} ${H.toFixed(1)}" width="100%" role="img" aria-label="${titulo}: acomodo de la carga" style="background:var(--papel);border:1px solid var(--linea-fuerte);border-radius:6px;display:block">${raw(rects)}</svg></figure>`;
}
