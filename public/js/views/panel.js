// Panel de análisis y comparación: rutas más costosas, rendimiento de conductores, costo por cliente y sector,
// kilometraje y desgaste de vehículos, ahorro de combustible, utilización de la carga y ahorro potencial.
import { html, pintar, get, clp, kmTxt, duracion, num0, num1, pct, fecha, difMin, claseDif, graficoBarras } from '../lib.js';
import { kpi, barraPeriodo, activarPeriodo, periodoDe, botonesExportar, activarExportar, barra, checklistSetup, faltaDato } from '../componentes.js';

const MANTENCION = { al_dia: ['ok', 'Al día'], proxima: ['aviso', 'Próxima'], vencida: ['error', 'Vencida'], sin_datos: ['', 'Sin datos'] };
const insMant = (m) => { const [c, t] = MANTENCION[m?.estado] ?? ['', '—']; return html`<span class="insignia ${c}">${t}</span>`; };
const sinDato = html`<span class="tenue">Sin dato</span>`;
const v = (x, f) => (x == null ? sinDato : f(x));

export default async function (ctx) {
  const { root, params, estado, navegar } = ctx;
  const per = periodoDe(params);
  const datos = await get(`/panel${per.modo === 'mes' ? `?mes=${per.mes}` : `?desde=${per.desde}&hasta=${per.hasta}`}`);
  const R = datos.resumen;
  const sinDespachos = R.despachos === 0;

  pintar(root, html`
    <div class="pagina-cab"><div>
      <h2 style="font-size:20px">Panel de análisis y comparación</h2>
      <p>Todo sale de despachos completados y de lo que registras: si falta un dato, el indicador queda en blanco y te decimos qué falta.</p></div>
      <div class="acciones">${botonesExportar('/api/reportes/panel', per.query)}</div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-cuerpo">${barraPeriodo(per)}</div></div>

    ${estado.setup?.pendientes ? html`<div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Faltan datos para calcular costos reales</h2><span class="sub">${estado.setup.pendientes} pendientes</span></div>${checklistSetup(estado.setup, { soloFaltantes: true, esAdmin: !estado.usuario || estado.usuario.rol === 'admin' })}</div>` : ''}

    <dl class="kpis" style="margin-bottom:16px">
      ${kpi('Despachos completados', num0(R.despachos), { detalle: R.entregas ? `${num0(R.entregas)} entregas · ${kmTxt(R.km)}` : 'En el período elegido', vacio: '0' })}
      ${kpi('Costo total', R.costo_total != null ? clp(R.costo_total) : null, { detalle: R.tiempo_promedio_min != null ? `Despacho promedio: ${duracion(R.tiempo_promedio_min)}` : '', vacio: sinDespachos ? 'Sin despachos' : 'Falta calcular' })}
      ${kpi('Costo por km', R.costo_km != null ? clp(R.costo_km) : null)}
      ${kpi('Costo por entrega', R.costo_entrega != null ? clp(R.costo_entrega) : null)}
      ${kpi('Cumplimiento de entregas', R.cumplimiento_pct != null ? pct(R.cumplimiento_pct, 1) : null, { detalle: R.cumplimiento_objetivo_pct != null ? `Meta ${pct(R.cumplimiento_objetivo_pct)}` : 'Sin meta definida', tono: R.cumplimiento_pct != null && R.cumplimiento_objetivo_pct != null && R.cumplimiento_pct < R.cumplimiento_objetivo_pct ? 'bajo-meta' : '' })}
      ${kpi('Utilización de la carga', (R.utilizacion_volumen_pct ?? R.utilizacion_peso_pct) != null ? num0(R.utilizacion_volumen_pct ?? R.utilizacion_peso_pct) : null, { unidad: '%', detalle: [R.utilizacion_peso_pct != null ? `Peso ${pct(R.utilizacion_peso_pct)}` : null, R.utilizacion_volumen_pct != null ? `Volumen ${pct(R.utilizacion_volumen_pct)}` : null, R.utilizacion_objetivo_pct != null ? `Meta ${pct(R.utilizacion_objetivo_pct)}` : null].filter(Boolean).join(' · ') })}
      ${kpi('Ahorro potencial', R.ahorro_potencial != null ? clp(R.ahorro_potencial) : null, { detalle: R.ahorro_potencial != null && !R.ahorro_completo ? 'Parcial: faltan datos en alguna parte' : R.ahorro_potencial != null ? 'Rutas + vehículo + cubicaje + procesos' : '', vacio: 'Aún no calculable' })}
    </dl>

    ${datos.alertas.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Alertas</h2></div><div class="card-cuerpo apilar">${datos.alertas.map((a) => html`<div class="aviso ${a.nivel === 'alta' ? 'rojo' : a.nivel === 'media' ? 'ambar' : ''}" style="margin:0"><p><b>${a.nombre}.</b> ${a.texto}</p></div>`)}</div></div>` : ''}

    <div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Ahorro potencial</h2><span class="sub">Solo se suma lo que se pudo calcular con tus datos</span></div>
      <div class="tabla-wrap"><table><thead><tr><th>De dónde sale</th><th>Qué significa</th><th class="der">Ahorro</th></tr></thead><tbody>
        ${datos.ahorro_potencial.piezas.map((p) => html`<tr><td><b>${p.nombre}</b></td><td>${p.monto != null ? p.detalle : html`<span class="muted">Falta: ${p.falta}</span>`}</td><td class="der">${p.monto != null ? html`<b>${clp(p.monto)}</b>` : sinDato}</td></tr>`)}
      </tbody>${datos.ahorro_potencial.total != null ? html`<tfoot><tr><td colspan="2"><b>Total calculable</b>${datos.ahorro_potencial.completo ? '' : html` <span class="muted">(parcial)</span>`}</td><td class="der"><b>${clp(datos.ahorro_potencial.total)}</b></td></tr></tfoot>` : ''}</table></div></div>

    <div class="grid g2" style="margin-bottom:16px;align-items:start">
      <div class="card"><div class="card-cab"><h2>Rutas más costosas</h2><span class="sub">Despachos y combinaciones de sectores</span></div>
        ${datos.rutas_costosas.despachos.length ? html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Despacho</th><th>Sectores</th><th class="der">Km</th><th class="der">Costo</th><th class="der">Por entrega</th></tr></thead><tbody>
          ${datos.rutas_costosas.despachos.map((d) => html`<tr class="clic" data-ir="#/rutas?tab=despachos&trip=${d.trip_id}"><td>N° ${d.trip_id}<span class="sub-cel">${fecha(d.fecha)} · ${d.vehiculo}</span></td><td>${d.sectores.join(', ') || '—'}</td><td class="der">${v(d.km, num1)}</td><td class="der"><b>${clp(d.costo_total)}</b></td><td class="der">${v(d.costo_entrega, clp)}</td></tr>`)}</tbody></table></div>
          ${datos.rutas_costosas.por_ruta.length > 1 || datos.rutas_costosas.por_ruta[0]?.despachos > 1 ? html`<div class="card-cuerpo" style="border-top:1px solid var(--linea)"><div class="seccion-form">Por recorrido repetido</div><table class="tabla-compacta"><tbody>${datos.rutas_costosas.por_ruta.slice(0, 5).map((r) => html`<tr><td>${r.ruta}<span class="sub-cel">${r.despachos} despacho${r.despachos > 1 ? 's' : ''}</span></td><td class="der">${clp(r.costo_promedio)}<span class="sub-cel">promedio</span></td><td class="der">${v(r.costo_km, clp)}<span class="sub-cel">por km</span></td></tr>`)}</tbody></table></div>` : ''}`
          : html`<div class="vacio"><h3>Sin despachos completados</h3><p>Aparecen al cerrar un despacho en Rutas y despachos.</p></div>`}</div>

      <div class="card"><div class="card-cab"><h2>Costo por cliente y por sector</h2><span class="sub">${datos.costo_cliente_sector.promedio_entrega != null ? `Promedio por entrega ${clp(datos.costo_cliente_sector.promedio_entrega)}` : 'Se reparte entre las paradas'}</span></div>
        ${datos.costo_cliente_sector.clientes.length ? html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Cliente</th><th class="der">Entregas</th><th class="der">Costo</th><th class="der">Por entrega</th></tr></thead><tbody>
          ${datos.costo_cliente_sector.clientes.map((c) => html`<tr><td>${c.nombre}<span class="sub-cel">${c.comuna ?? 'Sin comuna'}</span></td><td class="der">${c.entregas}</td><td class="der">${clp(c.costo_total)}</td><td class="der">${clp(c.costo_promedio)}${c.veces_promedio != null && c.veces_promedio >= 1.3 ? html`<span class="sub-cel dif-mas">${num1(c.veces_promedio)}× el promedio</span>` : ''}</td></tr>`)}</tbody></table></div>
          ${datos.costo_cliente_sector.sectores.length ? html`<div class="card-cuerpo" style="border-top:1px solid var(--linea)"><div class="seccion-form">Sectores más costosos</div>
            ${datos.costo_cliente_sector.sectores.slice(0, 5).map((s) => html`<div style="margin-bottom:8px"><div class="fila entre"><span>${s.clave}</span><span class="num">${clp(s.costo)} <span class="muted">· ${clp(s.costo_por_entrega)} por entrega</span></span></div>${barra(s.costo, datos.costo_cliente_sector.sectores[0].costo)}</div>`)}</div>` : ''}`
          : html`<div class="vacio"><h3>Sin entregas con costo</h3><p>El costo de cada despacho se reparte entre sus paradas.</p></div>`}</div>
    </div>

    <div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Rendimiento de conductores</h2><span class="sub">Tiempos de ruta, entregas y puntualidad con las horas que registras</span><span class="espacio"></span><a class="btn btn-chico" href="#/kpi?${per.modo === 'mes' ? `mes=${per.mes}` : `desde=${per.desde}&hasta=${per.hasta}`}">Ver indicadores</a></div>
      ${datos.conductores.filas.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Conductor</th><th class="der">Despachos</th><th class="der">Km</th><th class="der">Costo por entrega</th><th class="der">Ruta (prom.)</th><th class="der">Entrega en cliente</th><th class="der">Paradas por hora</th><th class="der">Puntualidad</th><th class="der">Cumplimiento</th></tr></thead><tbody>
        ${datos.conductores.filas.map((c) => html`<tr><td><b>${c.nombre}</b>${c.medidos < c.despachos ? html`<span class="sub-cel">${c.medidos} de ${c.despachos} con horas</span>` : ''}</td><td class="der">${c.despachos}</td><td class="der">${v(c.km || null, num1)}</td><td class="der">${v(c.costo_entrega, clp)}</td>
          <td class="der">${v(c.ruta_prom_min, duracion)}${c.ruta_vs_estimado_min != null ? html`<span class="sub-cel ${claseDif(c.ruta_vs_estimado_min)}">${difMin(c.ruta_vs_estimado_min)} vs. estimado</span>` : ''}</td>
          <td class="der">${v(c.entrega_prom_min, duracion)}</td><td class="der">${v(c.paradas_por_hora, num1)}</td><td class="der">${v(c.puntualidad_pct, (x) => pct(x))}</td>
          <td class="der">${v(c.cumplimiento_pct, (x) => pct(x, 1))}${c.programadas ? html`<span class="sub-cel">${c.entregadas} de ${c.programadas}</span>` : ''}</td></tr>`)}</tbody></table></div>
        ${datos.conductores.sin_registro ? html`<div class="card-cuerpo muted" style="font-size:13px">${datos.conductores.sin_registro} despacho(s) sin horas registradas no entran a los promedios.</div>` : ''}`
        : html`<div class="vacio"><h3>Sin datos de conductores</h3><p>Asigna un conductor al guardar un despacho y registra sus horas.</p></div>`}</div>

    <div class="grid g2" style="margin-bottom:16px;align-items:start">
      <div class="card"><div class="card-cab"><h2>Vehículos: kilómetros y desgaste</h2><span class="espacio"></span><a class="btn btn-chico" href="#/vehiculos">Ver flota</a></div>
        ${datos.vehiculos.length ? html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Vehículo</th><th class="der">Km del período</th><th class="der">Desgaste</th><th>Mantención</th></tr></thead><tbody>
          ${datos.vehiculos.map((x) => html`<tr><td><b>${x.nombre ?? x.modelo}</b><span class="sub-cel">${x.modelo}</span></td>
            <td class="der">${x.km_periodo != null ? html`${num0(x.km_periodo)}<span class="sub-cel">registrados por ti</span>` : x.km_despachos ? html`${num0(x.km_despachos)}<span class="sub-cel">solo de despachos</span>` : sinDato}</td>
            <td class="der" style="min-width:130px">${x.desgaste_pct != null ? html`${pct(x.desgaste_pct)} consumido${barra(x.desgaste_pct, 100, { color: x.desgaste_pct > 80 ? 'var(--rojo)' : 'var(--serie-1)', alto: 6 })}` : sinDato}</td>
            <td>${insMant(x.mantencion)}${x.mantencion?.restantes_km != null && x.mantencion.estado !== 'al_dia' ? html`<span class="sub-cel">${x.mantencion.restantes_km > 0 ? `faltan ${num0(x.mantencion.restantes_km)} km` : `pasada por ${num0(-x.mantencion.restantes_km)} km`}</span>` : ''}</td></tr>`)}</tbody></table></div>` : html`<div class="vacio"><h3>Sin vehículos</h3></div>`}</div>

      <div class="card"><div class="card-cab"><h2>Ahorro de combustible</h2><span class="sub">${datos.combustible.litros_periodo != null ? `${num0(datos.combustible.litros_periodo)} L cargados en el período` : 'Rendimiento real vs. configurado'}</span></div>
        ${datos.combustible.vehiculos.length ? html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Vehículo</th><th class="der">Configurado</th><th class="der">Real</th><th class="der">Diferencia</th></tr></thead><tbody>
          ${datos.combustible.vehiculos.map((x) => html`<tr><td>${x.nombre ?? x.modelo}</td><td class="der">${v(x.configurado_km_l, (n) => `${num1(n)} km/L`)}</td><td class="der">${v(x.real_km_l, (n) => `${num1(n)} km/L`)}${x.cargas < 2 ? html`<span class="sub-cel">faltan cargas</span>` : ''}</td><td class="der ${x.consumo_alto ? 'dif-mas' : ''}">${x.desvio_pct != null ? `${x.desvio_pct > 0 ? '−' : '+'}${num0(Math.abs(x.desvio_pct))}%` : '—'}</td></tr>`)}</tbody></table></div>` : ''}
        <div class="card-cuerpo apilar" style="border-top:1px solid var(--linea)">${datos.combustible.oportunidades.length ? datos.combustible.oportunidades.map((o) => html`<div><p style="margin:0">${o.texto}</p>${o.ahorro != null ? html`<p class="muted" style="margin:2px 0 0;font-size:13px">Ahorro estimado: <b>${clp(o.ahorro)}</b></p>` : ''}</div>`)
          : html`<p class="muted" style="margin:0">Sin oportunidades detectadas con los datos actuales. Para compararlas hacen falta al menos dos cargas de combustible por vehículo (con el kilometraje del tablero).</p>`}</div></div>
    </div>

    <div class="grid g2" style="margin-bottom:16px;align-items:start">
      <div class="card"><div class="card-cab"><h2>Utilización de la carga</h2><span class="sub">${datos.utilizacion.objetivo_pct != null ? `Meta ${pct(datos.utilizacion.objetivo_pct)}` : 'Sin meta definida'}</span><span class="espacio"></span><a class="btn btn-chico" href="#/cubicaje">Cubicaje</a></div>
        ${datos.utilizacion.por_vehiculo.some((x) => x.despachos) ? html`<div class="card-cuerpo apilar">${datos.utilizacion.por_vehiculo.filter((x) => x.despachos).map((x) => html`<div><b>${x.nombre}</b> <span class="muted">· ${x.despachos} despacho${x.despachos > 1 ? 's' : ''}</span>
          <div class="fila entre" style="margin-top:4px"><span class="muted" style="font-size:13px">Peso ${x.peso_pct != null ? pct(x.peso_pct) : 'sin dato'}</span></div>${x.peso_pct != null ? barra(x.peso_pct, 100, { alto: 8, color: 'var(--serie-3)' }) : ''}
          <div class="fila entre" style="margin-top:6px"><span class="muted" style="font-size:13px">Volumen ${x.volumen_pct != null ? pct(x.volumen_pct) : x.tiene_medidas ? 'sin dato' : 'faltan medidas del vehículo o de los productos'}</span></div>${x.volumen_pct != null ? barra(x.volumen_pct, 100, { alto: 8 }) : ''}</div>`)}</div>`
          : html`<div class="vacio"><h3>Sin datos de carga</h3><p>Se calcula con el peso de los productos y las medidas del vehículo de cada despacho.</p></div>`}</div>

      <div class="card"><div class="card-cab"><h2>Costo de los últimos 6 meses</h2></div><div class="card-cuerpo"><div class="canvas-caja baja"><canvas id="gr-serie" role="img" aria-label="Costo total por mes"></canvas></div></div></div>
    </div>

    ${datos.datos_faltantes.length ? faltaDato('Datos que mejorarían estos indicadores', datos.datos_faltantes, html`<a class="btn btn-chico" href="#/configuracion">Ir a Configuración</a>`) : ''}`);

  graficoBarras(root.querySelector('#gr-serie'), { etiquetas: datos.serie.map((s) => s.mes.slice(2)), series: [{ nombre: 'Costo total', datos: datos.serie.map((s) => s.total), color: '#2a78d6' }] });
  activarPeriodo(root, 'panel', params, navegar);
  activarExportar(root);
  root.addEventListener('click', (e) => { const tr = e.target.closest('[data-ir]'); if (tr) navegar(tr.dataset.ir); });
}
