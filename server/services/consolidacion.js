// Consolidación de despachos y uso de la capacidad de carga.
// Junta entregas pendientes de sectores cercanos que caben en un mismo vehículo (por cubicaje y peso) y
// busca despachos ya planificados, con espacio libre, donde cabría una entrega de un solo producto.
// Un ahorro en dinero solo se muestra cuando hay distancias reales guardadas (de rutas ya calculadas con Google).
import { getSettings, num, precioCombustible } from '../db.js';
import { agruparCercanos, haversineKm, resolverRuta } from './optimizer.js';
import { costoArco, costoRealPorKm } from './costs.js';
import { CubicajeError, cubicar, medidasVehiculo } from './cubicaje.js';

const k = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;

/** Productos y cantidades de varias entregas, listos para cubicar. `sinProducto` son líneas sin producto del catálogo (no tienen medidas). */
export function itemsDeEntregas(db, ids) {
  const sel = db.prepare(`SELECT di.cantidad, di.descripcion, di.product_id, p.id AS pid, p.nombre, p.sku, p.peso_kg,
      p.largo_cm, p.ancho_cm, p.alto_cm, p.apilable, p.rotable
    FROM delivery_items di LEFT JOIN products p ON p.id = di.product_id WHERE di.delivery_id = ?`);
  const items = [];
  const sinProducto = [];
  for (const id of ids) {
    for (const r of sel.all(id)) {
      if (r.pid == null) { sinProducto.push(r.descripcion ?? 'Producto sin nombre'); continue; }
      items.push({ producto: { id: r.pid, nombre: r.nombre, sku: r.sku, peso_kg: r.peso_kg, largo_cm: r.largo_cm, ancho_cm: r.ancho_cm, alto_cm: r.alto_cm, apilable: r.apilable, rotable: r.rotable }, cantidad: r.cantidad });
    }
  }
  return { items, sinProducto };
}

/** Cubicaje de las entregas indicadas en un vehículo. Nunca lanza: devuelve el resultado o lo que falta para calcularlo. */
export function cubicarEntregas(db, vehiculo, ids) {
  const { items, sinProducto } = itemsDeEntregas(db, ids);
  if (!items.length && !sinProducto.length) return { ok: false, motivo: 'sin_items', faltan: { vehiculo: [], productos: [], sin_producto: [] } };
  try {
    const r = cubicar(vehiculo, items);
    return { ok: true, resultado: r, sin_producto: sinProducto };
  } catch (e) {
    if (!(e instanceof CubicajeError)) throw e;
    return { ok: false, motivo: 'faltan_medidas', faltan: { ...e.extra, sin_producto: sinProducto } };
  }
}

/** Matriz de distancias con lo que ya está guardado (cualquier momento). Null si falta algún tramo. */
export function matrizDesdeCache(db, puntos) {
  const sel = db.prepare('SELECT dist_m, dur_s, static_s FROM route_cache WHERE o = ? AND d = ? ORDER BY fetched_at DESC LIMIT 1');
  const n = puntos.length;
  const km = Array.from({ length: n }, () => Array(n).fill(0));
  const min = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j || k(puntos[i]) === k(puntos[j])) continue;
      const r = sel.get(k(puntos[i]), k(puntos[j]));
      if (!r || r.dist_m == null) return null;
      km[i][j] = r.dist_m / 1000;
      min[i][j] = (r.dur_s ?? r.static_s ?? 0) / 60;
    }
  }
  return { km, min };
}

/** El vehículo activo más económico por kilómetro cuyo costo se puede calcular. */
export function vehiculoMasEconomico(db, { hoy = null, soloConMedidas = false } = {}) {
  const fecha = hoy ?? new Date().toISOString().slice(0, 10);
  return db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo'").all()
    .filter((v) => !soloConMedidas || medidasVehiculo(v).faltan.length === 0)
    .map((v) => ({ v, precio: precioCombustible(db, v.combustible, fecha)?.precio ?? null }))
    .map((o) => ({ ...o, ck: costoRealPorKm(o.v, o.precio) }))
    .filter((o) => o.ck.calculable)
    .sort((a, b) => a.ck.totalKm - b.ck.totalKm)[0] ?? null;
}

