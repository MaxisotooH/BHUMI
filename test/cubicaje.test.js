import { test } from 'node:test';
import assert from 'node:assert/strict';
import { empacar, cubicar, capacidadPorProducto, orientaciones, CubicajeError } from '../server/services/cubicaje.js';

const prng = (semilla) => () => { semilla |= 0; semilla = (semilla + 0x6D2B79F5) | 0; let t = Math.imul(semilla ^ (semilla >>> 15), 1 | semilla); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Comprueba que ningún bloque salga del contenedor ni se cruce con otro. */
function validar(cont, bloques) {
  for (const b of bloques) {
    assert.ok(b.x >= -1e-6 && b.y >= -1e-6 && b.z >= -1e-6, 'bloque con coordenadas negativas');
    assert.ok(b.x + b.bl <= cont.largo + 1e-6 && b.y + b.ba <= cont.ancho + 1e-6 && b.z + b.bh <= cont.alto + 1e-6, 'bloque fuera del contenedor');
  }
  for (let i = 0; i < bloques.length; i++) for (let j = i + 1; j < bloques.length; j++) {
    const a = bloques[i], b = bloques[j];
    const cruza = a.x < b.x + b.bl - 1e-6 && b.x < a.x + a.bl - 1e-6 && a.y < b.y + b.ba - 1e-6 && b.y < a.y + a.ba - 1e-6 && a.z < b.z + b.bh - 1e-6 && b.z < a.z + a.bh - 1e-6;
    assert.ok(!cruza, `los bloques ${i} y ${j} se cruzan`);
  }
}

const caja = (id, l, a, h, extra = {}) => ({ id, nombre: `P${id}`, largo: l, ancho: a, alto: h, apilable: true, rotable: false, cantidad: 1, ...extra });

test('una sola medida de caja: coincide con el mejor acomodo en cuadrícula', () => {
  const cont = { largo: 250, ancho: 150, alto: 120 };
  const r = empacar(cont, [caja(1, 60, 40, 40, { cantidad: 500 })]);
  const mejor = Math.max(...orientaciones(caja(1, 60, 40, 40)).map(([x, y, z]) => Math.floor(cont.largo / x) * Math.floor(cont.ancho / y) * Math.floor(cont.alto / z)));
  assert.equal(r.colocadas[1], mejor);
  validar(cont, r.bloques);
});

test('cubo perfecto: 8 cajas de 50 cm caben en 1 m³ y la novena no', () => {
  const cont = { largo: 100, ancho: 100, alto: 100 };
  assert.equal(empacar(cont, [caja(1, 50, 50, 50, { cantidad: 8 })]).faltan[1], 0);
  assert.equal(empacar(cont, [caja(1, 50, 50, 50, { cantidad: 9 })]).faltan[1], 1);
});

test('lo que no se puede apilar queda en una sola capa', () => {
  const cont = { largo: 100, ancho: 100, alto: 100 };
  const r = empacar(cont, [caja(1, 50, 50, 25, { cantidad: 50, apilable: false })]);
  assert.equal(r.colocadas[1], 4);
  validar(cont, r.bloques);
});

test('sin rotar, una caja alta no se acuesta', () => {
  const cont = { largo: 100, ancho: 100, alto: 40 };
  assert.equal(empacar(cont, [caja(1, 30, 30, 90, { cantidad: 3 })]).colocadas[1], 0);
  assert.equal(empacar(cont, [caja(1, 30, 30, 90, { cantidad: 3, rotable: true })]).colocadas[1], 3);
});

test('cargas mixtas: nunca se superponen ni se salen (500 casos al azar)', () => {
  const azar = prng(2026);
  for (let n = 0; n < 500; n++) {
    const cont = { largo: 150 + azar() * 250, ancho: 100 + azar() * 120, alto: 80 + azar() * 120 };
    const cargas = Array.from({ length: 1 + Math.floor(azar() * 5) }, (_, i) => caja(i + 1, 10 + azar() * 70, 10 + azar() * 60, 10 + azar() * 60, { cantidad: 1 + Math.floor(azar() * 60), apilable: azar() > 0.3, rotable: azar() > 0.6 }));
    const r = empacar(cont, cargas);
    validar(cont, r.bloques);
    for (const c of cargas) {
      const enBloques = r.bloques.filter((b) => b.id === c.id).reduce((s, b) => s + b.unidades, 0);
      assert.equal(enBloques, r.colocadas[c.id]);
      assert.equal(r.colocadas[c.id] + r.faltan[c.id], c.cantidad);
    }
    const volBloques = r.bloques.reduce((s, b) => s + b.unidades * cargas.find((c) => c.id === b.id).largo * cargas.find((c) => c.id === b.id).ancho * cargas.find((c) => c.id === b.id).alto, 0);
    assert.ok(volBloques <= cont.largo * cont.ancho * cont.alto + 1e-3, 'las cajas ocupan más volumen que el vehículo');
  }
});

const veh = { carga_largo_cm: 250, carga_ancho_cm: 150, carga_alto_cm: 120, capacidad_kg: 1000 };
const prod = (id, l, a, h, peso, extra = {}) => ({ id, nombre: `Prod ${id}`, largo_cm: l, ancho_cm: a, alto_cm: h, peso_kg: peso, apilable: 1, rotable: 0, ...extra });

test('cubicar informa volumen, peso y qué limita', () => {
  const r = cubicar(veh, [{ producto: prod(1, 50, 50, 50, 20), cantidad: 30 }]);
  assert.equal(r.cabe, true);
  assert.equal(r.unidades_colocadas, 30);
  assert.equal(Math.round(r.peso_kg), 600);
  assert.equal(Math.round(r.peso_pct), 60);
  assert.ok(Math.abs(r.ocupacion_volumen_pct - (30 * 0.125 / (2.5 * 1.5 * 1.2)) * 100) < 1e-6);
  const pesado = cubicar(veh, [{ producto: prod(1, 50, 50, 50, 60), cantidad: 30 }]);
  assert.equal(pesado.cabe, false);
  assert.equal(pesado.limitante, 'peso');
  const grande = cubicar(veh, [{ producto: prod(1, 50, 50, 50, 1), cantidad: 80 }]);
  assert.equal(grande.cabe, false);
  assert.equal(grande.limitante, 'volumen');
  assert.ok(grande.unidades_colocadas < 80 && grande.unidades_colocadas > 0);
});

test('cubicar pide las medidas que faltan, sin inventar', () => {
  assert.throws(() => cubicar({ capacidad_kg: 500 }, [{ producto: prod(1, 10, 10, 10, 1), cantidad: 1 }]), (e) => e instanceof CubicajeError && e.extra.vehiculo.length === 3);
  assert.throws(() => cubicar(veh, [{ producto: prod(7, null, 10, 10, 1), cantidad: 2 }]), (e) => e.code === 'datos_faltantes' && e.extra.productos[0].faltan[0] === 'largo');
  const sinPeso = cubicar(veh, [{ producto: prod(1, 50, 50, 50, null), cantidad: 2 }]);
  assert.ok(sinPeso.advertencias.some((a) => /Sin peso/.test(a)));
  assert.equal(sinPeso.cabe, true);
});

test('capacidad por producto: por volumen, por peso y el límite real', () => {
  const c = capacidadPorProducto(veh, prod(1, 50, 50, 50, 100));
  assert.equal(c.por_volumen, 30);   // 5 × 3 × 2
  assert.equal(c.por_peso, 10);
  assert.equal(c.maximo, 10);
  assert.equal(c.limitante, 'peso');
});
