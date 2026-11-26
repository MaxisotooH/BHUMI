// Configuración: datos reales de BHUMI que alimentan todos los cálculos (base, Google, combustible, costos, metas, personal y respaldo).
import { html, pintar, get, post, put, del, toast, falla, modal, confirmar, campo, opcionesComunas, regionDeComuna, nombresRegiones, opciones, clp, fecha, hoy, alHacer, leerForm, descargar, vacio } from '../lib.js';
import { pestanas, activarPestanas } from '../componentes.js';

const TABS = [
  ['base', 'Punto de partida'], ['google', 'Google Maps'], ['combustible', 'Combustible'], ['costos', 'Costos operacionales'],
  ['metas', 'Objetivos y metas'], ['personal', 'Personal'], ['respaldo', 'Respaldo de datos'],
];

export default async function (ctx) {
  const { root, params, navegar } = ctx;
  const tab = TABS.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'base';
  pintar(root, html`${pestanas('configuracion', TABS, tab)}<div id="tab-contenido"></div>`);
  activarPestanas(root, navegar);
  const panel = root.querySelector('#tab-contenido');
  await ({ base, google, combustible, costos, metas, personal, respaldo })[tab](panel, ctx);
}

async function guardarAjustes(ctx, datos, mensaje = 'Configuración guardada') {
  const s = await put('/settings', datos);
  ctx.estado.settings = s;
  await ctx.refrescarEstado();
  toast(mensaje);
  return s;
}

// ---------- Punto de partida ----------
async function base(panel, ctx) {
  const { estado } = ctx;
  const s = estado.settings;
  const meta = estado.meta;
  const tieneCoord = s.deposito_lat !== '' && s.deposito_lng !== '';
  pintar(panel, html`<form class="card card-cuerpo" id="f" style="max-width:860px">
    <h3 class="seccion-form">Empresa</h3>
    <div class="form-grid">${campo('empresa_nombre', 'Nombre de la empresa', s.empresa_nombre)}</div>
    <h3 class="seccion-form">Punto de partida de las rutas</h3>
    <p class="muted">Desde aquí sale cada despacho y a este punto vuelve (si marcas “regresa a la base”). También es el centro de los análisis por zona.</p>
    <div class="form-grid">
      ${campo('deposito_nombre', 'Nombre del punto', s.deposito_nombre)}
      ${campo('deposito_direccion', 'Dirección', s.deposito_direccion, { cls: 'doble' })}
      ${campo('deposito_comuna', 'Comuna', null, { options: opcionesComunas(meta, s.deposito_comuna) })}
      ${campo('deposito_region', 'Región', null, { options: opciones(nombresRegiones(meta), s.deposito_region, { vacio: 'Seleccionar región' }) })}
      ${campo('deposito_lat', 'Latitud', s.deposito_lat, { type: 'number', step: 'any', help: 'Se completa sola al geolocalizar' })}
      ${campo('deposito_lng', 'Longitud', s.deposito_lng, { type: 'number', step: 'any' })}
    </div>
    <div class="fila" style="margin-top:16px">
      <button class="btn btn-primario" type="submit">Guardar</button>
      <button class="btn" type="button" id="geo">Geolocalizar la dirección con Google</button>
      <span class="muted">${tieneCoord ? 'Coordenadas guardadas.' : 'Sin coordenadas: se obtienen con Google al guardar o al planificar la primera ruta.'}</span>
    </div></form>`);
  const f = panel.querySelector('#f');
  f.elements.deposito_comuna.addEventListener('change', () => {
    const r = regionDeComuna(meta, f.elements.deposito_comuna.value);
    if (r) f.elements.deposito_region.value = r;
  });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await guardarAjustes(ctx, leerForm(f));
      if (ctx.estado.settings.google_api_key && ctx.estado.settings.deposito_lat === '') {
        try { await post('/settings/geolocalizar-deposito'); await ctx.refrescarEstado(); toast('Punto de partida geolocalizado con Google.'); } catch (er) { toast(er.message, 'aviso'); }
      }
      base(panel, ctx);
    } catch (er) { falla(er); }
  });
  panel.querySelector('#geo').addEventListener('click', async () => {
    try {
      await guardarAjustes(ctx, { ...leerForm(f), deposito_lat: '', deposito_lng: '' }, 'Dirección guardada');
      const r = await post('/settings/geolocalizar-deposito');
      await ctx.refrescarEstado();
      toast(`Ubicación encontrada: ${r.direccion}`);
      base(panel, ctx);
    } catch (er) { falla(er); }
  });
}

