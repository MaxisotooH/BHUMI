// Formulario de vehículo (datos, rendimiento, espacio de carga, mantención y desgaste) y registro de cargas de combustible.
import { html, post, put, del, toast, falla, modal, confirmar, campo, opciones, clp, num0, num1, fecha, hoy, alHacer, nombreVehiculo, get } from '../lib.js';

// ---------- Formulario ----------
export function formularioVehiculo({ meta, v = null, alGuardar }) {
  const x = v ?? {};
  const num = (n, label, unit, o = {}) => campo(n, label, x[n], { type: 'number', unit, min: 0, ...o });
  const m = modal({
    titulo: v ? `Editar ${nombreVehiculo(v)}` : 'Nuevo vehículo', ancho: 900,
    cuerpo: html`<form id="fv">
      <div class="seccion-form">Identificación</div>
      <div class="form-grid">${campo('nombre', 'Nombre interno', x.nombre, { placeholder: 'Ej.: Vehículo 3' })}${campo('marca', 'Marca', x.marca, { required: true })}${campo('modelo', 'Modelo', x.modelo, { required: true })}
        ${num('anio', 'Año', null, { min: 1980, step: 1 })}${campo('motor', 'Motor', x.motor, { placeholder: 'Ej.: 1.5' })}${campo('patente', 'Patente', x.patente)}
        ${campo('combustible', 'Combustible', null, { options: opciones(meta.combustibles, x.combustible ?? 'Bencina') })}${campo('estado', 'Estado', null, { options: opciones(meta.estados_vehiculo, x.estado ?? 'activo') })}${num('km_actual', 'Kilometraje actual', 'km')}</div>
      <div class="seccion-form">Rendimiento y carga <span class="muted" style="font-weight:400">· se pueden ajustar según el estado del vehículo y la carga</span></div>
      <div class="form-grid">${num('rendimiento_km_l', 'Rendimiento de combustible', 'km/L', { help: 'Litros usados = km ÷ rendimiento' })}${num('capacidad_kg', 'Capacidad de carga', 'kg')}
        ${num('ajuste_condicion_pct', 'Pérdida por estado/condición', '%', { help: 'Vehículo antiguo, tráfico urbano, etc.', max: 90 })}${num('ajuste_carga_pct', 'Pérdida adicional a plena carga', '%', { help: 'Se aplica en proporción a la carga', max: 90 })}</div>
      <div class="seccion-form">Espacio de carga <span class="muted" style="font-weight:400">· con estas medidas se calcula cuántos productos caben</span></div>
      <div class="form-grid">${num('carga_largo_cm', 'Largo útil', 'cm')}${num('carga_ancho_cm', 'Ancho útil', 'cm')}${num('carga_alto_cm', 'Alto útil', 'cm')}</div>
      <div class="seccion-form">Mantención</div>
      <div class="form-grid">${campo('proxima_mantencion_fecha', 'Próxima mantención (fecha)', x.proxima_mantencion_fecha, { type: 'date' })}${num('proxima_mantencion_km', 'Próxima mantención (km)', 'km')}
        ${num('costo_mantencion', 'Costo de una mantención', null, { prefix: '$' })}${num('intervalo_mantencion_km', 'Cada cuántos km se hace', 'km')}</div>
      <div class="seccion-form">Neumáticos y vida útil</div>
      <div class="form-grid">${num('valor_neumaticos', 'Valor del juego de neumáticos', null, { prefix: '$' })}${num('vida_neumaticos_km', 'Vida útil de neumáticos', 'km')}
        ${num('valor_vehiculo', 'Valor estimado del vehículo', null, { prefix: '$' })}${num('valor_residual', 'Valor residual al final de su vida', null, { prefix: '$' })}${num('vida_util_km', 'Vida útil del vehículo', 'km')}${num('vida_util_anios', 'Vida útil del vehículo (en años)', 'años')}</div>
      <div class="seccion-form">Costo de desgaste por kilómetro</div>
      <p class="muted" style="font-size:13px">Si dejas un componente vacío, se calcula con los datos de arriba cuando es posible. Si escribes un valor, se usa ese valor en lugar del cálculo.</p>
      <table class="tabla-compacta"><thead><tr><th>Componente</th><th>Valor manual ($/km)</th><th class="der">Calculado</th><th>En uso</th></tr></thead><tbody>
        ${meta.componentes_desgaste.map((c) => html`<tr><td>${c.label}${c.requerido ? '' : html` <span class="tenue">(opcional)</span>`}</td>
          <td style="width:180px"><input type="number" step="any" min="0" name="costo_km_${c.key}" value="${x[`costo_km_${c.key}`] ?? ''}" aria-label="${c.label} manual"></td>
          <td class="der" data-calc="${c.key}">—</td><td data-uso="${c.key}">—</td></tr>`)}
        <tr><td><b>Total desgaste</b></td><td></td><td></td><td class="num" data-total-des><b>—</b></td></tr></tbody></table>
      ${campo('notas', 'Notas', x.notas, { type: 'textarea', cls: 'ancho' })}
    </form>`,
    acciones: [
      ...(v ? [{ texto: 'Eliminar', clase: 'btn-peligro', accion: async (mm) => { if (await confirmar({ titulo: 'Eliminar vehículo', mensaje: 'Si tiene despachos, quedará inactivo para conservar el historial. ¿Continuar?', textoOk: 'Eliminar', peligro: true })) { const r = await del(`/vehiculos/${v.id}`); mm.cerrar(); toast(r.desactivado ? 'El vehículo quedó inactivo porque tiene historial.' : 'Vehículo eliminado', r.desactivado ? 'aviso' : 'ok'); await alGuardar(); } } }] : []),
      { texto: 'Cancelar', cerrar: true },
      { texto: 'Guardar vehículo', clase: 'btn-primario', accion: async (mm) => {
        const f = mm.el.querySelector('#fv');
        if (!f.reportValidity()) return;
        const datos = mm.datos();
        v ? await put(`/vehiculos/${v.id}`, datos) : await post('/vehiculos', datos);
        mm.cerrar(); toast('Vehículo guardado'); await alGuardar();
      } },
    ],
  });
  // Vista previa de desgaste en vivo (misma regla que el servidor).
  const f = m.el.querySelector('#fv');
  const val = (n) => { const t = f.elements[n]?.value; return t === '' || t == null ? null : Number(t); };
  const razon = (a, b) => (a != null && b != null && b > 0 ? a / b : null);
  const actualizar = () => {
    const deriv = {
      neumaticos: razon(val('valor_neumaticos'), val('vida_neumaticos_km')),
      mantencion: razon(val('costo_mantencion'), val('intervalo_mantencion_km')),
      depreciacion: val('valor_vehiculo') != null && val('vida_util_km') > 0 ? Math.max(0, val('valor_vehiculo') - (val('valor_residual') ?? 0)) / val('vida_util_km') : null,
    };
    let total = 0;
    for (const c of meta.componentes_desgaste) {
      const man = val(`costo_km_${c.key}`);
      const dv = deriv[c.key] ?? null;
      const uso = man ?? dv;
      total += uso ?? 0;
      m.el.querySelector(`[data-calc="${c.key}"]`).textContent = dv != null ? clp(dv) : '—';
      m.el.querySelector(`[data-uso="${c.key}"]`).textContent = man != null ? `${clp(man)} (manual)` : dv != null ? `${clp(dv)} (calculado)` : c.requerido ? 'Falta dato' : 'No se incluye';
    }
    m.el.querySelector('[data-total-des]').innerHTML = `<b>${clp(total)}/km</b>`;
  };
  f.addEventListener('input', actualizar);
  actualizar();
}

