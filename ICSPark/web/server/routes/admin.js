const express = require("express");
const cookieParser = require("cookie-parser");
const { requireAdmin } = require("../lib/auth");

// Panel interno de administración del parque (entorno de pruebas).
// Solo accesible con rol 'administrator'. Incluye una herramienta de
// "Service Health / Report Preview" que hace fetch server-side de una URL.

function page(bodyHtml) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>InGen · Admin Console</title>
<style>
  :root{--bg:#0d1117;--card:#161b22;--fg:#e6edf3;--acc:#f0883e;--mut:#8b949e;--line:#30363d}
  body{margin:0;font-family:ui-monospace,Menlo,Consolas,monospace;background:var(--bg);color:var(--fg)}
  header{padding:14px 22px;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px}
  header b{color:var(--acc)} .tag{font-size:11px;color:#0d1117;background:var(--acc);padding:2px 8px;border-radius:10px}
  main{max-width:960px;margin:24px auto;padding:0 16px;display:grid;gap:18px}
  .card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:18px}
  h2{margin:0 0 10px;font-size:15px} .mut{color:var(--mut);font-size:13px;line-height:1.5}
  input,textarea{width:100%;box-sizing:border-box;background:#0d1117;color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:9px;font-family:inherit}
  button{margin-top:10px;background:var(--acc);color:#0d1117;border:0;border-radius:6px;padding:9px 16px;font-weight:700;cursor:pointer}
  pre{white-space:pre-wrap;word-break:break-all;background:#0d1117;border:1px solid var(--line);border-radius:6px;padding:12px;max-height:320px;overflow:auto;font-size:12px}
  code{color:var(--acc)} table{width:100%;border-collapse:collapse;font-size:13px}
  td{padding:6px 4px;border-bottom:1px solid var(--line)} .ok{color:#3fb950} .off{color:var(--mut)}
</style></head><body>
<header><b>■ InGen</b> Admin Console <span class="tag">ADMINISTRATOR</span></header>
<main>${bodyHtml}</main></body></html>`;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "admin" }));

  app.get("/", requireAdmin, (_req, res) => {
    res.type("html").send(
      page(`
      <div class="card">
        <h2>Estado del parque</h2>
        <table>
          <tr><td>Contención perimetral</td><td class="ok">NOMINAL</td></tr>
          <tr><td>Red OT · SCADA</td><td class="ok">ONLINE</td></tr>
          <tr><td>Red eléctrica</td><td class="ok">NOMINAL</td></tr>
          <tr><td>Consola de ingeniería</td><td class="off">OFFLINE</td></tr>
        </table>
      </div>

      <div class="card">
        <h2>Service Health / Report Preview</h2>
        <p class="mut">Comprueba la disponibilidad de un servicio interno o
        previsualiza un informe indicando su URL. La petición se realiza desde
        el servidor.</p>
        <input id="u" placeholder="URL del servicio interno">
        <button onclick="run()">Comprobar</button>
        <pre id="out">—</pre>
      </div>
      <script>
      async function run(){
        const url=document.getElementById('u').value;
        const out=document.getElementById('out'); out.textContent='...';
        try{
          const r=await fetch('/admin/preview',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({url})});
          const j=await r.json(); out.textContent=JSON.stringify(j,null,2);
        }catch(e){ out.textContent='error: '+e; }
      }
      </script>`)
    );
  });

  // SSRF: fetch server-side de una URL arbitraria (sin filtro de host).
  app.post("/admin/preview", requireAdmin, async (req, res) => {
    const url = (req.body && req.body.url) || "";
    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "url http(s) requerida" });
    }
    try {
      const r = await fetch(url, { method: "GET" });
      const text = await r.text();
      res.json({
        requested: url,
        status: r.status,
        contentType: r.headers.get("content-type"),
        body: text.slice(0, 4000),
      });
    } catch (e) {
      res.status(502).json({ error: String(e && e.message ? e.message : e) });
    }
  });

  return app;
}

module.exports = { createApp };
