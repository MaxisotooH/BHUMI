// Indicadores KPI de trabajadores: preparación de pedidos, carga, despacho y cumplimiento de entregas.
import { html, raw, pintar, get, duracion, num0, num1, pct, fecha, difMin, claseDif, graficoBarras, destruirGraficos, vacio, pluralizar, opciones, alHacer } from '../lib.js';
import { kpi, pestanas, activarPestanas, barraPeriodo, activarPeriodo, periodoDe, botonesExportar, activarExportar, barra } from '../componentes.js';

const dur = (m) => (m == null ? '—' : duracion(m));
const sinDato = html`<span class="tenue">—</span>`;
const conDif = (d) => (d == null ? '' : html` <span class="${claseDif(d)}">(${difMin(d)})</span>`);
const celda = (principal, sub) => html`<td class="der">${principal}${sub ? html`<span class="sub-cel">${sub}</span>` : ''}</td>`;
const ratioTxt = (r) => (r == null ? '' : Math.abs(r - 100) < 0.5 ? html` (igual)` : html` <span class="${r > 100 ? 'dif-mas' : 'dif-menos'}">(${r > 100 ? '+' : '−'}${num0(Math.abs(r - 100))}%)</span>`);
/** Un tiempo es "malo" cuando supera el objetivo. */
const tonoTiempo = (dif) => (dif != null && dif > 0.5 ? 'bajo-meta' : '');
const tonoCumpl = (c) => (c.pct != null && c.objetivo_pct != null && c.pct < c.objetivo_pct ? 'bajo-meta' : '');

const TABS = [['conductores', 'Conductores'], ['bodega', 'Bodega: preparación y carga'], ['entregas', 'Cumplimiento de entregas'], ['despachos', 'Detalle por despacho']];

export default async function (ctx) {
  const { root, params, navegar } = ctx;
  const per = periodoDe(params);
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'conductores';
  const driverId = params.get('driver_id') ?? '';
  const consulta = { ...per.query, ...(driverId ? { driver_id: driverId } : {}) };
  const q = new URLSearchParams(consulta).toString();
  const [k, personal] = await Promise.all([get(`/kpi/personal?${q}`), get('/personal')]);
  const t = k.total;
  const conductores = personal.filter((p) => p.activo !== 0 && (p.rol ?? 'conductor') === 'conductor');
  const extra = [`${per.modo === 'mes' ? `mes=${per.mes}` : `desde=${per.desde}&hasta=${per.hasta}`}`, driverId ? `driver_id=${driverId}` : ''].filter(Boolean).join('&');

  destruirGraficos();
  pintar(root, html`
    <div class="pagina-cab"><div><h2 style="font-size:20px">Indicadores KPI de trabajadores</h2>
      <p>Mide cuánto tarda la bodega en preparar y cargar, cómo recorre su ruta cada conductor y cuántas entregas se cumplen. Todo sale de las horas y resultados que se anotan en cada despacho; lo que no se registró no se estima.</p></div>
      <div class="acciones">${botonesExportar('/api/reportes/kpi', consulta)}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-cuerpo fila" style="flex-wrap:wrap;gap:14px">${barraPeriodo(per)}
      <select id="f-conductor" style="max-width:230px" aria-label="Conductor">${opciones(conductores, driverId, { vacio: 'Todos los conductores', valor: (c) => c.id, texto: (c) => c.nombre })}</select></div></div>
    ${!t.despachos_total ? html`<div class="card">${vacio('No hay despachos en este período', 'Los indicadores se calculan con los despachos guardados. Cambia el período o planifica un despacho.', html`<a class="btn btn-primario" href="#/rutas">Planificar una ruta</a>`)}</div>` : contenido(k, tab, extra)}`);

  if (t.despachos_total) activarContenido(root, k);
  activarPestanas(root, navegar);
  activarPeriodo(root, 'kpi', params, navegar, ['tab', 'driver_id']);
  activarExportar(root);
  root.addEventListener('change', (e) => {
    if (e.target.id !== 'f-conductor') return;
    const p = new URLSearchParams(params);
    if (e.target.value) p.set('driver_id', e.target.value); else p.delete('driver_id');
    navegar(`#/kpi?${p.toString()}`);
  });
  alHacer(root, 'click', '[data-trip]', (e, tr) => { if (!e.target.closest('a,button')) navegar(`#/rutas?tab=despachos&trip=${tr.dataset.trip}`); });
}

