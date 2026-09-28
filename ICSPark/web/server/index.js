const config = require("./config");
const auditors = require("./routes/auditors");
const visualizer = require("./routes/visualizer");
const admin = require("./routes/admin");
const engineering = require("./routes/engineering");

function boot(name, app, port) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`[web] ${name} escuchando en :${port}`);
  });
}

boot("auditores", auditors.createApp(), config.PORTS.auditors);
boot("visualizador", visualizer.createApp(), config.PORTS.visualizer);
boot("admin", admin.createApp(), config.PORTS.admin);
boot("ingenieria", engineering.createApp(), config.PORTS.engineering);
