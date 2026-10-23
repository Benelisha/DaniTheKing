import { createHash } from "node:crypto";
import { z } from "zod";
export const ALLOWED_EMAILS = ["daniel@alined.dev", "doron.elisha@gmail.com"];
export const CALL_STATUSES = [
  "Not called",
  "No answer",
  "Follow up",
  "Interested",
  "Not interested",
  "Wrong number",
  "Do not call",
] as const;
export const WEBSITE_STATUSES = [
  "Not checked",
  "No site found",
  "Independent site found",
  "Uncertain",
  "Owner confirmed no website",
] as const;
export const CATEGORIES = [
  "House cleaning",
  "Pool and spa service",
  "Painting",
  "Renovation and remodeling",
  "Appliance repair",
  "Handyman",
  "Plumbing",
  "Drain and sewer service",
  "Electrical",
  "HVAC",
  "Roofing",
  "Gutters",
  "Windows and doors",
  "Garage doors",
  "Drywall and plaster",
  "Flooring and tile",
  "Carpentry and cabinets",
  "Masonry and concrete",
  "Fencing and gates",
  "Decks and patios",
  "Landscaping and lawn care",
  "Tree services",
  "Irrigation",
  "Pressure washing",
  "Window cleaning",
  "Carpet and upholstery cleaning",
  "Pest control",
  "Chimney and fireplace",
  "Duct and dryer vent cleaning",
  "Water and fire restoration",
  "Mold remediation",
  "Insulation and weatherproofing",
  "Junk removal",
  "Locksmith",
  "Septic services",
  "Home security installation",
];
const httpUrl = z
  .url()
  .max(2000)
  .refine(
    (v) => { try { return ["https:", "http:"].includes(new URL(v).protocol); } catch { return false; } },
    "Use an HTTP(S) URL",
  );
export const evidenceSchema = z
  .object({
    query: z.string().max(500),
    url: httpUrl.optional(),
    summary: z.string().min(1).max(3000),
    checkedAt: z.iso.datetime(),
  })
  .strict();
