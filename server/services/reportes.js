// Reportes en Excel (.xlsx) y PDF.
// Cada reporte se describe una vez (resumen + secciones con tablas) y de ahí salen el Excel y el PDF.
// En el Excel los valores quedan como números reales (se pueden sumar y ordenar); en el PDF se formatean para leer.
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { getSettings } from '../db.js';
import { panelAnalisis } from './panel.js';
import { controlCostos, listarGastos } from './control-costos.js';
import { kpisPersonal, medirDespachos, detalleParadas } from './tiempos.js';
import { estadoFlota } from './vehiculos-estado.js';
import { listarSectores, concentracionEntregas, SEGURIDAD, TIPOS_INCIDENTE } from './zonas.js';
import { resolverPeriodo } from './periodo.js';
import { seguridadDeParadas } from './zonas.js';
import { rutaParaConductor } from './ruta-conductor.js';

const nf = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const clp = (n) => (n == null ? '—' : `$${nf.format(Math.round(n))}`);
const dur = (min) => {
  if (min == null) return '—';
  const m = Math.round(min);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
};
const pct = (n) => (n == null ? '—' : `${nf1.format(n)}%`);
const nombreSeguridad = (id) => SEGURIDAD.find((s) => s.id === id)?.nombre ?? id ?? '';

// Tipos de columna: cómo se ve en Excel (formato numérico) y en PDF (texto)
const TIPOS = {
  txt: { excel: null, pdf: (v) => (v == null ? '' : String(v)) },
  clp: { excel: '"$"#,##0', pdf: clp, a: 'right' },
  km: { excel: '#,##0.0', pdf: (v) => (v == null ? '—' : nf1.format(v)), a: 'right' },
  min: { excel: '#,##0.0', pdf: dur, a: 'right' },
  pct: { excel: '#,##0.0', pdf: pct, a: 'right' },
  n1: { excel: '#,##0.0', pdf: (v) => (v == null ? '—' : nf1.format(v)), a: 'right' },
  n0: { excel: '#,##0', pdf: (v) => (v == null ? '—' : nf.format(v)), a: 'right' },
};

// ---------- Excel ----------
const VERDE = '#0E4D3C';
const TINTA = '#17211D';
const GRIS = '#5b6762';

