// Fase 2: inicio de sesión, permisos por rol, usuarios y auditoría del servidor central.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { iniciar, MODO_LOCAL, CLAVE_PRUEBA } from './helpers.js';
import { permitido, permitidoCuerpo, normalizarRuta, hashClave, verificarClave, AJUSTES_SOLO_ADMIN } from '../server/auth.js';

const http = { skip: MODO_LOCAL ? 'solo aplica al servidor HTTP' : false };

// ---------- Reglas (sin servidor) ----------
test('contraseñas: scrypt con sal, nunca en texto plano, y verificación', async () => {
  const h1 = await hashClave('una-clave-larga');
  const h2 = await hashClave('una-clave-larga');
  assert.match(h1, /^scrypt\$32768\$8\$3\$/);
  assert.notEqual(h1, h2); // sal distinta
  assert.ok(!h1.includes('una-clave-larga'));
  assert.equal(await verificarClave('una-clave-larga', h1), true);
  assert.equal(await verificarClave('otra-clave-larga', h1), false);
  assert.equal(await verificarClave('x', 'basura'), false);
});

test('permisos: admin todo; planificador todo menos lo de admin; bodega solo su lista', () => {
  for (const [m, r] of [['GET', '/usuarios'], ['GET', '/respaldo.db'], ['POST', '/respaldo/restaurar'], ['POST', '/settings/probar-google'], ['GET', '/auditoria']]) {
    assert.equal(permitido('admin', m, r), true, `${m} ${r} admin`);
    assert.equal(permitido('planificador', m, r), false, `${m} ${r} planificador`);
    assert.equal(permitido('bodega', m, r), false, `${m} ${r} bodega`);
  }
  for (const [m, r] of [['GET', '/panel'], ['GET', '/control-costos'], ['POST', '/plan'], ['DELETE', '/clientes/3'], ['PUT', '/settings']]) {
    assert.equal(permitido('planificador', m, r), true, `${m} ${r} planificador`);
    assert.equal(permitido('bodega', m, r), false, `${m} ${r} bodega`);
  }
  for (const [m, r] of [['GET', '/despachos'], ['GET', '/despachos/4/tiempos'], ['PUT', '/despachos/4/tiempos'], ['POST', '/despachos/4/estado'],
    ['POST', '/entregas/9/estado'], ['POST', '/vehiculos/2/cargas'], ['PUT', '/km-semanal'], ['GET', '/reportes/despacho/4.pdf'], ['POST', '/cubicaje/calcular']]) {
    assert.equal(permitido('bodega', m, r), true, `${m} ${r} bodega`);
  }
  for (const [m, r] of [['GET', '/gastos'], ['GET', '/kpi/personal'], ['POST', '/despachos'], ['DELETE', '/despachos/4'], ['PUT', '/vehiculos/2'], ['POST', '/despachos/4/gastos'], ['GET', '/despachos/4/otra']]) {
    assert.equal(permitido('bodega', m, r), false, `${m} ${r} bodega`);
  }
  assert.equal(permitido('desconocido', 'GET', '/meta'), false);
});

test('permisos: mayúsculas, barra final, barras dobles o codificación no esquivan las reglas', () => {
  assert.equal(normalizarRuta('/USUARIOS/'), '/usuarios');
  assert.equal(normalizarRuta('//Respaldo.json'), '/respaldo.json');
  assert.equal(normalizarRuta('/usuari%6Fs'), '/usuarios');
  assert.equal(normalizarRuta('/%E0%A4%A'), '/%e0%a4%a'); // codificación inválida: se revisa tal cual, sin fallar
  for (const r of ['/USUARIOS', '/Usuarios/', '/usuarios/3/', '/auditoria/', '/AUDITORIA', '/Respaldo.json', '/respaldo.DB', '/settings/PROBAR-GOOGLE/', '/usuari%6Fs']) {
    assert.equal(permitido('planificador', 'GET', r), false, r);
    assert.equal(permitido('planificador', 'post', r), false, r);
  }
  assert.equal(permitido('bodega', 'get', '/Despachos/'), true);
});

