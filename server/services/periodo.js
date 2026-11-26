// Períodos de análisis. Los paneles aceptan un mes (AAAA-MM) o un rango de fechas (desde y hasta, ambos incluidos).
import { sumarDias, hoyLocal } from './vehiculos-estado.js';

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-\d{2}$/;

const ultimoDiaDelMes = (mes) => {
  const [y, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

/**
 * @returns {{ desde: string, hasta: string, hasta_excl: string, mes: string|null, etiqueta: string }}
 *   Sin datos usa el mes en curso. `hasta` incluye el día; `hasta_excl` es el día siguiente (para filtrar con "<").
 */
export function resolverPeriodo({ mes, desde, hasta } = {}, hoy = hoyLocal()) {
  if (FECHA.test(desde ?? '') || FECHA.test(hasta ?? '')) {
    const d = FECHA.test(desde ?? '') ? desde : '0000-01-01';
    const h = FECHA.test(hasta ?? '') ? hasta : '9999-12-31';
    return { desde: d, hasta: h, hasta_excl: h === '9999-12-31' ? '9999-12-31' : sumarDias(h, 1), mes: null, etiqueta: `${desde ?? 'inicio'} a ${hasta ?? 'hoy'}` };
  }
  const m = MES.test(mes ?? '') ? mes : hoy.slice(0, 7);
  const h = ultimoDiaDelMes(m);
  return { desde: `${m}-01`, hasta: h, hasta_excl: sumarDias(h, 1), mes: m, etiqueta: m };
}

/** Los `n` meses que terminan en `mes` (el más antiguo primero). */
export function ultimosMeses(n, mes) {
  const [y, m] = mes.split('-').map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1)).toISOString().slice(0, 7));
}