function contenido(k, tab, extra) {
  const t = k.total;
  const obj = k.objetivos;
  const c = t.cumplimiento;
  const sinReg = k.sin_registro_total
    ? html`<div class="aviso ambar" style="margin-bottom:16px"><h3>${pluralizar(k.sin_registro_total, 'despacho sin horas registradas', 'despachos sin horas registradas')}</h3>
        <p>${k.sin_registro_total === 1 ? 'Ya salió o se completó' : 'Ya salieron o se completaron'}, pero no ${k.sin_registro_total === 1 ? 'tiene' : 'tienen'} horas anotadas, así que no ${k.sin_registro_total === 1 ? 'entra' : 'entran'} en los promedios. Ábrelo y completa los tiempos:</p>
        <p>${k.sin_registro.slice(0, 8).map((s) => html`<a class="btn btn-chico" style="margin:0 6px 6px 0" href="#/rutas?tab=despachos&trip=${s.trip_id}">N° ${s.trip_id} · ${fecha(s.fecha)}${s.conductor ? ` · ${s.conductor}` : ''}</a>`)}</p></div>` : '';
  const sinObjetivos = obj.preparacion_min == null || obj.carga_min == null || obj.cumplimiento_pct == null
    ? html`<div class="aviso" style="margin-bottom:16px"><p>Para saber si cada indicador está dentro de lo esperado, define los objetivos en <a href="#/configuracion?tab=metas">Configuración → Objetivos y metas</a>.</p></div>` : '';

  return html`${sinReg}${sinObjetivos}
    <dl class="kpis" style="margin-bottom:16px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">
      ${kpi('Preparación de pedidos', t.preparacion.n ? dur(t.preparacion.prom_min) : null, { tono: tonoTiempo(t.preparacion.dif_prom_min), detalle: obj.preparacion_min != null ? html`Objetivo ${dur(obj.preparacion_min)}${conDif(t.preparacion.dif_prom_min)} · ${pluralizar(t.preparacion.n, 'medición', 'mediciones')}` : t.preparacion.n ? pluralizar(t.preparacion.n, 'medición', 'mediciones') : 'Anota inicio y fin de la preparación', vacio: 'Sin registrar' })}
      ${kpi('Carga del vehículo', t.carga.n ? dur(t.carga.prom_min) : null, { tono: tonoTiempo(t.carga.dif_prom_min), detalle: obj.carga_min != null ? html`Objetivo ${dur(obj.carga_min)}${conDif(t.carga.dif_prom_min)} · ${pluralizar(t.carga.n, 'carga', 'cargas')}` : t.carga.n ? pluralizar(t.carga.n, 'carga', 'cargas') : 'Anota inicio y fin de la carga', vacio: 'Sin registrar' })}
      ${kpi('Despacho: ruta completa', t.ruta.n ? dur(t.ruta.prom_min) : null, { detalle: t.ruta.estimado_prom_min != null ? html`Estimada ${dur(t.ruta.estimado_prom_min)}${conDif(t.ruta.dif_prom_min)} · ${num1(t.productividad.paradas_por_hora)} paradas/h` : t.ruta.n ? 'Sin tiempo estimado para comparar' : 'Anota salida y regreso', vacio: 'Sin registrar' })}
      ${kpi('Cumplimiento de entregas', c.pct != null ? pct(c.pct, 1) : null, { tono: tonoCumpl(c), detalle: c.pct != null ? html`${num0(c.entregadas)} de ${num0(c.programadas)} entregadas${c.objetivo_pct != null ? html` · objetivo ${pct(c.objetivo_pct)}` : ''}` : 'Marca cada parada como entregada o no entregada', vacio: 'Sin registrar' })}
    </dl>
    <div class="card" style="margin-bottom:16px"><div class="card-cab" style="padding-bottom:0;border-bottom:none">${pestanas('kpi', TABS, tab, extra)}</div></div>
    ${tab === 'conductores' ? vistaConductores(k) : tab === 'bodega' ? vistaBodega(k) : tab === 'entregas' ? vistaEntregas(k) : vistaDespachos(k)}`;
}