export async function excelDe(db, reporte) {
  const s = getSettings(db);
  const wb = new ExcelJS.Workbook();
  wb.creator = s.empresa_nombre;
  wb.created = new Date();
  const res = wb.addWorksheet('Resumen');
  res.columns = [{ width: 44 }, { width: 24 }];
  res.addRow([`${s.empresa_nombre} — ${reporte.titulo}`]);
  res.getRow(1).font = { bold: true, size: 14 };
  if (reporte.periodo) res.addRow(['Período', reporte.periodo]);
  for (const [etiqueta, valor, tipo] of reporte.resumen) {
    const row = res.addRow([etiqueta, valor]);
    if (TIPOS[tipo]?.excel) row.getCell(2).numFmt = TIPOS[tipo].excel;
    row.getCell(2).alignment = { horizontal: 'right' };
  }
  if (reporte.notas?.length) { res.addRow([]); for (const n of reporte.notas) res.addRow([n]); }
  const usados = new Set(['Resumen']);
  for (const sec of reporte.secciones) {
    let nombre = sec.nombre.slice(0, 31);
    for (let i = 2; usados.has(nombre); i++) nombre = `${sec.nombre.slice(0, 28)} ${i}`;
    usados.add(nombre);
    const ws = wb.addWorksheet(nombre, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sec.columnas.map((c) => ({ header: c.h, key: c.k, width: c.w ?? 14, style: TIPOS[c.t ?? 'txt'].excel ? { numFmt: TIPOS[c.t].excel } : {} }));
    const enc = ws.getRow(1);
    enc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    enc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0E4D3C' } };
    enc.alignment = { vertical: 'middle', wrapText: true };
    for (const f of sec.filas) ws.addRow(f);
    if (sec.nota) { ws.addRow([]); ws.addRow([sec.nota]); }
  }
  return wb.xlsx.writeBuffer();
}

// ---------- PDF ----------
function encabezadoPdf(doc, s, titulo, subtitulo) {
  doc.rect(0, 0, doc.page.width, 64).fill(VERDE);
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(18).text(s.empresa_nombre, 40, 20);
  doc.font('Helvetica').fontSize(10).text(titulo, 40, 42);
  doc.fillColor(TINTA);
  doc.y = 84;
  if (subtitulo) doc.font('Helvetica').fontSize(10).fillColor(GRIS).text(subtitulo, 40, 80).moveDown(0.6);
  doc.fillColor(TINTA);
}

function tablaPdf(doc, columnas, filas, { fuente = 8.5, minAlto = 0 } = {}) {
  const x0 = 40;
  const ancho = doc.page.width - 80;
  const totalW = columnas.reduce((a, c) => a + c.w, 0);
  const w = columnas.map((c) => (c.w / totalW) * ancho);
  const pintarEncabezado = () => {
    const altoEnc = Math.max(18, Math.max(...columnas.map((c, i) => doc.font('Helvetica-Bold').fontSize(fuente).heightOfString(c.h, { width: w[i] - 8 }))) + 8);
    const y = doc.y;
    doc.rect(x0, y, ancho, altoEnc).fill('#E4EEEA');
    doc.fillColor(TINTA).font('Helvetica-Bold').fontSize(fuente);
    let x = x0;
    columnas.forEach((c, i) => { doc.text(c.h, x + 4, y + 4, { width: w[i] - 8, align: c.a ?? 'left' }); x += w[i]; });
    doc.y = y + altoEnc + 2;
  };
  pintarEncabezado();
  doc.font('Helvetica').fontSize(fuente);
  for (const f of filas) {
    const alto = Math.max(minAlto, Math.max(...columnas.map((c, i) => doc.heightOfString(String(f[c.k] ?? ''), { width: w[i] - 8 }))) + 8);
    if (doc.y + alto > doc.page.height - 50) { doc.addPage(); doc.y = 40; pintarEncabezado(); doc.font('Helvetica').fontSize(fuente); }
    const y = doc.y;
    let x = x0;
    columnas.forEach((c, i) => {
      if (c.caja) {
        doc.rect(x + 4, y + 4, w[i] - 8, alto - 8).lineWidth(0.6).strokeColor('#9AA8A2').stroke();
        if (f[c.k]) doc.fillColor(TINTA).font('Helvetica-Bold').text(String(f[c.k]), x + 4, y + alto / 2 - 5, { width: w[i] - 8, align: 'center', lineBreak: false }).font('Helvetica').fontSize(fuente);
      } else doc.fillColor(TINTA).text(String(f[c.k] ?? ''), x + 4, y + 4, { width: w[i] - 8, align: c.a ?? 'left' });
      x += w[i];
    });
    doc.moveTo(x0, y + alto).lineTo(x0 + ancho, y + alto).strokeColor('#D9E2DE').lineWidth(0.5).stroke();
    doc.y = y + alto;
  }
}

function lineaDato(doc, etiqueta, valor, { negrita = false, ancho = 300 } = {}) {
  const y = doc.y;
  doc.font(negrita ? 'Helvetica-Bold' : 'Helvetica').fontSize(10).fillColor(TINTA).text(etiqueta, 40, y, { width: ancho });
  doc.text(valor, 40 + ancho, y, { width: 215, align: 'right' });
  doc.moveDown(0.25);
}

export function pdfDe(db, reporte, salida, { horizontal = false } = {}) {
  const s = getSettings(db);
  const doc = new PDFDocument({ size: 'A4', layout: horizontal ? 'landscape' : 'portrait', margin: 40 });
  doc.pipe(salida);
  encabezadoPdf(doc, s, reporte.titulo, reporte.periodo ? `Período: ${reporte.periodo}` : null);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(VERDE).text('Resumen', 40, 106);
  doc.moveDown(0.4);
  for (const [etiqueta, valor, tipo, negrita] of reporte.resumen) lineaDato(doc, etiqueta, (TIPOS[tipo ?? 'txt'].pdf)(valor), { negrita: !!negrita, ancho: horizontal ? 420 : 300 });
  for (const n of reporte.notas ?? []) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(n, 40, undefined, { width: doc.page.width - 80 }); }
  for (const sec of reporte.secciones) {
    if (!sec.filas.length && !sec.vacio) continue;
    doc.moveDown(1);
    if (doc.y > doc.page.height - 140) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(VERDE).text(sec.titulo ?? sec.nombre, 40);
    doc.moveDown(0.4);
    if (!sec.filas.length) { doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(sec.vacio, 40); continue; }
    tablaPdf(doc, sec.columnas.map((c) => ({ h: c.h, k: c.k, w: c.pw ?? Math.min(c.w ?? 14, 26), a: c.a ?? TIPOS[c.t ?? 'txt'].a })),
      sec.filas.map((f) => Object.fromEntries(sec.columnas.map((c) => [c.k, (TIPOS[c.t ?? 'txt'].pdf)(f[c.k])]))));
    if (sec.nota) { doc.moveDown(0.3); doc.font('Helvetica').fontSize(8.5).fillColor(GRIS).text(sec.nota, 40, undefined, { width: doc.page.width - 80 }); }
  }
  doc.end();
}

