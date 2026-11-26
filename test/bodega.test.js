// Fase 4: Bodega no recibe costos desde el servidor, y la interfaz recibe las mismas reglas de permisos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, MODO_LOCAL } from './helpers.js';
import { sembrarDemo } from './demo-datos.js';
import { sinCostos, esCampoCosto, reglasPara, permitido } from '../server/auth.js';

const http = { skip: MODO_LOCAL ? 'solo aplica al servidor HTTP' : false };

/** Todas las claves de un valor JSON, a cualquier profundidad. */
const claves = (x, out = new Set()) => {
  if (Array.isArray(x)) x.forEach((y) => claves(y, out));
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) { out.add(k); claves(v, out); }
  return out;
};

test('sinCostos: quita los costos a cualquier profundidad y deja lo demás', () => {
  const r = sinCostos({
    id: 1, distancia_km: 30, costo_total: 25000, costo_km: { total: 800, combustible: 500 }, ahorro: 1200, valor_vehiculo: 9e6,
    peajes: 1800, precio_combustible: 1300, precio: 1300, monto: 40000, peso_costo: 1, baseline_total: 30000,
    plan: { retorno: true, alternativas: [{ codigo: 'A', total: 25000 }], baseline: { total: 30000 } },
    paradas: [{ nombre: 'Cliente', costo_asignado: 5000, items: [{ cantidad: 2 }] }],
  });
  assert.deepEqual(r, { id: 1, distancia_km: 30, precio: 1300, monto: 40000, peso_costo: 1, plan: { retorno: true }, paradas: [{ nombre: 'Cliente', items: [{ cantidad: 2 }] }] });
  assert.equal(esCampoCosto('costo_hora_conductor'), true);
  assert.equal(esCampoCosto('km_actual'), false);
});

test('reglas para la interfaz: son las mismas que aplica el servidor', () => {
  assert.equal(reglasPara('admin').todo, true);
  const p = reglasPara('planificador');
  assert.equal(p.todo, false);
  assert.equal(p.lista, null);
  assert.ok(p.solo_admin.some((s) => new RegExp(s).test('/usuarios')));
  const b = reglasPara('bodega');
  // Se reconstruye la regla del lado de la interfaz y se compara con permitido() en una muestra de rutas.
  const lee = b.lista.lee.map((s) => new RegExp(s));
  const escribe = b.lista.escribe.map(([m, s]) => [m, new RegExp(s)]);
  const soloAdmin = b.solo_admin.map((s) => new RegExp(s));
  const comoInterfaz = (m, r) => !soloAdmin.some((re) => re.test(r)) && (m === 'GET' ? lee.some((re) => re.test(r)) : escribe.some(([mm, re]) => mm === m && re.test(r)));
  for (const [m, r] of [['GET', '/despachos'], ['GET', '/panel'], ['POST', '/vehiculos'], ['PUT', '/km-semanal'], ['POST', '/vehiculos/1/cargas'], ['DELETE', '/cargas/1'], ['GET', '/reportes/flota.xlsx'], ['GET', '/reportes/despacho/1.pdf'], ['PUT', '/despachos/1/tiempos']]) {
    assert.equal(comoInterfaz(m, r), permitido('bodega', m, r), `${m} ${r}`);
  }
});

test('Bodega: ninguna respuesta que puede leer trae campos de costo; Admin sí los ve', http, async () => {
  const s = await iniciar({ demo: true });
  try {
    await sembrarDemo(async (m, r, b) => { const x = await s.call(m, r, b); if (x.status >= 400) throw new Error(`${m} ${r}: ${x.data?.error?.mensaje}`); return x.data; });
    const bodega = await s.comoRol('bodega');
    const despachos = (await s.call('GET', '/despachos')).data;
    const trip = despachos.find((t) => t.n_paradas > 0).id;
    const veh = (await s.call('GET', '/vehiculos')).data[0].id;
    const cli = (await s.call('GET', '/clientes')).data[0].id;
    const rutas = ['/despachos', `/despachos/${trip}`, `/despachos/${trip}/tiempos`, `/despachos/${trip}/ruta-conductor`, '/vehiculos', `/vehiculos/${veh}`,
      `/vehiculos/${veh}/cargas`, '/flota', '/km-semanal', '/settings', '/setup', '/personal', '/productos', '/clientes', `/clientes/${cli}`, '/entregas',
      '/consolidacion', '/zonas/concentracion', '/zonas/mapa', `/cubicaje/capacidad?vehicle_id=${veh}`];
    for (const r of rutas) {
      const x = await bodega.call('GET', r);
      assert.equal(x.status, 200, r);
      const costos = [...claves(x.data)].filter(esCampoCosto);
      assert.deepEqual(costos, [], `${r} trae costos: ${costos.join(', ')}`);
    }
    // El mismo despacho visto por Admin sí trae sus costos.
    const admin = (await s.call('GET', `/despachos/${trip}`)).data;
    assert.ok([...claves(admin)].some(esCampoCosto));
    // También se quitan de lo que devuelve una escritura de Bodega.
    const km = await bodega.call('PUT', '/km-semanal', { vehicle_id: veh, semana: '2026-11-23', km_inicio: 1000, km_fin: 1250 });
    assert.deepEqual([...claves(km.data)].filter(esCampoCosto), []);
  } finally { s.cerrar(); }
});

test('/auth/yo entrega las reglas del rol para la interfaz', http, async () => {
  const s = await iniciar();
  try {
    assert.equal((await s.call('GET', '/auth/yo')).data.permisos.todo, true);
    const b = await s.comoRol('bodega');
    const p = (await b.call('GET', '/auth/yo')).data.permisos;
    assert.equal(p.rol, 'bodega');
    assert.ok(p.lista.lee.length > 5 && p.lista.escribe.length > 3);
  } finally { s.cerrar(); }
});