function vistaConductores(k) {
  const t = k.total;
  const fila = (nombre, c, total) => html`<tr${total ? raw(' style="font-weight:600;background:#F8FAF9"') : ''}><td><b>${nombre}</b></td>
    ${celda(num0(c.despachos), `de ${num0(c.despachos_total)}`)}
    ${c.transito.n ? celda(dur(c.transito.prom_min), html`est. ${dur(c.transito.estimado_prom_min)}${ratioTxt(c.transito.ratio_pct)}`) : celda(sinDato, '')}
    ${c.entrega.n ? celda(dur(c.entrega.prom_min), c.entrega.estandar_prom_min != null ? html`prev. ${dur(c.entrega.estandar_prom_min)}${conDif(c.entrega.dif_prom_min)}` : 'sin tiempo previsto') : celda(sinDato, '')}
    ${c.ruta.n ? celda(dur(c.ruta.prom_min), c.ruta.estimado_prom_min != null ? html`est. ${dur(c.ruta.estimado_prom_min)}${conDif(c.ruta.dif_prom_min)}` : '') : celda(sinDato, '')}
    ${c.productividad.paradas_por_hora != null ? celda(num1(c.productividad.paradas_por_hora), '') : celda(sinDato, '')}
    ${c.puntualidad.pct != null ? celda(pct(c.puntualidad.pct), `${c.puntualidad.a_tiempo} de ${c.puntualidad.evaluadas}`) : celda(sinDato, '')}
    ${c.salida.n ? celda(html`<span class="${claseDif(c.salida.atraso_prom_min)}">${difMin(c.salida.atraso_prom_min)}</span>`, '') : celda(sinDato, '')}
    ${c.cumplimiento.programadas ? celda(html`<span class="${c.cumplimiento.dif_pct != null && c.cumplimiento.dif_pct < 0 ? 'dif-mas' : ''}">${pct(c.cumplimiento.pct, 1)}</span>`, `${c.cumplimiento.entregadas} de ${c.cumplimiento.programadas}`) : celda(sinDato, '')}</tr>`;
  const conGrafico = k.conductores.filter((c) => c.transito.n || c.entrega.n);
  return html`
    <div class="card"><div class="card-cab"><h2>Despacho: desempeño por conductor</h2><span class="sub">Cada cifra indica entre cuántos datos se calculó</span></div>
      <div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Conductor</th><th class="der">Despachos con horas</th><th class="der">Tránsito por tramo</th><th class="der">Entrega en cliente</th><th class="der">Ruta completa</th><th class="der">Paradas por hora</th><th class="der">Puntualidad</th><th class="der">Salida frente al plan</th><th class="der">Cumplimiento</th></tr></thead>
        <tbody>${k.conductores.map((c) => fila(c.nombre, c, false))}</tbody>${k.conductores.length > 1 ? html`<tfoot>${fila('Todos', t, true)}</tfoot>` : ''}</table></div>
      ${k.conductores.some((c) => c.driver_id == null) ? html`<div class="card-cuerpo muted" style="font-size:13px;border-top:1px solid var(--linea)">“Sin conductor asignado” agrupa despachos que no tienen conductor. Asígnalo al planificar para ver su desempeño.</div>` : ''}</div>
    <div class="grid g2" style="margin-top:16px;align-items:start">
      <div class="card"><div class="card-cab"><h2>Minutos promedio por conductor</h2><span class="sub">Por tramo de ruta y por entrega</span></div><div class="card-cuerpo">
        ${conGrafico.length ? html`<div class="canvas-caja"><canvas id="gr-fases" role="img" aria-label="Minutos promedio de tránsito y entrega por conductor"></canvas></div>` : vacio('Sin datos para graficar', 'Aparece al registrar las horas de llegada y fin de cada entrega.')}</div></div>
      <div class="card"><div class="card-cab"><h2>Cómo se miden</h2></div><div class="card-cuerpo"><dl class="nota-def" style="margin:0">
        <dt>Tránsito</dt><dd>Tiempo entre salir de un punto y llegar al siguiente, incluido el regreso. Se compara con lo que Google estimó al planificar: 100 % es igual, más es más lento.</dd>
        <dt>Entrega en el cliente</dt><dd>Desde que llega hasta que termina de entregar. Se compara con el tiempo por cliente usado al planificar.</dd>
        <dt>Ruta completa</dt><dd>Desde la salida hasta el regreso a la base (o hasta la última entrega si no regresa).</dd>
        <dt>Puntualidad</dt><dd>Entregas con horario en que el conductor llegó antes del límite.</dd>
        <dt>Cumplimiento</dt><dd>Paradas entregadas sobre paradas programadas.</dd></dl>
        <p class="muted" style="font-size:13px;margin:10px 0 0">Los promedios usan solo las horas anotadas.</p></div></div></div>`;
}

