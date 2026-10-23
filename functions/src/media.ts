import { randomUUID } from "node:crypto";
import { getStorage } from "firebase-admin/storage";
import { db } from "./store";
import sharp from "sharp";
export async function saveMedia(
  leadId: string,
  data: Buffer,
  actor: string,
  caption: string,
  provenance = "uploaded",
) {
  if (data.length > 8 * 1024 * 1024) throw Error("Maximum image size is 8 MB");
  const metadata = await sharp(data, { limitInputPixels: 25000000 }).metadata();
  if (!["png", "jpeg", "webp"].includes(metadata.format || ""))
    throw Error("Use PNG, JPEG, or WebP images");
  const { data: bytes, info } = await sharp(data, {
    limitInputPixels: 25000000,
  })
    .rotate()
    .resize({
      width: 1600,
      height: 1600,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 85 })
    .toBuffer({ resolveWithObject: true });
  const id = randomUUID(),
    path = `media/${leadId}/${id}.webp`;
  await getStorage()
    .bucket()
    .file(path)
    .save(bytes, {
      contentType: "image/webp",
      metadata: { cacheControl: "private, no-store" },
    });
  const record = {
    id,
    leadId,
    path,
    caption,
    provenance,
    actor,
    width: info.width,
    height: info.height,
    selected: true,
    createdAt: new Date().toISOString(),
  };
  await db().doc(`leads/${leadId}/media/${id}`).set(record);
  return record;
}
