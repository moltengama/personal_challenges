# ICSPark — Plan de desarrollo del challenge CTF

**Categoría:** Web + OT/ICS (mixto)
**Ambientación:** Jurassic Park — el jugador es un auditor externo que debe comprometer la cadena de mando industrial del parque hasta abrir la puerta del paddock del *Tyrannosaurus rex*.
**Dificultad:** Alta. No hay defensas débiles ni fuerza bruta; se exige entender la arquitectura y encadenar 5–6 primitivas específicas.

---

## 1. Narrativa y objetivo

InGen contrató una auditoría del "Park Operations Portal". El sistema real que controla las jaulas (paddocks) está aislado en una red OT. El jugador entra por el portal público de auditores y debe pivotar, escalar y llegar hasta el PLC que gobierna la puerta del recinto del T-Rex.

**Objetivo final:** enviar el comando OT que abre la puerta `PADDOCK-09 (T-Rex)`. Al abrirse, el visualizador (puerto 2) reproduce una animación de la puerta abriéndose y el T-Rex saliendo, y se revela la flag final.

---

## 2. Arquitectura — 4 contenedores

```
                         ┌──────────────────────────────────────────────┐
   Jugador (Internet)    │                 red-dmz                       │
        │                │  ┌────────────────────────────────────────┐  │
        ▼                │  │  CONTENEDOR 1: web                       │  │
   :8081 auditores  ─────┼─▶│  Node 20 (Express) + React (build)       │  │
   :8082 visualizador ───┼─▶│  Swagger UI, .git expuesto (trampa)      │  │
   :8083 web interna ────┼─▶│  :8084 web ingeniería (INICIA DESHABIL.) │  │
                         │  └───────────────┬──────────────────────────┘  │
                         │                  │ (solo red interna)           │
                         │        red-ot ───┼───────────────────────────   │
                         │  ┌───────────────▼──────────────────────────┐  │
                         │  │  CONTENEDOR 2: scada (HMI)               │  │
                         │  │  Python Flask + Swagger, cliente Modbus  │  │
                         │  │  API limitada (pública interna) + API    │  │
                         │  │  dev (oculta) que habla al PLC           │  │
                         │  └───────────────┬──────────────────────────┘  │
                         │        red-plc ──┼───────────────────────────   │
                         │  ┌───────────────▼──────────────┬───────────┐  │
                         │  │  CONTENEDOR 3: plc (proceso) │ CONT. 4:  │  │
                         │  │  pymodbus TCP :502           │ safety    │  │
                         │  │  Coils = puertas de paddocks │ SIS-09    │  │
                         │  │            ▲                 │ (SIF-09)  │  │
                         │  │            └── trip a seguro ─┤ vigila    │  │
                         │  │                              │ coil 9    │  │
                         │  └──────────────────────────────┴───────────┘  │
                         └──────────────────────────────────────────────┘
```

### Segmentación de red (clave del diseño)
- `red-dmz`: expuesta al jugador. Solo `web` está publicada.
- `red-ot`: `web` ↔ `scada`. El jugador **no** llega a `scada` directamente; solo vía SSRF/pivot desde `web`.
- `red-plc`: `scada` ↔ `plc` ↔ `safety`. Ni el PLC ni el SIS son alcanzables desde fuera de `scada`.

### Capa de seguridad (SIS) — independiente del BPCS (IEC 61511)
- `safety` (SIS-09) es un **logic solver separado**. Implementa la **SIF-09**: la puerta del T-Rex (coil 9) debe permanecer CERRADA mientras la función esté armada.
- Un lazo de seguridad lee continuamente el coil 9 del PLC de proceso y, si lo encuentra abierto con la SIF armada, lo **fuerza a estado seguro** (*trip*).
- Solo un **bypass de mantenimiento** válido lo desactiva. El SIS respeta el bypass únicamente si su **keyswitch está en PROGRAM** (quedó así por mala configuración — vector estilo TRITON/TRISIS); en RUN, el controlador ignora/resetea cualquier bypass.

