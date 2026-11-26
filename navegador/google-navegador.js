// Google Maps Platform desde el navegador, con las bibliotecas oficiales de Google (Geocoding y Routes de la Maps JavaScript API).
// Google no permite llamar a sus servicios web directamente desde una página (no admiten CORS), así que se usa su biblioteca.
// Entrega la misma interfaz que server/services/google.js: geocode, routeMatrix, computeRoute y probar.
import { GoogleError, resultadoGeocode, textoDireccion, probarServicio } from '../server/services/google.js';
import { codificarPolilinea } from '../server/services/polilinea.js';

const ESPERA_MS = 20000;
const ll = (p) => ({ lat: p.lat, lng: p.lng });
const num = (v) => (typeof v === 'function' ? v.call(undefined) : v);

/** Traduce un error de la biblioteca de Google a los mismos errores que ya entiende el resto del sistema. */
export function errorDeGoogle(e) {
  if (e instanceof GoogleError) return e;
  if (e?.code === 'red' || e?.code === 'sin_clave') return new GoogleError(e.code, e.message); // errores propios de maps.js (no cargó el script / falta la clave)
  const texto = `${e?.code ?? ''} ${e?.name ?? ''} ${e?.message ?? e ?? ''}`;
  if (/ZERO_RESULTS|NOT_FOUND|ROUTE_NOT_FOUND/i.test(texto)) return new GoogleError('sin_ruta', 'Google no encontró una ruta o dirección para esos datos.', texto);
  if (/OVER_QUERY_LIMIT|OVER_DAILY_LIMIT|RESOURCE_EXHAUSTED|quota|429/i.test(texto)) return new GoogleError('cuota', 'Se superó la cuota de Google Maps. Intenta de nuevo en unos minutos.', texto);
  if (/REQUEST_DENIED|PERMISSION_DENIED|API.?KEY|ApiNotActivated|RefererNotAllowed|BillingNotEnabled|InvalidKey|not authorized|403|401/i.test(texto)) {
    return new GoogleError('sin_permiso', 'Google rechazó la API key. Revisa que Maps JavaScript API, Routes API y Geocoding API estén habilitadas, que la facturación esté activa y que la clave no tenga restricción de sitios web (esta versión se abre desde un archivo, sin dirección web).', texto);
  }
  if (/INVALID_ARGUMENT|INVALID_REQUEST|400/i.test(texto)) return new GoogleError('solicitud_invalida', `Google rechazó la solicitud: ${e?.message ?? 'datos no válidos'}`, texto);
  if (/network|failed to fetch|offline|timeout|NetworkError/i.test(texto)) return new GoogleError('red', 'No se pudo conectar con Google Maps. Revisa tu conexión a internet.', texto);
  return new GoogleError('google', `Google respondió con un error. ${e?.message ?? ''}`.trim(), texto);
}

/**
 * @param getKey        devuelve la API key guardada
 * @param cargarMaps    carga el script de la Maps JavaScript API con esa clave (public/js/maps.js: cargarGoogle)
 * @param claveRechazada devuelve true si Google ya informó que la clave no sirve
 */
