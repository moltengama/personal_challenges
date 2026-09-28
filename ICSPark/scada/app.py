"""
ICSPark SCADA/HMI — servicio interno de supervisión del PLC-09.

Solo alcanzable desde la red OT (contenedor web). Expone:
  * API v1 (documentada en Swagger, /apidocs): lectura de telemetría y mapa,
    e intentos de escritura que exigen rol engineering_manager.
  * API dev (NO documentada en Swagger): provisioning interno usado por
    herramientas de despliegue. El jugador debe enumerarla.
"""
import csv
import os
import secrets

from flasgger import Swagger
from flask import Flask, jsonify, request

import modbus_client as plc
import safety_client as sis

app = Flask(__name__)

# Spec servido en /openapi.json (lo consume el puente de ingeniería).
SWAGGER_CONFIG = {
    "headers": [],
    "specs": [
        {
            "endpoint": "apispec",
            "route": "/openapi.json",
            "rule_filter": lambda rule: True,
            "model_filter": lambda tag: True,
        }
    ],
    "static_url_path": "/flasgger_static",
    "swagger_ui": True,
    "specs_route": "/apidocs/",
    "title": "InGen SCADA — Park Operations API",
}
swagger = Swagger(app, config=SWAGGER_CONFIG)

# ── Estado en memoria (se reinicia con el contenedor -> challenge reseteable) ──
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")

# Usuarios de servicio. Semilla mínima; los operadores solo leen.
USERS: dict[str, dict] = {
    "hmi_operator": {"role": "operator", "token": "op-7f3a9c1e"},
}


def load_paddocks() -> list[dict]:
    rows = []
    with open(os.path.join(DATA_DIR, "plc_map.csv"), newline="", encoding="utf-8") as fh:
        for r in csv.DictReader(fh):
            r["coil"] = int(r["coil"])
            rows.append(r)
    return rows


PADDOCKS = load_paddocks()
COIL_TO_PADDOCK = {p["coil"]: p for p in PADDOCKS}


def _user_by_token(token: str | None) -> dict | None:
    if not token:
        return None
    for name, u in USERS.items():
        if u["token"] == token:
            return {"username": name, **u}
    return None


def _require_role(role: str):
    token = request.headers.get("X-Eng-Token")
    user = _user_by_token(token)
    if user is None:
        return None, (jsonify(error="token de servicio ausente o invalido"), 401)
    if user["role"] != role:
        return None, (
            jsonify(error=f"rol '{user['role']}' insuficiente; requiere '{role}'"),
            403,
        )
    return user, None


# ────────────────────────────── salud ──────────────────────────────
@app.get("/healthz")
def healthz():
    return jsonify(status="ok", service="scada")


# ═══════════════════════════════ API v1 ═══════════════════════════════
@app.get("/api/v1/paddocks")
def v1_paddocks():
    """Lista los paddocks del parque y su coil asociado en el PLC.
    ---
    tags: [operacion]
    responses:
      200:
        description: Inventario de paddocks
    """
    return jsonify(paddocks=PADDOCKS)


@app.get("/api/v1/plc/map")
def v1_plc_map():
    """Mapa PLC: relación coil -> paddock (referencia de operación).
    ---
    tags: [operacion]
    responses:
      200:
        description: Mapa de coils
    """
    return jsonify(unit=plc.SLAVE_ID, coils=COIL_TO_PADDOCK)


@app.get("/api/v1/doors")
def v1_doors():
    """Estado actual de las puertas (lectura de coils del PLC).
    ---
    tags: [operacion]
    responses:
      200:
        description: Estado de cada puerta (open=true/false)
      502:
        description: PLC inalcanzable
    """
    try:
        coils = plc.read_all_coils()
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=str(exc)), 502
    doors = []
    for p in PADDOCKS:
        doors.append(
            {
                "paddock_id": p["paddock_id"],
                "species": p["species"],
                "coil": p["coil"],
                "open": bool(coils[p["coil"]]),
            }
        )
    return jsonify(doors=doors)


@app.post("/api/v1/doors/<int:coil>/open")
def v1_door_open(coil: int):
    """Abrir una puerta de paddock (operación restringida).
    ---
    tags: [operacion]
    parameters:
      - in: path
        name: coil
        type: integer
        required: true
    responses:
      403:
        description: Requiere rol engineering_manager
    """
    # v1 no permite escritura de campo a operadores.
    return jsonify(error="requiere rol engineering_manager"), 403


