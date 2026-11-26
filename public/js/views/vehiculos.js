// Control de kilometraje: kilómetros por semana de cada vehículo, desgaste, mantención preventiva y estado de la flota.
import { html, pintar, get, put, del, clp, num0, num1, fecha, hoy, toast, falla, modal, confirmar, campo, opciones, vacio, alHacer, nombreVehiculo, pluralizar, graficoBarras, destruirGraficos } from '../lib.js';
import { kpi, pestanas, activarPestanas, barra, botonesExportar, activarExportar } from '../componentes.js';
import { formularioVehiculo, modalCargas } from './vehiculos-form.js';
import { formularioGasto } from '../gastos.js';

const TABS = [['flota', 'Estado de la flota'], ['km', 'Kilómetros por semana']];
const COLORES = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#b8860b', '#6b7771'];
const MANT = {
  vencida: ['error', 'Mantención vencida'], proxima: ['aviso', 'Mantención próxima'], al_dia: ['ok', 'Mantención al día'], sin_datos: ['', 'Mantención sin datos'],
};
const semanaTxt = (iso) => { const [, m, d] = iso.split('-'); return `${d}-${m}`; };

export default async function (ctx) {
  const { root, params, estado, navegar, refrescarEstado } = ctx;
  const meta = estado.meta;
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'flota';
  const [vehiculos, flota] = await Promise.all([get('/vehiculos'), get('/flota?semanas=8')]);
  const activos = vehiculos.filter((v) => v.activo);
  const porId = new Map(vehiculos.map((v) => [v.id, v]));
  const recargar = async () => { await refrescarEstado(); window.dispatchEvent(new HashChangeEvent('hashchange')); };

  destruirGraficos();
  pintar(root, html`
    <div class="pagina-cab"><div><h2 style="font-size:20px">Control de kilometraje</h2>
      <p>Anota cada semana los kilómetros de cada vehículo. Con eso el sistema calcula el costo de operación, el desgaste y cuándo toca la mantención preventiva. Si falta un dato, el indicador queda en blanco: nada se estima.</p></div>
      <div class="acciones">${botonesExportar('/api/reportes/flota', {})}<button class="btn" id="nuevo">Agregar vehículo</button><button class="btn btn-primario" id="km-nuevo" ${activos.length ? '' : 'disabled'}>Registrar km de la semana</button></div></div>
    ${flota.alertas.length ? html`<div class="aviso ${flota.alertas.some((a) => a.nivel === 'alta') ? 'rojo' : 'ambar'}" style="margin-bottom:16px"><h3>Atención en la flota</h3><ul>${flota.alertas.map((a) => html`<li><b>${a.nombre}</b>: ${a.texto}</li>`)}</ul></div>` : ''}
    ${pestanas('vehiculos', TABS, tab)}
    ${tab === 'flota' ? vistaFlota(vehiculos, flota, meta) : vistaKm(flota, flota.semana_actual)}`);

  activarPestanas(root, navegar);
  activarExportar(root);
  if (tab === 'km') graficoKm(root, flota);

  const abrirForm = (v = null) => formularioVehiculo({ meta, v, alGuardar: recargar });
  const abrirKm = (vehicleId = null, semana = null) => formularioKm({ activos, flota, vehicleId, semana, alGuardar: recargar });
  root.querySelector('#nuevo').addEventListener('click', () => abrirForm());
  root.querySelector('#km-nuevo').addEventListener('click', () => abrirKm());
  alHacer(root, 'click', '[data-nuevo]', () => abrirForm());
  alHacer(root, 'click', '[data-editar]', (e, b) => abrirForm(porId.get(Number(b.dataset.editar))));
  alHacer(root, 'click', '[data-km]', (e, b) => abrirKm(Number(b.dataset.km), b.dataset.semana || null));
  alHacer(root, 'click', '[data-cargas]', (e, b) => modalCargas({ v: porId.get(Number(b.dataset.cargas)), alCambiar: async () => { await recargar(); } }));
  alHacer(root, 'click', '[data-mantencion]', (e, b) => formularioGasto({ meta, vehiculos: activos, vehicle_id: Number(b.dataset.mantencion), categoria: 'mantencion_preventiva', alGuardar: recargar }));
  alHacer(root, 'click', '[data-borrar-km]', async (e, b) => {
    if (!(await confirmar({ titulo: 'Quitar registro', mensaje: 'Se quitará el kilometraje anotado de esa semana.', textoOk: 'Quitar', peligro: true }))) return;
    try { const fila = (await get(`/km-semanal?vehicle_id=${b.dataset.vehiculo}`)).find((k) => k.semana_inicio === b.dataset.borrarKm); if (fila) await del(`/km-semanal/${fila.id}`); toast('Registro quitado'); recargar(); } catch (er) { falla(er); }
  });
}

