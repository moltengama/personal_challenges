const crypto = require("crypto");
const { AUDITOR_USER, AUDITOR_PASS } = require("../config");

// Sesiones en memoria (se reinician con el contenedor).
const sessions = new Map();

function login(username, password) {
  if (username === AUDITOR_USER && password === AUDITOR_PASS) {
    const sid = crypto.randomBytes(16).toString("hex");
    // NOTA: el objeto de sesión se crea SIN una propiedad 'role' propia.
    // El nivel de acceso se decide más adelante leyendo `acl.role`.
    sessions.set(sid, { username, loginAt: Date.now() });
    return sid;
  }
  return null;
}

function getSession(req) {
  const sid = req.cookies && req.cookies.sid;
  if (!sid) return null;
  return sessions.get(sid) || null;
}

function requireAuth(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: "no autenticado" });
  req.session = s;
  next();
}

// Comprobación de administrador. Crea un objeto ACL vacío y consulta su rol.
// Si Object.prototype fue contaminado (role='administrator'), el objeto vacío
// lo hereda y la comprobación pasa. El gadget correcto es 'role'.
function isAdministrator() {
  const acl = {};
  return acl.role === "administrator";
}

function requireAdmin(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: "no autenticado" });
  if (!isAdministrator()) {
    return res
      .status(403)
      .json({ error: "acceso restringido a administradores del parque" });
  }
  req.session = s;
  next();
}

module.exports = { login, getSession, requireAuth, requireAdmin, isAdministrator };
