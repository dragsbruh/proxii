import { proxyRequest, proxyWebsocket } from "./proxy";
import { prepareTargetUrl } from "./utils";
import { config } from "./config";

console.log("[proxii] server starting on port", config.port);

Bun.serve<{ upstream: WebSocket }, {}>({
  port: config.port,
  async fetch(request, server) {
    const host = request.headers.get("Host");
    const path = new URL(request.url).pathname;

    const service = findService(host, path);
    if (service) {
      const target = prepareTargetUrl(path, service);

      const connection = request.headers.get("Connection")?.toLowerCase();
      const upgradeType = request.headers.get("Upgrade")?.toLowerCase();

      if (connection?.includes("upgrade") && upgradeType === "websocket") {
        return proxyWebsocket(request, server, target);
      }
      return proxyRequest(request, target);
    }

    return Response.json({ message: "service not found" }, { status: 502 });
  },
  websocket: {
    message(ws, message) {
      ws.data.upstream.send(message);
    },
    open(ws) {
      ws.data.upstream.onerror = (e) => ws.close();
      ws.data.upstream.onmessage = (e) => ws.send(e.data);
      ws.data.upstream.onclose = (e) => ws.close();
    },
    close(ws, code, reason) {
      ws.data.upstream.close(code, reason);
    },
  },
});

function findService(host: string | null, path: string) {
  for (const service of config.services) {
    const matchesHost =
      !service.host ||
      (host && Array.isArray(service.host) && service.host.includes(host)) ||
      service.host === host;

    const matchesPath = !service.basePath || path.startsWith(service.basePath);

    if (matchesHost && matchesPath) return service;
  }
  return null;
}
