import { existsSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import yaml from "yaml";

const serviceSchema = z
  .strictObject({
    name: z.string().describe("display name for service"),
    target: z.union([
      z.strictObject({
        serveStatic: z.literal(false).default(false),
        origin: z
          .string()
          .url()
          .describe(
            "forward requests to this url (forwarded to origin+receivedPath)"
          ),
      }),
      z.strictObject({
        serveStatic: z.literal(true),
        staticDir: z
          .string()
          .describe("directory to serve static files from")
          .transform((path) => resolve(path)),
      }),
    ]),
    host: z
      .union([
        z.string().describe("only forward requests to this host header"),
        z
          .array(z.string())
          .min(1)
          .describe("forward requests only from these hosts (host header)"),
      ])
      .optional()
      .transform((host) =>
        Array.isArray(host) ? host : host ? [host] : undefined
      ),
    basePath: z
      .string()
      .optional()
      .describe("only forward requests if the path starts with this")
      .transform((path) => (path && !path.endsWith("/") ? path + "/" : path)),
    trimBase: z
      .boolean()
      .default(true)
      .describe("trim the basepath before forwarding (if basePath is set)"),
    enforceTrailingSlash: z
      .boolean()
      .default(false)
      .describe(
        "enforce a trailing slash if /basePath is accessed (redirects to /basePath/"
      ),
    enforceSecure: z
      .boolean()
      .default(false)
      .describe("redirect http requests to https"),
  })
  .transform((service) => ({
    ...service,
    basePathNormalized: service.basePath?.slice(0, -1),
  }));

const configSchema = z.strictObject({
  port: z.number().default(3000),
  services: z.array(serviceSchema),
  publicDir: z
    .string()
    .optional()
    .describe("only used to serve static files from when service is not found")
    .transform((dir) => (dir ? resolve(dir) : undefined)),
});

const configPaths = [
  "./proxii.yaml",
  "./proxii.yml",
  "/app/proxii.yaml",
  "/app/proxii.yml",
  "/etc/proxii/proxii.yaml",
  "/etc/proxii/proxii.yml",
];
const configPath = configPaths.find(existsSync);
if (!configPath)
  throw new Error(
    `proxii.yaml not found, checked in ${configPaths.join(", ")}`
  );

export const config = configSchema.parse(
  yaml.parse(await Bun.file(configPath).text())
);

export type ProxiiService = z.infer<typeof serviceSchema>;
