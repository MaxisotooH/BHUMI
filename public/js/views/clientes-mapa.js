// Geolocalización de clientes: mapa con la concentración de entregas, la seguridad de cada sector y la tabla por comuna o zona.
import { html, pintar, get, clp, kmTxt, num0, pct, vacio, alHacer, pluralizar, qs } from '../lib.js';
import { crearMapa, marcador, pin, ajustar } from '../maps.js';
import { barraPeriodo, activarPeriodo, periodoDe, insigniaSeguridad, COLOR_SEGURIDAD, botonesExportar, activarExportar, barra } from '../componentes.js';

export async function pintarMapa(ctx, cont) {
  const { params, estado, navegar } = ctx;
  const meta = estado.meta;
  const hayPeriodo = !!(params.get('mes') || params.get('desde') || params.get('hasta'));
  const per = periodoDe(params);
  const por = params.get('por') === 'zona' ? 'zona' : 'comuna';
  const incluir = params.get('incluir') === 'todos' ? 'todos' : 'realizados';
  const consulta = { ...(hayPeriodo ? per.query : {}), por, incluir };
  const [mapaDatos, conc] = await Promise.all([get(`/zonas/mapa${qs({ ...(hayPeriodo ? per.query : {}), incluir })}`), get(`/zonas/concentracion${qs(consulta)}`)]);
  const clientes = mapaDatos.clientes;
  const totalEnt = conc.grupos.reduce((a, g) => a + g.entregas, 0);
  const maxEnt = Math.max(1, ...conc.grupos.map((g) => g.entregas));
  const base = `tab=mapa&por=${por}&incluir=${incluir}`;

  pintar(cont, html`
    <div class="card" style="margin-bottom:16px"><div class="card-cuerpo fila" style="flex-wrap:wrap;gap:14px">
      ${hayPeriodo ? html`${barraPeriodo(per)}<button class="btn btn-chico" data-todo>Ver todo el historial</button>` : html`<span><b>Todo el historial</b> de entregas</span><button class="btn btn-chico" data-elegir>Elegir un período</button>`}
      <span class="espacio"></span>
      <div class="segmentado" role="group" aria-label="Agrupar por"><button type="button" data-por="comuna" aria-pressed="${por === 'comuna'}">Por comuna</button><button type="button" data-por="zona" aria-pressed="${por === 'zona'}">Por zona</button></div>
      <div class="segmentado" role="group" aria-label="Qué entregas contar"><button type="button" data-incluir="realizados" aria-pressed="${incluir === 'realizados'}">Realizadas</button><button type="button" data-incluir="todos" aria-pressed="${incluir === 'todos'}">Todas</button></div>
      ${botonesExportar('/api/reportes/zonas', hayPeriodo ? per.query : {})}</div></div>

    <div class="grid g-main" style="margin-bottom:16px;align-items:start">
      <div class="card"><div class="card-cab"><h2>Mapa de clientes</h2><span class="sub">El número es la cantidad de entregas; el color, la seguridad del sector</span></div>
        <div class="card-cuerpo"><div class="mapa-caja" id="mapa" style="height:480px"></div>
          <div class="fila" style="margin-top:10px;gap:14px">${meta.niveles_seguridad.map((n) => html`<span class="fila" style="gap:6px;font-size:13px"><i style="width:12px;height:12px;border-radius:50%;background:${COLOR_SEGURIDAD[n.id]};display:inline-block"></i>${n.nombre}</span>`)}</div>
          <div id="detalle-pin" class="muted" style="margin-top:10px;min-height:22px">Toca un cliente en el mapa para ver su detalle.</div>
          ${mapaDatos.sin_ubicacion ? html`<div class="aviso ambar" style="margin:12px 0 0"><p>${pluralizar(mapaDatos.sin_ubicacion, 'cliente no aparece', 'clientes no aparecen')} en el mapa porque no ${mapaDatos.sin_ubicacion === 1 ? 'tiene' : 'tienen'} ubicación. <a href="#/clientes?tab=lista&sinc=1">Ubicarlos</a></p></div>` : ''}</div></div>

      <div class="card"><div class="card-cab"><h2>Dónde se concentra</h2><span class="sub">${conc.periodo.etiqueta === 'Todo el historial' ? 'Todo el historial' : conc.periodo.etiqueta}</span></div>
        <div class="card-cuerpo apilar">${conc.grupos.length && totalEnt ? conc.grupos.slice(0, 8).map((g) => html`<div><div class="fila entre" style="margin-bottom:3px"><span><b>${g.clave}</b> ${insigniaSeguridad(g.seguridad, meta)}</span><b class="num">${num0(g.entregas)} <small class="muted" style="font-weight:400">${pct(g.pct_entregas, 0)}</small></b></div>${barra(g.entregas, maxEnt, { color: COLOR_SEGURIDAD[g.seguridad] === COLOR_SEGURIDAD.sin_evaluar ? 'var(--serie-1)' : COLOR_SEGURIDAD[g.seguridad], alto: 8 })}</div>`)
          : html`<p class="muted" style="margin:0">Todavía no hay entregas ${incluir === 'realizados' ? 'realizadas' : ''} en este período.</p>`}</div></div>
    </div>

    <div class="card"><div class="card-cab"><h2>Concentración de entregas por ${por === 'zona' ? 'zona' : 'comuna'}</h2><span class="sub">${pluralizar(conc.grupos.length, por === 'zona' ? 'zona' : 'comuna', por === 'zona' ? 'zonas' : 'comunas')} con clientes</span></div>
      ${conc.grupos.length ? html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>${por === 'zona' ? 'Zona' : 'Comuna'}</th><th>Seguridad</th><th class="der">Clientes</th><th class="der">Entregas</th><th class="der">% del total</th><th class="der">No entregadas</th><th class="der">Pendientes</th><th class="der">Km recorridos</th><th class="der">Costo por entrega</th><th class="der">Incidentes (90 días)</th></tr></thead><tbody>
        ${conc.grupos.map((g) => html`<tr><td><b>${g.clave}</b>${por === 'zona' && g.comunas?.length ? html`<span class="sub-cel">${g.comunas.join(', ')}</span>` : ''}</td><td>${insigniaSeguridad(g.seguridad, meta)}</td>
          <td class="der">${num0(g.clientes)}</td><td class="der"><b>${num0(g.entregas)}</b></td><td class="der">${g.pct_entregas != null ? pct(g.pct_entregas, 1) : '—'}</td><td class="der">${g.no_entregadas ? num0(g.no_entregadas) : '0'}</td><td class="der">${g.pendientes ? num0(g.pendientes) : '0'}</td>
          <td class="der">${g.km ? kmTxt(g.km) : '—'}</td><td class="der">${g.costo_por_entrega != null ? clp(g.costo_por_entrega) : html`<span class="tenue">Sin dato</span>`}</td><td class="der">${g.incidentes_90d ? html`<b>${g.incidentes_90d}</b>` : '0'}</td></tr>`)}</tbody></table></div>
        ${por === 'zona' && conc.grupos.some((g) => g.clave === 'Sin zona') ? html`<div class="card-cuerpo muted" style="font-size:13px;border-top:1px solid var(--linea)">“Sin zona” agrupa las comunas que aún no tienen zona asignada. Asígnalas en <a href="#/clientes?tab=zonas">Zonas y seguridad</a>.</div>` : ''}`
        : vacio('Sin clientes para mostrar', 'Agrega clientes con su dirección para ver cómo se concentran las entregas.', html`<a class="btn btn-primario" href="#/clientes?tab=lista">Ir a clientes</a>`)}</div>`);

  const ir = (extra) => navegar(`#/clientes?${new URLSearchParams({ tab: 'mapa', por, incluir, ...(hayPeriodo ? per.query : {}), ...extra }).toString()}`);
  alHacer(cont, 'click', '[data-por]', (e, b) => ir({ por: b.dataset.por }));
  alHacer(cont, 'click', '[data-incluir]', (e, b) => ir({ incluir: b.dataset.incluir }));
  alHacer(cont, 'click', '[data-elegir]', () => navegar(`#/clientes?${base}&mes=${new Date().toISOString().slice(0, 7)}`));
  alHacer(cont, 'click', '[data-todo]', () => navegar(`#/clientes?${base}`));
  activarPeriodo(cont, 'clientes', params, navegar, ['tab', 'por', 'incluir']);
  activarExportar(cont);

  // ---------- Mapa ----------
  const caja = cont.querySelector('#mapa');
  const mapa = await crearMapa(caja, { settings: estado.settings, centro: mapaDatos.deposito ?? undefined });
  if (!mapa) return;
  const detalle = cont.querySelector('#detalle-pin');
  const puntos = [];
  for (const c of clientes) {
    const color = COLOR_SEGURIDAD[c.seguridad] ?? COLOR_SEGURIDAD.sin_evaluar;
    const el = pin({
      texto: c.entregas ? String(c.entregas) : '', clase: c.entregas ? '' : 'peq', color, titulo: `${c.nombre} · ${c.comuna ?? ''}`,
      onClick: () => {
        pintar(detalle, html`<b>${c.nombre}</b>${c.empresa ? ` · ${c.empresa}` : ''} — ${[c.direccion, c.comuna].filter(Boolean).join(', ')}. ${pluralizar(c.entregas, 'entrega', 'entregas')}${c.pendientes ? `, ${c.pendientes} pendiente${c.pendientes === 1 ? '' : 's'}` : ''}. ${insigniaSeguridad(c.seguridad, meta)}${c.zona ? ` · zona ${c.zona}` : ''} <a href="#/clientes?tab=lista&ficha=${c.id}">Ver ficha</a>`);
      },
    });
    marcador(mapa, c, el, { titulo: c.nombre });
    puntos.push(c);
  }
  if (mapaDatos.deposito) {
    marcador(mapa, mapaDatos.deposito, pin({ texto: 'B', clase: 'base', titulo: 'Base' }), { titulo: 'Base', z: 5 });
    puntos.push(mapaDatos.deposito);
  }
  ajustar(mapa, puntos);
}
