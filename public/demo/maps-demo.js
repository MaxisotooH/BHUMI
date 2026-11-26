// Mapa de demostración: reemplaza a Google Maps SOLO en el modo demostración (npm run demo).
// Dibuja los puntos y las rutas sobre una cuadrícula con proyección Web Mercator; no tiene calles ni nombres de lugares.
(() => {
  const mercator = (lat, lng, z) => {
    const w = 256 * 2 ** z, s = Math.sin((lat * Math.PI) / 180);
    return { x: ((lng + 180) / 360) * w, y: (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * w };
  };
  const inversa = (x, y, z) => {
    const w = 256 * 2 ** z, n = Math.PI - (2 * Math.PI * y) / w;
    return { lat: (180 / Math.PI) * Math.atan(Math.sinh(n)), lng: (x / w) * 360 - 180 };
  };
  const coord = (p) => (typeof p.lat === 'function' ? { lat: p.lat(), lng: p.lng() } : { lat: p.lat, lng: p.lng });

  class LatLng { constructor(lat, lng) { this._lat = lat; this._lng = lng; } lat() { return this._lat; } lng() { return this._lng; } }
  class LatLngBounds { constructor() { this.pts = []; } extend(p) { this.pts.push(coord(p)); return this; } }

  const SVG = 'http://www.w3.org/2000/svg';

  class Map {
    constructor(el, o = {}) {
      this.el = el;
      this.vista = { lat: o.center?.lat ?? -33.45, lng: o.center?.lng ?? -70.66, zoom: o.zoom ?? 11 };
      this.marcas = new Set(); this.lineas = new Set(); this.ajuste = null;
      if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
      Object.assign(el.style, { overflow: 'hidden', background: '#eef3f0', cursor: 'grab', userSelect: 'none', touchAction: 'none' });
      this.fondo = document.createElement('div'); this.fondo.style.cssText = 'position:absolute;inset:0;pointer-events:none';
      this.svg = document.createElementNS(SVG, 'svg'); this.svg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none';
      this.capa = document.createElement('div'); this.capa.style.cssText = 'position:absolute;inset:0';
      const etiqueta = document.createElement('div');
      etiqueta.textContent = 'Mapa de demostración · no es Google Maps';
      etiqueta.style.cssText = 'position:absolute;left:10px;bottom:10px;background:#fff;border:1px solid #c9d3ce;border-radius:6px;padding:3px 9px;font:600 12px/1.4 Barlow,system-ui,sans-serif;color:#41524b;pointer-events:none;z-index:5';
      const zoom = document.createElement('div');
      zoom.style.cssText = 'position:absolute;right:10px;top:10px;display:flex;flex-direction:column;z-index:5;box-shadow:0 1px 4px rgba(0,0,0,.25);border-radius:6px;overflow:hidden';
      for (const [txt, d] of [['+', 1], ['−', -1]]) {
        const b = document.createElement('button'); b.type = 'button'; b.textContent = txt; b.setAttribute('aria-label', d > 0 ? 'Acercar' : 'Alejar');
        b.style.cssText = 'width:34px;height:34px;border:0;background:#fff;font-size:20px;line-height:1;cursor:pointer;color:#26332e';
        b.addEventListener('click', (e) => { e.stopPropagation(); this.ajuste = null; this.vista.zoom = Math.min(19, Math.max(2, this.vista.zoom + d)); this.render(); });
        zoom.appendChild(b);
      }
      el.append(this.fondo, this.svg, this.capa, etiqueta, zoom);
      new ResizeObserver(() => { if (this.ajuste) this.encajar(); else this.render(); }).observe(el);
      this.activarArrastre(); this.render();
    }
    activarArrastre() {
      let inicio = null;
      this.el.addEventListener('pointerdown', (e) => { if (e.target.closest('button,.pin')) return; inicio = { x: e.clientX, y: e.clientY, v: { ...this.vista } }; this.el.setPointerCapture(e.pointerId); this.el.style.cursor = 'grabbing'; });
      this.el.addEventListener('pointermove', (e) => {
        if (!inicio) return; this.ajuste = null;
        const c = mercator(inicio.v.lat, inicio.v.lng, inicio.v.zoom);
        const n = inversa(c.x - (e.clientX - inicio.x), c.y - (e.clientY - inicio.y), inicio.v.zoom);
        this.vista.lat = n.lat; this.vista.lng = n.lng; this.render();
      });
      const fin = () => { inicio = null; this.el.style.cursor = 'grab'; };
      this.el.addEventListener('pointerup', fin); this.el.addEventListener('pointercancel', fin);
      this.el.addEventListener('wheel', (e) => { e.preventDefault(); this.ajuste = null; this.vista.zoom = Math.min(19, Math.max(2, this.vista.zoom + (e.deltaY < 0 ? 0.5 : -0.5))); this.render(); }, { passive: false });
    }
    fitBounds(b, pad = 60) { this.ajuste = { pts: b.pts, pad: typeof pad === 'number' ? pad : 60 }; this.encajar(); }
    encajar() {
      const { pts, pad } = this.ajuste; const w = this.el.clientWidth, h = this.el.clientHeight;
      if (!pts.length || !w || !h) return;
      let z = 17;
      for (; z > 2; z -= 0.25) {
        const p = pts.map((q) => mercator(q.lat, q.lng, z));
        const ancho = Math.max(...p.map((a) => a.x)) - Math.min(...p.map((a) => a.x)), alto = Math.max(...p.map((a) => a.y)) - Math.min(...p.map((a) => a.y));
        if (ancho <= w - 2 * pad && alto <= h - 2 * pad) break;
      }
      const p = pts.map((q) => mercator(q.lat, q.lng, z));
      const cx = (Math.max(...p.map((a) => a.x)) + Math.min(...p.map((a) => a.x))) / 2, cy = (Math.max(...p.map((a) => a.y)) + Math.min(...p.map((a) => a.y))) / 2;
      const c = inversa(cx, cy, z); this.vista = { lat: c.lat, lng: c.lng, zoom: z }; this.render();
    }
    setZoom(z) { this.ajuste = null; this.vista.zoom = z; this.render(); }
    setCenter(p) { this.ajuste = null; const c = coord(p); this.vista.lat = c.lat; this.vista.lng = c.lng; this.render(); }
    panTo(p) { this.setCenter(p); }
    render() {
      const w = this.el.clientWidth || 600, h = this.el.clientHeight || 400, v = this.vista;
      const c = mercator(v.lat, v.lng, v.zoom);
      const paso = 64, ox = (((w / 2 - c.x) % paso) + paso) % paso, oy = (((h / 2 - c.y) % paso) + paso) % paso;
      this.fondo.style.background = `linear-gradient(#dde7e1 1px, transparent 1px) ${ox}px ${oy}px/${paso}px ${paso}px, linear-gradient(90deg, #dde7e1 1px, transparent 1px) ${ox}px ${oy}px/${paso}px ${paso}px`;
      const aPx = (p) => { const q = mercator(p.lat, p.lng, v.zoom); return { x: q.x - c.x + w / 2, y: q.y - c.y + h / 2 }; };
      for (const m of this.marcas) { const q = aPx(coord(m.position)); m.el.style.left = `${q.x}px`; m.el.style.top = `${q.y}px`; }
      for (const l of this.lineas) l.dibujar(aPx);
    }
  }

  class AdvancedMarkerElement {
    constructor(o) {
      this.position = o.position; this.title = o.title; this._map = null;
      this.el = document.createElement('div');
      this.el.style.cssText = `position:absolute;transform:translate(-50%,-100%);z-index:${o.zIndex ?? 1}`;
      if (o.title) this.el.title = o.title;
      if (o.content) this.el.appendChild(o.content);
      this.map = o.map;
    }
    set map(m) {
      if (this._map) { this._map.marcas.delete(this); this.el.remove(); }
      this._map = m ?? null;
      if (m) { m.capa.appendChild(this.el); m.marcas.add(this); m.render(); }
    }
    get map() { return this._map; }
  }

  class Polyline {
    constructor(o) {
      this.path = o.path; this.o = o; this._map = null;
      this.nodo = document.createElementNS(SVG, 'path');
      const punteada = !!o.icons?.length;
      this.nodo.setAttribute('fill', 'none'); this.nodo.setAttribute('stroke', o.strokeColor ?? '#2a78d6');
      this.nodo.setAttribute('stroke-width', punteada ? 3 : o.strokeWeight ?? 4);
      this.nodo.setAttribute('stroke-opacity', punteada ? 0.9 : o.strokeOpacity ?? 1);
      this.nodo.setAttribute('stroke-linecap', 'round'); this.nodo.setAttribute('stroke-linejoin', 'round');
      if (punteada) this.nodo.setAttribute('stroke-dasharray', '1 10');
      this.setMap(o.map);
    }
    setMap(m) {
      if (this._map) { this._map.lineas.delete(this); this.nodo.remove(); }
      this._map = m ?? null;
      if (m) { m.svg.appendChild(this.nodo); m.lineas.add(this); m.render(); }
    }
    getPath() { return this.path; }
    dibujar(aPx) { this.nodo.setAttribute('d', this.path.map((p, i) => { const q = aPx(coord(p)); return `${i ? 'L' : 'M'}${q.x.toFixed(1)} ${q.y.toFixed(1)}`; }).join(' ')); }
  }

  function decodePath(texto) {
    const puntos = []; let i = 0, lat = 0, lng = 0;
    while (i < texto.length) {
      for (const eje of [0, 1]) {
        let desplazamiento = 0, resultado = 0, b;
        do { b = texto.charCodeAt(i++) - 63; resultado |= (b & 31) << desplazamiento; desplazamiento += 5; } while (b >= 32);
        const d = resultado & 1 ? ~(resultado >> 1) : resultado >> 1;
        if (eje === 0) lat += d; else lng += d;
      }
      puntos.push(new LatLng(lat / 1e5, lng / 1e5));
    }
    return puntos;
  }

  window.google = { maps: {
    importLibrary: async () => ({ Map }),
    Map, LatLng, LatLngBounds, Polyline,
    marker: { AdvancedMarkerElement },
    geometry: { encoding: { decodePath } },
  } };
  window.__bhumiMapsListo?.();
})();