// ---------- Google Maps ----------
async function google(panel, ctx) {
  const s = ctx.estado.settings;
  pintar(panel, html`<div class="grid g-main" style="align-items:start">
    <form class="card card-cuerpo" id="f">
      <h3 class="seccion-form">Conexión con Google Maps Platform</h3>
      <p class="muted" style="margin-top:0">Todo el mapa, las distancias, los tiempos y la ubicación de los clientes salen de Google. Sin la clave, esos datos quedan en blanco: el sistema no los inventa.</p>
      ${campo('google_api_key', 'API key', s.google_api_key, { type: 'password', help: 'Se guarda solo en este navegador, dentro de los datos de BHUMI. El respaldo JSON no la incluye; el respaldo .db sí.', extra: 'autocomplete="off"' })}
      <div style="height:12px"></div>
      ${campo('google_map_id', 'ID de mapa (opcional)', s.google_map_id, { help: 'Si creaste un estilo de mapa en Google Cloud, pega aquí su ID. Si lo dejas vacío se usa el mapa estándar.' })}
      <div style="height:12px"></div>
      ${campo('usar_trafico', 'Considerar el tráfico en tiempos y rutas', s.usar_trafico === '1', { type: 'checkbox' })}
      <div class="fila" style="margin-top:16px"><button class="btn btn-primario" type="submit">Guardar</button><button class="btn" type="button" id="probar">Probar conexión</button></div>
      <div id="resultado-prueba" style="margin-top:14px"></div>
    </form>
    <div class="card card-cuerpo"><h3 class="seccion-form">Cómo obtener la API key</h3>
      <ol style="padding-left:20px;margin:0">
        <li>Entra a <b>console.cloud.google.com</b> y crea un proyecto.</li>
        <li>Activa la facturación del proyecto (Google entrega un crédito mensual; revisa los precios vigentes).</li>
        <li>En “APIs y servicios” habilita: <b>Maps JavaScript API</b>, <b>Geocoding API</b> y <b>Routes API</b>.</li>
        <li>En “Credenciales” crea una clave de API. En <b>Restricciones de la aplicación</b> déjala en <b>Ninguna</b> y en <b>Restricciones de API</b> limítala a esas tres APIs.</li>
        <li>En Facturación crea un presupuesto con alerta de gasto, para enterarte si el consumo sube.</li>
        <li>Pégala aquí y presiona “Probar conexión”.</li>
      </ol>
      <p class="muted" style="margin-top:12px">BHUMI guarda en caché las distancias entre clientes para consultar a Google lo menos posible.</p>
      <p class="muted">Por qué sin restricción de sitio web: BHUMI se abre desde un archivo de tu computador, no desde una dirección de internet, y Google no puede verificar el sitio de origen. Por eso la protección de la clave son las tres APIs permitidas y el presupuesto con alerta.</p>
    </div></div>`);
  const f = panel.querySelector('#f');
  const datos = () => { const d = leerForm(f); return { ...d, usar_trafico: d.usar_trafico ? '1' : '0' }; };
  f.addEventListener('submit', async (e) => { e.preventDefault(); try { await guardarAjustes(ctx, datos()); } catch (er) { falla(er); } });
  panel.querySelector('#probar').addEventListener('click', async (e) => {
    const out = panel.querySelector('#resultado-prueba');
    e.target.disabled = true;
    pintar(out, html`<span class="spinner"></span> Consultando a Google…`);
    try {
      await guardarAjustes(ctx, datos(), 'API key guardada');
      const r = await post('/settings/probar-google');
      const fila = (n, x, ok) => html`<li style="display:flex;gap:10px;margin:6px 0"><span class="marca-estado ${x.ok ? 'ok' : 'falta'}" style="width:22px;height:22px;border-radius:50%;display:grid;place-items:center;font-weight:700;flex:none;${x.ok ? 'background:#1F7A4D;color:#fff' : 'background:#F2A900;color:#2b1d00'}">${x.ok ? '✓' : '!'}</span><div><b>${n}</b><div class="muted" style="font-size:13px">${x.ok ? ok : x.error}</div></div></li>`;
      pintar(out, html`<ul style="list-style:none;padding:0;margin:0">${fila('Geocoding API', r.geocoding, `Encontró: ${r.geocoding.direccion}`)}${fila('Routes API', r.routes, 'Calculó una ruta de prueba correctamente.')}</ul>
        <p class="muted" style="font-size:13px">El mapa en pantalla usa Maps JavaScript API: se verifica al abrir “Clientes y zonas”.</p>`);
    } catch (er) { pintar(out, html`<div class="aviso rojo"><p>${er.message}</p></div>`); } finally { e.target.disabled = false; }
  });
}

