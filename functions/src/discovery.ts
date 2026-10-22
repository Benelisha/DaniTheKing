import { randomUUID } from "node:crypto";
import { defineSecret } from "firebase-functions/params";
import { leadSchema, leadId, normalizePhone } from "./domain";
import {
  acquireLease,
  claimRun,
  db,
  finishRun,
  releaseLease,
  settings,
  upsertLead,
} from "./store";
export const discoveryCredentials = defineSecret("DISCOVERY_CREDENTIALS");
export function credentials() {
  try {
    return JSON.parse(discoveryCredentials.value() || "{}") as {
      googlePlacesApiKey?: string;
      braveSearchApiKey?: string;
    };
  } catch {
    return {};
  }
}
export function integrationStatus() {
  const c = credentials();
  return {
    googlePlaces: !!c.googlePlacesApiKey,
    braveSearch: !!c.braveSearchApiKey,
    ready: !!(c.googlePlacesApiKey && c.braveSearchApiKey),
  };
}
type Result = { url: string; title: string; description?: string };
const directories = [
  "google.com",
  "maps.google.com",
  "facebook.com",
  "instagram.com",
  "yelp.com",
  "bbb.org",
  "angi.com",
  "thumbtack.com",
  "yellowpages.com",
  "mapquest.com",
  "allbiz.com",
  "nextdoor.com",
  "houzz.com",
  "manta.com",
  "chamberofcommerce.com",
  "linkedin.com",
];
export function directoryUrl(url: string) {
  try {
    const h = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return directories.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return false;
  }
}
async function search(q: string, key: string): Promise<Result[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.search = new URLSearchParams({
    q,
    count: "5",
    country: "US",
    search_lang: "en",
  }).toString();
  const r = await fetch(url, {
    headers: { "X-Subscription-Token": key },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`Brave Search returned HTTP ${r.status}`);
  const data = (await r.json()) as { web?: { results: Result[] } };
  return data.web?.results || [];
}
export async function runDiscovery(trigger: string, id = `manual_${randomUUID()}`) {
  return { id, status: "disabled", message: "Manual Google Maps verification is required. Provider discovery is disabled." };
}