// ---------- Panel de análisis ----------
export function reportePanel(db, filtros = {}) {
  const p = panelAnalisis(db, filtros);
  const r = p.resumen;
  const dif = (x) => (x == null ? null : x);
  return {
    titulo: 'Panel de análisis y comparación',
    periodo: p.periodo.etiqueta,
    resumen: [
      ['Despachos completados', r.despachos, 'n0'], ['Entregas (paradas)', r.entregas, 'n0'], ['Distancia total (km)', r.km, 'km'],
      ['Costo total', r.costo_total, 'clp', true], ['Costo por kilómetro', r.costo_km, 'clp'], ['Costo por entrega', r.costo_entrega, 'clp'],
      ['Cumplimiento de entregas', r.cumplimiento_pct, 'pct'], ['Utilización de carga por peso', r.utilizacion_peso_pct, 'pct'], ['Utilización de carga por volumen', r.utilizacion_volumen_pct, 'pct'],
      ['Ahorro potencial identificado', r.ahorro_potencial, 'clp', true],
    ],
    notas: [
      ...(r.ahorro_potencial != null && !r.ahorro_completo ? ['El ahorro potencial suma solo los componentes que se pudieron calcular; el detalle indica qué falta en los demás.'] : []),
      ...(p.datos_faltantes.length ? [`Datos que mejorarían el análisis: ${p.datos_faltantes.join('; ')}.`] : []),
    ],
    secciones: [
      { nombre: 'Rutas más costosas', titulo: '1. Despachos más costosos', vacio: 'No hay despachos completados en el período.', columnas: [
        { h: 'N°', k: 'trip_id', w: 6, t: 'n0' }, { h: 'Fecha', k: 'fecha', w: 12 }, { h: 'Vehículo', k: 'vehiculo', w: 20 }, { h: 'Conductor', k: 'conductor', w: 18 }, { h: 'Sectores', k: 'sectores', w: 30 },
        { h: 'Paradas', k: 'paradas', w: 8, t: 'n0' }, { h: 'Km', k: 'km', w: 9, t: 'km' }, { h: 'Costo total', k: 'costo_total', w: 13, t: 'clp' }, { h: '$/km', k: 'costo_km', w: 10, t: 'clp' }, { h: '$/entrega', k: 'costo_entrega', w: 12, t: 'clp' },
      ], filas: p.rutas_costosas.despachos.map((d) => ({ ...d, sectores: d.sectores.join(' · ') })) },
      { nombre: 'Rutas por sectores', titulo: 'Rutas agrupadas por los sectores que recorren', columnas: [
        { h: 'Ruta (sectores)', k: 'ruta', w: 36, pw: 30 }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Km', k: 'km', w: 10, t: 'km' }, { h: 'Costo total', k: 'costo_total', w: 14, t: 'clp' },
        { h: 'Costo promedio', k: 'costo_promedio', w: 14, t: 'clp' }, { h: '$/km', k: 'costo_km', w: 10, t: 'clp' }, { h: '$/entrega', k: 'costo_entrega', w: 12, t: 'clp' },
      ], filas: p.rutas_costosas.por_ruta },
      { nombre: 'Conductores', titulo: '2. Tiempos y rendimiento de los conductores', vacio: 'Sin despachos en el período.', columnas: [
        { h: 'Conductor', k: 'nombre', w: 22 }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Con horas', k: 'medidos', w: 9, t: 'n0' }, { h: 'Km', k: 'km', w: 9, t: 'km' }, { h: '$/entrega', k: 'costo_entrega', w: 12, t: 'clp' },
        { h: 'Ruta promedio', k: 'ruta_prom_min', w: 12, t: 'min' }, { h: 'Real − estimado', k: 'ruta_vs_estimado_min', w: 12, t: 'min' }, { h: 'Paradas por hora', k: 'paradas_por_hora', w: 11, t: 'n1' },
        { h: 'Puntualidad', k: 'puntualidad_pct', w: 11, t: 'pct' }, { h: 'Cumplimiento', k: 'cumplimiento_pct', w: 12, t: 'pct' }, { h: 'Atraso de salida', k: 'atraso_salida_min', w: 12, t: 'min' },
      ], filas: p.conductores.filas },
      { nombre: 'Costo por cliente', titulo: '3. Clientes con mayor costo de entrega', vacio: 'Sin entregas con costo asignado en el período.', columnas: [
        { h: 'Cliente', k: 'nombre', w: 28 }, { h: 'Comuna', k: 'comuna', w: 16 }, { h: 'Entregas', k: 'entregas', w: 9, t: 'n0' }, { h: 'Costo total', k: 'costo_total', w: 14, t: 'clp' },
        { h: 'Promedio por entrega', k: 'costo_promedio', w: 15, t: 'clp' }, { h: 'Veces el promedio', k: 'veces_promedio', w: 11, t: 'n1' },
      ], filas: p.costo_cliente_sector.clientes },
      { nombre: 'Costo por sector', titulo: 'Costo por sector (comuna)', columnas: [
        { h: 'Sector', k: 'clave', w: 20 }, { h: 'Entregas', k: 'entregas', w: 9, t: 'n0' }, { h: 'Clientes', k: 'clientes', w: 9, t: 'n0' }, { h: 'Km', k: 'km', w: 9, t: 'km' }, { h: 'Costo', k: 'costo', w: 13, t: 'clp' },
        { h: '$/entrega', k: 'costo_por_entrega', w: 12, t: 'clp' }, { h: '% de entregas', k: 'pct_entregas', w: 11, t: 'pct' }, { h: 'Seguridad', k: 'seguridad', w: 15 },
      ], filas: p.costo_cliente_sector.sectores.map((s) => ({ ...s, seguridad: nombreSeguridad(s.seguridad) })) },
      { nombre: 'Vehículos', titulo: '4. Kilometraje y desgaste de los vehículos', columnas: [
        { h: 'Vehículo', k: 'nombre', w: 20 }, { h: 'Patente', k: 'patente', w: 10 }, { h: 'Km registrados en el período', k: 'km_periodo', w: 14, t: 'km' }, { h: 'Km de despachos', k: 'km_despachos', w: 12, t: 'km' },
        { h: 'Km por semana', k: 'km_prom_semanal', w: 11, t: 'km' }, { h: 'Odómetro', k: 'odometro_km', w: 11, t: 'n0' }, { h: 'Desgaste modelado', k: 'desgaste_modelado', w: 13, t: 'clp' }, { h: 'Mantención real', k: 'mantencion_real', w: 13, t: 'clp' },
        { h: 'Vida consumida', k: 'desgaste_pct', w: 11, t: 'pct' }, { h: '$/km', k: 'costo_km', w: 9, t: 'clp' },
      ], filas: p.vehiculos },
      { nombre: 'Combustible', titulo: '5. Combustible: consumo y oportunidades de ahorro', columnas: [
        { h: 'Vehículo', k: 'nombre', w: 22 }, { h: 'km/L configurado', k: 'configurado_km_l', w: 12, t: 'n1' }, { h: 'km/L real', k: 'real_km_l', w: 10, t: 'n1' }, { h: 'Desvío', k: 'desvio_pct', w: 9, t: 'pct' },
        { h: 'Litros de más', k: 'litros_extra', w: 11, t: 'n1' }, { h: 'Costo de más', k: 'costo_extra', w: 12, t: 'clp' },
      ], filas: p.combustible.vehiculos },
      { nombre: 'Oportunidades combustible', titulo: 'Oportunidades detectadas', vacio: 'No se detectaron oportunidades con los datos actuales.', columnas: [
        { h: 'Oportunidad', k: 'texto', w: 70, pw: 38 }, { h: 'Ahorro estimado', k: 'ahorro', w: 14, t: 'clp' },
      ], filas: p.combustible.oportunidades },
      { nombre: 'Utilización de carga', titulo: '6. Utilización de la capacidad de carga', columnas: [
        { h: 'Vehículo', k: 'nombre', w: 24 }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Capacidad (kg)', k: 'capacidad_kg', w: 13, t: 'n0' }, { h: 'Uso por peso', k: 'peso_pct', w: 12, t: 'pct' }, { h: 'Uso por volumen', k: 'volumen_pct', w: 13, t: 'pct' },
      ], filas: p.utilizacion.por_vehiculo, nota: p.utilizacion.objetivo_pct != null ? `Meta de utilización: ${pct(p.utilizacion.objetivo_pct)}.` : null },
      { nombre: 'Ahorro potencial', titulo: '7. Ahorro potencial', columnas: [
        { h: 'Componente', k: 'nombre', w: 34 }, { h: 'Monto', k: 'monto', w: 14, t: 'clp' }, { h: 'Detalle', k: 'detalle', w: 44, pw: 28 }, { h: 'Falta para calcular', k: 'falta', w: 44, pw: 28 },
      ], filas: p.ahorro_potencial.piezas },
    ],
  };
}

