# BHUMI · Logística y distribución

Sistema para controlar y reducir los costos de transporte y distribución de BHUMI.
Responde: **cuánto cuesta realmente entregar, cómo rinde el equipo y la flota, qué ruta y qué vehículo conviene, y cuánto se puede ahorrar.**

Todo se calcula con datos reales que tú ingresas. El sistema no trae cifras de ejemplo: si falta un dato
(rendimiento km/L, precio del combustible, API key, etc.) te lo pide y no calcula hasta tenerlo.

## Cómo abrirlo

Extrae el `.zip` (clic derecho → *Extraer todo…*), abre la carpeta de BHUMI y haz **doble clic en `Abrir BHUMI.html`**. Se abre en el navegador (Google Chrome o Microsoft Edge).
No hay que instalar nada, ni Node.js, ni escribir comandos.

- `Abrir DEMO.html` abre el modo demostración: datos de prueba y mapa simulado, sin guardar nada (ver más abajo).
- **Tus datos se guardan dentro del navegador**, en tu computador, no en la carpeta. Mover, renombrar o copiar la carpeta no los pierde.
  Limpiar los datos de navegación con la opción "Cookies y otros datos de sitios" **sí los borra**: descarga un respaldo cada semana
  (Configuración → Respaldo de datos). BHUMI avisa cuando pasan varios días sin respaldo.
- Usa siempre el mismo navegador (los datos de Chrome no se ven desde Edge) y una sola pestaña de BHUMI a la vez.
- Ya no hay servidor: BHUMI funciona dentro de la página. Para consultar a Google se necesita conexión a internet; lo demás funciona sin conexión.

### Actualizar a una versión nueva

Extrae la carpeta nueva donde quieras y abre su `Abrir BHUMI.html` con el mismo navegador. Los datos siguen ahí, porque no viven en la carpeta.
Si quieres quedar tranquilo, descarga un respaldo antes.

### Si usabas la versión anterior

Si ya la abrías con doble clic en este mismo navegador, tus datos se conservan: al abrir esta versión se agrega lo nuevo (kilometraje, gastos, cubicaje, personal de bodega, seguridad de sectores). Los despachos anteriores quedan sin horas ni resultado por entrega hasta que los anotes, y los productos y vehículos sin medidas hasta que las ingreses.
Si usabas la versión que necesitaba Node, restaura su `respaldo.json` en **Configuración → Respaldo de datos → Elegir archivo de respaldo…**.

## Configurar Google Maps (obligatorio)

El mapa, las distancias, los tiempos y la geolocalización de direcciones los entrega Google. No hay cálculos de respaldo
con distancias inventadas.

1. Entra a https://console.cloud.google.com y crea o elige un proyecto.
2. Activa la facturación del proyecto (Google exige una cuenta de facturación aunque el uso entre en la cuota gratuita).
3. En **APIs y servicios → Biblioteca**, activa estas tres:
   - **Maps JavaScript API** (el mapa)
   - **Geocoding API** (direcciones a coordenadas)
   - **Routes API** (distancias, tiempos y rutas)
4. En **Credenciales**, crea una **clave de API**.
5. Restringe la clave por **API** (solo esas tres). No uses restricción por sitio web (HTTP referrer): BHUMI se abre desde un archivo de tu computador, no desde una dirección de internet, y Google no puede verificar ese origen. Crea además un presupuesto con alerta de gasto en Facturación.
6. Opcional: crea un **ID de mapa** (Map ID) en *Google Maps Platform → Administración de mapas* para estilos propios de mapa.
7. En BHUMI, ve a **Configuración → Google Maps**, pega la clave (y el ID de mapa si lo tienes), guarda y pulsa **Probar conexión**.

Al guardar la clave, el punto de partida (Poeta Pedro Prado 1536, Quinta Normal) se geolocaliza automáticamente.
Las rutas consultadas se guardan en una caché local para no pagar dos veces por la misma consulta.

## Qué hace BHUMI

BHUMI implementa el proyecto *Sistema de control y reducción de costos en el transporte y la distribución*. Cada punto del proyecto es una sección del menú:

