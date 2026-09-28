"""
ICSPark PLC — PLC-09 "Paddock Perimeter Controller"
Servidor Modbus TCP (pymodbus). Cada coil representa el comando de una puerta
de paddock. value=1 => puerta ABIERTA, value=0 => puerta CERRADA/BLOQUEADA.

Mapa de coils (ver scada/data/plc_map.csv):
    coil 0  -> PADDOCK-00  Reserva / mantenimiento
    coil 1  -> PADDOCK-01  Brachiosaurus
    coil 3  -> PADDOCK-03  Gallimimus
    coil 5  -> PADDOCK-05  Dilophosaurus
    coil 7  -> PADDOCK-07  Velociraptor
    coil 9  -> PADDOCK-09  Tyrannosaurus rex   <-- objetivo
    coil 12 -> PADDOCK-12  Triceratops
"""
import logging

from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.device import ModbusDeviceIdentification
from pymodbus.server import StartTcpServer

logging.basicConfig(level=logging.INFO, format="[PLC] %(asctime)s %(message)s")
log = logging.getLogger("plc")

NUM_COILS = 16


def build_context() -> ModbusServerContext:
    # Todas las puertas cerradas al arrancar (idempotente en cada reset).
    coils = ModbusSequentialDataBlock(0, [0] * (NUM_COILS + 1))
    discrete = ModbusSequentialDataBlock(0, [0] * (NUM_COILS + 1))
    holding = ModbusSequentialDataBlock(0, [0] * 16)
    inputreg = ModbusSequentialDataBlock(0, [0] * 16)

    slave = ModbusSlaveContext(
        di=discrete, co=coils, hr=holding, ir=inputreg, zero_mode=True
    )
    return ModbusServerContext(slaves={1: slave}, single=False)


def main() -> None:
    context = build_context()

    identity = ModbusDeviceIdentification()
    identity.VendorName = "InGen Systems"
    identity.ProductCode = "PLC-09"
    identity.VendorUrl = "https://ingen.local"
    identity.ProductName = "Paddock Perimeter Controller"
    identity.ModelName = "IGN-PLC-09"
    identity.MajorMinorRevision = "1.0"

    log.info("PLC-09 escuchando Modbus TCP en 0.0.0.0:502 (slave id 1, %d coils)", NUM_COILS)
    StartTcpServer(context=context, identity=identity, address=("0.0.0.0", 502))


if __name__ == "__main__":
    main()
