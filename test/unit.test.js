import test from 'node:test';
import assert from 'node:assert/strict';
import { REGIONES, TOTAL_COMUNAS, buscarComuna, buscarRegion } from '../server/data/chile.js';
import { calcularCostos, desgastePorKm, costoRealPorKm, repartirCostoPorCliente, rendimientoEfectivo, consumoReal } from '../server/services/costs.js';
import { resolverRuta, costoOrden, agruparCercanos, dividirEnDespachos, haversineKm } from '../server/services/optimizer.js';

test('catálogo de Chile: 16 regiones y 346 comunas sin repetidas', () => {
  assert.equal(REGIONES.length, 16);
  assert.equal(TOTAL_COMUNAS, 346);
  const todas = REGIONES.flatMap((r) => r.comunas);
  assert.equal(new Set(todas).size, 346 - 0, 'hay comunas repetidas');
  assert.equal(buscarComuna('nunoa').comuna, 'Ñuñoa');
  assert.equal(buscarComuna('Quinta Normal').region, 'Metropolitana de Santiago');
  assert.equal(buscarRegion('Región Metropolitana de Santiago'), 'Metropolitana de Santiago');
  assert.equal(buscarRegion('Región del Biobío'), 'Biobío');
  assert.equal(buscarRegion('Región de Aysén del General Carlos Ibáñez del Campo'), 'Aysén del General Carlos Ibáñez del Campo');
});

const veh = (extra = {}) => ({ combustible: 'Bencina', rendimiento_km_l: 10, capacidad_kg: 1000, ...extra });

test('combustible: litros = km / rendimiento; costo = litros x precio', () => {
  const c = calcularCostos({ vehiculo: veh(), precioLitro: 1200, tramos: [{ km: 100, min: 120, cargaKg: null }], paradas: 4 });
  assert.equal(c.calculable, true);
  assert.equal(c.litros, 10);
  assert.equal(c.combustible, 12000);
  assert.equal(c.total, 12000); // sin desgaste ni conductor configurados
});

test('costo real por km: el ejemplo de 100 km da $275/km', () => {
  // combustible 20.000 + neumáticos 2.000 + mantención 3.000 + depreciación 2.500 = 27.500 por 100 km
  const v = veh({ rendimiento_km_l: 5, costo_km_neumaticos: 20, costo_km_mantencion: 30, costo_km_depreciacion: 25 });
  const ck = costoRealPorKm(v, 1000);
  assert.equal(ck.combustibleKm, 200);
  assert.equal(ck.desgasteKm, 75);
  assert.equal(ck.totalKm, 275);
  const c = calcularCostos({ vehiculo: v, precioLitro: 1000, tramos: [{ km: 100, min: 0, cargaKg: null }], paradas: 1 });
  assert.equal(c.combustible, 20000);
  assert.equal(c.desgaste, 7500);
  assert.equal(c.total, 27500);
  assert.equal(c.costoKm, 275);
});

test('desgaste se calcula con datos del vehículo si no hay valor manual', () => {
  const v = veh({ valor_neumaticos: 400000, vida_neumaticos_km: 40000, costo_mantencion: 90000, intervalo_mantencion_km: 10000, valor_vehiculo: 10000000, valor_residual: 2000000, vida_util_km: 200000 });
  const d = desgastePorKm(v);
  assert.equal(d.componentes.neumaticos, 10);
  assert.equal(d.componentes.mantencion, 9);
  assert.equal(d.componentes.depreciacion, 40);
  assert.equal(d.origen.neumaticos, 'calculado');
  assert.equal(d.completo, true);
  assert.equal(desgastePorKm(veh({ costo_km_neumaticos: 12 })).origen.neumaticos, 'manual');
});

test('sin rendimiento o sin precio no se inventan costos', () => {
  const sinRend = calcularCostos({ vehiculo: { combustible: 'Bencina' }, precioLitro: 1000, tramos: [{ km: 50, min: 60, cargaKg: null }], paradas: 2 });
  assert.equal(sinRend.calculable, false);
  assert.equal(sinRend.total, null);
  assert.ok(sinRend.faltantes.some((f) => f.includes('Rendimiento')));
  const sinPrecio = calcularCostos({ vehiculo: veh(), precioLitro: null, tramos: [{ km: 50, min: 60, cargaKg: null }], paradas: 2 });
  assert.equal(sinPrecio.calculable, false);
  assert.ok(sinPrecio.faltantes.some((f) => f.includes('Precio')));
});

