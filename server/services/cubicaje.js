// Cubicaje: cuántas cajas y productos caben en un vehículo, según las medidas internas de su carrocería,
// la capacidad de carga y las medidas de cada producto.
//
// El empaque se calcula con espacios libres que se subdividen ("guillotina" en 3D): cada bloque de cajas se coloca
// en un espacio libre y lo que sobra queda dividido en tres espacios que no se cruzan. Por construcción las cajas
// nunca se superponen ni salen del vehículo: si el cálculo dice que la carga cabe, cabe. Puede ser conservador
// (algún acomodo muy ingenioso podría aprovechar un poco más), pero nunca optimista.
// Medidas en centímetros, pesos en kilos, volúmenes en metros cúbicos.

export class CubicajeError extends Error {
  constructor(mensaje, extra = null) {
    super(mensaje);
    this.status = 422;
    this.code = 'datos_faltantes';
    this.extra = extra;
  }
}

const EPS = 1e-6;
const num = (v) => (v == null || v === '' ? null : Number(v));
const positivo = (v) => Number.isFinite(v) && v > 0;
export const cm3aM3 = (v) => v / 1e6;
export const volumenUnidadM3 = (p) => cm3aM3(p.largo * p.ancho * p.alto);

/** Formas en que se puede acostar una caja. Si "rotable" es falso la caja siempre queda con su altura hacia arriba (solo gira sobre el piso). */
export function orientaciones({ largo, ancho, alto, rotable }) {
  const d = [largo, ancho, alto];
  const perms = rotable ? [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]] : [[0, 1, 2], [1, 0, 2]];
  const unicas = new Map();
  for (const p of perms) { const o = [d[p[0]], d[p[1]], d[p[2]]]; unicas.set(o.join('x'), o); }
  return [...unicas.values()];
}

/**
 * Acomoda cargas dentro de un contenedor.
 * @param cont   { largo, ancho, alto }
 * @param cargas [{ id, nombre, cantidad, largo, ancho, alto, apilable, rotable }]
 * @returns { bloques, colocadas: {id: n}, faltan: {id: n} }
 */
export function empacar(cont, cargas) {
  const libres = [{ x: 0, y: 0, z: 0, l: cont.largo, a: cont.ancho, h: cont.alto }];
  const bloques = [];
  const colocadas = {};
  const faltan = {};
  const minimo = Math.min(...cargas.flatMap((c) => [c.largo, c.ancho, c.alto]), Infinity);
  // Primero lo más grande, y entre iguales lo que no se puede apilar (necesita piso).
  const orden = [...cargas].sort((p, q) => (q.largo * q.ancho * q.alto) - (p.largo * p.ancho * p.alto) || Number(p.apilable) - Number(q.apilable));

  for (const c of orden) {
    const oris = orientaciones(c);
    const volUnidad = c.largo * c.ancho * c.alto;
    let resta = Math.max(0, Math.floor(c.cantidad));
    colocadas[c.id] = 0;
    while (resta > 0) {
      let mejor = null;
      for (let i = 0; i < libres.length; i++) {
        const f = libres[i];
        for (const [dx, dy, dz] of oris) {
          if (dx > f.l + EPS || dy > f.a + EPS || dz > f.h + EPS) continue;
          const nx = Math.floor((f.l + EPS) / dx);
          const ny = Math.floor((f.a + EPS) / dy);
          const nz = c.apilable ? Math.floor((f.h + EPS) / dz) : 1;
          const toma = Math.min(nx * ny * nz, resta);
          const cz = Math.min(nz, toma);
          const celdas = Math.ceil(toma / cz);
          const cy = Math.min(ny, celdas);
          const cx = Math.ceil(celdas / cy);
          const desperdicio = cx * dx * cy * dy * cz * dz - toma * volUnidad;
          const puntaje = [toma, -f.z, -desperdicio, -(f.l * f.a * f.h)];
          if (!mejor || mayor(puntaje, mejor.puntaje)) mejor = { i, f, dx, dy, dz, cx, cy, cz, toma, puntaje };
        }
      }
      if (!mejor) break;
      const { f, dx, dy, dz, cx, cy, cz, toma } = mejor;
      const bl = cx * dx, ba = cy * dy, bh = cz * dz;
      bloques.push({ id: c.id, nombre: c.nombre, x: f.x, y: f.y, z: f.z, dx, dy, dz, cx, cy, cz, unidades: toma, bl, ba, bh });
      colocadas[c.id] += toma;
      resta -= toma;
      libres.splice(mejor.i, 1);
      const nuevos = [
        { x: f.x + bl, y: f.y, z: f.z, l: f.l - bl, a: f.a, h: f.h },     // a la derecha del bloque
        { x: f.x, y: f.y + ba, z: f.z, l: bl, a: f.a - ba, h: f.h },       // delante del bloque
      ];
      if (c.apilable) nuevos.push({ x: f.x, y: f.y, z: f.z + bh, l: bl, a: ba, h: f.h - bh }); // encima del bloque
      for (const n of nuevos) if (n.l >= minimo - EPS && n.a >= minimo - EPS && n.h >= minimo - EPS) libres.push(n);
    }
    faltan[c.id] = resta;
  }
  return { bloques, colocadas, faltan };
}

