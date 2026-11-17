import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Files travel with Syncthing (device to device, TLS), not through the relay.
 * elefant-relay only talks to the local Syncthing's REST API: it adds the peer's device
 * and one shared folder. Syncthing is optional; requests work without it.
 */
export interface SyncthingApi { url: string; key: string }

function configPaths(): string[] {
  const h = homedir();
  if (process.platform === "darwin") return [join(h, "Library", "Application Support", "Syncthing", "config.xml")];
  if (process.platform === "win32") return [join(process.env.LOCALAPPDATA ?? join(h, "AppData", "Local"), "Syncthing", "config.xml")];
  return [join(h, ".local", "state", "syncthing", "config.xml"), join(h, ".config", "syncthing", "config.xml")];
}

/** Find the local Syncthing: env first (ELEFANT_RELAY_SYNCTHING_URL / _KEY), then its config.xml. */
export function findSyncthing(): SyncthingApi | null {
  const envUrl = process.env.ELEFANT_RELAY_SYNCTHING_URL;
  const envKey = process.env.ELEFANT_RELAY_SYNCTHING_KEY;
  if (envUrl && envKey) return { url: envUrl.replace(/\/+$/, ""), key: envKey };
  for (const f of configPaths()) {
    if (!existsSync(f)) continue;
    const xml = readFileSync(f, "utf8");
    const gui = xml.match(/<gui\b([^>]*)>([\s\S]*?)<\/gui>/);
    const key = gui?.[2]?.match(/<apikey>([^<]+)<\/apikey>/)?.[1];
    const addr = gui?.[2]?.match(/<address>([^<]+)<\/address>/)?.[1];
    if (!key || !addr) continue;
    const tls = /tls="true"/.test(gui?.[1] ?? "");
    const host = addr.replace(/^0\.0\.0\.0/, "127.0.0.1").replace(/^\[::\]/, "127.0.0.1");
    return { url: `${tls ? "https" : "http"}://${host}`, key };
  }
  return null;
}

async function call<T>(st: SyncthingApi, method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${st.url}${path}`, {
    method,
    headers: { "X-API-Key": st.key, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404 && method === "GET") return null as T;
  if (!res.ok) throw new Error(`Syncthing ${method} ${path}: ${res.status} ${await res.text()}`);
  const t = await res.text();
  return (t ? JSON.parse(t) : null) as T;
}

export async function myDeviceId(st: SyncthingApi): Promise<string> {
  return (await call<{ myID: string }>(st, "GET", "/rest/system/status")).myID;
}

export const DEVICE_ID = /^[A-Z2-7]{7}(-[A-Z2-7]{7}){7}$/;

interface FolderCfg { id: string; label: string; path: string; type: string; devices: { deviceID: string }[] }

/** Add (or update) the peer's device and share one folder with it. Safe to call again. */
export async function shareFolder(st: SyncthingApi, o: { peerDevice: string; peerName: string; folderId: string; label: string; path: string }): Promise<void> {
  if (!DEVICE_ID.test(o.peerDevice)) throw new Error("the other side sent an invalid Syncthing device ID");
  const me = await myDeviceId(st);
  if (o.peerDevice === me) throw new Error("that is this computer's own Syncthing");
  const dev = await call<Record<string, unknown> | null>(st, "GET", `/rest/config/devices/${o.peerDevice}`);
  if (!dev) {
    await call(st, "PUT", `/rest/config/devices/${o.peerDevice}`, {
      deviceID: o.peerDevice, name: `Relay · ${o.peerName}`, addresses: ["dynamic"], autoAcceptFolders: false,
    });
  }
  const folder = await call<FolderCfg | null>(st, "GET", `/rest/config/folders/${encodeURIComponent(o.folderId)}`);
  if (folder) {
    if (!folder.devices.some((d) => d.deviceID === o.peerDevice)) {
      await call(st, "PATCH", `/rest/config/folders/${encodeURIComponent(o.folderId)}`, { devices: [...folder.devices, { deviceID: o.peerDevice }] });
    }
    return;
  }
  await call(st, "PUT", `/rest/config/folders/${encodeURIComponent(o.folderId)}`, {
    id: o.folderId, label: o.label, path: o.path, type: "sendreceive",
    devices: [{ deviceID: me }, { deviceID: o.peerDevice }],
  });
}

/** How much of the folder the peer has (0–100), or null when unknown / not connected. */
export async function completion(st: SyncthingApi, folderId: string, device: string): Promise<{ pct: number; connected: boolean } | null> {
  try {
    const c = await call<{ completion: number } | null>(st, "GET", `/rest/db/completion?folder=${encodeURIComponent(folderId)}&device=${device}`);
    const conns = await call<{ connections: Record<string, { connected: boolean }> }>(st, "GET", "/rest/system/connections");
    return c ? { pct: Math.round(c.completion), connected: conns.connections[device]?.connected === true } : null;
  } catch { return null; }
}
