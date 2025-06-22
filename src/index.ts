import { config } from "./config";

console.log("[proxii] server starting on port", config.port);

Bun.serve({
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

    const origin = new URL(service.origin);

    target.protocol = origin.protocol;
    target.host = origin.host;

    if (service.trimBase && service.basePath) {
      target.pathname = target.pathname.replace(service.basePath, "");
    }

    const forwardedProto =
      request.headers.get("x-forwarded-proto") ??
      (target.protocol.startsWith("https") ? "https" : "http");

    const headers = new Headers(request.headers);
    headers.set("x-forwarded-proto", forwardedProto);
    headers.set("x-real-ip", server.requestIP(request)?.address ?? "anon");

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
});
