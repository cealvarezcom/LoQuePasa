# LoQuePasa

Sitio de noticias con panel de administración (Node.js + Express + SQLite).

## Probar en tu computador
1. Instala Node.js 22.13 o superior (la versión LTS sirve).
2. En esta carpeta: `npm install`
3. Inicia con tu propia contraseña:
   - Mac/Linux: `ADMIN_PASS="tu-clave" SECRET="una-frase-larga-y-secreta" npm start`
   - Windows (PowerShell): `$env:ADMIN_PASS="tu-clave"; $env:SECRET="una-frase-larga"; npm start`
4. Sitio: http://localhost:3000 — Panel: http://localhost:3000/admin.html (usuario `admin`)

## Publicarlo en la web
Necesitas un hosting que ejecute Node.js y conserve archivos en disco (Render, Railway, Fly.io o un VPS). Configura las variables `ADMIN_USER`, `ADMIN_PASS`, `SECRET` y, si el hosting ofrece disco persistente, `DB_PATH` y `UPLOADS_DIR` apuntando a él (ahí se guardan la base de datos y las fotos subidas). Comando de inicio: `npm start`.