// ---------- Combustible ----------
async function combustible(panel, ctx) {
  const meta = ctx.estado.meta;
  const { vigentes, historial } = await get('/combustible/precios');
  pintar(panel, html`<div class="grid g2" style="align-items:start">
    <div class="card"><div class="card-cab"><h2>Precio vigente por litro</h2></div>
      <div class="tabla-wrap"><table><thead><tr><th>Combustible</th><th class="der">Precio por litro</th><th>Vigente desde</th></tr></thead><tbody>
      ${vigentes.map((v) => html`<tr><td>${v.combustible}</td><td class="der">${v.precio != null ? clp(v.precio) : html`<span class="tenue">Sin precio</span>`}</td><td>${v.vigente_desde ? fecha(v.vigente_desde) : '—'}</td></tr>`)}</tbody></table></div></div>
    <form class="card card-cuerpo" id="f"><h3 class="seccion-form">Actualizar precio</h3>
      <div class="form-grid">
        ${campo('combustible', 'Combustible', null, { options: opciones(meta.combustibles, 'Bencina') })}
        ${campo('precio', 'Precio por litro', '', { type: 'number', prefix: '$', required: true, step: '1', min: 1 })}
        ${campo('vigente_desde', 'Vigente desde', hoy(), { type: 'date' })}
        ${campo('nota', 'Nota (opcional)', '', { placeholder: 'Ej.: estación Copec Av. Matta' })}
      </div>
      <p class="muted" style="margin-top:10px">Cada despacho y cada gasto guardan el precio vigente en su fecha, así el historial no cambia cuando actualizas el valor.</p>
      <button class="btn btn-primario" type="submit" style="margin-top:6px">Guardar precio</button></form></div>
    <div class="card" style="margin-top:16px"><div class="card-cab"><h2>Historial de precios</h2></div>
      ${historial.length ? html`<div class="tabla-wrap"><table class="tabla-compacta"><thead><tr><th>Desde</th><th>Combustible</th><th class="der">Precio</th><th>Nota</th><th></th></tr></thead><tbody>
      ${historial.map((h) => html`<tr><td>${fecha(h.vigente_desde)}</td><td>${h.combustible}</td><td class="der">${clp(h.precio)}</td><td>${h.nota ?? ''}</td><td class="der"><button class="btn btn-texto btn-chico" data-del="${h.id}">Quitar</button></td></tr>`)}</tbody></table></div>` : html`<div class="vacio"><p>Aún no hay precios registrados.</p></div>`}</div>`);
  panel.querySelector('#f').addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await post('/combustible/precios', leerForm(e.target)); await ctx.refrescarEstado(); toast('Precio guardado'); combustible(panel, ctx); } catch (er) { falla(er); }
  });
  alHacer(panel, 'click', '[data-del]', async (e, b) => { try { await del(`/combustible/precios/${b.dataset.del}`); await ctx.refrescarEstado(); combustible(panel, ctx); } catch (er) { falla(er); } });
}

