"""Cliente Modbus TCP hacia el PLC-09. Abre una conexión efímera por operación."""
import os

from pymodbus.client import ModbusTcpClient

PLC_HOST = os.environ.get("PLC_HOST", "plc")
PLC_PORT = int(os.environ.get("PLC_PORT", "502"))
SLAVE_ID = 1
NUM_COILS = 16


def _client() -> ModbusTcpClient:
    return ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=3)


def read_all_coils() -> list[int]:
    c = _client()
    try:
        if not c.connect():
            raise ConnectionError("no se pudo conectar al PLC")
        rr = c.read_coils(0, count=NUM_COILS, slave=SLAVE_ID)
        if rr.isError():
            raise IOError(f"error Modbus leyendo coils: {rr}")
        return [1 if b else 0 for b in rr.bits[:NUM_COILS]]
    finally:
        c.close()


def read_coil(coil: int) -> int:
    return read_all_coils()[coil]


def write_coil(coil: int, value: bool) -> None:
    c = _client()
    try:
        if not c.connect():
            raise ConnectionError("no se pudo conectar al PLC")
        rq = c.write_coil(coil, bool(value), slave=SLAVE_ID)
        if rq.isError():
            raise IOError(f"error Modbus escribiendo coil {coil}: {rq}")
    finally:
        c.close()