// ---------- Estado de la flota ----------
function vistaFlota(vehiculos, flota, meta) {
  if (!vehiculos.length) return html`<div class="card">${vacio('No hay vehículos', 'Agrega el primer vehículo de la flota con sus datos reales: rendimiento, capacidad y medidas de carga.', html`<button class="btn btn-primario" data-nuevo>Agregar vehículo</button>`)}</div>`;
  const estadoDe = new Map(flota.vehiculos.map((e) => [e.vehicle_id, e]));
  return html`<div class="apilar">${vehiculos.map((v) => {
    const e = estadoDe.get(v.id);
    const ck = v.costo_km;
    const [claseM, textoM] = MANT[e?.mantencion.estado ?? 'sin_datos'];
    return html`<article class="card">
      <div class="card-cab"><h2>${nombreVehiculo(v)}</h2>${v.activo ? '' : html`<span class="insignia">Inactivo</span>`}<span class="insignia ${claseM}">${textoM}</span>
        <div class="acciones"><button class="btn btn-chico" data-km="${v.id}" ${v.activo ? '' : 'disabled'}>Registrar km</button><button class="btn btn-chico" data-cargas="${v.id}">Cargas de combustible</button><button class="btn btn-chico" data-mantencion="${v.id}" ${v.activo ? '' : 'disabled'}>Registrar mantención</button><button class="btn btn-chico btn-primario" data-editar="${v.id}">Editar datos</button></div></div>
      <div class="card-cuerpo">
        <div class="fila" style="gap:28px;align-items:flex-start">
          <div style="min-width:210px"><div class="muted">${[v.anio, v.motor ? `motor ${v.motor}` : null, v.combustible, v.patente].filter(Boolean).join(' · ')}</div>
            <div style="margin-top:10px" class="muted">Costo real por kilómetro</div>
            <div class="num" style="font-family:var(--f-num);font-size:38px;font-weight:600;line-height:1.1">${ck.total != null ? html`${clp(ck.total)}<small style="font-size:17px;color:var(--tinta-2)">/km</small>` : html`<span class="sin-dato" style="font-size:16px">Sin calcular</span>`}</div>
            ${ck.total == null ? '' : html`<div class="muted" style="font-size:13px">Combustible ${clp(ck.combustible)} + desgaste ${clp(ck.desgaste)}</div>`}</div>
          <dl class="kpis" style="flex:1;min-width:320px;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">
            ${kpi('Odómetro', e?.odometro_km != null ? num0(e.odometro_km) : null, { unidad: 'km', detalle: e?.odometro_fuente ?? 'Anótalo en el registro semanal', vacio: 'Sin registrar' })}
            ${kpi('Esta semana', e?.km_semana_actual != null ? num0(e.km_semana_actual) : null, { unidad: 'km', detalle: e?.km_prom_semanal != null ? `Promedio ${num0(e.km_prom_semanal)} km por semana` : 'Sin semanas anteriores registradas', vacio: 'Sin registrar' })}
            ${kpi('Próxima mantención', e?.mantencion.proxima_km != null ? num0(e.mantencion.proxima_km) : e?.mantencion.proxima_fecha ? fecha(e.mantencion.proxima_fecha) : null, { unidad: e?.mantencion.proxima_km != null ? 'km' : '', detalle: e?.mantencion.restantes_km != null ? `${e.mantencion.restantes_km >= 0 ? `Faltan ${num0(e.mantencion.restantes_km)} km` : `Pasó ${num0(-e.mantencion.restantes_km)} km`}${e.mantencion.fecha_estimada ? ` · hacia el ${fecha(e.mantencion.fecha_estimada)}` : ''}` : e?.mantencion.fuente ?? 'Indica la próxima mantención al editar el vehículo', vacio: 'Sin definir' })}
            ${kpi('Neumáticos', e?.neumaticos.consumido_pct != null ? num0(e.neumaticos.consumido_pct) : null, { unidad: '% de su vida', detalle: e?.neumaticos.consumido_pct != null ? `${num0(e.neumaticos.recorridos_km)} de ${num0(e.neumaticos.vida_km)} km` : 'Registra el último cambio de neumáticos con su km', vacio: 'Sin datos' })}
            ${kpi('Vida útil del vehículo', e?.vida_util ? num0(e.vida_util.consumido_pct) : null, { unidad: '% usado', detalle: e?.vida_util ? `${num0(e.odometro_km)} de ${num0(e.vida_util.vida_km)} km` : 'Define la vida útil en km al editar', vacio: 'Sin datos' })}
            ${kpi('Consumo real medido', v.consumo_real ? num1(v.consumo_real.kmPorLitro) : null, { unidad: 'km/L', detalle: v.consumo_real ? `${pluralizar(v.consumo_real.cargas, 'carga', 'cargas')}${v.rendimiento_km_l ? ` · configurado ${num1(v.rendimiento_km_l)}` : ''}` : 'Registra al menos 2 cargas', vacio: 'Sin cargas' })}
          </dl></div>
        ${e && e.neumaticos.consumido_pct != null ? html`<div style="margin-top:12px;max-width:420px"><div class="muted" style="font-size:13px;margin-bottom:3px">Desgaste de neumáticos</div>${barra(e.neumaticos.consumido_pct, 100, { color: e.neumaticos.consumido_pct >= 90 ? 'var(--rojo)' : 'var(--serie-1)', alto: 8 })}</div>` : ''}
        ${ck.faltantes.length ? html`<div class="aviso ambar" style="margin:14px 0 0"><b>Para calcular el costo real de este vehículo falta:</b><ul>${ck.faltantes.map((f) => html`<li>${f}</li>`)}</ul></div>` : ''}
        ${v.carga_largo_cm && v.carga_ancho_cm && v.carga_alto_cm ? '' : html`<p class="muted" style="font-size:13px;margin:10px 0 0">Sin medidas del espacio de carga: no se puede calcular el cubicaje para este vehículo. <button class="btn btn-texto btn-chico" data-editar="${v.id}">Agregarlas</button></p>`}
      </div></article>`;
  })}</div>`;
}

