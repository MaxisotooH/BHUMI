// Consolidación de despachos: entregas cercanas que caben juntas en un vehículo, para hacer menos viajes.
import { html, pintar, get, clp, num0, num1, pct, vacio, pluralizar } from '../lib.js';
import { kpi, faltaDato } from '../componentes.js';

export async function pintarConsolidacion(ctx, cont) {
  const s = await get('/consolidacion');
  const r = s.resumen;

  pintar(cont, html`
    <div class="card" style="margin-bottom:16px"><div class="card-cuerpo" style="font-size:14px">
      <b>Cómo funciona.</b> El sistema junta las entregas pendientes que quedan a menos de <b>${num0(s.radio_km)} km</b> entre sí y revisa, con las medidas reales de productos y vehículos, si caben en un solo viaje. Si caben, propone llevarlas juntas en el vehículo más económico. El radio se cambia en <a href="#/configuracion?tab=metas">Configuración</a>.</div></div>
    <dl class="kpis" style="margin-bottom:16px">
      ${kpi('Entregas pendientes', num0(r.entregas_pendientes), { detalle: `${num0(r.entregas_en_grupos)} están cerca de otra` })}
      ${kpi('Grupos que se pueden juntar', num0(r.grupos), { vacio: '0' })}
      ${kpi('Despachos que se evitan', num0(r.despachos_evitables), { detalle: 'Si se juntan todos los grupos' })}
      ${kpi('Ahorro estimado', r.ahorro_estimado != null ? clp(r.ahorro_estimado) : null, { vacio: 'Sin distancias aún', detalle: r.ahorro_estimado != null ? 'Con distancias de Google ya consultadas' : 'Calcula la ruta con Google para ver el ahorro' })}
    </dl>
    ${s.sin_medidas.length ? faltaDato('Faltan medidas para calcular algunos grupos', s.sin_medidas.map((m) => `${m.tipo === 'producto' ? 'Producto' : 'Vehículo'} ${m.nombre}: falta ${m.faltan.join(', ')}`), html`<a class="btn btn-chico" href="#/cubicaje?tab=productos">Completar productos</a> <a class="btn btn-chico" href="#/vehiculos">Completar vehículos</a>`) : ''}
    ${r.entregas_pendientes === 0 ? html`<div class="card">${vacio('No hay entregas pendientes', 'Cuando registres entregas con productos, aquí aparecerán las que conviene juntar.', html`<a class="btn btn-primario" href="#/rutas?tab=entregas">Ir a entregas</a>`)}</div>`
      : s.grupos.length ? html`<div class="apilar">${s.grupos.map(tarjetaGrupo)}</div>`
      : html`<div class="card">${vacio('Ninguna entrega está cerca de otra', `No hay entregas pendientes a menos de ${num0(s.radio_km)} km entre sí. Revisa que los clientes tengan ubicación o aumenta el radio en Configuración.`, html`<a class="btn btn-primario" href="#/configuracion?tab=metas">Cambiar el radio</a>`)}</div>`}
    ${s.un_producto.length ? html`<h3 style="margin:24px 0 8px">Entregas de un solo producto que pasan cerca de un despacho planificado</h3>
      <p class="muted" style="margin:0 0 10px;font-size:13.5px">Estas entregas podrían subirse a un despacho que ya está armado, si queda espacio. Así no se hace un viaje aparte.</p>
      <div class="apilar">${s.un_producto.map(tarjetaUnProducto)}</div>` : ''}`);
}

