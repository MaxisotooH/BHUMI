// Los datos de demostración deben dejar cada pantalla con contenido y sin romper ninguna regla del sistema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { iniciar } from './helpers.js';
import { sembrarDemo } from './demo-datos.js';

test('demostración: los datos de prueba alimentan los 7 pilares', async () => {
  const { call, cerrar } = await iniciar({ demo: true });
  try {
    const llamar = async (m, ruta, cuerpo) => { const r = await call(m, ruta, cuerpo); if (r.status >= 400) throw new Error(`${m} ${ruta}: ${r.data?.error?.mensaje}`); return r.data; };
    await sembrarDemo(llamar);
    const hoy = new Date();
    const mes = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
    const desde = '2000-01-01', hasta = '2100-01-01';

    const k = await llamar('GET', `/kpi/personal?desde=${desde}&hasta=${hasta}`);
    assert.equal(k.conductores.length, 2);
    assert.equal(k.bodega.length, 2);
    assert.ok(k.total.cumplimiento.pct < 100 && k.total.cumplimiento.pct > 70, 'hay entregas no realizadas de prueba');
    assert.equal(k.sin_registro_total, 1, 'un despacho completado sin horas');
    const b1 = k.bodega.find((x) => x.nombre === 'Bodega de prueba 1');
    const b2 = k.bodega.find((x) => x.nombre === 'Bodega de prueba 2');
    assert.ok(b1.preparacion.prom_min > k.objetivos.preparacion_min, 'la bodega 1 prepara más lento que la meta');
    assert.ok(b2.preparacion.prom_min < k.objetivos.preparacion_min, 'la bodega 2 prepara más rápido que la meta');

    const flota = await llamar('GET', '/flota');
    assert.equal(flota.vehiculos[0].mantencion.estado, 'proxima');
    assert.equal(flota.vehiculos[1].mantencion.estado, 'al_dia');
    assert.ok(flota.vehiculos[0].km_prom_semanal > 0);
    assert.ok(flota.alertas.length >= 1);

    const sec = await llamar('GET', '/zonas/sectores');
    assert.equal(sec.find((x) => x.comuna === 'San Joaquín').seguridad, 'alto_riesgo');
    assert.equal(sec.find((x) => x.comuna === 'San Joaquín').incidentes_90d, 1);

    const cons = await llamar('GET', '/consolidacion');
    assert.ok(cons.resumen.grupos >= 1, 'las entregas de mañana están cerca entre sí y se pueden agrupar');
    assert.ok(cons.resumen.ahorro_estimado > 0, 'hay distancias de Google guardadas de despachos anteriores: el ahorro se calcula con ellas');

    const cc = await llamar('GET', `/control-costos?desde=${desde}&hasta=${hasta}`);
    assert.ok(cc.despachos >= 6);
    assert.ok(cc.total_con_conductor.real > 0, 'hay combustible con monto: se compara lo modelado con lo real');
    assert.ok(cc.real.mantencion_y_desgaste > 0);

    const panel = await llamar('GET', `/panel?desde=${desde}&hasta=${hasta}`);
    assert.ok(panel.rutas_costosas.despachos.length > 0);
    assert.ok(panel.conductores.filas.length === 2);
    assert.ok(panel.utilizacion);
    assert.ok(panel.alertas.length > 0);
    assert.ok(panel.ahorro_potencial.piezas.some((p) => p.id === 'procesos' && p.monto != null), 'con metas y costo por hora, los tiempos sobre la meta se valorizan');

    const conc = await llamar('GET', '/zonas/concentracion?por=comuna');
    assert.ok(conc.grupos.length >= 4);
    const mapa = await llamar('GET', '/zonas/mapa');
    assert.equal(mapa.clientes.length, 6);
    assert.ok(mes);
  } finally { cerrar(); }
});
