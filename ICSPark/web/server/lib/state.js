// Estado compartido entre los 4 servidores (mismo proceso Node).
// engineeringEnabled arranca en false; el SSRF interno lo activa.
module.exports = {
  engineeringEnabled: false,
};
