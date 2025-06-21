import db from ".";
import { RequestAnalytics, tableRequest } from "./schema";

export const datastore = {
  async saveAnalyticsReport(analytics: RequestAnalytics) {
    console.log(
      `[analytics] request ${analytics.id} bytes transferred ${
        analytics.bytesSent + analytics.bytesReceived
      } duration ${analytics.durationMs} milliseconds on timestamp ${
        analytics.timestamp
      }`
    );
    await db.insert(tableRequest).values(analytics);
  },
};
