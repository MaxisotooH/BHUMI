// Codificación de polilíneas con el formato de Google (la ruta se guarda como texto compacto).
export function codificarPolilinea(puntos) {
  let lat = 0, lng = 0, out = '';
  const num = (n) => {
    let v = n < 0 ? ~(n << 1) : n << 1, s = '';
    while (v >= 32) { s += String.fromCharCode((32 | (v & 31)) + 63); v >>= 5; }
    return s + String.fromCharCode(v + 63);
  };
  for (const p of puntos) {
    const a = Math.round(p.lat * 1e5), b = Math.round(p.lng * 1e5);
    out += num(a - lat) + num(b - lng);
    lat = a; lng = b;
  }
  return out;
}
