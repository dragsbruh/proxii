import { RequestAnalytics } from "./db/schema";
import { cleanHeaders } from "./utils";
import { datastore } from "./db/store";

export async function proxyRequest(
  request: Request,
  target: URL,
  analytics: RequestAnalytics
) {
  const headers = new Headers(request.headers);

  const realProtocol =
    request.headers.get("x-forwarded-proto") ??
    (request.url.startsWith("https://") ? "https" : "http");

  headers.set("x-forwarded-proto", realProtocol);

  const requestStart = Date.now();

  try {
    const originResponse = await fetch(target, {
      method: request.method,
      headers,
      body: request.body,
      redirect: "manual",
    });

    const reader = originResponse.body?.getReader();
    if (!reader) throw new Error("No response body");

    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();

    let totalBytes = 0;

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        await writer.write(value);
      }
      await writer.close();

      analytics.bytesSent += totalBytes;
      analytics.durationMs = Date.now() - requestStart;
      analytics.statusCode = originResponse.status;

      await datastore.saveAnalyticsReport(analytics);
    };

    pump();

    return new Response(readable, {
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

export async function proxyWebsocket(
  request: Request,
  server: Bun.Server,
  target: URL,
  analytics: RequestAnalytics
) {
  const upstream = new WebSocket(target);

  if (!server.upgrade(request, { data: { upstream, analytics } })) {
    return Response.json(
      { message: "could not upgrade to websocket" },
      { status: 500 }
    );
  }

  return;
}