| Sección | Qué resuelve |
|---|---|
| **Panel de análisis** | Compara rutas, conductores, clientes y vehículos en un solo lugar: costo total, por km y por entrega, cumplimiento, utilización de la carga y ahorro potencial. Se exporta a Excel y PDF. |
| **Control de costos** | Lo calculado frente a lo realmente gastado: combustible (con las cargas), mantención, neumáticos, seguros, permisos, peajes y el conductor. Muestra la diferencia por concepto y el costo real por km y por entrega. |
| **Indicadores KPI** | Desempeño del personal con las horas que se anotan en cada despacho: preparación de pedidos, carga del vehículo, ruta del conductor y cumplimiento de entregas (entregadas sobre programadas, con el motivo de cada no entrega). Se compara con los objetivos que defines. |
| **Clientes y zonas** | Mapa de clientes, concentración de entregas por comuna o zona y evaluación de seguridad de cada sector (con fuente, horario recomendado e incidentes). Alerta cuando hay entregas pendientes en sectores de riesgo. |
| **Rutas y despachos** | Al ingresar direcciones, calcula cuatro alternativas con Google Maps (menor distancia, tiempo, costo y balanceada), las compara con el orden tradicional y recomienda la más económica. Entrega al conductor el recorrido georreferenciado por Google Maps, WhatsApp o PDF. |
| **Vehículos y kilometraje** | Kilómetros de cada vehículo por semana, costo de operación, utilización, desgaste (neumáticos, vida útil) y mantención preventiva con aviso anticipado. |
| **Cubicaje y consolidación** | Cuántas unidades caben en cada vehículo según medidas y peso (con dibujo del acomodo), capacidad por producto y sugerencias de entregas cercanas que conviene juntar en un solo despacho. |
| **Configuración** | Punto de partida, Google Maps, combustible, costos operacionales, objetivos y metas, personal (conductores y bodega) y respaldo de datos. |

Todo se calcula con datos reales que ingresas. Si falta un dato, el indicador queda en blanco y el sistema dice qué falta: no hay cifras inventadas.

## Datos que debes ingresar

El **Panel de análisis** muestra qué falta para tener costos reales ("Faltan N datos…").

| Dato | Dónde |
|---|---|
| API key de Google Maps | Configuración → Google Maps |
| Punto de partida | Configuración → Punto de partida (viene con Poeta Pedro Prado 1536, Quinta Normal) |
| Precio del combustible por litro | Configuración → Combustible (se guarda con fecha de vigencia) |
| Rendimiento km/L, capacidad y medidas del espacio de carga de cada vehículo | Vehículos y kilometraje → Agregar o editar vehículo |
| Desgaste: neumáticos, mantención, depreciación y vida útil | Vehículos y kilometraje (si dejas un componente vacío, se calcula con los datos del vehículo cuando es posible) |
| Costo por hora del conductor, tiempo por cliente, jornada y recargo por horas adicionales | Configuración → Costos operacionales |
| Objetivos: preparación, carga, cumplimiento, utilización de la carga, radio de cercanía | Configuración → Objetivos y metas (sin objetivo, el indicador se muestra sin comparación) |
| Conductores y personal de bodega | Configuración → Personal |
| Productos con largo, ancho, alto y peso | Cubicaje y consolidación → Productos y medidas |
| Clientes (nombre, dirección, comuna) | Clientes y zonas → Clientes (también se importan desde Excel; hay plantilla) |
| Evaluación de seguridad de los sectores | Clientes y zonas → Zonas y seguridad (debe indicar la fuente) |
| Entregas pendientes | Rutas y despachos → Entregas |
| Kilómetros de cada vehículo por semana y cargas de combustible | Vehículos y kilometraje |
| Gastos reales: mantención, neumáticos, seguros, permisos, peajes | Control de costos → Registrar gasto |
| Horas reales de cada despacho y resultado de cada entrega | Rutas y despachos → Despachos → abrir el despacho → **Tiempos reales** y **Cerrar despacho** |