// ---------- Kilómetros por semana ----------
function vistaKm(flota, semanaActual) {
  if (!flota.vehiculos.length) return html`<div class="card">${vacio('No hay vehículos activos', 'Agrega un vehículo para llevar su kilometraje semanal.', html`<button class="btn btn-primario" data-nuevo>Agregar vehículo</button>`)}</div>`;
  const hayRegistro = flota.vehiculos.some((e) => e.semanas.some((s) => s.km_registrado != null));
  return html`
    <div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Kilómetros recorridos por semana</h2><span class="sub">Lo que anotas del tablero, semana a semana (lunes a domingo)</span></div>
      <div class="card-cuerpo">${hayRegistro ? html`<div class="canvas-caja"><canvas id="gr-km" role="img" aria-label="Kilómetros por semana de cada vehículo"></canvas></div>` : vacio('Aún no hay kilómetros registrados', 'Cada semana anota los kilómetros recorridos de cada vehículo (y, si puedes, el odómetro). Con 2 o 3 semanas ya se proyecta la mantención.', html`<button class="btn btn-primario" data-km="${flota.vehiculos[0].vehicle_id}">Registrar km de la semana</button>`)}</div></div>
    <div class="apilar">${flota.vehiculos.map((e) => html`<div class="card"><div class="card-cab"><h2>${e.nombre}</h2><span class="sub">${e.patente ?? ''}${e.km_prom_semanal != null ? ` · promedio ${num0(e.km_prom_semanal)} km por semana (últimas ${e.semanas_con_registro})` : ''}</span></div>
      <div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Semana (lunes)</th><th class="der">Km registrados</th><th class="der">Km de despachos</th><th class="der">Despachos</th><th class="der">Paradas</th><th class="der">Odómetro</th><th class="der">Costo de operación</th><th></th></tr></thead><tbody>
        ${[...e.semanas].reverse().map((s) => html`<tr><td>${fecha(s.semana_inicio)}${s.semana_inicio === semanaActual ? html` <span class="insignia info">Esta semana</span>` : ''}${s.nota ? html`<span class="sub-cel">${s.nota}</span>` : ''}</td>
          <td class="der">${s.km_registrado != null ? html`<b>${num0(s.km_registrado)}</b>` : html`<span class="tenue">Sin registrar</span>`}</td><td class="der">${s.km_despachos ? num1(s.km_despachos) : '—'}</td><td class="der">${s.despachos || '—'}</td><td class="der">${s.paradas || '—'}</td>
          <td class="der">${s.odometro != null ? num0(s.odometro) : '—'}</td><td class="der">${s.costo_operacion != null ? clp(s.costo_operacion) : html`<span class="tenue">Sin dato</span>`}</td>
          <td class="der" style="white-space:nowrap"><button class="btn btn-texto btn-chico" data-km="${e.vehicle_id}" data-semana="${s.semana_inicio}">${s.km_registrado != null ? 'Editar' : 'Registrar'}</button>${s.km_registrado != null ? html`<button class="btn btn-texto btn-chico" data-borrar-km="${s.semana_inicio}" data-vehiculo="${e.vehicle_id}">Quitar</button>` : ''}</td></tr>`)}</tbody></table></div>
      <div class="card-cuerpo muted" style="font-size:13px;border-top:1px solid var(--linea)">“Km de despachos” son los kilómetros de rutas completadas en el sistema; “Km registrados” es lo que marcó el tablero, que incluye todo el uso del vehículo.</div></div>`)}</div>`;
}