function entregasPendientes(db) {
  return db.prepare(`SELECT d.id, d.fecha, d.client_id, COALESCE(d.lat, c.lat) AS lat, COALESCE(d.lng, c.lng) AS lng,
      c.nombre, c.empresa, c.comuna, c.region
    FROM deliveries d JOIN clients c ON c.id = d.client_id
    WHERE d.estado IN ('pendiente', 'reprogramada') AND d.trip_id IS NULL AND COALESCE(d.lat, c.lat) IS NOT NULL AND COALESCE(d.lng, c.lng) IS NOT NULL
    ORDER BY d.id`).all();
}

const productosDe = (items) => [...new Map(items.map((i) => [i.producto.id, i.producto])).values()];

function describirEntrega(db, e) {
  const { items, sinProducto } = itemsDeEntregas(db, [e.id]);
  const prods = productosDe(items);
  const peso = items.length && !sinProducto.length && items.every((i) => i.producto.peso_kg > 0) ? items.reduce((a, i) => a + i.cantidad * i.producto.peso_kg, 0) : null;
  return {
    delivery_id: e.id, client_id: e.client_id, cliente: e.nombre, comuna: e.comuna ?? null, fecha: e.fecha ?? null,
    unidades: items.reduce((a, i) => a + i.cantidad, 0), productos: prods.map((p) => p.nombre), peso_kg: peso,
    un_solo_producto: prods.length === 1 && !sinProducto.length, lat: e.lat, lng: e.lng,
  };
}

/** Cuántos despachos (del vehículo dado) hacen falta para llevar estas entregas, juntándolas en orden. Null si no se puede determinar. */
function despachosNecesarios(db, vehiculo, ids) {
  let actual = [];
  let n = 0;
  for (const id of ids) {
    const prueba = cubicarEntregas(db, vehiculo, [...actual, id]);
    if (!prueba.ok) return null;
    if (prueba.resultado.cabe) { actual.push(id); continue; }
    // No cabe junto con lo anterior: se parte aquí. Si la entrega sola no cabe, no hay consolidación posible.
    if (!actual.length) return null;
    n++;
    actual = [id];
    const sola = cubicarEntregas(db, vehiculo, actual);
    if (!sola.ok || !sola.resultado.cabe) return null;
  }
  return actual.length ? n + 1 : n;
}

/**
 * Entregas pendientes cercanas entre sí que se pueden despachar juntas.
 * Para cada grupo comprueba qué vehículos pueden llevarlo completo (volumen real de las cajas y peso).
 */