export const onlinePresenceSchema = z.object({
  platform: z.enum(["Instagram", "Facebook", "LinkedIn", "TikTok", "YouTube", "X", "Nextdoor", "Yelp"]),
  status: z.enum(["Found", "Not found", "Not checked"]),
  url: httpUrl.optional(),
  sourceUrl: httpUrl,
  checkedAt: z.iso.datetime(),
  notes: z.string().max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  const domains: Record<string,string[]> = {Instagram:["instagram.com"],Facebook:["facebook.com"],LinkedIn:["linkedin.com"],TikTok:["tiktok.com"],YouTube:["youtube.com","youtu.be"],X:["x.com","twitter.com"],Nextdoor:["nextdoor.com"],Yelp:["yelp.com"]};
  if (value.status === "Found" && value.url) {
    try { const host=new URL(value.url).hostname.toLowerCase();
      if (!domains[value.platform].some(domain=>host===domain || host.endsWith("."+domain))) ctx.addIssue({code:"custom",path:["url"],message:"Profile URL must belong to the selected platform"});
    } catch { /* httpUrl reports malformed URLs */ }
  }
  if (value.status === "Found" && !value.url) ctx.addIssue({code:"custom",path:["url"],message:"A found profile needs its public URL"});
  if (value.status !== "Found" && value.url) ctx.addIssue({code:"custom",path:["url"],message:"Only a found profile can have a profile URL"});
  if (value.status === "Not found" && !value.notes?.trim()) ctx.addIssue({code:"custom",path:["notes"],message:"Record the searches used before marking a profile not found"});
});
export const profileSchema = z.object({
  onlinePresence: z.array(onlinePresenceSchema).max(8).refine(entries => new Set(entries.map(e=>e.platform)).size === entries.length, "Use one entry per platform").optional(),
  address: z.string().max(500).optional(),
  addressNotes: z.string().max(2000).optional(),
  googleMapsLinkType: z.enum(["listing", "search"]).optional(),
  googleMapsUrl: httpUrl.optional(),
  googlePlaceId: z.string().max(300).optional(),
  rating: z.number().min(0).max(5).optional(),
  reviewCount: z.number().int().min(0).optional(),
  publicEmail: z.email().max(200).optional(),
  openingHours: z.string().max(2000).optional(),
  services: z.array(z.string().max(200)).max(40).optional(),
  images: z.array(z.object({ url: httpUrl, sourceUrl: httpUrl, caption: z.string().max(500) }).strict()).max(10).optional(),
  staff: z.array(z.object({ name: z.string().trim().min(1).max(200), role: z.string().max(200).optional(), excerpt: z.string().trim().min(1).max(1000), sourceUrl: httpUrl }).strict()).max(20).optional(),
  reviews: z.array(z.object({ text: z.string().max(3000), rating: z.number().min(0).max(5).optional(), author: z.string().max(200), sourceUrl: httpUrl, publishedAt: z.string().max(100).optional() }).strict()).max(10).optional(),
  sourceUrl: httpUrl,
  observedAt: z.iso.datetime(),
}).strict();
export const competitorSchema = z.object({
  businessName: z.string().trim().min(2).max(200),
  service: z.string().trim().min(2).max(100),
  location: z.string().trim().min(2).max(200),
  websiteUrl: httpUrl,
  sourceUrl: httpUrl,
  verifiedAt: z.iso.datetime(),
  verificationNotes: z.string().trim().min(10).max(2000),
}).strict();
export const leadSchema = z
  .object({
    businessName: z.string().trim().min(2).max(200),
    alternateNames: z
      .array(z.string().trim().min(1).max(200))
      .max(10)
      .default([]),
    phone: z
      .string()
      .max(30)
      .refine(
        (v) => normalizePhone(v) !== null,
        "A valid US phone number is required",
      ),
    service: z.string().trim().min(2).max(100),
    location: z.string().trim().min(2).max(200),
    sources: z
      .array(
        z
          .object({
            url: httpUrl,
            title: z.string().max(200),
            observedAt: z.iso.datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    websiteStatus: z.enum(WEBSITE_STATUSES).default("Not checked"),
    websiteUrl: z.union([httpUrl, z.literal("")]).default(""),
    websiteCheckedAt: z.iso.datetime().nullable().default(null),
    evidence: z.array(evidenceSchema).max(40).default([]),
    researchNotes: z.string().max(5000).default(""),
    profile: profileSchema.optional(),
    competitors: z.array(competitorSchema).max(5).refine(
      (items) => { try { return new Set(items.map((item) => new URL(item.websiteUrl).hostname.toLowerCase().replace(/^www\./, ""))).size === items.length; } catch { return false; } },
      "Competitors must have distinct website domains",
    ).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      v.websiteStatus !== "Not checked" &&
      (!v.websiteCheckedAt || !v.evidence.length)
    )
      ctx.addIssue({
        code: "custom",
        message: "Website assessments require evidence and a check date",
      });
    if (v.websiteStatus === "Independent site found" && !v.websiteUrl)
      ctx.addIssue({
        code: "custom",
        message: "Provide the independent website URL",
      });
  });
export type LeadInput = z.infer<typeof leadSchema>;
export const patchSchema = z
  .object({
    callStatus: z.enum(CALL_STATUSES).optional(),
    nextFollowUpAt: z.union([z.iso.datetime(),z.null()]).optional(),
    note: z.string().trim().min(1).max(5000).optional(),
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine((v) => v.callStatus || v.note || v.nextFollowUpAt !== undefined, "Provide a status or note");
export const settingsSchema = z
  .object({
    enabled: z.boolean(),
    times: z
      .array(z.string().regex(/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/))
      .length(3)
      .refine((v) => new Set(v).size === 3, "Use three different times"),
    timeZone: z.string().refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }, "Invalid IANA time zone"),
    categories: z.array(z.string().min(2).max(100)).min(1).max(36),
    locations: z.array(z.string().min(2).max(150)).min(1).max(30),
    maxCandidates: z.number().int().min(1).max(20),
  })
  .strict();
export const DEFAULT_SETTINGS: z.infer<typeof settingsSchema> = {
  enabled: false,
  times: ["09:00", "13:00", "17:00"],
  timeZone: "America/New_York",
  categories: CATEGORIES.slice(0, 5),
  locations: [
    "Miami, FL",
    "Indianapolis, IN",
    "Phoenix, AZ",
    "Austin, TX",
    "Columbus, OH",
  ],
  maxCandidates: 20,
};
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  const d =
    digits.length === 11 && digits[0] === "1" ? digits.slice(1) : digits;
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d) ? `+1${d}` : null;
}
export function leadId(phone: string) {
  const p = normalizePhone(phone);
  if (!p) throw new Error("Invalid phone");
  return createHash("sha256").update(p).digest("hex").slice(0, 32);
}
export function nameKey(name: string, location: string) {
  return createHash("sha256")
    .update(
      `${name.toLowerCase().replace(/[^a-z0-9]/g, "")}|${location.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    )
    .digest("hex")
    .slice(0, 32);
}
export function authorizedEmail(email: unknown, verified: unknown) {
  return (
    verified === true &&
    typeof email === "string" &&
    ALLOWED_EMAILS.includes(email.toLowerCase())
  );
}
export function scheduleSlot(date: Date, settings: typeof DEFAULT_SETTINGS) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: settings.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  const time = `${p.hour}:${p.minute}`;
  return settings.enabled && settings.times.includes(time)
    ? `${p.year}-${p.month}-${p.day}_${time.replace(":", "")}`
    : null;
}

export const researchSchema = z
  .object({
    websiteStatus: z.enum(WEBSITE_STATUSES),
    websiteUrl: z.union([httpUrl, z.literal("")]),
    summary: z.string().trim().min(5).max(3000),
    sourceUrl: httpUrl,
    expectedVersion: z.number().int().min(1),
  })
  .strict()
  .refine(
    (v) => v.websiteStatus !== "Independent site found" || !!v.websiteUrl,
    "Provide the independent website URL",
  );

export const contentPatchSchema = z.object({
  expectedVersion: z.number().int().min(1),
  researchNotes: z.string().max(5000),
  profile: profileSchema.optional(),
}).strict();
