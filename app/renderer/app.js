"use strict";
// Elefant Relay — window. Everything from friends is shown as plain text (textContent), never as HTML.
const R = window.relay;

const T = {
  ja: {
    friends: "友達", add: "友達とつなぐ", connected: "受け取りできます", notListening: "受け取りできません",
    otherListening: "Claude Code 側で受け取り中", chat: "相手のAIと話す", duo: "AI同士で話す",
    welcome: "Elefant Relay へようこそ", welcomeLead: "あなたの AI が、友達の AI に頼みごとをして答えをもらえます。中身は暗号化されたまま届きます。",
    yourName: "あなたの名前（相手に見えます）", haveCode: "招待コードをもらった", haveCodeSub: "コードを入れるだけ",
    willInvite: "自分から招待する", willInviteSub: "中継の URL が必要", code: "招待コード", relay: "中継の URL",
    relayHint: "持っていなければ、招待してくれる人にコードをもらうのが早いです。",
    start: "はじめる", cancel: "閉じる", noAgent: "この Mac に Claude Code も Codex も見つかりません。どちらかを入れてから開き直してください。",
    agentLine: (a) => `頼みごとは ${a === "codex" ? "Codex" : "Claude Code"} が答えます`,
    connectTitle: "友達とつなぐ", makeCode: "コードを作る", enterCode: "コードを入れる",
    makeLead: "このコードを友達に送ってください。1回だけ・10分で切れます。", copy: "コピー", copied: "コピーしました",
    waiting: "相手が入るのを待っています…", enterLead: "友達から届いたコードを貼ってください。", join: "つなぐ",
    paired: (n) => `${n} とつながりました`, checkLead: "相手の画面にも同じ番号が出ていれば、間違いなく本人です。", done: "OK",
    emptyTitle: "友達とつないでみましょう", emptyLead: "左下の「友達とつなぐ」からコードを作るか、もらったコードを入れます。",
    placeholder: (n) => `${n} の AI に話しかける（${S?.platform === "win32" ? "Ctrl+Enter" : "⌘Enter"} で送る）`, send: "送る",
    duoPlaceholder: (n) => `AI同士で話してほしいこと（例：来週の打ち合わせの候補を3つに絞って）`, rounds: (k) => `${k}往復まで`, roundsLabel: "何往復まで",
    duoStart: "話してもらう", duoStop: "止める", duoRunning: "AI同士で話しています…",
    duoConfirm: "あなたの AI が次の文を相手に送ろうとしています。知られたくないことが入っていないか見てから送ってください", ok: "送る", ng: "やめる",
    who: { me: "あなた", "peer-ai": (n) => `${n} の AI`, "my-ai": "あなたの AI", incoming: (n) => `${n} の AI からのお願い` },
    state: { sending: "送っています", sent: "相手の Mac がまだ受け取っていません（相手がアプリを開くと届きます）", "waiting-approval": "相手の OK 待ち",
      working: "相手の AI が考えています", completed: "", failed: "送れませんでした", rejected: "断られました" },
    notes: { rejected: "相手が断りました", failed: "相手の AI が答えられませんでした", timeout: "時間内に答えが来ませんでした", stopped: "止めました",
      "decided-once": "今回だけ OK しました", "decided-always": "いつでも OK にしました", "decided-deny": "断りました", "decided-deny-always": "今後も断るようにしました",
      "auto-allow": "いつでも OK の設定なので、あなたの AI が答えています", "auto-deny": "断る設定なので断りました", answered: "あなたの AI が答えを返しました", "answer-failed": "あなたの AI が答えられませんでした" },
    duoStartNote: (g, r) => `AI同士の会話を始めました（${r}往復まで）\n${g}`, summary: "まとめ",
    ask: (n, m) => `${n} の AI があなたの AI にお願いしています（${m === "write" ? "ファイルを作るかも" : "調べて答えるだけ"}）`,
    once: "今回だけ OK", always: "いつでも OK", deny: "断る",
    oldTitle: "古い Elefant Relay が動いています", oldLead: "このままだと友達からのお願いを受け取れないことがあります。止めてよければ「止める」を押してください。", stop: "止める",
    otherNote: "Claude Code（または別の画面）がお願いを受け取っています。ここでも OK・断るができます。",
    check: "確認番号", rename: "名前を変える",
  },
  en: {
    friends: "Friends", add: "Connect a friend", connected: "Ready to receive", notListening: "Not receiving",
    otherListening: "Receiving in Claude Code", chat: "Talk to their AI", duo: "Let the AIs talk",
    welcome: "Welcome to Elefant Relay", welcomeLead: "Your AI can ask a friend's AI for help and get the answer back. Everything stays encrypted.",
    yourName: "Your name (your friends see it)", haveCode: "I got an invite code", haveCodeSub: "Just paste it",
    willInvite: "I'll invite someone", willInviteSub: "Needs a relay URL", code: "Invite code", relay: "Relay URL",
    relayHint: "No relay? Ask the person inviting you for a code instead.",
    start: "Start", cancel: "Close", noAgent: "Neither Claude Code nor Codex was found on this Mac. Install one and open the app again.",
    agentLine: (a) => `Requests are answered by ${a === "codex" ? "Codex" : "Claude Code"}`,
    connectTitle: "Connect a friend", makeCode: "Make a code", enterCode: "Enter a code",
    makeLead: "Send this code to your friend. It works once, for 10 minutes.", copy: "Copy", copied: "Copied",
    waiting: "Waiting for them to join…", enterLead: "Paste the code your friend sent you.", join: "Connect",
    paired: (n) => `Connected with ${n}`, checkLead: "If their screen shows the same number, it is really them.", done: "OK",
    emptyTitle: "Connect with a friend", emptyLead: "Use “Connect a friend” at the bottom left to make or enter a code.",
    placeholder: (n) => `Talk to ${n}'s AI (${S?.platform === "win32" ? "Ctrl+Enter" : "⌘Enter"} to send)`, send: "Send",
    duoPlaceholder: () => "What should the two AIs work out? (e.g. pick 3 times for next week's meeting)", rounds: (k) => `up to ${k} turns`, roundsLabel: "Max turns",
    duoStart: "Start", duoStop: "Stop", duoRunning: "The AIs are talking…",
    duoConfirm: "Your AI wants to send this. Check that nothing private is in it before sending", ok: "Send", ng: "Cancel",
    who: { me: "You", "peer-ai": (n) => `${n}'s AI`, "my-ai": "Your AI", incoming: (n) => `Request from ${n}'s AI` },
    state: { sending: "Sending", sent: "Not picked up yet (it arrives when they open the app)", "waiting-approval": "Waiting for their OK",
      working: "Their AI is thinking", completed: "", failed: "Could not send", rejected: "Declined" },
    notes: { rejected: "They declined", failed: "Their AI could not answer", timeout: "No answer in time", stopped: "Stopped",
      "decided-once": "Allowed once", "decided-always": "Always allowed from now on", "decided-deny": "Declined", "decided-deny-always": "Will always decline",
      "auto-allow": "Allowed by your settings — your AI is answering", "auto-deny": "Declined by your settings", answered: "Your AI sent its answer", "answer-failed": "Your AI could not answer" },
    duoStartNote: (g, r) => `The AIs started talking (up to ${r} turns)\n${g}`, summary: "Summary",
    ask: (n, m) => `${n}'s AI is asking yours (${m === "write" ? "may create files" : "look up and answer only"})`,
    once: "Allow once", always: "Always allow", deny: "Decline",
    oldTitle: "An older Elefant Relay is running", oldLead: "It may stop requests from reaching you. Press Stop if that is OK.", stop: "Stop",
    otherNote: "Claude Code (or another window) is receiving requests. You can still allow or decline them here.",
    check: "Check number", rename: "Rename",
  },
};

