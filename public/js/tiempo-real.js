// Tiempo real (servidor central): escucha GET /api/eventos y mantiene la pantalla al día cuando otra persona
// guarda algo. Nunca interrumpe a quien está escribiendo: en ese caso ofrece "Actualizar" en una barra.
import { PESTANA, toast } from './lib.js';

/** Qué secciones muestran cada recurso (la sección actual se refresca solo si le afecta el cambio). */
const AFECTA = {
  despachos: ['panel', 'costos', 'kpi', 'clientes', 'rutas', 'vehiculos'],
  entregas: ['panel', 'clientes', 'rutas', 'cubicaje'],
  clientes: ['panel', 'clientes', 'rutas'],
  vehiculos: ['panel', 'costos', 'rutas', 'vehiculos', 'cubicaje'],
  gastos: ['panel', 'costos', 'vehiculos'],
  productos: ['cubicaje', 'rutas'],
  personal: ['kpi', 'rutas', 'configuracion'],
  zonas: ['clientes', 'rutas'],
  combustible: ['panel', 'costos', 'vehiculos', 'configuracion'],
  settings: ['panel', 'costos', 'kpi', 'clientes', 'rutas', 'vehiculos', 'configuracion'],
  usuarios: ['configuracion'],
};
/** Cambios que alteran los avisos de la barra superior (precio del combustible, base, datos faltantes). */
const AFECTA_MARCO = new Set(['settings', 'combustible', 'vehiculos', 'clientes', 'todo']);

const NOMBRE = {
  despachos: 'un despacho', entregas: 'las entregas', clientes: 'los clientes', vehiculos: 'los vehículos', gastos: 'los gastos',
  productos: 'los productos', personal: 'el personal', zonas: 'las zonas', combustible: 'el precio del combustible',
  settings: 'la configuración', usuarios: 'los usuarios', todo: 'todos los datos (restauró un respaldo)',
};

/**
 * @param app  { estado, seccionActual(), ocupado(), refrescarVista(), refrescarEstado(), pintarMarco(), mostrarLogin(msg) }
 */
export function iniciarTiempoReal(app) {
  if (!('EventSource' in window)) return;
  let seCayo = false;
  let pendientes = []; // avisos agrupados para un solo mensaje
  let tAviso = null;
  let tRefresco = null;

  const conexion = (enVivo) => {
    if (app.estado.enVivo === enVivo) return;
    app.estado.enVivo = enVivo;
    if (app.estado.settings) app.pintarMarco(); // la barra superior se pinta cuando ya cargaron los ajustes
  };

  function avisar(e) {
    pendientes.push(e);
    clearTimeout(tAviso);
    tAviso = setTimeout(() => {
      const personas = [...new Set(pendientes.map((x) => x.usuario?.nombre ?? 'Alguien'))];
      const recursos = [...new Set(pendientes.map((x) => x.recurso))];
      toast(personas.length === 1 && recursos.length === 1
        ? `${personas[0]} actualizó ${NOMBRE[recursos[0]] ?? recursos[0]}`
        : `${personas.join(' y ')} hicieron cambios (${recursos.map((r) => NOMBRE[r] ?? r).join(', ')})`, 'info', 5000);
      pendientes = [];
    }, 1500);
  }

  /** Refresca la sección si se puede sin molestar; si no, deja la barra con "Actualizar". */
  function refrescar(quien) {
    clearTimeout(tRefresco);
    tRefresco = setTimeout(() => {
      if (app.ocupado()) mostrarBarra(quien);
      else app.refrescarVista();
    }, 400); // varios cambios seguidos se refrescan una sola vez
  }

  async function alEvento(e) {
    if (e.pestana && e.pestana === PESTANA) return; // cambio hecho en esta misma pestaña
    if (e.usuario?.id !== app.estado.usuario?.id) avisar(e);
    if (e.recurso === 'usuarios' && e.id === app.estado.usuario?.id) {
      // A esta persona le cambiaron el rol o el nombre: el menú y los permisos cambian con él.
      try {
        const { usuario } = await (await fetch('/api/auth/yo', { headers: { 'X-Bhumi-Pestana': PESTANA } })).json();
        if (usuario && usuario.rol !== app.estado.usuario.rol) return location.reload();
        if (usuario) { app.estado.usuario = usuario; app.pintarMarco(); }
      } catch { /* si la sesión ya no vale, el próximo pedido muestra el inicio de sesión */ }
    }
    if (AFECTA_MARCO.has(e.recurso)) app.refrescarEstado().catch(() => {});
    if (e.recurso === 'todo' || (AFECTA[e.recurso] ?? []).includes(app.seccionActual())) refrescar(e.usuario?.nombre);
  }

  const fuente = new EventSource('/api/eventos');
  fuente.addEventListener('listo', () => {
    conexion(true);
    // Si la conexión se cortó, pudo haber cambios que no llegaron: se vuelve a cargar lo que se ve.
    if (seCayo) { seCayo = false; refrescar(null); app.refrescarEstado().catch(() => {}); }
  });
  fuente.addEventListener('sin_sesion', () => { fuente.close(); conexion(false); app.mostrarLogin('Tu sesión terminó. Vuelve a iniciar sesión.'); });
  fuente.onerror = () => { seCayo = true; conexion(false); }; // EventSource vuelve a conectarse solo
  fuente.onmessage = (m) => { try { alEvento(JSON.parse(m.data)); } catch { /* aviso ilegible: se ignora */ } };
  window.addEventListener('beforeunload', () => fuente.close());

  function mostrarBarra(quien) {
    let barra = document.querySelector('.aviso-cambios');
    if (!barra) {
      barra = document.createElement('div');
      barra.className = 'aviso ambar aviso-cambios';
      barra.setAttribute('role', 'status');
      barra.innerHTML = '<p></p><div class="fila"><button class="btn btn-primario btn-chico" type="button" data-actualizar>Actualizar</button><button class="btn btn-chico" type="button" data-despues>Ahora no</button></div>';
      barra.querySelector('[data-actualizar]').addEventListener('click', () => { barra.remove(); app.refrescarVista(); });
      barra.querySelector('[data-despues]').addEventListener('click', () => barra.remove());
      document.querySelector('.principal').insertBefore(barra, document.getElementById('vista'));
    }
    barra.querySelector('p').textContent = `${quien ? `${quien} guardó cambios` : 'Hay cambios nuevos'} en lo que estás viendo. Termina lo que estás haciendo y pulsa “Actualizar” para verlos.`;
  }
}

/** Quita la barra de cambios (al cambiar de pantalla o refrescar). */
export const quitarBarraCambios = () => document.querySelector('.aviso-cambios')?.remove();
