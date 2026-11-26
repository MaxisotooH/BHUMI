// Sesión del servidor central: pantalla de inicio de sesión, menú del usuario y cambio de contraseña.
// En la versión de doble clic no hay sesión (estado.usuario queda en null) y nada de esto se muestra.
import { html, pintar, post, put, toast, falla, modal, campo } from './lib.js';

export const NOMBRE_ROL = { admin: 'Administrador', planificador: 'Planificador', bodega: 'Operador de bodega' };

/** Secciones del menú que ve cada rol (las que no aparecen aquí las ven todos). */
const SECCIONES_ROL = {
  panel: ['admin', 'planificador'],
  costos: ['admin', 'planificador'],
  kpi: ['admin', 'planificador'],
  configuracion: ['admin', 'planificador'],
};
/** ¿Puede el usuario abrir esta sección? Sin usuario (versión de doble clic) se ve todo. */
export const veSeccion = (usuario, id) => !usuario || !SECCIONES_ROL[id] || SECCIONES_ROL[id].includes(usuario.rol);
/** Sección con la que parte cada rol. Bodega parte en "Hoy": los despachos del día, pensado para el celular. */
export const seccionInicial = (usuario) => (usuario?.rol === 'bodega' ? 'hoy' : 'panel');

// ---------- Botones según el rol ----------
// El servidor envía sus reglas (GET /auth/yo → permisos). Con ellas se ocultan los botones que el rol no puede
// usar; cada botón declara lo que necesita con data-requiere="MÉTODO /ruta" (":id" vale por cualquier número).
// Es solo para no mostrar botones inútiles: el servidor revisa cada acción igual.
let puedeFn = () => true;

const normalizar = (r) => String(r).toLowerCase().replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/';

/** ¿Puede el usuario actual hacer `metodo` sobre `ruta`? Sin reglas (versión de doble clic), sí. */
export const puede = (metodo, ruta) => puedeFn(String(metodo).toUpperCase(), normalizar(String(ruta).replace(/:id/g, '1')));

function aplicarPermisos(raiz) {
  for (const el of raiz.querySelectorAll?.('[data-requiere]') ?? []) {
    const [m, r] = el.dataset.requiere.split(' ');
    el.classList.toggle('sin-permiso', !puede(m, r));
  }
}

/** Activa las reglas del rol y oculta, ahora y en todo lo que se pinte después, los botones sin permiso. */
export function activarPermisos(permisos) {
  if (!permisos || permisos.todo) return;
  const soloAdmin = permisos.solo_admin.map((s) => new RegExp(s));
  const lee = permisos.lista?.lee.map((s) => new RegExp(s));
  const escribe = permisos.lista?.escribe.map(([m, s]) => [m, new RegExp(s)]);
  puedeFn = (m, r) => {
    if (soloAdmin.some((re) => re.test(r))) return false;
    if (!permisos.lista) return true; // planificador: todo menos lo de Admin
    if (m === 'GET' || m === 'HEAD') return lee.some((re) => re.test(r));
    return escribe.some(([mm, re]) => mm === m && re.test(r));
  };
  document.body.classList.add(`rol-${permisos.rol}`);
  aplicarPermisos(document.body);
  new MutationObserver((cambios) => {
    for (const c of cambios) for (const n of c.addedNodes) if (n.nodeType === 1) { aplicarPermisos(n); if (n.matches?.('[data-requiere]')) aplicarPermisos(n.parentNode); }
  }).observe(document.body, { childList: true, subtree: true });
}

