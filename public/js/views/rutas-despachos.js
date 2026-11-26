// Despachos: listado, seguimiento (tiempos y resultado de cada entrega) y la ruta lista para el conductor.
import { html, pintar, get, post, put, del, qs, clp, kmTxt, duracion, num0, num1, fecha, mañana, toast, falla, modal, confirmar, campo, opciones, insigniaEstado, vacio, alHacer, pluralizar, lineaRuta, descargar } from '../lib.js';
import { kpi, insigniaSeguridad } from '../componentes.js';
import { crearMapa, marcador, pin, dibujarRuta, ajustar, COLORES_RUTA } from '../maps.js';
import { tarjetaTiempos, activarTiempos } from '../tiempos-despacho.js';

const ESTADOS = [['', 'Todos los estados'], ['planificado', 'Planificados'], ['en_ruta', 'En ruta'], ['completado', 'Completados'], ['cancelado', 'Cancelados']];
const MOTIVOS = ['Cliente ausente', 'Dirección no encontrada', 'Rechazó el pedido', 'Sin tiempo en la ruta', 'Falta de stock', 'Sector inseguro'];

export async function pintarDespachos(ctx, root) {
  const tripId = Number(ctx.params.get('trip')) || null;
  if (tripId) return detalle(ctx, root, tripId);
  return listado(ctx, root);
}

