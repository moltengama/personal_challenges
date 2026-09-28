"""Cliente Modbus TCP hacia el controlador de seguridad SIS-09."""
import os

from pymodbus.client import ModbusTcpClient

SAFETY_HOST = os.environ.get("SAFETY_HOST", "safety")
SAFETY_PORT = int(os.environ.get("SAFETY_PORT", "502"))
SLAVE_ID = 1

CO_SIF_ARMED = 0
CO_MAINT_BYPASS = 1
HR_KEYSWITCH = 0


def _client() -> ModbusTcpClient:
    return ModbusTcpClient(SAFETY_HOST, port=SAFETY_PORT, timeout=3)


def read_status() -> dict:
    c = _client()
    try:
        if not c.connect():
            raise ConnectionError("no se pudo conectar al SIS")
        coils = c.read_coils(0, count=2, slave=SLAVE_ID)
        hr = c.read_holding_registers(0, count=1, slave=SLAVE_ID)
        if coils.isError() or hr.isError():
            raise IOError("error Modbus leyendo el SIS")
        keysw = int(hr.registers[0])
        return {
            "controller": "SIS-09",
            "sif": "SIF-09",
            "sif_armed": bool(coils.bits[CO_SIF_ARMED]),
            "maint_bypass": bool(coils.bits[CO_MAINT_BYPASS]),
            "keyswitch": "PROGRAM" if keysw == 1 else "RUN",
        }
    finally:
        c.close()


def set_bypass(enabled: bool) -> None:
    c = _client()
    try:
        if not c.connect():
            raise ConnectionError("no se pudo conectar al SIS")
        rq = c.write_coil(CO_MAINT_BYPASS, bool(enabled), slave=SLAVE_ID)
        if rq.isError():
            raise IOError(f"error Modbus escribiendo bypass: {rq}")
    finally:
        c.close()
