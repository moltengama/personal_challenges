const path = require("path");

module.exports = {
  PORTS: {
    auditors: 8081,
    visualizer: 8082,
    admin: 8083,
    engineering: 8084,
  },
  // El valor real llega SIEMPRE por variable de entorno (.env / compose).
  // Este placeholder evita filtrar la flag a través de la fuga de .git.
  FINAL_FLAG: process.env.FINAL_FLAG || "ICSPARK{flag_not_configured}",
  AUDITOR_USER: process.env.AUDITOR_USER || "auditor",
  AUDITOR_PASS: process.env.AUDITOR_PASS || "inGen2025",
  SCADA_BASE: `http://${process.env.SCADA_HOST || "scada"}:${
    process.env.SCADA_PORT || "5000"
  }`,
  // coil de la puerta del T-Rex (PADDOCK-09)
  TREX_COIL: 9,
  PUBLIC_DIR: path.join(__dirname, "public"),
};
