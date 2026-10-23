import {onTaskDispatched} from "firebase-functions/v2/tasks";
import {geminiKey} from "./gemini";
import {processManaged} from "./managed";
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
    secrets: [discoveryCredentials,geminiKey],
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
    secrets: [discoveryCredentials,geminiKey],
  },
  async (event) => {
    const config = await settings();
    const slot = scheduleSlot(new Date(event.scheduleTime), config);
    if (slot) await runDiscovery("schedule", `scheduled_${slot}`);
  },
);

export const managedTask=onTaskDispatched({region:"us-central1",timeoutSeconds:540,memory:"1GiB",secrets:[geminiKey],retryConfig:{maxAttempts:5,minBackoffSeconds:30,maxBackoffSeconds:300},rateLimits:{maxConcurrentDispatches:1}},async request=>{const id=request.data?.id;if(typeof id!=="string"||! /^[a-f0-9-]{36}$/.test(id))throw Error("Invalid job ID");await processManaged(id);});

// Recover a committed job if task creation or stage dispatch was interrupted.
export const recoverManagedJobs=onSchedule({schedule:"every 5 minutes",region:"us-central1",timeoutSeconds:120},async()=>{
 const {db}=await import('./store');const {enqueueManaged}=await import('./managed');
 const jobs=await db().collection('managedJobs').where('status','in',['queued','running']).limit(50).get();
 for(const job of jobs.docs)if((job.data().leaseUntil||0)<Date.now())await enqueueManaged(job.id);
});