function graficoKm(root, flota) {
  const canvas = root.querySelector('#gr-km');
  if (!canvas) return;
  const semanas = flota.vehiculos[0].semanas.map((s) => s.semana_inicio);
  graficoBarras(canvas, {
    etiquetas: semanas.map(semanaTxt), formato: (n) => `${num0(n)} km`,
    series: flota.vehiculos.map((e, i) => ({ nombre: e.nombre, datos: e.semanas.map((s) => s.km_registrado ?? 0), color: COLORES[i % COLORES.length] })),
  });
}

// ---------- Registro semanal ----------
function formularioKm({ activos, flota, vehicleId, semana, alGuardar }) {
  const e0 = flota.vehiculos.find((e) => e.vehicle_id === vehicleId) ?? flota.vehiculos[0];
  const previo = e0?.semanas.find((s) => s.semana_inicio === semana);
  modal({
    titulo: 'Kilómetros de la semana', ancho: 520,
    cuerpo: html`<p class="muted">Anota cuántos kilómetros recorrió el vehículo en la semana según el tablero. Si ya habías anotado esa semana, se reemplaza. Si indicas el odómetro, se actualiza el kilometraje del vehículo.</p>
      <form class="form-grid">
        ${campo('vehicle_id', 'Vehículo', null, { options: opciones(activos, vehicleId ?? e0?.vehicle_id, { valor: (v) => v.id, texto: (v) => nombreVehiculo(v) }), cls: 'ancho' })}
        ${campo('semana_inicio', 'Cualquier día de la semana', semana ?? hoy(), { type: 'date', required: true, help: 'Se usa la semana de lunes a domingo que contiene esa fecha.' })}
        ${campo('km', 'Km recorridos en la semana', previo?.km_registrado ?? '', { type: 'number', unit: 'km', min: 0, required: true })}
        ${campo('odometro', 'Odómetro al cierre de la semana (opcional)', previo?.odometro ?? '', { type: 'number', unit: 'km', min: 0, cls: 'ancho' })}
        ${campo('nota', 'Nota (opcional)', previo?.nota ?? '', { cls: 'ancho', placeholder: 'Ej.: semana con feriado' })}</form>`,
    acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Guardar', clase: 'btn-primario', accion: async (m) => {
      const d = m.datos();
      if (d.km === '') throw new Error('Ingresa los kilómetros de la semana.');
      await put('/km-semanal', d);
      m.cerrar(); toast('Kilómetros registrados'); await alGuardar();
    } }],
  });
}
