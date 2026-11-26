// Configuración del servidor central, leída de variables de entorno (ver .env.example).
// Sin variables, el servidor se comporta como antes: solo en este computador (127.0.0.1:3000).
import path from 'node:path';

export class ErrorConfig extends Error {}

/** Lee y valida la configuración. `env` se puede reemplazar en pruebas. */
export function leerConfig(env = process.env, raiz = process.cwd()) {
  const texto = (k) => (env[k] ?? '').trim();

  const puertoTxt = texto('PORT');
  const puerto = puertoTxt === '' ? 3000 : Number(puertoTxt);
  if (!Number.isInteger(puerto) || puerto < 1 || puerto > 65535) throw new ErrorConfig(`PORT no es un puerto válido: "${puertoTxt}".`);

  const servidor = texto('GOOGLE_SERVER_KEY');
  const navegador = texto('GOOGLE_BROWSER_KEY');
  if (!!servidor !== !!navegador) {
    throw new ErrorConfig(
      'Define las dos claves de Google o ninguna: GOOGLE_SERVER_KEY (rutas y geocodificación, desde el servidor) ' +
        'y GOOGLE_BROWSER_KEY (el mapa en el navegador, restringida al dominio de BHUMI).'
    );
  }

  const trust = texto('TRUST_PROXY');
  return {
    host: texto('HOST') || '127.0.0.1',
    puerto,
    dbFile: texto('DB_FILE') ? path.resolve(raiz, texto('DB_FILE')) : path.join(raiz, 'data', 'bhumi.db'),
    // Detrás de Caddy u otro proxy: permite leer la IP real del cliente y el protocolo https.
    trustProxy: trust === '' ? false : trust === 'true' ? true : /^\d+$/.test(trust) ? Number(trust) : trust,
    clavesGoogle: servidor ? { servidor, navegador } : null,
  };
}
