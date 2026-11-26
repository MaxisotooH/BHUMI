// Registro de horas reales de un despacho (carga, salida, llegada y fin de entrega, regreso) y sus mediciones.
import { html, raw, pintar, put, falla, toast, alHacer, duracion, num1, pct, difMin, claseDif } from './lib.js';
import { kpi } from './componentes.js';

const ahora = () => new Date().toTimeString().slice(0, 5);
const nota = (txt) => html`<span class="tenue med-linea">${txt}</span>`;
const linea = (contenido) => html`<span class="med-linea">${contenido}</span>`;
const conDif = (d) => (d == null ? '' : html` <span class="${claseDif(d)}">(${difMin(d)})</span>`);

function celdaHora(tipo, valor, etiqueta, stopId = null) {
  return html`<div class="celda-hora"><input type="time" value="${valor ?? ''}" data-ev="${tipo}" ${stopId != null ? raw(`data-stop="${Number(stopId)}"`) : ''} data-prev="${valor ?? ''}" aria-label="${etiqueta}">
    <button type="button" class="btn btn-texto btn-chico" data-ahora aria-label="Usar la hora actual para: ${etiqueta}">Ahora</button></div>`;
}

/** Tarjeta con las horas editables. `m` es la respuesta de GET /despachos/:id/tiempos. */
export function tarjetaTiempos(m) {
  return html`<div class="card" id="tiempos-card" style="margin-bottom:16px"><div class="card-cab"><h2>Tiempos reales</h2>
      <span class="sub">Anota las horas del recorrido; cada una se guarda al salir del campo o con “Ahora”.</span><span class="espacio"></span><span class="insignia" id="tiempos-progreso"></span></div>
    <div class="tabla-wrap"><table class="tabla-compacta tabla-tiempos"><thead><tr><th>Punto del recorrido</th><th>Inicio / llegada</th><th>Fin / salida</th><th>Qué se mide</th></tr></thead><tbody>
      <tr><td><b>Preparación del pedido</b></td><td>${celdaHora('preparacion_inicio', m.eventos.preparacion_inicio, 'Inicio de la preparación')}</td><td>${celdaHora('preparacion_fin', m.eventos.preparacion_fin, 'Fin de la preparación')}</td><td data-med="preparacion"></td></tr>
      <tr><td><b>Carga en la base</b></td><td>${celdaHora('carga_inicio', m.eventos.carga_inicio, 'Inicio de la carga')}</td><td>${celdaHora('carga_fin', m.eventos.carga_fin, 'Fin de la carga')}</td><td data-med="carga"></td></tr>
      <tr><td><b>Salida de la base</b>${m.salida.plan ? html`<div class="muted" style="font-size:12.5px">planificada a las ${m.salida.plan}</div>` : ''}</td><td><span class="tenue">—</span></td><td>${celdaHora('salida', m.eventos.salida, 'Salida de la base')}</td><td data-med="salida"></td></tr>
      ${m.paradas.map((p) => html`<tr><td><b>${p.orden}. ${p.nombre}</b>${p.comuna ? html`<div class="muted" style="font-size:12.5px">${p.comuna}</div>` : ''}</td>
        <td>${celdaHora('llegada', p.llegada, `Llegada a ${p.nombre}`, p.stop_id)}</td><td>${celdaHora('fin', p.fin, `Fin de la entrega en ${p.nombre}`, p.stop_id)}</td><td data-med="p${p.stop_id}"></td></tr>`)}
      ${m.retorno ? html`<tr><td><b>Regreso a la base</b></td><td>${celdaHora('regreso', m.eventos.regreso, 'Regreso a la base')}</td><td><span class="tenue">—</span></td><td data-med="regreso"></td></tr>` : ''}
    </tbody></table></div>
    <div class="card-cuerpo" style="border-top:1px solid var(--linea)"><dl class="kpis" id="tiempos-kpis" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))"></dl>
      <p class="muted" style="font-size:13px;margin:10px 0 0">El tránsito es el tiempo entre salir de un punto y llegar al siguiente, así que incluye cualquier pausa en el camino. Se compara con los minutos que Google calculó al planificar.</p></div></div>`;
}