test('permisos: bodega inicia y cierra despachos, pero no los cancela', () => {
  assert.equal(permitidoCuerpo('bodega', 'POST', '/despachos/4/estado', { estado: 'completado' }), true);
  assert.equal(permitidoCuerpo('bodega', 'POST', '/despachos/4/estado', { estado: 'en_ruta' }), true);
  assert.equal(permitidoCuerpo('bodega', 'POST', '/despachos/4/estado', { estado: 'cancelado' }), false);
  assert.equal(permitidoCuerpo('bodega', 'POST', '/Despachos/4/Estado/', { estado: 'cancelado' }), false);
  assert.equal(permitidoCuerpo('bodega', 'POST', '/despachos/4/estado', {}), false);
  assert.equal(permitidoCuerpo('planificador', 'POST', '/despachos/4/estado', { estado: 'cancelado' }), true);
});

// ---------- Servidor ----------
test('sin sesión: solo salud, meta y login; el resto responde 401', http, async () => {
  const s = await iniciar({ sinSesion: true });
  try {
    const c = s.sinSesion;
    assert.equal((await c.call('GET', '/salud')).status, 200);
    const meta = await c.call('GET', '/meta');
    assert.equal(meta.status, 200);
    assert.equal(meta.data.autenticacion, true);
    for (const r of ['/settings', '/clientes', '/panel', '/respaldo.json', '/usuarios', '/auth/yo']) {
      const x = await c.call('GET', r);
      assert.equal(x.status, 401, r);
      assert.equal(x.data.error.code, 'sin_sesion', r);
    }
    assert.equal((await c.call('PUT', '/settings', { costo_hora_conductor: 1 })).status, 401);
  } finally { s.cerrar(); }
});

