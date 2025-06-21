import { cleanHeaders } from "./utils";

export async function proxyRequest(request: Request, target: string) {
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

export async function proxyWebsocket(
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
