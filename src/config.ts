import { z } from "zod";
import yaml from "yaml";
import { existsSync } from "fs";
import { resolve } from "path";

const envSchema = z.object({
  DATABASE_URL: z.string(),
});

export const env = envSchema.parse(Bun.env);

const serviceSchema = z.strictObject({
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
    .optional(),
  basePath: z
    .string()
    .optional()
    .describe("only forward requests if the path starts with this"),
  trimBase: z
    .boolean()
    .default(true)
    .describe("trim the basepath before forwarding (if basePath is set)"),
});

const configSchema = z.strictObject({
  port: z.number().default(3000),
  services: z.array(serviceSchema),
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
