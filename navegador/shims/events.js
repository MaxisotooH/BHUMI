// EventEmitter mínimo para el navegador (reemplaza al módulo "events" de Node). Lo usan la respuesta de la API y PDFKit.
export class EventEmitter {
  constructor() { this._events = Object.create(null); }
  _lista(nombre) { return (this._events[nombre] ??= []); }
  on(nombre, fn) { this._lista(nombre).push({ fn, una: false }); return this; }
  addListener(nombre, fn) { return this.on(nombre, fn); }
  prependListener(nombre, fn) { this._lista(nombre).unshift({ fn, una: false }); return this; }
  once(nombre, fn) { this._lista(nombre).push({ fn, una: true }); return this; }
  prependOnceListener(nombre, fn) { this._lista(nombre).unshift({ fn, una: true }); return this; }
  off(nombre, fn) {
    const l = this._events[nombre];
    if (!l) return this;
    const i = l.findIndex((x) => x.fn === fn || x.fn.listener === fn);
    if (i >= 0) l.splice(i, 1);
    if (!l.length) delete this._events[nombre];
    return this;
  }
  removeListener(nombre, fn) { return this.off(nombre, fn); }
  removeAllListeners(nombre) { if (nombre === undefined) this._events = Object.create(null); else delete this._events[nombre]; return this; }
  emit(nombre, ...args) {
    const l = this._events[nombre];
    if (!l?.length) {
      if (nombre === 'error') throw args[0] instanceof Error ? args[0] : new Error(String(args[0]));
      return false;
    }
    for (const x of [...l]) {
      if (x.una) this.off(nombre, x.fn);
      x.fn.apply(this, args);
    }
    return true;
  }
  listeners(nombre) { return (this._events[nombre] ?? []).map((x) => x.fn); }
  rawListeners(nombre) { return this.listeners(nombre); }
  listenerCount(nombre) { return (this._events[nombre] ?? []).length; }
  eventNames() { return Object.keys(this._events); }
  setMaxListeners() { return this; }
  getMaxListeners() { return Infinity; }
}
EventEmitter.EventEmitter = EventEmitter;
EventEmitter.defaultMaxListeners = 10;
export default EventEmitter;