// ---------- Listado ----------
async function listado(ctx, root) {
  const { navegar } = ctx;
  const planifica = ctx.estado.usuario?.rol !== 'bodega'; // bodega no crea rutas
  const f = { desde: '', hasta: '', vehicle_id: '', estado: '' };
  const vehiculos = await get('/vehiculos');
  pintar(root, html`
    <div class="fila entre" style="margin-bottom:12px"><p class="muted" style="margin:0;max-width:70ch">Cada despacho guardado con su ruta, kilómetros, costo y resultado. Ábrelo para registrar los tiempos, marcar las entregas y enviarle la ruta al conductor.</p>
      ${planifica ? html`<div class="acciones"><a class="btn btn-primario" href="#/rutas?tab=nueva">Nueva ruta</a></div>` : ''}</div>
    <div class="card"><div class="card-cuerpo fila" style="border-bottom:1px solid var(--linea)">
      <label class="fila" style="gap:6px">Desde <input type="date" id="desde" style="width:auto"></label><label class="fila" style="gap:6px">Hasta <input type="date" id="hasta" style="width:auto"></label>
      <select id="veh" style="max-width:220px" aria-label="Vehículo">${opciones(vehiculos, '', { vacio: 'Todos los vehículos', valor: (v) => v.id, texto: (v) => `${v.marca} ${v.modelo}` })}</select>
      <select id="est" style="max-width:200px" aria-label="Estado">${opciones(ESTADOS, '', { valor: (x) => x[0], texto: (x) => x[1] })}</select><span class="espacio"></span><span class="muted" id="cuenta"></span></div>
      <div id="tabla"><div class="cargando"><span class="spinner"></span></div></div></div>`);
  const tabla = root.querySelector('#tabla');

  async function cargar() {
    const filas = await get(`/despachos${qs(f)}`);
    root.querySelector('#cuenta').textContent = pluralizar(filas.length, 'despacho', 'despachos');
    if (!filas.length) {
      return pintar(tabla, vacio(Object.values(f).some(Boolean) ? 'No hay despachos con esos filtros' : 'Aún no hay despachos guardados',
        planifica ? 'Los despachos se guardan desde Nueva ruta, después de comparar las alternativas.' : 'Cuando el planificador guarde un despacho, aparecerá aquí.',
        planifica ? html`<a class="btn btn-primario" href="#/rutas?tab=nueva">Planificar una ruta</a>` : ''));
    }
    const validos = filas.filter((t) => t.estado !== 'cancelado');
    const s = (k) => validos.reduce((a, t) => a + (t[k] ?? 0), 0);
    pintar(tabla, html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>N°</th><th>Fecha</th><th>Vehículo</th><th>Conductor</th><th>Bodega</th><th class="der">Paradas</th><th class="der">Distancia</th><th class="der">Tiempo</th><th class="der">Total</th><th class="der">$/km</th><th class="der">$/cliente</th><th class="der">Ahorro</th><th>Estado</th></tr></thead><tbody>
      ${filas.map((t) => html`<tr class="clic" data-trip="${t.id}"><td><b>${t.id}</b></td><td class="nowrap">${fecha(t.fecha)}${t.hora_salida ? html`<span class="sub-cel">sale ${t.hora_salida}</span>` : ''}</td><td>${t.marca} ${t.modelo}</td><td>${t.conductor ?? html`<span class="tenue">Sin asignar</span>`}</td><td>${t.preparador ?? html`<span class="tenue">—</span>`}</td><td class="der">${t.n_paradas}</td><td class="der">${kmTxt(t.distancia_km)}</td><td class="der">${duracion(t.tiempo_min)}</td>
        <td class="der"><b>${clp(t.costo_total)}</b></td><td class="der">${clp(t.costo_km)}</td><td class="der">${clp(t.costo_cliente)}</td><td class="der">${t.ahorro > 0 ? html`<span style="color:var(--ok);font-weight:600">${clp(t.ahorro)}</span>` : '—'}</td><td>${insigniaEstado(t.estado)}</td></tr>`)}</tbody>
      <tfoot><tr><td colspan="5">Total (sin cancelados)</td><td class="der">${num0(s('n_paradas'))}</td><td class="der">${kmTxt(s('distancia_km'))}</td><td class="der">${duracion(s('tiempo_min'))}</td><td class="der">${clp(s('costo_total'))}</td><td class="der">${s('distancia_km') ? clp(s('costo_total') / s('distancia_km')) : '—'}</td><td class="der">${s('n_paradas') ? clp(s('costo_total') / s('n_paradas')) : '—'}</td><td class="der">${clp(s('ahorro'))}</td><td></td></tr></tfoot></table></div>`);
  }
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'desde') f.desde = t.value; else if (t.id === 'hasta') f.hasta = t.value; else if (t.id === 'veh') f.vehicle_id = t.value; else if (t.id === 'est') f.estado = t.value; else return;
    cargar().catch(falla);
  });
  alHacer(root, 'click', '[data-trip]', (e, tr) => navegar(`#/rutas?tab=despachos&trip=${tr.dataset.trip}`));
  await cargar();
}

// ---------- Ruta para el conductor ----------
function tarjetaConductor(info, max, meta) {
  const url = info.whatsapp_url;
  return html`<div class="card" id="ruta-conductor" style="margin-bottom:16px"><div class="card-cab"><h2>Ruta para el conductor</h2><span class="sub">Recorrido ordenado en Google Maps, listo para enviar</span></div>
    <div class="card-cuerpo apilar">
      ${info.avisos.map((a) => html`<div class="aviso ambar" style="margin:0"><p>${a}</p></div>`)}
      ${info.seguridad.alertas.length ? html`<div class="aviso ${info.seguridad.nivel_max === 'alto_riesgo' ? 'rojo' : 'ambar'}" style="margin:0"><h3>Precauciones del recorrido</h3><ul>${info.seguridad.alertas.map((a) => html`<li><b>${a.comuna}</b> ${insigniaSeguridad(a.nivel, meta)}${a.horario_recomendado ? ` · conviene ${a.horario_recomendado}` : ''}${a.observaciones ? ` · ${a.observaciones}` : ''}</li>`)}</ul></div>` : ''}
      ${info.enlaces.length ? html`
        <div class="fila" style="gap:14px"><span class="muted">Abrir en:</span>
          <div class="segmentado" role="group" aria-label="Dónde se abrirá el enlace"><button type="button" data-max="9" aria-pressed="${max === 9}">Computador, tablet o app de Google Maps</button><button type="button" data-max="3" aria-pressed="${max === 3}">Navegador del celular</button></div></div>
        <p class="muted" style="font-size:13px;margin:0">Google Maps admite ${max} paradas intermedias por enlace${max === 3 ? ' en el navegador del celular' : ''}; por eso el recorrido se parte en ${pluralizar(info.enlaces.length, 'tramo', 'tramos')} que se encadenan.</p>
        <div class="apilar" style="gap:8px">${info.enlaces.map((e) => html`<div class="fila entre" style="border:1px solid var(--linea);border-radius:var(--radio);padding:8px 12px"><span><b>${info.enlaces.length > 1 ? `Tramo ${e.tramo}` : 'Recorrido completo'}</b> · ${pluralizar(e.paradas.length, 'parada', 'paradas')}: ${e.paradas.map((p) => p.nombre).join(' → ')}</span><a class="btn btn-chico btn-primario" href="${e.url}" target="_blank" rel="noopener">Abrir en Google Maps</a></div>`)}</div>`
        : html`<p class="muted" style="margin:0">No hay paradas con ubicación para armar el enlace.</p>`}
      <div class="fila"><a class="btn" href="${url}" target="_blank" rel="noopener">Enviar por WhatsApp${info.conductor ? ` a ${info.conductor}` : ''}</a><button class="btn" type="button" data-copiar>Copiar mensaje</button><button class="btn" type="button" data-pdf>Descargar hoja de ruta (PDF)</button></div>
      ${info.whatsapp_numero ? '' : html`<p class="muted" style="font-size:13px;margin:0">${info.conductor ? `${info.conductor} no tiene teléfono registrado` : 'El despacho no tiene conductor'}: WhatsApp te dejará elegir a quién enviarlo. Registra el teléfono en Configuración → Personal para que se envíe directo.</p>`}
      <details><summary style="cursor:pointer" class="muted">Ver el mensaje que se envía</summary><pre style="white-space:pre-wrap;font:inherit;background:var(--papel);padding:10px 12px;border-radius:var(--radio);margin:8px 0 0">${info.texto}</pre></details>
    </div></div>`;
}

// ---------- Detalle de un despacho ----------
async function detalle(ctx, root, id) {
  const { navegar } = ctx;
  let t;
  let tiempos;
  let personal;
  let ruta;
  let max = 9;
  try { [t, tiempos, personal, ruta] = await Promise.all([get(`/despachos/${id}`), get(`/despachos/${id}/tiempos`), get('/personal'), get(`/despachos/${id}/ruta-conductor?max=${max}`)]); } catch (e) {
    pintar(root, html`<div class="aviso rojo"><h3>No se encontró el despacho</h3><p>${e.message}</p><a class="btn" href="#/rutas?tab=despachos">Volver a despachos</a></div>`);
    return;
  }
  const plan = t.plan ?? {};
  const color = t.alternativa && COLORES_RUTA[t.alternativa] ? COLORES_RUTA[t.alternativa] : COLORES_RUTA.MANUAL;
  const clase = { A: 'ruta-a', B: 'ruta-b', C: 'ruta-c', D: 'ruta-d' }[t.alternativa] ?? 'ruta-manual';
  const abierto = !['completado', 'cancelado'].includes(t.estado);
  const gastosReales = (t.peajes ?? 0) + (t.estacionamientos ?? 0) + (t.otros_gastos ?? 0);
  const base = t.baseline_total;
  const cub = t.cubicaje;
  const entregadas = t.paradas.filter((p) => p.resultado === 'entregada').length;
  const noEntregadas = t.paradas.filter((p) => p.resultado === 'no_entregada');
  const resultadoTxt = (p) => (p.resultado === 'entregada' ? html`<span class="insignia ok">Entregada</span>` : p.resultado === 'no_entregada' ? html`<span class="insignia error">No entregada</span>${p.motivo_no_entrega ? html`<div class="muted" style="font-size:12.5px">${p.motivo_no_entrega}</div>` : ''}` : html`<span class="tenue">—</span>`);

  pintar(root, html`<div class="pagina-cab"><div><a href="#/rutas?tab=despachos" class="btn btn-texto btn-chico" style="margin-left:-6px">← Despachos</a><h2 style="font-size:22px;margin-top:4px">Despacho N° ${t.id} · ${fecha(t.fecha)} ${insigniaEstado(t.estado)}</h2>
    <p>${t.marca} ${t.modelo}${t.conductor ? ` · conductor ${t.conductor}` : ' · sin conductor'}${t.preparador ? ` · prepara ${t.preparador}` : ''}${t.hora_salida ? ` · sale ${t.hora_salida}` : ''}${t.alternativa && t.alternativa !== 'manual' ? ` · ruta ${t.alternativa}` : ' · orden de selección'} <button class="btn btn-texto btn-chico" data-personal>Cambiar personal</button></p></div>
    <div class="acciones">
      ${t.estado === 'planificado' ? html`<button class="btn" data-estado="en_ruta">Iniciar ruta</button>` : ''}${abierto ? html`<button class="btn btn-primario" data-completar>Cerrar despacho</button><button class="btn" data-gastos>Registrar gastos reales</button><button class="btn btn-peligro" data-cancelar>Cancelar despacho</button>` : ''}
      ${t.estado !== 'completado' ? html`<button class="btn btn-peligro" data-borrar>Eliminar</button>` : ''}</div></div>
    <dl class="kpis kpis-3" style="margin-bottom:16px">${kpi('Costo total', clp(t.costo_total), { detalle: `Combustible ${clp(t.costo_combustible)} · desgaste ${clp(t.costo_desgaste)} · otros ${clp(t.costo_otros)}` })}${kpi('Distancia', num1(t.distancia_km), { unidad: 'km', detalle: t.retorna_base ? 'Incluye el regreso a la base' : 'Sin regreso a la base' })}
      ${kpi('Tiempo total', duracion(t.tiempo_min))}${kpi('Costo por km', clp(t.costo_km))}${kpi('Costo por cliente', clp(t.costo_cliente), { detalle: pluralizar(t.n_paradas, 'parada', 'paradas') })}
      ${kpi('Carga', cub?.calculable ? `${num0(cub.ocupacion_volumen_pct ?? 0)}%` : t.peso_kg != null ? num1(t.peso_kg) : null, { unidad: cub?.calculable ? 'del volumen' : t.peso_kg != null ? 'kg' : '', detalle: cub?.calculable ? `${cub.cabe ? 'Cabe en el vehículo' : 'No cabe en el vehículo'}${cub.peso_pct != null ? ` · ${num0(cub.peso_pct)}% del peso` : ''}` : cub?.faltan?.length ? `Cubicaje sin calcular: ${cub.faltan[0]}` : '', vacio: 'Sin pesos registrados' })}</dl>
    ${t.estado === 'completado' && t.paradas.some((p) => p.resultado) ? html`<div class="aviso ${noEntregadas.length ? 'ambar' : 'verde'}" style="margin-bottom:16px"><p style="margin:0"><b>${entregadas} de ${entregadas + noEntregadas.length} entregas cumplidas</b>${noEntregadas.length ? ` · quedaron reprogramadas: ${noEntregadas.map((p) => p.nombre).join(', ')}` : ''}</p></div>` : ''}
    ${t.estado !== 'cancelado' ? html`<div id="bloque-conductor">${tarjetaConductor(ruta, max, ctx.estado.meta)}</div>` : ''}
    ${t.estado !== 'cancelado' ? tarjetaTiempos(tiempos) : ''}
    <div class="grid g-main" style="align-items:start"><div class="apilar">
      <div class="card"><div class="card-cab"><h2>Recorrido</h2><span class="sub">${t.precio_combustible != null ? `Combustible a ${clp(t.precio_combustible)}/L al guardar` : ''}</span></div><div class="card-cuerpo">${lineaRuta({ clase, base: t.deposito.direccion, paradas: t.paradas.map((p) => ({ ...p, ventana: p.ventana_desde ? `${p.ventana_desde}${p.ventana_hasta ? `–${p.ventana_hasta}` : ''}` : null })), retorno: plan.retorno ?? null })}</div></div>
      ${t.paradas.some((p) => p.items?.length || p.resultado) ? html`<div class="card"><div class="card-cab"><h2>Productos y resultado</h2></div><div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Cliente</th><th>Productos</th><th>Resultado</th><th class="der">Costo asignado</th></tr></thead><tbody>${t.paradas.map((p) => html`<tr><td>${p.nombre}</td><td>${p.items.map((i) => `${num0(i.cantidad)} × ${i.producto ?? i.descripcion}`).join(', ') || '—'}</td><td>${resultadoTxt(p)}</td><td class="der">${clp(p.costo_asignado)}</td></tr>`)}</tbody></table></div></div>` : ''}</div>
      <div class="apilar"><div class="card"><div class="card-cab"><h2>Mapa</h2></div><div class="mapa-caja" id="mapa-trip" style="height:340px;border-radius:0 0 6px 6px"></div></div>
        ${t.alternativa && t.alternativa !== 'manual' && base != null ? html`<div class="card"><div class="card-cab"><h2>Tradicional vs. optimizada</h2></div><table class="tabla-compacta"><thead><tr><th></th><th class="der">Tradicional</th><th class="der">Ruta ${t.alternativa}</th></tr></thead><tbody>
          <tr><td>Distancia</td><td class="der">${kmTxt(t.baseline_km)}</td><td class="der">${kmTxt(t.distancia_km)}</td></tr>${plan.baseline ? html`<tr><td>Combustible</td><td class="der">${clp(plan.baseline.combustible)}</td><td class="der">${clp(t.costo_combustible)}</td></tr><tr><td>Desgaste</td><td class="der">${clp(plan.baseline.desgaste)}</td><td class="der">${clp(t.costo_desgaste)}</td></tr><tr><td>Otros</td><td class="der">${clp(plan.baseline.otros)}</td><td class="der">${clp(t.costo_otros)}</td></tr>` : ''}
          </tbody><tfoot><tr><td>Total</td><td class="der">${clp(base)}</td><td class="der">${clp(t.costo_total)}</td></tr><tr><td>Ahorro</td><td></td><td class="der" style="color:var(--ok)">${clp(t.ahorro)}</td></tr></tfoot></table></div>` : ''}
        ${plan.alternativas?.length ? html`<div class="card"><div class="card-cab"><h2>Alternativas evaluadas</h2></div><table class="tabla-compacta"><thead><tr><th>Ruta</th><th class="der">Km</th><th class="der">Tiempo</th><th class="der">Costo</th></tr></thead><tbody>${plan.alternativas.map((a) => html`<tr><td><span class="tag-ruta" style="--c:${COLORES_RUTA[a.codigo]};width:22px;height:22px;font-size:14px">${a.codigo}</span>${a.codigo === plan.recomendada ? html` <span class="insignia recomendada">Recomendada</span>` : ''}${a.codigo === t.alternativa ? html` <span class="insignia info">Elegida</span>` : ''}</td><td class="der">${num1(a.km)}</td><td class="der">${duracion(a.minTotal)}</td><td class="der">${clp(a.total)}</td></tr>`)}</tbody></table></div>` : ''}
        ${gastosReales > 0 ? html`<div class="card"><div class="card-cab"><h2>Gastos registrados</h2></div><table class="tabla-compacta"><tbody><tr><td>Peajes</td><td class="der">${clp(t.peajes)}</td></tr><tr><td>Estacionamientos</td><td class="der">${clp(t.estacionamientos)}</td></tr><tr><td>Otros</td><td class="der">${clp(t.otros_gastos)}</td></tr></tbody></table></div>` : ''}
        ${t.notas ? html`<div class="card"><div class="card-cuerpo"><b>Notas</b><p class="muted">${t.notas}</p></div></div>` : ''}</div></div>`);

  if (t.estado !== 'cancelado') activarTiempos(root.querySelector('#tiempos-card'), t.id, tiempos);
  crearMapa(root.querySelector('#mapa-trip'), { settings: ctx.estado.settings }).then((mapa) => {
    if (!mapa) return;
    const dep = t.deposito;
    const pts = t.paradas.filter((p) => p.lat != null);
    const todos = dep.lat != null ? [dep, ...pts] : pts;
    dibujarRuta(mapa, { polyline: t.polyline, puntos: t.retorna_base ? [...todos, ...(dep.lat != null ? [dep] : [])] : todos, color, grosor: 5 });
    if (dep.lat != null) marcador(mapa, dep, pin({ texto: 'B', clase: 'base' }), { titulo: 'Base', z: 5 });
    pts.forEach((p, i) => marcador(mapa, p, pin({ texto: String(i + 1), color }), { titulo: `${i + 1}. ${p.nombre}`, z: 4 }));
    ajustar(mapa, todos);
  });

  const recargar = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  // Ruta del conductor: cambiar cuántas paradas lleva cada enlace y compartir
  alHacer(root, 'click', '[data-max]', async (e, b) => {
    max = Number(b.dataset.max);
    try { ruta = await get(`/despachos/${t.id}/ruta-conductor?max=${max}`); pintar(root.querySelector('#bloque-conductor'), tarjetaConductor(ruta, max, ctx.estado.meta)); } catch (er) { falla(er); }
  });
  alHacer(root, 'click', '[data-copiar]', async () => {
    try { await navigator.clipboard.writeText(ruta.texto); toast('Mensaje copiado. Pégalo en WhatsApp, correo o donde prefieras.'); } catch { toast('No se pudo copiar automáticamente. Abre “Ver el mensaje que se envía” y cópialo a mano.', 'aviso'); }
  });
  alHacer(root, 'click', '[data-pdf]', () => descargar(`/api/reportes/despacho/${t.id}.pdf`));

  alHacer(root, 'click', '[data-estado]', async (e, b) => { await post(`/despachos/${t.id}/estado`, { estado: b.dataset.estado }).then(() => { toast('Despacho en ruta'); recargar(); }).catch(falla); });
  alHacer(root, 'click', '[data-cancelar]', async () => {
    if (!await confirmar({ titulo: 'Cancelar despacho', mensaje: 'Las entregas vuelven a quedar pendientes y el despacho queda como cancelado.', textoOk: 'Cancelar despacho', peligro: true })) return;
    await post(`/despachos/${t.id}/estado`, { estado: 'cancelado' }).then(() => { toast('Despacho cancelado', 'aviso'); recargar(); }).catch(falla);
  });
  alHacer(root, 'click', '[data-borrar]', async () => {
    if (!await confirmar({ titulo: 'Eliminar despacho', mensaje: 'Se borra el despacho y sus entregas vuelven a quedar pendientes. Esta acción no se puede deshacer.', textoOk: 'Eliminar', peligro: true })) return;
    await del(`/despachos/${t.id}`).then(() => { toast('Despacho eliminado'); navegar('#/rutas?tab=despachos'); }).catch(falla);
  });
  alHacer(root, 'click', '[data-personal]', () => {
    const de = (rol) => personal.filter((p) => (p.rol ?? 'conductor') === rol);
    modal({ titulo: 'Personal del despacho', ancho: 500,
      cuerpo: html`<p class="muted">Con esto se calculan los indicadores de cada trabajador y se arma el mensaje para el conductor.</p><form class="apilar">
        ${campo('driver_id', 'Conductor', null, { options: opciones(de('conductor'), t.driver_id ?? '', { vacio: 'Sin asignar', valor: (p) => p.id, texto: (p) => p.nombre }) })}
        ${campo('preparador_id', 'Prepara el pedido (bodega)', null, { options: opciones(de('preparador'), t.preparador_id ?? '', { vacio: 'Sin asignar', valor: (p) => p.id, texto: (p) => p.nombre }) })}</form>
        ${de('preparador').length ? '' : html`<p class="muted" style="font-size:13px">Aún no hay personal de bodega. Agrégalo en Configuración → Personal.</p>`}`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Guardar', clase: 'btn-primario', accion: async (m) => { await put(`/despachos/${t.id}/personal`, m.datos()); m.cerrar(); toast('Personal actualizado'); recargar(); } }] });
  });
  alHacer(root, 'click', '[data-gastos]', () => modal({ titulo: 'Gastos reales del despacho', ancho: 480,
    cuerpo: html`<p class="muted">Registra lo que realmente se gastó. Reemplaza lo anterior y actualiza el costo total.</p><form class="form-grid">${campo('peajes', 'Peajes', t.peajes ?? 0, { type: 'number', prefix: '$', min: 0 })}${campo('estacionamientos', 'Estacionamientos', t.estacionamientos ?? 0, { type: 'number', prefix: '$', min: 0 })}${campo('otros_gastos', 'Otros gastos', t.otros_gastos ?? 0, { type: 'number', prefix: '$', min: 0 })}</form>`,
    acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Guardar gastos', clase: 'btn-primario', accion: async (m) => { await post(`/despachos/${t.id}/gastos`, m.datos()); m.cerrar(); toast('Gastos actualizados'); recargar(); } }] }));

  // Cerrar el despacho: resultado de cada entrega
  alHacer(root, 'click', '[data-completar]', () => {
    const conEntrega = t.paradas.filter((p) => p.delivery_id);
    const m = modal({ titulo: 'Cerrar despacho', ancho: 720,
      cuerpo: html`<p class="muted">Marca el resultado de cada parada. Las no entregadas quedan reprogramadas con el motivo que indiques; los kilómetros se suman al kilometraje del vehículo. Este resultado alimenta el indicador de cumplimiento de entregas.</p>
        <datalist id="motivos">${MOTIVOS.map((x) => html`<option value="${x}">`)}</datalist>
        <table class="tabla-compacta"><thead><tr><th>Cliente</th><th>Resultado</th><th>Motivo si no se entregó</th></tr></thead><tbody>${conEntrega.map((p) => html`<tr data-entrega="${p.delivery_id}"><td><b>${p.nombre}</b><div class="muted" style="font-size:12.5px">${p.comuna ?? ''}</div></td>
          <td><select data-res aria-label="Resultado en ${p.nombre}"><option value="entregada">Entregada</option><option value="no_entregada">No entregada</option></select></td><td><input type="text" data-mot list="motivos" placeholder="Ej.: cliente ausente" disabled></td></tr>`)}</tbody></table>
        ${conEntrega.length < t.paradas.length ? html`<p class="muted" style="font-size:13px">Las paradas sin entrega registrada se dan por entregadas.</p>` : ''}
        <form id="comp" class="form-grid" style="margin-top:8px"><div class="campo ancho" id="caja-fecha" hidden><label for="f-nueva_fecha">Nueva fecha para las no entregadas</label><input type="date" name="nueva_fecha" id="f-nueva_fecha" value="${mañana()}"></div></form>`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Cerrar despacho', clase: 'btn-primario', accion: async (mm) => {
        const filas = [...mm.el.querySelectorAll('tr[data-entrega]')];
        const no = filas.filter((tr) => tr.querySelector('[data-res]').value === 'no_entregada');
        const motivos = Object.fromEntries(no.map((tr) => [tr.dataset.entrega, tr.querySelector('[data-mot]').value.trim()]));
        const d = mm.datos();
        await post(`/despachos/${t.id}/estado`, { estado: 'completado', no_entregadas: no.map((tr) => Number(tr.dataset.entrega)), motivos, nueva_fecha: d.nueva_fecha });
        mm.cerrar(); toast('Despacho cerrado'); recargar();
      } }] });
    m.el.addEventListener('change', (e) => {
      if (!e.target.matches('[data-res]')) return;
      const tr = e.target.closest('tr');
      tr.querySelector('[data-mot]').disabled = e.target.value !== 'no_entregada';
      m.el.querySelector('#caja-fecha').hidden = ![...m.el.querySelectorAll('[data-res]')].some((sel) => sel.value === 'no_entregada');
    });
  });
}