# ═══════════════════ API dev / provisioning (interna) ═══════════════════
# Documentadas en el OpenAPI interno; protegidas solo por la segmentación
# de red (red OT). Pensadas para provisioning automatizado.

@app.get("/api/dev/users")
def dev_list_users():
    """Listar usuarios de servicio (provisioning).
    ---
    tags: [provisioning]
    responses:
      200:
        description: Usuarios de servicio
    """
    return jsonify(users=[{"username": n, "role": u["role"]} for n, u in USERS.items()])


@app.post("/api/dev/users")
def dev_create_user():
    """Crear un usuario de servicio con un rol dado.
    ---
    tags: [provisioning]
    parameters:
      - in: body
        name: body
        schema:
          type: object
          properties:
            username: { type: string }
            role: { type: string, example: engineering_manager }
    responses:
      201:
        description: Usuario creado (devuelve token de servicio)
    """
    # Provisioning interno: sin auth fuerte "porque es red aislada".
    body = request.get_json(silent=True) or {}
    username = body.get("username")
    role = body.get("role", "operator")
    if not username:
        return jsonify(error="'username' requerido"), 400
    if username in USERS:
        return jsonify(error="usuario ya existe"), 409
    token = "svc-" + secrets.token_hex(6)
    USERS[username] = {"role": role, "token": token}
    return jsonify(created=True, username=username, role=role, token=token), 201


@app.post("/api/dev/plc/write")
def dev_plc_write():
    """Escritura directa de un coil del PLC (requiere engineering_manager).
    ---
    tags: [provisioning]
    parameters:
      - in: header
        name: X-Eng-Token
        type: string
        required: true
      - in: body
        name: body
        schema:
          type: object
          properties:
            coil: { type: integer, example: 9 }
            value: { type: boolean, example: true }
    responses:
      200:
        description: Coil escrito
      403:
        description: Rol insuficiente
    """
    user, err = _require_role("engineering_manager")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    coil = body.get("coil")
    value = body.get("value")
    if coil is None or value is None:
        return jsonify(error="'coil' y 'value' requeridos"), 400
    try:
        coil = int(coil)
    except (TypeError, ValueError):
        return jsonify(error="'coil' invalido"), 400
    if not (0 <= coil < plc.NUM_COILS):
        return jsonify(error="coil fuera de rango"), 400
    try:
        plc.write_coil(coil, bool(value))
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=str(exc)), 502
    p = COIL_TO_PADDOCK.get(coil, {})
    return jsonify(
        ok=True,
        actor=user["username"],
        coil=coil,
        value=bool(value),
        paddock=p.get("paddock_id"),
        species=p.get("species"),
    )


# ══════════════════ API safety / SIS (mantenimiento) ══════════════════
# Interfaz de mantenimiento hacia el controlador de seguridad SIS-09.

@app.get("/api/dev/safety/status")
def dev_safety_status():
    """Estado del controlador de seguridad SIS-09.
    ---
    tags: [safety]
    parameters:
      - in: header
        name: X-Eng-Token
        type: string
        required: true
    responses:
      200:
        description: Estado del SIS (SIF armada, bypass, keyswitch)
      403:
        description: Rol insuficiente
    """
    user, err = _require_role("engineering_manager")
    if err:
        return err
    try:
        return jsonify(sis=sis.read_status())
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=str(exc)), 502


@app.post("/api/dev/safety/bypass")
def dev_safety_bypass():
    """Activar/desactivar el bypass de mantenimiento del SIS-09.
    ---
    tags: [safety]
    parameters:
      - in: header
        name: X-Eng-Token
        type: string
        required: true
      - in: body
        name: body
        schema:
          type: object
          properties:
            enabled: { type: boolean, example: true }
    responses:
      200:
        description: Estado del SIS tras la operación
      403:
        description: Rol insuficiente
    """
    user, err = _require_role("engineering_manager")
    if err:
        return err
    body = request.get_json(silent=True) or {}
    enabled = bool(body.get("enabled", False))
    try:
        sis.set_bypass(enabled)
        # El controlador de seguridad decide si respeta el bypass (keyswitch).
        return jsonify(actor=user["username"], requested=enabled, sis=sis.read_status())
    except Exception as exc:  # noqa: BLE001
        return jsonify(error=str(exc)), 502


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
