import db from ".";
import { RequestAnalytics, tableRequest } from "./schema";

export const datastore = {
  async saveAnalyticsReport(analytics: RequestAnalytics) {
    await db.insert(tableRequest).values(analytics);
  },
};
