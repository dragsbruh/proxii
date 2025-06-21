import { ProxiiService } from "./config";

export function cleanHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);

  cleaned.delete("content-encoding");
  cleaned.delete("content-length");
  cleaned.delete("transfer-encoding");
  cleaned.delete("connection");

  return cleaned;
}

export function prepareTargetUrl(path: string, service: ProxiiService) {
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
