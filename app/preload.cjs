const { contextBridge, ipcRenderer } = require("electron");
const call = (name) => (arg) => ipcRenderer.invoke(`relay:${name}`, arg);
const names = ["state", "setup", "rename", "setAgent", "invite", "join", "decide", "stopOld", "chat", "send", "duoStart", "duoStop", "duoApprove", "copy"];
const api = Object.fromEntries(names.map((n) => [n, call(n)]));
api.onChange = (fn) => { ipcRenderer.on("relay:changed", () => fn()); };
contextBridge.exposeInMainWorld("relay", api);
