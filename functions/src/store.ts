import { identityFingerprint } from "./google-identity";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import {
  DEFAULT_SETTINGS,
  LeadInput,
  leadId,
  nameKey,
  normalizePhone,
  settingsSchema,
} from "./domain";
export const db = () => getFirestore();
export async function settings() {
  const s = await db().doc("settings/discovery").get();
  return s.exists ? settingsSchema.parse(s.data()) : DEFAULT_SETTINGS;
}
export async function upsertLead(input: LeadInput, actor: string, skipExisting = false, skipMatchingIdentity = false) {
  const id = leadId(input.phone),
    ref = db().doc(`leads/${id}`),
    identity = db().doc(
      `identities/${nameKey(input.businessName, input.location)}`,
    );
  return db().runTransaction(async (tx) => {
    const [existing, match] = await Promise.all([
      tx.get(ref),
      tx.get(identity),
    ]);
    const now = new Date().toISOString();
    if (existing.exists) {
      if (skipExisting) return { id, created: false, skipped: true };
      const old = existing.data()!;
      if (identityFingerprint({...old,...input,profile:input.profile || old.profile}) !== identityFingerprint(old)) {
        tx.set(db().doc(`googleVerifications/${id}`), {status:"ambiguous",invalidatedAt:now,reason:"Imported business identity changed; manual reverification required."}, {merge:true});
      }
      const sources = [...old.sources, ...input.sources]
        .filter((s, i, a) => a.findIndex((x) => x.url === s.url) === i)
        .slice(-30);
      const alternateNames = [
        ...new Set([
          ...old.alternateNames,
          ...input.alternateNames,
          ...(old.businessName === input.businessName
            ? []
            : [input.businessName]),
        ]),
      ].slice(0, 10);
      // Never downgrade a human-confirmed assessment or erase call history on ingestion.
      const newer =
        input.websiteCheckedAt &&
        (!old.websiteCheckedAt ||
          input.websiteCheckedAt > old.websiteCheckedAt) &&
        old.websiteStatus !== "Owner confirmed no website";
      tx.update(ref, {
        sources,
        alternateNames,
        ...(input.profile ? { profile: input.profile } : {}),
        ...(input.competitors ? { competitors: input.competitors } : {}),
        ...(newer
          ? {
              websiteStatus: input.websiteStatus,
              websiteUrl: input.websiteUrl,
              websiteCheckedAt: input.websiteCheckedAt,
              evidence: input.evidence,
              researchNotes: input.researchNotes,
            }
          : {}),
        updatedAt: now,
        version: old.version + 1,
      });
      return { id, created: false };
    }
    if (skipMatchingIdentity && match.exists) return { id: match.data()!.leadId, created: false, skipped: true };
    const potentialDuplicateId = match.exists ? match.data()!.leadId : null;
    tx.create(ref, {
      ...input,
      phone: normalizePhone(input.phone),
      callStatus: "Not called",
      version: 1,
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      potentialDuplicateId,
    });
    if (!match.exists) tx.create(identity, { leadId: id });
    return { id, created: true };
  });
}
export async function updateLead(
  id: string,
  patch: { callStatus?: string; note?: string; expectedVersion: number },
  actor: string,
) {
  const ref = db().doc(`leads/${id}`);
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists)
      throw Object.assign(new Error("Lead not found"), { status: 404 });
    if (snap.data()!.version !== patch.expectedVersion)
      throw Object.assign(
        new Error("This lead changed. Refresh before saving."),
        { status: 409 },
      );
    const now = new Date().toISOString();
    tx.update(ref, {
      ...(patch.callStatus ? { callStatus: patch.callStatus } : {}),
      updatedAt: now,
      version: patch.expectedVersion + 1,
    });
    tx.create(ref.collection("activity").doc(), {
      actor,
      at: now,
      note: patch.note || "",
      fromStatus: snap.data()!.callStatus,
      toStatus: patch.callStatus || snap.data()!.callStatus,
    });
    return { version: patch.expectedVersion + 1 };
  });
}
export async function claimRun(id: string, trigger: string) {
  const ref = db().doc(`runs/${id}`);
  return db().runTransaction(async (tx) => {
    const s = await tx.get(ref);
    if (s.exists) return false;
    tx.create(ref, {
      trigger,
      status: "running",
      startedAt: new Date().toISOString(),
      created: 0,
      merged: 0,
      reviewed: 0,
    });
    return true;
  });
}
export async function finishRun(id: string, data: Record<string, unknown>) {
  await db()
    .doc(`runs/${id}`)
    .update({ ...data, finishedAt: new Date().toISOString() });
}
// A global lease prevents overlapping manual and scheduled searches and duplicate charges.
export async function acquireLease(id: string) {
  return db().runTransaction(async (tx) => {
    const ref = db().doc("internal/discoveryLock");
    const s = await tx.get(ref);
    if (s.exists && s.data()!.until > Date.now()) return false;
    tx.set(ref, { id, until: Date.now() + 9 * 60_000 });
    return true;
  });
}
export async function releaseLease(id: string) {
  await db().runTransaction(async (tx) => {
    const ref = db().doc("internal/discoveryLock");
    const s = await tx.get(ref);
    if (s.data()?.id === id) tx.delete(ref);
  });
}
