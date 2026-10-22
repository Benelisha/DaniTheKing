import { createHash } from "node:crypto";
import {authorizedEmail,normalizePhone} from "./domain";
export function listingUrl(value: string): boolean {
  try {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.username || u.password) return false;
    if (!["www.google.com", "google.com", "maps.google.com"].includes(u.hostname)) return false;
    return (u.pathname.startsWith("/maps/place/") && u.pathname.length > 12) ||
      (u.pathname.startsWith("/maps") && (!!u.searchParams.get("query_place_id") || /^\d+$/.test(u.searchParams.get("cid") || "")));
  } catch { return false; }
}
export function identityFingerprint(lead: Record<string, any>) {
  return createHash("sha256").update(JSON.stringify([
    lead.businessName, normalizePhone(lead.phone || ""), lead.location,
    lead.profile?.address || "", lead.profile?.googlePlaceId || "",
  ])).digest("hex");
}
export function verified(lead: Record<string, any>, verification: Record<string, any> | undefined): boolean {
  return !!verification && verification.status === "verified" &&
    listingUrl(verification.listingUrl || "") && authorizedEmail(verification.reviewer, true) &&
    verification.identityFingerprint === identityFingerprint(lead);
}
