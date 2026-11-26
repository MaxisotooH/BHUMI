// La ruta de un despacho lista para el conductor: enlaces de Google Maps con el recorrido ordenado y un texto para WhatsApp.
// Los enlaces usan coordenadas, así Google Maps no vuelve a interpretar direcciones. Google Maps admite hasta 9 paradas intermedias
// por enlace (3 si se abre en el navegador del celular), por eso un recorrido largo se parte en tramos que se encadenan.
import { getSettings, num } from '../db.js';
import { seguridadDeParadas, SEGURIDAD } from './zonas.js';
import { itemsDeEntrega } from './stops.js';

const coord = (p) => `${Number(p.lat).toFixed(6)},${Number(p.lng).toFixed(6)}`;

/** Enlaces de Google Maps: del punto de partida pasando por las paradas en orden. `max` = paradas intermedias por enlace (1 a 9). */
export function enlacesGoogleMaps(inicio, paradas, { final = null, max = 9 } = {}) {
  const tope = Math.min(9, Math.max(1, Math.floor(max)));
  const destinos = [...paradas, ...(final ? [final] : [])];
  const enlaces = [];
  let origen = inicio;
  for (let i = 0; i < destinos.length; i += tope + 1) {
    const grupo = destinos.slice(i, i + tope + 1);
    const destino = grupo.at(-1);
    const intermedias = grupo.slice(0, -1);
    const p = new URLSearchParams({ api: '1', origin: coord(origen), destination: coord(destino), travelmode: 'driving' });
    if (intermedias.length) p.set('waypoints', intermedias.map(coord).join('|'));
    enlaces.push({ tramo: enlaces.length + 1, desde: origen, hasta: destino, paradas: grupo.filter((x) => x !== final), url: `https://www.google.com/maps/dir/?${p.toString()}` });
    origen = destino;
  }
  return enlaces;
}

/** Número para wa.me: solo dígitos y con el código de Chile si falta. */
export function telefonoWhatsapp(tel) {
  const d = String(tel ?? '').replace(/\D/g, '');
  if (!d) return null;
  if (d.startsWith('56')) return d;
  if (d.length === 9) return `56${d}`;
  if (d.length === 8) return `569${d}`;
  return d;
}

const nombreNivel = (id) => SEGURIDAD.find((s) => s.id === id)?.nombre ?? id;

/**
 * @returns null si el despacho no existe.
 */
export function rutaParaConductor(db, tripId, { max = 9 } = {}) {
  const t = db.prepare(`SELECT t.*, v.marca, v.modelo, v.patente, dr.nombre AS conductor, dr.telefono AS telefono_conductor
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id WHERE t.id = ?`).get(tripId);
  if (!t) return null;
  const s = getSettings(db);
  const base = num(s.deposito_lat) != null ? { lat: num(s.deposito_lat), lng: num(s.deposito_lng), nombre: s.deposito_nombre } : null;
  const paradas = db.prepare(`SELECT s.id AS stop_id, s.orden, s.km_tramo, s.min_tramo, s.delivery_id, c.nombre, c.direccion, c.comuna, c.telefono,
      COALESCE(d.lat, c.lat) AS lat, COALESCE(d.lng, c.lng) AS lng, d.ventana_desde, d.ventana_hasta
    FROM trip_stops s LEFT JOIN clients c ON c.id = s.client_id LEFT JOIN deliveries d ON d.id = s.delivery_id WHERE s.trip_id = ? ORDER BY s.orden`).all(tripId)
    .map((p) => ({
      ...p,
      ventana: p.ventana_desde ? `${p.ventana_desde}${p.ventana_hasta ? `–${p.ventana_hasta}` : ''}` : p.ventana_hasta ? `hasta ${p.ventana_hasta}` : null,
      productos: p.delivery_id ? itemsDeEntrega(db, p.delivery_id).map((i) => `${i.cantidad} ${i.producto ?? i.descripcion ?? ''}`.trim()) : [],
    }));
  const seguridad = seguridadDeParadas(db, paradas);
  const sinUbicacion = paradas.filter((p) => p.lat == null || p.lng == null).map((p) => p.nombre);
  const avisos = [];
  if (!base) avisos.push('Falta ubicar la base (Configuración › Base): el enlace partirá desde la primera parada.');
  if (sinUbicacion.length) avisos.push(`Sin ubicación: ${sinUbicacion.join(', ')}. No entran al enlace de Google Maps.`);

  const conUbicacion = paradas.filter((p) => p.lat != null && p.lng != null);
  let enlaces = [];
  if (conUbicacion.length) {
    const retorna = !!t.retorna_base && base;
    if (base) enlaces = enlacesGoogleMaps(base, conUbicacion, { final: retorna ? base : null, max });
    else if (conUbicacion.length >= 2) enlaces = enlacesGoogleMaps(conUbicacion[0], conUbicacion.slice(1), { max });
  }

  const lineas = [`*Ruta del ${t.fecha}*${t.hora_salida ? ` — salida ${t.hora_salida}` : ''}`, `Vehículo: ${t.marca} ${t.modelo}${t.patente ? ` (${t.patente})` : ''}`];
  if (base) lineas.push(`Parte de: ${[s.deposito_direccion, s.deposito_comuna].filter(Boolean).join(', ')}`);
  lineas.push('');
  for (const p of paradas) {
    lineas.push(`${p.orden}. *${p.nombre}* — ${[p.direccion, p.comuna].filter(Boolean).join(', ') || 'sin dirección'}`);
    const extra = [p.telefono ? `Tel. ${p.telefono}` : null, p.ventana ? `Horario: ${p.ventana}` : null, p.productos.length ? `Lleva: ${p.productos.join(', ')}` : null].filter(Boolean);
    if (extra.length) lineas.push(`   ${extra.join(' · ')}`);
  }
  if (seguridad.alertas.length) {
    lineas.push('', '*Precauciones*');
    for (const a of seguridad.alertas) lineas.push(`• ${a.comuna} (${nombreNivel(a.nivel).toLowerCase()})${a.horario_recomendado ? `: ${a.horario_recomendado}` : ''}${a.observaciones ? `. ${a.observaciones}` : ''}`);
  }
  if (enlaces.length) {
    lineas.push('', '*Ruta en Google Maps*');
    for (const e of enlaces) lineas.push(enlaces.length > 1 ? `Tramo ${e.tramo}: ${e.url}` : e.url);
  }
  const texto = lineas.join('\n');
  const numero = telefonoWhatsapp(t.telefono_conductor);
  return {
    trip_id: t.id, fecha: t.fecha, conductor: t.conductor ?? null,
    base, paradas, enlaces, seguridad, avisos, texto,
    whatsapp_url: `https://wa.me/${numero ?? ''}?text=${encodeURIComponent(texto)}`,
    whatsapp_numero: numero,
  };
}
