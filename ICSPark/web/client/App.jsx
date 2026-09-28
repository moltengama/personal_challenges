import React, { useEffect, useState } from "react";

async function api(path, opts = {}) {
  const r = await fetch(path, {
    headers: { "content-type": "application/json" },
    credentials: "include",
    ...opts,
  });
  const text = await r.text();
  try {
    return { status: r.status, data: JSON.parse(text) };
  } catch {
    return { status: r.status, data: text };
  }
}

function Login({ onLogin }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  async function submit(e) {
    e.preventDefault();
    const { status } = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ username: u, password: p }),
    });
    if (status === 200) onLogin();
    else setErr("Credenciales inválidas");
  }
  return (
    <div className="card">
      <h1>Acceso de auditores</h1>
      <p className="mut">Portal de auditoría externa · InGen / Jurassic Park (Isla Nublar)</p>
      <form onSubmit={submit}>
        <label>Usuario</label>
        <input value={u} onChange={(e) => setU(e.target.value)} autoFocus />
        <label>Contraseña</label>
        <input type="password" value={p} onChange={(e) => setP(e.target.value)} />
        {err && <p className="mut" style={{ color: "#ff6b6b" }}>{err}</p>}
        <button type="submit">Entrar</button>
      </form>
    </div>
  );
}

function Dashboard({ onLogout }) {
  const [reports, setReports] = useState([]);
  const [tpl, setTpl] = useState("audit-summary");
  const [format, setFormat] = useState("pdf");
  const [color, setColor] = useState("#0a7d55");
  const [footer, setFooter] = useState("InGen — Isla Nublar");
  const [watermark, setWatermark] = useState(true);
  const [sections, setSections] = useState({
    summary: true,
    findings: true,
    recommendations: false,
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api("/api/reports").then(({ data }) => setReports(data.reports || []));
  }, []);

  function toggle(k) {
    setSections((s) => ({ ...s, [k]: !s[k] }));
  }

  async function generate() {
    setBusy(true);
    setResult(null);
    // La UI construye las opciones del informe de forma estructurada.
    const options = {
      format,
      watermark: watermark ? "CONFIDENTIAL" : "",
      branding: { color, footer },
      sections,
    };
    try {
      const res = await fetch("/api/reports/download", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ template: tpl, options }),
      });
      if (res.ok && (res.headers.get("content-type") || "").includes("pdf")) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = tpl + ".pdf";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        const meta = reports.find((r) => r.id === tpl);
        setResult({
          title: meta ? meta.title : tpl,
          id: tpl,
          format,
          generatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      /* noop */
    }
    setBusy(false);
  }

  return (
    <>
      <div className="card">
        <h1>Panel de auditoría</h1>
        <p className="mut">
          Genera informes de auditoría del parque a partir de una plantilla y las
          preferencias de formato y marca.
        </p>
      </div>

      <div className="card">
        <h2>Generar informe</h2>
        <label>Plantilla</label>
        <select value={tpl} onChange={(e) => setTpl(e.target.value)}>
          {reports.map((r) => (
            <option key={r.id} value={r.id}>{r.title}</option>
          ))}
        </select>

        <div className="row">
          <div>
            <label>Formato</label>
            <select value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="pdf">PDF</option>
              <option value="html">HTML</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          <div>
            <label>Color de marca</label>
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
        </div>

        <label>Pie de página</label>
        <input value={footer} onChange={(e) => setFooter(e.target.value)} />

        <label>Secciones</label>
        <div className="checks">
          <label className="chk"><input type="checkbox" checked={sections.summary} onChange={() => toggle("summary")} /> Resumen</label>
          <label className="chk"><input type="checkbox" checked={sections.findings} onChange={() => toggle("findings")} /> Hallazgos</label>
          <label className="chk"><input type="checkbox" checked={sections.recommendations} onChange={() => toggle("recommendations")} /> Recomendaciones</label>
          <label className="chk"><input type="checkbox" checked={watermark} onChange={() => setWatermark((w) => !w)} /> Marca de agua</label>
        </div>

        <div className="row">
          <button onClick={generate} disabled={busy}>{busy ? "Generando…" : "Generar informe"}</button>
          <button className="ghost" onClick={onLogout}>Cerrar sesión</button>
        </div>

        {result && (
          <div className="result">
            <b>✔ Informe generado</b>
            <div className="mut">{result.title}</div>
            <div className="mut">
              ID: {result.id} · formato {result.format} · {new Date(result.generatedAt).toLocaleString()}
            </div>
            <div className="mut">Descarga iniciada: {result.id}.pdf</div>
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(null);

  async function check() {
    const { status } = await api("/api/me");
    setAuthed(status === 200);
  }
  useEffect(() => { check(); }, []);

  async function logout() {
    await api("/api/logout", { method: "POST" });
    setAuthed(false);
  }

  return (
    <>
      <header>
        <b>■ InGen</b> Portal de Auditores <span className="mut">· Jurassic Park</span>
      </header>
      <main>
        {authed === null ? (
          <div className="card"><p className="mut">Cargando…</p></div>
        ) : authed ? (
          <Dashboard onLogout={logout} />
        ) : (
          <Login onLogin={() => setAuthed(true)} />
        )}
      </main>
    </>
  );
}
