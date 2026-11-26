// Planificador de rutas: arma la matriz de distancias (con caché), calcula las alternativas
// A (distancia), B (tiempo), C (costo) y D (optimizada), las evalúa por vehículo y guarda despachos.
import { getSettings, setSettings, num, precioCombustible, tx } from '../db.js';
import { calcularCostos, costoArco, repartirCostoPorCliente } from './costs.js';
import { resolverRuta, combinarMatrices, dividirEnDespachos } from './optimizer.js';

export class PlanError extends Error {
  constructor(code, message, extra = null) {
    super(message);
    this.code = code;
    this.extra = extra;
  }
}

export const MAX_PARADAS = 25; // límite de puntos intermedios de Google Routes API

export const ALTERNATIVAS = [
  { codigo: 'A', nombre: 'Menor distancia', descripcion: 'Recorre la menor cantidad de kilómetros.' },
  { codigo: 'B', nombre: 'Menor tiempo', descripcion: 'Minimiza el tiempo de conducción, con tráfico cuando está disponible.' },
  { codigo: 'C', nombre: 'Menor costo', descripcion: 'Minimiza combustible, desgaste y costo del conductor.' },
  { codigo: 'D', nombre: 'Optimizada', descripcion: 'Equilibra distancia, tiempo y costo según los pesos de Configuración.' },
];

const claveGeo = (p) => `${Number(p.lat).toFixed(5)},${Number(p.lng).toFixed(5)}`;

