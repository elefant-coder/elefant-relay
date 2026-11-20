// Elefant Relay (Mac / Windows) — talk with a friend's AI without typing commands.
import { app, BrowserWindow, ipcMain, Notification, clipboard, shell, Tray, Menu, nativeImage } from "electron";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const WIN = process.platform === "win32";

// Apps opened from Finder get a bare PATH, so `claude` / `codex` are not found: take the login shell's PATH.
// Windows apps get the user's PATH already; add the folders the installers use in case it is stale.
function fixPath() {
  const h = homedir();
  const extra = WIN
    ? [join(h, ".local", "bin"), join(process.env.APPDATA ?? join(h, "AppData", "Roaming"), "npm"), join(h, ".claude", "local")]
    : [join(h, ".local/bin"), join(h, ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", join(h, ".npm-global/bin")];
  let fromShell = "";
  if (!WIN) {
    try {
      const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__P__%s__P__" "$PATH"'], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
      fromShell = out.match(/__P__(.*)__P__/s)?.[1] ?? "";
    } catch { /* fall back to the usual places */ }
  }
  const parts = [...fromShell.split(delimiter), ...(process.env.PATH ?? "").split(delimiter), ...extra].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(delimiter);
}
fixPath();
if (process.env.ELEFANT_RELAY_APP_DATA) app.setPath("userData", process.env.ELEFANT_RELAY_APP_DATA);
// one window per user (the lock lives in the app data folder); a second launch shows the first one
if (!app.requestSingleInstanceLock()) { app.exit(0); }
if (WIN) app.setAppUserModelId("com.elefant.relay");

const lib = (m) => import(new URL(`./lib/${m}.js`, import.meta.url).href);
const [state, receiverMod, pair, crypto, client, agentMod, home, chatMod] = await Promise.all([
  lib("state"), lib("receiver"), lib("pair"), lib("crypto"), lib("client"), lib("agent"), lib("home"), import("./chat.mjs"),
]);
const { startReceiver, receiverPid, listenerInfo } = receiverMod;

const has = (cmd) => spawnSync(WIN ? "where.exe" : "/usr/bin/which", [cmd], { stdio: "ignore", windowsHide: true }).status === 0;
const ja = () => app.getLocale().toLowerCase().startsWith("ja");

let win = null;
let rx = null; // our receiver, when we hold the mailbox
const notified = new Set();

function tryListen() {
  if (rx) return;
  const me = state.loadIdentity();
  const cfg = state.loadConfig();
  if (!me || !cfg) return;
  rx = startReceiver({ me, cfg, interactive: false, via: "app", log: (s) => { if (!/^(connected to relay|relay connection lost)/.test(s)) home.appendLog({ event: "listener", note: s }); } });
}

function processCommand(pid) {
  const r = WIN
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${Number(pid)}").CommandLine`], { encoding: "utf8", windowsHide: true, timeout: 15000 })
    : spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : "";
}

function snapshot() {
  const me = state.loadIdentity();
  const cfg = state.loadConfig();
  const pid = receiverPid();
  const info = listenerInfo();
  const pending = state.listPending();
  for (const x of pending) {
    if (notified.has(x.id)) continue;
    notified.add(x.id);
    chatMod.noteIncoming(x);
    if (Notification.isSupported()) {
      const n = new Notification({
        title: ja() ? `${x.peer} のAIからお願いが届きました` : `${x.peer}'s AI is asking yours`,
        body: x.text.slice(0, 140),
      });
      n.on("click", showWindow);
      n.show();
    }
  }
  chatMod.followLog();
  return {
    setUp: Boolean(me && cfg),
    me: me ? { name: me.name } : null,
    relay: cfg?.relay ?? "",
    agent: cfg?.agent ?? (has("claude") ? "claude" : has("codex") ? "codex" : ""),
    agents: { claude: has("claude"), codex: has("codex") },
    listener: pid === null ? { state: "none" }
      : rx ? { state: "mine", connected: Boolean(info?.connected), relay: info?.relay ?? "" }
      : info ? { state: "other", via: info.via, connected: info.connected, pid }
      : { state: "old", pid, command: processCommand(pid) },
    peers: state.loadPeers().map((x) => ({ name: x.name, kind: x.kind ?? "people", safety: x.safety, added: x.added })),
    pending: pending.map((x) => ({ id: x.id, peer: x.peer, mode: x.mode, text: x.text.slice(0, 4000), received: x.received })),
    invites: home.readJson(home.p("invites.json"), []).filter((i) => Date.now() - i.created < 600_000).length,
    lang: ja() ? "ja" : "en",
    platform: process.platform,
  };
}

const cleanName = (n) => String(n ?? "").trim().replace(/[^\p{L}\p{N}_-]/gu, "").slice(0, 32);

const api = {
  state: () => snapshot(),

  setup: async ({ name, relay, code }) => {
    const nm = cleanName(name);
    if (!nm) throw new Error(ja() ? "名前を入れてください（英数字・日本語・- _）" : "Enter a name");
    let r = String(relay ?? "").trim().replace(/\/+$/, "");
    if (code) r = pair.parseInvite(String(code).trim()).relay;
    if (!r) throw new Error(ja() ? "招待コードか中継の URL が必要です" : "An invite code or a relay URL is needed");
    if (!/^https?:\/\//.test(r)) r = `https://${r}`;
    let me = state.loadIdentity();
    if (!me) { me = crypto.newIdentity(nm); state.saveIdentity(me); }
    else if (me.name !== nm) { me = { ...me, name: nm }; state.saveIdentity(me); }
    const prev = state.loadConfig();
    const agent = prev?.agent ?? (has("claude") ? "claude" : has("codex") ? "codex" : "claude");
    state.saveConfig({ ...(prev ?? {}), relay: r, agent, use: prev?.use ?? "people", files: prev?.files ?? false, mcp: prev?.mcp ?? "off" });
    tryListen();
    if (code) return api.join({ code });
    return { ok: true };
  },

  rename: ({ name }) => {
    const nm = cleanName(name);
    const me = state.mustIdentity();
    if (nm) state.saveIdentity({ ...me, name: nm });
    return { ok: true };
  },

  setAgent: ({ agent }) => {
    const cfg = state.mustConfig();
    if (agent === "claude" || agent === "codex") state.saveConfig({ ...cfg, agent });
    return { ok: true };
  },

  invite: async () => {
    const inv = await pair.createInvite(state.mustIdentity(), state.mustConfig(), "people");
    return { code: inv.full, short: inv.code };
  },

  join: async ({ code }) => {
    const x = await pair.joinInvite(state.mustIdentity(), state.mustConfig(), String(code).trim(), "people");
    return { peer: x.peer.name, safety: x.peer.safety };
  },

  decide: ({ id, decision }) => {
    const x = state.loadPending(id);
    if (!x || x.decision !== undefined) return { ok: false };
    if (!["once", "always", "deny", "deny-always"].includes(decision)) throw new Error("bad decision");
    state.savePending({ ...x, decision });
    chatMod.noteDecision(x, decision);
    return { ok: true };
  },

  stopOld: ({ pid }) => {
    const p = Number(pid);
    if (p !== receiverPid() || listenerInfo() || !/elefant-relay|cli\.js/.test(processCommand(p))) return { ok: false };
    try { process.kill(p, "SIGTERM"); } catch { /* gone */ }
    return { ok: true };
  },

  chat: ({ peer }) => chatMod.load(peer),
  send: ({ peer, text }) => chatMod.sendToPeer(peer, String(text ?? "")),
  duoStart: ({ peer, goal, rounds }) => chatMod.duoStart(peer, String(goal ?? ""), Number(rounds) || 3),
  duoStop: ({ peer }) => chatMod.duoStop(peer),
  duoApprove: ({ peer, ok }) => chatMod.duoApprove(peer, Boolean(ok)),
  copy: ({ text }) => { clipboard.writeText(String(text ?? "")); return { ok: true }; },
};

for (const [k, fn] of Object.entries(api)) {
  ipcMain.handle(`relay:${k}`, async (_e, arg) => {
    try { return { ok: true, value: await fn(arg ?? {}) }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1080, height: 720, minWidth: 820, minHeight: 560,
    title: "Elefant Relay",
    backgroundColor: "#ffffff",
    ...(WIN ? { autoHideMenuBar: true, icon: join(import.meta.dirname, "build", "icon.png") } : { titleBarStyle: "hiddenInset" }),
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  void win.loadFile(join(import.meta.dirname, "renderer", "index.html"));
  if (WIN) win.webContents.on("did-finish-load", () => { void win?.webContents.insertCSS(".drag { height: 10px; -webkit-app-region: no-drag; }"); });
  // Windows has no Dock: closing the window hides it to the tray and keeps listening
  win.on("close", (e) => { if (WIN && !quitting) { e.preventDefault(); win.hide(); } });
  win.on("closed", () => { win = null; });
}

let quitting = false;
let tray = null;
let trayImage = null;
function showWindow() { if (!win) createWindow(); else { win.show(); win.focus(); } }
function quitApp() { quitting = true; app.quit(); }
function makeTray() {
  trayImage = nativeImage.createFromPath(join(import.meta.dirname, "build", "tray.png"));
  tray = new Tray(trayImage);
  tray.setToolTip("Elefant Relay");
  const ja2 = ja();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: ja2 ? "開く" : "Open", click: showWindow },
    { label: ja2 ? "終了（受け取りも止まります）" : "Quit (stops listening)", click: quitApp },
  ]));
  tray.on("click", showWindow);
}
app.on("second-instance", showWindow);

chatMod.init({ state, client, agentMod, home, push: () => win?.webContents.send("relay:changed") });

app.whenReady().then(() => {
  tryListen();
  setInterval(tryListen, 5000); // take over the mailbox when another listener goes away
  createWindow();
  if (WIN) makeTray();
  app.on("activate", () => { if (!win) createWindow(); });
  if (process.env.ELEFANT_RELAY_TEST_DRIVER) {
    // test hook: a script that drives the window like a person (clicks, typing), then quits
    win.webContents.once("did-finish-load", async () => {
      const drive = (await import(pathToFileURL(process.env.ELEFANT_RELAY_TEST_DRIVER).href)).default;
      const shot = async (file) => { const { writeFileSync } = await import("node:fs"); writeFileSync(file, (await win.webContents.capturePage()).toPNG()); };
      let code = 0;
      // what a person does outside the page: close the window, use the tray
      const main = {
        close: () => win?.close(),
        visible: () => Boolean(win && !win.isDestroyed() && win.isVisible()),
        tray: () => ({ exists: Boolean(tray && !tray.isDestroyed()), empty: trayImage ? trayImage.isEmpty() : true }),
        trayQuit: quitApp,
        execPath: process.execPath,
      };
      try { await drive({ js: (src) => win.webContents.executeJavaScript(src), shot, main }); } catch (e) { console.error("DRIVER FAILED:", e); code = 1; }
      rx?.close(); rx = null;
      quitting = true;
      app.exit(code);
    });
  }
  if (process.env.ELEFANT_RELAY_SHOT) {
    // test hook: save a screenshot of the window and quit
    setTimeout(async () => {
      const img = await win.webContents.capturePage();
      const { writeFileSync } = await import("node:fs");
      writeFileSync(process.env.ELEFANT_RELAY_SHOT, img.toPNG());
      app.quit();
    }, Number(process.env.ELEFANT_RELAY_SHOT_DELAY ?? 2500));
  }
});

// keep listening while the window is closed; quitting stops it
app.on("window-all-closed", () => { /* stay in the Dock */ });
app.on("before-quit", () => { quitting = true; rx?.close(); rx = null; });
