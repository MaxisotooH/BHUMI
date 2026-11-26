import test from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleNavegador, errorDeGoogle } from '../navegador/google-navegador.js';
import { GoogleError } from '../server/services/google.js';
import { codificarPolilinea } from '../server/services/polilinea.js';

/** Imita las bibliotecas "geocoding" y "routes" de la Maps JavaScript API con las formas de datos de su documentación. */
function fingirMaps({ geocode, matriz, ruta } = {}) {
  const llamadas = { geocode: [], matriz: [], ruta: [] };
  globalThis.window = { google: { maps: { importLibrary: async (nombre) => {
    if (nombre === 'geocoding') return { Geocoder: class { async geocode(p) { llamadas.geocode.push(p); return geocode(p); } } };
    if (nombre === 'routes') {
      return {
        RouteMatrix: { computeRouteMatrix: async (p) => { llamadas.matriz.push(p); return matriz(p); } },
        Route: { computeRoutes: async (p) => { llamadas.ruta.push(p); return ruta(p); } },
      };
    }
    throw new Error(`biblioteca desconocida ${nombre}`);
  } } } };
  return llamadas;
}
const servicio = (clave = 'K') => createGoogleNavegador({ getKey: () => clave, cargarMaps: async () => {} });

test('geocode: usa Chile como restricción y devuelve coordenadas, comuna y región', async () => {
  const ll = { lat: () => -33.4117, lng: () => -70.5776 }; // la biblioteca entrega LatLng con funciones
  const llamadas = fingirMaps({ geocode: async () => ({ results: [{
    formatted_address: 'Av. Apoquindo 4500, Las Condes, Chile',
    geometry: { location: ll, location_type: 'ROOFTOP' },
    address_components: [{ long_name: 'Las Condes', types: ['locality'] }, { long_name: 'Región Metropolitana de Santiago', types: ['administrative_area_level_1'] }],
  }] }) });
  const r = await servicio().geocode({ direccion: 'Av. Apoquindo 4500', comuna: 'Las Condes', region: null });
  assert.deepEqual(llamadas.geocode[0], { address: 'Av. Apoquindo 4500, Las Condes, Chile', componentRestrictions: { country: 'CL' }, region: 'cl', language: 'es' });
  assert.equal(r.lat, -33.4117);
  assert.equal(r.lng, -70.5776);
  assert.equal(r.comuna, 'Las Condes');
  assert.equal(r.region, 'Metropolitana de Santiago');
  assert.equal(r.precision, 'exacta');
});

test('geocode: sin resultados, clave faltante y clave rechazada se informan con los errores de siempre', async () => {
  fingirMaps({ geocode: async () => ({ results: [] }) });
  await assert.rejects(servicio().geocode({ direccion: 'Calle inexistente 1' }), (e) => e instanceof GoogleError && e.code === 'sin_resultados');
  fingirMaps({ geocode: async () => { throw Object.assign(new Error('x'), { code: 'ZERO_RESULTS' }); } });
  await assert.rejects(servicio().geocode({ direccion: 'Calle inexistente 2' }), (e) => e.code === 'sin_resultados');
  await assert.rejects(servicio('  ').geocode({ direccion: 'a' }), (e) => e.code === 'sin_clave');
  fingirMaps({ geocode: async () => { throw Object.assign(new Error('The provided API key is invalid'), { code: 'REQUEST_DENIED' }); } });
  await assert.rejects(servicio().geocode({ direccion: 'a' }), (e) => e.code === 'sin_permiso' && /API key/.test(e.message));
});

test('routeMatrix: pasa tráfico y hora de salida, convierte milisegundos a segundos y deja null donde no hay ruta', async () => {
  const puntos = [{ lat: -33.4, lng: -70.6 }, { lat: -33.5, lng: -70.7 }, { lat: -33.6, lng: -70.8 }];
  const llamadas = fingirMaps({ matriz: async (p) => ({ matrix: { rows: p.origins.map((o, a) => ({ items: p.destinations.map((d, b) => (
    a === 0 && b === 2 ? { condition: 'ROUTE_NOT_FOUND' }
      : { condition: 'ROUTE_EXISTS', distanceMeters: 1000 * (a + 1) + b, durationMillis: 60000 * (a + 1) + b * 1000, staticDurationMillis: 30000 * (a + 1) }
  )) })) } }) });
  const salida = '2026-12-01T11:00:00.000Z';
  const { dist, dur, est } = await servicio().routeMatrix(puntos, { departureTime: salida, traffic: true });
  const p = llamadas.matriz[0];
  assert.equal(p.travelMode, 'DRIVING');
  assert.equal(p.routingPreference, 'TRAFFIC_AWARE');
  assert.ok(p.departureTime instanceof Date && p.departureTime.toISOString() === salida);
  assert.deepEqual(p.origins[0], { lat: -33.4, lng: -70.6 });
  assert.ok(p.fields.includes('staticDurationMillis'));
  assert.equal(dist[1][2], 2002);
  assert.equal(dur[1][0], 120);
  assert.equal(est[1][0], 60);
  assert.equal(dist[0][2], null, 'ROUTE_NOT_FOUND queda en null');
  assert.deepEqual([dist[0][0], dur[2][2], est[1][1]], [0, 0, 0], 'la diagonal es cero');
  await servicio().routeMatrix(puntos, { traffic: false });
  assert.equal(llamadas.matriz[1].routingPreference, 'TRAFFIC_UNAWARE');
  assert.equal(llamadas.matriz[1].departureTime, undefined, 'sin tráfico no se manda hora de salida');
});