let S = null;          // state from the app
let L = T.ja;
let cur = null;        // selected friend
let tab = "chat";
let chat = { messages: [], duo: { running: false, waiting: null } };
let modal = null;      // { kind, ... }
const drafts = { chat: {}, duo: {} };
let roundsSel = 3;

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) el.append(typeof c === "string" ? document.createTextNode(c) : c);
  return el;
}

async function call(name, arg) {
  const r = await R[name](arg);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

let lastSig = "";
async function refresh(poll = false) {
  try {
    S = await call("state");
    L = T[S.lang] || T.en;
    if (cur && !S.peers.some((p) => p.name === cur)) cur = null;
    if (!cur && S.peers[0]) cur = S.peers[0].name;
    chat = cur ? await call("chat", { peer: cur }) : { messages: [], duo: { running: false, waiting: null } };
    if (modal?.kind === "connect" && modal.invite && S.peers.length > modal.before) {
      const p = S.peers[S.peers.length - 1];
      modal = { kind: "paired", peer: p.name, safety: p.safety };
      cur = p.name;
    }
  } catch (e) { console.error(e); }
  const sig = JSON.stringify([S, chat, modal?.kind]);
  if (poll && sig === lastSig) return;
  lastSig = sig;
  render();
}

function keepFocus(fn) {
  const a = document.activeElement;
  const id = a && a.id;
  const sel = a && "selectionStart" in a ? [a.selectionStart, a.selectionEnd] : null;
  const scroll = document.querySelector(".msgs");
  const atBottom = !scroll || scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
  const top = scroll ? scroll.scrollTop : 0;
  fn();
  if (id) { const el = document.getElementById(id); if (el) { el.focus(); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* not text */ } } }
  const s2 = document.querySelector(".msgs");
  if (s2) s2.scrollTop = atBottom ? s2.scrollHeight : top;
}

