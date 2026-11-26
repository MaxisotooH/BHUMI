# Despliegue del servidor central de BHUMI

Este documento explica cómo dejar BHUMI en un servidor para que varios equipos lo usen a la vez, cada persona con su usuario y su rol.

## Qué se levanta

| Servicio | Qué hace |
|---|---|
| `app` | BHUMI (API + interfaz). La base SQLite vive en el volumen `datos`. |
| `caddy` | HTTPS automático con Let's Encrypt y encabezados de seguridad. Único servicio expuesto a internet (puertos 80 y 443). |
| `litestream` | Opcional (perfil `respaldo`). Copia la base de forma continua a un almacenamiento S3 y guarda 30 días de historial. |

## Requisitos

- Un servidor Linux con Docker y Docker Compose. Recomendado: 2 vCPU y 2 GB de RAM, en una región cercana a Chile (por ejemplo, GCP `southamerica-west1`, Santiago).
- Un dominio o subdominio, por ejemplo `bhumi.tuempresa.cl`, con un registro DNS tipo A que apunte a la IP del servidor.
- Dos claves de Google Maps (ver abajo).
- Opcional: un bucket compatible con S3 para Litestream (Cloudflare R2, Backblaze B2, AWS S3, etc.).

## Las dos claves de Google

En el servidor central, BHUMI usa dos claves distintas para que la que permite consultar rutas nunca llegue al navegador.

| Variable | Para qué se usa | Restricción de aplicación | APIs permitidas |
|---|---|---|---|
| `GOOGLE_SERVER_KEY` | Rutas, matrices de distancia y geocodificación, consultadas desde el servidor | Direcciones IP: la IP pública del servidor | Geocoding API y Routes API |
| `GOOGLE_BROWSER_KEY` | El mapa en pantalla | Sitios web: `https://bhumi.tuempresa.cl/*` | Maps JavaScript API |

Hay que definir las dos o ninguna. Si se define solo una, el servidor no arranca y explica el problema.
Con las claves definidas, la pestaña **Configuración → Google Maps** las muestra como "administradas por el servidor" y no deja cambiarlas.

Crea además un presupuesto con alerta de gasto en la facturación de Google Cloud.

## Primera instalación

```bash
git clone https://github.com/MaxisotooH/BHUMI.git
cd BHUMI
cp .env.example .env
nano .env                                   # completa DOMINIO y las claves

docker compose up -d --build                # sin respaldo continuo
# o bien
docker compose --profile respaldo up -d --build
```

Revisa que todo responda:

```bash
docker compose ps                           # app debe aparecer como "healthy"
curl https://bhumi.tuempresa.cl/api/salud   # {"ok":true,"version":"…"}
```

## Primer administrador

Recién instalado, BHUMI no tiene usuarios y nadie puede entrar; tampoco se pueden crear desde la página, para que un desconocido no se adueñe del sistema. El primer administrador se crea en el servidor (pide la contraseña sin mostrarla, mínimo 10 caracteres):

```bash
docker compose exec app npm run crear-admin -- --email ana@tuempresa.cl --nombre "Ana Pérez"
```

Desde ahí, el administrador crea al resto en **Configuración → Usuarios**.

| Rol | Qué puede hacer |
|---|---|
| Administrador | Todo, incluidos usuarios, Google, punto de partida y respaldo. |
| Planificador | Rutas, clientes, flota, costos, KPI, combustible, metas y personal. |
| Operador de bodega | Despachos y entregas del día, tiempos, km y cargas de combustible. No ve costos ni planifica rutas. |

Los permisos se revisan en el servidor en cada solicitud. Cada escritura queda registrada (quién, qué, cuándo y desde qué IP) en **Configuración → Usuarios → Actividad reciente**.

**Seguridad de las sesiones:** la sesión vence tras 12 horas sin uso y, en cualquier caso, a los 7 días. Tras 5 intentos fallidos, el inicio de sesión se bloquea 15 minutos para ese correo y para esa IP. Desactivar a un usuario o cambiarle la contraseña cierra sus sesiones de inmediato.

**Si un administrador olvida su contraseña**, otro administrador le asigna una nueva desde **Configuración → Usuarios**. Si no queda ninguno que pueda entrar:

