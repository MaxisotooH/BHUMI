// Cliente de Google Maps Platform: Geocoding API y Routes API (computeRoutes / computeRouteMatrix).
// Todas las llamadas salen desde el servidor; la clave nunca se manda a servicios de terceros.
import { buscarComuna, buscarRegion } from '../data/chile.js';

export class GoogleError extends Error {
  constructor(code, message, detalle) {
    super(message);
    this.code = code;
    this.detalle = detalle;
  }
}

const ROUTES_BASE = 'https://routes.googleapis.com';
const parseDur = (d) => (d == null ? null : typeof d === 'string' ? parseFloat(d) : Number(d.seconds ?? 0));
const latLng = (p) => ({ latitude: p.lat, longitude: p.lng });

function errorDeHttp(status, body) {
  const msg = body?.error?.message ?? body?.error_message ?? '';
  if (status === 400) return new GoogleError('solicitud_invalida', `Google rechazó la solicitud: ${msg || 'datos no válidos'}`, body);
  if (status === 401 || status === 403) {
    return new GoogleError(
      'sin_permiso',
      `Google rechazó la API key (${msg || 'sin permiso'}). Revisa que Routes API y Geocoding API estén habilitadas y que la facturación esté activa.`,
      body
    );
  }
  if (status === 429) return new GoogleError('cuota', 'Se superó la cuota de Google Maps. Intenta de nuevo en unos minutos.', body);
  return new GoogleError('google', `Google respondió con error ${status}. ${msg}`.trim(), body);
}


/** Texto de búsqueda para una dirección chilena. */
export const textoDireccion = ({ direccion, comuna, region }) => [direccion, comuna, region && !comuna ? region : null, 'Chile'].filter(Boolean).join(', ');

/** Convierte un resultado de Geocoding (servicio web o biblioteca de navegador) en coordenadas, comuna y región. */
export function resultadoGeocode(r, { comuna, region }) {
  const comp = (t) => r.address_components?.find((c) => c.types.includes(t))?.long_name ?? null;
  const comunaGoogle = comp('administrative_area_level_3') ?? comp('locality') ?? comp('sublocality');
  const hit = buscarComuna(comunaGoogle) ?? buscarComuna(comuna);
  const regionGoogle = buscarRegion(comp('administrative_area_level_1'));
  const aproximada = r.partial_match === true || ['APPROXIMATE', 'GEOMETRIC_CENTER'].includes(r.geometry?.location_type);
  return {
    lat: r.geometry.location.lat,
    lng: r.geometry.location.lng,
    direccion_formateada: r.formatted_address,
    comuna: hit?.comuna ?? comunaGoogle ?? comuna ?? null,
    region: hit?.region ?? regionGoogle ?? region ?? null,
    precision: aproximada ? 'aproximada' : 'exacta',
    location_type: r.geometry?.location_type ?? null,
  };
}

/** Prueba de la API key: revisa por separado Geocoding y Routes para saber cuál falta habilitar. */
export async function probarServicio(svc, direccion) {
  const out = { geocoding: { ok: false }, routes: { ok: false } };
  let geo = null;
  try {
    geo = await svc.geocode({ direccion, comuna: null });
    out.geocoding = { ok: true, direccion: geo.direccion_formateada, lat: geo.lat, lng: geo.lng };
  } catch (e) {
    out.geocoding = { ok: false, error: e.message };
  }
  const p = geo ? { lat: geo.lat, lng: geo.lng } : { lat: -33.4489, lng: -70.6693 };
  try {
    const r = await svc.computeRoute([p, { lat: p.lat + 0.01, lng: p.lng + 0.01 }], { traffic: false });
    out.routes = { ok: true, metros: r.dist_m };
  } catch (e) {
    out.routes = { ok: false, error: e.message };
  }
  return out;
}

