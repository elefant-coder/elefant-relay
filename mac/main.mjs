// Elefant Relay for Mac — talk with a friend's AI without typing commands.
import { app, BrowserWindow, ipcMain, Notification, clipboard, shell } from "electron";
import { execFileSync, spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

// Apps opened from Finder get a bare PATH, so `claude` / `codex` are not found. Take the login shell's PATH.
function fixPath() {
  const extra = [join(homedir(), ".local/bin"), join(homedir(), ".claude/local"), "/opt/homebrew/bin", "/usr/local/bin", join(homedir(), ".npm-global/bin")];
  let fromShell = "";
  try {
    const out = execFileSync(process.env.SHELL || "/bin/zsh", ["-ilc", 'printf "__P__%s__P__" "$PATH"'], { encoding: "utf8", timeout: 8000, stdio: ["ignore", "pipe", "ignore"] });
    fromShell = out.match(/__P__(.*)__P__/s)?.[1] ?? "";
  } catch { /* fall back to the usual places */ }
  const parts = [...fromShell.split(":"), ...(process.env.PATH ?? "").split(":"), ...extra].filter(Boolean);
  process.env.PATH = [...new Set(parts)].join(":");
}
fixPath();
if (process.env.ELEFANT_RELAY_APP_DATA) app.setPath("userData", process.env.ELEFANT_RELAY_APP_DATA);

const lib = (m) => import(new URL(`./lib/${m}.js`, import.meta.url).href);
const [state, receiverMod, pair, crypto, client, agentMod, home, chatMod] = await Promise.all([
  lib("state"), lib("receiver"), lib("pair"), lib("crypto"), lib("client"), lib("agent"), lib("home"), import("./chat.mjs"),
]);
const { startReceiver, receiverPid, listenerInfo } = receiverMod;

const has = (cmd) => spawnSync("/usr/bin/which", [cmd], { stdio: "ignore" }).status === 0;
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
  const r = spawnSync("/bin/ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" });
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
      n.on("click", () => { win?.show(); win?.focus(); });
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
    titleBarStyle: "hiddenInset",
    webPreferences: { preload: join(import.meta.dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) void shell.openExternal(url); return { action: "deny" }; });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  void win.loadFile(join(import.meta.dirname, "renderer", "index.html"));
  win.on("closed", () => { win = null; });
}

chatMod.init({ state, client, agentMod, home, push: () => win?.webContents.send("relay:changed") });

app.whenReady().then(() => {
  tryListen();
  setInterval(tryListen, 5000); // take over the mailbox when another listener goes away
  createWindow();
  app.on("activate", () => { if (!win) createWindow(); });
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
app.on("before-quit", () => { rx?.close(); rx = null; });
