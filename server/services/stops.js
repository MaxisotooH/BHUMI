// Convierte entregas o clientes en "paradas" que entiende el planificador.

export class NoEncontrado extends Error {
  constructor(msg) { super(msg); this.status = 404; this.code = 'no_encontrado'; }
}

/** Peso de una entrega en kg: solo si todos sus productos tienen peso registrado. */
export function pesoEntrega(items) {
  if (!items.length) return null;
  if (!items.every((i) => i.peso_kg != null && i.peso_kg > 0)) return null;
  return items.reduce((a, i) => a + i.cantidad * i.peso_kg, 0);
}

export function itemsDeEntrega(db, entregaId) {
  return db.prepare(`SELECT di.id, di.product_id, di.descripcion, di.cantidad, p.nombre AS producto, p.sku, p.peso_kg, p.unidad
    FROM delivery_items di LEFT JOIN products p ON p.id = di.product_id WHERE di.delivery_id = ? ORDER BY di.id`).all(entregaId);
}

export function stopsDesdeEntregas(db, ids) {
  return ids.map((id) => {
    const d = db.prepare(`SELECT d.*, c.nombre, c.empresa, c.comuna, c.region, c.direccion AS cliente_direccion,
        c.lat AS clat, c.lng AS clng, c.telefono FROM deliveries d JOIN clients c ON c.id = d.client_id WHERE d.id = ?`).get(id);
    if (!d) throw new NoEncontrado(`No existe la entrega ${id}.`);
    const items = itemsDeEntrega(db, id);
    return {
      key: `d${id}`,
      delivery_id: id,
      client_id: d.client_id,
      nombre: d.nombre,
      empresa: d.empresa,
      comuna: d.comuna,
      region: d.region,
      direccion: d.direccion_entrega ?? d.cliente_direccion,
      lat: d.lat ?? d.clat,
      lng: d.lng ?? d.clng,
      peso_kg: pesoEntrega(items),
      unidades: items.reduce((a, i) => a + i.cantidad, 0),
      ventana: d.ventana_desde ? `${d.ventana_desde}${d.ventana_hasta ? `–${d.ventana_hasta}` : ''}` : null,
      estado: d.estado,
      trip_id: d.trip_id,
    };
  });
}

export function stopsDesdeClientes(db, ids) {
  return ids.map((id) => {
    const c = db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
    if (!c) throw new NoEncontrado(`No existe el cliente ${id}.`);
    return {
      key: `c${id}`,
      delivery_id: null,
      client_id: id,
      nombre: c.nombre,
      empresa: c.empresa,
      comuna: c.comuna,
      region: c.region,
      direccion: c.direccion,
      lat: c.lat,
      lng: c.lng,
      peso_kg: null,
      unidades: null,
      ventana: null,
    };
  });
}
