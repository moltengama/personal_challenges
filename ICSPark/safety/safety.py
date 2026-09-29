"""
ICSPark Safety Controller — SIS-09 "Predator Paddock Safety Instrumented System"
Logic solver de seguridad independiente del BPCS (SCADA + PLC de proceso),
conforme al modelo de capas de IEC 61511.

SIF-09: "La puerta del recinto del T-Rex (PADDOCK-09 / coil 9 del PLC de
proceso) debe permanecer en estado seguro (CERRADA) mientras la función de
seguridad esté armada." Si el BPCS intenta abrirla, el SIS la lleva de vuelta
a estado seguro (de-energiza el actuador).

Mapa de registros del propio SIS (Modbus TCP, slave 1):
    coil 0    SIF_ARMED       (1 = función de seguridad armada)          [1]
    coil 1    MAINT_BYPASS    (1 = bypass de mantenimiento activo)       [0]
    hreg 0    KEYSWITCH       (0 = RUN/PROTEGIDO, 1 = PROGRAM)           [1]

Nota de ingeniería: el KEYSWITCH quedó en PROGRAM (modo mantenimiento). En RUN
el controlador ignora cualquier MAINT_BYPASS. En PROGRAM, un bypass escrito se
respeta y la SIF deja de actuar — igual que un Triconex dejado en PROGRAM.
https://www.youtube.com/watch?v=BtLSaxRnIhc
"""
import logging
import os
import threading
import time

from pymodbus.client import ModbusTcpClient
from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.device import ModbusDeviceIdentification
from pymodbus.server import StartTcpServer

logging.basicConfig(level=logging.INFO, format="[SIS] %(asctime)s %(message)s")
log = logging.getLogger("sis")

PLC_HOST = os.environ.get("PLC_HOST", "plc")
PLC_PORT = int(os.environ.get("PLC_PORT", "502"))
MONITORED_COIL = 9          # coil del PLC de proceso: puerta PADDOCK-09 (T-Rex)
SLAVE_ID = 1

# Índices en el datastore propio
CO_SIF_ARMED = 0
CO_MAINT_BYPASS = 1
HR_KEYSWITCH = 0
KEY_RUN, KEY_PROGRAM = 0, 1

# Códigos de función Modbus para el datastore
FC_READ_COILS = 1
FC_WRITE_COILS = 5
FC_READ_HREG = 3
FC_WRITE_HREG = 6


def build_context() -> ModbusServerContext:
    coils = ModbusSequentialDataBlock(0, [1, 0] + [0] * 14)      # SIF_ARMED=1, BYPASS=0
    holding = ModbusSequentialDataBlock(0, [KEY_PROGRAM] + [0] * 15)  # KEYSWITCH=PROGRAM
    discrete = ModbusSequentialDataBlock(0, [0] * 16)
    inputreg = ModbusSequentialDataBlock(0, [0] * 16)
    slave = ModbusSlaveContext(
        di=discrete, co=coils, hr=holding, ir=inputreg, zero_mode=True
    )
    return ModbusServerContext(slaves={1: slave}, single=False)


def safety_loop(context: ModbusServerContext) -> None:
    """Lazo de seguridad: fuerza el estado seguro de la puerta si la SIF actúa."""
    store = context[SLAVE_ID]
    time.sleep(2)  # deja arrancar el servidor
    while True:
        try:
            armed = bool(store.getValues(FC_READ_COILS, CO_SIF_ARMED, count=1)[0])
            bypass = bool(store.getValues(FC_READ_COILS, CO_MAINT_BYPASS, count=1)[0])
            keysw = int(store.getValues(FC_READ_HREG, HR_KEYSWITCH, count=1)[0])

            # En RUN el controlador no acepta bypass: lo resetea.
            if keysw != KEY_PROGRAM and bypass:
                store.setValues(FC_WRITE_COILS, CO_MAINT_BYPASS, [0])
                bypass = False

            # La SIF actúa si está armada y NO hay bypass válido (keyswitch en PROGRAM).
            sif_active = armed and not (keysw == KEY_PROGRAM and bypass)

            if sif_active:
                c = ModbusTcpClient(PLC_HOST, port=PLC_PORT, timeout=2)
                try:
                    if c.connect():
                        rr = c.read_coils(MONITORED_COIL, count=1, slave=SLAVE_ID)
                        if not rr.isError() and rr.bits and rr.bits[0]:
                            # Puerta abierta con SIF armada -> TRIP a estado seguro
                            c.write_coil(MONITORED_COIL, False, slave=SLAVE_ID)
                            log.info("SIF-09 TRIP: puerta PADDOCK-09 forzada a CERRADA")
                finally:
                    c.close()
        except Exception as exc:  # noqa: BLE001
            log.warning("lazo de seguridad: %s", exc)
        time.sleep(1)


def main() -> None:
    context = build_context()
    threading.Thread(target=safety_loop, args=(context,), daemon=True).start()

    identity = ModbusDeviceIdentification()
    identity.VendorName = "InGen Safety Systems"
    identity.ProductCode = "SIS-09"
    identity.ProductName = "Predator Paddock Safety Controller"
    identity.ModelName = "IGN-SIS-09"
    identity.MajorMinorRevision = "1.0"

    log.info("SIS-09 escuchando Modbus TCP en 0.0.0.0:502 · SIF-09 ARMADA · KEYSWITCH=PROGRAM")
    StartTcpServer(context=context, identity=identity, address=("0.0.0.0", 502))


if __name__ == "__main__":
    main()