Los vehículos Chevrolet N400 (1.5, bencina) y KYC X5 (1.5, bencina) vienen creados **sin** rendimiento ni costos. Puedes agregar todos los vehículos y clientes que necesites.

## Cómo se calcula

```
Combustible = km ÷ rendimiento (km/L) × precio por litro
Desgaste    = km × (neumáticos + mantención + depreciación + otros componentes) por km
Otros       = peajes + estacionamientos + conductor (horas) + horas extra
Total       = combustible + desgaste + otros
```

- **Costo real** (Control de costos) = cargas de combustible + gastos registrados + conductor modelado. Es normal que el real mensual supere al calculado: incluye todo el uso del vehículo, también fuera de los despachos, y compras puntuales como un juego de neumáticos. Para comparar con justicia se usa el costo por km.
- **KPIs de personal** usan solo las horas anotadas. Cada promedio indica entre cuántos datos se calculó.
  Preparación = fin − inicio de preparación; carga = fin − inicio de carga; tránsito = salida de un punto hasta la llegada al siguiente; entrega = fin − llegada al cliente; ruta completa = salida → regreso.
  Cumplimiento = entregas marcadas como entregadas ÷ programadas.
- **Cubicaje**: acomoda cajas en el espacio útil del vehículo (largo × ancho × alto) respetando si cada producto se puede apilar o girar, y controla también el peso. Un producto o vehículo sin medidas no se cubica.
- **Consolidación**: junta entregas pendientes a menos del radio configurado entre sí y revisa que quepan en un solo viaje; el ahorro se estima con distancias de Google ya consultadas.
- Las rutas con más de 25 paradas se dividen en despachos (límite de la Routes API). Google Maps admite 9 paradas intermedias por enlace, por eso el recorrido del conductor se parte en tramos que se encadenan.

## Respaldos

Desde **Configuración → Respaldo de datos**:

- **Respaldo completo (.db)**: copia de toda la base, incluida la API key de Google. Guárdalo en un lugar privado.
- **Datos en JSON**: todos los datos, sin la API key.
- **Elegir archivo de respaldo…**: restaura un `.db` o un `.json` (reemplaza todos los datos actuales).

BHUMI guarda además una copia interna automática en el navegador (como mucho una por hora) que usa si la base principal no se puede abrir.
Esa copia no reemplaza a tus respaldos: se borra junto con los datos del navegador.

## Probar sin Google (modo demostración)

Para recorrer todo el sistema antes de crear la API key ni pagar nada, haz doble clic en **`Abrir DEMO.html`**.
Arriba verás la etiqueta **Modo demostración**.

- Usa **clientes, entregas, conductores y vehículos de prueba** (no son datos de BHUMI), con 7 despachos históricos cuyas **horas, kilómetros, cargas de combustible y gastos son inventados** solo para mostrar los indicadores, y un **mapa simulado** (no es Google Maps).
- Las distancias y los tiempos son **simulados** (línea recta × 1,3, a 35 km/h). Sirven para ver cómo funciona el sistema, no para decidir costos reales.
- Solo se pueden ubicar las direcciones de prueba; una dirección nueva no se geolocaliza porque no hay Google.
- Todo vive en memoria: al cerrar la pestaña se borra y **nunca toca** tus datos reales.

## Para quien modifica el programa

