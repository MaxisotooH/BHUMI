// Crea un usuario administrador (o restablece su contraseña) directamente en la base del servidor.
//
//   npm run crear-admin -- --email ana@empresa.cl --nombre "Ana Pérez"
//   npm run crear-admin -- --email ana@empresa.cl --restablecer      (olvidó su contraseña)
//   En Docker:  docker compose exec app npm run crear-admin -- --email … --nombre …
//
// La contraseña se pide por teclado sin mostrarla. Para automatizar, se puede pasar en BHUMI_ADMIN_CLAVE.
import readline from 'node:readline';
import { parseArgs } from 'node:util';
import { openDb } from './db.js';
import { leerConfig } from './config.js';
import { crearUsuario, hashClave, validarClave } from './auth.js';

function preguntar(texto, { oculto = false } = {}) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (oculto) rl._writeToOutput = (s) => { if (s.startsWith(texto)) rl.output.write(texto); };
    rl.question(texto, (r) => { rl.close(); if (oculto) process.stdout.write('\n'); ok(r); });
  });
}

async function pedirClave() {
  if (process.env.BHUMI_ADMIN_CLAVE) return process.env.BHUMI_ADMIN_CLAVE;
  if (!process.stdin.isTTY) throw new Error('No hay teclado para pedir la contraseña. Usa la variable BHUMI_ADMIN_CLAVE o ejecuta el comando con "docker compose exec" (con terminal).');
  for (;;) {
    const c1 = await preguntar('Contraseña nueva: ', { oculto: true });
    const problema = validarClave(c1);
    if (problema) { console.log(problema); continue; }
    const c2 = await preguntar('Repite la contraseña: ', { oculto: true });
    if (c1 === c2) return c1;
    console.log('Las contraseñas no coinciden. Intenta de nuevo.');
  }
}

async function main() {
  const { values: a } = parseArgs({ options: { email: { type: 'string' }, nombre: { type: 'string' }, restablecer: { type: 'boolean', default: false } } });
  if (!a.email) throw new Error('Falta --email. Ejemplo: npm run crear-admin -- --email ana@empresa.cl --nombre "Ana Pérez"');
  const config = leerConfig(process.env, process.cwd());
  const db = openDb(config.dbFile);
  try {
    const email = a.email.trim().toLowerCase();
    const existente = db.prepare('SELECT * FROM usuarios WHERE email = ?').get(email);
    if (a.restablecer) {
      if (!existente) throw new Error(`No existe un usuario con el correo ${email}.`);
      const clave = await pedirClave();
      const problema = validarClave(clave);
      if (problema) throw new Error(problema);
      db.prepare('UPDATE usuarios SET clave_hash = ?, activo = 1 WHERE id = ?').run(await hashClave(clave), existente.id);
      db.prepare('DELETE FROM sesiones WHERE usuario_id = ?').run(existente.id);
      db.prepare("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, 'clave_restablecida', 'desde la línea de comandos')").run(existente.id);
      console.log(`Listo: se restableció la contraseña de ${existente.nombre} (${email}) y quedó activo.`);
      return;
    }
    if (existente) throw new Error(`Ya existe un usuario con el correo ${email}. Para cambiar su contraseña agrega --restablecer.`);
    if (!a.nombre) throw new Error('Falta --nombre. Ejemplo: --nombre "Ana Pérez"');
    const clave = await pedirClave();
    const id = await crearUsuario(db, { email, nombre: a.nombre, rol: 'admin', clave });
    db.prepare("INSERT INTO auditoria (usuario_id, accion, detalle) VALUES (?, 'usuario_creado', 'administrador creado desde la línea de comandos')").run(id);
    console.log(`Listo: ${a.nombre} (${email}) es administrador. Ya puede iniciar sesión en BHUMI.`);
  } finally {
    db.close();
  }
}

main().catch((e) => { console.error(`\nNo se pudo completar: ${e.message}\n`); process.exit(1); });
