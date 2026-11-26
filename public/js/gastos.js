// Registro de gastos reales de los vehículos (mantención, neumáticos, seguros, permisos…). Se usa en Control de costos y en Vehículos.
import { html, raw, post, put, del, modal, campo, opciones, toast, falla, confirmar, hoy, nombreVehiculo } from './lib.js';

/** Abre el formulario de un gasto. `alGuardar` se llama cuando quedó guardado. */
export function formularioGasto({ meta, vehiculos, gasto = null, vehicle_id = null, categoria = null, alGuardar }) {
  const grupos = [['mantencion', 'Mantención y reparaciones'], ['desgaste', 'Desgaste'], ['fijo', 'Seguros, permisos y revisiones'], ['otro', 'Otros']];
  const opcCat = html`${grupos.map(([g, t]) => html`<optgroup label="${t}">${meta.categorias_gasto.filter((c) => c.grupo === g).map((c) => html`<option value="${c.id}" ${c.id === (gasto?.categoria ?? categoria ?? 'mantencion_preventiva') ? raw('selected') : ''}>${c.nombre}</option>`)}</optgroup>`)}`;
  const m = modal({
    titulo: gasto ? 'Editar gasto' : 'Registrar gasto', ancho: 640,
    cuerpo: html`<form class="form-grid" id="fg">
      ${campo('vehicle_id', 'Vehículo', null, { options: opciones(vehiculos, gasto?.vehicle_id ?? vehicle_id ?? '', { vacio: 'Ninguno en particular', valor: (v) => v.id, texto: nombreVehiculo }) })}
      ${campo('fecha', 'Fecha del gasto', gasto?.fecha ?? hoy(), { type: 'date', required: true })}
      ${campo('categoria', 'Tipo de gasto', null, { options: opcCat })}
      ${campo('monto', 'Monto', gasto?.monto, { type: 'number', min: 1, prefix: '$', required: true })}
      ${campo('km_odometro', 'Kilometraje del tablero', gasto?.km_odometro, { type: 'number', min: 0, unit: 'km', help: 'Opcional. Si es mayor al actual, actualiza el odómetro del vehículo.' })}
      <div id="campo-prox">${campo('proximo_km', 'Próxima mantención a los', gasto?.proximo_km, { type: 'number', min: 0, unit: 'km', help: 'Con esto el sistema avisa cuándo toca la siguiente.' })}</div>
      ${campo('proveedor', 'Taller o proveedor', gasto?.proveedor)}
      ${campo('detalle', 'Detalle', gasto?.detalle, { type: 'textarea', cls: 'ancho', rows: 2 })}</form>`,
    acciones: [{ texto: 'Cancelar', cerrar: true }, {
      texto: gasto ? 'Guardar cambios' : 'Registrar gasto', clase: 'btn-primario',
      accion: async (mm) => {
        const d = mm.datos();
        const body = { ...d, vehicle_id: d.vehicle_id || null, km_odometro: d.km_odometro || null, proximo_km: d.categoria === 'mantencion_preventiva' ? d.proximo_km || null : null };
        gasto ? await put(`/gastos/${gasto.id}`, { ...body, version: gasto.version }) : await post('/gastos', body);
        mm.cerrar(); toast(gasto ? 'Gasto actualizado' : 'Gasto registrado'); alGuardar?.();
      },
    }],
  });
  const fg = m.el.querySelector('#fg');
  const sincronizar = () => { m.el.querySelector('#campo-prox').hidden = fg.elements.categoria.value !== 'mantencion_preventiva'; };
  fg.elements.categoria.addEventListener('change', sincronizar);
  sincronizar();
}

export async function borrarGasto(g, alBorrar) {
  if (!await confirmar({ titulo: 'Eliminar gasto', mensaje: `Se eliminará el gasto de ${g.categoria_nombre ?? g.categoria}.`, textoOk: 'Eliminar', peligro: true })) return;
  try { await del(`/gastos/${g.id}`); toast('Gasto eliminado'); alBorrar?.(); } catch (e) { falla(e); }
}