export function createGoogle({ getKey, fetchImpl = globalThis.fetch }) {
  const clave = () => {
    const k = (getKey() ?? '').trim();
    if (!k) throw new GoogleError('sin_clave', 'Falta la API key de Google Maps. Agrégala en Configuración → Google Maps.');
    return k;
  };

  async function llamar(url, opts) {
    let res;
    try {
      res = await fetchImpl(url, opts);
    } catch (e) {
      throw new GoogleError('red', 'No se pudo conectar con Google Maps. Revisa tu conexión a internet.', String(e));
    }
    let body = null;
    try { body = await res.json(); } catch { /* sin cuerpo */ }
    if (!res.ok) throw errorDeHttp(res.status, body);
    return body;
  }

  /** Dirección → coordenadas, comuna y región. */
  async function geocode({ direccion, comuna, region }) {
    const k = clave();
    const partes = textoDireccion({ direccion, comuna, region });
    const url =
      'https://maps.googleapis.com/maps/api/geocode/json?' +
      new URLSearchParams({ address: partes, components: 'country:CL', language: 'es', region: 'cl', key: k });
    const body = await llamar(url);
    if (body.status === 'ZERO_RESULTS') throw new GoogleError('sin_resultados', `Google no encontró la dirección "${partes}".`);
    if (body.status === 'REQUEST_DENIED') throw new GoogleError('sin_permiso', `Google rechazó la API key (${body.error_message ?? 'REQUEST_DENIED'}). Habilita Geocoding API.`, body);
    if (body.status === 'OVER_QUERY_LIMIT' || body.status === 'OVER_DAILY_LIMIT') throw new GoogleError('cuota', 'Se superó la cuota de Geocoding API.', body);
    if (body.status !== 'OK' || !body.results?.length) throw new GoogleError('google', `Geocoding respondió ${body.status}.`, body);

    return resultadoGeocode(body.results[0], { comuna, region });
  }

  /**
   * Matriz de distancias y tiempos entre todos los puntos.
   * Devuelve matrices cuadradas en metros y segundos; null donde Google no encontró ruta.
   */
  async function routeMatrix(puntos, { departureTime = null, traffic = true } = {}) {
    const k = clave();
    const n = puntos.length;
    const dist = Array.from({ length: n }, () => Array(n).fill(null));
    const dur = Array.from({ length: n }, () => Array(n).fill(null));
    const est = Array.from({ length: n }, () => Array(n).fill(null));
    const porLlamada = Math.max(1, Math.floor(625 / n)); // máximo 625 elementos por llamada
    const waypoint = (p) => ({ waypoint: { location: { latLng: latLng(p) } } });

    for (let desde = 0; desde < n; desde += porLlamada) {
      const origenes = puntos.slice(desde, desde + porLlamada);
      const body = {
        origins: origenes.map(waypoint),
        destinations: puntos.map(waypoint),
        travelMode: 'DRIVE',
        routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
        languageCode: 'es-CL',
        units: 'METRIC',
      };
      if (traffic && departureTime) body.departureTime = departureTime;
      const resp = await llamar(`${ROUTES_BASE}/distanceMatrix/v2:computeRouteMatrix`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': k,
          'X-Goog-FieldMask': 'originIndex,destinationIndex,duration,staticDuration,distanceMeters,status,condition',
        },
        body: JSON.stringify(body),
      });
      const elementos = Array.isArray(resp) ? resp : resp?.elements ?? [];
      for (const e of elementos) {
        const i = desde + (e.originIndex ?? 0);
        const j = e.destinationIndex ?? 0;
        const fallo = (e.status?.code ?? 0) !== 0 || e.condition === 'ROUTE_NOT_FOUND';
        if (fallo || e.distanceMeters == null) continue;
        dist[i][j] = e.distanceMeters;
        dur[i][j] = parseDur(e.duration);
        est[i][j] = parseDur(e.staticDuration) ?? dur[i][j];
      }
    }
    for (let i = 0; i < n; i++) { dist[i][i] = 0; dur[i][i] = 0; est[i][i] = 0; }
    return { dist, dur, est };
  }

  /** Ruta completa pasando por los puntos en el orden dado (máximo 27 puntos en total). */
  async function computeRoute(puntos, { departureTime = null, traffic = true } = {}) {
    const k = clave();
    if (puntos.length < 2) throw new GoogleError('solicitud_invalida', 'Se necesitan al menos dos puntos.');
    const wp = (p) => ({ location: { latLng: latLng(p) } });
    const body = {
      origin: wp(puntos[0]),
      destination: wp(puntos[puntos.length - 1]),
      travelMode: 'DRIVE',
      routingPreference: traffic ? 'TRAFFIC_AWARE' : 'TRAFFIC_UNAWARE',
      languageCode: 'es-CL',
      units: 'METRIC',
    };
    if (puntos.length > 2) body.intermediates = puntos.slice(1, -1).map(wp);
    if (traffic && departureTime) body.departureTime = departureTime;
    const resp = await llamar(`${ROUTES_BASE}/directions/v2:computeRoutes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': k,
        'X-Goog-FieldMask':
          'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.staticDuration',
      },
      body: JSON.stringify(body),
    });
    const r = resp?.routes?.[0];
    if (!r) throw new GoogleError('sin_ruta', 'Google no encontró una ruta por carretera entre esos puntos.');
    return {
      dist_m: r.distanceMeters,
      dur_s: parseDur(r.duration),
      static_s: parseDur(r.staticDuration),
      polyline: r.polyline?.encodedPolyline ?? null,
      legs: (r.legs ?? []).map((l) => ({ dist_m: l.distanceMeters, dur_s: parseDur(l.duration) })),
    };
  }

  const svc = { geocode, computeRoute };
  const probar = (direccion) => probarServicio(svc, direccion);

  return { geocode, routeMatrix, computeRoute, probar };
}