/** Reemplaza la aplicación por la pantalla de inicio de sesión. Al entrar, recarga la página con la sesión nueva. */
export function mostrarLogin(mensaje = '') {
  document.querySelector('.app')?.setAttribute('hidden', '');
  document.getElementById('modales').innerHTML = '';
  let caja = document.getElementById('login');
  if (!caja) {
    caja = document.createElement('div');
    caja.id = 'login';
    caja.className = 'login-pantalla';
    document.body.prepend(caja);
  }
  pintar(caja, html`<form class="login-card card" id="f-login" novalidate>
    <div class="login-marca">
      <svg viewBox="0 0 40 40" width="44" height="44" aria-hidden="true"><rect width="40" height="40" rx="8" fill="#0E4D3C"/><path d="M11 29V11h8.5a4.5 4.5 0 0 1 0 9H11m8.5 0a4.5 4.5 0 0 1 0 9H11" fill="none" stroke="#fff" stroke-width="3.2"/></svg>
      <div><h1>BHUMI</h1><p>Logística y distribución</p></div>
    </div>
    <h2>Iniciar sesión</h2>
    ${mensaje ? html`<div class="aviso ambar"><p>${mensaje}</p></div>` : ''}
    ${campo('email', 'Correo', '', { type: 'email', required: true, extra: 'autocomplete="username" autofocus' })}
    ${campo('clave', 'Contraseña', '', { type: 'password', required: true, extra: 'autocomplete="current-password"' })}
    <div id="login-error" role="alert"></div>
    <button class="btn btn-primario login-boton" type="submit">Entrar</button>
    <p class="muted login-ayuda">¿Olvidaste tu contraseña? Pídele a un administrador que te asigne una nueva.</p>
  </form>`);
  const f = caja.querySelector('#f-login');
  f.querySelector('input[name=email]').focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const boton = f.querySelector('button[type=submit]');
    const err = f.querySelector('#login-error');
    err.innerHTML = '';
    boton.disabled = true;
    try {
      await post('/auth/login', { email: f.email.value, clave: f.clave.value });
      location.reload();
    } catch (er) {
      pintar(err, html`<div class="aviso rojo"><p>${er.message}</p></div>`);
      f.clave.value = '';
      f.clave.focus();
      boton.disabled = false;
    }
  });
}

/** Ficha del usuario en la barra superior; al hacer clic abre su menú. El punto verde indica conexión en vivo. */
export function fichaUsuario(usuario, enVivo = false) {
  const estadoTxt = enVivo ? 'Conectado en vivo: verás al instante los cambios de los demás.' : 'Reconectando: los cambios de los demás aparecerán al volver la conexión.';
  return html`<button type="button" class="dato-chip ficha-usuario ${enVivo ? 'en-vivo' : ''}" data-menu-usuario title="${usuario.email} · ${estadoTxt}">
    <span class="avatar" aria-hidden="true">${(usuario.nombre.trim()[0] ?? '?').toUpperCase()}</span>
    <span>${usuario.nombre.split(' ')[0]} <b>${NOMBRE_ROL[usuario.rol] ?? usuario.rol}</b></span></button>`;
}

export function abrirMenuUsuario(usuario) {
  const m = modal({
    titulo: usuario.nombre,
    ancho: 440,
    cuerpo: html`<p class="muted" style="margin-top:0">${usuario.email} · ${NOMBRE_ROL[usuario.rol] ?? usuario.rol}</p>
      <div class="fila"><button class="btn" type="button" data-clave>Cambiar contraseña</button>
      <button class="btn btn-peligro" type="button" data-salir>Cerrar sesión</button></div>`,
  });
  m.cuerpo.querySelector('[data-salir]').addEventListener('click', cerrarSesion);
  m.cuerpo.querySelector('[data-clave]').addEventListener('click', () => { m.cerrar(); cambiarClave(); });
}

export async function cerrarSesion() {
  try { await post('/auth/logout'); } catch { /* igual se muestra el inicio de sesión */ }
  location.hash = '';
  location.reload();
}

function cambiarClave() {
  modal({
    titulo: 'Cambiar contraseña',
    ancho: 460,
    cuerpo: html`<form>${campo('actual', 'Contraseña actual', '', { type: 'password', required: true, extra: 'autocomplete="current-password"' })}
      ${campo('nueva', 'Contraseña nueva', '', { type: 'password', required: true, help: 'Al menos 10 caracteres. Se cerrarán tus otras sesiones abiertas.', extra: 'autocomplete="new-password"' })}
      ${campo('repetir', 'Repite la contraseña nueva', '', { type: 'password', required: true, extra: 'autocomplete="new-password"' })}</form>`,
    acciones: [
      { texto: 'Cancelar', cerrar: true },
      {
        texto: 'Guardar', clase: 'btn-primario',
        accion: async (m) => {
          const d = m.datos();
          if (d.nueva !== d.repetir) return falla(new Error('Las contraseñas nuevas no coinciden.'));
          await put('/auth/clave', { actual: d.actual, nueva: d.nueva });
          m.cerrar();
          toast('Contraseña actualizada');
        },
      },
    ],
  });
}