// ---------- Costos operacionales ----------
async function costos(panel, ctx) {
  const s = ctx.estado.settings;
  pintar(panel, html`<form class="card card-cuerpo" id="f" style="max-width:860px">
    <h3 class="seccion-form">Conductor y tiempos de servicio</h3>
    <div class="form-grid">
      ${campo('costo_hora_conductor', 'Costo por hora del conductor', s.costo_hora_conductor, { type: 'number', prefix: '$', step: '1', help: 'Sueldo + leyes sociales dividido en horas trabajadas. Si un conductor tiene su propio valor, se usa ese.' })}
      ${campo('tiempo_servicio_min', 'Tiempo por cliente (descarga y entrega)', s.tiempo_servicio_min, { type: 'number', unit: 'min', step: '1', help: 'Es el estándar contra el que se mide la entrega real en cada cliente.' })}
      ${campo('jornada_horas', 'Jornada normal por despacho', s.jornada_horas, { type: 'number', unit: 'horas', step: '0.5', help: 'Sobre este tiempo se cobran horas adicionales. Déjalo vacío si no aplica.' })}
      ${campo('recargo_horas_extra_pct', 'Recargo por horas adicionales', s.recargo_horas_extra_pct, { type: 'number', unit: '%', step: '1' })}
    </div>
    <p class="muted" style="margin-top:12px">El desgaste por kilómetro (neumáticos, frenos, aceite, mantención, depreciación) se configura en cada vehículo. Peajes, estacionamientos y otros gastos se registran en Control de costos.</p>
    <button class="btn btn-primario" type="submit">Guardar</button></form>`);
  panel.querySelector('#f').addEventListener('submit', async (e) => { e.preventDefault(); try { await guardarAjustes(ctx, leerForm(e.target)); } catch (er) { falla(er); } });
}

// ---------- Objetivos y metas ----------
async function metas(panel, ctx) {
  const s = ctx.estado.settings;
  pintar(panel, html`<form class="card card-cuerpo" id="f" style="max-width:860px">
    <p class="muted" style="margin-top:0">Los indicadores se comparan contra estos objetivos. Si dejas uno vacío, ese indicador se muestra sin comparación: el sistema no inventa metas.</p>
    <h3 class="seccion-form">Indicadores del equipo</h3>
    <div class="form-grid">
      ${campo('meta_preparacion_min', 'Tiempo objetivo de preparación de un pedido', s.meta_preparacion_min, { type: 'number', unit: 'min', step: '1', help: 'Desde que se empieza a preparar hasta que queda listo.' })}
      ${campo('meta_carga_min', 'Tiempo objetivo de carga del vehículo', s.meta_carga_min, { type: 'number', unit: 'min', step: '1' })}
      ${campo('meta_cumplimiento_pct', 'Cumplimiento esperado de entregas', s.meta_cumplimiento_pct, { type: 'number', unit: '%', step: '1', min: 0, max: 100, help: 'Entregas realizadas sobre las programadas.' })}
    </div>
    <h3 class="seccion-form">Flota y carga</h3>
    <div class="form-grid">
      ${campo('meta_utilizacion_pct', 'Utilización esperada de la capacidad de carga', s.meta_utilizacion_pct, { type: 'number', unit: '%', step: '1', min: 0, max: 100, help: 'Qué tan lleno debería ir cada vehículo, en peso y espacio.' })}
      ${campo('alerta_mantencion_pct', 'Avisar la mantención con anticipación de', s.alerta_mantencion_pct, { type: 'number', unit: '% del intervalo', step: '1', min: 0, max: 100, help: 'Con 10% y un intervalo de 10.000 km, avisa al faltar 1.000 km.' })}
      ${campo('radio_cercania_km', 'Entregas cercanas si están a menos de', s.radio_cercania_km, { type: 'number', unit: 'km', step: '0.5', help: 'Se usa para sugerir qué despachos juntar.' })}
      ${campo('umbral_consumo_pct', 'Consumo elevado si rinde menos que lo configurado en', s.umbral_consumo_pct, { type: 'number', unit: '%', step: '1' })}
    </div>
    <h3 class="seccion-form">Optimización de rutas</h3>
    <p class="muted" style="margin-top:0">La ruta optimizada equilibra tres factores. Un peso mayor hace que ese factor importe más.</p>
    <div class="form-grid">
      ${campo('peso_distancia', 'Peso de la distancia', s.peso_distancia, { type: 'number', step: '0.1', min: 0 })}
      ${campo('peso_tiempo', 'Peso del tiempo', s.peso_tiempo, { type: 'number', step: '0.1', min: 0 })}
      ${campo('peso_costo', 'Peso del costo', s.peso_costo, { type: 'number', step: '0.1', min: 0 })}
      ${campo('cache_horas', 'Reusar tiempos con tráfico durante', s.cache_horas, { type: 'number', unit: 'horas', step: '1', help: 'Las distancias sin tráfico se reutilizan por 30 días.' })}
    </div>
    <button class="btn btn-primario" type="submit" style="margin-top:16px">Guardar</button></form>`);
  panel.querySelector('#f').addEventListener('submit', async (e) => { e.preventDefault(); try { await guardarAjustes(ctx, leerForm(e.target)); } catch (er) { falla(er); } });
}

