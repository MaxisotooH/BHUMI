# Piloto de BHUMI en el servidor central

Una semana de uso real con datos de la empresa, antes de dejar la versión de doble clic.
La instalación técnica está en [DESPLIEGUE.md](DESPLIEGUE.md); esta guía cubre qué decidir, qué revisar y cómo saber si el piloto salió bien.

## 1. Lo que hay que decidir y contratar (lo hace la empresa)

| Qué | Recomendación | Notas |
|---|---|---|
| Servidor | Un servidor virtual Linux con 2 vCPU y 2 GB de RAM, en una región cercana (por ejemplo, Santiago) | Cualquier proveedor que permita Docker. Revisa los precios vigentes del proveedor. |
| Dominio | Un subdominio, por ejemplo `bhumi.tuempresa.cl` | Debe apuntar a la IP del servidor (registro DNS tipo A) antes de levantar Caddy. |
| Google Maps | Las dos claves: servidor y mapa (ver [DESPLIEGUE.md](DESPLIEGUE.md#las-dos-claves-de-google)) | Activa un **presupuesto con alerta de gasto** en Google Cloud. |
| Respaldo continuo | Un bucket compatible con S3 (Cloudflare R2, Backblaze B2, AWS S3…) | Opcional, pero muy recomendado desde el primer día. |
| Responsable del piloto | Una persona que revise la "Actividad reciente" cada día y junte los comentarios | Idealmente quien será Administrador. |

## 2. Antes del primer día

- [ ] Servidor instalado según [DESPLIEGUE.md](DESPLIEGUE.md), con `docker compose --profile respaldo up -d --build`.
- [ ] `https://bhumi.tuempresa.cl/api/salud` responde `{"ok":true,…}` y el navegador muestra el candado (HTTPS).
- [ ] Primer administrador creado con `docker compose exec app npm run crear-admin -- --email … --nombre "…"`.
- [ ] Datos actuales migrados: **Respaldo JSON** desde la versión de doble clic → **Configuración → Respaldo de datos** en el servidor.
- [ ] Revisar que los datos llegaron: clientes, vehículos, despachos recientes, precios de combustible.
- [ ] Usuarios creados en **Configuración → Usuarios**, cada uno con su rol:
  - Administrador: quien configura y respalda.
  - Planificador: quien arma las rutas y controla costos.
  - Operador de bodega: quien prepara, carga y despacha.
- [ ] Cada persona entra una vez y cambia su contraseña desde su menú (arriba a la derecha).
- [ ] Bodega abre BHUMI en el celular o la tablet del andén y deja la página **Hoy** como acceso directo en la pantalla de inicio.

### Prueba de humo (30 minutos, con dos personas)

- [ ] El Planificador crea un despacho para hoy; Bodega lo ve aparecer en **Hoy** sin recargar.
- [ ] Bodega marca "Empieza la preparación" con un toque; el Planificador ve la hora en el detalle del despacho.
- [ ] Los dos abren el mismo vehículo y guardan un cambio distinto: el segundo recibe el aviso de conflicto con el nombre del primero.
- [ ] El punto verde junto al nombre (arriba a la derecha) está encendido en los dos equipos.
- [ ] Reiniciar la aplicación (`docker compose restart app`) con la página abierta: el punto se apaga y vuelve a encenderse solo en menos de un minuto. **Esto no se pudo probar en desarrollo detrás de Caddy**; confírmalo aquí.
- [ ] Bodega no ve montos en pesos en ninguna pantalla, ni los botones de agregar o editar vehículos, clientes o productos.
- [ ] Descargar un respaldo (`.json`) desde **Configuración → Respaldo de datos** y guardarlo fuera del servidor.

## 3. Durante la semana

**Cada día (10 minutos, el responsable):**
- Revisar **Configuración → Usuarios → Actividad reciente**: intentos fallidos de inicio de sesión, errores (resultado en rojo), quién está usando el sistema.
- Preguntar a cada rol si algo le estorbó o le faltó.
- Si el respaldo continuo no está activo, descargar el respaldo del día.

**Qué observar:**
- ¿Los costos y kilómetros de las rutas coinciden con lo que se gasta de verdad?
- ¿Bodega anota las horas en el momento? ¿Le resulta cómodo en el celular?
- ¿Aparecen avisos de conflicto? ¿Se entienden?
- ¿Alguien quedó sin poder entrar o vio un mensaje de error?

**Cómo reportar un problema:** una captura de pantalla, la hora aproximada, el usuario y qué estaba haciendo. Con la hora y el usuario se encuentra en la Actividad reciente.

## 4. Si algo sale mal

- **Un error puntual:** anotarlo como se explica arriba y seguir.
- **El servidor no responde:** `docker compose ps` y `docker compose logs app --tail 100` en el servidor.
- **Hay que volver atrás:** la versión de doble clic sigue funcionando. Exporta el respaldo JSON del servidor y restáuralo en ella desde **Configuración → Respaldo de datos**. Las contraseñas y la auditoría no viajan en el JSON, porque esa versión no las usa.
- **Datos borrados por error:** recuperar desde el respaldo continuo con el procedimiento de [DESPLIEGUE.md](DESPLIEGUE.md#respaldos), incluido "volver a un momento anterior".

## 5. ¿Salió bien? Criterios para cerrar el piloto

- [ ] Durante la semana, todos los despachos se planificaron y cerraron en el servidor, sin volver a la versión de doble clic.
- [ ] Bodega anotó las horas de al menos la mayoría de los despachos.
- [ ] No hubo pérdidas de datos ni cambios pisados entre personas.
- [ ] Ningún rol pudo ver o hacer algo que no le correspondía.
- [ ] El respaldo se pudo descargar y, en una prueba aparte, restaurar.

Con el piloto aprobado, la versión de doble clic queda solo para el modo demostración. Lo que se aprenda en esta semana define las prioridades siguientes, por ejemplo la Fase 5: PostgreSQL y PostGIS, si hace falta más de un servidor o consultas geográficas.
