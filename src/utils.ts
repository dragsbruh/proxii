import { ProxiiService } from "./config";

export function cleanHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);

  cleaned.delete("content-encoding");
  cleaned.delete("content-length");
  cleaned.delete("transfer-encoding");
  cleaned.delete("connection");

  return cleaned;
}

export function prepareTargetUrl(url: URL, service: ProxiiService) {
  const final = new URL(url);

  const trimmedPath =
    service.basePath && service.trimBase
      ? url.pathname.slice(service.basePath.length) || "/"
      : url.pathname;

  const originHasSlash = service.origin.endsWith("/");
  const pathHasSlash = trimmedPath.startsWith("/");

  final.pathname = originHasSlash
    ? pathHasSlash
      ? trimmedPath.slice(1)
      : trimmedPath
    : pathHasSlash
    ? trimmedPath
    : "/" + trimmedPath;

  final.host = new URL(service.origin).host;
  return final;
}