Esta separación es la razón de que cada primitiva sea obligatoria: sin SSRF no hay ruta a `scada`; sin habilitar ingeniería no hay APIs dev; sin las APIs dev no hay Modbus al PLC; y **sin bypass del SIS la puerta del T-Rex se vuelve a cerrar sola**.

---

## 3. Mapa de puertos

| Puerto | Contenedor | Rol | Estado inicial |
|--------|-----------|-----|----------------|
| 8081 | web | Portal público de auditores (React) | Abierto |
| 8082 | web | Visualizador de puertas del paddock (animación) | Abierto (solo lectura) |
| 8083 | web | Web interna de administrador / entorno de pruebas | Abierto pero requiere rol `administrator` |
| 8084 | web | **Web de ingeniería** | **Deshabilitado** — responde 503 hasta activarse |
| 5000 | scada | HMI + API Swagger (solo red-ot) | Interno |
| 502  | plc | Modbus TCP · PLC de proceso (solo red-plc) | Interno |
| 502  | safety | Modbus TCP · SIS-09 / SIF-09 (solo red-plc) | Interno |

> El puerto 8084 escucha siempre, pero su router comprueba un flag (`/run/engineering.enabled`). Mientras no exista, devuelve `503 Engineering console offline`. El SSRF crea ese flag → "el puerto se abre".

---

## 4. Cadena de ataque (paso a paso, con implementación concreta)

### Etapa 0 — Recon del portal de auditores (:8081)
- React SPA. Consume `/api/*` documentada en **Swagger** (`:8081/api/docs`).
- Pista sutil: cabecera `X-Sourcemap` o comentario en el bundle apuntando a rutas del repo.

### Etapa 1 — `.git` expuesto → fuga de código fuente
- El build deja `/.git` accesible en `:8081/.git/` (config de Nginx/Express mal hecha *a propósito*, pero realista).
- El jugador clona con `git-dumper`. En el historial encuentra el backend de la **descarga de informes**, revelando la primitiva de prototype pollution.

### Etapa 2 — Prototype Pollution → impersonar `administrator`
- Endpoint `POST /api/reports/download` recibe opciones JSON del informe (formato, filtros, branding) y hace un **merge recursivo** sobre un objeto de configuración compartido por request (deepMerge casero vulnerable, sin filtrar `__proto__`/`constructor`).
- El chequeo de autorización lee `ctx.user.role`. Al contaminar el prototipo:
  ```json
  { "template": "pdf", "options": { "__proto__": { "role": "administrator" } } }
  ```
  el objeto `user` (creado sin la propiedad `role` propia para los auditores) hereda `role: "administrator"` en el mismo proceso/request, desbloqueando `:8083`.
- Debe ser **específico**: el pollution solo escala si además se entiende que la sesión se rehidrata desde un objeto plano. Un `isAdmin=true` genérico NO funciona (el gadget correcto es `role`), obligando a leer el código de la Etapa 1.

### Etapa 3 — SSRF en el panel admin → habilitar la web de ingeniería
- En `:8083` (ya como admin) hay un módulo "Service Health / Report Preview" que hace fetch server-side de una URL que el usuario indica (para previsualizar informes de servicios internos).
- Sin filtro de host → **SSRF**. El jugador descubre (por Swagger interno / mensajes de error) el endpoint interno:
  ```
  http://127.0.0.1:8084/internal/engineering/enable
  ```
  que solo acepta conexiones desde `127.0.0.1`/red interna y crea el flag `engineering.enabled`.
- Resultado: `:8084` pasa de `503` a operativo. **Se "abre" un nuevo puerto en el contenedor web.**

### Etapa 4 — Web de ingeniería (:8084) → acceso al SCADA/HMI
- `:8084` es un proxy/consola hacia el HMI del `scada` (`red-ot`). Expone las **APIs limitadas** del SCADA vía su propio Swagger (`:8084/eng/docs`): leer telemetría, ver lista de paddocks, estado de puertas (solo lectura).
- Las operaciones de escritura devuelven `403 requires role engineering_manager`.

