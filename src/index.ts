import { proxyRequest, proxyWebsocket } from "./proxy";
import { RequestAnalytics } from "./db/schema";
import { prepareTargetUrl } from "./utils";
import { config } from "./config";
import { ulid } from "ulid";
import { datastore } from "./db/store";

console.log("[proxii] server starting on port", config.port);

Bun.serve<
  { upstream: WebSocket; analytics: RequestAnalytics; requestStart: number },
  {}
>({
  port: config.port,
  async fetch(request, server) {
    const host = request.headers.get("Host");
    const path = new URL(request.url).pathname;

    const service = findService(host, path);
    if (service) {
      const target = prepareTargetUrl(path, service);

      const connection = request.headers.get("Connection")?.toLowerCase();
      const upgradeType = request.headers.get("Upgrade")?.toLowerCase();

      const analytics: RequestAnalytics = {
        id: ulid(),
        timestamp: new Date(),
        method: request.method,
        url: request.url,
        origin: target,
        statusCode: 0,
        referer: request.headers.get("referer"),
        userAgent: request.headers.get("user-agent"),
        ipAddress: server.requestIP(request)?.address ?? "anon",
        forwardedFor: request.headers.get("x-forwarded-for") ?? "",
        bytesSent: 0,
        bytesReceived: parseInt(request.headers.get("content-length") ?? "0"),
        durationMs: 0,
      };

      if (connection?.includes("upgrade") && upgradeType === "websocket") {
        return proxyWebsocket(request, server, target, analytics);
      }
      return proxyRequest(request, target, analytics);
    }

    return Response.json({ message: "service not found" }, { status: 502 });
  },
  websocket: {
    message(ws, message) {
      ws.data.upstream.send(message);
      ws.data.analytics.bytesReceived += message.length;
    },
    open(ws) {
      ws.data.requestStart = Date.now();
      ws.data.upstream.onerror = (e) => ws.close();
      ws.data.upstream.onmessage = (e) => {
        ws.send(e.data);
        ws.data.analytics.bytesSent += getByteSize(e.data);
      };
      ws.data.upstream.onclose = (e) => ws.close();
    },
    async close(ws, code, reason) {
      ws.data.upstream.close(code, reason);
      ws.data.analytics.durationMs = Date.now() - ws.data.requestStart;

      await datastore.saveAnalyticsReport(ws.data.analytics);
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

function getByteSize(data: any): number {
  if (typeof data === "string") return data.length;
  if (data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  return 0;
}
