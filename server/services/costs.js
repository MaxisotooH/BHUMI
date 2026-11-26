// Motor de costos de transporte. Funciones puras: reciben datos y devuelven números,
// sin tocar la base de datos ni Google. Así se pueden probar con casos hechos a mano.

const r0 = (x) => Math.round(x);
const nz = (x) => (x == null || x === '' || Number.isNaN(Number(x)) ? null : Number(x));
const ratio = (a, b) => (nz(a) != null && nz(b) != null && Number(b) > 0 ? Number(a) / Number(b) : null);

/** Componentes del desgaste y su origen (manual, calculado o sin dato). */
export const COMPONENTES_DESGASTE = [
  { key: 'motor', label: 'Desgaste de motor', requerido: false },
  { key: 'neumaticos', label: 'Neumáticos', requerido: true },
  { key: 'frenos', label: 'Frenos', requerido: false },
  { key: 'aceite', label: 'Aceite y lubricantes', requerido: false },
  { key: 'mantencion', label: 'Mantenciones preventivas', requerido: true },
  { key: 'depreciacion', label: 'Depreciación', requerido: true },
];

/**
 * Costo de desgaste por kilómetro de un vehículo.
 * Si el usuario ingresó un valor manual ($/km) se usa ese; si no, se calcula
 * con los datos del vehículo (valor de neumáticos / vida útil, etc.).
 */
export function desgastePorKm(v) {
  const derivado = {
    motor: null,
    neumaticos: ratio(v.valor_neumaticos, v.vida_neumaticos_km),
    frenos: null,
    aceite: null,
    mantencion: ratio(v.costo_mantencion, v.intervalo_mantencion_km),
    depreciacion:
      nz(v.valor_vehiculo) != null && nz(v.vida_util_km) > 0
        ? Math.max(0, Number(v.valor_vehiculo) - (nz(v.valor_residual) ?? 0)) / Number(v.vida_util_km)
        : null,
  };
  const componentes = {};
  const origen = {};
  const faltantes = [];
  let total = 0;
  for (const c of COMPONENTES_DESGASTE) {
    const manual = nz(v[`costo_km_${c.key}`]);
    if (manual != null) {
      componentes[c.key] = manual;
      origen[c.key] = 'manual';
    } else if (derivado[c.key] != null) {
      componentes[c.key] = derivado[c.key];
      origen[c.key] = 'calculado';
    } else {
      componentes[c.key] = null;
      origen[c.key] = 'sin dato';
      if (c.requerido) faltantes.push(c.label);
    }
    total += componentes[c.key] ?? 0;
  }
  return { total, componentes, origen, faltantes, completo: faltantes.length === 0 };
}

/**
 * Rendimiento real esperado (km/L) según condición del vehículo y carga transportada.
 * ajuste_condicion_pct: pérdida fija (vehículo antiguo, ciudad, etc.).
 * ajuste_carga_pct: pérdida adicional cuando va a plena capacidad (proporcional a la carga).
 */
export function rendimientoEfectivo(v, cargaKg = null) {
  const base = nz(v.rendimiento_km_l);
  if (base == null || base <= 0) return null;
  let y = base * (1 - (nz(v.ajuste_condicion_pct) ?? 0) / 100);
  const pc = nz(v.ajuste_carga_pct) ?? 0;
  if (pc && nz(v.capacidad_kg) > 0 && cargaKg != null) {
    y *= 1 - (pc / 100) * Math.min(1, Math.max(0, cargaKg / Number(v.capacidad_kg)));
  }
  return y > 0 ? y : null;
}

/** Consumo promedio en litros cada 100 km, según el rendimiento configurado. */
export function consumoL100(v) {
  const y = rendimientoEfectivo(v, null);
  return y ? 100 / y : null;
}

/** Costo de operar un kilómetro (combustible + desgaste), sin conductor. */
export function costoRealPorKm(v, precioLitro) {
  const y = rendimientoEfectivo(v, null);
  const des = desgastePorKm(v);
  const faltantes = [];
  if (y == null) faltantes.push('Rendimiento de combustible (km/L)');
  if (precioLitro == null) faltantes.push(`Precio del combustible (${v.combustible})`);
  const combustibleKm = y != null && precioLitro != null ? precioLitro / y : null;
  return {
    combustibleKm,
    desgasteKm: des.total,
    desgaste: des,
    totalKm: combustibleKm != null ? combustibleKm + des.total : null,
    faltantes: [...faltantes, ...des.faltantes.map((f) => `${f} ($/km)`)],
    calculable: faltantes.length === 0,
    completo: faltantes.length === 0 && des.completo,
  };
}

/**
 * Calcula el costo de una ruta ya definida.
 * tramos: [{ km, min, cargaKg }]  (cargaKg puede ser null si no hay pesos)
 * paradas: cantidad de clientes visitados
 */