function render() {
  keepFocus(() => {
    const root = document.getElementById("app");
    root.replaceChildren();
    if (!S) return;
    document.documentElement.lang = S.lang;
    root.append(h("div", { class: "layout" }, side(), main()));
    if (!S.setUp && !modal) modal = { kind: "welcome", mode: "code", name: "", code: "", relay: "" };
    if (modal) root.append(overlay());
  });
}

function side() {
  const l = S.listener;
  const live = l.state === "mine" ? l.connected : l.state === "other" ? l.connected : false;
  const line = l.state === "other" ? L.otherListening : live ? L.connected : L.notListening;
  return h("aside", { class: "side" },
    h("div", { class: "drag" }),
    h("div", { class: "brand" }, h("b", {}, "Elefant Relay"),
      S.me ? h("div", { class: "me" }, h("span", { class: `dot${live ? " on" : ""}` }), `${S.me.name} · ${line}`) : null),
    h("h4", {}, L.friends.toUpperCase()),
    h("div", { class: "peers" }, S.peers.map((p) => {
      const n = S.pending.filter((x) => x.peer === p.name).length;
      return h("button", { class: `peer${p.name === cur ? " active" : ""}`, onclick: () => { cur = p.name; tab = "chat"; refresh(); } },
        h("span", { class: "avatar" }, p.name.slice(0, 1).toUpperCase()),
        h("span", {}, p.name, h("small", {}, `${L.check} ${p.safety}`)),
        n ? h("span", { class: "badge" }, String(n)) : null);
    })),
    S.setUp ? h("button", { class: "add primary", onclick: () => { modal = { kind: "connect", tab: "make" }; render(); } }, `＋ ${L.add}`) : null,
  );
}

function banners() {
  const out = [];
  const l = S.listener;
  if (l.state === "old") {
    out.push(h("div", { class: "banner warn" }, h("p", {}, h("b", {}, L.oldTitle), h("br"), L.oldLead),
      l.command ? h("pre", {}, `pid ${l.pid}  ${l.command}`) : null,
      h("div", { class: "row" }, h("button", { class: "primary", onclick: async () => { await call("stopOld", { pid: l.pid }); refresh(); } }, L.stop))));
  } else if (l.state === "other") {
    out.push(h("div", { class: "banner" }, h("p", { class: "small m0" }, L.otherNote)));
  }
  for (const x of S.pending) {
    out.push(h("div", { class: "banner" },
      h("p", {}, h("b", {}, L.ask(x.peer, x.mode))),
      h("div", { class: "req" }, x.text.split("\n---\n")[0]),
      h("div", { class: "row" },
        h("button", { class: "primary", onclick: () => decide(x.id, "once") }, L.once),
        h("button", { onclick: () => decide(x.id, "always") }, L.always),
        h("button", { class: "danger", onclick: () => decide(x.id, "deny") }, L.deny))));
  }
  return out;
}

async function decide(id, decision) { await call("decide", { id, decision }); refresh(); }