export function createPlanner({ db, google, ahora = () => new Date() }) {
  const ajustes = () => getSettings(db);

  /** Hora de salida para consultar tráfico: nunca en el pasado y hasta 90 días hacia adelante. */
  function salida(fecha, hora) {
    const now = ahora();
    let d = fecha ? new Date(`${fecha}T${hora || '08:00'}:00`) : null;
    if (!d || Number.isNaN(d.getTime())) d = new Date(now.getTime());
    if (d.getTime() < now.getTime() + 60000) d = new Date(now.getTime() + 60000);
    if (d.getTime() > now.getTime() + 90 * 86400e3) return null;
    const iso = d.toISOString();
    return { iso, bucket: `t${iso.slice(0, 13)}` };
  }

  /** Coordenadas de la base. Si solo hay dirección, la geolocaliza y la guarda. */
  async function asegurarDeposito() {
    const s = ajustes();
    let lat = num(s.deposito_lat);
    let lng = num(s.deposito_lng);
    if (lat == null || lng == null) {
      if (!s.deposito_direccion) {
        throw new PlanError('deposito', 'Falta el punto de partida. Ingresa la dirección de la base en Configuración.');
      }
      const g = await google.geocode({ direccion: s.deposito_direccion, comuna: s.deposito_comuna, region: s.deposito_region });
      lat = g.lat;
      lng = g.lng;
      setSettings(db, { deposito_lat: lat, deposito_lng: lng });
    }
    return { lat, lng, nombre: s.deposito_nombre, direccion: [s.deposito_direccion, s.deposito_comuna].filter(Boolean).join(', ') };
  }

  /** Matriz de km y minutos entre puntos (índice 0 = base). Usa caché y consulta a Google solo lo que falta. */
  async function getMatrix(puntos, { fecha, hora } = {}) {
    const s = ajustes();
    const dep = s.usar_trafico === '1' ? salida(fecha, hora) : null;
    const trafico = !!dep;
    const bucket = trafico ? dep.bucket : 's';
    const ttl = trafico ? (num(s.cache_horas) ?? 12) * 3600e3 : 30 * 86400e3;
    const now = ahora().getTime();
    const n = puntos.length;
    const keys = puntos.map(claveGeo);
    const sel = db.prepare('SELECT dist_m, dur_s, static_s, fetched_at FROM route_cache WHERE o = ? AND d = ? AND bucket = ?');
    const mk = () => Array.from({ length: n }, () => Array(n).fill(0));
    let km = mk();
    let min = mk();
    let minEst = mk();
    let incompleto = false;

    for (let i = 0; i < n && !incompleto; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j || keys[i] === keys[j]) continue;
        const row = sel.get(keys[i], keys[j], bucket);
        if (!row || now - row.fetched_at > ttl) { incompleto = true; break; }
        km[i][j] = row.dist_m == null ? null : row.dist_m / 1000;
        min[i][j] = row.dur_s == null ? null : row.dur_s / 60;
        minEst[i][j] = row.static_s == null ? null : row.static_s / 60;
      }
    }

    let desdeGoogle = false;
    if (incompleto) {
      desdeGoogle = true;
      const r = await google.routeMatrix(puntos, { departureTime: dep?.iso ?? null, traffic: trafico });
      km = mk(); min = mk(); minEst = mk();
      const ins = db.prepare('INSERT OR REPLACE INTO route_cache (o, d, bucket, dist_m, dur_s, static_s, fetched_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      tx(db, () => {
        for (let i = 0; i < n; i++) {
          for (let j = 0; j < n; j++) {
            if (i === j || keys[i] === keys[j]) continue;
            const d = r.dist[i][j], t = r.dur[i][j], e = r.est[i][j];
            ins.run(keys[i], keys[j], bucket, d, t, e, now);
            km[i][j] = d == null ? null : d / 1000;
            min[i][j] = t == null ? null : t / 60;
            minEst[i][j] = e == null ? null : e / 60;
          }
        }
      });
    }
    return { km, min, minEst, trafico, salidaIso: dep?.iso ?? null, desdeGoogle };
  }

  function validarMatriz(M, nombres) {
    const huecos = [];
    for (let i = 0; i < M.km.length; i++) {
      for (let j = 0; j < M.km.length; j++) {
        if (i !== j && (M.km[i][j] == null || M.min[i][j] == null)) huecos.push([i, j]);
      }
    }
    if (huecos.length) {
      const involucrados = [...new Set(huecos.flat())].map((i) => nombres[i]);
      throw new PlanError(
        'sin_ruta',
        `Google no encontró ruta por carretera entre algunos puntos: ${involucrados.slice(0, 6).join(', ')}. Revisa que las coordenadas estén correctas.`,
        { puntos: involucrados }
      );
    }
  }

  function contexto(v, { fecha, conductor }) {
    const s = ajustes();
    const precio = precioCombustible(db, v.combustible, fecha)?.precio ?? null;
    return {
      vehiculo: v,
      precioLitro: precio,
      costoHora: num(conductor?.costo_hora) ?? num(s.costo_hora_conductor),
      servicioMin: num(s.tiempo_servicio_min),
      jornada: num(s.jornada_horas),
      recargo: num(s.recargo_horas_extra_pct),
    };
  }

  const pesoConocido = (stops) => stops.every((p) => p.peso_kg != null);

  /** Evalúa costos y tiempos de una ruta con las paradas en `orden` (índices 1..n). */
  function evaluarOrden(ctx, M, stops, orden, retorna, extras) {
    const conocido = pesoConocido(stops);
    let restante = conocido ? stops.reduce((a, p) => a + p.peso_kg, 0) : null;
    const tramos = [];
    let prev = 0;
    for (const idx of orden) {
      tramos.push({ km: M.km[prev][idx], min: M.min[prev][idx], cargaKg: restante });
      if (restante != null) restante -= stops[idx - 1].peso_kg;
      prev = idx;
    }
    if (retorna) tramos.push({ km: M.km[prev][0], min: M.min[prev][0], cargaKg: conocido ? 0 : null });
    const c = calcularCostos({
      vehiculo: ctx.vehiculo,
      precioLitro: ctx.precioLitro,
      costoHoraConductor: ctx.costoHora,
      servicioMinPorParada: ctx.servicioMin,
      jornadaHoras: ctx.jornada,
      recargoExtraPct: ctx.recargo,
      tramos,
      paradas: orden.length,
      extras,
    });
    const reparto = c.calculable ? repartirCostoPorCliente(c.directos, c.total, orden.length) : null;
    return {
      orden,
      km: c.km,
      minConduccion: c.minConduccion,
      minTotal: c.minTotal,
      costos: c,
      tramos: tramos.map((t) => ({ km: t.km, min: t.min })),
      paradas: orden.map((idx, k) => ({
        ...stops[idx - 1],
        km_tramo: tramos[k].km,
        min_tramo: tramos[k].min,
        costo_asignado: reparto ? reparto[k] : null,
      })),
      retorno: retorna ? { km: tramos[tramos.length - 1].km, min: tramos[tramos.length - 1].min } : null,
    };
  }

  /** Calcula A, B, C, D y el orden manual para un vehículo. */
  function alternativasVehiculo(ctx, M, stops, retorna, extras, { soloManual = false } = {}) {
    const n = stops.length;
    const manual = Array.from({ length: n }, (_, i) => i + 1);
    const baseline = evaluarOrden(ctx, M, stops, manual, retorna, extras);
    const calculable = baseline.costos.calculable;
    const s = ajustes();
    const pesoTotal = pesoConocido(stops) ? stops.reduce((a, p) => a + p.peso_kg, 0) : null;
    const cap = num(ctx.vehiculo.capacidad_kg);
    const capacidad = {
      peso_kg: pesoTotal,
      capacidad_kg: cap,
      excede: pesoTotal != null && cap != null ? pesoTotal > cap : null,
      uso_pct: pesoTotal != null && cap ? (pesoTotal / cap) * 100 : null,
    };
    const base = {
      vehiculo: {
        id: ctx.vehiculo.id,
        nombre: ctx.vehiculo.nombre,
        marca: ctx.vehiculo.marca,
        modelo: ctx.vehiculo.modelo,
        combustible: ctx.vehiculo.combustible,
        capacidad_kg: cap,
      },
      precio_litro: ctx.precioLitro,
      calculable,
      faltantes: baseline.costos.faltantes,
      advertencias: baseline.costos.warnings,
      capacidad,
      baseline: { codigo: 'MANUAL', nombre: 'Orden de selección (tradicional)', ...baseline },
    };
    if (soloManual) return { ...base, alternativas: [], recomendada: null };

    const cargaMedia = pesoTotal != null ? pesoTotal / 2 : null;
    const N = n + 1;
    let costMat = null;
    if (calculable) {
      costMat = Array.from({ length: N }, (_, i) =>
        Array.from({ length: N }, (_, j) => (i === j ? 0 : costoArco(ctx.vehiculo, ctx.precioLitro, ctx.costoHora, cargaMedia, M.km[i][j], M.min[i][j])))
      );
    }
    const mats = [M.km, M.min];
    const pesos = [num(s.peso_distancia) ?? 1, num(s.peso_tiempo) ?? 1];
    if (costMat) { mats.push(costMat); pesos.push(num(s.peso_costo) ?? 1); }
    const ordenes = {
      A: resolverRuta(M.km, { retorna }).orden,
      B: resolverRuta(M.min, { retorna }).orden,
      C: costMat ? resolverRuta(costMat, { retorna }).orden : null,
      D: resolverRuta(combinarMatrices(mats, pesos), { retorna }).orden,
    };
    const vistos = new Map();
    const alternativas = ALTERNATIVAS.map((def) => {
      const orden = ordenes[def.codigo];
      if (!orden) return { ...def, disponible: false, motivo: 'Necesita rendimiento y precio de combustible.' };
      const ev = evaluarOrden(ctx, M, stops, orden, retorna, extras);
      const firma = orden.join('-');
      const igual = vistos.get(firma) ?? null;
      if (!igual) vistos.set(firma, def.codigo);
      return { ...def, disponible: true, igual_a: igual, firma, ...ev };
    });
    const disp = alternativas.filter((a) => a.disponible);
    const clave = (a) => (calculable ? [a.costos.total, a.minTotal, a.km] : [a.km, a.minTotal, 0]);
    const rec = [...disp].sort((a, b) => {
      const x = clave(a), y = clave(b);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    })[0];
    const masCorta = alternativas.find((a) => a.codigo === 'A');
    let nota = null;
    if (calculable && rec && masCorta?.disponible && rec.codigo !== 'A' && rec.costos.total < masCorta.costos.total) {
      nota = `La ruta más corta (A) no es la más económica: la alternativa ${rec.codigo} cuesta $${Math.round(masCorta.costos.total - rec.costos.total).toLocaleString('es-CL')} menos.`;
    }
    return { ...base, alternativas, recomendada: rec?.codigo ?? null, nota };
  }

  /** Une paradas, valida y arma los puntos (la base va primero). */
  async function prepararPuntos(stops, { fecha, hora }) {
    if (!Array.isArray(stops) || stops.length === 0) throw new PlanError('sin_paradas', 'Selecciona al menos un cliente para planificar la ruta.');
    if (stops.length > MAX_PARADAS) {
      throw new PlanError('demasiadas_paradas', `Google Routes permite hasta ${MAX_PARADAS} paradas por ruta. Divide la selección en varios despachos.`, { max: MAX_PARADAS });
    }
    const sinCoord = stops.filter((p) => p.lat == null || p.lng == null);
    if (sinCoord.length) {
      throw new PlanError('sin_coordenadas', `Faltan coordenadas de: ${sinCoord.map((p) => p.nombre).join(', ')}. Geolocaliza esos clientes antes de planificar.`, {
        clientes: sinCoord.map((p) => p.client_id),
      });
    }
    const deposito = await asegurarDeposito();
    const puntos = [deposito, ...stops];
    const M = await getMatrix(puntos, { fecha, hora });
    validarMatriz(M, ['Base', ...stops.map((p) => p.nombre)]);
    return { deposito, M };
  }

  function vehiculosPorId(ids) {
    const lista = ids?.length
      ? ids.map((id) => db.prepare('SELECT * FROM vehicles WHERE id = ?').get(id)).filter(Boolean)
      : db.prepare("SELECT * FROM vehicles WHERE activo = 1 AND estado = 'activo' ORDER BY id").all();
    if (!lista.length) throw new PlanError('sin_vehiculo', 'No hay vehículos disponibles. Registra o activa un vehículo.');
    return lista;
  }

  function mejorVehiculo(resultados) {
    const aptos = resultados.filter((r) => r.calculable && r.capacidad.excede !== true && r.recomendada);
    if (aptos.length) {
      const costo = (r) => r.alternativas.find((a) => a.codigo === r.recomendada).costos.total;
      return aptos.sort((a, b) => costo(a) - costo(b))[0].vehiculo.id;
    }
    return resultados.find((r) => r.capacidad.excede !== true)?.vehiculo.id ?? resultados[0].vehiculo.id;
  }

  /** Plan completo: alternativas por vehículo, recomendación y trazado de rutas. */
  async function plan({ stops, vehicle_ids, driver_id = null, fecha, hora, retorna = true, extras = {}, trazar = true }) {
    const { deposito, M } = await prepararPuntos(stops, { fecha, hora });
    const conductor = driver_id ? db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id) : null;
    const vehs = vehiculosPorId(vehicle_ids);
    const vehiculos = vehs.map((v) => alternativasVehiculo(contexto(v, { fecha, conductor }), M, stops, retorna, extras));
    const mejorId = mejorVehiculo(vehiculos);
    const advertencias = [];

    if (trazar) {
      const principal = vehiculos.find((r) => r.vehiculo.id === mejorId) ?? vehiculos[0];
      const ordenes = new Map();
      for (const a of principal.alternativas) if (a.disponible) ordenes.set(a.orden.join('-'), a.orden);
      ordenes.set(principal.baseline.orden.join('-'), principal.baseline.orden);
      const trazados = {};
      await Promise.all(
        [...ordenes.entries()].map(async ([firma, orden]) => {
          try {
            trazados[firma] = (await trazarOrden(deposito, stops, orden, retorna, M)).polyline;
          } catch (e) {
            trazados[firma] = null;
            if (!advertencias.some((x) => x.startsWith('No se pudo trazar'))) advertencias.push(`No se pudo trazar la ruta en el mapa: ${e.message}`);
          }
        })
      );
      for (const a of principal.alternativas) if (a.disponible) a.polyline = trazados[a.orden.join('-')] ?? null;
      principal.baseline.polyline = trazados[principal.baseline.orden.join('-')] ?? null;
    }

    const exceden = vehiculos.filter((r) => r.capacidad.excede === true);
    for (const r of exceden) {
      advertencias.push(`La carga (${Math.round(r.capacidad.peso_kg)} kg) supera la capacidad de ${r.vehiculo.marca} ${r.vehiculo.modelo} (${r.capacidad.capacidad_kg} kg). Divide el despacho.`);
    }
    if (!pesoConocido(stops)) advertencias.push('Hay entregas sin peso (productos sin kg): no se puede validar la capacidad ni ajustar el consumo por carga.');

    return {
      deposito,
      paradas: stops,
      salida: { fecha: fecha ?? null, hora: hora ?? null, trafico: M.trafico, iso: M.salidaIso },
      retorna,
      vehiculos,
      mejor_vehiculo_id: mejorId,
      matriz: { km: M.km, min: M.min },
      desde_google: M.desdeGoogle,
      advertencias,
    };
  }

  async function trazarOrden(deposito, stops, orden, retorna, M) {
    const pts = [deposito, ...orden.map((i) => stops[i - 1])];
    if (retorna) pts.push(deposito);
    const dep = M.trafico ? { departureTime: M.salidaIso, traffic: true } : { traffic: false };
    return google.computeRoute(pts, dep);
  }

  /** Guarda un despacho con el orden elegido, recalculando todo en el servidor. */
  async function crearDespacho({ stops, orden_keys, alternativa = 'manual', vehicle_id, driver_id = null, fecha, hora, retorna = true, extras = {}, notas = null }) {
    const [v] = vehiculosPorId([vehicle_id]);
    const conductor = driver_id ? db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id) : null;
    const { deposito, M } = await prepararPuntos(stops, { fecha, hora });
    const ctx = contexto(v, { fecha, conductor });
    const res = alternativasVehiculo(ctx, M, stops, retorna, extras);
    if (!res.calculable) {
      throw new PlanError('datos_faltantes', `No se puede guardar el despacho: faltan datos para calcular el costo (${res.faltantes.join(', ')}).`, { faltantes: res.faltantes });
    }
    if (res.capacidad.excede === true) {
      throw new PlanError('capacidad', `La carga (${Math.round(res.capacidad.peso_kg)} kg) supera la capacidad del vehículo (${res.capacidad.capacidad_kg} kg).`);
    }
    const idxPorClave = new Map(stops.map((p, i) => [p.key, i + 1]));
    const orden = (orden_keys ?? stops.map((p) => p.key)).map((k) => idxPorClave.get(k));
    if (orden.some((i) => !i) || new Set(orden).size !== stops.length) throw new PlanError('orden_invalido', 'El orden de paradas no coincide con las entregas seleccionadas.');
    const ev = evaluarOrden(ctx, M, stops, orden, retorna, extras);
    const base = res.baseline;
    const rec = res.alternativas.find((a) => a.codigo === res.recomendada);
    let polyline = null;
    try { polyline = (await trazarOrden(deposito, stops, orden, retorna, M)).polyline; } catch { /* se guarda sin trazado */ }

    const esManual = alternativa === 'manual';
    const ahorro = esManual ? 0 : Math.max(0, base.costos.total - ev.costos.total);
    const c = ev.costos;
    const planJson = {
      alternativas: res.alternativas.filter((a) => a.disponible).map((a) => ({ codigo: a.codigo, km: a.km, minTotal: a.minTotal, total: a.costos.total, igual_a: a.igual_a })),
      recomendada: res.recomendada,
      baseline: {
        km: base.km,
        minTotal: base.minTotal,
        combustible: base.costos.combustible,
        desgaste: base.costos.desgaste,
        otros: base.costos.otros,
        total: base.costos.total,
      },
      tramos: ev.tramos,
      pesos: stops.map((p) => p.peso_kg),
      retorno: ev.retorno,
    };
    const trip = tx(db, () => {
      const r = db.prepare(`INSERT INTO trips
        (fecha, hora_salida, vehicle_id, driver_id, estado, alternativa, retorna_base, n_paradas, distancia_km, tiempo_min, peso_kg,
         costo_combustible, costo_desgaste, costo_otros, costo_total, peajes, estacionamientos, otros_gastos, precio_combustible,
         baseline_km, baseline_total, ahorro, polyline, plan_json, notas)
        VALUES (?, ?, ?, ?, 'planificado', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        fecha, hora ?? null, v.id, driver_id, alternativa, retorna ? 1 : 0, stops.length, c.km, c.minTotal, res.capacidad.peso_kg,
        c.combustible, c.desgaste, c.otros, c.total, c.peajes, c.estacionamientos, c.otrosGastos, ctx.precioLitro,
        base.km, base.costos.total, ahorro, polyline, JSON.stringify(planJson), notas
      );
      const tripId = Number(r.lastInsertRowid);
      const insStop = db.prepare('INSERT INTO trip_stops (trip_id, delivery_id, client_id, orden, km_tramo, min_tramo, peso_kg, costo_asignado) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      const updDel = db.prepare('UPDATE deliveries SET trip_id = ?, orden = ? WHERE id = ?');
      ev.paradas.forEach((p, k) => {
        insStop.run(tripId, p.delivery_id ?? null, p.client_id ?? null, k + 1, p.km_tramo, p.min_tramo, p.peso_kg, p.costo_asignado);
        if (p.delivery_id) updDel.run(tripId, k + 1, p.delivery_id);
      });
      return tripId;
    });
    return { trip_id: trip, costos: c, ahorro, recomendada: rec?.codigo ?? null };
  }

  /** Costo de una ruta con las paradas en el orden dado (calculadora y vista rápida del mapa). */
  async function rutaEnOrden({ stops, vehicle_id, driver_id = null, fecha, hora, retorna = true, extras = {}, trazar = true }) {
    const [v] = vehiculosPorId([vehicle_id]);
    const conductor = driver_id ? db.prepare('SELECT * FROM drivers WHERE id = ?').get(driver_id) : null;
    const { deposito, M } = await prepararPuntos(stops, { fecha, hora });
    const res = alternativasVehiculo(contexto(v, { fecha, conductor }), M, stops, retorna, extras, { soloManual: true });
    let polyline = null;
    if (trazar) {
      try { polyline = (await trazarOrden(deposito, stops, res.baseline.orden, retorna, M)).polyline; } catch { /* sin trazado */ }
    }
    return { deposito, ...res, polyline, salida: { trafico: M.trafico } };
  }

  /** Distancias y tiempos entre una lista de puntos (más la base). */
  async function matrizEntre(stops, { fecha, hora } = {}) {
    const { deposito, M } = await prepararPuntos(stops, { fecha, hora });
    return { deposito, km: M.km, min: M.min, trafico: M.trafico };
  }

  async function dividir({ stops, vehicle_id }) {
    const deposito = await asegurarDeposito();
    const [v] = vehiculosPorId(vehicle_id ? [vehicle_id] : null);
    const grupos = dividirEnDespachos(stops, deposito, { maxParadas: MAX_PARADAS, capacidadKg: num(v.capacidad_kg) });
    return { grupos: grupos.map((g) => g.map((p) => p.key)), capacidad_kg: num(v.capacidad_kg) };
  }

  return { plan, crearDespacho, rutaEnOrden, matrizEntre, dividir, asegurarDeposito, getMatrix, evaluarOrden, alternativasVehiculo, contexto };
}
