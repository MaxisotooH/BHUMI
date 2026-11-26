// Mapa de Google Maps: carga del script, marcadores y trazado de rutas.
import { esc } from './lib.js';

let promesa = null;
let errorAuth = false;

let demo = false;
/** El servidor en modo demostración usa un mapa simulado local en vez de Google Maps. */
export function activarDemo(v) { demo = !!v; }
/** Google avisó que rechaza la API key (clave inválida, API no habilitada, facturación inactiva…). */
export const claveRechazada = () => errorAuth;

export function cargarGoogle(key) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  if (demo) {
    promesa ??= new Promise((ok, fail) => {
      window.__bhumiMapsListo = ok;
      const s = document.createElement('script');
      if (window.BHUMI_MAPS_DEMO_CODIGO) s.textContent = window.BHUMI_MAPS_DEMO_CODIGO; // versión de doble clic: el mapa viene dentro de la página
      else s.src = '/demo/maps-demo.js';
      s.onerror = () => { promesa = null; fail(new Error('No se pudo cargar el mapa de demostración.')); };
      document.head.appendChild(s);
    });
    return promesa;
  }
  if (!key) return Promise.reject(Object.assign(new Error('Falta la API key de Google Maps.'), { code: 'sin_clave' }));
  if (promesa) return promesa;
  promesa = new Promise((ok, fail) => {
    window.__bhumiMapsListo = ok;
    window.gm_authFailure = () => { errorAuth = true; };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&language=es&region=CL&libraries=marker,geometry&callback=__bhumiMapsListo`;
    s.async = true;
    s.onerror = () => { promesa = null; fail(Object.assign(new Error('No se pudo cargar Google Maps. Revisa tu conexión a internet.'), { code: 'red' })); };
    document.head.appendChild(s);
  });
  return promesa;
}

function mensajeVacio(caja, titulo, texto, enlace) {
  caja.innerHTML = `<div class="mapa-vacio"><div><h3>${esc(titulo)}</h3><p>${esc(texto)}</p>${enlace ? `<a class="btn btn-primario" href="${enlace.href}">${esc(enlace.texto)}</a>` : ''}</div></div>`;
}

/** Crea el mapa dentro de `caja`. Si no hay clave o falla la carga, deja un mensaje y devuelve null. */
export async function crearMapa(caja, { settings, centro = { lat: -33.45, lng: -70.66 }, zoom = 11 }) {
  caja.innerHTML = '<div class="gm-el"></div>';
  try {
    await cargarGoogle(settings.google_api_key);
    const { Map } = await google.maps.importLibrary('maps');
    await google.maps.importLibrary('marker');
    await google.maps.importLibrary('geometry');
    const mapa = new Map(caja.querySelector('.gm-el'), {
      center: centro, zoom, mapId: settings.google_map_id || 'DEMO_MAP_ID', mapTypeControl: false, streetViewControl: false, fullscreenControl: true, gestureHandling: 'greedy',
    });
    setTimeout(() => {
      if (errorAuth) mensajeVacio(caja, 'Google rechazó la API key', 'Revisa en Configuración → Google Maps que la clave sea correcta, que Maps JavaScript API esté habilitada y que la facturación esté activa.', { href: '#/configuracion?tab=google', texto: 'Abrir configuración' });
    }, 1500);
    return mapa;
  } catch (e) {
    if (e.code === 'sin_clave') mensajeVacio(caja, 'Falta la API key de Google Maps', 'El mapa, las distancias y los tiempos usan Google Maps. Pega tu API key en Configuración para activarlos.', { href: '#/configuracion?tab=google', texto: 'Configurar Google Maps' });
    else mensajeVacio(caja, 'No se pudo cargar el mapa', e.message);
    return null;
  }
}

export function pin({ texto = '', clase = '', color = null, onClick = null, titulo = '' }) {
  const d = document.createElement('div');
  d.className = `pin ${clase}`;
  if (color) d.style.setProperty('--c', color);
  d.textContent = texto;
  if (titulo) d.title = titulo;
  if (onClick) d.addEventListener('click', (e) => { e.stopPropagation(); onClick(e); });
  return d;
}

export function marcador(mapa, { lat, lng }, contenido, { titulo = '', z = 1 } = {}) {
  return new google.maps.marker.AdvancedMarkerElement({ map: mapa, position: { lat, lng }, content: contenido, title: titulo, zIndex: z });
}

/** Dibuja una ruta. Con polilínea codificada usa las calles reales; si no, une los puntos con una línea punteada. */
export function dibujarRuta(mapa, { polyline, puntos, color, grosor = 5, opacidad = 0.9 }) {
  let path;
  let aprox = false;
  if (polyline) path = google.maps.geometry.encoding.decodePath(polyline);
  else { path = puntos.map((p) => new google.maps.LatLng(p.lat, p.lng)); aprox = true; }
  const linea = new google.maps.Polyline({
    path, map: mapa, strokeColor: color, strokeOpacity: aprox ? 0 : opacidad, strokeWeight: grosor,
    icons: aprox ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.9, scale: 3 }, offset: '0', repeat: '14px' }] : undefined,
  });
  return { linea, path, aprox };
}

export function ajustar(mapa, puntos) {
  if (!puntos.length) return;
  const b = new google.maps.LatLngBounds();
  puntos.forEach((p) => b.extend({ lat: p.lat, lng: p.lng }));
  mapa.fitBounds(b, 60);
  if (puntos.length === 1) mapa.setZoom(14);
}

export const COLORES_RUTA = { A: '#2a78d6', B: '#eb6834', C: '#1baf7a', D: '#6250d6', MANUAL: '#6b7771' };
