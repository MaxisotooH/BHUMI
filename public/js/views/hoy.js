// Hoy: los despachos del día con botones grandes para marcar cada momento (preparación, carga, salida, regreso).
// Pensada para bodega, en el celular o la tablet del andén: un toque marca la hora actual.
import { html, pintar, get, put, post, toast, falla, hoy, fecha, insigniaEstado, alHacer, vacio, pluralizar, esc } from '../lib.js';

const ahora = () => new Date().toTimeString().slice(0, 5);

/** Momentos de la base, en el orden en que ocurren. El regreso solo si el despacho vuelve a la base. */
const PASOS = [
  ['preparacion_inicio', 'Empieza la preparación', 'Preparación'],
  ['preparacion_fin', 'Termina la preparación', 'Preparación'],
  ['carga_inicio', 'Empieza la carga', 'Carga'],
  ['carga_fin', 'Termina la carga', 'Carga'],
  ['salida', 'Sale de la base', 'Salida'],
  ['regreso', 'Vuelve a la base', 'Regreso'],
];

export default async function (ctx) {
  const { root } = ctx;
  const dia = hoy();
  const despachos = (await get(`/despachos?desde=${dia}&hasta=${dia}`)).filter((t) => t.estado !== 'cancelado')
    .sort((a, b) => (a.hora_salida ?? '99:99').localeCompare(b.hora_salida ?? '99:99') || a.id - b.id);
  const tiempos = new Map(await Promise.all(despachos.map(async (t) => [t.id, await get(`/despachos/${t.id}/tiempos`)])));

  if (!despachos.length) {
    pintar(root, html`<div class="hoy">${vacio('No hay despachos para hoy', `Cuando se planifique un despacho para el ${fecha(dia)}, aparecerá aquí para anotar sus horas.`,
      html`<a class="btn" href="#/rutas?tab=despachos">Ver todos los despachos</a>`)}</div>`);
    return;
  }

  pintar(root, html`<div class="hoy">
    <p class="muted hoy-intro">${pluralizar(despachos.length, 'despacho', 'despachos')} para hoy, ${fecha(dia)}. Toca un botón en el momento en que ocurre: queda anotada la hora actual.</p>
    ${despachos.map((t) => tarjeta(t, tiempos.get(t.id)))}
  </div>`);

  // Marcar un momento con la hora actual.
  alHacer(root, 'click', '[data-marcar]', async (e, b) => {
    const id = Number(b.dataset.trip);
    b.disabled = true;
    try {
      const m = await put(`/despachos/${id}/tiempos`, { eventos: [{ tipo: b.dataset.marcar, hora: ahora() }] });
      tiempos.set(id, m);
      repintar(id);
      toast(`${b.dataset.texto}: ${ahora()}`);
    } catch (er) { falla(er); b.disabled = false; }
  });

  // Corregir una hora ya anotada (o anotar una pasada): se abre un campo de hora en el lugar.
  alHacer(root, 'click', '[data-corregir]', (e, b) => {
    const fila = b.closest('.hoy-paso');
    const actual = b.dataset.valor || ahora();
    fila.querySelector('.hoy-accion').innerHTML = `<input type="time" value="${esc(actual)}" class="hoy-hora" aria-label="Hora de ${esc(b.dataset.texto)}">
      <button type="button" class="btn btn-primario" data-guardar-hora data-trip="${b.dataset.trip}" data-tipo="${esc(b.dataset.corregir)}" data-texto="${esc(b.dataset.texto)}">Guardar</button>
      ${b.dataset.valor ? `<button type="button" class="btn" data-guardar-hora data-borrar data-trip="${b.dataset.trip}" data-tipo="${esc(b.dataset.corregir)}" data-texto="${esc(b.dataset.texto)}">Quitar</button>` : ''}`;
    fila.querySelector('input').focus();
  });
  alHacer(root, 'click', '[data-guardar-hora]', async (e, b) => {
    const id = Number(b.dataset.trip);
    const hora = b.hasAttribute('data-borrar') ? '' : b.closest('.hoy-paso').querySelector('input').value;
    if (!hora && !b.hasAttribute('data-borrar')) return falla(new Error('Indica la hora.'));
    try {
      const m = await put(`/despachos/${id}/tiempos`, { eventos: [{ tipo: b.dataset.tipo, hora }] });
      tiempos.set(id, m);
      repintar(id);
      toast(hora ? `${b.dataset.texto}: ${hora}` : `${b.dataset.texto}: hora quitada`);
    } catch (er) { falla(er); }
  });

  // Iniciar la ruta (el despacho pasa a "en ruta").
  alHacer(root, 'click', '[data-iniciar]', async (e, b) => {
    const t = despachos.find((x) => x.id === Number(b.dataset.iniciar));
    b.disabled = true;
    try {
      await post(`/despachos/${t.id}/estado`, { estado: 'en_ruta', version: t.version });
      t.estado = 'en_ruta';
      t.version += 1;
      repintar(t.id);
      toast(`Despacho N° ${t.id} en ruta`);
    } catch (er) { falla(er); b.disabled = false; }
  });

  function repintar(id) {
    const t = despachos.find((x) => x.id === id);
    const viejo = root.querySelector(`[data-tarjeta="${id}"]`);
    const caja = document.createElement('div');
    pintar(caja, tarjeta(t, tiempos.get(id)));
    viejo.replaceWith(caja.firstElementChild);
  }
}

