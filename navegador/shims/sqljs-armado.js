// Solo para el armado de prueba (--sin-sqljs): reemplaza a sql.js para comprobar que todo lo demás se empaqueta bien.
export default async function initSqlJs() { throw new Error('Armado de prueba: este archivo no incluye SQLite para el navegador.'); }