// ---------- Control de costos ----------
export function reporteCostos(db, filtros = {}) {
  const c = controlCostos(db, filtros);
  const gastos = listarGastos(db, filtros);
  return {
    titulo: 'Control de costos de transporte y distribución',
    periodo: c.periodo.etiqueta,
    resumen: [
      ['Despachos completados', c.despachos, 'n0'], ['Distancia total (km)', c.km, 'km'],
      ['Costo total modelado', c.modelado.total, 'clp', true], ['Costo total real (con conductor)', c.total_con_conductor.real, 'clp', true],
      ['$/km modelado', c.costo_km.modelado, 'clp'], ['$/km real', c.costo_km.real, 'clp'],
      ['$/entrega modelado', c.costo_entrega.modelado, 'clp'], ['$/entrega real', c.costo_entrega.real, 'clp'],
    ],
    notas: c.avisos,
    secciones: [
      { nombre: 'Modelado vs real', titulo: 'Lo calculado frente a lo gastado', columnas: [
        { h: 'Concepto', k: 'concepto', w: 40 }, { h: 'Modelado', k: 'modelado', w: 14, t: 'clp' }, { h: 'Real', k: 'real', w: 14, t: 'clp' }, { h: 'Diferencia', k: 'dif', w: 14, t: 'clp' }, { h: 'Diferencia %', k: 'dif_pct', w: 12, t: 'pct' }, { h: 'Nota', k: 'nota', w: 40, pw: 24 },
      ], filas: c.comparacion },
      { nombre: 'Por categoría', titulo: 'Gastos registrados por categoría', vacio: 'No hay gastos de vehículos registrados en el período.', columnas: [
        { h: 'Categoría', k: 'nombre', w: 36 }, { h: 'Registros', k: 'n', w: 10, t: 'n0' }, { h: 'Monto', k: 'monto', w: 14, t: 'clp' },
      ], filas: c.real.por_categoria },
      { nombre: 'Por vehículo', titulo: 'Costo por vehículo', columnas: [
        { h: 'Vehículo', k: 'nombre', w: 22 }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Km', k: 'km', w: 10, t: 'km' }, { h: 'Modelado', k: 'modelado', w: 14, t: 'clp' }, { h: 'Real', k: 'real', w: 14, t: 'clp' },
        { h: '$/km modelado', k: 'costo_km_modelado', w: 13, t: 'clp' }, { h: '$/km real', k: 'costo_km_real', w: 12, t: 'clp' }, { h: 'Combustible real', k: 'combustible_real', w: 14, t: 'clp' }, { h: 'Mantención y desgaste real', k: 'mantencion_y_desgaste_real', w: 16, t: 'clp' },
      ], filas: c.por_vehiculo },
      { nombre: 'Tendencia', titulo: 'Últimos seis meses', columnas: [
        { h: 'Mes', k: 'mes', w: 12 }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Km', k: 'km', w: 10, t: 'km' }, { h: 'Modelado', k: 'modelado', w: 14, t: 'clp' }, { h: 'Real', k: 'real', w: 14, t: 'clp' },
      ], filas: c.serie },
      { nombre: 'Gastos', titulo: 'Detalle de gastos', vacio: 'Sin gastos registrados.', columnas: [
        { h: 'Fecha', k: 'fecha', w: 12 }, { h: 'Vehículo', k: 'vehiculo', w: 18 }, { h: 'Categoría', k: 'categoria_nombre', w: 26 }, { h: 'Monto', k: 'monto', w: 13, t: 'clp' }, { h: 'Odómetro', k: 'km_odometro', w: 11, t: 'n0' }, { h: 'Proveedor', k: 'proveedor', w: 20 }, { h: 'Detalle', k: 'detalle', w: 30, pw: 20 },
      ], filas: gastos },
    ],
  };
}

