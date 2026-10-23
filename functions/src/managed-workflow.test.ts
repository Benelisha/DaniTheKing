import test from "node:test";
import assert from "node:assert/strict";
import * as store from "./store";
import * as adminFunctions from "firebase-admin/functions";
import { startManaged, processManaged } from "./managed";
import * as publishing from "./publishing";
import { managedSettingsSchema, terminal } from "./managed-domain";
import { identityFingerprint } from "./google-identity";

test("generation queues without enabling workflows or verifying the lead, including do-not-call leads", async (t) => {
  const lead = { businessName: "Pool Care", phone: "+16025550123", location: "Phoenix, AZ", service: "Pools", callStatus: "Do not call" };
  const created: any[] = [], queued: any[] = [];
  const fakeDb = {
    doc: (path: string) => ({ path, get: async () => ({ data: () => ({ enabled: false }) }) }),
    collection: () => ({ where: () => ({ limit: () => ({ media: true }) }) }),
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ref.media ? { docs: [] } : { exists: ref.path.startsWith("leads/"), data: () => ref.path.startsWith("leads/") ? lead : undefined },
      create: (_ref: any, data: any) => created.push(data),
      set: () => {},
    }),
  };
  t.mock.method(store, "db", () => fakeDb);
  t.mock.method(adminFunctions, "getFunctions", () => ({ taskQueue: () => ({ enqueue: async (data: any) => queued.push(data) }) }));
  const result = await startManaged("generation", "tester", "lead1");
  assert.equal(result.status, "queued");
  assert.equal(created[0].stage, "competitors");
  assert.equal(created[0].config.enabled, false);
  assert.equal(queued[0].id, result.id);
  await assert.rejects(startManaged("research", "tester", "lead1"), /Enable managed/);
});

test("the worker publishes automatically and published jobs are terminal", async (t) => {
  const lead = { businessName: "Pool Care", phone: "+16025550123", location: "Phoenix, AZ" };
  const job: any = { kind: "generation", leadId: "lead1", actor: "tester", status: "queued", stage: "publish", config: managedSettingsSchema.parse({}), snapshot: { identityFingerprint: identityFingerprint(lead) }, leaseUntil: 0 };
  let lock: any;
  const refs = (path: string): any => ({
    path,
    get: async () => ({ exists: true, data: () => path === "leads/lead1" ? lead : job }),
    update: async (patch: any) => Object.assign(job, patch),
  });
  t.mock.method(store, "db", () => ({
    doc: refs,
    runTransaction: async (fn: any) => fn({
      get: async (ref: any) => ({ exists: ref.path.includes("managedLock") ? !!lock : true, data: () => ref.path.includes("managedLock") ? lock : job }),
      set: (_ref: any, value: any) => { lock = value; },
      update: (_ref: any, patch: any) => Object.assign(job, patch),
      delete: () => { lock = undefined; },
    }),
  }));
  const publish = t.mock.method(publishing, "publishManaged", async () => { job.status = "published"; return { url: "https://example.com/lead1/" }; });
  await processManaged("job1");
  assert.equal(publish.mock.calls.length, 1);
  assert.deepEqual(publish.mock.calls[0].arguments, ["job1", "tester"]);
  assert.equal(job.status, "published");
  assert.equal(terminal.has("published"), true);
  await processManaged("job1");
  assert.equal(publish.mock.calls.length, 1);
});
