// Nueva ruta: elegir paradas (entregas, clientes o direcciones nuevas), comparar alternativas con Google Maps y guardar el despacho.
import { html, raw, pintar, get, post, del, clp, kmTxt, duracion, num0, num1, pct, toast, falla, opcionesComunas, vacio, pluralizar, lineaRuta, graficoBarras, mañana, fecha, modal } from '../lib.js';
import { crearMapa, marcador, pin, dibujarRuta, ajustar, COLORES_RUTA } from '../maps.js';
import { insigniaSeguridad } from '../componentes.js';

const COLOR = { A: COLORES_RUTA.A, B: COLORES_RUTA.B, C: COLORES_RUTA.C, D: COLORES_RUTA.D, MANUAL: COLORES_RUTA.MANUAL };
const CLASE = { A: 'ruta-a', B: 'ruta-b', C: 'ruta-c', D: 'ruta-d', MANUAL: 'ruta-manual' };
const ETIQ = (c) => (c === 'MANUAL' ? 'T' : c);

export async function pintarNueva(ctx, root) {
  const { params, estado, navegar, refrescarEstado } = ctx;
  const ids = (k) => (params.get(k) ?? '').split(',').map(Number).filter(Boolean);
  const S = {
    modo: ids('clientes').length && !ids('entregas').length ? 'clientes' : 'entregas', sel: new Set(), lista: [], q: '',
    fecha: mañana(), hora: '', vehs: new Set(), driver: '', preparador: '', retorna: true, extras: { peajes: '', estacionamientos: '', otros: '' },
    res: null, vehSel: null, altSel: null, verTodas: false, calculando: false,
  };
  (S.modo === 'clientes' ? ids('clientes') : ids('entregas')).forEach((i) => S.sel.add(i));
  let vehiculos = [];
  let personal = [];
  let mapa = null;
  let objetosMapa = [];

  pintar(root, html`<div class="pagina-cab"><div><h2 style="font-size:20px">Nueva ruta</h2><p>Elige las paradas, escribe direcciones nuevas si hace falta, y elige vehículo y fecha. El sistema calcula cuatro alternativas con datos reales de Google Maps, revisa la seguridad de los sectores y si la carga cabe, y recomienda la más barata: la ruta más corta no siempre es la más económica.</p></div></div>
    <div class="grid g-main" style="align-items:start"><div class="apilar">
      <div class="card"><div class="card-cab"><h2>1. Paradas</h2><div class="acciones"><div class="segmentado" role="group" aria-label="Origen de las paradas"><button type="button" data-modo="entregas" aria-pressed="${S.modo === 'entregas'}">Entregas pendientes</button><button type="button" data-modo="clientes" aria-pressed="${S.modo === 'clientes'}">Clientes y direcciones</button></div></div></div>
        <div class="card-cuerpo" style="border-bottom:1px solid var(--linea);padding:10px 16px"><input type="search" id="q" placeholder="Buscar por cliente, comuna o dirección" aria-label="Buscar paradas"></div>
        <div id="picker" style="max-height:300px;overflow:auto"><div class="cargando"><span class="spinner"></span></div></div>
        <div id="picker-pie" class="card-cuerpo" style="border-top:1px solid var(--linea);padding:10px 16px"></div>
        <details class="card-cuerpo" style="border-top:1px solid var(--linea);padding:10px 16px"><summary style="cursor:pointer;font-weight:600">Escribir una dirección nueva</summary>
          <form id="form-dir" class="form-grid" style="margin-top:10px">
            <div class="campo doble"><label for="dir-calle">Dirección (calle y número)</label><input id="dir-calle" name="direccion" required placeholder="Ej.: Av. Apoquindo 4500"></div>
            <div class="campo"><label for="dir-comuna">Comuna</label><select id="dir-comuna" name="comuna" required>${opcionesComunas(estado.meta, null)}</select></div>
            <div class="campo"><label for="dir-nombre">Nombre del cliente (opcional)</label><input id="dir-nombre" name="nombre" placeholder="Si lo dejas vacío se usa la dirección"></div>
            <div class="campo ancho"><button class="btn btn-primario" type="submit" id="dir-ok">Buscar con Google y agregar a la ruta</button><small>La dirección se guarda como cliente para poder reutilizarla.</small></div></form></details></div>
      <div class="card"><div class="card-cab"><h2>2. Condiciones del despacho</h2></div><div class="card-cuerpo"><form id="cond" class="form-grid">
        <div class="campo"><label for="fecha">Fecha</label><input type="date" id="fecha" name="fecha" value="${S.fecha}"></div>
        <div class="campo"><label for="hora">Hora de salida</label><input type="time" id="hora" name="hora"><small>Con hora se estima el tráfico</small></div>
        <div class="campo"><label for="driver">Conductor</label><select id="driver" name="driver"><option value="">Sin asignar</option></select></div>
        <div class="campo"><label for="preparador">Prepara el pedido (bodega)</label><select id="preparador" name="preparador"><option value="">Sin asignar</option></select></div>
        <div class="campo ancho"><span class="etiqueta">Vehículos a comparar</span><div class="fila" id="vehs"></div></div>
        <label class="check ancho"><input type="checkbox" id="retorna" checked> El vehículo vuelve a la base al terminar</label>
        <div class="campo"><label for="peajes">Peajes</label><div class="input-unidad antes"><span>$</span><input type="number" min="0" id="peajes" name="peajes"></div></div>
        <div class="campo"><label for="estac">Estacionamientos</label><div class="input-unidad antes"><span>$</span><input type="number" min="0" id="estac" name="estacionamientos"></div></div>
        <div class="campo"><label for="otros">Otros gastos</label><div class="input-unidad antes"><span>$</span><input type="number" min="0" id="otros" name="otros"></div></div></form></div></div>
    </div>
    <div class="card" style="position:sticky;top:80px"><div class="card-cab"><h2>Resumen</h2></div><div class="card-cuerpo apilar" id="resumen"></div></div></div>
    <div id="resultados" style="margin-top:20px"></div>`);
  const picker = root.querySelector('#picker');
  const resultados = root.querySelector('#resultados');

  // ---------- Paradas ----------
  async function cargarLista() {
    pintar(picker, html`<div class="cargando"><span class="spinner"></span></div>`);
    S.lista = S.modo === 'entregas' ? await get('/entregas?estado=pendientes&sin_ruta=1') : await get('/clientes');
    const validos = new Set(S.lista.map((x) => x.id));
    for (const i of [...S.sel]) if (!validos.has(i)) S.sel.delete(i);
    pintarPicker();
  }
  const nombreItem = (x) => (S.modo === 'entregas' ? x.cliente : x.nombre);
  const ubicado = (x) => (S.modo === 'entregas' ? (x.lat ?? x.cliente_lat) != null : x.lat != null);
  function pintarPicker() {
    const t = S.q.trim().toLowerCase();
    const orden = [...S.sel];
    const vis = S.lista.filter((x) => !t || [nombreItem(x), x.empresa, x.comuna, x.direccion ?? x.cliente_direccion].some((v) => v?.toLowerCase().includes(t)));
    pintar(picker, vis.length ? html`<table class="tabla-compacta"><tbody>${vis.slice(0, 300).map((x) => html`<tr class="clic ${S.sel.has(x.id) ? 'sel' : ''}" data-pick="${x.id}" aria-selected="${S.sel.has(x.id)}"><td style="width:40px">${S.sel.has(x.id) ? html`<span class="tag-ruta" style="--c:var(--tinta);width:24px;height:24px;font-size:15px" title="Lugar en el orden de selección">${orden.indexOf(x.id) + 1}</span>` : html`<input type="checkbox" tabindex="-1" aria-label="Elegir ${nombreItem(x)}" style="width:17px;height:17px;accent-color:var(--senal)">`}</td>
      <td><b>${nombreItem(x)}</b><div class="muted" style="font-size:13px">${[x.comuna, S.modo === 'entregas' ? x.items.map((i) => `${num0(i.cantidad)} × ${i.producto ?? i.descripcion}`).join(', ') : x.direccion].filter(Boolean).join(' · ')}</div></td>
      <td class="der">${!ubicado(x) ? html`<span class="insignia error">Sin ubicación</span>` : S.modo === 'entregas' && x.peso_kg != null ? `${num1(x.peso_kg)} kg` : ''}</td></tr>`)}</tbody></table>`
      : vacio(S.modo === 'entregas' ? 'No hay entregas pendientes sin ruta' : 'No hay clientes', S.modo === 'entregas' ? 'Registra entregas en la pestaña Entregas, cambia a “Clientes y direcciones” o escribe una dirección nueva.' : 'Registra clientes o escribe una dirección nueva más abajo.', S.modo === 'entregas' ? html`<a class="btn btn-primario" href="#/rutas?tab=entregas">Ir a entregas</a>` : html`<a class="btn btn-primario" href="#/clientes?tab=lista">Ir a clientes</a>`));
    pintarResumen();
  }
  function stopsElegidas() { const por = new Map(S.lista.map((x) => [x.id, x])); return [...S.sel].map((id) => por.get(id)).filter(Boolean); }
  function pintarResumen() {
    const el = stopsElegidas();
    const sin = el.filter((x) => !ubicado(x));
    const kg = S.modo === 'entregas' && el.length && el.every((x) => x.peso_kg != null) ? el.reduce((a, x) => a + x.peso_kg, 0) : null;
    const max = estado.meta.max_paradas;
    pintar(root.querySelector('#picker-pie'), html`<div class="fila entre"><span><b>${pluralizar(el.length, 'parada elegida', 'paradas elegidas')}</b>${kg != null ? ` · ${num1(kg)} kg` : ''}</span>${el.length ? html`<button class="btn btn-texto btn-chico" data-vaciar>Quitar todas</button>` : ''}</div>`);
    const listos = el.length > 0 && !sin.length && el.length <= max && S.vehs.size > 0;
    const comunas = [...new Set(el.map((x) => x.comuna).filter(Boolean))];
    pintar(root.querySelector('#resumen'), html`
      <div><div class="muted">Paradas</div><div class="num" style="font-family:var(--f-num);font-size:34px;font-weight:600">${el.length}</div></div>
      <div class="muted" style="font-size:13px">Salida desde <b>${estado.settings.deposito_direccion}, ${estado.settings.deposito_comuna}</b></div>
      ${comunas.length ? html`<div class="muted" style="font-size:13px">Comunas: ${comunas.join(', ')}</div>` : ''}
      ${sin.length ? html`<div class="aviso ambar" style="margin:0">Sin ubicación: ${sin.map(nombreItem).join(', ')}. Ubícalos en <a href="#/clientes?tab=lista&sinc=1">Clientes</a>.</div>` : ''}
      ${el.length > max ? html`<div class="aviso ambar" style="margin:0">Google admite hasta ${max} paradas por ruta. <button class="btn btn-chico" data-dividir>Dividir en despachos</button></div>` : ''}
      ${!S.vehs.size ? html`<div class="aviso ambar" style="margin:0">Elige al menos un vehículo.</div>` : ''}
      <button class="btn btn-primario" style="width:100%;justify-content:center" data-calcular ${listos && !S.calculando ? '' : raw('disabled')}>${S.calculando ? html`<span class="spinner"></span> Calculando…` : 'Calcular rutas A, B, C y D'}</button>`);
  }

  async function agregarDireccion(form) {
    const d = Object.fromEntries(new FormData(form));
    const boton = form.querySelector('#dir-ok');
    boton.disabled = true;
    try {
      const c = await post('/clientes', { nombre: d.nombre?.trim() || d.direccion.trim(), direccion: d.direccion.trim(), comuna: d.comuna, region: estado.meta.regiones.find((r) => r.comunas.includes(d.comuna))?.nombre, geolocalizar: true });
      if (c.aviso) toast(c.aviso, 'aviso', 8000);
      else toast(c.geo_precision === 'aproximada' ? 'Dirección agregada, pero la ubicación es aproximada: verifícala.' : 'Dirección ubicada y agregada a la ruta', c.geo_precision === 'aproximada' ? 'aviso' : 'ok');
      if (S.modo !== 'clientes') { S.modo = 'clientes'; S.sel.clear(); S.res = null; pintar(resultados, ''); root.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.modo === 'clientes'))); }
      await cargarLista();
      S.sel.add(c.id);
      form.reset();
      pintarPicker();
    } catch (e) { falla(e); } finally { boton.disabled = false; }
  }

  // ---------- Resultados ----------
  const rv = () => S.res?.vehiculos.find((v) => v.vehiculo.id === S.vehSel);
  const opcionesRuta = (v) => [{ ...v.baseline, disponible: true }, ...v.alternativas];
  const altActual = () => { const v = rv(); return v ? opcionesRuta(v).find((a) => a.codigo === S.altSel && a.disponible) : null; };
  const costoDe = (a) => (a.costos.calculable ? a.costos.total : null);
  const cubDe = (vehId) => S.res?.cubicaje?.find((c) => c.vehicle_id === vehId) ?? null;

  async function calcular() {
    const stops = stopsElegidas();
    S.calculando = true; pintarResumen();
    pintar(resultados, html`<div class="card"><div class="cargando"><span class="spinner"></span> Consultando distancias y tiempos a Google Maps y evaluando las rutas…</div></div>`);
    try {
      const body = {
        [S.modo === 'entregas' ? 'entrega_ids' : 'cliente_ids']: stops.map((x) => x.id), vehicle_ids: [...S.vehs], driver_id: S.driver || null,
        fecha: S.fecha || undefined, hora: S.hora || undefined, retorna: S.retorna, extras: S.extras,
      };
      S.res = await post('/plan', body);
      S.vehSel = S.res.mejor_vehiculo_id ?? S.res.vehiculos[0].vehiculo.id;
      S.altSel = rv().recomendada ?? 'MANUAL';
      refrescarEstado().catch(() => {});
      pintarResultados();
    } catch (e) {
      S.res = null;
      pintar(resultados, html`<div class="aviso rojo"><h3>No se pudo calcular la ruta</h3><p>${e.message}</p>${e.extra?.faltantes ? html`<ul>${e.extra.faltantes.map((x) => html`<li>${x}</li>`)}</ul>` : ''}${e.code === 'sin_clave' ? html`<a class="btn" href="#/configuracion?tab=google">Configurar Google Maps</a>` : ''}</div>`);
    } finally { S.calculando = false; pintarResumen(); }
  }

  function tarjetaAlt(a, v) {
    const seleccionada = S.altSel === a.codigo;
    const rec = v.recomendada === a.codigo;
    if (!a.disponible) return html`<div class="alt-card" style="--c:${COLOR[a.codigo]};opacity:.6;cursor:default"><div class="titulo"><span class="tag-ruta" style="--c:${COLOR[a.codigo]}">${a.codigo}</span>${a.nombre}</div><div class="muted" style="font-size:13px">${a.motivo}</div></div>`;
    const cost = costoDe(a);
    const base = costoDe(v.baseline);
    const ahorro = a.codigo !== 'MANUAL' && cost != null && base != null ? Math.max(0, base - cost) : null;
    return html`<button type="button" class="alt-card" style="--c:${COLOR[a.codigo]}" data-alt="${a.codigo}" aria-pressed="${seleccionada}">
      <div class="titulo"><span class="tag-ruta" style="--c:${COLOR[a.codigo]}">${ETIQ(a.codigo)}</span><span>${a.codigo === 'MANUAL' ? 'Tradicional' : a.nombre}</span>${rec ? html`<span class="insignia recomendada" style="margin-left:auto">Recomendada</span>` : ''}</div>
      <div class="cifra num">${cost != null ? clp(cost) : kmTxt(a.km)}</div>
      <div class="fila-d"><span>${kmTxt(a.km)}</span><span>${duracion(a.minTotal)}</span></div>
      ${a.igual_a ? html`<div class="muted" style="font-size:12.5px;margin-top:4px">Mismo recorrido que ${a.igual_a}</div>` : ''}
      ${ahorro != null && ahorro > 0 ? html`<div style="font-size:13px;margin-top:4px;color:var(--ok);font-weight:600">Ahorra ${clp(ahorro)} vs. tradicional</div>` : ''}</button>`;
  }

  /** Cuánto de la capacidad del vehículo ocupa la carga, según el cubicaje. */
  function textoCubicaje(c, { corto = false } = {}) {
    if (!c) return '';
    if (!c.calculable) return html`<div class="muted" style="font-size:13px;margin-top:4px">Cubicaje sin calcular: ${corto ? 'faltan medidas' : `falta ${c.faltan?.[0] ?? 'información'}`}.</div>`;
    return c.cabe
      ? html`<div class="muted" style="font-size:13px;margin-top:4px">Carga: ${c.ocupacion_volumen_pct != null ? `${pct(c.ocupacion_volumen_pct)} del volumen` : ''}${c.peso_pct != null ? ` · ${pct(c.peso_pct)} del peso` : ''}</div>`
      : html`<div style="color:var(--rojo);font-size:13px;margin-top:4px"><b>No cabe</b>: ${c.unidades_colocadas} de ${c.unidades_total} unidades${c.limitante ? ` (limita ${c.limitante})` : ''}.</div>`;
  }

  function tarjetaSeguridad(seg) {
    if (!seg) return '';
    if (!seg.alertas.length && !seg.sin_evaluar.length) return html`<div class="aviso verde" style="margin-bottom:16px"><p>Los sectores de esta ruta están evaluados y no tienen alertas de seguridad.</p></div>`;
    return html`<div class="aviso ${seg.nivel_max === 'alto_riesgo' ? 'rojo' : 'ambar'}" style="margin-bottom:16px"><h3>Seguridad de la ruta ${insigniaSeguridad(seg.nivel_max, estado.meta)}</h3>
      ${seg.alertas.length ? html`<ul>${seg.alertas.map((a) => html`<li><b>${a.comuna}</b> (${estado.meta.niveles_seguridad.find((n) => n.id === a.nivel)?.nombre.toLowerCase()})${a.horario_recomendado ? ` · conviene ${a.horario_recomendado}` : ''}${a.incidentes_90d ? ` · ${pluralizar(a.incidentes_90d, 'incidente', 'incidentes')} en 90 días` : ''}${a.observaciones ? ` · ${a.observaciones}` : ''}. Paradas: ${a.paradas.join(', ')}.</li>`)}</ul>` : ''}
      ${seg.sin_evaluar.length ? html`<p style="margin-top:6px">Sin evaluar: ${seg.sin_evaluar.join(', ')}. <a href="#/clientes?tab=zonas">Evaluar sectores</a></p>` : ''}</div>`;
  }

  function pintarResultados() {
    const R = S.res;
    const v = rv();
    const alts = opcionesRuta(v);
    const alt = altActual();
    const rec = v.alternativas.find((a) => a.codigo === v.recomendada);
    const base = v.baseline;
    const calc = v.calculable;
    const ahorroRec = rec && calc ? Math.max(0, base.costos.total - rec.costos.total) : null;
    const disponibles = alts.filter((a) => a.disponible);
    const dep = R.deposito;

    pintar(resultados, html`
      ${R.advertencias.map((a) => html`<div class="aviso ambar">${a}</div>`)}
      ${tarjetaSeguridad(R.seguridad)}
      ${R.vehiculos.length > 1 ? html`<div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>¿Qué vehículo conviene?</h2><span class="sub">Cada uno con su mejor ruta</span></div><div class="card-cuerpo"><div class="grid g${Math.min(R.vehiculos.length, 3)}">
        ${R.vehiculos.map((x) => { const r = x.alternativas.find((a) => a.codigo === x.recomendada); const mejor = x.vehiculo.id === R.mejor_vehiculo_id; return html`<button type="button" class="alt-card" style="--c:var(--senal)" data-veh-sel="${x.vehiculo.id}" aria-pressed="${x.vehiculo.id === S.vehSel}">
          <div class="titulo">${x.vehiculo.marca} ${x.vehiculo.modelo}${mejor ? html`<span class="insignia recomendada" style="margin-left:auto">Más económico</span>` : ''}</div>
          ${x.calculable && r ? html`<div class="cifra num">${clp(r.costos.total)}</div><div class="fila-d"><span>Ruta ${x.recomendada} · ${kmTxt(r.km)}</span><span>${duracion(r.minTotal)}</span></div>`
            : html`<div class="muted" style="font-size:13px">Sin costo: falta ${x.faltantes.join(', ').toLowerCase()}.</div>`}
          ${x.capacidad.excede ? html`<div style="color:var(--rojo);font-size:13px;margin-top:4px">La carga (${num0(x.capacidad.peso_kg)} kg) no cabe: capacidad ${num0(x.capacidad.capacidad_kg)} kg</div>` : textoCubicaje(cubDe(x.vehiculo.id), { corto: true })}</button>`; })}
        </div></div></div>` : ''}

      ${calc ? html`<div class="aviso verde" style="margin-bottom:16px;display:flex;gap:18px;align-items:center;flex-wrap:wrap">
        <div style="flex:1;min-width:260px"><h3>Recomendación: ruta ${v.recomendada}${rec?.codigo && rec.nombre ? ` (${rec.nombre.toLowerCase()})` : ''} con ${v.vehiculo.marca} ${v.vehiculo.modelo}</h3>
          <p>${rec ? `${clp(rec.costos.total)} en total: ${kmTxt(rec.km)}, ${duracion(rec.minTotal)}, ${clp(rec.costos.total / R.paradas.length)} por cliente.` : ''} ${v.nota ?? ''}</p></div>
        ${ahorroRec > 0 ? html`<div style="text-align:right"><div class="num" style="font-family:var(--f-num);font-size:34px;font-weight:600;color:var(--ok)">${clp(ahorroRec)}</div><div class="muted" style="font-size:13px">menos que el orden tradicional</div></div>` : html`<div class="muted" style="max-width:220px;font-size:13px">El orden en que elegiste las paradas ya es tan económico como la mejor alternativa.</div>`}</div>`
        : html`<div class="aviso ambar" style="margin-bottom:16px"><h3>Se compara solo por distancia y tiempo</h3><p>Para conocer el costo de cada ruta falta:</p><ul>${v.faltantes.map((x) => html`<li>${x}</li>`)}</ul><a class="btn btn-chico" href="#/vehiculos?tab=flota">Completar vehículos</a> <a class="btn btn-chico" href="#/configuracion?tab=combustible">Precio del combustible</a></div>`}

      <p class="muted" style="font-size:13px;margin:0 0 8px"><b>Tradicional</b> es visitar las paradas en el orden en que las elegiste; se usa para medir cuánto ahorra cada alternativa.</p><div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(205px,1fr))">${alts.map((a) => tarjetaAlt(a, v))}</div>

      <div class="grid g-main" style="margin-top:16px;align-items:start">
        <div class="apilar">
          <div class="card"><div class="card-cab"><h2>Comparación de alternativas</h2><span class="sub">${v.vehiculo.marca} ${v.vehiculo.modelo} · precio ${v.precio_litro != null ? `${clp(v.precio_litro)}/L` : 'sin definir'}</span></div>
            ${calc ? html`<div class="card-cuerpo"><div class="canvas-caja" style="height:${40 + disponibles.length * 34}px"><canvas id="gr-alt" role="img" aria-label="Costo total por alternativa"></canvas></div></div>` : ''}
            <div class="tabla-wrap"><table><thead><tr><th></th>${disponibles.map((a) => html`<th class="der"><span class="tag-ruta" style="--c:${COLOR[a.codigo]};width:22px;height:22px;font-size:14px">${ETIQ(a.codigo)}</span></th>`)}</tr></thead><tbody>
              ${[
                ['Distancia', (a) => kmTxt(a.km)], ['Tiempo total', (a) => duracion(a.minTotal)],
                ['Combustible', (a) => (a.costos.calculable ? clp(a.costos.combustible) : '—')], ['Desgaste', (a) => (a.costos.calculable ? clp(a.costos.desgaste) : '—')], ['Otros gastos', (a) => (a.costos.calculable ? clp(a.costos.otros) : '—')],
                ['Costo total', (a) => (a.costos.calculable ? html`<b>${clp(a.costos.total)}</b>` : '—')], ['Costo por km', (a) => (a.costos.calculable ? clp(a.costos.costoKm) : '—')], ['Costo por cliente', (a) => (a.costos.calculable ? clp(a.costos.total / R.paradas.length) : '—')],
                ['Ahorro vs. tradicional', (a) => (a.codigo === 'MANUAL' || !calc ? '—' : clp(Math.max(0, base.costos.total - a.costos.total)))],
              ].map(([t, fn]) => html`<tr><td>${t}</td>${disponibles.map((a) => html`<td class="der">${fn(a)}</td>`)}</tr>`)}</tbody></table></div></div>
          ${alt ? html`<div class="card"><div class="card-cab"><h2>Recorrido de la ruta ${ETIQ(alt.codigo)}</h2><span class="sub">${alt.codigo === 'MANUAL' ? 'En el orden en que elegiste las paradas' : alt.descripcion}</span></div><div class="card-cuerpo">
            ${lineaRuta({ clase: CLASE[alt.codigo], base: dep.direccion, paradas: alt.paradas, retorno: alt.retorno, mostrarCosto: calc })}</div></div>` : ''}
        </div>
        <div class="apilar" style="position:sticky;top:80px">
          <div class="card"><div class="card-cab"><h2>Mapa</h2><div class="acciones"><label class="check" style="font-size:13px"><input type="checkbox" id="ver-todas" ${S.verTodas ? raw('checked') : ''}> Ver todas</label></div></div><div class="mapa-caja" id="mapa-ruta" style="height:380px;border-radius:0 0 6px 6px"></div></div>
          ${alt ? panelGuardar(v, alt) : ''}</div></div>`);

    if (calc && v) {
      graficoBarras(resultados.querySelector('#gr-alt'), { etiquetas: disponibles.map((a) => (a.codigo === 'MANUAL' ? 'Tradicional' : `${a.codigo} · ${a.nombre}`)), horizontal: true, series: [{ nombre: 'Costo total', datos: disponibles.map((a) => a.costos.total), color: disponibles.map((a) => COLOR[a.codigo]) }] });
    }
    iniciarMapa();
  }

  function panelGuardar(v, alt) {
    const calc = v.calculable;
    const excede = v.capacidad.excede === true;
    const cub = cubDe(v.vehiculo.id);
    const noCabe = cub?.calculable && cub.cabe === false;
    const razon = !calc ? 'Faltan datos para calcular el costo; complétalos para guardar el despacho.' : excede ? `La carga supera la capacidad de ${v.vehiculo.marca} ${v.vehiculo.modelo}. Divide el despacho o elige otro vehículo.` : noCabe ? `Según el cubicaje, la carga no cabe en ${v.vehiculo.marca} ${v.vehiculo.modelo}. Elige otro vehículo o divide el despacho.` : null;
    return html`<div class="card"><div class="card-cab"><h2>3. Guardar despacho</h2></div><div class="card-cuerpo apilar">
      <div>Ruta <b>${ETIQ(alt.codigo)}</b> con <b>${v.vehiculo.marca} ${v.vehiculo.modelo}</b>${calc ? html`: <b>${clp(alt.costos.total)}</b>, ${kmTxt(alt.km)}` : ''}<div class="muted" style="font-size:13px">${S.fecha ? fecha(S.fecha) : 'Sin fecha'}${S.hora ? ` · sale ${S.hora}` : ''}</div>${textoCubicaje(cub)}</div>
      ${S.modo === 'clientes' ? html`<div class="aviso ambar" style="margin:0;font-size:13px">Se crearán entregas para estos clientes, sin productos. Podrás completarlas en la pestaña Entregas. Sin productos no se puede calcular el cubicaje.</div>` : ''}
      ${!S.fecha ? html`<div class="aviso ambar" style="margin:0">Indica la fecha del despacho arriba.</div>` : ''}
      ${razon ? html`<div class="aviso rojo" style="margin:0">${razon}</div>` : ''}
      <div class="campo"><label for="notas">Notas del despacho</label><textarea id="notas" rows="2"></textarea></div>
      <button class="btn btn-primario" style="justify-content:center" data-guardar ${razon || !S.fecha ? raw('disabled') : ''}>Guardar despacho</button></div></div>`;
  }

  // ---------- Mapa ----------
  async function iniciarMapa() {
    const caja = resultados.querySelector('#mapa-ruta');
    if (!caja) return;
    objetosMapa = [];
    mapa = await crearMapa(caja, { settings: estado.settings });
    dibujar();
  }
  function dibujar() {
    if (!mapa || !S.res) return;
    objetosMapa.forEach((o) => { if (o.linea) o.linea.setMap(null); else if (o.marker) o.marker.map = null; });
    objetosMapa = [];
    const v = rv();
    const alt = altActual();
    if (!v || !alt) return;
    const dep = S.res.deposito;
    const polys = new Map();
    const mejor = S.res.vehiculos.find((x) => x.vehiculo.id === S.res.mejor_vehiculo_id) ?? S.res.vehiculos[0];
    for (const a of [mejor.baseline, ...mejor.alternativas]) if (a.polyline) polys.set(a.orden?.join('-'), a.polyline);
    const trazar = (a, grosor, opacidad) => {
      const pts = [dep, ...a.paradas, ...(S.res.retorna ? [dep] : [])];
      objetosMapa.push(dibujarRuta(mapa, { polyline: polys.get(a.orden.join('-')), puntos: pts, color: COLOR[a.codigo], grosor, opacidad }));
    };
    if (S.verTodas) {
      const vistos = new Set([alt.orden.join('-')]);
      for (const a of opcionesRuta(v)) if (a.disponible && !vistos.has(a.orden.join('-'))) { vistos.add(a.orden.join('-')); trazar(a, 3, 0.55); }
    }
    trazar(alt, 6, 0.95);
    objetosMapa.push({ marker: marcador(mapa, dep, pin({ texto: 'B', clase: 'base', titulo: 'Base' }), { titulo: 'Punto de partida', z: 5 }) });
    alt.paradas.forEach((p, i) => objetosMapa.push({ marker: marcador(mapa, p, pin({ texto: String(i + 1), color: COLOR[alt.codigo], titulo: p.nombre }), { titulo: `${i + 1}. ${p.nombre}`, z: 4 }) }));
    ajustar(mapa, [dep, ...alt.paradas]);
  }

  // ---------- Guardar ----------
  async function guardar(btn) {
    const v = rv();
    const alt = altActual();
    btn.disabled = true;
    const creadas = [];
    try {
      // El orden original (el de selección) se envía tal cual: es la base de comparación del ahorro.
      const original = S.res.paradas;
      const idPorClave = {};
      for (const p of original) {
        if (S.modo === 'clientes') { const e = await post('/entregas', { client_id: p.client_id, fecha: S.fecha, items: [] }); creadas.push(e.id); idPorClave[p.key] = e.id; } else idPorClave[p.key] = p.delivery_id;
      }
      const r = await post('/despachos', {
        entrega_ids: original.map((p) => idPorClave[p.key]), orden: alt.paradas.map((p) => idPorClave[p.key]), alternativa: alt.codigo === 'MANUAL' ? 'manual' : alt.codigo,
        vehicle_id: v.vehiculo.id, driver_id: S.driver || null, preparador_id: S.preparador || null, fecha: S.fecha, hora: S.hora || null, retorna: S.retorna, extras: S.extras, notas: resultados.querySelector('#notas')?.value || null,
      });
      toast(`Despacho N° ${r.trip_id} guardado${r.ahorro > 0 ? ` · ahorro ${clp(r.ahorro)}` : ''}`);
      navegar(`#/rutas?tab=despachos&trip=${r.trip_id}`);
    } catch (e) {
      for (const id of creadas) await del(`/entregas/${id}`).catch(() => {});
      falla(e); btn.disabled = false;
    }
  }

  async function dividir() {
    try {
      const d = await post('/plan/dividir', { [S.modo === 'entregas' ? 'entrega_ids' : 'cliente_ids']: [...S.sel], vehicle_id: [...S.vehs][0] });
      const prefijo = S.modo === 'entregas' ? 'entregas' : 'clientes';
      const quitar = S.modo === 'entregas' ? 'd' : 'c';
      const nombres = Object.fromEntries(d.paradas.map((p) => [p.key, p.nombre]));
      modalDivision(d.grupos, prefijo, quitar, nombres);
    } catch (e) { falla(e); }
  }
  function modalDivision(grupos, prefijo, quitar, nombres) {
    modal({ titulo: `Dividir en ${grupos.length} despachos`, ancho: 620,
      cuerpo: html`<p class="muted">Los grupos se arman por cercanía, respetando el máximo de paradas y la capacidad del vehículo. Cada uno se optimiza por separado.</p>${grupos.map((g, i) => html`<div class="card" style="margin-bottom:10px"><div class="card-cab"><h2>Despacho ${i + 1}</h2><span class="sub">${pluralizar(g.length, 'parada', 'paradas')}</span><div class="acciones"><a class="btn btn-chico btn-primario" href="#/rutas?tab=nueva&${prefijo}=${g.map((k) => k.replace(quitar, '')).join(',')}" data-cerrar>Optimizar este grupo</a></div></div><div class="card-cuerpo muted" style="font-size:13px">${g.map((k) => nombres[k]).join(', ')}</div></div>`)}`,
      acciones: [{ texto: 'Cerrar', cerrar: true }] });
  }

  // ---------- Eventos ----------
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick],[data-modo],[data-vaciar],[data-calcular],[data-alt],[data-veh-sel],[data-guardar],[data-dividir]');
    if (!t || !root.contains(t)) return;
    if (t.dataset.pick) { const id = Number(t.dataset.pick); S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); pintarPicker(); }
    else if (t.dataset.modo) { if (S.modo !== t.dataset.modo) { S.modo = t.dataset.modo; S.sel.clear(); S.res = null; pintar(resultados, ''); root.querySelectorAll('[data-modo]').forEach((b) => b.setAttribute('aria-pressed', String(b === t))); cargarLista().catch(falla); } }
    else if ('vaciar' in t.dataset) { S.sel.clear(); pintarPicker(); }
    else if ('calcular' in t.dataset) calcular();
    else if (t.dataset.alt) { S.altSel = t.dataset.alt; pintarResultados(); }
    else if (t.dataset.vehSel) { S.vehSel = Number(t.dataset.vehSel); const v = rv(); S.altSel = v.recomendada ?? 'MANUAL'; pintarResultados(); }
    else if ('guardar' in t.dataset) guardar(t);
    else if ('dividir' in t.dataset) dividir();
  });
  root.addEventListener('submit', (e) => { if (e.target.id === 'form-dir') { e.preventDefault(); agregarDireccion(e.target); } });
  root.addEventListener('input', (e) => {
    const t = e.target;
    if (t.id === 'q') { S.q = t.value; pintarPicker(); }
    if (t.id === 'fecha') { S.fecha = t.value; }
    if (t.id === 'hora') S.hora = t.value;
    if (['peajes', 'estac', 'otros'].includes(t.id)) S.extras[t.id === 'estac' ? 'estacionamientos' : t.id] = t.value;
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'retorna') S.retorna = t.checked;
    if (t.id === 'driver') S.driver = t.value;
    if (t.id === 'preparador') S.preparador = t.value;
    if (t.dataset?.veh) { t.checked ? S.vehs.add(Number(t.dataset.veh)) : S.vehs.delete(Number(t.dataset.veh)); pintarResumen(); }
    if (t.id === 'ver-todas') { S.verTodas = t.checked; dibujar(); }
    if (t.id === 'fecha' && S.res) pintarResultados();
  });

  // ---------- Inicio ----------
  [vehiculos, personal] = await Promise.all([get('/vehiculos'), get('/personal')]);
  vehiculos = vehiculos.filter((v) => v.estado === 'activo');
  vehiculos.forEach((v) => S.vehs.add(v.id));
  pintar(root.querySelector('#vehs'), vehiculos.length ? html`${vehiculos.map((v) => html`<label class="check chip" style="padding:5px 12px"><input type="checkbox" data-veh="${v.id}" checked> ${v.marca} ${v.modelo}</label>`)}` : html`<span class="muted">No hay vehículos activos. <a href="#/vehiculos?tab=flota">Agregar vehículo</a></span>`);
  const opts = (rol) => personal.filter((p) => (p.rol ?? 'conductor') === rol).map((c) => html`<option value="${c.id}">${c.nombre}</option>`);
  root.querySelector('#driver').insertAdjacentHTML('beforeend', html`${opts('conductor')}`.toString());
  root.querySelector('#preparador').insertAdjacentHTML('beforeend', html`${opts('preparador')}`.toString());
  await cargarLista();
  if (S.sel.size && S.vehs.size) pintar(resultados, html`<div class="aviso verde">Ya elegiste ${pluralizar(S.sel.size, 'parada', 'paradas')}. Revisa la fecha y los vehículos y presiona <b>Calcular rutas</b>.</div>`);
}
