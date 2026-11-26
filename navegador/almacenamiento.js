// Guarda los datos de BHUMI dentro del navegador (IndexedDB) y recuerda cuándo se descargó el último respaldo.
// Los datos quedan asociados a la carpeta desde donde se abre el programa en Chrome y Edge: mover o actualizar
// la carpeta NO los borra; limpiar los "datos de navegación" del navegador sí.

const BD = 'bhumi';
const TABLA = 'kv';
const CLAVE_DB = 'db:real';
const CLAVE_ANTERIOR = 'db:anterior';
const CLAVE_META = 'meta';
const CADA_COPIA_MS = 60 * 60 * 1000; // copia de seguridad interna: como mucho una por hora

const pedir = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

let conexion = null;
let bdAbierta = null; // la conexión ya lista: permite iniciar un guardado sin esperar nada al cerrar la pestaña
function abrir() {
  conexion ??= new Promise((ok, no) => {
    const r = indexedDB.open(BD, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(TABLA);
    r.onsuccess = () => { bdAbierta = r.result; bdAbierta.onclose = () => { bdAbierta = null; conexion = null; }; ok(r.result); };
    r.onerror = () => { conexion = null; no(r.error); };
    r.onblocked = () => { conexion = null; no(new Error('El navegador bloqueó el acceso a los datos de BHUMI.')); };
  });
  return conexion;
}

async function leer(clave) {
  const bd = await abrir();
  return pedir(bd.transaction(TABLA, 'readonly').objectStore(TABLA).get(clave));
}

async function escribir(pares) {
  const bd = await abrir();
  const t = bd.transaction(TABLA, 'readwrite');
  const tabla = t.objectStore(TABLA);
  for (const [clave, valor] of pares) tabla.put(valor, clave);
  await new Promise((ok, no) => { t.oncomplete = ok; t.onerror = () => no(t.error); t.onabort = () => no(t.error); });
}

/** ¿Este navegador puede ejecutar BHUMI? Devuelve un texto con el motivo si no puede. */
export function problemaDeNavegador() {
  if (typeof WebAssembly !== 'object') return 'Este navegador es demasiado antiguo. Abre BHUMI con Google Chrome o Microsoft Edge actualizados.';
  if (!window.indexedDB) return 'Este navegador no permite guardar datos de BHUMI (¿navegación privada o sin almacenamiento?). Ábrelo con Chrome o Edge en una ventana normal.';
  return null;
}

/**
 * Permite una sola pestaña de BHUMI a la vez: dos pestañas escribiendo la misma base se pisarían los cambios.
 * Devuelve true si esta pestaña quedó como la única activa.
 */
export function tomarCandado() {
  if (!navigator.locks) return Promise.resolve(true);
  return new Promise((ok) => {
    navigator.locks.request('bhumi-datos', { ifAvailable: true }, (candado) => {
      if (!candado) { ok(false); return undefined; }
      ok(true);
      return new Promise(() => {}); // se mantiene mientras la pestaña esté abierta
    }).catch(() => ok(true));
  });
}

/** Pide al navegador que no borre los datos solos cuando falte espacio en disco. */
export async function pedirPersistencia() {
  try { return (await navigator.storage?.persist?.()) ?? false; } catch { return false; }
}

/** Lee la base guardada. Si la principal está dañada, intenta con la copia interna anterior. */
export async function cargarBase() {
  const principal = await leer(CLAVE_DB);
  return { bytes: principal instanceof Uint8Array ? principal : null, anterior: async () => { const a = await leer(CLAVE_ANTERIOR); return a instanceof Uint8Array ? a : null; } };
}

async function meta() { return (await leer(CLAVE_META)) ?? {}; }
async function guardarMeta(cambios) { await escribir([[CLAVE_META, { ...(await meta()), ...cambios }]]); }

export async function ultimoRespaldo() { return (await meta()).ultimoRespaldo ?? null; }
export async function marcarRespaldo() { await guardarMeta({ ultimoRespaldo: new Date().toISOString() }); }
export async function primerUso() {
  const m = await meta();
  if (m.primerUso) return m.primerUso;
  const ahora = new Date().toISOString();
  await guardarMeta({ primerUso: ahora });
  return ahora;
}

/**
 * Guarda la base poco después de cada cambio (agrupa varios cambios seguidos en un solo guardado)
 * y siempre al cerrar o ocultar la pestaña.
 * @param exportar devuelve los bytes de la base completa
 */
export function crearGuardador(exportar, { demora = 400, alError = () => {} } = {}) {
  let reloj = null;
  let pendiente = false;
  let ocupado = Promise.resolve();
  let ultimaCopia = 0;

  const terminar = (t) => new Promise((ok, no) => { t.oncomplete = ok; t.onerror = () => no(t.error); t.onabort = () => no(t.error); });

  /** `urgente`: la pestaña se está cerrando. El guardado se inicia en el acto, sin esperas, para que el navegador alcance a completarlo. */
  const guardarAhora = (urgente = false) => {
    clearTimeout(reloj);
    reloj = null;
    if (!pendiente) return ocupado;
    pendiente = false;
    const bytes = exportar();
    if (urgente && bdAbierta) {
      try {
        const t = bdAbierta.transaction(TABLA, 'readwrite');
        t.objectStore(TABLA).put(bytes, CLAVE_DB);
        ocupado = terminar(t).catch((e) => { pendiente = true; alError(e); });
        return ocupado;
      } catch { /* sigue por el camino normal */ }
    }
    ocupado = ocupado.then(async () => {
      const pares = [[CLAVE_DB, bytes]];
      if (Date.now() - ultimaCopia > CADA_COPIA_MS) {
        const previa = await leer(CLAVE_DB);
        if (previa) { pares.push([CLAVE_ANTERIOR, previa]); ultimaCopia = Date.now(); }
      }
      await escribir(pares);
    }).catch((e) => { pendiente = true; alError(e); });
    return ocupado;
  };

  const programar = () => { pendiente = true; clearTimeout(reloj); reloj = setTimeout(() => guardarAhora(), demora); };

  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guardarAhora(true); });
  window.addEventListener('pagehide', () => guardarAhora(true));
  return { programar, guardarAhora, hayPendiente: () => pendiente };
}

/** Reemplaza lo guardado por una base nueva (se usa tras restaurar un respaldo). */
export async function reemplazarBase(bytes) { await escribir([[CLAVE_DB, bytes]]); }
