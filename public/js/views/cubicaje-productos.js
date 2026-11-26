// Productos con sus medidas y peso (base del cubicaje) y capacidad máxima de cada vehículo por producto.
import { html, pintar, get, post, put, del, num0, num1, toast, falla, modal, confirmar, campo, opciones, vacio, alHacer, nombreVehiculo } from '../lib.js';
import { faltaDato } from '../componentes.js';

// ---------- Productos ----------
export async function pintarProductos(ctx, cont) {
  const productos = await get('/productos');
  const recargar = () => pintarProductos(ctx, cont).catch(falla);
  const completos = productos.filter((p) => p.medidas_completas).length;
  const sinPeso = productos.filter((p) => p.peso_kg == null).length;

  pintar(cont, html`
    <div class="fila entre" style="margin-bottom:12px">
      <p class="muted" style="margin:0;max-width:70ch">Cada producto necesita largo, ancho, alto y peso reales. Con eso el sistema calcula cuántas unidades caben en cada vehículo y cuándo conviene juntar entregas. Un producto sin medidas no se cubica: el sistema no inventa valores.</p>
      <button class="btn btn-primario" id="prod-nuevo">Agregar producto</button></div>
    ${productos.length && completos < productos.length ? faltaDato(`${num0(productos.length - completos)} ${productos.length - completos === 1 ? 'producto sin medidas completas' : 'productos sin medidas completas'}`, [`Completa largo, ancho y alto para que entren en el cubicaje.${sinPeso ? ` ${num0(sinPeso)} sin peso: el control de peso queda incompleto.` : ''}`]) : ''}
    <div class="card">${productos.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Producto</th><th>Código</th><th class="der">Largo</th><th class="der">Ancho</th><th class="der">Alto</th><th class="der">Peso</th><th>Se puede apilar</th><th>Se puede girar</th><th>Medidas</th><th></th></tr></thead><tbody>
      ${productos.map((p) => html`<tr>
        <td><b>${p.nombre}</b></td><td class="muted">${p.sku ?? '—'}</td>
        <td class="der">${p.largo_cm != null ? `${num1(p.largo_cm)} cm` : html`<span class="tenue">—</span>`}</td>
        <td class="der">${p.ancho_cm != null ? `${num1(p.ancho_cm)} cm` : html`<span class="tenue">—</span>`}</td>
        <td class="der">${p.alto_cm != null ? `${num1(p.alto_cm)} cm` : html`<span class="tenue">—</span>`}</td>
        <td class="der">${p.peso_kg != null ? `${num1(p.peso_kg)} kg` : html`<span class="tenue">—</span>`}</td>
        <td>${p.apilable ? 'Sí' : 'No'}</td><td>${p.rotable ? 'Sí' : 'No'}</td>
        <td>${p.medidas_completas ? html`<span class="insignia ok">Completas</span>` : html`<span class="insignia aviso">Faltan</span>`}</td>
        <td class="der"><button class="btn btn-chico" data-editar="${p.id}">Editar</button></td></tr>`)}</tbody></table></div>`
      : vacio('Aún no hay productos', 'Agrega los productos que despachas con sus medidas y peso reales. Puedes copiarlos de la ficha del proveedor o medirlos con huincha.', html`<button class="btn btn-primario" data-nuevo>Agregar producto</button>`)}</div>`);

  const porId = new Map(productos.map((p) => [p.id, p]));
  cont.querySelector('#prod-nuevo').addEventListener('click', () => formularioProducto({ alGuardar: recargar }));
  alHacer(cont, 'click', '[data-nuevo]', () => formularioProducto({ alGuardar: recargar }));
  alHacer(cont, 'click', '[data-editar]', (e, b) => formularioProducto({ p: porId.get(Number(b.dataset.editar)), alGuardar: recargar }));
}

function formularioProducto({ p = null, alGuardar }) {
  const x = p ?? {};
  const medida = (n, label, unit, help) => campo(n, label, x[n], { type: 'number', unit, min: 0, help });
  modal({
    titulo: p ? `Editar ${p.nombre}` : 'Nuevo producto', ancho: 640,
    cuerpo: html`<form id="fp">
      <div class="form-grid">${campo('nombre', 'Nombre del producto', x.nombre, { required: true, cls: 'ancho' })}${campo('sku', 'Código (opcional)', x.sku)}${campo('unidad', 'Unidad', x.unidad ?? 'un', { placeholder: 'Ej.: un, caja, pack' })}</div>
      <div class="seccion-form">Medidas de una unidad embalada <span class="muted" style="font-weight:400">· como viajan en el vehículo</span></div>
      <div class="form-grid">${medida('largo_cm', 'Largo', 'cm')}${medida('ancho_cm', 'Ancho', 'cm')}${medida('alto_cm', 'Alto', 'cm')}${medida('peso_kg', 'Peso', 'kg')}</div>
      <div class="seccion-form">Cómo se puede acomodar</div>
      <div class="fila" style="gap:24px">${campo('apilable', 'Se puede poner otro producto encima', x.apilable ?? 1, { type: 'checkbox' })}${campo('rotable', 'Se puede girar y acostar', x.rotable ?? 0, { type: 'checkbox' })}</div>
      <p class="muted" style="font-size:13px;margin-top:8px">Si el producto es frágil o debe ir parado, deja “apilar” y “girar” sin marcar. Así el cálculo no lo acuesta ni le pone peso encima.</p></form>`,
    acciones: [
      ...(p ? [{ texto: 'Quitar', clase: 'btn-peligro', accion: async (m) => {
        if (!(await confirmar({ titulo: 'Quitar producto', mensaje: 'El producto deja de aparecer en las listas. Las entregas que ya lo usan conservan su historial.', textoOk: 'Quitar', peligro: true }))) return;
        await del(`/productos/${p.id}`); m.cerrar(); toast('Producto quitado'); await alGuardar();
      } }] : []),
      { texto: 'Cancelar', cerrar: true },
      { texto: 'Guardar producto', clase: 'btn-primario', accion: async (m) => {
        if (!m.el.querySelector('#fp').reportValidity()) return;
        const d = m.datos();
        d.apilable = d.apilable ? 1 : 0;
        d.rotable = d.rotable ? 1 : 0;
        p ? await put(`/productos/${p.id}`, d) : await post('/productos', d);
        m.cerrar(); toast('Producto guardado'); await alGuardar();
      } },
    ],
  });
}

// ---------- Capacidad por producto ----------
export async function pintarCapacidad(ctx, cont) {
  const vehiculos = (await get('/vehiculos')).filter((v) => v.activo);
  if (!vehiculos.length) { pintar(cont, html`<div class="card">${vacio('No hay vehículos', 'Agrega un vehículo con las medidas de su espacio de carga para ver cuánto lleva de cada producto.', html`<a class="btn btn-primario" href="#/vehiculos">Ir a vehículos</a>`)}</div>`); return; }
  let sel = Number(ctx.params.get('vehiculo')) || vehiculos[0].id;
  if (!vehiculos.some((v) => v.id === sel)) sel = vehiculos[0].id;

  async function mostrar() {
    const r = await get(`/cubicaje/capacidad?vehicle_id=${sel}`);
    const falVeh = r.vehiculo.faltan ?? [];
    pintar(cont, html`
      <div class="fila" style="margin-bottom:12px"><label for="cap-veh" class="muted">Vehículo</label><select id="cap-veh" style="width:auto">${opciones(vehiculos, sel, { valor: (v) => v.id, texto: nombreVehiculo })}</select></div>
      ${falVeh.length ? faltaDato('Faltan medidas del vehículo', [`Completa el espacio de carga: ${falVeh.join(', ')}.`], html`<a class="btn btn-chico" href="#/vehiculos">Editar vehículo</a>`) : ''}
      <div class="card"><div class="card-cab"><h2>Máximo de unidades por viaje, un solo producto</h2></div>
      ${r.productos.length ? html`<div class="tabla-wrap"><table><thead><tr><th>Producto</th><th class="der">Caben por espacio</th><th class="der">Caben por peso</th><th class="der">Máximo por viaje</th><th>Lo que limita</th></tr></thead><tbody>
        ${r.productos.map((x) => x.calculable ? html`<tr><td><b>${x.nombre}</b></td><td class="der">${num0(x.por_volumen)}</td><td class="der">${x.por_peso != null ? num0(x.por_peso) : html`<span class="tenue">Sin peso o sin capacidad</span>`}</td><td class="der"><b>${num0(x.maximo)}</b></td><td>${x.limitante === 'peso' ? 'El peso' : 'El espacio'}</td></tr>`
          : html`<tr><td><b>${x.nombre}</b></td><td colspan="4"><span class="insignia aviso">Faltan medidas</span> <span class="muted">${x.faltan?.productos?.[0]?.faltan?.length ? `Falta: ${x.faltan.productos[0].faltan.join(', ')}` : 'Falta completar el vehículo'}</span></td></tr>`)}</tbody></table></div>`
        : vacio('No hay productos', 'Agrega productos con sus medidas para ver cuántos caben.', html`<a class="btn btn-primario" href="#/cubicaje?tab=productos">Agregar productos</a>`)}</div>
      <p class="muted" style="font-size:13px;margin-top:10px">El cálculo acomoda las cajas en el espacio útil real del vehículo, respetando si se pueden apilar o girar. Para mezclar productos usa la calculadora de carga.</p>`);
    cont.querySelector('#cap-veh').addEventListener('change', (e) => { sel = Number(e.target.value); mostrar().catch(falla); });
  }
  await mostrar();
}
