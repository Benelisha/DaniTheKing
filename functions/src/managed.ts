import { randomUUID } from "node:crypto";
import { getFunctions } from "firebase-admin/functions";
import { getStorage } from "firebase-admin/storage";
import { z } from "zod";
import { db, settings, upsertLead } from "./store";
import { leadSchema } from "./domain";
import { verified, identityFingerprint } from "./google-identity";
import { gemini, managedSettings, parseJson } from "./gemini";
import {
  briefSchema,
  findingSchema,
  pageSchema,
  referenceSchema,
  renderPage,
  terminal,
} from "./managed-domain";
const now = () => new Date().toISOString();
const fail = (message: string) =>
  Object.assign(Error(message), { status: 409 });
export async function enqueueManaged(id: string) {
  await getFunctions()
    .taskQueue("locations/us-central1/functions/managedTask")
    .enqueue({ id }, { dispatchDeadlineSeconds: 540 });
}
export async function startManaged(
  kind: "discovery" | "research" | "people" | "generation",
  actor: string,
  leadId?: string,
) {
  const config = await managedSettings();
  if (!config.enabled)
    throw fail("Enable managed Gemini workflows in settings first.");
  const id = randomUUID();
  const discoverySettings = kind === "discovery" ? await settings() : null;
  const result = await db().runTransaction(async (tx) => {
    const lead = leadId ? await tx.get(db().doc(`leads/${leadId}`)) : null;
    if (leadId && !lead?.exists) throw fail("Lead not found");
    const data = lead?.data();
    const v = leadId
      ? await tx.get(db().doc(`googleVerifications/${leadId}`))
      : null;
    const key = kind === "discovery" ? "discovery" : `${leadId}-${kind}`;
    const pointer = db().doc(`managedPointers/${key}`);
    const previous = await tx.get(pointer);
    const active = previous.exists
      ? await tx.get(db().doc(`managedJobs/${previous.data()!.id}`))
      : null;
    if (active?.exists && !terminal.has(active.data()!.status))
      return { id: active.id, status: active.data()!.status };
    if (
      kind === "generation" &&
      (!verified(data!, v?.data()) || data?.callStatus === "Do not call")
    )
      throw fail("Verify the business identity before generating.");
    const media = leadId
      ? await tx.get(
          db()
            .collection(`leads/${leadId}/media`)
            .where("selected", "==", true)
            .limit(2),
        )
      : null;
    const snapshot = data
      ? {
          businessName: data.businessName,
          phone: data.phone,
          service: data.service,
          location: data.location,
          websiteUrl: data.websiteUrl || "",
          address: data.profile?.address || "",
          email: data.profile?.publicEmail || "",
          services: data.profile?.services || [],
          mapsUrl: v?.data()?.listingUrl || data.profile?.googleMapsUrl || "",
          competitors: data.competitors || [],
          identityFingerprint: identityFingerprint(data),
          selectedMedia: media?.docs.map((d) => d.data()) || [],
          brief: briefSchema.parse(data.generationBrief || {}),
        }
      : null;
    tx.create(db().doc(`managedJobs/${id}`), {
      kind,
      leadId: leadId || null,
      actor,
      snapshot,
      discoverySettings,
      config,
      status: "queued",
      stage: kind === "generation" ? "competitors" : kind,
      createdAt: now(),
      updatedAt: now(),
      budgetUsd: config.budgetUsd,
      reservedUsd: 0,
      attempts: 0,
      leaseUntil: 0,
      leaseToken: null,
      cancelRequested: false,
    });
    tx.set(pointer, { id });
    return { id, status: "queued" };
  });
  await enqueueManaged(result.id);
  return result;
}
async function claim(id: string) {
  return db().runTransaction(async (tx) => {
    const ref = db().doc(`managedJobs/${id}`),
      s = await tx.get(ref);
    if (!s.exists || terminal.has(s.data()!.status)) return null;
    const j = s.data()!;
    if (j.leaseUntil > Date.now()) throw Error("Job already leased");
    const lock = db().doc("internal/managedLock"),
      l = await tx.get(lock);
    if (l.exists && l.data()!.until > Date.now())
      throw Error("Managed worker is busy");
    const token = randomUUID();
    tx.set(lock, { id, token, until: Date.now() + 600000 });
    tx.update(ref, {
      leaseToken: token,
      leaseUntil: Date.now() + 600000,
      status: "running",
      updatedAt: now(),
    });
    return { ...j, id, token } as Record<string, any>;
  });
}
async function checkpoint(
  job: Record<string, any>,
  patch: Record<string, unknown>,
) {
  await db().runTransaction(async (tx) => {
    const ref = db().doc(`managedJobs/${job.id}`),
      s = await tx.get(ref);
    if (s.data()?.leaseToken !== job.token || s.data()?.leaseUntil < Date.now())
      throw Error("Lease lost");
    if (s.data()?.cancelRequested) throw Error("Job cancelled");
    tx.update(ref, { ...patch, updatedAt: now() });
  });
}
async function request(
  job: Record<string, any>,
  prompt: string,
  mode: "text" | "research" | "image",
  key: string,
) {
  const ref = db().doc(`managedJobs/${job.id}/responses/${key}`);
  const saved = await ref.get();
  if (saved.exists) return saved.data()! as Awaited<ReturnType<typeof gemini>>;
  const reserve =
    mode === "image"
      ? job.config.imageReserveUsd
      : job.config.requestReserveUsd;
  await db().runTransaction(async (tx) => {
    const jref = db().doc(`managedJobs/${job.id}`),
      s = await tx.get(jref);
    const j = s.data()!;
    if (j.cancelRequested || j.leaseToken !== job.token)
      throw Error("Job cancelled or lease lost");
    if (j.reservedUsd + reserve > j.budgetUsd)
      throw Error("Budget limit reached; review the job before retrying.");
    tx.update(jref, {
      reservedUsd: j.reservedUsd + reserve,
      attempts: j.attempts + 1,
    });
  });
  const response = await gemini(prompt, job.config, mode);
  await checkpoint(job, {});
  // Image payloads belong in Storage, never Firestore documents.
  if (mode !== "image") await ref.set({ ...response, recordedAt: now() });
  else
    await db()
      .collection(`managedJobs/${job.id}/usage`)
      .add({ usage: response.usage, model: response.model, recordedAt: now() });
  return response;
}
export async function processManaged(id: string) {
  const job = await claim(id);
  if (!job) return;
  try {
    if (job.cancelRequested) {
      await db().doc(`managedJobs/${id}`).update({ status: "cancelled" });
      return;
    }
    if (job.kind === "generation") {
      const lead = (await db().doc(`leads/${job.leadId}`).get()).data();
      const v = (
        await db().doc(`googleVerifications/${job.leadId}`).get()
      ).data();
      if (
        !lead ||
        !verified(lead, v) ||
        identityFingerprint(lead) !== job.snapshot.identityFingerprint ||
        lead.callStatus === "Do not call"
      )
        throw Error("Business identity changed; reverify and start a new job.");
      if (job.stage === "competitors") {
        const r = await request(
          job,
          `Research five distinct actual competitor business websites for ${JSON.stringify(job.snapshot)}. Prefer same US locality, expand geographically if necessary. Inspect each website. Return JSON {"references":[{"businessName":"","websiteUrl":"https://...","observations":"specific evidence from this site","strengths":[five specific strengths],"weaknesses":[five specific weaknesses]}]}. No directories. Never invent observations. Return fewer if you cannot inspect five.`,
          "research",
          "competitors",
        );
        const refs = z
          .object({ references: z.array(referenceSchema).max(5) })
          .parse(parseJson(r.text)).references;
        if (
          refs.length !== 5 ||
          new Set(
            refs.map((x) =>
              new URL(x.websiteUrl).hostname.replace(/^www\./, ""),
            ),
          ).size !== 5
        ) {
          await checkpoint(job, {
            status: "needs_review",
            references: refs,
            error:
              "Five distinct usable competitor websites are required. Add competitor URLs to the lead and start a fresh generation.",
          });
          return;
        }
        await checkpoint(job, { references: refs, stage: "content" });
      } else if (job.stage === "content") {
        const r = await request(
          job,
          `Create original landing-page content using only these verified business facts: ${JSON.stringify(job.snapshot)}. Competitor research: ${JSON.stringify(job.references)}. Adopt useful patterns and avoid weaknesses. No invented credentials, testimonials, prices or staff names. Return JSON matching ${JSON.stringify(z.toJSONSchema(pageSchema))}.`,
          "text",
          "content",
        );
        const page = pageSchema.parse(parseJson(r.text));
        await checkpoint(job, { page, stage: "image0" });
      } else if (job.stage === "image0" || job.stage === "image1") {
        const index = job.stage === "image0" ? 0 : 1;
        const path = `managed/${job.leadId}/${id}/image-${index}.png`;
        const file = getStorage().bucket().file(path);
        const [exists] = await file.exists();
        if (!exists && job.snapshot.selectedMedia?.[index]) {
          const selected = job.snapshot.selectedMedia[index];
          const [bytes] = await getStorage()
            .bucket()
            .file(selected.path)
            .download();
          await file.save(bytes, { contentType: "image/webp" });
        } else if (!exists) {
          const r = await request(
            job,
            `Generate a premium editorial illustrative photograph for a US ${job.snapshot.service} landing page. ${index ? "Close-up of relevant equipment or service detail" : "Wide landscape hero showing a clean residential setting"}. No text, logos, identifiable people, or claims that this depicts the actual business.`,
            "image",
            `image${index}`,
          );
          const image = r.images[0];
          if (
            !image ||
            !["image/png", "image/jpeg", "image/webp"].includes(image.mimeType)
          )
            throw Error(
              "Image generation returned no supported image; retry to regenerate.",
            );
          await file.save(Buffer.from(image.data, "base64"), {
            contentType: image.mimeType,
            metadata: {
              metadata: {
                leadId: job.leadId,
                jobId: id,
                provenance: "ai-generated",
              },
            },
          });
        }
        await checkpoint(job, { stage: index ? "validate" : "image1" });
      } else {
        const images = [];
        for (let i = 0; i < 2; i++) {
          const f = getStorage()
            .bucket()
            .file(`managed/${job.leadId}/${id}/image-${i}.png`);
          const [[bytes], [meta]] = await Promise.all([
            f.download(),
            f.getMetadata(),
          ]);
          images.push(
            `data:${meta.contentType};base64,${bytes.toString("base64")}`,
          );
        }
        const html = renderPage(job.page, job.snapshot, images);
        await getStorage()
          .bucket()
          .file(`managed/${job.leadId}/${id}/page.html`)
          .save(html, {
            contentType: "text/html",
            metadata: { cacheControl: "private, no-store" },
          });
        await checkpoint(job, { status: "ready", stage: "ready", error: null });
      }
    } else if (job.kind === "discovery") {
      const c = job.discoverySettings;
      const r = await request(
        job,
        `Find up to ${c.maxCandidates} real US home-service businesses for categories ${JSON.stringify(c.categories)} in ${JSON.stringify(c.locations)}. US ONLY. Return JSON {"leads":[{"businessName":"","phone":"US phone","service":"","location":"City, ST","sources":[{"url":"https://...","title":"","observedAt":"${now()}"}],"websiteStatus":"Not checked","websiteUrl":"","researchNotes":""}],"gaps":[]}. Every business requires a public source proving identity and phone; omit uncertain businesses. Prefer businesses without a good independent website.`,
        "research",
        "discovery",
      );
      const raw = z
        .object({
          leads: z.array(z.unknown()).max(20),
          gaps: z.array(z.string()).default([]),
        })
        .parse(parseJson(r.text));
      const results = [];
      const rejected = [];
      for (const item of raw.leads) {
        const parsed = leadSchema.safeParse(item);
        if (!parsed.success) {
          rejected.push(
            "Candidate omitted: incomplete or invalid sourced business details",
          );
          continue;
        }
        results.push(await upsertLead(parsed.data, job.actor, true, true));
      }
      await checkpoint(job, {
        status: "completed",
        results,
        gaps: [...raw.gaps, ...rejected],
      });
    } else {
      const r = await request(
        job,
        `Research this US business: ${JSON.stringify(job.snapshot)}. ${job.kind === "people" ? "Focus on identifying people who work at this business." : "Find business contacts, services, website and social presence, reviews and public media including Google Maps listing photos when accessible."} Names require a source excerpt explicitly associating them with the business. Review authors are not employees. Review mentions are only possible contacts. Never infer emails. Return JSON matching ${JSON.stringify(z.toJSONSchema(findingSchema, { io: "input" }))}.`,
        "research",
        "research",
      );
      const findings = findingSchema.parse(parseJson(r.text));
      await checkpoint(job, { findings, status: "completed" });
    }
  } catch (e) {
    const s = (await db().doc(`managedJobs/${id}`).get()).data();
    if (s?.leaseToken === job.token)
      await db()
        .doc(`managedJobs/${id}`)
        .update({
          status: s?.cancelRequested ? "cancelled" : "failed",
          error: String((e as Error).message).slice(0, 1000),
          updatedAt: now(),
        });
  } finally {
    await db().runTransaction(async (tx) => {
      const ref = db().doc(`managedJobs/${id}`),
        lock = db().doc("internal/managedLock");
      const [s, l] = await Promise.all([tx.get(ref), tx.get(lock)]);
      if (s.data()?.leaseToken === job.token)
        tx.update(ref, { leaseUntil: 0, leaseToken: null });
      if (l.data()?.token === job.token) tx.delete(lock);
    });
  }
  const current = (await db().doc(`managedJobs/${id}`).get()).data();
  if (current && !terminal.has(current.status)) await enqueueManaged(id);
}