test('routeMatrix: con muchos puntos divide en llamadas de a lo más 625 elementos', async () => {
  const puntos = Array.from({ length: 30 }, (_, i) => ({ lat: -33 - i / 100, lng: -70 }));
  const llamadas = fingirMaps({ matriz: async (p) => ({ matrix: { rows: p.origins.map(() => ({ items: p.destinations.map(() => ({ distanceMeters: 1, durationMillis: 1000, staticDurationMillis: 1000 })) })) } }) });
  const { dist } = await servicio().routeMatrix(puntos);
  assert.equal(llamadas.matriz.length, 2, '30 puntos → 20 orígenes por llamada → 2 llamadas');
  assert.ok(llamadas.matriz.every((p) => p.origins.length * p.destinations.length <= 625));
  assert.equal(dist[29][0], 1, 'los resultados de la segunda llamada caen en las filas correctas');
});

test('computeRoute: orden de paradas, tramos, polilínea codificada y errores', async () => {
  const camino = [{ lat: -33.4331, lng: -70.6845, altitude: 0 }, { lat: -33.42, lng: -70.65, altitude: 0 }, { lat: -33.4117, lng: -70.5776, altitude: 0 }];
  const llamadas = fingirMaps({ ruta: async () => ({ routes: [{
    distanceMeters: 15000, durationMillis: 1800000, staticDurationMillis: 1500000, path: camino,
    legs: [{ distanceMeters: 9000, durationMillis: 1000000 }, { distanceMeters: 6000, durationMillis: 800000 }],
  }] }) });
  const pts = [{ lat: -33.4331, lng: -70.6845 }, { lat: -33.42, lng: -70.65 }, { lat: -33.4117, lng: -70.5776 }];
  const r = await servicio().computeRoute(pts, { traffic: false });
  const p = llamadas.ruta[0];
  assert.deepEqual(p.origin, pts[0]);
  assert.deepEqual(p.destination, pts[2]);
  assert.deepEqual(p.intermediates, [{ location: pts[1] }]);
  assert.equal(p.routingPreference, 'TRAFFIC_UNAWARE');
  assert.ok(p.fields.includes('path') && p.fields.includes('legs'));
  assert.equal(r.dist_m, 15000);
  assert.equal(r.dur_s, 1800);
  assert.equal(r.static_s, 1500);
  assert.equal(r.polyline, codificarPolilinea(pts));
  assert.deepEqual(r.legs, [{ dist_m: 9000, dur_s: 1000 }, { dist_m: 6000, dur_s: 800 }]);

  fingirMaps({ ruta: async () => ({ routes: [] }) });
  await assert.rejects(servicio().computeRoute(pts), (e) => e.code === 'sin_ruta');
  fingirMaps({ ruta: async () => ({ routes: [] }) });
  await assert.rejects(servicio().computeRoute([pts[0]]), (e) => e.code === 'solicitud_invalida');
});

test('probar: informa por separado si Geocoding y Routes responden', async () => {
  fingirMaps({
    geocode: async () => ({ results: [{ formatted_address: 'Plaza, Chile', geometry: { location: { lat: -33.45, lng: -70.66 } }, address_components: [] }] }),
    ruta: async () => { throw Object.assign(new Error('Routes API has not been used in project'), { code: 'PERMISSION_DENIED' }); },
  });
  const r = await servicio().probar('Plaza de Armas');
  assert.equal(r.geocoding.ok, true);
  assert.equal(r.routes.ok, false);
  assert.match(r.routes.error, /Routes API/);
});

test('errorDeGoogle clasifica los errores típicos', () => {
  assert.equal(errorDeGoogle({ code: 'OVER_QUERY_LIMIT' }).code, 'cuota');
  assert.equal(errorDeGoogle(Object.assign(new Error('No se pudo cargar Google Maps. Revisa tu conexión a internet.'), { code: 'red' })).message, 'No se pudo cargar Google Maps. Revisa tu conexión a internet.');
  assert.equal(errorDeGoogle(new Error('Failed to fetch')).code, 'red');
  assert.equal(errorDeGoogle({ code: 'INVALID_ARGUMENT', message: 'Timestamp must be set to a future time' }).code, 'solicitud_invalida');
  assert.equal(errorDeGoogle(new Error('cualquier otra cosa')).code, 'google');
});
