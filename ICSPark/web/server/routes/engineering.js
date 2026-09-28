const express = require("express");
const cookieParser = require("cookie-parser");
const config = require("../config");
const state = require("../lib/state");

// Web de ingeniería (puerto 8084).
//  - Arranca DESHABILITADA: '/', '/eng/*' devuelven 503 hasta habilitarse.
//  - Se habilita vía GET /internal/engineering/enable, aceptado SOLO desde
//    loopback (127.0.0.1): alcanzable únicamente por SSRF desde el servidor.
//  - Habilitado -> proxy /eng/api/* -> SCADA (red OT) y documentación
//    OpenAPI del SCADA en /eng/openapi.

function isLoopback(req) {
  const ip = req.socket.remoteAddress || "";
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function consolePage() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>InGen · Engineering Console</title>
<style>
  body{margin:0;font-family:ui-monospace,Consolas,monospace;background:#07120e;color:#c9f2dd}
  header{padding:14px 22px;border-bottom:1px solid #163d2c} header b{color:#39d98a}
  main{max-width:920px;margin:24px auto;padding:0 16px}
  .card{background:#0b1f17;border:1px solid #163d2c;border-radius:10px;padding:18px;margin-bottom:16px}
  h3{margin:0 0 12px;font-size:14px} code{color:#39d98a}
  input,textarea{background:#07120e;color:#c9f2dd;border:1px solid #163d2c;border-radius:6px;padding:8px;font-family:inherit}
  button{background:#39d98a;color:#07120e;border:0;border-radius:6px;padding:8px 14px;font-weight:700;cursor:pointer}
  pre{white-space:pre-wrap;word-break:break-all;background:#07120e;border:1px solid #163d2c;border-radius:6px;padding:12px;max-height:360px;overflow:auto;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  td{padding:5px 6px;border-bottom:1px solid #163d2c;cursor:pointer}
  td:hover{background:#0e2a1e} .m{color:#e8b73a;width:60px}
</style></head><body>
<header><b>▲ InGen Engineering</b> — OT Console (SCADA bridge)</header>
<main>
  <div class="card">
    <h3>API SCADA (OpenAPI)</h3>
    <table id="api"><tbody><tr><td colspan="2">cargando…</td></tr></tbody></table>
  </div>
  <div class="card">
    <h3>Consola de peticiones · /eng/api</h3>
    <div style="display:flex;gap:8px;margin-bottom:8px">
      <input id="m" value="GET" style="width:80px">
      <input id="p" value="/v1/doors" style="flex:1">
    </div>
    <input id="t" placeholder="X-Eng-Token" style="width:100%;box-sizing:border-box;margin-bottom:8px">
    <textarea id="b" rows="3" placeholder="cuerpo JSON (POST)" style="width:100%;box-sizing:border-box"></textarea>
    <button onclick="go()">Enviar</button>
    <pre id="out">—</pre>
  </div>
  <script>
  async function loadApi(){
    try{
      const r=await fetch('/eng/openapi'); const s=await r.json();
      const tb=document.querySelector('#api tbody'); tb.innerHTML='';
      Object.keys(s.paths||{}).sort().forEach(p=>{
        Object.keys(s.paths[p]).forEach(m=>{
          const tr=document.createElement('tr');
          tr.innerHTML='<td class="m">'+m.toUpperCase()+'</td><td>'+p+'</td>';
          tr.onclick=()=>{document.getElementById('m').value=m.toUpperCase();
            document.getElementById('p').value=p.replace(/^\\/api/,'');};
          tb.appendChild(tr);
        });
      });
    }catch(e){ document.querySelector('#api tbody').innerHTML='<tr><td>no disponible</td></tr>'; }
  }
  async function go(){
    const m=document.getElementById('m').value.trim().toUpperCase();
    const p=document.getElementById('p').value.trim();
    const t=document.getElementById('t').value.trim();
    const b=document.getElementById('b').value.trim();
    const h={}; if(t)h['X-Eng-Token']=t;
    const opt={method:m,headers:h};
    if(m!=='GET'&&b){opt.headers['content-type']='application/json';opt.body=b;}
    const out=document.getElementById('out'); out.textContent='...';
    try{const r=await fetch('/eng/api'+p,opt);const x=await r.text();out.textContent=r.status+'\\n'+x;}
    catch(e){out.textContent='error: '+e;}
  }
  loadApi();
  </script>
</main></body></html>`;
}

function createApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.get("/healthz", (_req, res) =>
    res.json({ status: "ok", service: "engineering", enabled: state.engineeringEnabled })
  );

  // Habilitación interna (solo loopback -> vía SSRF).
  app.get("/internal/engineering/enable", (req, res) => {
    if (!isLoopback(req)) {
      return res.status(403).json({ error: "forbidden" });
    }
    state.engineeringEnabled = true;
    res.json({
      ok: true,
      message: "PUERTO 8084 HABILITADO",
      detail: "consola de ingeniería online",
    });
  });

  // Gate: todo lo demás requiere que la consola esté habilitada.
  app.use((req, res, next) => {
    if (req.path.startsWith("/internal/") || req.path === "/healthz") return next();
    if (!state.engineeringEnabled) {
      return res.status(503).json({ error: "Engineering console offline" });
    }
    next();
  });

  // Documentación OpenAPI del SCADA (proxy).
  app.get("/eng/openapi", async (_req, res) => {
    try {
      const r = await fetch(config.SCADA_BASE + "/openapi.json");
      const text = await r.text();
      res.status(r.status).type("application/json").send(text);
    } catch (e) {
      res.status(502).json({ error: String(e && e.message ? e.message : e) });
    }
  });

  // Proxy /eng/api/* -> SCADA /api/*
  app.all("/eng/api/*", async (req, res) => {
    const rest = req.originalUrl.replace(/^\/eng\/api/, "");
    const target = config.SCADA_BASE + "/api" + rest;
    const headers = {};
    if (req.headers["x-eng-token"]) headers["X-Eng-Token"] = req.headers["x-eng-token"];
    const opt = { method: req.method, headers };
    if (req.method !== "GET" && req.method !== "HEAD") {
      headers["content-type"] = "application/json";
      opt.body = JSON.stringify(req.body || {});
    }
    try {
      const r = await fetch(target, opt);
      const text = await r.text();
      res.status(r.status);
      const ct = r.headers.get("content-type");
      if (ct) res.type(ct);
      res.send(text);
    } catch (e) {
      res.status(502).json({ error: String(e && e.message ? e.message : e) });
    }
  });

  app.get("/", (_req, res) => res.type("html").send(consolePage()));

  return app;
}

module.exports = { createApp };