export function sugerirConsolidacion(db) {
  const s = getSettings(db);
  const radio = num(s.radio_cercania_km) ?? 5;
  const costoHora = num(s.costo_hora_conductor);
  const deposito = num(s.deposito_lat) != null ? { lat: num(s.deposito_lat), lng: num(s.deposito_lng) } : null;
  const vehiculos = db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo' ORDER BY id").all();
  const mejor = vehiculoMasEconomico(db, { soloConMedidas: true }) ?? vehiculoMasEconomico(db);
  const pend = entregasPendientes(db);
  const desc = new Map(pend.map((e) => [e.id, describirEntrega(db, e)]));

  const grupos = [];
  const sinMedidas = new Map();
  for (const g of agruparCercanos(pend, radio).filter((x) => x.length >= 2)) {
    const ids = g.map((e) => e.id);
    const opciones = vehiculos.map((v) => {
      const c = cubicarEntregas(db, v, ids);
      const nombre = v.nombre ?? `${v.marca} ${v.modelo}`;
      if (!c.ok) {
        for (const p of c.faltan.productos ?? []) sinMedidas.set(`p${p.id}`, { tipo: 'producto', id: p.id, nombre: p.nombre, faltan: p.faltan });
        if ((c.faltan.vehiculo ?? []).length) sinMedidas.set(`v${v.id}`, { tipo: 'vehiculo', id: v.id, nombre, faltan: c.faltan.vehiculo });
        return { vehicle_id: v.id, nombre, calculable: false, faltan: c.faltan };
      }
      const r = c.resultado;
      return { vehicle_id: v.id, nombre, calculable: true, cabe: r.cabe, limitante: r.limitante, ocupacion_volumen_pct: r.ocupacion_volumen_pct, peso_pct: r.peso_pct, sin_producto: c.sin_producto };
    });
    const caben = opciones.filter((o) => o.calculable && o.cabe);
    let evitables = null;
    let vehiculoSugerido = null;
    if (caben.length) {
      // El más económico de los que lo llevan completo
      const costo = (o) => costoRealPorKm(vehiculos.find((v) => v.id === o.vehicle_id), precioCombustible(db, vehiculos.find((v) => v.id === o.vehicle_id).combustible)?.precio ?? null).totalKm ?? Infinity;
      vehiculoSugerido = [...caben].sort((a, b) => costo(a) - costo(b))[0];
      evitables = ids.length - 1;
    } else if (opciones.some((o) => o.calculable)) {
      // Ninguno lo lleva completo: se parte en la menor cantidad de despachos con el vehículo de mayor volumen
      const mayor = vehiculos.filter((v) => medidasVehiculo(v).faltan.length === 0)
        .sort((a, b) => b.carga_largo_cm * b.carga_ancho_cm * b.carga_alto_cm - a.carga_largo_cm * a.carga_ancho_cm * a.carga_alto_cm)[0];
      const n = mayor ? despachosNecesarios(db, mayor, ids) : null;
      evitables = n != null ? ids.length - n : null;
      if (n != null) vehiculoSugerido = { ...opciones.find((o) => o.vehicle_id === mayor.id), despachos: n };
    }

    let ahorro = null;
    let notaAhorro = 'Calcula la ruta con Google para ver el ahorro exacto.';
    if (caben.length && mejor && deposito && g.length <= 14) {
      const v = vehiculos.find((x) => x.id === vehiculoSugerido.vehicle_id);
      const precio = precioCombustible(db, v.combustible)?.precio ?? null;
      const puntos = [deposito, ...g];
      const M = matrizDesdeCache(db, puntos);
      if (M && precio != null) {
        const arco = (i, j) => costoArco(v, precio, costoHora, null, M.km[i][j], M.min[i][j]);
        const separado = g.reduce((a, _, i) => a + arco(0, i + 1) + arco(i + 1, 0), 0);
        const cm = puntos.map((_, i) => puntos.map((__, j) => (i === j ? 0 : arco(i, j))));
        ahorro = Math.max(0, Math.round(separado - resolverRuta(cm, { retorna: true }).costo));
        notaAhorro = 'Frente a visitarlos en despachos separados desde la base, con distancias ya calculadas.';
      }
    }
    const comunas = [...new Set(g.map((e) => e.comuna).filter(Boolean))];
    grupos.push({
      id: `g-${ids.join('-')}`,
      entregas: ids.map((id) => desc.get(id)),
      comunas,
      n: ids.length,
      unidades: ids.reduce((a, id) => a + desc.get(id).unidades, 0),
      con_un_solo_producto: ids.filter((id) => desc.get(id).un_solo_producto).length,
      vehiculos: opciones,
      vehiculo_sugerido: vehiculoSugerido,
      despachos_evitables: evitables,
      ahorro_estimado: ahorro,
      nota_ahorro: notaAhorro,
    });
  }
  grupos.sort((a, b) => (b.despachos_evitables ?? -1) - (a.despachos_evitables ?? -1) || b.n - a.n);

  // Entregas de un solo producto: ¿cabrían en un despacho ya planificado que pasa cerca?
  const planificados = db.prepare("SELECT t.id, t.fecha, t.vehicle_id, v.nombre AS vehiculo FROM trips t JOIN vehicles v ON v.id = t.vehicle_id WHERE t.estado = 'planificado' ORDER BY t.fecha, t.id").all();
  const paradasDe = db.prepare('SELECT s.delivery_id, COALESCE(d.lat, c.lat) AS lat, COALESCE(d.lng, c.lng) AS lng FROM trip_stops s LEFT JOIN deliveries d ON d.id = s.delivery_id LEFT JOIN clients c ON c.id = s.client_id WHERE s.trip_id = ?');
  const unProducto = [];
  for (const e of [...desc.values()].filter((x) => x.un_solo_producto)) {
    const opciones = [];
    for (const t of planificados) {
      const ps = paradasDe.all(t.id).filter((p) => p.lat != null);
      if (!ps.length) continue;
      const cerca = Math.min(...ps.map((p) => haversineKm(e, p)));
      if (cerca > radio) continue;
      const veh = vehiculos.find((v) => v.id === t.vehicle_id);
      if (!veh) continue;
      const c = cubicarEntregas(db, veh, [...ps.map((p) => p.delivery_id).filter(Boolean), e.delivery_id]);
      opciones.push({
        trip_id: t.id, fecha: t.fecha, vehiculo: t.vehiculo ?? `${veh.marca} ${veh.modelo}`, distancia_km: cerca,
        calculable: c.ok, cabe: c.ok ? c.resultado.cabe : null, ocupacion_volumen_pct: c.ok ? c.resultado.ocupacion_volumen_pct : null, peso_pct: c.ok ? c.resultado.peso_pct : null,
      });
    }
    if (opciones.length) unProducto.push({ entrega: e, despachos: opciones.sort((a, b) => a.distancia_km - b.distancia_km) });
  }

  const conGrupo = new Set(grupos.flatMap((g) => g.entregas.map((e) => e.delivery_id)));
  return {
    radio_km: radio,
    grupos,
    un_producto: unProducto,
    resumen: {
      entregas_pendientes: pend.length,
      grupos: grupos.length,
      entregas_en_grupos: conGrupo.size,
      despachos_evitables: grupos.reduce((a, g) => a + (g.despachos_evitables ?? 0), 0),
      ahorro_estimado: grupos.some((g) => g.ahorro_estimado != null) ? grupos.reduce((a, g) => a + (g.ahorro_estimado ?? 0), 0) : null,
      grupos_sin_calcular: grupos.filter((g) => g.despachos_evitables == null).length,
    },
    sin_medidas: [...sinMedidas.values()],
    vehiculo_economico: mejor ? { vehicle_id: mejor.v.id, nombre: mejor.v.nombre ?? `${mejor.v.marca} ${mejor.v.modelo}`, costo_km: mejor.ck.totalKm } : null,
  };
}

