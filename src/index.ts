import { config, ProxiiService } from "./config";

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

async function proxyRequest(request: Request, target: string) {
  const headers = new Headers(request.headers);
  headers.delete("Host");

  try {
    const originResponse = await fetch(target, {
      ...request,
      headers,
    });

    return new Response(originResponse.body, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: cleanHeaders(originResponse.headers),
    });
  } catch (e) {
    console.error("[proxii] error fetching", target);
    console.error(e);
    return Response.json({ message: "service unavailable" }, { status: 502 });
  }
}

async function proxyWebsocket(
  request: Request,
  server: Bun.Server,
  target: string
) {
  const upstream = new WebSocket(target);

  if (!server.upgrade(request, { data: { upstream } })) {
    return Response.json(
      { message: "could not upgrade to websocket" },
      { status: 500 }
    );
  }

  return;
}

function prepareTargetUrl(path: string, service: ProxiiService) {
  const trimmedPath =
    service.basePath && service.trimBase
      ? path.slice(service.basePath.length) || "/"
      : path;

  const originHasSlash = service.origin.endsWith("/");
  const pathHasSlash = trimmedPath.startsWith("/");

  return originHasSlash
    ? service.origin + (pathHasSlash ? trimmedPath.slice(1) : trimmedPath)
    : service.origin + (pathHasSlash ? trimmedPath : "/" + trimmedPath);
}

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

function cleanHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);

  cleaned.delete("content-encoding");
  cleaned.delete("content-length");
  cleaned.delete("transfer-encoding");
  cleaned.delete("connection");

  return cleaned;
}
