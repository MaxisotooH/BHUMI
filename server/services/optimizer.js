// Ordenamiento de paradas (problema del vendedor viajero).
// La matriz es de (n+1) x (n+1): el índice 0 es la base y 1..n son los clientes.
// Funciona con matrices asimétricas (tráfico, calles de un solo sentido).

/** Costo de recorrer `orden` (índices 1..n) partiendo de la base. */
export function costoOrden(m, orden, retorna = true) {
  let c = 0;
  let prev = 0;
  for (const i of orden) { c += m[prev][i]; prev = i; }
  if (retorna) c += m[prev][0];
  return c;
}

/** Solución exacta (Held-Karp). Útil hasta ~15 paradas. */
function exacto(m, n, retorna) {
  const size = 1 << n;
  const dp = new Float64Array(size * n).fill(Infinity);
  const padre = new Int16Array(size * n).fill(-1);
  for (let j = 0; j < n; j++) dp[(1 << j) * n + j] = m[0][j + 1];
  for (let mask = 1; mask < size; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const cur = dp[mask * n + j];
      if (cur === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const nm = mask | (1 << k);
        const cand = cur + m[j + 1][k + 1];
        if (cand < dp[nm * n + k]) { dp[nm * n + k] = cand; padre[nm * n + k] = j; }
      }
    }
  }
  const full = size - 1;
  let mejor = Infinity;
  let ultimo = 0;
  for (let j = 0; j < n; j++) {
    const c = dp[full * n + j] + (retorna ? m[j + 1][0] : 0);
    if (c < mejor) { mejor = c; ultimo = j; }
  }
  const orden = [];
  let mask = full;
  let j = ultimo;
  while (j !== -1) {
    orden.push(j + 1);
    const p = padre[mask * n + j];
    mask &= ~(1 << j);
    j = p;
  }
  return orden.reverse();
}

function vecinoMasCercano(m, n, inicio, retorna) {
  const libres = new Set();
  for (let i = 1; i <= n; i++) libres.add(i);
  const orden = [inicio];
  libres.delete(inicio);
  let actual = inicio;
  while (libres.size) {
    let mejor = -1;
    let mc = Infinity;
    for (const i of libres) if (m[actual][i] < mc) { mc = m[actual][i]; mejor = i; }
    orden.push(mejor);
    libres.delete(mejor);
    actual = mejor;
  }
  return orden;
}

function mejorar(m, orden, retorna) {
  let mejor = costoOrden(m, orden, retorna);
  let hayMejora = true;
  let guardia = 0;
  while (hayMejora && guardia++ < 200) {
    hayMejora = false;
    // 2-opt: invertir un tramo
    for (let i = 0; i < orden.length - 1; i++) {
      for (let j = i + 1; j < orden.length; j++) {
        const cand = [...orden.slice(0, i), ...orden.slice(i, j + 1).reverse(), ...orden.slice(j + 1)];
        const c = costoOrden(m, cand, retorna);
        if (c < mejor - 1e-9) { orden = cand; mejor = c; hayMejora = true; }
      }
    }
    // Or-opt: mover un tramo de 1 a 3 paradas a otra posición
    for (let len = 1; len <= 3; len++) {
      for (let i = 0; i + len <= orden.length; i++) {
        const seg = orden.slice(i, i + len);
        const resto = [...orden.slice(0, i), ...orden.slice(i + len)];
        for (let p = 0; p <= resto.length; p++) {
          if (p === i) continue;
          const cand = [...resto.slice(0, p), ...seg, ...resto.slice(p)];
          const c = costoOrden(m, cand, retorna);
          if (c < mejor - 1e-9) { orden = cand; mejor = c; hayMejora = true; }
        }
      }
    }
  }
  return orden;
}

/**
 * Devuelve el mejor orden de visita (arreglo de índices 1..n) para la matriz dada.
 * Exacto hasta `exactoHasta` paradas; sobre eso usa heurística (vecino más cercano + 2-opt + or-opt).
 */
export function resolverRuta(m, { retorna = true, exactoHasta = 15 } = {}) {
  const n = m.length - 1;
  if (n <= 0) return { orden: [], costo: 0, exacto: true };
  if (n === 1) return { orden: [1], costo: costoOrden(m, [1], retorna), exacto: true };
  if (n <= exactoHasta) {
    const orden = exacto(m, n, retorna);
    return { orden, costo: costoOrden(m, orden, retorna), exacto: true };
  }
  let mejor = null;
  let mc = Infinity;
  for (let inicio = 1; inicio <= n; inicio++) {
    const o = mejorar(m, vecinoMasCercano(m, n, inicio, retorna), retorna);
    const c = costoOrden(m, o, retorna);
    if (c < mc - 1e-9) { mc = c; mejor = o; }
  }
  return { orden: mejor, costo: mc, exacto: false };
}

/** Combina matrices con pesos, normalizando cada una por su promedio para que sean comparables. */
export function combinarMatrices(mats, pesos) {
  const n = mats[0].length;
  const medias = mats.map((mx) => {
    let s = 0, c = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && Number.isFinite(mx[i][j])) { s += mx[i][j]; c++; }
    return c && s > 0 ? s / c : 1;
  });
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 0;
      let v = 0;
      mats.forEach((mx, k) => { v += (pesos[k] ?? 1) * (mx[i][j] / medias[k]); });
      return v;
    })
  );
}

/** Distancia en línea recta (km) entre dos coordenadas. Solo para agrupar clientes cercanos. */
export function haversineKm(a, b) {
  const R = 6371.0088;
  const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Agrupa puntos que están a menos de `radioKm` unos de otros (componentes conectados). */
export function agruparCercanos(puntos, radioKm) {
  const n = puntos.length;
  const padre = Array.from({ length: n }, (_, i) => i);
  const raiz = (x) => (padre[x] === x ? x : (padre[x] = raiz(padre[x])));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (haversineKm(puntos[i], puntos[j]) <= radioKm) padre[raiz(i)] = raiz(j);
    }
  }
  const grupos = new Map();
  puntos.forEach((p, i) => {
    const r = raiz(i);
    if (!grupos.has(r)) grupos.set(r, []);
    grupos.get(r).push(p);
  });
  return [...grupos.values()];
}

/**
 * Divide una lista de paradas en varios despachos cuando exceden la capacidad del
 * vehículo o el máximo de paradas por ruta. Recorre los clientes por ángulo alrededor de la base.
 */
export function dividirEnDespachos(paradas, base, { maxParadas = 25, capacidadKg = null } = {}) {
  const ang = (p) => Math.atan2(p.lat - base.lat, p.lng - base.lng);
  const orden = [...paradas].sort((a, b) => ang(a) - ang(b));
  const grupos = [];
  let actual = [];
  let peso = 0;
  for (const p of orden) {
    const pp = p.peso_kg ?? 0;
    const excede = capacidadKg != null && actual.length > 0 && peso + pp > capacidadKg;
    if (actual.length >= maxParadas || excede) {
      grupos.push(actual);
      actual = [];
      peso = 0;
    }
    actual.push(p);
    peso += pp;
  }
  if (actual.length) grupos.push(actual);
  return grupos;
}
