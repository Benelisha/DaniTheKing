import { getApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { db } from "./store";
import { identityFingerprint } from "./google-identity";
const SITE = "daniboy-be1c0-prospects";
async function token() {
  return (await getApp().options.credential!.getAccessToken()).access_token;
}
async function hosting(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<any> {
  const r = await fetch(
    `https://firebasehosting.googleapis.com/v1beta1/${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(30000),
    },
  );
  if (!r.ok) throw Error(`Hosting request failed (${r.status})`);
  return r.status === 204 ? {} : r.json();
}
// A global publishing lease serializes complete manifests so one lead cannot remove another site.
export async function publishManaged(
  id: string,
  actor: string,
  remove = false,
) {
  const ref = db().doc(`managedJobs/${id}`),
    lock = db().doc("internal/managedPublishingLock"),
    owner = randomUUID();
  const job = await db().runTransaction(async (tx) => {
    const [s, l] = await Promise.all([tx.get(ref), tx.get(lock)]);
    if (!s.exists) throw Error("Draft not found");
    const j = s.data()!;
    const lead = await tx.get(db().doc(`leads/${j.leadId}`));
    if (remove && lead.data()?.publishedManagedJobId !== id)
      throw Error("Only the currently published version can be unpublished");
    if (!["ready", "published"].includes(j.status) && !(j.status === "running" && j.stage === "publish"))
      throw Error("The website is not ready to publish");
    if (
      !remove &&
      (!lead.exists || identityFingerprint(lead.data()!) !== j.snapshot.identityFingerprint)
    )
      throw Error("Business details changed; regenerate");
    if (l.exists && l.data()!.until > Date.now())
      throw Error("Another publication is in progress");
    tx.set(lock, { owner, until: Date.now() + 600000 });
    return j;
  });
  const assertLease = async () => {
    const l = (await lock.get()).data();
    if (l?.owner !== owner || l.until < Date.now())
      throw Error("Publishing lease lost");
  };
  try {
    const releases = await hosting(`sites/${SITE}/releases?pageSize=1`);
    const previous = releases.releases?.[0]?.version?.name;
    const files: Record<string, string> = {};
    let pageToken = "";
    if (previous)
      do {
        const page = await hosting(
          `${previous}/files?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`,
        );
        for (const f of page.files || []) files[f.path] = f.hash;
        pageToken = page.nextPageToken || "";
      } while (pageToken);
    const path = `/${job.leadId}/index.html`;
    let bytes: Buffer | undefined,
      hash = "";
    if (remove) delete files[path];
    else {
      const [html] = await getStorage()
        .bucket()
        .file(`managed/${job.leadId}/${id}/page.html`)
        .download();
      bytes = gzipSync(html);
      hash = createHash("sha256").update(bytes).digest("hex");
      files[path] = hash;
    }
    const version = await hosting(`sites/${SITE}/versions`, "POST", {
      config: {
        headers: [
          {
            glob: "**",
            headers: {
              "Content-Security-Policy":
                "default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
              "X-Robots-Tag": "noindex, nofollow",
              "Cache-Control": "no-cache",
              "X-Content-Type-Options": "nosniff",
            },
          },
        ],
      },
    });
    const populated = await hosting(`${version.name}:populateFiles`, "POST", {
      files,
    });
    for (const required of populated.uploadRequiredHashes || []) {
      if (required !== hash || !bytes)
        throw Error("Existing asset missing; stopped to preserve other sites");
      const url = new URL(`${populated.uploadUrl}/${hash}`);
      if (url.origin !== "https://upload-firebasehosting.googleapis.com")
        throw Error("Unexpected upload origin");
      const r = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${await token()}`,
          "Content-Type": "application/octet-stream",
        },
        body: new Uint8Array(bytes),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) throw Error("Asset upload failed");
    }
    await hosting(`${version.name}?updateMask=status`, "PATCH", {
      status: "FINALIZED",
    });
    await assertLease();
    await hosting(
      `sites/${SITE}/releases?versionName=${encodeURIComponent(version.name)}`,
      "POST",
      {},
    );
    const url = `https://${SITE}.web.app/${job.leadId}/`;
    await db().runTransaction(async (tx) => {
      const l = await tx.get(lock);
      if (l.data()?.owner !== owner) throw Error("Publishing lease lost");
      tx.update(ref, {
        status: remove ? "ready" : "published",
        publishedUrl: remove ? null : url,
        publishedAt: new Date().toISOString(),
      });
      tx.update(db().doc(`leads/${job.leadId}`), {
        generatedWebsiteUrl: remove ? "" : url,
        publishedManagedJobId: remove ? null : id,
      });
      tx.create(db().collection("publicationHistory").doc(), {
        jobId: id,
        leadId: job.leadId,
        actor,
        action: remove ? "unpublish" : "publish",
        hostingVersion: version.name,
        previousHostingVersion: previous || null,
        at: new Date().toISOString(),
      });
    });
    return { url: remove ? null : url };
  } finally {
    await db().runTransaction(async (tx) => {
      const l = await tx.get(lock);
      if (l.data()?.owner === owner) tx.delete(lock);
    });
  }
}
