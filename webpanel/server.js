"use strict";
const express      = require("express");
const session      = require("express-session");
const fs           = require("fs-extra");
const path         = require("path");
const http         = require("http");

const PORT         = parseInt(process.env.PANEL_PORT || process.env.PORT || 4000);
const PASSWORD     = process.env.PANEL_PASSWORD || "admin1234";
const ROOT         = path.join(__dirname, "..");
const ACCOUNT_FILE = path.join(ROOT, "account.txt");
const CONFIG_FILE  = path.join(ROOT, "config.json");

// ─── Boot time ───────────────────────────────────────────────────────────────
const STARTED_AT   = Date.now();

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use(session({
  secret: process.env.SESSION_SECRET || "wv3-panel-secret-" + Math.random(),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 8 * 60 * 60 * 1000 }  // 8 hours
}));

// ─── Auth guard ───────────────────────────────────────────────────────────────
function auth(req, res, next) {
  if (req.session.loggedIn) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "Unauthorized" });
  return res.redirect("/login");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")); }
  catch (_) { return {}; }
}

function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2));
}

function getUptime() {
  const s = Math.floor((Date.now() - STARTED_AT) / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}h ${m}m ${sec}s`;
}

function readLastLogs(n = 80) {
  try {
    const logDir = "/tmp/logs";
    if (!fs.existsSync(logDir)) return ["No log files yet."];
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith(".log"))
      .map(f => ({ f, t: fs.statSync(path.join(logDir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    if (!files.length) return ["No log files yet."];
    const content = fs.readFileSync(path.join(logDir, files[0].f), "utf8");
    // strip XML wrappers and ANSI color codes
    const clean = content
      .replace(/<[^>]+>/g, "")
      .replace(/\x1b\[[0-9;]*m/g, "")
      .replace(/\r/g, "");
    const lines = clean.split("\n").filter(l => l.trim());
    return lines.slice(-n);
  } catch (e) { return ["Error reading logs: " + e.message]; }
}

function htmlEscape(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// ─── HTML base layout ─────────────────────────────────────────────────────────
function layout(title, body, activeTab = "") {
  const tabs = [
    ["status",   "📊", "Status"],
    ["cookies",  "🍪", "Cookies"],
    ["config",   "⚙️",  "Config"],
    ["accounts", "🔄", "Accounts"],
    ["logs",     "📋", "Logs"],
  ];
  const nav = tabs.map(([id, icon, label]) =>
    `<a href="/${id}" class="nav-link ${activeTab === id ? "active" : ""}">${icon} ${label}</a>`
  ).join("\n");

  return `<!DOCTYPE html>
<html lang="ar" dir="ltr">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>WHITE V3 Panel — ${title}</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"/>
<style>
  :root{--bg:#0d1117;--bg2:#161b22;--bg3:#21262d;--border:#30363d;--accent:#2f81f7;--green:#3fb950;--yellow:#d29922;--red:#f85149;--text:#e6edf3;--muted:#8b949e}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',sans-serif;min-height:100vh}
  .sidebar{width:220px;background:var(--bg2);border-right:1px solid var(--border);min-height:100vh;padding:20px 10px;position:fixed;top:0;left:0}
  .sidebar .brand{font-size:1.1rem;font-weight:700;color:var(--accent);padding:10px 12px;margin-bottom:16px;border-bottom:1px solid var(--border)}
  .nav-link{color:var(--muted);padding:8px 12px;border-radius:6px;margin:2px 0;display:block;text-decoration:none;font-size:.93rem;transition:all .15s}
  .nav-link:hover,.nav-link.active{background:var(--bg3);color:var(--text)}
  .nav-link.active{color:var(--accent)}
  .main{margin-left:220px;padding:28px 32px}
  .card{background:var(--bg2);border:1px solid var(--border);border-radius:10px;padding:20px;margin-bottom:20px}
  .card h5{color:var(--text);margin-bottom:16px;font-size:1rem;font-weight:600}
  .badge-green{background:#1a3a1a;color:var(--green);border:1px solid #2d5a2d;border-radius:20px;padding:3px 10px;font-size:.82rem}
  .badge-yellow{background:#2d2200;color:var(--yellow);border:1px solid #5a4400;border-radius:20px;padding:3px 10px;font-size:.82rem}
  .badge-red{background:#3a1a1a;color:var(--red);border:1px solid #5a2d2d;border-radius:20px;padding:3px 10px;font-size:.82rem}
  .stat-box{background:var(--bg3);border:1px solid var(--border);border-radius:8px;padding:16px;text-align:center}
  .stat-box .val{font-size:1.6rem;font-weight:700;color:var(--accent)}
  .stat-box .lbl{font-size:.8rem;color:var(--muted);margin-top:4px}
  .form-control,.form-select{background:var(--bg3);border:1px solid var(--border);color:var(--text);border-radius:6px}
  .form-control:focus,.form-select:focus{background:var(--bg3);border-color:var(--accent);color:var(--text);box-shadow:0 0 0 2px rgba(47,129,247,.2)}
  .btn-primary{background:var(--accent);border-color:var(--accent)}
  .btn-danger{background:var(--red);border-color:var(--red);color:#fff}
  .btn-success{background:var(--green);border-color:var(--green);color:#000}
  .log-box{background:#010409;border:1px solid var(--border);border-radius:8px;padding:14px;font-family:monospace;font-size:.78rem;max-height:480px;overflow-y:auto;white-space:pre-wrap;color:#c9d1d9}
  .toast-container{position:fixed;bottom:20px;right:20px;z-index:9999}
  textarea{resize:vertical}
  .input-group-text{background:var(--bg3);border-color:var(--border);color:var(--muted)}
  @media(max-width:768px){.sidebar{display:none}.main{margin-left:0;padding:16px}}
</style>
</head>
<body>
<div class="sidebar">
  <div class="brand">⚪ WHITE V3</div>
  ${nav}
  <div style="position:absolute;bottom:20px;left:10px;right:10px">
    <a href="/logout" class="nav-link" style="color:var(--red)">🚪 Logout</a>
  </div>
</div>
<div class="main">
  <div id="toast-container" class="toast-container"></div>
  ${body}
</div>
<script>
function showToast(msg, type='success'){
  const c=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className='toast align-items-center text-white border-0 show';
  t.style.cssText='background:'+(type==='success'?'#1a3a1a':'#3a1a1a')+';border:1px solid '+(type==='success'?'#2d5a2d':'#5a2d2d')+';border-radius:8px;padding:12px 16px;margin-top:8px;min-width:260px';
  t.innerHTML=msg;
  c.appendChild(t);
  setTimeout(()=>t.remove(),4000);
}
async function api(url,data){
  try{
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    return await r.json();
  }catch(e){return{error:e.message};}
}
</script>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
}

// ─── Login ────────────────────────────────────────────────────────────────────
app.get("/", (req, res) => res.redirect(req.session.loggedIn ? "/status" : "/login"));

app.get("/login", (req, res) => {
  if (req.session.loggedIn) return res.redirect("/status");
  res.send(`<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<title>WHITE V3 Panel — Login</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css"/>
<style>
body{background:#0d1117;display:flex;align-items:center;justify-content:center;min-height:100vh;font-family:'Segoe UI',sans-serif}
.box{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:36px;width:360px}
.brand{color:#2f81f7;font-size:1.4rem;font-weight:700;text-align:center;margin-bottom:24px}
.form-control{background:#21262d;border:1px solid #30363d;color:#e6edf3}
.form-control:focus{background:#21262d;border-color:#2f81f7;color:#e6edf3;box-shadow:none}
.btn-primary{background:#2f81f7;border-color:#2f81f7;width:100%}
label{color:#8b949e;font-size:.9rem}
.err{color:#f85149;font-size:.85rem;text-align:center;margin-top:10px}
</style></head><body>
<div class="box">
  <div class="brand">⚪ WHITE V3 Panel</div>
  <form method="POST" action="/login">
    <div class="mb-3">
      <label>Password</label>
      <input type="password" name="password" class="form-control mt-1" placeholder="Enter panel password" autofocus required/>
    </div>
    <button type="submit" class="btn btn-primary mt-2">Login</button>
    ${req.query.err ? `<div class="err">❌ Wrong password</div>` : ""}
  </form>
</div></body></html>`);
});

app.post("/login", (req, res) => {
  if (req.body.password === PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect("/status");
  }
  res.redirect("/login?err=1");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => res.redirect("/login"));
});

// ─── Status ───────────────────────────────────────────────────────────────────
app.get("/status", auth, (req, res) => {
  const cfg     = readConfig();
  const running = !!global.GoatBot?.fcaApi;
  const cmds    = global.GoatBot?.commands?.size || 0;
  const threads  = global.db?.allThreadData?.length || 0;
  const botID   = global.botID || global.GoatBot?.botID || "—";
  const prefix  = cfg.prefix || "/";
  const lang    = cfg.language || "en";
  const version = global.GoatBot?.version || "1.5.35";

  const body = `
<h4 class="mb-4" style="color:#e6edf3">📊 Bot Status</h4>
<div class="row g-3 mb-4">
  <div class="col-6 col-md-3"><div class="stat-box"><div class="val">${cmds}</div><div class="lbl">Commands</div></div></div>
  <div class="col-6 col-md-3"><div class="stat-box"><div class="val">${threads}</div><div class="lbl">Threads</div></div></div>
  <div class="col-6 col-md-3"><div class="stat-box"><div class="val" style="font-size:1.1rem">${getUptime()}</div><div class="lbl">Panel Uptime</div></div></div>
  <div class="col-6 col-md-3"><div class="stat-box"><div class="val">${version}</div><div class="lbl">Version</div></div></div>
</div>
<div class="card">
  <h5>ℹ️ Bot Info</h5>
  <table class="table table-sm" style="color:var(--text);--bs-table-bg:transparent;--bs-table-border-color:var(--border)">
    <tr><td style="color:var(--muted);width:180px">Status</td><td>${running ? '<span class="badge-green">🟢 Online</span>' : '<span class="badge-red">🔴 Offline</span>'}</td></tr>
    <tr><td style="color:var(--muted)">Bot ID</td><td><code style="color:#79c0ff">${botID}</code></td></tr>
    <tr><td style="color:var(--muted)">Prefix</td><td><code style="color:#79c0ff">${htmlEscape(prefix)}</code></td></tr>
    <tr><td style="color:var(--muted)">Language</td><td>${lang}</td></tr>
    <tr><td style="color:var(--muted)">Stealth Engine</td><td>${cfg.stealth?.enable !== false ? '<span class="badge-green">Active</span>' : '<span class="badge-yellow">Disabled</span>'}</td></tr>
    <tr><td style="color:var(--muted)">Anti-Spam</td><td>${cfg.antispam?.enable !== false ? '<span class="badge-green">Active</span>' : '<span class="badge-red">Disabled</span>'}</td></tr>
    <tr><td style="color:var(--muted)">E2EE</td><td>${cfg.e2ee?.enable !== false ? '<span class="badge-green">Active</span>' : '<span class="badge-yellow">Disabled</span>'}</td></tr>
    <tr><td style="color:var(--muted)">Account Rotator</td><td>${cfg.accountRotation?.enable ? '<span class="badge-green">Active</span>' : '<span class="badge-yellow">Disabled</span>'}</td></tr>
  </table>
</div>
<div class="card">
  <h5>👑 Admin IDs</h5>
  ${(cfg.adminBot || []).map(id => `<code style="color:#79c0ff;margin-right:12px">${id}</code>`).join("")}
</div>`;
  res.send(layout("Status", body, "status"));
});

// ─── Cookies ─────────────────────────────────────────────────────────────────
app.get("/cookies", auth, (req, res) => {
  let current = "";
  try {
    const raw = fs.readFileSync(ACCOUNT_FILE, "utf8").trim();
    const parsed = JSON.parse(raw);
    current = JSON.stringify(parsed, null, 2);
  } catch (_) { current = ""; }

  const body = `
<h4 class="mb-4" style="color:#e6edf3">🍪 Cookie / AppState Manager</h4>
<div class="card">
  <h5>📋 Current AppState</h5>
  <p style="color:var(--muted);font-size:.88rem">This is the Facebook session cookie used by the bot. Replacing it will restart the session.</p>
  <textarea id="cookieText" class="form-control mb-3" rows="10" style="font-family:monospace;font-size:.8rem">${htmlEscape(current)}</textarea>
  <div class="d-flex gap-2">
    <button class="btn btn-primary" onclick="saveCookies()">💾 Save & Apply</button>
    <button class="btn btn-outline-secondary" onclick="formatJson()">✨ Format JSON</button>
  </div>
</div>
<div class="card">
  <h5>📁 Upload account.txt File</h5>
  <p style="color:var(--muted);font-size:.88rem">Upload a new <code>account.txt</code> file directly.</p>
  <input type="file" id="fileInput" accept=".txt,.json" class="form-control mb-3"/>
  <button class="btn btn-success" onclick="uploadFile()">⬆️ Upload File</button>
</div>
<script>
async function saveCookies(){
  const val=document.getElementById('cookieText').value.trim();
  try{JSON.parse(val)}catch(e){showToast('❌ Invalid JSON: '+e.message,'error');return}
  const r=await api('/api/cookies',{appstate:val});
  r.ok?showToast('✅ Cookies saved! Restart the bot to apply.'):showToast('❌ '+r.error,'error');
}
function formatJson(){
  const el=document.getElementById('cookieText');
  try{el.value=JSON.stringify(JSON.parse(el.value),null,2);showToast('✅ Formatted!')}
  catch(e){showToast('❌ Invalid JSON','error')}
}
function uploadFile(){
  const f=document.getElementById('fileInput').files[0];
  if(!f)return showToast('❌ No file selected','error');
  const r=new FileReader();
  r.onload=async function(e){
    const txt=e.target.result;
    try{JSON.parse(txt)}catch(ex){showToast('❌ File is not valid JSON','error');return}
    const res=await api('/api/cookies',{appstate:txt});
    res.ok?showToast('✅ File uploaded! Restart the bot to apply.'):showToast('❌ '+res.error,'error');
  };
  r.readAsText(f);
}
</script>`;
  res.send(layout("Cookies", body, "cookies"));
});

app.post("/api/cookies", auth, (req, res) => {
  try {
    const raw = req.body.appstate;
    if (!raw) return res.json({ error: "No appstate provided" });
    JSON.parse(raw); // validate
    fs.writeFileSync(ACCOUNT_FILE, raw);
    res.json({ ok: true });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Config ───────────────────────────────────────────────────────────────────
app.get("/config", auth, (req, res) => {
  const cfg = readConfig();
  const adminBotStr   = (cfg.adminBot || []).join("\n");
  const superAdminStr = (cfg.superAdminBot || []).join("\n");

  const body = `
<h4 class="mb-4" style="color:#e6edf3">⚙️ Bot Configuration</h4>
<div class="card">
  <h5>🔧 General Settings</h5>
  <div class="row g-3">
    <div class="col-md-4">
      <label class="form-label" style="color:var(--muted)">Command Prefix</label>
      <input type="text" id="prefix" class="form-control" value="${htmlEscape(cfg.prefix || "/")}"/>
    </div>
    <div class="col-md-4">
      <label class="form-label" style="color:var(--muted)">Language (ISO 639-1)</label>
      <input type="text" id="language" class="form-control" value="${htmlEscape(cfg.language || "en")}"/>
    </div>
    <div class="col-md-4">
      <label class="form-label" style="color:var(--muted)">Bot Nickname</label>
      <input type="text" id="nickNameBot" class="form-control" value="${htmlEscape(cfg.nickNameBot || "")}"/>
    </div>
    <div class="col-md-4">
      <label class="form-label" style="color:var(--muted)">Time Zone</label>
      <input type="text" id="timeZone" class="form-control" value="${htmlEscape(cfg.timeZone || "Asia/Dhaka")}"/>
    </div>
  </div>
</div>
<div class="card">
  <h5>👑 Admin Bot IDs <span style="color:var(--muted);font-size:.82rem">(one per line)</span></h5>
  <textarea id="adminBot" class="form-control mb-2" rows="5" style="font-family:monospace">${htmlEscape(adminBotStr)}</textarea>
  <h5 class="mt-3">⭐ Super Admin IDs <span style="color:var(--muted);font-size:.82rem">(one per line)</span></h5>
  <textarea id="superAdminBot" class="form-control" rows="3" style="font-family:monospace">${htmlEscape(superAdminStr)}</textarea>
</div>
<div class="card">
  <h5>🛡️ Anti-Spam Settings</h5>
  <div class="row g-3">
    <div class="col-md-3">
      <label class="form-label" style="color:var(--muted)">Enable</label>
      <select id="antispamEnable" class="form-select">
        <option value="true" ${cfg.antispam?.enable !== false ? "selected" : ""}>✅ Enabled</option>
        <option value="false" ${cfg.antispam?.enable === false ? "selected" : ""}>❌ Disabled</option>
      </select>
    </div>
    <div class="col-md-3">
      <label class="form-label" style="color:var(--muted)">Max Messages</label>
      <input type="number" id="antispamMax" class="form-control" value="${cfg.antispam?.maxMessages || 6}"/>
    </div>
    <div class="col-md-3">
      <label class="form-label" style="color:var(--muted)">Time Window (seconds)</label>
      <input type="number" id="antispamWindow" class="form-control" value="${cfg.antispam?.timeWindowSeconds || 8}"/>
    </div>
    <div class="col-md-3">
      <label class="form-label" style="color:var(--muted)">Action</label>
      <select id="antispamAction" class="form-select">
        <option value="kick" ${cfg.antispam?.action === "kick" ? "selected" : ""}>🚫 Kick</option>
        <option value="warn" ${cfg.antispam?.action === "warn" ? "selected" : ""}>⚠️ Warn only</option>
        <option value="mute" ${cfg.antispam?.action === "mute" ? "selected" : ""}>🔇 Mute</option>
      </select>
    </div>
  </div>
</div>
<button class="btn btn-primary btn-lg" onclick="saveConfig()">💾 Save All Changes</button>
<script>
async function saveConfig(){
  const admins = document.getElementById('adminBot').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const supers = document.getElementById('superAdminBot').value.split('\\n').map(s=>s.trim()).filter(Boolean);
  const data={
    prefix:document.getElementById('prefix').value.trim(),
    language:document.getElementById('language').value.trim(),
    nickNameBot:document.getElementById('nickNameBot').value.trim(),
    timeZone:document.getElementById('timeZone').value.trim(),
    adminBot:admins,
    superAdminBot:supers,
    antispam:{
      enable:document.getElementById('antispamEnable').value==='true',
      maxMessages:parseInt(document.getElementById('antispamMax').value)||6,
      timeWindowSeconds:parseInt(document.getElementById('antispamWindow').value)||8,
      action:document.getElementById('antispamAction').value,
      warnBeforeAction:true
    }
  };
  const r=await api('/api/config',data);
  r.ok?showToast('✅ Config saved! Changes apply after restart.'):showToast('❌ '+r.error,'error');
}
</script>`;
  res.send(layout("Config", body, "config"));
});

app.post("/api/config", auth, (req, res) => {
  try {
    const cfg = readConfig();
    const d   = req.body;
    if (d.prefix      !== undefined) cfg.prefix      = d.prefix;
    if (d.language    !== undefined) cfg.language    = d.language;
    if (d.nickNameBot !== undefined) cfg.nickNameBot = d.nickNameBot;
    if (d.timeZone    !== undefined) cfg.timeZone    = d.timeZone;
    if (Array.isArray(d.adminBot))   cfg.adminBot    = d.adminBot;
    if (Array.isArray(d.superAdminBot)) cfg.superAdminBot = d.superAdminBot;
    if (d.antispam    !== undefined) cfg.antispam    = { ...cfg.antispam, ...d.antispam };
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (e) {
    res.json({ error: e.message });
  }
});

// ─── Accounts (Rotator) ───────────────────────────────────────────────────────
app.get("/accounts", auth, (req, res) => {
  const cfg      = readConfig();
  const rotation = cfg.accountRotation || {};
  const accounts = rotation.accounts || [];

  const rows = accounts.map((acc, i) => `
<tr>
  <td><span class="badge-${rotation.currentIndex === i ? "green" : "yellow"}">${rotation.currentIndex === i ? "▶ Active" : `#${i}`}</span></td>
  <td>${htmlEscape(acc.label || `Account ${i}`)}</td>
  <td><input type="email" class="form-control form-control-sm" id="email_${i}" value="${htmlEscape(acc.email || "")}" placeholder="email@facebook.com"/></td>
  <td><input type="password" class="form-control form-control-sm" id="pass_${i}" value="${htmlEscape(acc.password || "")}" placeholder="Password"/></td>
  <td><input type="text" class="form-control form-control-sm" id="tfa_${i}" value="${htmlEscape(acc["2FASecret"] || "")}" placeholder="2FA Secret (optional)"/></td>
  <td><button class="btn btn-sm btn-primary" onclick="saveAccount(${i})">💾</button></td>
</tr>`).join("");

  const body = `
<h4 class="mb-4" style="color:#e6edf3">🔄 Account Rotator</h4>
<div class="card">
  <h5>⚙️ Rotator Status</h5>
  <div class="d-flex gap-3 align-items-center flex-wrap">
    <span>Enabled: <strong class="${rotation.enable ? "text-success" : "text-danger"}">${rotation.enable ? "Yes" : "No"}</strong></span>
    <span>Active Account: <strong style="color:#79c0ff">#${rotation.currentIndex ?? 0} — ${htmlEscape(accounts[rotation.currentIndex ?? 0]?.label || "—")}</strong></span>
    <span>Restricted: <strong style="color:var(--yellow)">${(rotation.restrictedIndexes || []).join(", ") || "None"}</strong></span>
  </div>
  <div class="mt-3 d-flex gap-2">
    <button class="btn btn-success btn-sm" onclick="toggleRotator(true)">✅ Enable Rotator</button>
    <button class="btn btn-danger btn-sm" onclick="toggleRotator(false)">❌ Disable Rotator</button>
    <button class="btn btn-outline-secondary btn-sm" onclick="clearRestricted()">🔓 Clear Restrictions</button>
  </div>
</div>
<div class="card">
  <h5>👤 Accounts</h5>
  <p style="color:var(--muted);font-size:.85rem">Add Facebook email + password for each backup account. The bot will automatically switch to the next account when the current one is blocked.</p>
  <div class="table-responsive">
  <table class="table table-sm" style="color:var(--text);--bs-table-bg:transparent;--bs-table-border-color:var(--border)">
    <thead><tr style="color:var(--muted)"><th>#</th><th>Label</th><th>Email</th><th>Password</th><th>2FA</th><th>Save</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" style="color:var(--muted);text-align:center">No accounts configured</td></tr>'}</tbody>
  </table>
  </div>
</div>
<div class="card">
  <h5>📖 How to use Account Rotator</h5>
  <ol style="color:var(--muted);font-size:.88rem;line-height:1.9">
    <li>Add 2–3 Facebook accounts above (email + password)</li>
    <li>Click <strong style="color:var(--text)">Enable Rotator</strong></li>
    <li>The bot automatically detects when an account is banned/blocked</li>
    <li>It switches to the next account and restarts automatically</li>
    <li>Also works via Messenger: <code>/accounts list | enable | disable | switch &lt;index&gt;</code></li>
  </ol>
</div>
<script>
async function saveAccount(i){
  const email=document.getElementById('email_'+i).value.trim();
  const pass=document.getElementById('pass_'+i).value.trim();
  const tfa=document.getElementById('tfa_'+i).value.trim();
  const r=await api('/api/accounts/save',{index:i,email,password:pass,"2FASecret":tfa});
  r.ok?showToast('✅ Account #'+i+' saved!'):showToast('❌ '+r.error,'error');
}
async function toggleRotator(val){
  const r=await api('/api/accounts/toggle',{enable:val});
  r.ok?location.reload():showToast('❌ '+r.error,'error');
}
async function clearRestricted(){
  const r=await api('/api/accounts/clearRestricted',{});
  r.ok?location.reload():showToast('❌ '+r.error,'error');
}
</script>`;
  res.send(layout("Accounts", body, "accounts"));
});

app.post("/api/accounts/save", auth, (req, res) => {
  try {
    const { index, email, password } = req.body;
    const tfa = req.body["2FASecret"] || "";
    const cfg = readConfig();
    if (!cfg.accountRotation) cfg.accountRotation = { accounts: [] };
    if (!cfg.accountRotation.accounts[index]) cfg.accountRotation.accounts[index] = {};
    const acc = cfg.accountRotation.accounts[index];
    acc.email     = email;
    acc.password  = password;
    acc["2FASecret"] = tfa;
    saveConfig(cfg);
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

app.post("/api/accounts/toggle", auth, (req, res) => {
  try {
    const cfg = readConfig();
    cfg.accountRotation = cfg.accountRotation || {};
    cfg.accountRotation.enable = !!req.body.enable;
    saveConfig(cfg);
    if (global.GoatBot?.config?.accountRotation)
      global.GoatBot.config.accountRotation.enable = cfg.accountRotation.enable;
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

app.post("/api/accounts/clearRestricted", auth, (req, res) => {
  try {
    const cfg = readConfig();
    if (cfg.accountRotation) cfg.accountRotation.restrictedIndexes = [];
    saveConfig(cfg);
    if (global.GoatBot?.config?.accountRotation)
      global.GoatBot.config.accountRotation.restrictedIndexes = [];
    res.json({ ok: true });
  } catch (e) { res.json({ error: e.message }); }
});

// ─── Logs ─────────────────────────────────────────────────────────────────────
app.get("/logs", auth, (req, res) => {
  const lines = readLastLogs(100);
  const html  = lines.map(l => htmlEscape(l)).join("\n");

  const body = `
<h4 class="mb-4" style="color:#e6edf3">📋 Live Logs</h4>
<div class="card">
  <div class="d-flex justify-content-between align-items-center mb-3">
    <h5 class="mb-0">Console Output <span style="color:var(--muted);font-size:.82rem">(last 100 lines)</span></h5>
    <div class="d-flex gap-2">
      <button class="btn btn-sm btn-outline-secondary" onclick="location.reload()">🔄 Refresh</button>
      <button class="btn btn-sm btn-outline-secondary" onclick="scrollBottom()">⬇️ Bottom</button>
    </div>
  </div>
  <div class="log-box" id="logBox">${html}</div>
</div>
<script>
function scrollBottom(){const b=document.getElementById('logBox');b.scrollTop=b.scrollHeight}
window.onload=scrollBottom;
</script>`;
  res.send(layout("Logs", body, "logs"));
});

// ─── API Status (JSON) ────────────────────────────────────────────────────────
app.get("/api/status", auth, (req, res) => {
  res.json({
    online:   !!global.GoatBot?.fcaApi,
    botID:    global.botID || null,
    commands: global.GoatBot?.commands?.size || 0,
    threads:  global.db?.allThreadData?.length || 0,
    uptime:   getUptime(),
    panelPort: PORT
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
module.exports = function startPanel() {
  const server = http.createServer(app);
  server.listen(PORT, "0.0.0.0", () => {
    const logger = global.utils?.log;
    const msg = `🌐 Admin Panel running on port ${PORT}`;
    logger ? logger.info("PANEL", msg) : console.log("[PANEL]", msg);
  });
  server.on("error", (e) => {
    if (e.code === "EADDRINUSE") {
      const logger = global.utils?.log;
      const msg = `Port ${PORT} in use — try setting PANEL_PORT env variable`;
      logger ? logger.warn("PANEL", msg) : console.warn("[PANEL]", msg);
    }
  });
  return server;
};
