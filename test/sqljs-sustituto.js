// Sustituto de sql.js SOLO para pruebas: imita su interfaz (Database, prepare, bind, step, getAsObject, free, export)
// usando node:sqlite. Sirve para comprobar el adaptador del navegador cuando sql.js real no está instalado.
import { DatabaseSync as Nativa } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

class Sentencia {
  constructor(db, sql) { this.db = db; this.stmt = db.nativa.prepare(sql); this.filas = null; this.i = 0; this.params = []; }
  bind(p) { this.params = Array.isArray(p) ? p : [p]; return true; }
  step() {
    if (!this.filas) {
      this.filas = this.stmt.all(...this.params);
      this.db.cambios = Number(this.db.nativa.prepare('SELECT changes() AS n').get().n);
    }
    return this.i < this.filas.length;
  }
  getAsObject() { return { ...this.filas[this.i++] }; }
  free() { this.stmt = null; }
}

class Database {
  constructor(datos) {
    this.archivo = path.join(os.tmpdir(), `sustituto_${process.pid}_${Math.random().toString(36).slice(2)}.db`);
    if (datos) fs.writeFileSync(this.archivo, datos);
    this.nativa = new Nativa(this.archivo);
    this.cambios = 0;
  }
  exec(sql) {
    const t = sql.trim();
    if (/^select/i.test(t) && !t.includes(';')) {
      const filas = this.nativa.prepare(t).all();
      if (!filas.length) return [];
      const columns = Object.keys(filas[0]);
      return [{ columns, values: filas.map((f) => columns.map((c) => f[c])) }];
    }
    this.nativa.exec(sql);
    return [];
  }
  prepare(sql) { return new Sentencia(this, sql); }
  getRowsModified() { return this.cambios; }
  export() { this.nativa.exec('PRAGMA wal_checkpoint(TRUNCATE)'); return new Uint8Array(fs.readFileSync(this.archivo)); }
  close() { try { this.nativa.close(); } catch { /* ya cerrada */ } fs.rmSync(this.archivo, { force: true }); fs.rmSync(`${this.archivo}-wal`, { force: true }); fs.rmSync(`${this.archivo}-shm`, { force: true }); }
}

export const sqljsSustituto = { Database };