function vistaBodega(k) {
  const obj = k.objetivos;
  const t = k.total;
  const fila = (b, total) => html`<tr${total ? raw(' style="font-weight:600;background:#F8FAF9"') : ''}><td><b>${b.nombre}</b></td>
    ${b.preparacion.n ? celda(dur(b.preparacion.prom_min), obj.preparacion_min != null ? html`obj. ${dur(obj.preparacion_min)}${conDif(b.preparacion.dif_prom_min)} · ${b.preparacion.n} med.` : `${b.preparacion.n} med.`) : celda(sinDato, '')}
    ${b.carga.n ? celda(dur(b.carga.prom_min), obj.carga_min != null ? html`obj. ${dur(obj.carga_min)}${conDif(b.carga.dif_prom_min)} · ${b.carga.n} med.` : `${b.carga.n} med.`) : celda(sinDato, '')}
    ${celda(num0(b.despachos), '')}</tr>`;
  if (!k.bodega.length && !t.preparacion.n && !t.carga.n) {
    return html`<div class="card">${vacio('Todavía no hay horas de bodega', 'Al abrir un despacho en Rutas → Despachos, anota cuándo empezó y terminó la preparación del pedido y la carga del vehículo. Si indicas quién preparó, los promedios aparecen por persona.', html`<a class="btn btn-primario" href="#/rutas?tab=despachos">Ir a despachos</a>`)}</div>`;
  }
  return html`<div class="card"><div class="card-cab"><h2>Preparación y carga por responsable de bodega</h2><span class="sub">Cuánto demora cada persona frente al objetivo</span></div>
    <div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Responsable</th><th class="der">Preparar el pedido</th><th class="der">Cargar el vehículo</th><th class="der">Despachos medidos</th></tr></thead>
      <tbody>${k.bodega.map((b) => fila(b, false))}</tbody>${k.bodega.length > 1 ? html`<tfoot>${fila({ nombre: 'Todos', preparacion: t.preparacion, carga: t.carga, despachos: Math.max(t.preparacion.n, t.carga.n) }, true)}</tfoot>` : ''}</table></div>
    ${k.bodega.some((b) => b.driver_id == null) ? html`<div class="card-cuerpo muted" style="font-size:13px;border-top:1px solid var(--linea)">“Sin responsable de bodega” agrupa despachos donde no se indicó quién preparó. Indícalo al planificar o desde el despacho.</div>` : ''}</div>
    <div class="grid g2" style="margin-top:16px">
      <div class="card"><div class="card-cab"><h2>Minutos promedio por persona</h2></div><div class="card-cuerpo"><div class="canvas-caja"><canvas id="gr-bodega" role="img" aria-label="Minutos promedio de preparación y carga por responsable de bodega"></canvas></div></div></div>
      <div class="card"><div class="card-cab"><h2>Cómo se miden</h2></div><div class="card-cuerpo"><dl class="nota-def" style="margin:0">
        <dt>Preparación</dt><dd>Desde que empieza a armar el pedido (picking y embalaje) hasta que queda listo para cargar.</dd>
        <dt>Carga</dt><dd>Desde que empieza hasta que termina de cargar el vehículo en la base.</dd></dl>
        <p class="muted" style="font-size:13px;margin:10px 0 0">Los objetivos se definen en Configuración → Objetivos y metas.</p></div></div></div>`;
}

function vistaEntregas(k) {
  const c = k.total.cumplimiento;
  if (!c.programadas) return html`<div class="card">${vacio('Todavía no hay entregas con resultado', 'En cada despacho, marca cada parada como entregada o no entregada (y el motivo). Con eso se calcula el cumplimiento.', html`<a class="btn btn-primario" href="#/rutas?tab=despachos">Ir a despachos</a>`)}</div>`;
  const max = Math.max(1, ...c.motivos.map((m) => m.n));
  return html`<div class="grid g2" style="align-items:start">
    <div class="card"><div class="card-cab"><h2>Cumplimiento de entregas</h2><span class="sub">Entregadas sobre programadas</span></div><div class="card-cuerpo apilar">
      <div class="fila entre"><span class="num" style="font-size:38px;font-weight:600">${pct(c.pct, 1)}</span><span class="muted" style="text-align:right">${num0(c.entregadas)} de ${num0(c.programadas)} entregadas<br>${c.objetivo_pct != null ? html`Objetivo ${pct(c.objetivo_pct)}${c.dif_pct != null ? html` · <span class="${c.dif_pct < 0 ? 'dif-mas' : 'dif-menos'}">${c.dif_pct < 0 ? '−' : '+'}${num1(Math.abs(c.dif_pct))} pts</span>` : ''}` : html`<a href="#/configuracion?tab=metas">Definir objetivo</a>`}</span></div>
      ${barra(c.pct, 100, { color: c.objetivo_pct != null && c.pct < c.objetivo_pct ? 'var(--serie-2)' : 'var(--serie-1)', alto: 14 })}
      <div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Conductor</th><th class="der">Programadas</th><th class="der">Entregadas</th><th class="der">Cumplimiento</th></tr></thead><tbody>
        ${k.conductores.filter((x) => x.cumplimiento.programadas).map((x) => html`<tr><td><b>${x.nombre}</b></td><td class="der">${x.cumplimiento.programadas}</td><td class="der">${x.cumplimiento.entregadas}</td><td class="der"><b class="${x.cumplimiento.dif_pct != null && x.cumplimiento.dif_pct < 0 ? 'dif-mas' : ''}">${pct(x.cumplimiento.pct, 1)}</b></td></tr>`)}</tbody></table></div></div></div>
    <div class="card"><div class="card-cab"><h2>Por qué no se entregó</h2><span class="sub">${pluralizar(c.no_entregadas, 'entrega no realizada', 'entregas no realizadas')}</span></div><div class="card-cuerpo apilar">
      ${c.motivos.length ? c.motivos.map((m) => html`<div><div class="fila entre" style="margin-bottom:3px"><span>${m.motivo}</span><b class="num">${m.n}</b></div>${barra(m.n, max, { color: 'var(--serie-2)', alto: 8 })}</div>`) : html`<p class="muted" style="margin:0">Todas las entregas programadas se cumplieron.</p>`}</div></div></div>`;
}