test('conductor: horas normales + horas extra con recargo', () => {
  const c = calcularCostos({
    vehiculo: veh(), precioLitro: 1000, costoHoraConductor: 5000, jornadaHoras: 8, recargoExtraPct: 50,
    tramos: [{ km: 10, min: 600, cargaKg: null }], paradas: 0,
  });
  // 10 h: 8 normales + 2 extra a 1,5 => 5000 * (8 + 3) = 55.000
  assert.equal(c.conductor, 55000);
  assert.equal(c.otros, 55000);
});

test('rendimiento baja con la carga y con el estado del vehículo', () => {
  const v = veh({ ajuste_carga_pct: 20, ajuste_condicion_pct: 10 });
  assert.equal(rendimientoEfectivo(v, 0), 9);
  assert.ok(Math.abs(rendimientoEfectivo(v, 1000) - 7.2) < 1e-9);
  assert.ok(Math.abs(rendimientoEfectivo(v, 500) - 8.1) < 1e-9);
});

test('el costo asignado a clientes suma exactamente el total', () => {
  const r = repartirCostoPorCliente([1000.4, 2000.7, 3000.2], 10001, 3);
  assert.equal(r.reduce((a, b) => a + b, 0), 10001);
  assert.equal(r.length, 3);
});

test('consumo real por método estanque lleno', () => {
  const c = consumoReal([{ km_odometro: 1000, litros: 40 }, { km_odometro: 1300, litros: 30 }, { km_odometro: 1600, litros: 30 }]);
  assert.equal(c.kmPorLitro, 600 / 60);
  assert.equal(consumoReal([{ km_odometro: 5, litros: 3 }]), null);
});

function matrizAleatoria(n, semilla) {
  let s = semilla;
  const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return Array.from({ length: n + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === j ? 0 : 1 + rnd() * 50)));
}
function permutaciones(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutaciones([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

test('optimizador exacto coincide con fuerza bruta (matrices asimétricas, con y sin regreso)', () => {
  for (const retorna of [true, false]) {
    for (let semilla = 1; semilla <= 6; semilla++) {
      const m = matrizAleatoria(7, semilla);
      const brute = Math.min(...permutaciones([1, 2, 3, 4, 5, 6, 7]).map((o) => costoOrden(m, o, retorna)));
      const r = resolverRuta(m, { retorna });
      assert.ok(Math.abs(r.costo - brute) < 1e-9, `semilla ${semilla}: ${r.costo} vs ${brute}`);
      assert.ok(Math.abs(costoOrden(m, r.orden, retorna) - r.costo) < 1e-9);
    }
  }
});

test('heurística (más de 15 paradas) queda cerca del exacto y usa todas las paradas', () => {
  const m = matrizAleatoria(11, 42);
  const exacto = resolverRuta(m, { retorna: true, exactoHasta: 15 });
  const heur = resolverRuta(m, { retorna: true, exactoHasta: 0 });
  assert.equal(heur.exacto, false);
  assert.equal(new Set(heur.orden).size, 11);
  assert.ok(heur.costo <= exacto.costo * 1.15, `${heur.costo} vs ${exacto.costo}`);
  const grande = resolverRuta(matrizAleatoria(25, 7), { retorna: true });
  assert.equal(new Set(grande.orden).size, 25);
});

test('agrupación de cercanos y división por capacidad', () => {
  const base = { lat: -33.45, lng: -70.66 };
  const p = [
    { id: 1, lat: -33.45, lng: -70.66 }, { id: 2, lat: -33.46, lng: -70.65 }, // ~1,5 km
    { id: 3, lat: -33.9, lng: -70.0 },
  ];
  const g = agruparCercanos(p, 5);
  assert.equal(g.length, 2);
  assert.equal(g.find((x) => x.length === 2).map((x) => x.id).sort().join(), '1,2');
  assert.ok(haversineKm(p[0], p[1]) < 2);
  const paradas = Array.from({ length: 10 }, (_, i) => ({ key: `p${i}`, lat: -33.4 - i * 0.01, lng: -70.6 + i * 0.01, peso_kg: 100 }));
  const grupos = dividirEnDespachos(paradas, base, { maxParadas: 25, capacidadKg: 350 });
  assert.ok(grupos.every((gr) => gr.reduce((a, x) => a + x.peso_kg, 0) <= 350));
  assert.equal(grupos.flat().length, 10);
});
