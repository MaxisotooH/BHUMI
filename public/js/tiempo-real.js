// Tiempo real (servidor central): escucha GET /api/eventos y mantiene la pantalla al día cuando otra persona
// guarda algo. Nunca interrumpe a quien está escribiendo: en ese caso ofrece "Actualizar" en una barra.
//
// Una sola conexión por navegador: las pestañas de BHUMI eligen a una (con Web Locks) que abre la conexión y
// reparte los avisos a las demás (con BroadcastChannel). Sin HTTPS el navegador permite pocas conexiones por
// sitio, y una por pestaña dejaba colgada a la séptima. Si la pestaña elegida se cierra, otra toma su lugar.
import { PESTANA, toast } from './lib.js';

/** Qué secciones muestran cada recurso (la sección actual se refresca solo si le afecta el cambio). */
const AFECTA = {
  despachos: ['panel', 'costos', 'kpi', 'clientes', 'rutas', 'vehiculos', 'hoy'],
  entregas: ['panel', 'clientes', 'rutas', 'cubicaje'],
  clientes: ['panel', 'clientes', 'rutas'],
  vehiculos: ['panel', 'costos', 'rutas', 'vehiculos', 'cubicaje', 'hoy'],
  gastos: ['panel', 'costos', 'vehiculos'],
  productos: ['cubicaje', 'rutas'],
  personal: ['kpi', 'rutas', 'configuracion', 'hoy'],
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
 * @param app  { estado, seccionActual(), despachoAbierto(), ocupado(), refrescarVista(), refrescarEstado(), pintarMarco(), mostrarLogin(msg) }
 */
export function iniciarTiempoReal(app) {
  if (!('EventSource' in window)) return;
  let detenido = false; // la sesión terminó: esta pestaña ya no participa
  let pendientes = []; // avisos agrupados para un solo mensaje
  let tAviso = null;
  let tRefresco = null;

  // ---------- Lo que hace cada pestaña con lo que llega ----------
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

  /** ¿Este cambio afecta lo que se ve? En el detalle de un despacho, solo los cambios de ese despacho. */
  function afectaVista(e) {
    if (e.recurso === 'todo') return true;
    const trip = app.despachoAbierto();
    if (trip) return e.recurso === 'despachos' && (e.id == null || e.id === trip);
    return (AFECTA[e.recurso] ?? []).includes(app.seccionActual());
  }

  async function alEvento(e) {
    const yo = app.estado.usuario?.id;
    // Cambio hecho en esta misma pestaña. Se exige además que sea del mismo usuario: el identificador de
    // pestaña viaja a todos, y si no otro usuario podría copiarlo para que esta pestaña ignore sus cambios.
    if (e.pestana && e.pestana === PESTANA && e.usuario?.id === yo) return;
    if (e.usuario?.id !== yo) avisar(e);
    if (e.recurso === 'usuarios' && e.id === yo) {
      // A esta persona le cambiaron el rol o el nombre: el menú y los permisos cambian con él.
      try {
        const { usuario } = await (await fetch('/api/auth/yo', { headers: { 'X-Bhumi-Pestana': PESTANA } })).json();
        if (usuario && usuario.rol !== app.estado.usuario.rol) return location.reload();
        if (usuario) { app.estado.usuario = usuario; app.pintarMarco(); }
      } catch { /* si la sesión ya no vale, el próximo pedido muestra el inicio de sesión */ }
    }
    if (AFECTA_MARCO.has(e.recurso)) app.refrescarEstado().catch(() => {});
    if (afectaVista(e)) refrescar(e.usuario?.nombre);
  }

  function procesar(m) {
    if (detenido) return;
    if (m.t === 'evento') alEvento(m.e);
    else if (m.t === 'estado') {
      conexion(m.enVivo);
      // Al volver la conexión pudo haber cambios que no llegaron: se recarga lo que se ve.
      if (m.reconecto) { refrescar(null); app.refrescarEstado().catch(() => {}); }
    } else if (m.t === 'sin_sesion') {
      detenido = true;
      conexion(false);
      app.mostrarLogin('Tu sesión terminó. Vuelve a iniciar sesión.');
    }
  }

  // ---------- Reparto entre pestañas ----------
  const canal = typeof BroadcastChannel === 'function' ? new BroadcastChannel('bhumi-tiempo-real') : null;
  const compartir = !!(canal && navigator.locks?.request);
  let soyLider = false;
  let ultimoEstado = { t: 'estado', enVivo: false };
  /** Lo que recibe la pestaña con la conexión: lo procesa ella misma y lo reparte a las demás. */
  const repartir = (m) => {
    if (m.t === 'estado') ultimoEstado = { ...m, reconecto: false };
    procesar(m);
    canal?.postMessage(m);
  };

  if (compartir) {
    canal.onmessage = ({ data: m }) => {
      if (m?.t === 'hola') { if (soyLider) canal.postMessage(ultimoEstado); } // una pestaña nueva pregunta cómo está la conexión
      else if (m?.t) procesar(m);
    };
    canal.postMessage({ t: 'hola' });
    // La pestaña que obtiene el candado abre la conexión y lo conserva hasta cerrarse (o hasta que termine la sesión).
    navigator.locks.request('bhumi-tiempo-real', () => {
      if (detenido) return undefined; // al llegarle el turno ya estaba sin sesión: lo cede al siguiente
      soyLider = true;
      return new Promise((liberar) => abrirConexion(liberar));
    });
  } else {
    abrirConexion(() => {});
  }

  // ---------- La conexión (solo en una pestaña) ----------
  function abrirConexion(liberar) {
    let fuente = null;
    let seCayo = false;
    let espera = 3000;
    let tReintento = null;

    const terminar = () => { clearTimeout(tReintento); fuente?.close(); liberar(); };

    async function reintentar() {
      // EventSource reintenta solo ante cortes de red; ante un error HTTP (p. ej. 502 mientras el servidor se
      // reinicia detrás de Caddy) se rinde. Aquí se vuelve a intentar con esperas crecientes (máx. 30 s).
      tReintento = setTimeout(async () => {
        try {
          const r = await fetch('/api/auth/yo', { headers: { 'X-Bhumi-Pestana': PESTANA } });
          if (r.status === 401) { repartir({ t: 'sin_sesion' }); return terminar(); }
        } catch { /* sin red todavía: se vuelve a intentar */ }
        espera = Math.min(espera * 2, 30_000);
        conectar();
      }, espera);
    }

    function conectar() {
      if (detenido) return terminar();
      fuente = new EventSource('/api/eventos');
      fuente.addEventListener('listo', () => {
        espera = 3000;
        repartir({ t: 'estado', enVivo: true, reconecto: seCayo });
        seCayo = false;
      });
      fuente.addEventListener('sin_sesion', () => { repartir({ t: 'sin_sesion' }); terminar(); });
      fuente.onmessage = (m) => { try { repartir({ t: 'evento', e: JSON.parse(m.data) }); } catch { /* aviso ilegible */ } };
      fuente.onerror = () => {
        seCayo = true;
        repartir({ t: 'estado', enVivo: false });
        if (fuente.readyState === EventSource.CLOSED) reintentar();
      };
    }

    window.addEventListener('beforeunload', terminar);
    conectar();
  }

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