// ---------- Indicadores KPI del personal ----------
export function reporteKpi(db, filtros = {}) {
  const k = kpisPersonal(db, filtros);
  const p = resolverPeriodo(filtros);
  const t = k.total;
  const fila = (nombre, c) => ({
    nombre, despachos: c.despachos_total ?? c.despachos, medidos: c.despachos, paradas: c.paradas,
    prep: c.preparacion.prom_min, carga: c.carga.prom_min, transito_ratio: c.transito.ratio_pct, entrega: c.entrega.prom_min, ruta: c.ruta.prom_min,
    pph: c.productividad.paradas_por_hora, punt: c.puntualidad.pct, atraso: c.salida.atraso_prom_min, cumpl: c.cumplimiento?.pct ?? null,
  });
  return {
    titulo: 'Indicadores KPI del personal',
    periodo: p.etiqueta,
    resumen: [
      ['Despachos del período', t.despachos_total, 'n0'], ['Con horas registradas', t.despachos, 'n0'],
      ['Preparación de pedidos (promedio)', t.preparacion.prom_min, 'min'], ['Meta de preparación', k.objetivos.preparacion_min, 'min'],
      ['Carga (promedio)', t.carga.prom_min, 'min'], ['Meta de carga', k.objetivos.carga_min, 'min'],
      ['Ruta completa (promedio)', t.ruta.prom_min, 'min'], ['Paradas por hora', t.productividad.paradas_por_hora, 'n1'],
      ['Puntualidad en ventanas', t.puntualidad.pct, 'pct'], ['Cumplimiento de entregas', t.cumplimiento.pct, 'pct', true], ['Meta de cumplimiento', k.objetivos.cumplimiento_pct, 'pct'],
    ],
    notas: ['Los promedios usan solo las horas registradas; lo que no se registró no se estima.'],
    secciones: [
      { nombre: 'Conductores', titulo: 'Despacho y entregas por conductor', vacio: 'Sin despachos en el período.', columnas: [
        { h: 'Conductor', k: 'nombre', w: 24 }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Con horas', k: 'medidos', w: 9, t: 'n0' }, { h: 'Paradas', k: 'paradas', w: 9, t: 'n0' },
        { h: 'Tránsito real / estimado', k: 'transito_ratio', w: 14, t: 'pct' }, { h: 'Entrega en cliente', k: 'entrega', w: 13, t: 'min' }, { h: 'Ruta completa', k: 'ruta', w: 13, t: 'min' },
        { h: 'Paradas por hora', k: 'pph', w: 11, t: 'n1' }, { h: 'Puntualidad', k: 'punt', w: 11, t: 'pct' }, { h: 'Atraso de salida', k: 'atraso', w: 12, t: 'min' }, { h: 'Cumplimiento', k: 'cumpl', w: 12, t: 'pct' },
      ], filas: [...k.conductores.map((c) => fila(c.nombre, c)), fila('Todos', { ...t, despachos_total: t.despachos_total })] },
      { nombre: 'Bodega', titulo: 'Preparación y carga (personal de bodega)', vacio: 'Sin horas de preparación ni de carga registradas.', columnas: [
        { h: 'Responsable', k: 'nombre', w: 24 }, { h: 'Despachos', k: 'despachos_total', w: 10, t: 'n0' }, { h: 'Preparación promedio', k: 'prep', w: 15, t: 'min' }, { h: 'Meta de preparación', k: 'meta_prep', w: 14, t: 'min' },
        { h: 'Carga promedio', k: 'carga', w: 14, t: 'min' }, { h: 'Meta de carga', k: 'meta_carga', w: 13, t: 'min' },
      ], filas: k.bodega.map((b) => ({ nombre: b.nombre, despachos_total: b.despachos_total, prep: b.preparacion.prom_min, meta_prep: b.preparacion.objetivo_min, carga: b.carga.prom_min, meta_carga: b.carga.objetivo_min })) },
      { nombre: 'Motivos de no entrega', titulo: 'Motivos de entregas no realizadas', vacio: 'No hay entregas no realizadas en el período.', columnas: [
        { h: 'Motivo', k: 'motivo', w: 50 }, { h: 'Entregas', k: 'n', w: 10, t: 'n0' },
      ], filas: t.cumplimiento.motivos },
      { nombre: 'Despachos', titulo: 'Detalle por despacho', columnas: [
        { h: 'N°', k: 'trip_id', w: 6, t: 'n0' }, { h: 'Fecha', k: 'fecha', w: 12 }, { h: 'Conductor', k: 'conductor', w: 20 }, { h: 'Bodega', k: 'preparador', w: 18 }, { h: 'Paradas', k: 'n_paradas', w: 8, t: 'n0' },
        { h: 'Horas registradas', k: 'registrados', w: 10, t: 'n0' }, { h: 'Preparación', k: 'preparacion_min', w: 12, t: 'min' }, { h: 'Carga', k: 'carga_min', w: 11, t: 'min' }, { h: 'Ruta real', k: 'ruta_min', w: 12, t: 'min' },
        { h: 'Ruta estimada', k: 'ruta_estimado_min', w: 12, t: 'min' }, { h: 'Entregadas', k: 'entregadas', w: 10, t: 'n0' }, { h: 'Programadas', k: 'programadas', w: 11, t: 'n0' },
      ], filas: k.despachos.map((d) => ({ ...d, conductor: d.conductor ?? '', preparador: d.preparador ?? '' })) },
      { nombre: 'Paradas', titulo: 'Tiempos por parada', vacio: 'Sin paradas con horas.', columnas: [
        { h: 'Despacho', k: 'trip_id', w: 9, t: 'n0' }, { h: 'Fecha', k: 'fecha', w: 12 }, { h: 'Conductor', k: 'conductor', w: 20 }, { h: 'Orden', k: 'orden', w: 7, t: 'n0' }, { h: 'Cliente', k: 'cliente', w: 26 }, { h: 'Comuna', k: 'comuna', w: 16 },
        { h: 'Llegada', k: 'llegada', w: 9 }, { h: 'Fin', k: 'fin', w: 9 }, { h: 'Tránsito real', k: 'transito_real', w: 12, t: 'min' }, { h: 'Tránsito estimado', k: 'transito_estimado', w: 13, t: 'min' },
        { h: 'Entrega real', k: 'entrega_real', w: 12, t: 'min' }, { h: 'Previsto', k: 'entrega_estandar', w: 11, t: 'min' }, { h: '¿A tiempo?', k: 'a_tiempo', w: 10 },
      ], filas: detalleParadas(medirDespachos(db, filtros)) },
    ],
  };
}