function tarjetaGrupo(g) {
  const sug = g.vehiculo_sugerido;
  const ids = g.entregas.map((e) => e.delivery_id).join(',');
  const juntas = sug && !sug.despachos; // cabe completo en un vehículo
  return html`<article class="card"><div class="card-cab"><h2>${pluralizar(g.n, 'entrega cercana', 'entregas cercanas')}${g.comunas.length ? ` · ${g.comunas.join(', ')}` : ''}</h2>
      ${g.despachos_evitables != null && g.despachos_evitables > 0 ? html`<span class="insignia ok">Se evita${g.despachos_evitables === 1 ? '' : 'n'} ${pluralizar(g.despachos_evitables, 'despacho', 'despachos')}</span>` : g.despachos_evitables == null ? html`<span class="insignia aviso">Falta información</span>` : html`<span class="insignia">No ahorra viajes</span>`}</div>
    <div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Cliente</th><th>Comuna</th><th>Productos</th><th class="der">Unidades</th><th class="der">Peso</th></tr></thead><tbody>
      ${g.entregas.map((e) => html`<tr><td><b>${e.cliente}</b></td><td>${e.comuna ?? '—'}</td><td>${e.productos.length ? e.productos.join(', ') : html`<span class="tenue">Sin productos</span>`}</td><td class="der">${num0(e.unidades)}</td><td class="der">${e.peso_kg != null ? `${num1(e.peso_kg)} kg` : html`<span class="tenue">—</span>`}</td></tr>`)}</tbody></table></div>
    <div class="card-cuerpo">
      <div class="fila" style="gap:8px;margin-bottom:10px">${g.vehiculos.map((o) => o.calculable
        ? html`<span class="insignia ${o.cabe ? 'ok' : 'error'}">${o.nombre}: ${o.cabe ? `caben · ${pct(o.ocupacion_volumen_pct)} del espacio` : `no caben por ${o.limitante === 'peso' ? 'peso' : 'espacio'}`}</span>`
        : html`<span class="insignia aviso">${o.nombre}: faltan medidas</span>`)}</div>
      ${juntas ? html`<p style="margin:0 0 4px"><b>Conviene llevarlas juntas en ${sug.nombre}.</b> Ocupa ${pct(sug.ocupacion_volumen_pct)} del espacio${sug.peso_pct != null ? ` y ${pct(sug.peso_pct)} del peso` : ''}.</p>`
        : sug?.despachos ? html`<p style="margin:0 0 4px"><b>No caben todas juntas.</b> Con ${sug.nombre} se pueden llevar en ${pluralizar(sug.despachos, 'despacho', 'despachos')} en vez de ${g.n}.</p>`
        : html`<p class="muted" style="margin:0 0 4px">Con los datos actuales no se puede decidir. Completa las medidas que faltan.</p>`}
      ${g.ahorro_estimado != null && g.ahorro_estimado > 0 ? html`<p style="margin:0 0 4px">Ahorro aproximado: <b>${clp(g.ahorro_estimado)}</b> frente a visitarlas por separado desde la base.</p>` : ''}
      <p class="muted" style="font-size:12.5px;margin:0 0 10px">${g.nota_ahorro}</p>
      <div class="fila"><a class="btn btn-primario" href="#/rutas?tab=nueva&entregas=${ids}">Armar despacho con estas entregas</a><a class="btn" href="#/cubicaje?tab=calculadora&entregas=${ids}${sug ? `&vehiculo=${sug.vehicle_id}` : ''}">Ver cómo se acomodan</a></div>
    </div></article>`;
}

function tarjetaUnProducto(x) {
  return html`<article class="card"><div class="card-cuerpo">
    <div class="fila entre"><div><b>${x.entrega.cliente}</b> <span class="muted">· ${x.entrega.comuna ?? 'sin comuna'} · ${x.entrega.productos.join(', ')} (${pluralizar(x.entrega.unidades, 'unidad', 'unidades')})</span></div></div>
    <table class="tabla-compacta" style="margin-top:8px"><thead><tr><th>Despacho planificado</th><th>Vehículo</th><th class="der">Distancia</th><th>Espacio</th></tr></thead><tbody>
      ${x.despachos.map((d) => html`<tr><td><a href="#/rutas?tab=despachos&trip=${d.trip_id}">Despacho #${d.trip_id}</a> · ${d.fecha}</td><td>${d.vehiculo}</td><td class="der">${num1(d.distancia_km)} km</td>
        <td>${!d.calculable ? html`<span class="insignia aviso">Faltan medidas</span>` : d.cabe ? html`<span class="insignia ok">Cabe · ${pct(d.ocupacion_volumen_pct)} del espacio</span>` : html`<span class="insignia error">No cabe</span>`}</td></tr>`)}</tbody></table></div></article>`;
}
