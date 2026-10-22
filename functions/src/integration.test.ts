import test from "node:test";
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { leadSchema, DEFAULT_SETTINGS } from "./domain";
import {
  db,
  upsertLead,
  updateLead,
  claimRun,
  acquireLease,
  releaseLease,
} from "./store";
import { createApi } from "./api";
import { runDiscovery } from "./discovery";
const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
if (enabled) initializeApp({ projectId: "demo-daniboy" });
test(
  "Firestore transactions preserve call history, deduplicate concurrency and reject stale updates",
  { skip: !enabled },
  async () => {
    const lead = leadSchema.parse({
      businessName: "Emulator Cleaning",
      phone: "3055550199",
      service: "Cleaning",
      location: "Miami, FL",
      sources: [
        {
          url: "https://example.com/source",
          title: "Source",
          observedAt: new Date().toISOString(),
        },
      ],
    });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => upsertLead(lead, "test")),
    );
    assert.equal(results.filter((r) => r.created).length, 1);
    const sameIdentity = await upsertLead({...lead, phone:"3055550177"}, "codex-research", true, true);
    assert.equal(sameIdentity.created, false);
    assert.equal(sameIdentity.skipped, true);

    const id = results[0].id;
    let current = (await db().doc(`leads/${id}`).get()).data()!;
    await updateLead(
      id,
      {
        callStatus: "Do not call",
        note: "Owner requested no calls",
        expectedVersion: current.version,
      },
      "daniel@alined.dev",
    );
    await assert.rejects(
      updateLead(
        id,
        { callStatus: "Interested", expectedVersion: current.version },
        "test",
      ),
      /changed/,
    );
    await upsertLead(
      { ...lead, businessName: "Emulator Cleaning LLC" },
      "test",
    );
    current = (await db().doc(`leads/${id}`).get()).data()!;
    assert.equal(current.callStatus, "Do not call");
    assert.ok(current.alternateNames.includes("Emulator Cleaning LLC"));
    assert.equal((await db().collection(`leads/${id}/activity`).get()).size, 1);
  },
);
test(
  "Scheduled run claims and global leases are concurrency safe",
  { skip: !enabled },
  async () => {
    const claims = await Promise.all([
      claimRun("test-slot", "test"),
      claimRun("test-slot", "test"),
    ]);
    assert.equal(claims.filter(Boolean).length, 1);
    assert.equal(await acquireLease("test-lease"), true);
    assert.equal(await acquireLease("other-lease"), false);
    await releaseLease("other-lease");
    assert.equal(await acquireLease("third-lease"), false);
    await releaseLease("test-lease");
  },
);
test(
  "Every protected HTTP route rejects missing and malformed tokens",
  { skip: !enabled },
  async () => {
    const app = await createApi();
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      for (const [method, path] of [
        ["GET", "me"],
        ["GET", "leads"],
        ["GET", "leads/00000000000000000000000000000000"],
        ["GET", "settings"],
        ["GET", "runs"],
        ["POST", "leads/00000000000000000000000000000000/verification"],
        ["POST", "leads/00000000000000000000000000000000/generations"],
        ["GET", "generations/00000000-0000-0000-0000-000000000000"],
        ["POST", "generations/00000000-0000-0000-0000-000000000000/retry"],
        ["GET", "generator/status"],
        ["POST", "ingest"],
        ["POST", "discovery/run"],
        ["PATCH", "settings"],
      ]) {
        const r = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
          method,
          headers: { "Content-Type": "application/json" },
          ...(method !== "GET" ? { body: "{}" } : {}),
        });
        assert.equal(r.status, 401, `${method} ${path}`);
      }
      const r = await fetch(`http://127.0.0.1:${port}/api/me`, {
        headers: { Authorization: "Bearer not-a-firebase-token" },
      });
      assert.equal(r.status, 401);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);