test('login: cookie segura, mismo mensaje para correo o clave incorrectos, y cierre de sesión', http, async () => {
  const s = await iniciar({ sinSesion: true });
  try {
    const ana = await s.comoRol('planificador', 'Ana@Empresa.cl');
    assert.equal(ana.login.status, 200);
    const cookie = ana.login.headers.get('set-cookie');
    assert.match(cookie, /^bhumi_sesion=[\w-]{40,};/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.ok(!JSON.stringify(ana.login.data).includes('clave_hash'));

    const yo = await ana.call('GET', '/auth/yo');
    assert.equal(yo.data.usuario.email, 'ana@empresa.cl'); // el correo se guarda en minúsculas
    assert.equal(yo.data.usuario.rol, 'planificador');

    const malaClave = await s.entrar('ana@empresa.cl', 'otra-clave-cualquiera');
    const sinCorreo = await s.entrar('nadie@empresa.cl', CLAVE_PRUEBA);
    assert.equal(malaClave.login.status, 401);
    assert.equal(sinCorreo.login.status, 401);
    assert.equal(malaClave.login.data.error.mensaje, sinCorreo.login.data.error.mensaje);

    assert.equal((await ana.call('POST', '/auth/logout')).status, 200);
    assert.equal((await ana.call('GET', '/auth/yo')).status, 401);
  } finally { s.cerrar(); }
});

test('login: 5 fallos bloquean ese correo en esa IP, sin bloquear a los compañeros de la misma oficina', http, async () => {
  const s = await iniciar({ sinSesion: true });
  try {
    await s.comoRol('bodega', 'pedro@empresa.cl');
    await s.comoRol('planificador', 'ana@empresa.cl');
    for (let i = 0; i < 5; i++) assert.equal((await s.entrar('pedro@empresa.cl', 'clave-equivocada-1')).login.status, 401);
    const r = await s.entrar('pedro@empresa.cl', CLAVE_PRUEBA);
    assert.equal(r.login.status, 429);
    assert.equal(r.login.data.error.code, 'demasiados_intentos');
    // Ana sale a internet por la misma IP (todas las pruebas usan 127.0.0.1) y entra sin problema.
    assert.equal((await s.entrar('ana@empresa.cl', CLAVE_PRUEBA)).login.status, 200);
  } finally { s.cerrar(); }
});

test('login: 50 fallos desde una IP (con cualquier correo) bloquean esa IP', http, async () => {
  const s = await iniciar({ sinSesion: true });
  try {
    await s.comoRol('planificador', 'ana@empresa.cl');
    await Promise.all(Array.from({ length: 50 }, (_, i) => s.entrar(`prueba${i}@empresa.cl`, 'clave-equivocada-1')));
    assert.equal((await s.entrar('ana@empresa.cl', CLAVE_PRUEBA)).login.status, 429);
  } finally { s.cerrar(); }
});

test('permisos en el servidor: las variantes de ruta del Planificador también reciben 403', http, async () => {
  const s = await iniciar();
  try {
    const p = await s.comoRol('planificador');
    for (const r of ['/USUARIOS', '/Usuarios/', '/auditoria/', '/AUDITORIA', '/Respaldo.json', '/respaldo.json/', '/usuari%6Fs', '//usuarios']) {
      const x = await p.call('GET', r);
      assert.ok(x.status === 403 || x.status === 404, `${r}: ${x.status}`);
    }
    const crear = await p.call('POST', '/Usuarios', { email: 'intruso@empresa.cl', nombre: 'Intruso', rol: 'admin', clave: CLAVE_PRUEBA });
    assert.equal(crear.status, 403);
    assert.equal(s.db.prepare("SELECT COUNT(*) AS n FROM usuarios WHERE email = 'intruso@empresa.cl'").get().n, 0);
    assert.equal((await p.call('POST', '/Settings/Probar-Google/')).status, 403);

    const antes = (await s.call('GET', '/settings')).data;
    assert.equal((await p.call('PUT', '/SETTINGS', { google_api_key: 'CLAVE_INTRUSA', deposito_direccion: 'Otra 1', costo_hora_conductor: 4700 })).status, 200);
    const despues = (await s.call('GET', '/settings')).data;
    assert.equal(despues.google_api_key, antes.google_api_key);
    assert.equal(despues.deposito_direccion, antes.deposito_direccion);
    assert.equal(despues.costo_hora_conductor, '4700');
  } finally { s.cerrar(); }
});

test('bodega: puede cerrar un despacho pero no cancelarlo', http, async () => {
  const s = await iniciar();
  try {
    const b = await s.comoRol('bodega');
    const cancelar = await b.call('POST', '/despachos/999/estado', { estado: 'cancelado' });
    assert.equal(cancelar.status, 403);
    // Cerrar está permitido: llega al endpoint, que responde que ese despacho no existe.
    assert.equal((await b.call('POST', '/despachos/999/estado', { estado: 'completado' })).status, 404);
  } finally { s.cerrar(); }
});

test('sesión: vence tras 12 h sin uso', http, async () => {
  const s = await iniciar();
  try {
    assert.equal((await s.call('GET', '/auth/yo')).status, 200);
    s.db.prepare('UPDATE sesiones SET ultimo_uso = ultimo_uso - ?').run(12 * 3600_000 + 1000);
    assert.equal((await s.call('GET', '/auth/yo')).status, 401);
    assert.equal(s.db.prepare('SELECT COUNT(*) AS n FROM sesiones').get().n, 0);
  } finally { s.cerrar(); }
});

test('escrituras desde otro sitio (Origin distinto) se rechazan', http, async () => {
  const s = await iniciar();
  try {
    const r = await s.call('PUT', '/settings', { costo_hora_conductor: 1 }, { Origin: 'https://sitio-malicioso.example' });
    assert.equal(r.status, 403);
    assert.equal(r.data.error.code, 'origen');
    const propio = new URL(s.base).origin;
    assert.equal((await s.call('PUT', '/settings', { costo_hora_conductor: 1 }, { Origin: propio })).status, 200);
  } finally { s.cerrar(); }
});

test('bodega: ve despachos y registra lo suyo, pero no costos, planificación ni configuración', http, async () => {
  const s = await iniciar();
  try {
    const b = await s.comoRol('bodega');
    for (const r of ['/despachos', '/entregas', '/vehiculos', '/flota', '/settings', '/setup', '/clientes']) assert.equal((await b.call('GET', r)).status, 200, r);
    for (const r of ['/panel', '/control-costos', '/gastos', '/kpi/personal', '/usuarios', '/respaldo.json']) {
      const x = await b.call('GET', r);
      assert.equal(x.status, 403, r);
      assert.equal(x.data.error.code, 'prohibido', r);
    }
    assert.equal((await b.call('POST', '/vehiculos', { marca: 'X', modelo: 'Y' })).status, 403);
    assert.equal((await b.call('POST', '/plan', {})).status, 403);
    assert.equal((await b.call('PUT', '/settings', { costo_hora_conductor: 1 })).status, 403);
    // Kilometraje semanal: le está permitido (la validación propia del endpoint decide el resto).
    const veh = (await s.call('GET', '/vehiculos')).data[0];
    const km = await b.call('PUT', '/km-semanal', { vehicle_id: veh.id, semana: '2026-11-23', km_inicio: 1000, km_fin: 1250 });
    assert.notEqual(km.status, 403);
  } finally { s.cerrar(); }
});

test('planificador: trabaja en todo menos usuarios, respaldo y los ajustes de Admin (que se ignoran)', http, async () => {
  const s = await iniciar();
  try {
    const p = await s.comoRol('planificador');
    for (const r of ['/panel', '/control-costos', '/kpi/personal', '/gastos']) assert.equal((await p.call('GET', r)).status, 200, r);
    for (const r of ['/usuarios', '/auditoria', '/respaldo.json']) assert.equal((await p.call('GET', r)).status, 403, r);
    assert.equal((await p.call('POST', '/settings/probar-google')).status, 403);

    const antes = (await s.call('GET', '/settings')).data;
    const r = await p.call('PUT', '/settings', { costo_hora_conductor: 5100, google_api_key: 'CLAVE_INTRUSA', deposito_direccion: 'Otra 123', empresa_nombre: 'Otra' });
    assert.equal(r.status, 200);
    const despues = (await s.call('GET', '/settings')).data;
    assert.equal(despues.costo_hora_conductor, '5100');
    for (const k of AJUSTES_SOLO_ADMIN) assert.equal(despues[k], antes[k], k);
  } finally { s.cerrar(); }
});

test('usuarios: Admin crea, valida, cambia rol y desactiva; el desactivado sale de inmediato', http, async () => {
  const s = await iniciar();
  try {
    const nuevo = await s.call('POST', '/usuarios', { email: 'luis@empresa.cl', nombre: 'Luis', rol: 'bodega', clave: CLAVE_PRUEBA });
    assert.equal(nuevo.status, 201);
    assert.ok(!('clave_hash' in nuevo.data.usuario));
    assert.equal((await s.call('POST', '/usuarios', { email: 'LUIS@empresa.cl', nombre: 'Otro', rol: 'bodega', clave: CLAVE_PRUEBA })).status, 409);
    assert.equal((await s.call('POST', '/usuarios', { email: 'x@empresa.cl', nombre: 'X', rol: 'bodega', clave: 'corta' })).data.error.code, 'clave_debil');
    assert.equal((await s.call('POST', '/usuarios', { email: 'no-es-correo', nombre: 'X', rol: 'bodega', clave: CLAVE_PRUEBA })).status, 400);
    assert.equal((await s.call('POST', '/usuarios', { email: 'y@empresa.cl', nombre: 'Y', rol: 'jefe', clave: CLAVE_PRUEBA })).status, 400);

    const luis = await s.entrar('luis@empresa.cl', CLAVE_PRUEBA);
    assert.equal((await luis.call('GET', '/panel')).status, 403);
    const id = nuevo.data.usuario.id;
    // El cambio de rol rige en la siguiente solicitud, sin volver a iniciar sesión.
    assert.equal((await s.call('PUT', `/usuarios/${id}`, { rol: 'planificador' })).status, 200);
    assert.equal((await luis.call('GET', '/panel')).status, 200);

    assert.equal((await s.call('PUT', `/usuarios/${id}`, { activo: false })).status, 200);
    assert.equal((await luis.call('GET', '/auth/yo')).status, 401);
    assert.equal((await s.entrar('luis@empresa.cl', CLAVE_PRUEBA)).login.status, 401);

    const lista = (await s.call('GET', '/usuarios')).data.usuarios;
    assert.ok(lista.every((u) => !('clave_hash' in u)));
    assert.equal(lista.find((u) => u.id === id).activo, false);
  } finally { s.cerrar(); }
});

test('usuarios: siempre queda al menos un administrador activo', http, async () => {
  const s = await iniciar();
  try {
    const yo = (await s.call('GET', '/auth/yo')).data.usuario;
    assert.equal((await s.call('PUT', `/usuarios/${yo.id}`, { rol: 'planificador' })).data.error.code, 'ultimo_admin');
    assert.equal((await s.call('PUT', `/usuarios/${yo.id}`, { activo: false })).data.error.code, 'ultimo_admin');
    await s.call('POST', '/usuarios', { email: 'otra@empresa.cl', nombre: 'Otra', rol: 'admin', clave: CLAVE_PRUEBA });
    assert.equal((await s.call('PUT', `/usuarios/${yo.id}`, { rol: 'planificador' })).status, 200);
  } finally { s.cerrar(); }
});

test('contraseña propia: exige la actual y cierra las demás sesiones, no la actual', http, async () => {
  const s = await iniciar();
  try {
    const otra = await s.entrar('admin@prueba.cl', CLAVE_PRUEBA); // misma persona en otro equipo
    assert.equal((await s.call('PUT', '/auth/clave', { actual: 'no-es-esta-clave', nueva: 'clave-nueva-segura' })).data.error.code, 'clave_actual');
    assert.equal((await s.call('PUT', '/auth/clave', { actual: CLAVE_PRUEBA, nueva: 'corta' })).data.error.code, 'clave_debil');
    assert.equal((await s.call('PUT', '/auth/clave', { actual: CLAVE_PRUEBA, nueva: 'clave-nueva-segura' })).status, 200);
    assert.equal((await s.call('GET', '/auth/yo')).status, 200);
    assert.equal((await otra.call('GET', '/auth/yo')).status, 401);
    assert.equal((await s.entrar('admin@prueba.cl', 'clave-nueva-segura')).login.status, 200);
  } finally { s.cerrar(); }
});

test('auditoría: registra quién escribió qué, los inicios de sesión y los intentos fallidos', http, async () => {
  const s = await iniciar();
  try {
    await s.call('PUT', '/settings', { costo_hora_conductor: 4200 });
    await s.entrar('admin@prueba.cl', 'clave-equivocada-1');
    const b = await s.comoRol('bodega');
    await b.call('GET', '/panel'); // rechazada: no es escritura, no se audita
    const { registros } = (await s.call('GET', '/auditoria')).data;
    const put = registros.find((r) => r.accion === 'PUT' && r.ruta === '/settings');
    assert.equal(put.usuario, 'Prueba admin');
    assert.equal(put.estado, 200);
    assert.ok(registros.some((r) => r.accion === 'login' && r.usuario === 'Prueba bodega'));
    assert.ok(registros.some((r) => r.accion === 'login_fallido' && r.email === 'admin@prueba.cl'));
    assert.ok(!registros.some((r) => r.ruta === '/panel'));
  } finally { s.cerrar(); }
});

test('respaldo JSON: no incluye usuarios, contraseñas ni sesiones', http, async () => {
  const s = await iniciar();
  try {
    const { data } = await s.call('GET', '/respaldo.json');
    const texto = JSON.stringify(data);
    assert.ok(!('usuarios' in data) && !('sesiones' in data) && !('auditoria' in data));
    assert.ok(!texto.includes('scrypt$'));
    assert.ok(!texto.includes('admin@prueba.cl'));
  } finally { s.cerrar(); }
});
