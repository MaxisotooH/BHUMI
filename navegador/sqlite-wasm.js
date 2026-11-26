// Adaptador: ofrece la misma interfaz que `DatabaseSync` de node:sqlite, pero sobre SQLite compilado a WebAssembly (sql.js).
// Así el servidor (db.js, api.js y los servicios) corre sin cambios dentro del navegador.
// La base vive en memoria; `exportBytes()` la entrega completa para guardarla.

let SQL = null;

/** Se llama una vez al iniciar, con el módulo ya inicializado de sql.js. */
export function configurarSql(modulo) { SQL = modulo; }

const valor = (v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : typeof v === 'bigint' ? Number(v) : v);

/** Parámetros posicionales (`?`) o con nombre (`$campo`): sql.js exige el prefijo, node:sqlite no. */
function normalizar(args) {
  if (args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0]) && !ArrayBuffer.isView(args[0])) {
    const o = {};
    for (const [k, v] of Object.entries(args[0])) o[/^[$:@]/.test(k) ? k : `$${k}`] = valor(v);
    return o;
  }
  return args.map(valor);
}

class Sentencia {
  constructor(base, sql) { this.base = base; this.sql = sql; }

  /** Compila, ejecuta `usar` y libera siempre la sentencia (en sql.js queda memoria reservada si no se libera). */
  _con(args, usar) {
    const s = this.base._db.prepare(this.sql);
    try {
      const params = normalizar(args);
      if (Array.isArray(params) ? params.length : Object.keys(params).length) s.bind(params);
      return usar(s);
    } finally { s.free(); }
  }

  run(...args) {
    this._con(args, (s) => { while (s.step()) { /* descarta filas */ } });
    const cambios = this.base._db.getRowsModified();
    const id = this.base._db.exec('SELECT last_insert_rowid()')[0].values[0][0];
    return { changes: cambios, lastInsertRowid: id };
  }

  get(...args) { return this._con(args, (s) => (s.step() ? s.getAsObject() : undefined)); }

  all(...args) {
    return this._con(args, (s) => {
      const filas = [];
      while (s.step()) filas.push(s.getAsObject());
      return filas;
    });
  }
}

export class DatabaseSync {
  /** `origen`: bytes de una base ya guardada; cualquier otra cosa (undefined, ':memory:') crea una base vacía. */
  constructor(origen) {
    if (!SQL) throw new Error('SQLite aún no se ha inicializado.');
    this._db = origen instanceof Uint8Array ? new SQL.Database(origen) : new SQL.Database();
  }

  exec(sql) { this._db.exec(sql); }

  prepare(sql) { return new Sentencia(this, sql); }

  close() { this._db.close(); }

  /** La base completa como bytes. sql.js reinicia los PRAGMA al exportar, así que se reactivan las relaciones. */
  exportBytes() {
    const datos = this._db.export();
    this._db.exec('PRAGMA foreign_keys = ON;');
    return datos;
  }

  /** Reemplaza toda la base por la de un archivo .db. Si el archivo no es una base SQLite válida, no cambia nada. */
  cargarBytes(bytes) {
    const nueva = new SQL.Database(bytes);
    try { nueva.exec('SELECT count(*) FROM sqlite_master'); } catch { nueva.close(); throw Object.assign(new Error('El archivo no es una base de datos de BHUMI válida.'), { status: 400, code: 'respaldo_invalido' }); }
    this._db.close();
    this._db = nueva;
    this._db.exec('PRAGMA foreign_keys = ON;');
  }
}