### Etapa 5 — Enumeración de APIs dev del SCADA
- El Swagger del SCADA expone solo endpoints "operación". Pero el código/errores/patrón de rutas revela un **grupo `/dev/*`** no documentado (versionado: `/api/v1/*` público, `/api/dev/*` interno).
- Entre ellos: `POST /api/dev/users` (alta de usuarios de servicio) y `POST /api/dev/plc/write` (escritura Modbus directa).

### Etapa 6 — Crear usuario `engineering_manager`
- `POST /api/dev/users` permite crear un usuario con rol `engineering_manager` (pensado para provisioning automatizado, sin auth fuerte porque "es red interna"). El jugador se autofabrica las credenciales que le faltan.

### Etapa 7 — Manipular el PLC de proceso
- Con el rol `engineering_manager`, `POST /api/dev/plc/write` traduce a Modbus y escribe en el `plc` (coil 9 = puerta PADDOCK-09 del T-Rex). El mapa de coils se filtra en el HMI (`plc_map.csv`) para no abrir la jaula equivocada.
- **Pero la puerta se vuelve a cerrar sola:** el SIS-09 detecta el coil 9 abierto con la SIF armada y lo lleva a estado seguro (*trip*). El jugador debe entender que hay una **capa de seguridad independiente** enclavando la acción.

### Etapa 8 — Bypass del SIS (estilo TRITON/TRISIS) → abrir la puerta
- El jugador descubre en el OpenAPI interno los endpoints de safety: `GET /api/dev/safety/status` y `POST /api/dev/safety/bypass`.
- `status` revela: `sif_armed=true`, `maint_bypass=false`, `keyswitch=PROGRAM`. El keyswitch en PROGRAM (mala configuración real) permite que un bypass de mantenimiento sea respetado por el controlador.
- `POST /api/dev/safety/bypass {"enabled":true}` → escribe el coil `MAINT_BYPASS` del SIS. Con keyswitch en PROGRAM el controlador lo respeta y la **SIF-09 deja de actuar**.
- Ahora `POST /api/dev/plc/write {"coil":9,"value":true}` **permanece**: la puerta queda abierta.
- El visualizador (`:8082`) detecta el coil 9 abierto y **reproduce la animación** del actuador + revela la **flag final** `ICSPARK{cl3v3r_g1rl_th3_r3x_1s_l00se}`.

---

## 5. Flag (única)

Hay **una sola flag**, la final. Se revela **únicamente** cuando la puerta del paddock del T-Rex (coil 9) se abre, en el visualizador (`:8082`), junto con la animación.

| Etapa | Ubicación | Valor |
|-------|-----------|-------|
| ⭐ abrir puerta T-Rex | visualizador `:8082` | `ICSPARK{cl3v3r_g1rl_th3_r3x_1s_l00se}` |

Las demás etapas no entregan flag; solo desbloquean la siguiente primitiva (progreso implícito).

---

## 6. Estructura de directorios

```
ICSPark/
├── PLAN.md
├── docker-compose.yml
├── .env.example
├── web/
│   ├── Dockerfile              # multi-stage: build React -> runtime node alpine
│   ├── package.json
│   ├── server/
│   │   ├── index.js            # arranca 8081/8082/8083/8084
│   │   ├── routes/auditors.js  # portal público
│   │   ├── routes/reports.js   # <-- prototype pollution (deepMerge)
│   │   ├── routes/admin.js     # dashboard + SSRF (report preview)
│   │   ├── routes/engineering.js # 8084, gated por flag + proxy a scada
│   │   ├── routes/visualizer.js  # 8082, sirve animación + estado puerta
│   │   ├── lib/deepMerge.js    # merge vulnerable
│   │   ├── lib/auth.js         # rehidratación de user (gadget: role)
│   │   └── swagger/*.yaml
│   ├── client/                 # React (Vite)
│   └── seed/.git-seed/         # historial preparado con la fuga
├── scada/
│   ├── Dockerfile              # python:3.12-alpine
│   ├── app.py                  # Flask + flasgger: v1 + dev + safety
│   ├── modbus_client.py        # pymodbus client -> plc:502
│   ├── safety_client.py        # pymodbus client -> safety:502 (SIS)
│   └── data/plc_map.csv        # mapa de coils (se filtra al HMI)
├── plc/
│   ├── Dockerfile              # python:3.12-alpine
│   └── plc.py                  # pymodbus server, coils = puertas
└── safety/
    ├── Dockerfile              # python:3.12-alpine
    └── safety.py               # SIS-09: servidor Modbus + lazo SIF-09
```