// ---------- Cargas de combustible ----------
export async function modalCargas({ v, alCambiar }) {
  const filas = await get(`/vehiculos/${v.id}/cargas`);
  const real = v.consumo_real;
  const m = modal({
    titulo: `Cargas de combustible · ${nombreVehiculo(v)}`, ancho: 720,
    cuerpo: html`<p class="muted">Registra cada carga con el kilometraje del tablero. Con dos o más cargas el sistema calcula el rendimiento real (estanque lleno a estanque lleno) y lo compara con el configurado.</p>
      <form id="fcarga" class="form-grid" style="margin:12px 0">${campo('fecha', 'Fecha', hoy(), { type: 'date', required: true })}${campo('litros', 'Litros cargados', '', { type: 'number', unit: 'L', required: true, min: 0 })}${campo('monto', 'Monto pagado', '', { type: 'number', prefix: '$', min: 0 })}${campo('km_odometro', 'Km del tablero', '', { type: 'number', unit: 'km', required: true, min: 0 })}
        <div class="campo"><span class="etiqueta">&nbsp;</span><button type="button" class="btn btn-primario" id="add-carga">Agregar carga</button></div></form>
      ${real ? html`<div class="aviso verde">Rendimiento real medido: <b>${num1(real.kmPorLitro)} km/L</b> (${num0(real.km)} km con ${num1(real.litros)} L).${v.rendimiento_km_l ? html` Configurado: ${num1(v.rendimiento_km_l)} km/L.` : ''}</div>` : ''}
      ${filas.length ? html`<table class="tabla-compacta"><thead><tr><th>Fecha</th><th class="der">Km tablero</th><th class="der">Litros</th><th class="der">Monto</th><th class="der">$/L</th><th></th></tr></thead><tbody>
        ${filas.map((c) => html`<tr><td>${fecha(c.fecha)}</td><td class="der">${num0(c.km_odometro)}</td><td class="der">${num1(c.litros)}</td><td class="der">${c.monto != null ? clp(c.monto) : '—'}</td><td class="der">${c.monto != null ? clp(c.monto / c.litros) : '—'}</td><td class="der"><button class="btn btn-texto btn-chico" data-borrar="${c.id}">Quitar</button></td></tr>`)}</tbody></table>` : html`<p class="muted">Aún no hay cargas registradas.</p>`}`,
    acciones: [{ texto: 'Cerrar', cerrar: true }],
  });
  m.el.querySelector('#add-carga').addEventListener('click', async (e) => {
    const f = m.el.querySelector('#fcarga');
    if (!f.reportValidity()) return;
    e.target.disabled = true;
    try { await post(`/vehiculos/${v.id}/cargas`, m.datos()); m.cerrar(); toast('Carga registrada'); await alCambiar(); } catch (er) { falla(er); e.target.disabled = false; }
  });
  alHacer(m.el, 'click', '[data-borrar]', async (e, b) => { await del(`/cargas/${b.dataset.borrar}`); m.cerrar(); await alCambiar(); });
}

