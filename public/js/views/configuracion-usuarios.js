// Configuración → Usuarios (solo Admin, servidor central): quién entra a BHUMI, con qué rol, y la actividad reciente.
import { html, pintar, get, post, put, toast, modal, campo, opciones, alHacer, falla } from '../lib.js';
import { NOMBRE_ROL } from '../sesion.js';

/** Fecha y hora local a partir de un CURRENT_TIMESTAMP de SQLite (UTC, "AAAA-MM-DD HH:MM:SS"). */
const cuando = (ts) => (ts ? new Date(`${ts.replace(' ', 'T')}Z`).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short' }) : '—');

const ACCIONES = {
  login: 'Inició sesión', login_fallido: 'Intento fallido de inicio de sesión', login_bloqueado: 'Inicio de sesión bloqueado por intentos',
  clave_restablecida: 'Contraseña restablecida', usuario_creado: 'Usuario creado', POST: 'Creó o ejecutó', PUT: 'Modificó', DELETE: 'Eliminó',
};

export async function pintarUsuarios(panel, ctx) {
  const [{ usuarios, roles, clave_min: claveMin }, { registros }] = await Promise.all([get('/usuarios'), get('/auditoria?limite=60')]);
  const yo = ctx.estado.usuario;
  pintar(panel, html`<div class="grid g-main" style="align-items:start">
    <div class="card">
      <div class="card-cab"><h2>Usuarios</h2><button class="btn btn-primario btn-chico" type="button" data-nuevo>Nuevo usuario</button></div>
      <div class="tabla-wrap"><table><thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
      ${usuarios.map((u) => html`<tr class="${u.activo ? '' : 'tenue'}">
        <td><b>${u.nombre}</b>${u.id === yo.id ? html` <span class="insignia info">Tú</span>` : ''}</td>
        <td>${u.email}</td><td>${NOMBRE_ROL[u.rol] ?? u.rol}</td>
        <td>${u.activo ? html`<span class="insignia ok">Activo</span>` : html`<span class="insignia">Desactivado</span>`}</td>
        <td>${cuando(u.ultimo_acceso)}</td>
        <td class="der"><button class="btn btn-chico" type="button" data-editar="${u.id}">Editar</button></td></tr>`)}
      </tbody></table></div>
    </div>
    <div class="card card-cuerpo"><h3 class="seccion-form">Qué puede hacer cada rol</h3>
      <ul style="padding-left:20px;margin:0">${roles.map((r) => html`<li style="margin-bottom:8px"><b>${r.nombre}:</b> ${r.detalle}</li>`)}</ul>
      <p class="muted" style="margin-top:12px">Los permisos se revisan en el servidor en cada acción, no solo ocultando el menú. Un usuario desactivado sale de inmediato de todas sus sesiones.</p>
      <p class="muted">Si el último administrador olvida su contraseña, se restablece desde el servidor con <code>npm run crear-admin -- --email … --restablecer</code>.</p>
    </div>
  </div>
  <div class="card" style="margin-top:16px">
    <div class="card-cab"><h2>Actividad reciente</h2><span class="muted">Últimos ${registros.length} registros</span></div>
    <div class="tabla-wrap"><table><thead><tr><th>Cuándo</th><th>Usuario</th><th>Acción</th><th>Detalle</th><th class="der">Resultado</th></tr></thead><tbody>
    ${registros.length ? registros.map((r) => html`<tr>
      <td style="white-space:nowrap">${cuando(r.ts)}</td><td>${r.usuario ?? html`<span class="tenue">${r.detalle ?? '—'}</span>`}</td>
      <td>${ACCIONES[r.accion] ?? r.accion}</td><td><code>${r.ruta ?? ''}</code>${r.ip ? html` <span class="tenue">· ${r.ip}</span>` : ''}</td>
      <td class="der">${r.estado == null ? '' : r.estado < 400 ? html`<span class="insignia ok">${r.estado}</span>` : html`<span class="insignia error">${r.estado}</span>`}</td></tr>`)
    : html`<tr><td colspan="5" class="tenue">Sin actividad todavía.</td></tr>`}
    </tbody></table></div>
  </div>`);

  const repintar = () => pintarUsuarios(panel, ctx);
  alHacer(panel, 'click', '[data-nuevo]', () => formulario({ roles, claveMin, alGuardar: repintar }));
  alHacer(panel, 'click', '[data-editar]', (e, b) => formulario({ usuario: usuarios.find((u) => u.id === Number(b.dataset.editar)), roles, claveMin, yo, alGuardar: repintar }));
}

function formulario({ usuario = null, roles, claveMin, yo = null, alGuardar }) {
  const nuevo = !usuario;
  const esYo = usuario && yo && usuario.id === yo.id;
  modal({
    titulo: nuevo ? 'Nuevo usuario' : `Editar · ${usuario.nombre}`,
    ancho: 520,
    cuerpo: html`<form class="form-grid">
      ${campo('nombre', 'Nombre', usuario?.nombre ?? '', { required: true, cls: 'doble' })}
      ${nuevo ? campo('email', 'Correo', '', { type: 'email', required: true, cls: 'doble', extra: 'autocomplete="off"' }) : html`<div class="campo doble"><label>Correo</label><div>${usuario.email}</div></div>`}
      ${campo('rol', 'Rol', null, { options: opciones(roles, usuario?.rol ?? 'planificador', { valor: (r) => r.id, texto: (r) => r.nombre }), cls: 'doble' })}
      ${campo('clave', nuevo ? 'Contraseña inicial' : 'Contraseña nueva (opcional)', '', {
        type: 'password', cls: 'doble', required: nuevo, extra: 'autocomplete="new-password"',
        help: nuevo ? `Al menos ${claveMin} caracteres. Entrégasela a la persona por un medio seguro; luego puede cambiarla desde su menú.` : `Déjala vacía para no cambiarla. Al cambiarla se cierran sus sesiones abiertas.`,
      })}
      ${nuevo ? '' : esYo ? html`<p class="muted doble" style="margin:0">No puedes desactivar tu propia cuenta.</p>` : campo('activo', 'Activo: puede iniciar sesión', usuario.activo, { type: 'checkbox', cls: 'doble' })}
    </form>`,
    acciones: [
      { texto: 'Cancelar', cerrar: true },
      {
        texto: nuevo ? 'Crear usuario' : 'Guardar', clase: 'btn-primario',
        accion: async (m) => {
          const d = m.datos();
          if (nuevo) {
            await post('/usuarios', { nombre: d.nombre, email: d.email, rol: d.rol, clave: d.clave });
            toast(`Usuario ${d.nombre} creado`);
          } else {
            const cambios = { nombre: d.nombre, rol: d.rol };
            if (!esYo) cambios.activo = d.activo;
            if (d.clave) cambios.clave = d.clave;
            await put(`/usuarios/${usuario.id}`, cambios);
            toast('Usuario actualizado');
            // Si uno se quitó a sí mismo el rol de Admin, recarga para ver el menú de su nuevo rol.
            if (esYo && d.rol !== yo.rol) { location.reload(); return; }
          }
          m.cerrar();
          alGuardar().catch(falla);
        },
      },
    ],
  });
}
