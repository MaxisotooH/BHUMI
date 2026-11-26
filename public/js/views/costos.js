// Control de costos de transporte y distribución: lo que calcula el sistema frente a lo que realmente se gastó.
import { html, pintar, get, clp, kmTxt, num0, num1, fecha, graficoBarras, alHacer, vacio } from '../lib.js';
import { kpi, barraPeriodo, activarPeriodo, periodoDe, botonesExportar, activarExportar } from '../componentes.js';
import { formularioGasto, borrarGasto } from '../gastos.js';

const sinDato = html`<span class="tenue">Sin dato</span>`;
const dif = (n) => (n == null ? sinDato : html`<span class="${n > 0 ? 'dif-mas' : n < 0 ? 'dif-menos' : ''}">${n > 0 ? '+' : n < 0 ? '−' : ''}${clp(Math.abs(n))}</span>`);

export default async function (ctx) {
  const { root, params, estado, navegar } = ctx;
  const per = periodoDe(params);
  const q = per.modo === 'mes' ? `mes=${per.mes}` : `desde=${per.desde}&hasta=${per.hasta}`;
  const [c, gastos, vehiculos] = await Promise.all([get(`/control-costos?${q}`), get(`/gastos?${q}`), get('/vehiculos')]);
  const M = c.modelado;
  const R = c.real;
  const real = c.total_con_conductor.real;
  const dTotal = real != null ? real - c.total_con_conductor.modelado : null;
  const hayCarga = R.cargas > 0;

  pintar(root, html`
    <div class="pagina-cab"><div><h2 style="font-size:20px">Control de costos de transporte y distribución</h2>
      <p>El sistema calcula cuánto debería costar cada despacho (combustible, desgaste, conductor, peajes). Aquí lo comparas con lo que realmente gastaste: cargas de combustible, mantenciones, seguros y permisos.</p></div>
      <div class="acciones">${botonesExportar('/api/reportes/costos', per.query)}<button class="btn btn-primario" id="nuevo-gasto">Registrar gasto</button></div></div>
    <div class="card" style="margin-bottom:16px"><div class="card-cuerpo">${barraPeriodo(per)}</div></div>

    ${c.avisos.map((a) => html`<div class="aviso ambar" style="margin-bottom:10px"><p>${a}</p></div>`)}

    <dl class="kpis" style="margin-bottom:16px">
      ${kpi('Costo calculado', c.despachos ? clp(c.total_con_conductor.modelado) : null, { detalle: c.despachos ? `${c.despachos} despacho${c.despachos > 1 ? 's' : ''} · ${kmTxt(c.km)} · incluye conductor` : '', vacio: 'Sin despachos' })}
      ${kpi('Costo real', real != null ? clp(real) : null, { detalle: real != null ? 'Cargas, mantención, fijos y conductor' : hayCarga ? 'Faltan montos en las cargas de combustible' : 'Registra las cargas de combustible con su monto', vacio: 'Falta combustible real' })}
      ${kpi('Diferencia', dTotal != null ? html`${dTotal > 0 ? '+' : dTotal < 0 ? '−' : ''}${clp(Math.abs(dTotal))}` : null, { detalle: dTotal != null ? (dTotal > 0 ? 'Se gastó más de lo calculado' : 'Se gastó menos de lo calculado') : '', vacio: 'Sin comparar', tono: dTotal > 0 ? 'bajo-meta' : '' })}
      ${kpi('Costo por km', c.costo_km.real != null ? clp(c.costo_km.real) : c.costo_km.modelado != null ? clp(c.costo_km.modelado) : null, { detalle: c.costo_km.real != null ? `Calculado: ${clp(c.costo_km.modelado)}` : c.costo_km.modelado != null ? 'Calculado (sin costo real)' : '' })}
      ${kpi('Costo por entrega', c.costo_entrega.real != null ? clp(c.costo_entrega.real) : c.costo_entrega.modelado != null ? clp(c.costo_entrega.modelado) : null, { detalle: c.costo_entrega.real != null ? `Calculado: ${clp(c.costo_entrega.modelado)}` : c.costo_entrega.modelado != null ? 'Calculado (sin costo real)' : '' })}
    </dl>

    <div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Calculado vs. real</h2><span class="sub">Por concepto de costo</span></div>
      <div class="tabla-wrap"><table><thead><tr><th>Concepto</th><th class="der">Calculado</th><th class="der">Real</th><th class="der">Diferencia</th><th class="der">%</th><th>Nota</th></tr></thead><tbody>
        ${c.comparacion.map((x) => html`<tr><td><b>${x.concepto}</b></td><td class="der">${clp(x.modelado)}</td><td class="der">${x.real != null ? clp(x.real) : sinDato}</td><td class="der">${dif(x.dif)}</td><td class="der">${x.dif_pct != null ? `${x.dif_pct > 0 ? '+' : ''}${num0(x.dif_pct)}%` : '—'}</td><td class="muted" style="font-size:13px">${x.nota ?? ''}</td></tr>`)}
        <tr><td><b>Conductor</b></td><td class="der">${clp(M.conductor)}</td><td class="der">${sinDato}</td><td class="der">—</td><td class="der">—</td><td class="muted" style="font-size:13px">Horas del despacho × costo por hora; el sistema no registra sueldos.</td></tr></tbody>
        ${c.diferencia_total ? html`<tfoot><tr><td><b>Total comparable</b></td><td class="der"><b>${clp(c.diferencia_total.modelado)}</b></td><td class="der"><b>${clp(c.diferencia_total.real)}</b></td><td class="der"><b>${dif(c.diferencia_total.dif)}</b></td><td></td><td class="muted" style="font-size:13px">Solo los conceptos que tienen dato real</td></tr></tfoot>` : ''}</table></div>
      <div class="card-cuerpo muted" style="font-size:13px;border-top:1px solid var(--linea)">Lo real incluye todo el uso del vehículo en el período, aunque no sea de un despacho registrado; por eso suele ser mayor. Para comparar con justicia usa el costo por km.</div></div>

    <div class="grid g2" style="margin-bottom:16px;align-items:start">
      <div class="card"><div class="card-cab"><h2>Costos fijos y variables</h2></div><div class="card-cuerpo apilar">
        <div><div class="seccion-form" style="margin-top:0">Variables (cambian con los km)</div>
          ${[['Combustible', c.variables.combustible], ['Desgaste y mantención', c.variables.desgaste], ['Peajes, estacionamientos y otros', c.variables.peajes_y_otros]].map(([t, n]) => html`<div class="fila entre" style="padding:4px 0"><span>${t}</span><b class="num">${clp(n)}</b></div>`)}</div>
        <div><div class="seccion-form">Fijos (se pagan igual con o sin despachos)</div>
          ${[['Conductor (calculado)', c.fijos.conductor], ['Seguros, permisos y revisiones', c.fijos.seguros_permisos]].map(([t, n]) => html`<div class="fila entre" style="padding:4px 0"><span>${t}</span><b class="num">${clp(n)}</b></div>`)}</div></div></div>
      <div class="card"><div class="card-cab"><h2>Calculado y real, mes a mes</h2></div><div class="card-cuerpo"><div class="canvas-caja baja"><canvas id="gr-serie" role="img" aria-label="Costo calculado y real por mes"></canvas></div></div></div>
    </div>

    ${c.por_vehiculo.length ? html`<div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Por vehículo</h2></div><div class="tabla-wrap"><table><thead><tr><th>Vehículo</th><th class="der">Despachos</th><th class="der">Km</th><th class="der">Calculado</th><th class="der">Real</th><th class="der">$/km calculado</th><th class="der">$/km real</th></tr></thead><tbody>
      ${c.por_vehiculo.map((v) => html`<tr><td><b>${v.nombre}</b>${v.patente ? html`<span class="sub-cel">${v.patente}</span>` : ''}</td><td class="der">${v.despachos}</td><td class="der">${v.km ? num1(v.km) : '—'}</td><td class="der">${v.despachos ? clp(v.modelado) : '—'}</td><td class="der">${v.real != null ? clp(v.real) : sinDato}</td><td class="der">${v.costo_km_modelado != null ? clp(v.costo_km_modelado) : '—'}</td><td class="der">${v.costo_km_real != null ? clp(v.costo_km_real) : sinDato}</td></tr>`)}</tbody></table></div></div>` : ''}

    <div class="card"><div class="card-cab"><h2>Gastos registrados</h2><span class="sub">${gastos.length} en el período · ${clp(gastos.reduce((a, g) => a + g.monto, 0))}</span></div>
      ${gastos.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Vehículo</th><th>Proveedor y detalle</th><th class="der">Km tablero</th><th class="der">Monto</th><th></th></tr></thead><tbody>
        ${gastos.map((g) => html`<tr><td>${fecha(g.fecha)}</td><td><b>${g.categoria_nombre}</b></td><td>${g.vehiculo ?? html`<span class="tenue">—</span>`}</td><td>${[g.proveedor, g.detalle].filter(Boolean).join(' · ') || ''}</td><td class="der">${g.km_odometro != null ? num0(g.km_odometro) : ''}</td><td class="der"><b>${clp(g.monto)}</b></td>
          <td class="der" style="white-space:nowrap"><button class="btn btn-texto btn-chico" data-edit="${g.id}">Editar</button><button class="btn btn-texto btn-chico" data-borrar="${g.id}">Eliminar</button></td></tr>`)}</tbody></table></div>`
        : vacio('Sin gastos registrados en este período', 'Anota mantenciones, neumáticos, seguros y permisos para ver el costo real. Las cargas de combustible se anotan en Vehículos y kilometraje.', html`<button class="btn btn-primario" data-nuevo-gasto>Registrar gasto</button>`)}</div>`);

  graficoBarras(root.querySelector('#gr-serie'), { etiquetas: c.serie.map((s) => s.mes.slice(2)), series: [{ nombre: 'Calculado', datos: c.serie.map((s) => s.modelado), color: '#2a78d6' }, { nombre: 'Real', datos: c.serie.map((s) => s.real ?? 0), color: '#eb6834' }] });
  const alGuardar = () => { window.dispatchEvent(new HashChangeEvent('hashchange')); };
  const abrir = (g = null) => formularioGasto({ meta: estado.meta, vehiculos: vehiculos.filter((v) => v.activo), gasto: g, alGuardar });
  root.querySelector('#nuevo-gasto').addEventListener('click', () => abrir());
  alHacer(root, 'click', '[data-nuevo-gasto]', () => abrir());
  alHacer(root, 'click', '[data-edit]', (e, b) => abrir(gastos.find((g) => g.id === Number(b.dataset.edit))));
  alHacer(root, 'click', '[data-borrar]', (e, b) => borrarGasto(gastos.find((g) => g.id === Number(b.dataset.borrar)), alGuardar));
  activarPeriodo(root, 'costos', params, navegar);
  activarExportar(root);
}
