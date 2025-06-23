import { config, ProxiiService } from "./config";
import { readdir, exists } from "fs/promises";
import { join, resolve } from "path";

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
        const response = await serveStatic(
          config.publicDir,
          target.pathname,
          false
        );
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
        true,
        service.basePath
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
      ws.data.upstream.onerror = (e) => {
        console.error("[proxii] websocket upstream error");
        console.error(e);
        ws.close(1011, "webSocket upstream error");
      };
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

  if (!/;\s*path=/i.test(cookie)) {
    return `${cookie}; Path=${normalizedBase || "/"}`;
  }

  return cookie.replace(/(?<=^|;\s*)path=([^;]*)/i, (_match, pathValue) => {
    if (pathValue.startsWith(normalizedBase)) {
      return `Path=${pathValue}`;
    }

    if (pathValue === "/") {
      return `Path=${normalizedBase || "/"}`;
    }

    const newPath = `${normalizedBase}${pathValue}`.replace(/\/{2,}/g, "/");
    return `Path=${newPath}`;
  });
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  directoryListing: boolean = false,
  pathPrefix?: string
) {
  pathname = decodeURIComponent(pathname);

  const filePath = resolve(staticDir, "." + pathname);
  if (!filePath.startsWith(staticDir)) {
    return new Response("403 Forbidden", { status: 403 });
  }

  if (!(await exists(filePath))) return null;

  const file = Bun.file(filePath);
  const stat = await file.stat();

  if (stat.isDirectory()) {
    const children = await readdir(filePath);

    const has404 = children.includes("404.html");
    const hasIndex = children.includes("index.html");
    const hasFallback = children.includes("fallback.html");

    if (hasIndex) return new Response(Bun.file(join(filePath, "index.html")));
    else if (hasFallback) {
      return new Response(Bun.file(join(filePath, "fallback.html")));
    } else if (has404) {
      return new Response(Bun.file(join(filePath, "404.html")), {
        status: 404,
      });
    } else if (directoryListing) {
      const html = [
        `<h1>Index of ${pathname}</h1>`,
        `<ul>`,

        ...(pathname !== "/" ? [`<li><a href="../">..</a></li>`] : []),
      ];

      for (const child of children) {
        const slash = (
          await Bun.file(join(filePath, child)).stat()
        ).isDirectory()
          ? "/"
          : "";

        const href = join(pathPrefix ?? "", pathname, child);
        const elem = `<li><a href="${href}${slash}">${child}${slash}</a></li>`;

        html.push(elem);
      }

      html.push(`</ul>`);

      return new Response(html.join("\n"), {
        headers: { "Content-Type": "text/html" },
      });
    } else {
      return null;
    }
  } else if (stat.isFile()) {
    return new Response(file);
  }

  return null;
}