// ---------- Vehículos y kilometraje ----------
export function reporteFlota(db, { hoy } = {}) {
  const estado = estadoFlota(db, { hoy, nSemanas: 12 });
  return {
    titulo: 'Vehículos y kilometraje',
    periodo: null,
    resumen: [['Vehículos activos', estado.length, 'n0']],
    notas: ['El kilometraje semanal es el que registra el usuario. Las semanas sin registro quedan en blanco.'],
    secciones: [
      { nombre: 'Estado de la flota', titulo: 'Estado de cada vehículo', columnas: [
        { h: 'Vehículo', k: 'nombre', w: 22 }, { h: 'Patente', k: 'patente', w: 10 }, { h: 'Odómetro (km)', k: 'odometro_km', w: 12, t: 'n0' }, { h: 'Km por semana (últimas 4)', k: 'km_prom_semanal', w: 14, t: 'km' },
        { h: 'Próxima mantención (km)', k: 'proxima_km', w: 14, t: 'n0' }, { h: 'Faltan (km)', k: 'restantes_km', w: 11, t: 'n0' }, { h: 'Estado', k: 'estado_mant', w: 12 },
        { h: 'Neumáticos consumidos', k: 'neumaticos_pct', w: 13, t: 'pct' }, { h: 'Vida útil consumida', k: 'vida_pct', w: 13, t: 'pct' }, { h: '$/km', k: 'costo_km', w: 9, t: 'clp' },
      ], filas: estado.map((e) => ({ nombre: e.nombre, patente: e.patente ?? '', odometro_km: e.odometro_km, km_prom_semanal: e.km_prom_semanal, proxima_km: e.mantencion.proxima_km, restantes_km: e.mantencion.restantes_km, estado_mant: ({ al_dia: 'Al día', proxima: 'Próxima', vencida: 'Vencida', sin_datos: 'Sin datos' })[e.mantencion.estado], neumaticos_pct: e.neumaticos.consumido_pct, vida_pct: e.vida_util?.consumido_pct ?? null, costo_km: e.costo_km })) },
      { nombre: 'Km semanales', titulo: 'Kilometraje por semana', columnas: [
        { h: 'Vehículo', k: 'nombre', w: 22 }, { h: 'Semana desde', k: 'semana_inicio', w: 13 }, { h: 'Km registrados', k: 'km_registrado', w: 13, t: 'km' }, { h: 'Odómetro', k: 'odometro', w: 11, t: 'n0' },
        { h: 'Km de despachos', k: 'km_despachos', w: 13, t: 'km' }, { h: 'Despachos', k: 'despachos', w: 10, t: 'n0' }, { h: 'Costo de operación', k: 'costo_operacion', w: 14, t: 'clp' }, { h: 'Nota', k: 'nota', w: 24 },
      ], filas: estado.flatMap((e) => e.semanas.map((s) => ({ nombre: e.nombre, ...s }))) },
    ],
  };
}