function tarjeta(t, m) {
  const pasos = PASOS.filter(([tipo]) => tipo !== 'regreso' || m.retorno);
  const siguiente = pasos.find(([tipo]) => !m.eventos[tipo])?.[0];
  const abierto = !['completado', 'cancelado'].includes(t.estado);
  return html`<section class="card hoy-card" data-tarjeta="${t.id}">
    <div class="hoy-cab">
      <div><h2>Despacho N° ${t.id} ${insigniaEstado(t.estado)}</h2>
        <p class="muted">${t.marca} ${t.modelo}${t.conductor ? ` · ${t.conductor}` : ' · sin conductor'}${t.hora_salida ? ` · sale ${t.hora_salida}` : ''} · ${pluralizar(t.n_paradas ?? 0, 'parada', 'paradas')}</p></div>
    </div>
    <ol class="hoy-pasos">${pasos.map(([tipo, texto, grupo]) => {
      const valor = m.eventos[tipo];
      return html`<li class="hoy-paso ${valor ? 'hecho' : ''} ${tipo === siguiente && abierto ? 'siguiente' : ''}">
        <div class="hoy-texto"><span class="hoy-grupo">${grupo}</span><b>${texto}</b></div>
        <div class="hoy-accion">${valor
          ? html`<span class="hoy-valor num">${valor}</span><button type="button" class="btn btn-texto" data-corregir="${tipo}" data-valor="${valor}" data-trip="${t.id}" data-texto="${texto}" ${abierto ? '' : 'disabled'}>Corregir</button>`
          : abierto
            ? html`<button type="button" class="btn ${tipo === siguiente ? 'btn-primario' : ''} hoy-boton" data-marcar="${tipo}" data-trip="${t.id}" data-texto="${texto}">Marcar ahora</button><button type="button" class="btn btn-texto" data-corregir="${tipo}" data-trip="${t.id}" data-texto="${texto}">Otra hora</button>`
            : html`<span class="tenue">—</span>`}</div></li>`;
    })}</ol>
    <div class="hoy-pie">
      ${t.estado === 'planificado' ? html`<button type="button" class="btn hoy-boton" data-iniciar="${t.id}">Iniciar ruta</button>` : ''}
      <a class="btn ${t.estado === 'en_ruta' ? 'btn-primario' : ''} hoy-boton" href="#/rutas?tab=despachos&trip=${t.id}">${abierto ? 'Entregas y cierre del despacho' : 'Ver el despacho'}</a>
    </div>
  </section>`;
}
