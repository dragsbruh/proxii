import * as setCookieLib from "set-cookie-parser";
import cookieLib from "cookie";

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

    const [needsRedirect, service] = matchService(
      url.host,
      url.pathname,
      config.services
    );
    if (needsRedirect) {
      return Response.redirect(service, 307);
    }

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

    const forwardedProto =
      request.headers.get("x-forwarded-proto") ??
      (target.protocol.replace(":", "") === "https" ? "https" : "http");

    if (service.enforceSecure && forwardedProto === "http") {
      url.protocol = "https:";
      return Response.redirect(url, 307);
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

    if (service.basePath) {
      const rawSetCookies = response.headers.getAll("set-cookie");
      responseHeaders.delete("set-cookie");

      for (const cookieRaw of rawSetCookies) {
        const cookie = setCookieLib.parseString(cookieRaw);

        if (!cookie.path) {
          cookie.path = service.basePath;
        } else {
          const normalizedCookiePath = cookie.path.endsWith("/")
            ? cookie.path
            : cookie.path + "/";
          cookie.path = normalizedCookiePath.startsWith(service.basePath)
            ? cookie.path
            : join(service.basePath, cookie.path);
        }

        const isolated = cookieLib.serialize(
          cookie.name,
          cookie.value,
          cookie as any
        );

        responseHeaders.append("set-cookie", isolated);
      }
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

    const file404 = Bun.file(join(filePath, "_404.html"));
    const fileIndex = Bun.file(join(filePath, "index.html"));
    const fileFallback = Bun.file(join(filePath, "_fallback.html"));

    if (await fileIndex.exists()) return new Response(fileIndex);
    else if (await fileFallback.exists()) return new Response(fileFallback);
    else if (await file404.exists())
      return new Response(file404, { status: 404 });
    else if (directoryListing) {
      return directoryListingTemplate(pathname, children, filePath, pathPrefix);
    } else {
      return null;
    }
  } else if (stat.isFile()) {
    return new Response(file);
  }

  return null;
}

async function directoryListingTemplate(
  currentPath: string,
  children: string[],
  directoryPath: string,
  pathPrefix?: string
) {
  const html = [
    `<h1>Index of ${currentPath}</h1>`,
    `<ul>`,

    ...(currentPath !== "/" ? [`<li><a href="../">..</a></li>`] : []),
  ];

  for (const child of children) {
    const slash = (
      await Bun.file(join(directoryPath, child)).stat()
    ).isDirectory()
      ? "/"
      : "";

    const href = join(pathPrefix ?? "", currentPath, child);
    const elem = `<li><a href="${href}${slash}">${child}${slash}</a></li>`;

    html.push(elem);
  }

  html.push(`</ul>`);

  return new Response(html.join("\n"), {
    headers: { "Content-Type": "text/html" },
  });
}

// returns [false, service] if we did successfully find service
//         [true, target] if we need to redirect (to enforce trailing slash)
//         [false, null] if we did not find any service
function matchService(
  desiredHost: string,
  requestedPath: string,
  services: ProxiiService[]
): [false, ProxiiService | null] | [true, string] {
  const normalizedRequestedPath = requestedPath.endsWith("/")
    ? requestedPath
    : requestedPath + "/";

  for (const service of services) {
    let hostAllowed = service.host === undefined;
    if (service.host) {
      const matchedHost = service.host.find((definedHost) => {
        if (definedHost.includes(":")) {
          return definedHost === desiredHost;
        } else {
          return definedHost === desiredHost.split(":")[0];
        }
      });

      hostAllowed = matchedHost !== undefined;
    }

    if (!hostAllowed) continue;

    let pathAllowed = service.basePath === undefined;
    if (service.basePath) {
      pathAllowed = normalizedRequestedPath.startsWith(service.basePath);
      if (
        pathAllowed &&
        service.enforceTrailingSlash &&
        requestedPath.charAt(service.basePath.length - 1) !== "/"
      ) {
        return [true, service.basePath];
      }
    }

    if (pathAllowed) return [false, service];
  }
  return [false, null];
}