// ---------- Clientes y zonas ----------
export function reporteZonas(db, filtros = {}) {
  const p = resolverPeriodo(filtros);
  const sectores = listarSectores(db);
  const incidentes = db.prepare('SELECT * FROM incidentes ORDER BY fecha DESC, id DESC').all();
  return {
    titulo: 'Clientes, zonas y seguridad',
    periodo: p.etiqueta,
    resumen: [['Sectores con clientes', sectores.filter((s) => s.clientes > 0).length, 'n0'], ['Sectores de alto riesgo', sectores.filter((s) => s.seguridad === 'alto_riesgo').length, 'n0'], ['Incidentes registrados', incidentes.length, 'n0']],
    notas: ['La evaluación de seguridad la ingresa el usuario con su fuente; el sistema no la estima.'],
    secciones: [
      { nombre: 'Concentración por sector', titulo: 'Concentración de entregas por sector', vacio: 'Sin entregas en el período.', columnas: [
        { h: 'Sector', k: 'clave', w: 20 }, { h: 'Entregas', k: 'entregas', w: 9, t: 'n0' }, { h: 'Clientes', k: 'clientes', w: 9, t: 'n0' }, { h: 'Pendientes', k: 'pendientes', w: 10, t: 'n0' }, { h: '% de entregas', k: 'pct_entregas', w: 11, t: 'pct' },
        { h: 'Km', k: 'km', w: 9, t: 'km' }, { h: 'Costo', k: 'costo', w: 13, t: 'clp' }, { h: '$/entrega', k: 'costo_por_entrega', w: 12, t: 'clp' }, { h: 'Seguridad', k: 'seguridad', w: 14 },
      ], filas: concentracionEntregas(db, { desde: p.desde, hasta: p.hasta_excl, por: 'comuna' }).map((g) => ({ ...g, seguridad: nombreSeguridad(g.seguridad) })) },
      { nombre: 'Concentración por zona', titulo: 'Concentración de entregas por zona', vacio: 'Sin zonas definidas con entregas.', columnas: [
        { h: 'Zona', k: 'clave', w: 20 }, { h: 'Comunas', k: 'comunas', w: 30 }, { h: 'Entregas', k: 'entregas', w: 9, t: 'n0' }, { h: '% de entregas', k: 'pct_entregas', w: 11, t: 'pct' }, { h: 'Costo', k: 'costo', w: 13, t: 'clp' }, { h: 'Seguridad', k: 'seguridad', w: 14 },
      ], filas: concentracionEntregas(db, { desde: p.desde, hasta: p.hasta_excl, por: 'zona' }).map((g) => ({ ...g, comunas: g.comunas.join(', '), seguridad: nombreSeguridad(g.seguridad) })) },
      { nombre: 'Seguridad de sectores', titulo: 'Evaluación de seguridad de los sectores', vacio: 'Sin sectores.', columnas: [
        { h: 'Comuna', k: 'comuna', w: 20 }, { h: 'Zona', k: 'zona', w: 14 }, { h: 'Seguridad', k: 'seguridad', w: 15 }, { h: 'Clientes', k: 'clientes', w: 9, t: 'n0' }, { h: 'Incidentes (90 días)', k: 'incidentes_90d', w: 11, t: 'n0' },
        { h: 'Horario recomendado', k: 'horario_recomendado', w: 20 }, { h: 'Observaciones', k: 'observaciones', w: 30 }, { h: 'Fuente', k: 'fuente', w: 20 },
      ], filas: sectores.map((s) => ({ ...s, seguridad: nombreSeguridad(s.seguridad) })) },
      { nombre: 'Incidentes', titulo: 'Incidentes registrados', vacio: 'Sin incidentes.', columnas: [
        { h: 'Fecha', k: 'fecha', w: 12 }, { h: 'Comuna', k: 'comuna', w: 18 }, { h: 'Tipo', k: 'tipo', w: 22 }, { h: 'Descripción', k: 'descripcion', w: 50 },
      ], filas: incidentes.map((i) => ({ ...i, tipo: TIPOS_INCIDENTE.find((t) => t.id === i.tipo)?.nombre ?? i.tipo })) },
    ],
  };
}

