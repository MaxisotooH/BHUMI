// Zonas y seguridad: evaluación de sectores (la define BHUMI, con su fuente) e incidentes registrados.
import { html, pintar, get, post, put, del, toast, falla, modal, confirmar, campo, opciones, opcionesComunas, fecha, hoy, vacio, alHacer, num0 } from '../lib.js';
import { insigniaSeguridad } from '../componentes.js';

export async function pintarZonas(ctx, cont) {
  const meta = ctx.estado.meta;
  const [sectores, incidentes, clientes] = await Promise.all([get('/zonas/sectores'), get('/zonas/incidentes'), get('/clientes')]);

  pintar(cont, html`
    <div class="aviso" style="margin-bottom:16px"><p style="margin:0">La seguridad de cada sector la evalúa BHUMI según la experiencia de sus conductores o datos oficiales (por ejemplo, Carabineros). El sistema <b>no inventa</b> esa información: cada evaluación pide su fuente, y los sectores sin evaluar quedan marcados como “Sin evaluar”. Al planificar una ruta se avisa cuando pasa por sectores con precaución o alto riesgo.</p></div>
    <div class="card" style="margin-bottom:16px"><div class="card-cab"><h2>Sectores</h2><span class="sub">Una fila por comuna evaluada</span><span class="espacio"></span><button class="btn btn-primario btn-chico" id="nuevo-sector">Evaluar un sector</button></div>
      ${sectores.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Comuna</th><th>Zona</th><th>Seguridad</th><th>Horario recomendado</th><th>Fuente</th><th class="der">Clientes</th><th class="der">Incidentes (90 días)</th><th></th></tr></thead><tbody>
        ${sectores.map((s) => html`<tr><td><b>${s.comuna}</b><span class="sub-cel">${s.region ?? ''}</span></td><td>${s.zona ?? html`<span class="tenue">—</span>`}</td><td>${insigniaSeguridad(s.seguridad, meta)}</td>
          <td>${s.horario_recomendado ?? html`<span class="tenue">—</span>`}</td><td style="max-width:260px">${s.fuente ?? html`<span class="tenue">—</span>`}${s.observaciones ? html`<span class="sub-cel">${s.observaciones}</span>` : ''}</td>
          <td class="der">${num0(s.clientes)}</td><td class="der">${s.incidentes_90d ? html`<b>${s.incidentes_90d}</b>` : '0'}</td>
          <td class="der" style="white-space:nowrap"><button class="btn btn-texto btn-chico" data-editar-sector="${s.id}" data-requiere="PUT /zonas/sectores">Editar</button><button class="btn btn-texto btn-chico" data-borrar-sector="${s.id}" data-requiere="DELETE /zonas/sectores/:id">Quitar</button></td></tr>`)}</tbody></table></div>`
        : vacio('Todavía no hay sectores evaluados', 'Agrega las comunas donde reparten e indica si son normales, con precaución o de alto riesgo, y de dónde sale esa información. También puedes agruparlas en zonas (por ejemplo, “Oriente” o “Norte”) para ver la concentración de entregas por zona.', html`<button class="btn btn-primario" data-nuevo-sector data-requiere="PUT /zonas/sectores">Evaluar un sector</button>`)}</div>

    <div class="card"><div class="card-cab"><h2>Incidentes registrados</h2><span class="sub">Robos, asaltos y accesos difíciles que han ocurrido en entregas</span><span class="espacio"></span><button class="btn btn-chico" id="nuevo-incidente" data-requiere="POST /zonas/incidentes">Registrar incidente</button></div>
      ${incidentes.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Fecha</th><th>Comuna</th><th>Tipo</th><th>Cliente</th><th>Descripción</th><th></th></tr></thead><tbody>
        ${incidentes.map((i) => html`<tr><td class="nowrap">${fecha(i.fecha)}</td><td><b>${i.comuna}</b></td><td>${i.tipo_nombre}</td><td>${i.cliente ?? html`<span class="tenue">—</span>`}</td><td>${i.descripcion ?? ''}</td>
          <td class="der"><button class="btn btn-texto btn-chico" data-borrar-inc="${i.id}" data-requiere="DELETE /zonas/incidentes/:id">Eliminar</button></td></tr>`)}</tbody></table></div>`
        : vacio('Sin incidentes registrados', 'Anota aquí lo que ocurra en la ruta. Ayuda a decidir qué sectores evaluar con precaución y en qué horario conviene entregar.')}</div>`);

  const recargar = () => window.dispatchEvent(new HashChangeEvent('hashchange'));

  function formSector(s = null) {
    modal({
      titulo: s ? `Sector ${s.comuna}` : 'Evaluar un sector', ancho: 640,
      cuerpo: html`<form class="form-grid">
        ${s ? html`<div class="campo"><label>Comuna</label><input value="${s.comuna}" disabled><input type="hidden" name="comuna" value="${s.comuna}"></div>` : campo('comuna', 'Comuna', null, { options: opcionesComunas(meta, null), required: true })}
        ${campo('zona', 'Zona (opcional)', s?.zona, { placeholder: 'Ej.: Oriente, Norte, Centro', help: 'Sirve para agrupar comunas en la concentración de entregas.' })}
        ${campo('seguridad', 'Evaluación de seguridad', null, { options: opciones(meta.niveles_seguridad, s?.seguridad ?? 'sin_evaluar', { valor: (x) => x.id, texto: (x) => x.nombre }) })}
        ${campo('horario_recomendado', 'Horario recomendado', s?.horario_recomendado, { placeholder: 'Ej.: antes de las 17:00' })}
        ${campo('fuente', 'Fuente de la evaluación', s?.fuente, { cls: 'ancho', placeholder: 'Ej.: experiencia de los conductores, reporte de Carabineros', help: 'Obligatoria cuando el sector está evaluado como normal, con precaución o alto riesgo.' })}
        ${campo('observaciones', 'Observaciones', s?.observaciones, { type: 'textarea', cls: 'ancho', rows: 2 })}</form>`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Guardar sector', clase: 'btn-primario', accion: async (m) => { await put('/zonas/sectores', m.datos()); m.cerrar(); toast('Sector guardado'); recargar(); } }],
    });
  }
  function formIncidente() {
    modal({
      titulo: 'Registrar incidente', ancho: 600,
      cuerpo: html`<form class="form-grid">
        ${campo('fecha', 'Fecha', hoy(), { type: 'date', required: true })}
        ${campo('tipo', 'Tipo', null, { options: opciones(meta.tipos_incidente, 'otro', { valor: (x) => x.id, texto: (x) => x.nombre }) })}
        ${campo('client_id', 'Cliente (opcional)', null, { options: opciones(clientes, '', { vacio: 'Sin cliente', valor: (c) => c.id, texto: (c) => `${c.nombre}${c.comuna ? ` · ${c.comuna}` : ''}` }), cls: 'ancho' })}
        ${campo('comuna', 'Comuna', null, { options: opcionesComunas(meta, null, 'Usar la del cliente'), help: 'Obligatoria si no eliges un cliente.', cls: 'ancho' })}
        ${campo('descripcion', 'Qué ocurrió', null, { type: 'textarea', cls: 'ancho', rows: 3 })}</form>`,
      acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Guardar incidente', clase: 'btn-primario', accion: async (m) => { await post('/zonas/incidentes', m.datos()); m.cerrar(); toast('Incidente registrado'); recargar(); } }],
    });
  }

  cont.querySelector('#nuevo-sector').addEventListener('click', () => formSector());
  cont.querySelector('#nuevo-incidente').addEventListener('click', formIncidente);
  alHacer(cont, 'click', '[data-nuevo-sector]', () => formSector());
  alHacer(cont, 'click', '[data-editar-sector]', (e, b) => formSector(sectores.find((s) => s.id === Number(b.dataset.editarSector))));
  alHacer(cont, 'click', '[data-borrar-sector]', async (e, b) => {
    const s = sectores.find((x) => x.id === Number(b.dataset.borrarSector));
    if (!(await confirmar({ titulo: 'Quitar sector', mensaje: `Se quitará la evaluación de ${s.comuna}. Los clientes y los incidentes no se borran.`, textoOk: 'Quitar', peligro: true }))) return;
    try { await del(`/zonas/sectores/${s.id}`); toast('Sector quitado'); recargar(); } catch (er) { falla(er); }
  });
  alHacer(cont, 'click', '[data-borrar-inc]', async (e, b) => {
    if (!(await confirmar({ titulo: 'Eliminar incidente', mensaje: 'Se eliminará este incidente del registro.', textoOk: 'Eliminar', peligro: true }))) return;
    try { await del(`/zonas/incidentes/${b.dataset.borrarInc}`); toast('Incidente eliminado'); recargar(); } catch (er) { falla(er); }
  });
}
