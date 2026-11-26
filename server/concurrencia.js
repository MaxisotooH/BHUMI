// Edición simultánea en el servidor central: si dos personas editan el mismo registro, la segunda en guardar
// recibe un aviso de conflicto en vez de pisar sin saberlo los cambios de la primera.
//
// La interfaz envía la `version` que tenía el registro cuando lo abrió. Si ya no coincide con la de la base,
// alguien guardó entremedio: se responde 409 con quién fue. Sin `version` en la solicitud no se revisa nada
// (la versión de doble clic y los clientes antiguos siguen funcionando igual).
import { normalizarRuta } from './auth.js';

// Escrituras sobre un registro que se edita en un formulario: [método, ruta, tabla].
const EDICIONES = [
  ['PUT', /^\/vehiculos\/(\d+)$/, 'vehicles'],
  ['PUT', /^\/clientes\/(\d+)$/, 'clients'],
  ['PUT', /^\/entregas\/(\d+)$/, 'deliveries'],
  ['POST', /^\/entregas\/(\d+)\/estado$/, 'deliveries'],
  ['PUT', /^\/productos\/(\d+)$/, 'products'],
  ['PUT', /^\/personal\/(\d+)$/, 'drivers'],
  ['PUT', /^\/gastos\/(\d+)$/, 'gastos'],
  // Los tiempos no: se guardan evento por evento y dos personas pueden anotar horas distintas a la vez.
  ['PUT', /^\/despachos\/(\d+)\/personal$/, 'trips'],
  ['POST', /^\/despachos\/(\d+)\/estado$/, 'trips'],
];

/** ¿Qué registro edita esta solicitud? `{ tabla, id, base }` o null. */
export function registroEditado(metodo, ruta) {
  ruta = normalizarRuta(ruta);
  for (const [m, re, tabla] of EDICIONES) {
    const x = m === metodo && re.exec(ruta);
    if (x) return { tabla, id: Number(x[1]), base: `/${ruta.split('/')[1]}/${x[1]}` }; // p. ej. "/despachos/4"
  }
  return null;
}

// La auditoría se escribe al terminar cada solicitud, así que la que cambió un registro termina después del
// cambio: se busca la primera que terminó en los MARGEN_S segundos siguientes. La holgura hacia atrás es solo
// para el redondeo de julianday: dos solicitudes pueden ir a pocos milisegundos una de otra.
const MARGEN_S = 5;
const HOLGURA_S = 0.001;

/** Nombre corto de la sección de una ruta de la API, para el aviso ("al guardar en despachos"). */
const SECCION = { despachos: 'un despacho', entregas: 'las entregas', vehiculos: 'los vehículos', cargas: 'las cargas de combustible', gastos: 'los gastos', clientes: 'los clientes', 'km-semanal': 'el kilometraje semanal', productos: 'los productos', personal: 'el personal' };

export function crearControlVersiones({ db }) {
  /**
   * ¿Quién subió la versión? La primera escritura de la auditoría que terminó después del cambio (`version_cambio`).
   * Puede venir de otra sección: cerrar un despacho suma km al odómetro y cambia así el vehículo.
   * Si dos terminaron a la vez, se prefiere la que fue sobre el mismo registro. Sin coincidencia, null: no se adivina.
   */
  const quienCambio = (cambio, base) => {
    if (!cambio) return null;
    return db.prepare(`SELECT a.ts, a.ruta, a.usuario_id, u.nombre FROM auditoria a JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.estado < 400 AND a.accion IN ('POST', 'PUT', 'PATCH', 'DELETE')
          AND (julianday(a.ts) - julianday(?)) * 86400 BETWEEN ? AND ?
        ORDER BY julianday(a.ts) ASC, (lower(a.ruta) = ? OR lower(a.ruta) LIKE ?) DESC, a.id ASC
        LIMIT 1`).get(cambio, -HOLGURA_S, MARGEN_S, base, `${base}/%`) ?? null;
  };

  function mensaje(quien, base, usuarioId) {
    const fin = 'mientras lo tenías abierto. Se volvió a cargar con sus cambios: revísalos y vuelve a guardar si hace falta.';
    if (!quien) return `Otra persona guardó cambios en este registro ${fin}`;
    const seccion = quien.ruta?.toLowerCase().split('/')[1];
    const desde = seccion && seccion !== base.split('/')[1] ? ` (al guardar ${SECCION[seccion] ?? seccion})` : '';
    if (quien.usuario_id === usuarioId) return `Tú mismo cambiaste este registro en otra pestaña o ventana${desde} ${fin}`;
    return `${quien.nombre} cambió este registro${desde} ${fin}`;
  }

  return function controlVersiones(req, res, next) {
    const body = req.body;
    if (!body || typeof body !== 'object' || !('version' in body)) return next();
    const enviada = Number(body.version);
    delete body.version; // los handlers no la escriben: la mantienen los triggers de la base
    const reg = registroEditado(req.method, req.path);
    if (!reg || !Number.isInteger(enviada)) return next();
    const fila = db.prepare(`SELECT version, version_cambio FROM ${reg.tabla} WHERE id = ?`).get(reg.id);
    if (!fila || fila.version === enviada) return next(); // si no existe, el endpoint responde 404 como siempre
    const quien = quienCambio(fila.version_cambio, reg.base);
    res.status(409).json({
      error: {
        code: 'conflicto',
        mensaje: mensaje(quien, reg.base, req.usuario?.id ?? null),
        extra: { usuario: quien?.nombre ?? null, ruta: quien?.ruta ?? null, ts: quien?.ts ?? null, version_actual: fila.version },
      },
    });
  };
}
