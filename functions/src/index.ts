import { initializeApp } from "firebase-admin/app";
import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { createApi } from "./api";
import { discoveryCredentials, runDiscovery } from "./discovery";
import { scheduleSlot } from "./domain";
import { settings } from "./store";
initializeApp();
export const api = onRequest(
  {
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 3,
    secrets: [discoveryCredentials],
    invoker: "public",
  },
  async (req, res) => {
    const app = await createApi();
    app(req, res);
  },
);
// A fixed tick lets the team change its three daily slots without redeploying.
export const discoverLeads = onSchedule(
  {
    schedule: "*/15 * * * *",
    timeZone: "UTC",
    region: "us-central1",
    timeoutSeconds: 540,
    memory: "512MiB",
    maxInstances: 1,
    retryCount: 0,
    secrets: [discoveryCredentials],
  },
  async (event) => {
    const config = await settings();
    const slot = scheduleSlot(new Date(event.scheduleTime), config);
    if (slot) await runDiscovery("schedule", `scheduled_${slot}`);
  },
);
