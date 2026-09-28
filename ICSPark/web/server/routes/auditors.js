const express = require("express");
const cookieParser = require("cookie-parser");
const path = require("path");
const fs = require("fs");
const swaggerUi = require("swagger-ui-express");
const YAML = require("yamljs");
const PDFDocument = require("pdfkit");

const config = require("../config");
const { deepMerge } = require("../lib/deepMerge");
const { login, requireAuth, getSession } = require("../lib/auth");

const REPORTS = [
  { id: "audit-summary", title: "Resumen de auditoría de seguridad del parque" },
  { id: "incident-log", title: "Registro de incidentes de contención" },
  { id: "power-grid", title: "Estado de la red eléctrica y perimetral" },
];

const SECTION_LABELS = {
  summary: "Resumen ejecutivo",
  findings: "Hallazgos",
  recommendations: "Recomendaciones",
};

const SECTION_BODY = {
  summary:
    "La auditoría evalúa la postura de seguridad de los sistemas de operación " +
    "del parque (contención perimetral, red OT y control de accesos).",
  findings:
    "Se identificaron desviaciones respecto a la línea base de seguridad " +
    "industrial en la segmentación de red y el control de la interfaz HMI.",
  recommendations:
    "Reforzar la segmentación entre la red corporativa y la red OT, y aplicar " +
    "control de acceso basado en roles en las interfaces de ingeniería.",
};

// Genera un PDF concreto del informe a partir de la plantilla ya combinada.
function buildReportPdf(report, template, username) {
  const color =
    (template.branding && typeof template.branding.color === "string"
      ? template.branding.color
      : "#0a7d55") || "#0a7d55";
  const footer =
    (template.branding && template.branding.footer) || "InGen — Isla Nublar";

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 54 });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Cabecera con color de marca
    doc.rect(0, 0, doc.page.width, 90).fill(color);
    doc.fillColor("#ffffff").fontSize(20).text("InGen — Jurassic Park", 54, 30);
    doc.fontSize(11).text("Informe de auditoría · Isla Nublar", 54, 58);

    doc.moveDown(3).fillColor("#111111").fontSize(16).text(report.title);
    doc.moveDown(0.5).fillColor("#555555").fontSize(10);
    doc.text(`ID: ${report.id}    Formato: ${template.format || "pdf"}`);
    doc.text(`Generado para: ${username}`);
    doc.text(`Fecha: ${new Date().toISOString()}`);
    if (template.watermark) {
      doc.moveDown(0.3).fillColor(color).fontSize(10).text(String(template.watermark));
    }

    doc.moveDown(1);
    const sections = template.sections || {};
    for (const key of ["summary", "findings", "recommendations"]) {
      if (!sections[key]) continue;
      doc.moveDown(0.6).fillColor(color).fontSize(13).text(SECTION_LABELS[key]);
      doc.moveDown(0.2).fillColor("#222222").fontSize(11).text(SECTION_BODY[key], {
        align: "justify",
      });
    }

    doc.fontSize(8).fillColor("#888888").text(footer, 54, doc.page.height - 60, {
      width: doc.page.width - 108,
      align: "center",
    });

    doc.end();
  });
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "auditors" }));

  // Swagger de la API pública
  const spec = YAML.load(path.join(__dirname, "..", "swagger", "public.yaml"));
  app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(spec));

  app.post("/api/login", (req, res) => {
    const { username, password } = req.body || {};
    const sid = login(username, password);
    if (!sid) return res.status(401).json({ error: "credenciales inválidas" });
    res.cookie("sid", sid, { httpOnly: true, sameSite: "lax", path: "/" });
    res.json({ ok: true, username });
  });

  app.post("/api/logout", (req, res) => {
    res.clearCookie("sid", { path: "/" });
    res.json({ ok: true });
  });

  app.get("/api/me", requireAuth, (req, res) => {
    res.json({ username: req.session.username, role: "auditor" });
  });

  app.get("/api/reports", requireAuth, (_req, res) => {
    res.json({ reports: REPORTS });
  });

  // Generación de informes: combina opciones del usuario con la plantilla
  // y produce un PDF descargable.
  app.post("/api/reports/download", requireAuth, async (req, res) => {
    const template = {
      format: "pdf",
      watermark: "CONFIDENTIAL",
      sections: { summary: true, findings: true, recommendations: false },
      branding: { color: "#0a7d55", footer: "InGen — Isla Nublar" },
    };
    const options = (req.body && req.body.options) || {};
    // <-- merge vulnerable: opciones anidadas del usuario sobre la plantilla
    deepMerge(template, options);

    const report =
      REPORTS.find((r) => r.id === (req.body && req.body.template)) || REPORTS[0];

    try {
      const pdf = await buildReportPdf(report, template, req.session.username);
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="${report.id}.pdf"`);
      res.send(pdf);
    } catch (e) {
      res.status(500).json({ error: "no se pudo generar el PDF" });
    }
  });

  // SPA de React (build estático). Fallback a index.html.
  if (fs.existsSync(config.PUBLIC_DIR)) {
    // dotfiles:'allow' expone /.git/ (fuga intencional del código fuente).
    app.use(express.static(config.PUBLIC_DIR, { dotfiles: "allow" }));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api")) return next();
      res.sendFile(path.join(config.PUBLIC_DIR, "index.html"));
    });
  }

  return app;
}

module.exports = { createApp };
