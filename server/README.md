# Servidor multijugador de Strike Zone

Node.js ≥ 18, **cero dependencias** (WebSocket RFC 6455 implementado a mano). Un único proceso sirve:

- el juego (archivos estáticos de `dist/` si existe, si no la raíz del repo; gzip, ETag y caché),
- el WebSocket en `/ws` (protocolo en `../PROTOCOL.md`, incluida la sección «Cambios del servidor»),
- `GET /health`: JSON con salas, sesiones, bytes/s de salida, coste medio/máximo del tick y CPU.

## Ejecutar en local

```bash
node server/server.js            # http://localhost:8080  ·  ws://localhost:8080/ws
PORT=3000 LOBBY_BR=10 node server/server.js
```

Importante: si existe `dist/`, se sirve `dist/`. Tras cambiar el cliente (p. ej. `js/net/`), vuelve a generar `dist/`
(`python3 tools/build_dist.py`) o fuerza la raíz con `STATIC_DIR=. node server/server.js`.

## Prueba de carga

```bash
node server/test/loadtest.js            # 100 clientes BR + sala con bots + rondas 4v4
node server/test/loadtest.js 50 40      # N clientes, máx. segundos de BR
```
Arranca el servidor en un proceso hijo, abre N clientes WebSocket falsos que hacen cola, saltan del avión, se mueven,
disparan, se derriban/reaniman y terminan la partida, y comprueba mensajes (`start`, `snap`, `dmg`, `knock`, `kill`,
`revived`, `lootSpawn`, `squadOut`, `end`, `round`, `bought`, `credits`, `host`, `left`, `back`) y el anti-trampas.
Imprime ancho de banda por cliente y coste del tick.

## Variables de entorno

| Variable | Por defecto | Descripción |
|---|---|---|
| `PORT` | 8080 | Puerto HTTP/WS (Render/Railway/Fly lo inyectan) |
| `STATIC_DIR` | `dist/` o raíz | Carpeta de archivos estáticos |
| `TICK_HZ` | 15 | Frecuencia del tick y de snapshots cercanos |
| `LOBBY_BR` / `LOBBY_ROUNDS` | 30 / 15 | Cuenta atrás del lobby (s); empieza antes si se llena |
| `ROUND_BUY` / `ROUND_FIGHT` / `ROUND_END` | 10 / 100 / 4.5 | Tiempos del modo rondas (s) |
| `REJOIN_MS` | 30000 | Ventana para reconectar con `hello {rejoin}` |
| `HEARTBEAT_MS` | 30000 | Sin datos del cliente durante este tiempo → desconexión |
| `NEAR` / `FAR` | 150 / 350 | Radios de interés (m): 15 Hz / 5 Hz |
| `SNAP_BUDGET` | 32000 | Bytes/s por cliente; por encima se recortan snapshots lejanos y luego cercanos |
| `MSG_RATE` | 120 | Mensajes/s por cliente (ráfaga 2×); el exceso se descarta |
| `MAX_MSG` | 65536 | Tamaño máximo de un mensaje JSON (frames > 1 MB se rechazan siempre) |
| `MAX_CLIENTS` | 2000 | Conexiones simultáneas |
| `END_LINGER_MS` | 15000 | Tiempo que la sala sigue abierta tras `end` |
| `QUIET` | — | `1` = sin logs |

## Despliegue

El servidor necesita **una sola instancia** (las salas viven en memoria). Usa siempre `wss://` (HTTPS) desde el móvil.

### Render (web service gratuito)
1. Sube el repo a GitHub. En Render: **New → Web Service** → conecta el repo.
2. Runtime **Node**, *Root Directory* vacío, *Build Command* vacío (o `echo ok`), *Start Command* `node server/server.js`.
   (Alternativa: runtime **Docker** con *Dockerfile Path* `server/Dockerfile`.)
3. Plan **Free**. Health check path: `/health`. Render inyecta `PORT`.
4. El juego queda en `https://TU-APP.onrender.com` y el WS en `wss://TU-APP.onrender.com/ws`.
   Nota: el plan gratuito se duerme tras 15 min sin tráfico; la primera conexión tarda ~30 s en despertar.

### Railway
1. **New Project → Deploy from GitHub repo**.
2. En *Settings*: *Start Command* `node server/server.js` (o selecciona el Dockerfile `server/Dockerfile`
   con la variable `RAILWAY_DOCKERFILE_PATH=server/Dockerfile`).
3. *Networking → Generate Domain*. Railway inyecta `PORT`.

### Fly.io
```bash
fly launch --no-deploy --dockerfile server/Dockerfile   # crea fly.toml; internal_port = 8080
fly scale count 1                                       # una sola máquina (estado en memoria)
fly deploy
```
En `fly.toml` deja `internal_port = 8080`, `auto_stop_machines = false` si no quieres cortes, y añade un
check HTTP a `/health`.

### Docker / VPS
```bash
docker build -f server/Dockerfile -t strike-zone .
docker run -p 8080:8080 strike-zone
```
Detrás de nginx/Caddy, reenvía las cabeceras `Upgrade`/`Connection` para `/ws`.

## Límites conocidos
- Sin geometría del mundo en el servidor: no hay comprobación de línea de visión ni de colisiones; se valida
  velocidad, cadencia, alcance, daño máximo por distancia, estado del tirador y equipos.
- El inventario (munición, botiquines, armas recogidas del loot con semilla) lo lleva el cliente; el servidor
  valida tiempos mínimos de uso y créditos, no las existencias.
- Los bots dependen del host: si no queda ningún humano conectado, la sala se cierra tras `REJOIN_MS`.
- Un único proceso: para más de ~10 salas BR llenas a la vez, escalar con varias instancias y un balanceador
  por sala (no incluido).