function mayor(a, b) {
  for (let i = 0; i < a.length; i++) { if (a[i] > b[i] + 1e-9) return true; if (a[i] < b[i] - 1e-9) return false; }
  return false;
}

/** Medidas internas y capacidad del vehículo, o los datos que faltan. */
export function medidasVehiculo(v) {
  const m = { largo: num(v.carga_largo_cm), ancho: num(v.carga_ancho_cm), alto: num(v.carga_alto_cm), capacidad_kg: num(v.capacidad_kg) };
  const faltan = [];
  if (!positivo(m.largo)) faltan.push('largo interno de la carrocería');
  if (!positivo(m.ancho)) faltan.push('ancho interno de la carrocería');
  if (!positivo(m.alto)) faltan.push('alto interno de la carrocería');
  return { medidas: m, faltan };
}

/** Medidas de un producto (la unidad en que se despacha: caja, saco, bulto…), o los datos que faltan. */
export function medidasProducto(p) {
  const m = {
    id: p.id, nombre: p.nombre, largo: num(p.largo_cm), ancho: num(p.ancho_cm), alto: num(p.alto_cm),
    peso_kg: num(p.peso_kg), apilable: p.apilable == null ? true : Boolean(Number(p.apilable)), rotable: Boolean(Number(p.rotable ?? 0)),
  };
  const faltan = [];
  if (!positivo(m.largo)) faltan.push('largo');
  if (!positivo(m.ancho)) faltan.push('ancho');
  if (!positivo(m.alto)) faltan.push('alto');
  return { medidas: m, faltan };
}

/**
 * Cubicaje de una carga en un vehículo.
 * @param vehiculo fila de vehicles
 * @param items    [{ producto: fila de products, cantidad }]
 */
