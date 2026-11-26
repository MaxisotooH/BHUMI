// Google simulado para pruebas: responde con la misma forma de datos que Geocoding y Routes API.
// Las distancias se calculan en línea recta x 1,3 (aproximación de calles) solo para probar la lógica.
import { haversineKm } from '../server/services/optimizer.js';

export const DIRECCIONES = {
  'Poeta Pedro Prado 1536, Quinta Normal': { lat: -33.4331, lng: -70.6845, comuna: 'Quinta Normal', region: 'Región Metropolitana de Santiago' },
  'Av. Apoquindo 4500, Las Condes': { lat: -33.4117, lng: -70.5776, comuna: 'Las Condes', region: 'Región Metropolitana de Santiago' },
  'Av. Providencia 1234, Providencia': { lat: -33.4262, lng: -70.6152, comuna: 'Providencia', region: 'Región Metropolitana de Santiago' },
  'Av. Maipú 500, Maipú': { lat: -33.5107, lng: -70.7571, comuna: 'Maipú', region: 'Región Metropolitana de Santiago' },
  'Av. Vicuña Mackenna 6000, La Florida': { lat: -33.5222, lng: -70.5987, comuna: 'La Florida', region: 'Región Metropolitana de Santiago' },
  'Av. Departamental 100, San Joaquín': { lat: -33.4966, lng: -70.6203, comuna: 'San Joaquín', region: 'Región Metropolitana de Santiago' },
  'Av. Pajaritos 3000, Estación Central': { lat: -33.4576, lng: -70.7126, comuna: 'Estación Central', region: 'Región Metropolitana de Santiago' },
};

const rad = (m) => Math.round(m);

export { codificarPolilinea } from '../server/services/polilinea.js';
import { codificarPolilinea } from '../server/services/polilinea.js';

export function crearFakeGoogle() {
  const llamadas = { geocode: 0, matrix: 0, route: 0 };
  async function fetchImpl(url, opts = {}) {
    const u = String(url);
    const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
    if (u.includes('/geocode/json')) {
      llamadas.geocode++;
      const addr = new URL(u).searchParams.get('address');
      const hit = Object.entries(DIRECCIONES).find(([k]) => addr.startsWith(k.split(',')[0]));
      if (!hit) return json({ status: 'ZERO_RESULTS', results: [] });
      const d = hit[1];
      return json({
        status: 'OK',
        results: [{
          formatted_address: `${hit[0]}, Chile`,
          geometry: { location: { lat: d.lat, lng: d.lng }, location_type: 'ROOFTOP' },
          address_components: [
            { long_name: d.comuna, types: ['administrative_area_level_3', 'political'] },
            { long_name: d.region, types: ['administrative_area_level_1', 'political'] },
          ],
        }],
      });
    }
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (!opts.headers?.['X-Goog-Api-Key']) return json({ error: { status: 'UNAUTHENTICATED', message: 'sin clave' } }, 401);
    if (u.endsWith(':computeRouteMatrix')) {
      llamadas.matrix++;
      const ll = (w) => ({ lat: w.waypoint.location.latLng.latitude, lng: w.waypoint.location.latLng.longitude });
      const O = body.origins.map(ll), D = body.destinations.map(ll);
      const out = [];
      O.forEach((o, i) => D.forEach((d, j) => {
        const km = i === 0 && j === 0 ? 0 : haversineKm(o, d) * 1.3;
        const seg = (km / 35) * 3600; // 35 km/h promedio
        const el = { originIndex: i, destinationIndex: j, status: {}, distanceMeters: rad(km * 1000), duration: `${Math.round(seg * (body.routingPreference === 'TRAFFIC_AWARE' ? 1.2 : 1))}s`, staticDuration: `${Math.round(seg)}s`, condition: 'ROUTE_EXISTS' };
        out.push(el);
      }));
      return json(out);
    }
    if (u.endsWith(':computeRoutes')) {
      llamadas.route++;
      const ll = (w) => ({ lat: w.location.latLng.latitude, lng: w.location.latLng.longitude });
      const pts = [ll(body.origin), ...(body.intermediates ?? []).map(ll), ll(body.destination)];
      const legs = [];
      for (let i = 0; i < pts.length - 1; i++) {
        const km = haversineKm(pts[i], pts[i + 1]) * 1.3;
        legs.push({ distanceMeters: rad(km * 1000), duration: `${Math.round((km / 35) * 3600 * 1.2)}s` });
      }
      return json({
        routes: [{
          distanceMeters: legs.reduce((a, l) => a + l.distanceMeters, 0),
          duration: `${legs.reduce((a, l) => a + parseInt(l.duration, 10), 0)}s`,
          polyline: { encodedPolyline: codificarPolilinea(pts) },
          legs,
        }],
      });
    }
    return json({ error: { message: 'no soportado' } }, 404);
  }
  return { fetchImpl, llamadas };
}