---

## 7. Optimización de recursos (contenedores)

- **Imágenes base ligeras:** `node:20-alpine`, `python:3.12-alpine`.
- **Multi-stage build en `web`:** etapa `builder` compila React; la imagen final solo lleva `node_modules` de producción + build estático. Sin toolchain en runtime.
- **Un solo proceso Node** sirviendo los 4 puertos (no 4 procesos ni 4 contenedores) — comparte event loop y memoria.
- **pymodbus** en vez de OpenPLC para el PLC: ~20–30 MB RAM vs. cientos.
- **Límites en `docker-compose.yml`:**
  ```yaml
  deploy:
    resources:
      limits:   { cpus: "0.50", memory: "256M" }   # web
      # scada:  { cpus: "0.30", memory: "128M" }
      # plc:    { cpus: "0.20", memory: "64M"  }
      # safety: { cpus: "0.15", memory: "64M"  }
  ```
- `restart: unless-stopped`, healthchecks ligeros (curl al `/healthz`), logging con `max-size: 10m`.
- Sin volúmenes de datos persistentes (el estado del PLC se reinicia con el contenedor → challenge idempotente y reseteable).
- **Reset del challenge:** `docker compose restart` devuelve puertas a cerradas, rearma la SIF-09 (bypass a 0), deshabilita la web de ingeniería y borra el usuario `engineering_manager` (estado en memoria).

**Footprint total estimado:** ~550 MB RAM, ~1.15 CPU (límites). En reposo consume mucho menos; corre en una VM de 1 vCPU / 1 GB.

---

## 8. Fases de desarrollo (orden de construcción)

1. **F1 — Esqueleto & compose:** 3 Dockerfiles, `docker-compose.yml` con las 3 redes, healthchecks. Verificar segmentación (web no ve plc, jugador no ve scada).
2. **F2 — PLC:** `pymodbus` con coils de puertas + `plc_map.csv`. Test con `mbpoll`.
3. **F3 — SCADA:** Flask + Swagger, `modbus_client`, APIs v1 (lectura) y dev (users + plc/write). Test lectura/escritura de coils.
4. **F4 — Web base:** React portal + Express 8081, Swagger público, `.git` sembrado.
5. **F5 — Vuln 1 (proto pollution):** `deepMerge` + `auth.js`, dashboard 8083 gated por `role`.
6. **F6 — Vuln 2 (SSRF):** report-preview en 8083 → endpoint interno enable en 8084.
7. **F7 — Ingeniería (8084):** gating por flag + proxy a scada, Swagger eng.
8. **F8 — Visualizador (8082):** animación (CSS/canvas o SVG del T-Rex) con polling del estado real de la puerta.
9. **F9 — Endurecimiento:** cerrar rutas no intencionadas, cabeceras, mensajes de error calibrados (dar pistas sin regalar), rate-limit suave.
10. **F10 — Playtest & writeup:** resolver end-to-end, medir tiempo, escribir solución oficial y guía del setup.

---

## 9. Decisiones tomadas por defecto (ajustables)

- **Stack SCADA:** Python/Flask (más idiomático para OT y `pymodbus`) en vez de Node.
- **PLC:** `pymodbus` sobre Modbus TCP (protocolo OT real y didáctico) en vez de OPC-UA/S7 (más pesados).
- **Gadget de pollution:** propiedad `role` (no `isAdmin`) para forzar lectura del fuente.
- **Animación T-Rex:** SVG/CSS animado servido en 8082 (sin dependencias pesadas); alternativa: sprite/GIF.
- **Flags:** milestones intermedios + 1 flag final.

Dime si quieres cambiar alguna de estas y arranco por la **Fase 1** (esqueleto + docker-compose).
```