export function cubicar(vehiculo, items) {
  const { medidas: mv, faltan: fv } = medidasVehiculo(vehiculo);
  const faltanProd = [];
  const cargas = [];
  for (const it of items) {
    if (!(it.cantidad > 0)) continue;
    const { medidas, faltan } = medidasProducto(it.producto);
    if (faltan.length) { faltanProd.push({ id: it.producto.id, nombre: it.producto.nombre, faltan }); continue; }
    const previa = cargas.find((c) => c.id === medidas.id);
    if (previa) previa.cantidad += it.cantidad; else cargas.push({ ...medidas, cantidad: it.cantidad });
  }
  if (fv.length || faltanProd.length) {
    throw new CubicajeError('Faltan medidas para calcular el cubicaje.', { vehiculo: fv, productos: faltanProd });
  }

  const { bloques, colocadas, faltan } = empacar({ largo: mv.largo, ancho: mv.ancho, alto: mv.alto }, cargas);
  const volVeh = cm3aM3(mv.largo * mv.ancho * mv.alto);
  const advertencias = [];
  const porProducto = cargas.map((c) => ({
    id: c.id, nombre: c.nombre, cantidad: c.cantidad, colocadas: colocadas[c.id] ?? 0, faltan: faltan[c.id] ?? c.cantidad,
    volumen_m3: volumenUnidadM3(c) * c.cantidad, peso_kg: c.peso_kg != null ? c.peso_kg * c.cantidad : null,
  }));
  const unidades = porProducto.reduce((s, x) => s + x.cantidad, 0);
  const colocadasTotal = porProducto.reduce((s, x) => s + x.colocadas, 0);
  const volCarga = porProducto.reduce((s, x) => s + x.volumen_m3, 0);
  const volColocado = cargas.reduce((s, c) => s + volumenUnidadM3(c) * (colocadas[c.id] ?? 0), 0);
  const sinPeso = porProducto.filter((x) => x.peso_kg == null);
  const peso = porProducto.reduce((s, x) => s + (x.peso_kg ?? 0), 0);
  if (sinPeso.length) advertencias.push(`Sin peso registrado: ${sinPeso.map((x) => x.nombre).join(', ')}. El peso total está incompleto.`);
  if (!positivo(mv.capacidad_kg)) advertencias.push('El vehículo no tiene capacidad de carga en kilos: solo se controla el espacio.');
  const pesoPct = positivo(mv.capacidad_kg) ? (peso / mv.capacidad_kg) * 100 : null;
  const cabeVolumen = colocadasTotal === unidades;
  const cabePeso = pesoPct == null || pesoPct <= 100 + 1e-9;
  return {
    cabe: cabeVolumen && cabePeso,
    limitante: !cabeVolumen ? 'volumen' : !cabePeso ? 'peso' : null,
    unidades_total: unidades,
    unidades_colocadas: colocadasTotal,
    volumen_vehiculo_m3: volVeh,
    volumen_carga_m3: volCarga,
    volumen_ocupado_m3: volColocado,
    ocupacion_volumen_pct: (volColocado / volVeh) * 100,
    peso_kg: peso,
    peso_pct: pesoPct,
    capacidad_kg: mv.capacidad_kg,
    vehiculo_dim_cm: { largo: mv.largo, ancho: mv.ancho, alto: mv.alto },
    por_producto: porProducto,
    bloques,
    advertencias,
  };
}

/** Cuántas unidades de un producto caben en el vehículo si va solo ese producto. */
export function capacidadPorProducto(vehiculo, producto) {
  const { medidas: mv, faltan: fv } = medidasVehiculo(vehiculo);
  const { medidas: mp, faltan: fp } = medidasProducto(producto);
  if (fv.length || fp.length) throw new CubicajeError('Faltan medidas para calcular el cubicaje.', { vehiculo: fv, productos: fp.length ? [{ id: producto.id, nombre: producto.nombre, faltan: fp }] : [] });
  const cota = Math.max(1, Math.floor(cm3aM3(mv.largo * mv.ancho * mv.alto) / volumenUnidadM3(mp)));
  const { colocadas } = empacar({ largo: mv.largo, ancho: mv.ancho, alto: mv.alto }, [{ ...mp, cantidad: cota }]);
  const porVolumen = colocadas[mp.id] ?? 0;
  const porPeso = positivo(mv.capacidad_kg) && positivo(mp.peso_kg) ? Math.floor(mv.capacidad_kg / mp.peso_kg) : null;
  return {
    id: mp.id, nombre: mp.nombre, por_volumen: porVolumen, por_peso: porPeso,
    maximo: porPeso == null ? porVolumen : Math.min(porVolumen, porPeso),
    limitante: porPeso != null && porPeso < porVolumen ? 'peso' : 'volumen',
  };
}