function main() {
  const peer = S.peers.find((p) => p.name === cur);
  if (!peer) {
    return h("main", { class: "main" }, h("div", { class: "drag" }), ...banners(),
      h("div", { class: "empty" }, h("h3", {}, L.emptyTitle), h("p", {}, L.emptyLead),
        S.setUp ? h("p", { class: "small" }, L.agentLine(S.agent)) : null));
  }
  return h("main", { class: "main" },
    h("div", { class: "drag" }),
    h("div", { class: "head" },
      h("div", {}, h("h2", {}, peer.name), h("div", { class: "lead" }, `${L.check} ${peer.safety} · ${L.agentLine(S.agent)}`)),
      h("div", { class: "tabs" },
        h("button", { class: tab === "chat" ? "on" : "", onclick: () => { tab = "chat"; render(); } }, L.chat),
        h("button", { class: tab === "duo" ? "on" : "", onclick: () => { tab = "duo"; render(); } }, L.duo))),
    ...banners(),
    h("div", { class: "msgs" }, chat.messages.map((m) => message(m, peer.name))),
    tab === "chat" ? composer(peer.name) : duoBar(peer.name),
  );
}

function message(m, peer) {
  if (m.role === "note") {
    const base = L.notes[m.kind] || "";
    return h("div", { class: "note" }, [base, m.text && m.kind !== "auto-allow" ? m.text.slice(0, 600) : ""].filter(Boolean).join("\n"));
  }
  if (m.role === "duo-start") return h("div", { class: "note" }, L.duoStartNote(m.text, m.rounds));
  if (m.role === "summary") return h("div", { class: "summary" }, h("b", {}, L.summary), m.text);
  const whoF = L.who[m.role];
  const who = typeof whoF === "function" ? whoF(peer) : whoF;
  const st = (m.role === "me" || m.role === "my-ai") && m.status && m.status !== "completed"
    ? h("div", { class: "state" }, m.error ? `${L.state.failed}: ${m.error}` : (L.state[m.status] ?? m.status)) : null;
  return h("div", { class: `msg ${m.role}` }, h("div", { class: "who" }, who), h("div", { class: "body" }, m.text), st);
}

function composer(peer) {
  const send = async () => {
    const text = (drafts.chat[peer] || "").trim();
    if (!text) return;
    drafts.chat[peer] = "";
    await call("send", { peer, text });
    refresh();
  };
  return h("div", { class: "compose" },
    h("textarea", { id: "ta-chat", placeholder: L.placeholder(peer), value: drafts.chat[peer] || "",
      oninput: (e) => { drafts.chat[peer] = e.target.value; },
      onkeydown: (e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } } }),
    h("button", { class: "primary", onclick: send }, L.send));
}

function duoBar(peer) {
  if (chat.duo.waiting) {
    return h("div", { class: "banner" }, h("p", {}, L.duoConfirm), h("div", { class: "req" }, chat.duo.waiting),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: async () => { await call("duoApprove", { peer, ok: true }); refresh(); } }, L.ok),
        h("button", { onclick: async () => { await call("duoApprove", { peer, ok: false }); refresh(); } }, L.ng)));
  }
  if (chat.duo.running) {
    return h("div", { class: "compose" }, h("div", { class: "small grow" }, L.duoRunning),
      h("button", { class: "danger", onclick: async () => { await call("duoStop", { peer }); refresh(); } }, L.duoStop));
  }
  return h("div", { class: "duo" },
    h("textarea", { id: "ta-duo", placeholder: L.duoPlaceholder(peer), value: drafts.duo[peer] || "", oninput: (e) => { drafts.duo[peer] = e.target.value; } }),
    h("div", { class: "rounds" }, h("small", {}, L.roundsLabel),
      h("div", { class: "tabs", role: "group", "aria-label": L.roundsLabel }, [2, 3, 4, 6].map((k) => h("button", {
        class: k === roundsSel ? "on" : "", "data-k": String(k), title: L.rounds(k), "aria-pressed": k === roundsSel ? "true" : "false",
        onclick: () => { roundsSel = k; render(); } }, String(k))))),
    h("button", { class: "primary", onclick: async () => {
      const goal = (drafts.duo[peer] || "").trim();
      if (!goal) return;
      try { await call("duoStart", { peer, goal, rounds: roundsSel }); drafts.duo[peer] = ""; } catch (e) { alert(e.message); }
      refresh();
    } }, L.duoStart));
}