// ---------- Hoja de ruta del conductor ----------
export function pdfHojaDeRuta(db, tripId, salida) {
  const info = rutaParaConductor(db, tripId, { max: 9 });
  if (!info) return false;
  const s = getSettings(db);
  const t = db.prepare(`SELECT t.*, v.marca, v.modelo, v.patente, dr.nombre AS conductor, pr.nombre AS preparador
    FROM trips t JOIN vehicles v ON v.id = t.vehicle_id LEFT JOIN drivers dr ON dr.id = t.driver_id LEFT JOIN drivers pr ON pr.id = t.preparador_id WHERE t.id = ?`).get(tripId);
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(salida);
  encabezadoPdf(doc, s, `Hoja de ruta · Despacho N° ${t.id}`, null);
  doc.font('Helvetica-Bold').fontSize(12).fillColor(TINTA).text(`${t.fecha}${t.hora_salida ? ` · salida ${t.hora_salida}` : ''}`, 40, 80);
  doc.font('Helvetica').fontSize(10).fillColor(GRIS)
    .text(`Vehículo: ${t.marca} ${t.modelo}${t.patente ? ` (${t.patente})` : ''}   Conductor: ${t.conductor ?? 'sin asignar'}${t.preparador ? `   Bodega: ${t.preparador}` : ''}`, 40, 98);
  doc.text(`Base de partida: ${[s.deposito_direccion, s.deposito_comuna].filter(Boolean).join(', ')}`, 40, 112);
  doc.fillColor(TINTA);
  // Horas ya registradas se imprimen en su casilla; si no, queda en blanco para anotarla a mano.
  const ev = {};
  for (const e of db.prepare('SELECT stop_id, tipo, momento FROM trip_events WHERE trip_id = ?').all(t.id)) ev[`${e.stop_id ?? 'base'}:${e.tipo}`] = e.momento.slice(11, 16);
  const baseCajas = [['Inicio preparación', ev['base:preparacion_inicio']], ['Fin preparación', ev['base:preparacion_fin']], ['Inicio de carga', ev['base:carga_inicio']], ['Fin de carga', ev['base:carga_fin']], ['Salida de la base', ev['base:salida']], ...(t.retorna_base ? [['Regreso a la base', ev['base:regreso']]] : [])];
  const yb = 134;
  baseCajas.forEach(([etiqueta, valor], i) => {
    const x = 40 + i * 88;
    doc.font('Helvetica').fontSize(7.5).fillColor(GRIS).text(etiqueta, x, yb, { width: 84, lineBreak: false });
    doc.rect(x, yb + 12, 80, 22).lineWidth(0.6).strokeColor('#9AA8A2').stroke();
    if (valor) doc.font('Helvetica-Bold').fontSize(11).fillColor(TINTA).text(valor, x, yb + 18, { width: 80, align: 'center', lineBreak: false });
  });
  doc.y = yb + 46;
  const filas = info.paradas.map((p) => ({
    llegada: ev[`${p.stop_id}:llegada`] ?? '', fin: ev[`${p.stop_id}:fin`] ?? '',
    orden: p.orden, cliente: p.nombre + (p.telefono ? `\nTel. ${p.telefono}` : ''), dir: `${p.direccion ?? ''}${p.comuna ? `, ${p.comuna}` : ''}`,
    productos: p.productos.join(', '), ventana: p.ventana ?? '',
    km: p.km_tramo != null ? nf1.format(p.km_tramo) : '',
  }));
  tablaPdf(doc, [
    { h: 'N°', k: 'orden', w: 4 }, { h: 'Cliente', k: 'cliente', w: 17 }, { h: 'Dirección', k: 'dir', w: 21 }, { h: 'Productos', k: 'productos', w: 15 }, { h: 'Horario', k: 'ventana', w: 8 },
    { h: 'Km', k: 'km', w: 5, a: 'right' }, { h: 'Llegada', k: 'llegada', w: 9, caja: true }, { h: 'Fin', k: 'fin', w: 9, caja: true },
  ], filas, { minAlto: 32 });
  doc.moveDown(0.4);
  doc.font('Helvetica').fontSize(8).fillColor(GRIS).text('Anota la hora de cada casilla (HH:MM). Después se ingresan en Indicadores KPI › Registrar horas.', 40, doc.y, { width: 515 });
  doc.fillColor(TINTA);
  if (info.seguridad.alertas.length) {
    doc.moveDown(0.8);
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.font('Helvetica-Bold').fontSize(11).fillColor(VERDE).text('Precauciones de seguridad', 40);
    doc.moveDown(0.3);
    for (const a of info.seguridad.alertas) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor(TINTA).text(`${a.comuna} — ${nombreSeguridad(a.nivel)}${a.incidentes_90d ? ` · ${a.incidentes_90d} incidente(s) en 90 días` : ''}`, 40);
      const det = [a.horario_recomendado ? `Horario recomendado: ${a.horario_recomendado}.` : '', a.observaciones ?? '', `Paradas: ${a.paradas.join(', ')}.`].filter(Boolean).join(' ');
      doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(det, 40, undefined, { width: 515 });
      doc.moveDown(0.3);
    }
  }
  doc.moveDown(0.8);
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(VERDE).text('Ruta en Google Maps', 40);
  doc.moveDown(0.3);
  for (const e of info.enlaces) {
    doc.font('Helvetica').fontSize(8).fillColor('#1a5fb4').text(`Tramo ${e.tramo} de ${info.enlaces.length}: ${e.url}`, 40, undefined, { width: 515, link: e.url });
    doc.moveDown(0.2);
  }
  doc.moveDown(0.6);
  if (doc.y > doc.page.height - 200) doc.addPage();
  doc.font('Helvetica-Bold').fontSize(11).fillColor(VERDE).text('Costos del despacho', 40);
  doc.moveDown(0.4);
  lineaDato(doc, `Distancia total${t.retorna_base ? ' (con regreso a la base)' : ''}`, `${nf1.format(t.distancia_km ?? 0)} km`);
  lineaDato(doc, 'Tiempo total estimado', dur(t.tiempo_min));
  lineaDato(doc, `Combustible (precio $${nf.format(t.precio_combustible ?? 0)}/L)`, clp(t.costo_combustible));
  lineaDato(doc, 'Desgaste y mantención', clp(t.costo_desgaste));
  lineaDato(doc, 'Otros gastos (conductor, peajes, estacionamientos)', clp(t.costo_otros));
  lineaDato(doc, 'Costo total', clp(t.costo_total), { negrita: true });
  lineaDato(doc, 'Costo por kilómetro', clp(t.distancia_km ? t.costo_total / t.distancia_km : null));
  lineaDato(doc, 'Costo promedio por cliente', clp(t.n_paradas ? t.costo_total / t.n_paradas : null));
  if (t.notas) { doc.moveDown(0.6); doc.font('Helvetica').fontSize(9).fillColor(GRIS).text(`Notas: ${t.notas}`, 40); }
  doc.end();
  return true;
}

export { seguridadDeParadas };
