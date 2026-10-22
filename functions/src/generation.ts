import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "./store";
import { authorizedEmail, normalizePhone } from "./domain";

import {listingUrl,identityFingerprint,verified} from "./google-identity";
export {listingUrl,identityFingerprint,verified} from "./google-identity";
export const verificationSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum(["verified", "unmatched", "ambiguous"]),
  listingUrl: z.string().max(2000).default(""),
  placeId: z.string().max(300).optional(),
  notes: z.string().trim().min(15).max(2000),
  nameMatched: z.boolean(), phoneMatched: z.boolean(), areaMatched: z.boolean(),
}).strict().superRefine((v, ctx) => {
  if (v.status === "verified" && (!listingUrl(v.listingUrl) || !v.nameMatched || !v.phoneMatched || !v.areaMatched))
    ctx.addIssue({ code: "custom", message: "Open an actual Google Maps listing and confirm its name, phone, and address/service area. Search links do not verify a business." });
});
const fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
export async function verifyLead(id: string, input: z.infer<typeof verificationSchema>, actor: string) {
  if (!authorizedEmail(actor, true)) throw fail("Reviewer is not approved", 403);
  return db().runTransaction(async tx => {
    const ref = db().doc(`leads/${id}`), snap = await tx.get(ref);
    if (!snap.exists) throw fail("Lead not found", 404);
    const lead = snap.data()!;
    if (lead.version !== input.expectedVersion) throw fail("This lead changed. Refresh before verifying.");
    const at = new Date().toISOString();
    const record = { ...input, reviewer: actor, verifiedAt: at, identityFingerprint: identityFingerprint(lead) };
    tx.set(db().doc(`googleVerifications/${id}`), record);
    tx.update(ref, { version: lead.version + 1, updatedAt: at });
    tx.create(ref.collection("activity").doc(), {actor, at, note: `Google Maps review: ${input.status}. ${input.notes}`, fromStatus:lead.callStatus, toStatus:lead.callStatus});
    return { saved: true };
  });
}
export function generationSnapshot(lead: Record<string, any>, verification: Record<string, any> | undefined) {
  if (!verified(lead, verification)) throw fail("Verify this business on Google Maps before generating.");
  if (!normalizePhone(lead.phone) || lead.callStatus === "Do not call") throw fail("This lead is not eligible for a sales demo.");
  if (lead.competitors?.length !== 5) throw fail("Add five verified competitor websites before generating.");
  // Never send private sales notes or call history to the model.
  return { businessName: lead.businessName, phone: lead.phone, service: lead.service, location: lead.location,
    address: lead.profile?.address || "", email: lead.profile?.publicEmail || "",
    hours: lead.profile?.openingHours || "", services: lead.profile?.services || [],
    mapsUrl: verification!.listingUrl, competitors: lead.competitors,
    identityFingerprint: identityFingerprint(lead) };
}
export async function queueGeneration(id: string, expectedVersion: number, actor: string) {
  if (!authorizedEmail(actor,true)) throw fail("Requester is not approved",403);
  const jobId = randomUUID();
  return db().runTransaction(async tx => {
    const ref = db().doc(`leads/${id}`);
    const [snap, v] = await Promise.all([tx.get(ref), tx.get(db().doc(`googleVerifications/${id}`))]);
    if (!snap.exists) throw fail("Lead not found", 404);
    const lead = snap.data()!;
    const snapshot = generationSnapshot(lead, v.data());
    if (lead.generationId) {
      const active = await tx.get(db().doc(`generations/${lead.generationId}`));
      if (active.exists && !["completed", "failed"].includes(active.data()!.status)) return { id: active.id, status: active.data()!.status };
    }
    if (lead.version !== expectedVersion) throw fail("This lead changed. Refresh before generating.");
    const at = new Date().toISOString();
    tx.create(db().doc(`generations/${jobId}`), { leadId:id, requester:actor, inputVersion:lead.version, snapshot,
      status:"queued", createdAt:at, updatedAt:at, budgetUsd:1, spentUsd:0, reservedUsd:0, attempts:0, promptVersion:"landing-v1" });
    tx.update(ref, {generationId:jobId, generationStatus:"queued"});
    return { id:jobId, status:"queued" };
  });
}
export function publicGeneration(data: Record<string, any>) {
  const { status, leadId, createdAt, updatedAt, error, publishedUrl, spentUsd, budgetUsd } = data;
  return {status, leadId, createdAt, updatedAt, error:error || null, publishedUrl:publishedUrl || null, spentUsd, budgetUsd};
}