function overlay() {
  const m = modal;
  const close = () => { modal = null; render(); };
  let body;
  if (m.kind === "welcome") {
    const err = h("div", { class: "err" });
    const go = async () => {
      err.textContent = "";
      try {
        const r = await call("setup", { name: m.name, code: m.mode === "code" ? m.code : "", relay: m.mode === "invite" ? m.relay : "" });
        if (r && r.peer) { modal = { kind: "paired", peer: r.peer, safety: r.safety }; cur = r.peer; }
        else modal = { kind: "connect", tab: "make" };
        refresh();
      } catch (e) { err.textContent = e.message; }
    };
    body = [
      h("h3", {}, L.welcome), h("p", { class: "lead" }, L.welcomeLead),
      !S.agents.claude && !S.agents.codex ? h("p", { class: "err" }, L.noAgent) : null,
      h("label", {}, L.yourName), h("input", { id: "in-name", value: m.name, oninput: (e) => { m.name = e.target.value; } }),
      h("label", {}, " "),
      h("div", { class: "choice" },
        h("button", { class: m.mode === "code" ? "on" : "", onclick: () => { m.mode = "code"; render(); } }, L.haveCode, h("small", {}, L.haveCodeSub)),
        h("button", { class: m.mode === "invite" ? "on" : "", onclick: () => { m.mode = "invite"; render(); } }, L.willInvite, h("small", {}, L.willInviteSub))),
      m.mode === "code"
        ? [h("label", {}, L.code), h("input", { id: "in-code", placeholder: "K7Q-M2X@relay.example.workers.dev", value: m.code, oninput: (e) => { m.code = e.target.value; } })]
        : [h("label", {}, L.relay), h("input", { id: "in-relay", placeholder: "https://elefant-relay.<you>.workers.dev", value: m.relay, oninput: (e) => { m.relay = e.target.value; } }), h("p", { class: "small" }, L.relayHint)],
      err,
      h("div", { class: "row" }, h("button", { class: "primary", onclick: go, disabled: !S.agents.claude && !S.agents.codex }, L.start)),
    ];
  } else if (m.kind === "connect") {
    const err = h("div", { class: "err" });
    body = [h("h3", {}, L.connectTitle),
      h("div", { class: "tabs inline" },
        h("button", { class: m.tab === "make" ? "on" : "", onclick: () => { m.tab = "make"; render(); } }, L.makeCode),
        h("button", { class: m.tab === "enter" ? "on" : "", onclick: () => { m.tab = "enter"; render(); } }, L.enterCode))];
    if (m.tab === "make") {
      if (!m.invite && !m.loading && !m.error) {
        m.loading = true;
        call("invite").then((r) => { if (modal !== m) return; m.loading = false; m.invite = r.code; m.before = S.peers.length; render(); })
          .catch((e) => { m.loading = false; m.error = e.message; render(); });
      }
      if (m.invite) {
        const copyBtn = h("button", { onclick: async () => { await call("copy", { text: m.invite }); copyBtn.textContent = L.copied; } }, L.copy);
        body.push(h("p", { class: "lead" }, L.makeLead), h("div", { class: "code long" }, m.invite),
          h("p", { class: "small" }, L.waiting), h("div", { class: "row" }, h("button", { class: "ghost", onclick: close }, L.cancel), copyBtn));
      } else {
        body.push(h("p", { class: "lead" }, L.makeLead), h("div", { class: "code" }, "…"), m.error ? h("div", { class: "err" }, m.error) : null,
          h("div", { class: "row" }, h("button", { class: "ghost", onclick: close }, L.cancel)));
      }
    } else {
      body.push(h("p", { class: "lead" }, L.enterLead),
        h("input", { id: "in-join", placeholder: "K7Q-M2X@relay.example.workers.dev", value: m.code || "", oninput: (e) => { m.code = e.target.value; } }), err,
        h("div", { class: "row" }, h("button", { class: "ghost", onclick: close }, L.cancel),
          h("button", { class: "primary", onclick: async () => {
            try { const r = await call("join", { code: m.code || "" }); modal = { kind: "paired", peer: r.peer, safety: r.safety }; cur = r.peer; refresh(); }
            catch (e) { err.textContent = e.message; }
          } }, L.join)));
    }
  } else if (m.kind === "paired") {
    body = [h("h3", {}, L.paired(m.peer)), h("p", { class: "lead" }, L.checkLead), h("div", { class: "check" }, m.safety),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: close }, L.done))];
  }
  return h("div", { class: "overlay" }, h("div", { class: "modal" }, ...body.flat()));
}

R.onChange(() => refresh(true));
refresh();
setInterval(() => refresh(true), 1500);
