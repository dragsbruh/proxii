import { config, ProxiiService } from "./config";
import { readdir, exists } from "fs/promises";
import { join } from "path";

console.log("[proxii] server starting on port", config.port);

Bun.serve<{ target: URL; upstream: WebSocket; service: ProxiiService }, {}>({
  port: config.port,
  idleTimeout: 60,

  async fetch(request, server) {
    const url = new URL(request.url);
    const target = new URL(url);

    const service = config.services.find((service) => {
      const hostAllowed: boolean = service.host
        ? (Array.isArray(service.host) ? service.host : [service.host])
            .map((host) => host.split(":")[0])
            .includes(url.host.split(":")[0])
        : true;

      const basePathAllowed = service.basePath
        ? url.pathname.startsWith(service.basePath) &&
          ["", "/", undefined].includes(
            url.pathname.charAt(service.basePath.length)
          )
        : true;

      return hostAllowed && basePathAllowed;
    });

    if (!service) {
      if (config.publicDir) {
        const response = await serveStatic(config.publicDir, target.pathname);
        if (response) return response;
      }
      return new Response("service not found", { status: 502 });
    }

    if (
      service.enforceTrailingSlash &&
      target.pathname === service.basePath &&
      !target.pathname.endsWith("/")
    ) {
      return Response.redirect(target.pathname + "/", 302);
    }

    if (service.trimBase && service.basePath) {
      target.pathname = target.pathname.slice(service.basePath.length);
    }

    if (service.target.serveStatic) {
      const response = await serveStatic(
        service.target.staticDir,
        target.pathname,
        true
      );
      return response ?? new Response("file not found", { status: 404 });
    }

    const origin = new URL(service.target.origin);

    target.protocol = origin.protocol;
    target.host = origin.host;

    const forwardedProto =
      request.headers.get("x-forwarded-proto") ??
      (target.protocol.startsWith("https") ? "https" : "http");

    const headers = new Headers(request.headers);
    headers.set("x-forwarded-proto", forwardedProto);
    headers.set("x-real-ip", server.requestIP(request)?.address ?? "anon");

    const isWebsocket =
      headers.get("connection")?.toLowerCase().includes("upgrade") &&
      headers.get("upgrade")?.toLowerCase() === "websocket";

    if (isWebsocket) {
      if (!server.upgrade(request, { data: { target, service } })) {
        return new Response("could not upgrade connection to websocket", {
          status: 426,
        });
      }
      return undefined;
    }

    let response: Response;
    try {
      response = await fetch(target, {
        method: request.method,
        body: ["GET", "HEAD", "OPTIONS"].includes(request.method)
          ? undefined
          : request.body,
        redirect: "manual",
        signal: request.signal,
        headers,
      });
    } catch (e) {
      console.error(`[proxii] could not connect to service ${service.name}`);
      console.error(e);
      return new Response("service is unreachable", { status: 502 });
    }

    const responseHeaders = new Headers(response.headers);

    responseHeaders.delete("content-encoding");
    responseHeaders.delete("content-length");

    const rawSetCookies = response.headers.getAll("set-cookie");
    responseHeaders.delete("set-cookie");

    for (const cookie of rawSetCookies) {
      const rewritten = rewriteSetCookiePath(cookie, service.basePath ?? "/");
      responseHeaders.append("set-cookie", rewritten);
    }

    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  },

  websocket: {
    open(ws) {
      try {
        ws.data.upstream = new WebSocket(ws.data.target);
      } catch (e) {
        console.error(
          `[proxii] could not connect to service ${ws.data.service.name}`
        );
        console.error(e);
        ws.close(1013, "service is unreachable");
        return;
      }
      ws.data.upstream.onclose = (e) => ws.close(e.code, e.reason);
      ws.data.upstream.onmessage = (e) => ws.send(e.data);
    },
    message(ws, message) {
      ws.data.upstream.send(message);
    },
    close(ws, code, reason) {
      ws.data.upstream.close(code, reason);
    },
  },
});

function rewriteSetCookiePath(cookie: string, basePath: string): string {
  const normalizedBase = basePath.endsWith("/")
    ? basePath.slice(0, -1)
    : basePath;

  return cookie.replace(/(?<=^|;\s*)path=(\/[^;]*)/i, (_match, pathValue) => {
    if (pathValue.startsWith(normalizedBase)) {
      return `Path=${pathValue}`;
    }

    const newPath = `${normalizedBase}${pathValue}`.replace(/\/{2,}/g, "/");
    return `Path=${newPath}`;
  });
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  directoryListing: boolean = false
) {
  const filePath = join(staticDir, pathname);

  const file = Bun.file(filePath);
  if (!filePath.startsWith(staticDir) || !(await exists(filePath))) {
    return null;
  }

  const stat = await file.stat();
  if (stat.isDirectory() && directoryListing) {
    const contents = ["..", ...(await readdir(filePath))]
      .map((file) => `<a href="${join(pathname, file)}">${file}</a>`)
      .join("<br>");
    return new Response(contents, {
      headers: {
        "Content-Type": "text/html",
      },
    });
  } else if (!stat.isFile()) {
    return null;
  }

  return new Response(file);
}