export function createGoogleNavegador({ getKey, cargarMaps, claveRechazada = () => false }) {
  const clave = () => {
    const k = (getKey() ?? '').trim();
    if (!k) throw new GoogleError('sin_clave', 'Falta la API key de Google Maps. Agrégala en Configuración → Google Maps.');
    return k;
  };

  const conEspera = (promesa) => {
    let reloj;
    const limite = new Promise((_, no) => {
      reloj = setTimeout(() => no(new GoogleError(claveRechazada() ? 'sin_permiso' : 'red', claveRechazada() ? 'Google rechazó la API key.' : 'Google Maps no respondió a tiempo. Revisa tu conexión a internet.')), ESPERA_MS);
    });
    return Promise.race([promesa, limite]).finally(() => clearTimeout(reloj));
  };

  async function biblioteca(nombre) {
    const k = clave();
    try {
      await conEspera(cargarMaps(k));
      return await conEspera(window.google.maps.importLibrary(nombre));
    } catch (e) {
      throw errorDeGoogle(e);
    }
  }

  async function llamar(fn) {
    try { return await conEspera(fn()); } catch (e) { throw claveRechazada() ? errorDeGoogle({ code: 'REQUEST_DENIED' }) : errorDeGoogle(e); }
  }

  async function geocode({ direccion, comuna, region }) {
    const { Geocoder } = await biblioteca('geocoding');
    const partes = textoDireccion({ direccion, comuna, region });
    let resp;
    try {
      resp = await llamar(() => new Geocoder().geocode({ address: partes, componentRestrictions: { country: 'CL' }, region: 'cl', language: 'es' }));
    } catch (e) {
      if (e.code === 'sin_ruta') throw new GoogleError('sin_resultados', `Google no encontró la dirección "${partes}".`);
      throw e;
    }
    const r = resp?.results?.[0];
    if (!r) throw new GoogleError('sin_resultados', `Google no encontró la dirección "${partes}".`);
    const loc = r.geometry.location;
    return resultadoGeocode({ ...r, geometry: { ...r.geometry, location: { lat: num(loc.lat), lng: num(loc.lng) } } }, { comuna, region });
  }

  async function routeMatrix(puntos, { departureTime = null, traffic = true } = {}) {
    const { RouteMatrix } = await biblioteca('routes');
    const n = puntos.length;
    const dist = Array.from({ length: n }, () => Array(n).fill(null));
    const dur = Array.from({ length: n }, () => Array(n).fill(null));
    const est = Array.from({ length: n }, () => Array(n).fill(null));
    const porLlamada = Math.max(1, Math.floor(625 / n)); // máximo 625 elementos por llamada

    for (let desde = 0; desde < n; desde += porLlamada) {
      const origenes = puntos.slice(desde, desde + porLlamada);
      const peticion = {
        origins: origenes.map(ll),
        destinations: puntos.map(ll),
        travelMode: 'DRIVING',
        routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
        language: 'es-CL',
        region: 'cl',
        fields: ['distanceMeters', 'durationMillis', 'staticDurationMillis', 'condition'],
      };
      if (traffic && departureTime) peticion.departureTime = new Date(departureTime);
      const { matrix } = await llamar(() => RouteMatrix.computeRouteMatrix(peticion));
      (matrix?.rows ?? []).forEach((fila, a) => {
        (fila.items ?? []).forEach((item, b) => {
          const i = desde + a;
          if (item.error || item.condition === 'ROUTE_NOT_FOUND' || item.distanceMeters == null) return;
          dist[i][b] = item.distanceMeters;
          dur[i][b] = item.durationMillis != null ? item.durationMillis / 1000 : null;
          est[i][b] = item.staticDurationMillis != null ? item.staticDurationMillis / 1000 : dur[i][b];
        });
      });
    }
    for (let i = 0; i < n; i++) { dist[i][i] = 0; dur[i][i] = 0; est[i][i] = 0; }
    return { dist, dur, est };
  }

  async function computeRoute(puntos, { departureTime = null, traffic = true } = {}) {
    if (puntos.length < 2) throw new GoogleError('solicitud_invalida', 'Se necesitan al menos dos puntos.');
    const { Route } = await biblioteca('routes');
    const peticion = {
      origin: ll(puntos[0]),
      destination: ll(puntos[puntos.length - 1]),
      travelMode: 'DRIVING',
      routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      language: 'es-CL',
      region: 'cl',
      fields: ['distanceMeters', 'durationMillis', 'staticDurationMillis', 'path', 'legs'],
    };
    if (puntos.length > 2) peticion.intermediates = puntos.slice(1, -1).map((p) => ({ location: ll(p) }));
    if (traffic && departureTime) peticion.departureTime = new Date(departureTime);
    const { routes } = await llamar(() => Route.computeRoutes(peticion));
    const r = routes?.[0];
    if (!r) throw new GoogleError('sin_ruta', 'Google no encontró una ruta por carretera entre esos puntos.');
    return {
      dist_m: r.distanceMeters,
      dur_s: r.durationMillis != null ? r.durationMillis / 1000 : null,
      static_s: r.staticDurationMillis != null ? r.staticDurationMillis / 1000 : null,
      polyline: r.path?.length ? codificarPolilinea(r.path.map((p) => ({ lat: num(p.lat), lng: num(p.lng) }))) : null,
      legs: (r.legs ?? []).map((l) => ({ dist_m: l.distanceMeters, dur_s: l.durationMillis != null ? l.durationMillis / 1000 : null })),
    };
  }

  const svc = { geocode, computeRoute };
  return { geocode, routeMatrix, computeRoute, probar: (direccion) => probarServicio(svc, direccion) };
}
