// A relay in front of the relay that answers late, to make screen redraws overlap with clicks.
// POST /__delay {"ms":500}   sets the delay for every later request (default 0)
import { createServer, request } from "node:http";
import { connect } from "node:net";

export function startProxy(target, port) {
  let delay = 0;
  const srv = createServer((req, res) => {
    if (req.url === "/__delay") {
      let b = "";
      req.on("data", (d) => { b += d; });
      req.on("end", () => { delay = Number(JSON.parse(b || "{}").ms ?? 0); res.end("ok"); });
      return;
    }
    const chunks = [];
    req.on("data", (d) => chunks.push(d));
    req.on("end", () => setTimeout(() => {
      const u = new URL(target);
      const up = request({ host: u.hostname, port: u.port, path: req.url, method: req.method, headers: { ...req.headers, host: u.host } }, (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers);
        r.pipe(res);
      });
      up.on("error", () => { res.writeHead(502); res.end(); });
      up.end(Buffer.concat(chunks));
    }, delay));
  });
  // the listener's live connection (WebSocket) passes straight through, not delayed
  srv.on("upgrade", (req, sock, head) => {
    const u = new URL(target);
    const up = connect(Number(u.port), u.hostname, () => {
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries({ ...req.headers, host: u.host }).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
      up.write(head);
      sock.pipe(up).pipe(sock);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });
  return new Promise((r) => srv.listen(port, "127.0.0.1", () => r(srv)));
}
