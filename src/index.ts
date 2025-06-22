import { join, resolve } from "path";
import { config } from "./config";
import { exists } from "fs/promises";
import { stat } from "fs/promises";
import { readdir } from "fs/promises";

console.log("[proxii] server starting on port", config.port);

Bun.serve<{ target: URL; upstream: WebSocket }, {}>({
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

    if (!service) return new Response("service not found", { status: 502 });

    if (service.trimBase && service.basePath) {
      target.pathname = target.pathname.replace(service.basePath, "");
    }

    if (service.target.serveStatic) {
      const filePath = join(service.target.staticDir, target.pathname);

      const file = Bun.file(filePath);
      if (
        !filePath.startsWith(service.target.staticDir) ||
        !(await exists(filePath))
      ) {
        return new Response("file not found", { status: 404 });
      }

      const stat = await file.stat();
      if (stat.isDirectory()) {
        
        const contents = ["..", ...(await readdir(filePath))]
          .map(
            (file) => `<a href="${join(url.pathname, file)}">${file}</a>`
          )
          .join("<br>");
        return new Response(contents, {
          headers: {
            "Content-Type": "text/html",
          },
        });
      } else if (!stat.isFile()) {
        return new Response("file not found", { status: 404 });
      }

      return new Response(file);
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
      if (!server.upgrade(request, { data: { target } })) {
        return new Response("could not upgrade connection to websocket", {
          status: 426,
        });
      }
      return undefined;
    }

    const response = await fetch(target, {
      method: request.method,
      body: ["GET", "HEAD", "OPTIONS"].includes(request.method)
        ? undefined
        : request.body,
      redirect: "manual",
      signal: request.signal,
      headers,
    });
    response.headers.delete("content-encoding");
    response.headers.delete("content-length");
    return response;
  },

  websocket: {
    open(ws) {
      ws.data.upstream = new WebSocket(ws.data.target);
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