```bash
docker compose exec app npm run crear-admin -- --email ana@tuempresa.cl --restablecer
```

## Pasar los datos actuales al servidor

Los datos de la versión de doble clic viven en el navegador del computador donde se usaba. En el servidor solo se puede restaurar el respaldo en **JSON**:

1. En el computador donde está BHUMI hoy, abre `Abrir BHUMI.html` y ve a **Configuración → Respaldo de datos → Datos en JSON**.
2. En el servidor nuevo, entra a BHUMI como administrador y ve a **Configuración → Respaldo de datos → Elegir archivo de respaldo…**. Elige ese archivo.

Restaurar reemplaza todos los datos de trabajo (clientes, flota, despachos, gastos, etc.), pero **no** toca los usuarios ni la auditoría: el JSON no los incluye.

El JSON no incluye la API key de Google, y no hace falta: en el servidor la definen las variables de entorno.

## Actualizar a una versión nueva

```bash
git pull
docker compose up -d --build                # agrega --profile respaldo si lo usas
```

La base queda intacta en el volumen `datos`, y las columnas nuevas se agregan solas al arrancar.

## Respaldos

- **Respaldo continuo (Litestream):** cada cambio se copia al bucket en segundos.

  **Recuperar la base en un servidor nuevo.** Hazlo **antes** de levantar `app`.
  - `--no-deps` evita que BHUMI arranque primero y cree una base vacía: si eso pasa, `restore` no escribe encima.
  - La restauración corre como `root` porque en un servidor nuevo el volumen recién creado pertenece a root. Al terminar, `chown` devuelve los archivos al usuario de BHUMI (uid 1000).

  ```bash
  docker compose --profile respaldo run --rm --no-deps --user root --entrypoint sh litestream -c \
    'litestream restore -if-replica-exists /datos/bhumi.db && chown -R 1000:1000 /datos'
  docker compose --profile respaldo up -d
  ```

  **Si BHUMI ya arrancó con una base vacía.** Pasa si alguien levantó la app antes de restaurar. En ese caso Litestream empezó a respaldar la base vacía en una *generación* nueva, y `restore` elige la más reciente, que es la vacía. Revisa las generaciones: la buena es la que tiene más historia (columnas `start` y `end`).

  ```bash
  docker compose --profile respaldo run --rm --no-deps litestream generations /datos/bhumi.db
  ```

  Después sigue los pasos de **Volver a un momento anterior**, cambiando `-timestamp …` por `-generation <id de la generación buena>`.

  **Volver a un momento anterior.** Sirve, por ejemplo, para deshacer una restauración equivocada.
  1. Detén BHUMI.
  2. Aparta la base actual. No se borra: queda en `/datos/anterior-<fecha>`.
  3. Restaura con la hora deseada, en UTC.

  ```bash
  docker compose --profile respaldo stop app litestream
  docker compose --profile respaldo run --rm --no-deps --user root --entrypoint sh litestream -c \
    'd=/datos/anterior-$(date +%Y%m%d-%H%M%S) && mkdir -p "$d" && mv /datos/bhumi.db* /datos/.bhumi.db-litestream "$d"/ 2>/dev/null; ls "$d"'
  docker compose --profile respaldo run --rm --no-deps --user root --entrypoint sh litestream -c \
    'litestream restore -timestamp 2026-11-20T15:00:00Z /datos/bhumi.db && chown -R 1000:1000 /datos'
  docker compose --profile respaldo up -d
  ```
- **Respaldo manual (solo Administrador):** en **Configuración → Respaldo de datos** se puede descargar el `.db` o el `.json` en cualquier momento.
  - El `.json` trae los datos de trabajo, sin usuarios.
  - El `.db` es la base completa: incluye los usuarios con sus contraseñas cifradas (scrypt, nunca en texto plano) y el registro de actividad. Guárdalo en un lugar privado.

## Sin Docker

```bash
npm ci --omit=dev
HOST=0.0.0.0 PORT=3000 DB_FILE=/ruta/bhumi.db GOOGLE_SERVER_KEY=… GOOGLE_BROWSER_KEY=… npm start
```

Sin variables, `npm start` funciona igual que antes: atiende solo en este equipo (`http://localhost:3000`) y usa `data/bhumi.db`.