// ---------- Personal ----------
async function personal(panel, ctx) {
  const roles = ctx.estado.meta.roles;
  const nombreRol = (id) => roles.find((r) => r.id === id)?.nombre ?? id;
  const filas = await get('/personal');
  const recargar = () => personal(panel, ctx).catch(falla);
  pintar(panel, html`<div class="card"><div class="card-cab"><h2>Conductores y personal de bodega</h2><div class="acciones"><button class="btn btn-primario" id="nuevo">Agregar persona</button></div></div>
    <p class="muted" style="margin:0;padding:0 16px 12px">Cada persona queda asociada a sus despachos. Con eso se calculan sus indicadores: tiempos de preparación, carga, despacho y cumplimiento de entregas.</p>
    ${filas.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Nombre</th><th>Función</th><th>Teléfono</th><th class="der">Costo por hora</th><th></th></tr></thead><tbody>
      ${filas.map((f) => html`<tr><td><b>${f.nombre}</b></td><td>${nombreRol(f.rol)}</td><td>${f.telefono ?? ''}</td><td class="der">${f.rol !== 'conductor' ? html`<span class="tenue">—</span>` : f.costo_hora != null ? clp(f.costo_hora) : html`<span class="tenue">Usa el general</span>`}</td>
        <td class="der"><button class="btn btn-texto btn-chico" data-edit="${f.id}">Editar</button><button class="btn btn-texto btn-chico" data-quitar="${f.id}">Quitar</button></td></tr>`)}</tbody></table></div>`
      : vacio('Aún no hay personal', 'Agrega a los conductores y al personal de bodega para asignarlos a cada despacho y medir sus indicadores.')}</div>`);
  const abrir = (f) => modal({
    titulo: f ? `Editar ${f.nombre}` : 'Agregar persona', ancho: 520,
    cuerpo: html`<form class="form-grid">${campo('nombre', 'Nombre', f?.nombre, { required: true, cls: 'ancho' })}${campo('rol', 'Función', null, { options: opciones(roles, f?.rol ?? 'conductor', { valor: (r) => r.id, texto: (r) => r.nombre }) })}${campo('telefono', 'Teléfono', f?.telefono, { type: 'tel' })}${campo('costo_hora', 'Costo por hora (solo conductores)', f?.costo_hora, { type: 'number', prefix: '$', step: '1', help: 'Si lo dejas vacío se usa el costo general del conductor.' })}</form>`,
    acciones: [{ texto: 'Cancelar', cerrar: true }, { texto: 'Guardar', clase: 'btn-primario', accion: async (m) => {
      const d = m.datos();
      if (!d.nombre?.trim()) throw new Error('Ingresa el nombre.');
      f ? await put(`/personal/${f.id}`, d) : await post('/personal', d);
      m.cerrar(); toast('Guardado'); await ctx.refrescarEstado(); recargar();
    } }],
  });
  panel.querySelector('#nuevo').addEventListener('click', () => abrir(null));
  alHacer(panel, 'click', '[data-edit]', (e, b) => abrir(filas.find((x) => x.id === Number(b.dataset.edit))));
  alHacer(panel, 'click', '[data-quitar]', async (e, b) => {
    if (!(await confirmar({ titulo: 'Quitar persona', mensaje: 'Se quitará de las listas. Los despachos anteriores conservan sus datos.', textoOk: 'Quitar', peligro: true }))) return;
    try { await del(`/personal/${b.dataset.quitar}`); recargar(); } catch (er) { falla(er); }
  });
}

// ---------- Respaldo ----------
async function respaldo(panel) {
  const almacen = window.BHUMI_ALMACEN;
  const ultimo = almacen ? await almacen.ultimoRespaldo() : null;
  const dias = ultimo ? Math.floor((Date.now() - new Date(ultimo)) / 86400000) : null;
  const txtUltimo = !almacen ? '' : ultimo ? `Último respaldo descargado: ${fecha(ultimo)}${dias === 0 ? ' (hoy)' : dias === 1 ? ' (ayer)' : ` (hace ${dias} días)`}.` : 'Aún no has descargado ningún respaldo.';
  pintar(panel, html`<div class="grid g2" style="max-width:980px;align-items:start"><div class="card card-cuerpo"><h3 class="seccion-form">Respaldo</h3>
    <p>Tus datos se guardan <b>en este navegador</b>, en este computador. Si borras los datos de navegación o cambias de computador, se pierden. Descarga un respaldo cada semana y guárdalo en OneDrive o en un pendrive.</p>
    ${txtUltimo ? html`<p><b>${txtUltimo}</b></p>` : ''}
    <div class="fila"><button class="btn btn-primario" data-d="/api/respaldo.db">Respaldo completo (.db)</button><button class="btn" data-d="/api/respaldo.json">Datos en JSON</button></div>
    <p class="muted" style="margin-top:10px">El respaldo .db incluye todo, también la API key de Google: guárdalo en un lugar privado. El JSON no incluye la API key.</p></div>
    <div class="card card-cuerpo"><h3 class="seccion-form">Restaurar o traer datos</h3>
    <p>Sirve para recuperar un respaldo o pasar tus datos a otro computador.</p>
    <div class="fila"><button class="btn" type="button" id="restaurar">Elegir archivo de respaldo…</button><input type="file" id="archivo-respaldo" accept=".db,.json,application/json" hidden></div>
    <p class="muted" style="margin-top:10px">Reemplaza todos los datos que hay ahora. Si dudas, descarga un respaldo antes.</p></div>
    <div class="card card-cuerpo"><h3 class="seccion-form">Importar clientes</h3>
    <p>Descarga la plantilla en Excel, complétala con tus clientes y cárgala en <a href="#/clientes?tab=lista">Clientes y zonas</a>. Los reportes de cada pantalla se bajan con sus botones Excel y PDF.</p>
    <div class="fila"><button class="btn" data-d="/api/clientes/plantilla.xlsx">Plantilla Excel para importar clientes</button></div></div></div>`);
  alHacer(panel, 'click', '[data-d]', (e, b) => descargar(b.dataset.d).then(() => { if (almacen) setTimeout(() => respaldo(panel), 400); }).catch(falla));
  const archivo = panel.querySelector('#archivo-respaldo');
  panel.querySelector('#restaurar').addEventListener('click', () => archivo.click());
  archivo.addEventListener('change', async () => {
    const f = archivo.files[0];
    if (!f) return;
    try {
      const ok = await confirmar({ titulo: 'Restaurar respaldo', mensaje: `Se van a reemplazar todos los datos actuales por los del archivo “${f.name}”. Esto no se puede deshacer.`, textoOk: 'Restaurar', peligro: true });
      if (!ok) return;
      const res = await fetch('/api/respaldo/restaurar', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await f.arrayBuffer() });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.mensaje ?? 'No se pudo restaurar el respaldo.');
      toast('Respaldo restaurado. Recargando…');
      setTimeout(() => location.reload(), 900);
    } catch (er) { falla(er); } finally { archivo.value = ''; }
  });
}
