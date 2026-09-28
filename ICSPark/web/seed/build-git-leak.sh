#!/bin/sh
# Genera un repositorio git a partir del código fuente de la app y publica su
# carpeta .git dentro del directorio estático servido por el puerto 8081.
# Esto materializa la "fuga de .git" que el jugador clona con git-dumper.
set -e

APP=/app
LEAK=/tmp/leak

rm -rf "$LEAK"
mkdir -p "$LEAK"

# Copiamos solo el código fuente (sin build, sin node_modules, sin secretos)
cp -r "$APP/server" "$LEAK/server"
cp -r "$APP/client" "$LEAK/client"
cp "$APP/package.json" "$LEAK/package.json"
cp "$APP/vite.config.js" "$LEAK/vite.config.js"
rm -rf "$LEAK/server/public"

cd "$LEAK"
git init -q
git config user.email "dev@ingen.local"
git config user.name "InGen Dev"
git add -A
git commit -q -m "portal auditores: generacion de informes con merge de opciones (plantilla + branding)"

# Publicar el .git en el directorio estatico (servido con dotfiles:allow)
mkdir -p "$APP/server/public"
rm -rf "$APP/server/public/.git"
cp -r "$LEAK/.git" "$APP/server/public/.git"
echo "[seed] .git publicado en server/public/.git"
