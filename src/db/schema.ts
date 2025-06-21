import { InferSelectModel } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const tableRequest = sqliteTable("request", {
  id: text().primaryKey(), // ulid
  timestamp: integer({ mode: "timestamp_ms" }).notNull(),
  method: text().notNull(),
  url: text().notNull(), // accessed url, not origin url
  origin: text().notNull(), // full origin url with path
  statusCode: integer().notNull(), // on availability error, use 0
  referer: text(),
  userAgent: text(),
  ipAddress: text().notNull(),
  forwardedFor: text(), // X-Forwarded-For
  bytesSent: integer().notNull(), // sent by server to client
  bytesReceived: integer().notNull(), // sent by client to server
  durationMs: integer().notNull(),
});

export type RequestAnalytics = InferSelectModel<typeof tableRequest>;