/**
 * Cuánto se llenó cada vehículo en los despachos completados del período: peso (siempre que haya datos) y volumen (si hay medidas).
 */
export function utilizacionCarga(db, { desde, hasta }) {
  const vehiculos = db.prepare('SELECT * FROM vehicles WHERE activo = 1 ORDER BY id').all();
  const filas = vehiculos.map((v) => {
    const trips = db.prepare("SELECT id, fecha, peso_kg FROM trips WHERE vehicle_id = ? AND estado = 'completado' AND fecha >= ? AND fecha <= ? ORDER BY fecha, id").all(v.id, desde, hasta);
    const cap = num(v.capacidad_kg);
    const medidas = medidasVehiculo(v).faltan.length === 0;
    const detalle = trips.map((t) => {
      const ids = db.prepare('SELECT delivery_id FROM trip_stops WHERE trip_id = ? AND delivery_id IS NOT NULL').all(t.id).map((x) => x.delivery_id);
      const c = medidas && ids.length ? cubicarEntregas(db, v, ids) : null;
      return {
        trip_id: t.id, fecha: t.fecha,
        peso_pct: t.peso_kg != null && cap > 0 ? (t.peso_kg / cap) * 100 : null,
        volumen_pct: c?.ok ? c.resultado.ocupacion_volumen_pct : null,
        cabia: c?.ok ? c.resultado.cabe : null,
      };
    });
    const prom = (xs) => { const f = xs.filter((x) => x != null); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null; };
    return {
      vehicle_id: v.id, nombre: v.nombre ?? `${v.marca} ${v.modelo}`, despachos: trips.length, capacidad_kg: cap,
      peso_pct: prom(detalle.map((d) => d.peso_pct)), n_peso: detalle.filter((d) => d.peso_pct != null).length,
      volumen_pct: prom(detalle.map((d) => d.volumen_pct)), n_volumen: detalle.filter((d) => d.volumen_pct != null).length,
      tiene_medidas: medidas, detalle,
    };
  });
  const todos = filas.flatMap((f) => f.detalle);
  const prom = (xs) => { const f = xs.filter((x) => x != null); return f.length ? f.reduce((a, b) => a + b, 0) / f.length : null; };
  return { por_vehiculo: filas, peso_pct: prom(todos.map((d) => d.peso_pct)), volumen_pct: prom(todos.map((d) => d.volumen_pct)), despachos: todos.length };
}