function vistaDespachos(k) {
  const regTxt = (d) => (d.registrados === 0 ? html`<span class="tenue">Sin horas</span>` : html`<span class="insignia ${d.registrados === d.esperados ? 'ok' : 'aviso'}">${d.registrados} de ${d.esperados}</span>`);
  return html`<div class="card"><div class="card-cab"><h2>Despachos del período</h2><span class="sub">Haz clic en uno para ver o completar sus horas</span></div>
    <div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>N°</th><th>Fecha</th><th>Conductor</th><th>Bodega</th><th>Horas</th><th class="der">Preparación</th><th class="der">Carga</th><th class="der">Tránsito</th><th class="der">Ruta completa</th><th class="der">Paradas/h</th><th class="der">Entregadas</th></tr></thead><tbody>
    ${k.despachos.map((d) => html`<tr class="clic" data-trip="${d.trip_id}"><td><b>${d.trip_id}</b></td><td class="nowrap">${fecha(d.fecha)}</td><td>${d.conductor ?? html`<span class="tenue">Sin asignar</span>`}</td><td>${d.preparador ?? html`<span class="tenue">—</span>`}</td><td>${regTxt(d)}</td>
      ${d.preparacion_min != null ? celda(dur(d.preparacion_min), '') : celda(sinDato, '')}
      ${d.carga_min != null ? celda(dur(d.carga_min), '') : celda(sinDato, '')}
      ${d.transito_real_min != null ? celda(dur(d.transito_real_min), html`est. ${dur(d.transito_estimado_min)}`) : celda(sinDato, '')}
      ${d.ruta_min != null ? celda(dur(d.ruta_min), d.ruta_estimado_min != null ? html`est. ${dur(d.ruta_estimado_min)}` : '') : celda(sinDato, '')}
      ${d.paradas_por_hora != null ? celda(num1(d.paradas_por_hora), '') : celda(sinDato, '')}
      ${d.programadas != null ? celda(`${d.entregadas} de ${d.programadas}`, '') : celda(sinDato, '')}</tr>`)}</tbody></table></div></div>`;
}

function activarContenido(root, k) {
  const r = (n) => (n == null ? null : Math.round(n * 10) / 10);
  const g1 = root.querySelector('#gr-fases');
  if (g1) {
    const lista = k.conductores.filter((c) => c.transito.n || c.entrega.n);
    graficoBarras(g1, { etiquetas: lista.map((c) => c.nombre), formato: (n) => `${num0(n)} min`, series: [
      { nombre: 'Tránsito por tramo', datos: lista.map((c) => r(c.transito.prom_min)), color: '#eb6834' },
      { nombre: 'Entrega en cada cliente', datos: lista.map((c) => r(c.entrega.prom_min)), color: '#1baf7a' },
    ] });
  }
  const g2 = root.querySelector('#gr-bodega');
  if (g2 && k.bodega.length) {
    graficoBarras(g2, { etiquetas: k.bodega.map((b) => b.nombre), formato: (n) => `${num0(n)} min`, series: [
      { nombre: 'Preparar el pedido', datos: k.bodega.map((b) => r(b.preparacion.prom_min)), color: '#2a78d6' },
      { nombre: 'Cargar el vehículo', datos: k.bodega.map((b) => r(b.carga.prom_min)), color: '#1baf7a' },
    ] });
  }
}
