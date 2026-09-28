const express = require("express");
const config = require("../config");

// Visualizador de puertas del paddock (puerto 8082).
// Refleja el estado REAL del PLC (leído vía SCADA). Cuando la puerta del
// T-Rex (PADDOCK-09 / coil 9) se abre, reproduce la animación del actuador
// industrial y muestra la flag.

function pageHtml() {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Jurassic Park · Paddock Monitor</title>
<style>
  :root{--bg:#05070a;--pnl:#0b1119;--line:#1c2733;--mut:#7d8ba0;--red:#ff5d5d;--grn:#39d98a;--amb:#e8b73a}
  *{box-sizing:border-box}
  body{margin:0;font-family:ui-monospace,Consolas,monospace;background:var(--bg);color:#dfe7ef}
  header{padding:14px 22px;border-bottom:1px solid var(--line);letter-spacing:2px}
  header b{color:var(--amb)}
  main{max-width:1000px;margin:20px auto;padding:0 16px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px;margin-bottom:20px}
  .d{background:var(--pnl);border:1px solid var(--line);border-radius:8px;padding:10px}
  .d small{color:var(--mut)} .st{font-weight:700} .closed{color:#4ea1ff} .open{color:var(--red)}

  /* ---- HMI del actuador industrial ---- */
  #hmi{background:var(--pnl);border:1px solid var(--line);border-radius:12px;padding:18px 18px 22px}
  .hh{display:flex;align-items:center;justify-content:space-between;font-size:13px;color:var(--mut);letter-spacing:1px;margin-bottom:16px}
  .led{font-weight:700;padding:3px 12px;border-radius:12px;border:1px solid var(--red);color:var(--red);transition:.3s}
  #hmi.open .led{border-color:var(--grn);color:var(--grn)}
  .mech{display:flex;align-items:flex-end;justify-content:center;gap:14px;height:220px}
  /* pistones hidráulicos */
  .pis{width:26px;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%}
  .cyl{width:26px;height:70px;background:linear-gradient(90deg,#2a3644,#3d4d5f,#2a3644);border:1px solid var(--line);border-radius:4px}
  .rod{width:10px;height:12px;background:linear-gradient(90deg,#5a6b7d,#8ea3b6,#5a6b7d);transition:height 2.2s cubic-bezier(.5,0,.2,1)}
  #hmi.open .rod{height:96px}
  /* marco + compuerta guillotina */
  .frame{position:relative;width:150px;height:200px;border:3px solid #3d4d5f;border-radius:4px;overflow:hidden;background:repeating-linear-gradient(90deg,#0a1420,#0a1420 8px,#0c1826 8px,#0c1826 16px)}
  .gate{position:absolute;left:0;right:0;top:0;height:100%;background:repeating-linear-gradient(0deg,#c9862b,#c9862b 12px,#9c6620 12px,#9c6620 24px);border-bottom:4px solid #6f4a17;transition:transform 2.4s cubic-bezier(.5,0,.2,1)}
  #hmi.open .gate{transform:translateY(-92%)}
  .hz{position:absolute;left:0;right:0;bottom:0;height:6px;background:repeating-linear-gradient(90deg,var(--amb),var(--amb) 10px,#111 10px,#111 20px)}
  /* linea de presion / flujo */
  .flow{margin:16px auto 0;width:70%;height:12px;border:1px solid var(--line);border-radius:6px;background:#07101a;overflow:hidden;position:relative}
  .flow::after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent,transparent 10px,#123 10px,#123 20px)}
  #hmi.open .flow::after{background:repeating-linear-gradient(90deg,transparent,transparent 10px,var(--grn) 10px,var(--grn) 20px);animation:mv .8s linear infinite}
  @keyframes mv{to{transform:translateX(20px)}}
  .flab{text-align:center;color:var(--mut);font-size:11px;margin-top:6px;letter-spacing:1px}
  #flag{margin-top:16px;text-align:center;color:var(--grn);font-weight:700;letter-spacing:1px;opacity:0;transition:opacity .8s ease 1.6s}
  #hmi.open #flag{opacity:1}
</style></head><body>
<header>▮ JURASSIC PARK · <b>PADDOCK PERIMETER MONITOR</b></header>
<main>
  <div class="grid" id="grid"></div>

  <div id="hmi">
    <div class="hh"><span>PADDOCK-09 · CONTAINMENT GATE ACTUATOR</span><span class="led" id="led">LOCKED</span></div>
    <div class="mech">
      <div class="pis"><div class="rod"></div><div class="cyl"></div></div>
      <div class="frame"><div class="gate"></div><div class="hz"></div></div>
      <div class="pis"><div class="rod"></div><div class="cyl"></div></div>
    </div>
    <div class="flow"></div>
    <div class="flab">HYDRAULIC ACTUATOR PRESSURE</div>
    <div id="flag"></div>
  </div>
</main>
<script>
let opened=false;
async function tick(){
  try{
    const r=await fetch('/state'); const j=await r.json();
    const g=document.getElementById('grid'); g.innerHTML='';
    (j.doors||[]).forEach(d=>{
      const el=document.createElement('div'); el.className='d';
      el.innerHTML='<small>'+d.paddock_id+'</small><br>'+d.species+
        '<br><span class="st '+(d.open?'open':'closed')+'">'+(d.open?'ABIERTA':'CERRADA')+'</span>';
      g.appendChild(el);
    });
    if(j.trexOpen && !opened){
      opened=true;
      document.getElementById('hmi').classList.add('open');
      document.getElementById('led').textContent='OPEN';
      if(j.flag) document.getElementById('flag').textContent=j.flag;
    }
  }catch(e){}
}
tick(); setInterval(tick,2000);
</script>
</body></html>`;
}

function createApp() {
  const app = express();

  app.get("/healthz", (_req, res) => res.json({ status: "ok", service: "visualizer" }));

  app.get("/", (_req, res) => res.type("html").send(pageHtml()));

  app.get("/state", async (_req, res) => {
    try {
      const r = await fetch(config.SCADA_BASE + "/api/v1/doors");
      const j = await r.json();
      const doors = j.doors || [];
      const trex = doors.find((d) => d.coil === config.TREX_COIL);
      const trexOpen = !!(trex && trex.open);
      res.json({
        doors,
        trexOpen,
        // La flag SOLO se entrega cuando la puerta del T-Rex está abierta.
        flag: trexOpen ? config.FINAL_FLAG : undefined,
      });
    } catch (e) {
      res.status(502).json({ error: String(e && e.message ? e.message : e), doors: [] });
    }
  });

  return app;
}

module.exports = { createApp };
