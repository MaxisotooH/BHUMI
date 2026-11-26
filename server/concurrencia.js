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

export function crearControlVersiones({ db }) {
  /** Último cambio exitoso de otra persona sobre ese registro, según la auditoría. */
  const ultimoCambio = (base, usuarioId) => db.prepare(`SELECT a.ts, u.nombre FROM auditoria a LEFT JOIN usuarios u ON u.id = a.usuario_id
      WHERE (a.ruta = ? OR a.ruta LIKE ?) AND a.estado < 400 AND a.accion IN ('PUT', 'POST') AND a.usuario_id IS NOT ?
      ORDER BY a.id DESC LIMIT 1`).get(base, `${base}/%`, usuarioId);

  return function controlVersiones(req, res, next) {
    const body = req.body;
    if (!body || typeof body !== 'object' || !('version' in body)) return next();
    const enviada = Number(body.version);
    delete body.version; // los handlers no la escriben: la mantienen los triggers de la base
    const reg = registroEditado(req.method, req.path);
    if (!reg || !Number.isInteger(enviada)) return next();
    const fila = db.prepare(`SELECT version FROM ${reg.tabla} WHERE id = ?`).get(reg.id);
    if (!fila || fila.version === enviada) return next(); // si no existe, el endpoint responde 404 como siempre
    const quien = ultimoCambio(reg.base, req.usuario?.id ?? null);
    const nombre = quien?.nombre ?? 'Otra persona';
    res.status(409).json({
      error: {
        code: 'conflicto',
        mensaje: `${nombre} guardó cambios en este registro mientras lo tenías abierto. Se volvió a cargar con sus cambios: revísalos y vuelve a guardar si hace falta.`,
        extra: { usuario: quien?.nombre ?? null, ts: quien?.ts ?? null, version_actual: fila.version },
      },
    });
  };
}