export function calcularCostos({
  vehiculo,
  precioLitro,
  costoHoraConductor = null,
  servicioMinPorParada = null,
  jornadaHoras = null,
  recargoExtraPct = null,
  tramos,
  paradas,
  extras = {},
}) {
  const warnings = [];
  const faltantes = [];
  const km = tramos.reduce((a, t) => a + (t.km || 0), 0);
  const minConduccion = tramos.reduce((a, t) => a + (t.min || 0), 0);
  const minServicio = (servicioMinPorParada ?? 0) * paradas;
  const minTotal = minConduccion + minServicio;

  const des = desgastePorKm(vehiculo);
  if (des.faltantes.length) {
    warnings.push(`Desgaste parcial: falta ${des.faltantes.join(', ').toLowerCase()}.`);
    faltantes.push(...des.faltantes);
  }
  if (servicioMinPorParada == null) warnings.push('Sin tiempo de servicio por parada configurado: el tiempo total no incluye la espera en cada cliente.');

  const peajes = nz(extras.peajes) ?? 0;
  const estac = nz(extras.estacionamientos) ?? 0;
  const otrosGastos = nz(extras.otros) ?? 0;

  // Combustible tramo a tramo (el rendimiento cambia con la carga que va quedando).
  let litros = 0;
  let calculable = true;
  const directos = [];
  for (const t of tramos) {
    const y = rendimientoEfectivo(vehiculo, t.cargaKg ?? null);
    if (y == null) { calculable = false; break; }
    const l = (t.km || 0) / y;
    litros += l;
    directos.push({
      fuel: precioLitro != null ? l * precioLitro : 0,
      wear: (t.km || 0) * des.total,
      min: t.min || 0,
    });
  }
  if (nz(vehiculo.rendimiento_km_l) == null) faltantes.push('Rendimiento de combustible (km/L)');
  if (precioLitro == null) { calculable = false; faltantes.push(`Precio del combustible (${vehiculo.combustible})`); }

  // Conductor: horas normales + horas adicionales con recargo (si hay jornada configurada).
  let conductor = 0;
  let horasExtra = 0;
  const horas = minTotal / 60;
  if (costoHoraConductor == null) {
    warnings.push('Sin costo por hora del conductor configurado: el costo de mano de obra no está incluido.');
    faltantes.push('Costo por hora del conductor');
  } else {
    if (jornadaHoras != null && horas > jornadaHoras) horasExtra = horas - jornadaHoras;
    const normales = horas - horasExtra;
    conductor = costoHoraConductor * (normales + horasExtra * (1 + (recargoExtraPct ?? 0) / 100));
  }

  if (!calculable) {
    return {
      calculable: false,
      km, minConduccion, minServicio, minTotal, litros: null,
      combustible: null, desgaste: null, otros: null, total: null,
      costoKm: null, costoPorCliente: null,
      warnings, faltantes: [...new Set(faltantes)],
      desgasteDetalle: null, conductor: null, horasExtra, peajes, estacionamientos: estac, otrosGastos,
      directos: [],
    };
  }

  const combustible = r0(directos.reduce((a, d) => a + d.fuel, 0));
  const desgaste = r0(km * des.total);
  const detalle = {};
  for (const c of COMPONENTES_DESGASTE) detalle[c.key] = r0(km * (des.componentes[c.key] ?? 0));
  const conductorR = r0(conductor);
  const otros = conductorR + r0(peajes) + r0(estac) + r0(otrosGastos);
  const total = combustible + desgaste + otros;

  return {
    calculable: true,
    km, minConduccion, minServicio, minTotal,
    litros,
    combustible,
    desgaste,
    desgasteDetalle: detalle,
    conductor: conductorR,
    horasExtra,
    peajes: r0(peajes),
    estacionamientos: r0(estac),
    otrosGastos: r0(otrosGastos),
    otros,
    total,
    costoKm: km > 0 ? total / km : null,
    costoPorCliente: paradas > 0 ? total / paradas : null,
    warnings,
    faltantes: [...new Set(faltantes)],
    // Costos directos por tramo, para repartir el costo entre clientes.
    directos: directos.map((d) => d.fuel + d.wear + (costoHoraConductor != null ? (costoHoraConductor * d.min) / 60 : 0)),
  };
}

/**
 * Reparte el costo total entre los clientes de la ruta.
 * Cada cliente absorbe el costo directo del tramo que lo conecta con la parada anterior;
 * el resto (tramo de regreso, espera en clientes, peajes, horas extra) se divide en partes iguales.
 * La suma de lo asignado es exactamente igual al costo total.
 */
export function repartirCostoPorCliente(directos, total, paradas) {
  if (paradas <= 0) return [];
  const propios = Array.from({ length: paradas }, (_, i) => directos[i] ?? 0);
  const sumaPropios = propios.reduce((a, b) => a + b, 0);
  const resto = total - sumaPropios;
  const bruto = propios.map((p) => p + resto / paradas);
  const redondeado = bruto.map(r0);
  const diff = total - redondeado.reduce((a, b) => a + b, 0);
  redondeado[redondeado.length - 1] += diff;
  return redondeado;
}

/** Dinero por hora, kilómetro y minuto, para ponderar rutas en el optimizador. */
export function costoArco(vehiculo, precioLitro, costoHoraConductor, cargaKg, km, min) {
  const y = rendimientoEfectivo(vehiculo, cargaKg);
  const comb = y && precioLitro != null ? (km / y) * precioLitro : 0;
  const des = desgastePorKm(vehiculo).total * km;
  const cond = costoHoraConductor != null ? (costoHoraConductor * min) / 60 : 0;
  return comb + des + cond;
}

/** Consumo real a partir de cargas de combustible (método estanque lleno a estanque lleno). */
export function consumoReal(logs) {
  const l = [...logs].sort((a, b) => a.km_odometro - b.km_odometro);
  if (l.length < 2) return null;
  const km = l[l.length - 1].km_odometro - l[0].km_odometro;
  const litros = l.slice(1).reduce((a, x) => a + x.litros, 0);
  if (km <= 0 || litros <= 0) return null;
  return { km, litros, kmPorLitro: km / litros, cargas: l.length };
}