/** Actualiza solo los textos de medición (no toca los campos, para no perder el foco mientras se escribe). */
export function pintarMediciones(card, m) {
  const celda = (k) => card.querySelector(`[data-med="${k}"]`);

  pintar(celda('preparacion'), m.preparacion.real_min != null
    ? linea(html`Preparación: <b>${duracion(m.preparacion.real_min)}</b>${m.preparacion.objetivo_min != null ? html` · objetivo ${duracion(m.preparacion.objetivo_min)}${conDif(m.preparacion.dif_min)}` : ''}`)
    : nota('Anota cuándo empezó y terminó de preparar el pedido.'));

  pintar(celda('carga'), m.carga.real_min != null
    ? linea(html`Carga: <b>${duracion(m.carga.real_min)}</b>${m.carga.objetivo_min != null ? html` · objetivo ${duracion(m.carga.objetivo_min)}${conDif(m.carga.dif_min)}` : ''}`)
    : nota('Anota el inicio y el fin de la carga.'));

  const atraso = m.salida.atraso_min;
  pintar(celda('salida'), m.salida.real
    ? linea(html`Salió a las <b>${m.salida.real}</b>${atraso == null ? '' : html` · <span class="${claseDif(atraso)}">${Math.round(atraso) === 0 ? 'a la hora planificada' : atraso > 0 ? `${Math.round(atraso)} min después de lo planificado` : `${Math.round(-atraso)} min antes de lo planificado`}</span>`}`)
    : nota('Anota la hora en que salió.'));

  for (const p of m.paradas) {
    const l = [];
    if (p.transito.real_min != null) l.push(linea(html`Tránsito: <b>${duracion(p.transito.real_min)}</b>${p.transito.estimado_min != null ? html` · estimado ${duracion(p.transito.estimado_min)}${conDif(p.transito.dif_min)}` : ''}`));
    else if (p.llegada) l.push(nota('Para medir el tránsito falta la salida de la base o el fin de la entrega anterior.'));
    if (p.entrega.real_min != null) l.push(linea(html`Entrega: <b>${duracion(p.entrega.real_min)}</b>${p.entrega.estandar_min != null ? html` · previsto ${duracion(p.entrega.estandar_min)}${conDif(p.entrega.dif_min)}` : ''}`));
    if (p.ventana) l.push(linea(p.ventana.a_tiempo ? html`<span class="dif-menos">Dentro del horario</span> (hasta las ${p.ventana.hasta})` : html`<span class="dif-mas">${Math.round(p.ventana.atraso_min)} min después del horario</span> (hasta las ${p.ventana.hasta})`));
    pintar(celda(`p${p.stop_id}`), l.length ? html`${l}` : nota('Anota la llegada y el fin de la entrega.'));
  }

  if (m.retorno) {
    pintar(celda('regreso'), m.retorno.real_min != null
      ? linea(html`Tránsito: <b>${duracion(m.retorno.real_min)}</b>${m.retorno.estimado_min != null ? html` · estimado ${duracion(m.retorno.estimado_min)}${conDif(m.retorno.dif_min)}` : ''}`)
      : nota('Anota la hora de regreso (y el fin de la última entrega).'));
  }

  const vent = m.paradas.map((p) => p.ventana).filter(Boolean);
  pintar(card.querySelector('#tiempos-kpis'), html`
    ${kpi('Preparación', m.preparacion.real_min != null ? duracion(m.preparacion.real_min) : null, { detalle: m.preparacion.objetivo_min != null ? `Objetivo ${duracion(m.preparacion.objetivo_min)}` : 'Sin objetivo configurado', vacio: 'Sin registrar' })}
    ${kpi('Tiempo de carga', m.carga.real_min != null ? duracion(m.carga.real_min) : null, { detalle: m.carga.objetivo_min != null ? `Objetivo ${duracion(m.carga.objetivo_min)}` : 'Sin objetivo configurado', vacio: 'Sin registrar' })}
    ${kpi('Ruta completa', m.ruta.real_min != null ? duracion(m.ruta.real_min) : null, { detalle: m.ruta.estimado_min != null ? html`Estimada ${duracion(m.ruta.estimado_min)}${conDif(m.ruta.dif_min)}` : m.ruta.real_min != null ? 'Sin tiempo de servicio planificado para comparar' : `Desde la salida hasta ${m.ruta.hasta === 'regreso' ? 'el regreso' : 'la última entrega'}`, vacio: 'Sin registrar' })}
    ${kpi('Paradas por hora', m.paradas_por_hora != null ? num1(m.paradas_por_hora) : null, { detalle: 'Paradas ÷ horas de ruta', vacio: 'Sin registrar' })}
    ${kpi('Puntualidad', vent.length ? pct((vent.filter((v) => v.a_tiempo).length / vent.length) * 100) : null, { detalle: vent.length ? `${vent.filter((v) => v.a_tiempo).length} de ${vent.length} entregas con horario` : '', vacio: 'Sin horarios de entrega' })}`);

  const prog = card.querySelector('#tiempos-progreso');
  const { registrados, esperados } = m.registro;
  prog.className = `insignia ${registrados === esperados ? 'ok' : registrados ? 'aviso' : ''}`;
  prog.textContent = registrados === esperados ? 'Todas las horas registradas' : `${registrados} de ${esperados} horas registradas`;
}

/** Conecta los campos de hora con la API. Las horas se guardan una a una y en orden. */
export function activarTiempos(card, tripId, m, { alCambiar } = {}) {
  pintarMediciones(card, m);
  let cola = Promise.resolve();
  const guardar = (input) => {
    if (input.value === input.dataset.prev || input.value === input.dataset.env) return;
    input.dataset.env = input.value;
    const evento = { tipo: input.dataset.ev, hora: input.value, ...(input.dataset.stop ? { stop_id: Number(input.dataset.stop) } : {}) };
    cola = cola.then(async () => {
      try {
        const nuevo = await put(`/despachos/${tripId}/tiempos`, { eventos: [evento] });
        input.dataset.prev = input.value;
        pintarMediciones(card, nuevo);
        toast(input.value ? 'Hora guardada' : 'Hora borrada', 'ok', 1800);
        alCambiar?.(nuevo);
      } catch (e) {
        input.value = input.dataset.prev;
        falla(e);
      } finally {
        delete input.dataset.env;
      }
    });
  };
  card.addEventListener('focusout', (e) => { if (e.target.matches('input[type="time"]')) guardar(e.target); });
  // En pantallas táctiles el selector nativo de hora puede dejar el campo con el foco al pulsar «Aceptar»:
  // se guarda al cambiar, con una espera corta. En escritorio no, porque editar una hora ya escrita
  // pasaría por valores intermedios (08:30 → 00:30 → 08:30).
  if (window.matchMedia?.('(pointer: coarse)').matches) {
    const esperas = new WeakMap();
    card.addEventListener('change', (e) => {
      if (!e.target.matches('input[type="time"]')) return;
      clearTimeout(esperas.get(e.target));
      esperas.set(e.target, setTimeout(() => guardar(e.target), 900));
    });
  }
  card.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches('input[type="time"]')) { e.preventDefault(); guardar(e.target); } });
  alHacer(card, 'click', '[data-ahora]', (e, b) => {
    const input = b.parentElement.querySelector('input');
    input.value = ahora();
    guardar(input);
  });
}
