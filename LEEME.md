# Strike Zone: servidor multijugador

Esto es solo el servidor; el juego va en EdgeOne. No necesita instalar nada.

## Subir a GitHub
1. En GitHub crea un repositorio nuevo, por ejemplo `strike-zone-servidor`.
2. Pulsa **uploading an existing file**.
3. Arrastra **todo el contenido** de esta carpeta: `server`, `js`, `package.json` y `LEEME.md`.
4. Pulsa **Commit changes**.

## Desplegar en Render
1. Entra en render.com, luego **New + → Web Service**, y elige el repositorio.
2. Configúralo así:
   - Runtime: Node
   - Build Command: `echo ok`
   - Start Command: `npm start`
   - Plan: Free
   - Health Check Path: `/health`
3. Cuando aparezca **Live**, copia tu dirección, por ejemplo `https://strike-zone-servidor-xxxx.onrender.com`.
4. Para comprobar que funciona, abre esa dirección terminada en `/health`. Debe mostrar `{"ok":true,...}`.