Hace falta Node.js 22.13 o superior (https://nodejs.org). No se necesita para usar BHUMI, solo para cambiar el código y volver a armar el archivo que se abre con doble clic.

```bash
npm install            # una sola vez: baja las herramientas (sql.js, esbuild, ExcelJS, PDFKit…)
npm run construir      # arma dist/BHUMI con "Abrir BHUMI.html" y "Abrir DEMO.html"
npm test               # pruebas de la API completa
```

**Flujo de trabajo:** editas un archivo → `npm run construir` (tarda unos segundos) → abres `dist/BHUMI/Abrir DEMO.html` en el navegador y recargas.
Los archivos `Abrir …html` son autosuficientes: un cambio en `public/` o `server/` no se ve hasta volver a construir.
Los datos del navegador no se borran al reconstruir.

**Dónde está cada cosa**

| Si quieres cambiar… | Edita |
|---|---|
| Cómo se ve una pantalla (textos, tablas, botones) | `public/js/views/<sección>.js`; las pestañas de cada sección están en archivos con el mismo prefijo (`rutas-nueva.js`, `cubicaje-calculadora.js`…) |
| Colores, tamaños, estilos | `public/css/app.css` (los colores están al inicio como variables) |
| Menú y títulos de las secciones | `SECCIONES` en `public/js/app.js` |
| Piezas compartidas (tarjetas de indicador, pestañas, barra de período) | `public/js/componentes.js` y `public/js/lib.js` |
| Una fórmula o regla de negocio | `server/services/*.js` (por ejemplo `control-costos.js`, `tiempos.js`, `cubicaje.js`, `consolidacion.js`, `vehiculos-estado.js`) |
| Las rutas de la API (qué entrega cada pantalla) | `server/api.js` |
| Tablas y datos iniciales de la base | `server/db.js` (las columnas nuevas se agregan en `COLUMNAS_NUEVAS` para no perder datos ya guardados) |
| Los datos de ejemplo del modo demostración | `test/demo-datos.js` |

Reglas del proyecto que conviene respetar: solo datos reales (si falta un dato, el indicador queda en blanco y se explica qué falta), solo Google Maps para rutas, y la interfaz usa JavaScript simple sin compilación.
Cada pantalla es un archivo que exporta una función `async` y recibe `{ root, params, estado, navegar, refrescarEstado }`; se pinta con la plantilla `html`...`` de `lib.js`, que protege el texto automáticamente.

## Servidor central (varios equipos)

BHUMI también puede funcionar en un servidor para que varios computadores lo usen al mismo tiempo, con Docker, HTTPS automático y respaldo continuo.
La guía está en [docs/DESPLIEGUE.md](docs/DESPLIEGUE.md) y las variables de entorno en [.env.example](.env.example).
En el servidor cada persona entra con su correo y contraseña, y tiene uno de tres roles: Administrador, Planificador u Operador de bodega. El primer administrador se crea con `npm run crear-admin`, y desde ahí se agregan los demás en **Configuración → Usuarios**. La versión de doble clic no cambia: sigue sin inicio de sesión.

## Pruebas automáticas

```bash
npm test               # API completa sobre un servidor HTTP con Google simulado
npm run test:local     # la misma API atendida dentro del proceso, como en el navegador
npm run test:navegador # igual, con PDFKit, ExcelJS y EventEmitter de la versión de navegador
npm run test:wasm      # además, con SQLite compilado a WebAssembly (sql.js)
```

Conviene correr las cuatro después de tocar `server/`. Para probar sin Google, el modo `npm run demo` levanta el sistema en http://localhost:3100 con datos de ejemplo.

## Estructura

```
dist/BHUMI/        Lo que se arma con `npm run construir`:
  Abrir BHUMI.html   Se abre con doble clic (modo real). Trae el programa completo adentro
  Abrir DEMO.html    Modo demostración (también autosuficiente)
server/            API, base SQLite y servicios (control de costos, tiempos y KPI, zonas, vehículos y kilometraje, cubicaje, consolidación, panel, Google, planificador, reportes, respaldo)
navegador/         Lo que hace funcionar todo dentro del navegador: SQLite WebAssembly, enrutador, Google, almacenamiento, armado
public/            Interfaz (JavaScript sin dependencias de compilación)
test/              Pruebas automáticas y datos del modo demostración
```

## Importante

- Esta versión se probó con un Google simulado. La primera vez con tu clave, usa **Probar conexión** en Configuración → Google Maps y revisa que el mapa cargue.
- Cada llamada a Google se hace desde tu navegador con tu clave: mantenla fuera de capturas de pantalla y no compartas el respaldo `.db`.
- Los datos viven en un solo navegador de un solo computador. Para usar BHUMI desde dos equipos hay que pasar los datos con un respaldo.