test(
  "Provider discovery remains disabled even if settings enable it",
  { skip: !enabled },
  async () => {
    process.env.DISCOVERY_CREDENTIALS = "{}";
    await db().doc("settings/discovery").set(DEFAULT_SETTINGS);
    const result = await runDiscovery("test", "missing-credentials");
    assert.equal(result.status, "disabled");
    assert.equal((await db().doc("runs/missing-credentials").get()).exists, false);
  },
);
test(
  "Verified whitelisted sessions can use the API; outsiders and unverified users cannot",
  { skip: !process.env.FIREBASE_AUTH_EMULATOR_HOST },
  async () => {
    const { getAuth } = await import("firebase-admin/auth");
    const app = await createApi();
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((r) => server.once("listening", r));
    const port = (server.address() as { port: number }).port;
    try {
      for (const [email, verified, expected] of [
        ["daniel@alined.dev", true, 200],
        ["doron.elisha@gmail.com", false, 403],
        ["outsider@example.com", true, 403],
      ] as const) {
        await getAuth().createUser({
          email,
          emailVerified: verified,
          password: "Emulator-only-password-42",
        });
        const login = await fetch(
          `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=test`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email,
              password: "Emulator-only-password-42",
              returnSecureToken: true,
            }),
          },
        );
        const token = ((await login.json()) as { idToken: string }).idToken;
        assert.ok(token);
        if (expected === 200) {
          const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
          const input = { profile:{googleMapsUrl:"https://www.google.com/maps/place/Test/",googleMapsLinkType:"listing",sourceUrl:"https://example.com",observedAt:new Date().toISOString()}, businessName: "HTTP save test", phone: "3055550188", service: "Cleaning", location: "Miami, FL", sources: [{ url: "https://example.com", title: "Test", observedAt: new Date().toISOString() }] };
          const created = await fetch(`http://127.0.0.1:${port}/api/leads`, { method: "POST", headers, body: JSON.stringify(input) });
          assert.equal(created.status, 201);
          const { id } = await created.json() as { id: string };
          const before = (await db().doc(`leads/${id}`).get()).data()!;
          const saved = await fetch(`http://127.0.0.1:${port}/api/leads/${id}`, { method: "PATCH", headers, body: JSON.stringify({ expectedVersion: before.version, callStatus: "Follow up", note: "Daniel called" }) });
          assert.equal(saved.status, 200);
          const changed = (await db().doc(`leads/${id}`).get()).data()!;
          const contentBody = {expectedVersion: changed.version, researchNotes:"Verified details from public listing"};
          const edited = await fetch(`http://127.0.0.1:${port}/api/leads/${id}/content`, {method:"PATCH", headers, body:JSON.stringify(contentBody)});
          assert.equal(edited.status, 200);
          const stale = await fetch(`http://127.0.0.1:${port}/api/leads/${id}/content`, {method:"PATCH", headers, body:JSON.stringify(contentBody)});
          assert.equal(stale.status, 409);
          const afterEdit = (await db().doc(`leads/${id}`).get()).data()!;
          assert.equal(afterEdit.researchNotes, contentBody.researchNotes);
          assert.equal(afterEdit.callStatus, "Follow up");
          const detail = await fetch(`http://127.0.0.1:${port}/api/leads/${id}`, {headers});
          assert.equal(detail.status, 200);
          const refreshed = await detail.json() as any;
          assert.equal(refreshed.id, id);
          assert.equal(refreshed.callStatus, "Follow up");
          assert.equal(refreshed.version, before.version + 2);
          assert.equal(refreshed.googleVerified, false);
          const missing = await fetch(`http://127.0.0.1:${port}/api/leads/00000000000000000000000000000000`, {headers});
          assert.equal(missing.status, 404);

          const after = (await db().doc(`leads/${id}`).get()).data()!;
          assert.equal(after.callStatus, "Follow up");
          assert.equal(after.version, before.version + 2);
          const activity = await db().collection(`leads/${id}/activity`).get();
          assert.equal(activity.docs[0].data().actor, email);
          const skipped = await fetch(`http://127.0.0.1:${port}/api/ingest?skipExisting=true`, { method: "POST", headers, body: JSON.stringify([{ ...input, businessName: "Should not overwrite" }]) });
          assert.equal(skipped.status, 201);
          assert.equal((await skipped.json() as { results: { skipped: boolean }[] }).results[0].skipped, true);
          assert.deepEqual((await db().doc(`leads/${id}`).get()).data(), after);
          const listBefore = await fetch(`http://127.0.0.1:${port}/api/leads`,{headers});
          assert.ok(!(await listBefore.json() as any).leads.some((l:any)=>l.id===id));
          const reviewBody = {expectedVersion:after.version,status:"verified",listingUrl:input.profile.googleMapsUrl,notes:"Name, phone and service area matched in listing.",nameMatched:true,phoneMatched:true,areaMatched:true};
          const forged = await fetch(`http://127.0.0.1:${port}/api/leads/${id}/verification`,{method:"POST",headers,body:JSON.stringify({...reviewBody,reviewer:"fake@example.com"})});
          assert.equal(forged.status,400);
          const reviewed = await fetch(`http://127.0.0.1:${port}/api/leads/${id}/verification`,{method:"POST",headers,body:JSON.stringify(reviewBody)});
          assert.equal(reviewed.status,201);
          const verifiedDetail = await fetch(`http://127.0.0.1:${port}/api/leads/${id}`, {headers});
          assert.equal((await verifiedDetail.json() as any).googleVerified, true);
          const listAfter = await fetch(`http://127.0.0.1:${port}/api/leads`,{headers});
          assert.ok((await listAfter.json() as any).leads.some((l:any)=>l.id===id&&l.googleVerified));
          const noExamples = await fetch(`http://127.0.0.1:${port}/api/leads/${id}/generations`,{method:"POST",headers,body:JSON.stringify({expectedVersion:after.version+1})});
          assert.equal(noExamples.status,409);
        }
        for (const path of ["me", "leads", "leads/00000000000000000000000000000000", "settings", "runs", "generator/status"]) {
          const response = await fetch(`http://127.0.0.1:${port}/api/${path}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          assert.equal(response.status, expected === 200 && path.startsWith("leads/") ? 404 : expected, `${email} ${path}`);
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  },
);

test('Google review gates lists and generation; concurrent clicks share a job and identity changes invalidate it', {skip:!enabled}, async()=>{
  const {verifyLead,queueGeneration,verified,verificationSchema}=await import('./generation');
  const input=leadSchema.parse({businessName:'Verified Pool Test',phone:'6025550198',service:'Pool service',location:'Phoenix, AZ',sources:[{url:'https://www.google.com/maps/place/Test/',title:'Google Maps',observedAt:new Date().toISOString()}],competitors:Array.from({length:5},(_,i)=>({businessName:`Example ${i}`,service:'Pool service',location:'Phoenix',websiteUrl:`https://example${i}.com`,sourceUrl:`https://example${i}.com`,verifiedAt:new Date().toISOString(),verificationNotes:'Opened and verified company website.'}))});
  const {id}=await upsertLead(input,'test');
  const leadRef=db().doc(`leads/${id}`);
  await assert.rejects(queueGeneration(id,1,'daniel@alined.dev'),/Verify/);
  const review=verificationSchema.parse({expectedVersion:1,status:'verified',listingUrl:'https://www.google.com/maps/place/Test/',notes:'Matched business name, phone and Phoenix area.',nameMatched:true,phoneMatched:true,areaMatched:true});
  await assert.rejects(verifyLead(id,review,'outsider@example.com'),/approved/);
  await verifyLead(id,review,'daniel@alined.dev');
  const lead=(await leadRef.get()).data()!;
  assert.equal(verified(lead,(await db().doc(`googleVerifications/${id}`).get()).data()),true);
  const jobs=await Promise.all(Array.from({length:4},()=>queueGeneration(id,lead.version,'daniel@alined.dev')));
  assert.equal(new Set(jobs.map(j=>j.id)).size,1);
  assert.equal((await db().doc(`generations/${jobs[0].id}`).get()).data()!.status,'queued');
  // No worker is needed for enqueueing: offline jobs remain durable.
  await upsertLead({...input,businessName:'Different Pool Identity'},'test');
  assert.equal(verified((await leadRef.get()).data()!,(await db().doc(`googleVerifications/${id}`).get()).data()),false);
});
