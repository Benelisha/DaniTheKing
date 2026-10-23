import { z } from "zod";
export const sourceUrl = z
  .string()
  .url()
  .max(2000)
  .refine((v) => /^https?:\/\//.test(v));
export const personSchema = z
  .object({
    name: z.string().min(2).max(150),
    role: z.string().max(150).default(""),
    sourceUrl,
    excerpt: z.string().min(10).max(1500),
    sourceType: z.enum(["official-team", "business-profile", "review-mention"]),
    confidence: z.enum(["confirmed", "possible"]),
  })
  .transform((v) => ({
    ...v,
    confidence: v.sourceType === "review-mention" ? "possible" : v.confidence,
  }));
export const findingSchema = z.object({
  summary: z.string().max(10000),
  people: z.array(personSchema).max(30).default([]),
  facts: z
    .array(
      z.object({
        field: z.enum([
          "address",
          "publicEmail",
          "openingHours",
          "websiteUrl",
          "phone",
          "services",
          "social",
          "rating",
          "reviewCount",
        ]),
        value: z.string().max(2000),
        sourceUrl,
        excerpt: z.string().max(2000),
      }),
    )
    .max(60)
    .default([]),
  media: z
    .array(
      z.object({ url: sourceUrl, sourceUrl, caption: z.string().max(500) }),
    )
    .max(20)
    .default([]),
  gaps: z.array(z.string().max(1000)).max(30).default([]),
});
export const referenceSchema = z.object({
  businessName: z.string().min(2),
  websiteUrl: sourceUrl,
  observations: z.string().min(50).max(8000),
  strengths: z.array(z.string().min(10).max(1000)).length(5),
  weaknesses: z.array(z.string().min(10).max(1000)).length(5),
});
export const briefSchema = z.object({
  audience: z.string().max(1000).default("Local homeowners"),
  services: z.string().max(2000).default(""),
  serviceArea: z.string().max(1000).default(""),
  tone: z.string().max(500).default("Professional and approachable"),
  visualPreferences: z
    .string()
    .max(1000)
    .default("Clean, distinctive, accessible"),
  callsToAction: z.string().max(500).default("Call for service"),
});
export const managedSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    textModel: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .default("gemini-2.5-flash"),
    imageModel: z
      .string()
      .regex(/^[a-zA-Z0-9._-]+$/)
      .default("gemini-2.5-flash-image"),
    budgetUsd: z.number().min(0.5).max(20).default(5),
    requestReserveUsd: z.number().min(0.1).max(5).default(0.5),
    imageReserveUsd: z.number().min(0.1).max(5).default(0.5),
    promptVersion: z.string().max(80).default("research-v1"),
    researchInstructions: z
      .string()
      .max(5000)
      .default(
        "Use public evidence only. Record missing information honestly.",
      ),
  })
  .strict();
export const pageSchema = z.object({
  title: z.string().min(3).max(160),
  description: z.string().max(300),
  hero: z.string().min(10).max(300),
  intro: z.string().max(2000),
  services: z
    .array(
      z.object({
        title: z.string().max(100),
        description: z.string().max(1000),
      }),
    )
    .min(1)
    .max(12),
  approach: z.string().max(2000),
  faq: z
    .array(
      z.object({ question: z.string().max(300), answer: z.string().max(1000) }),
    )
    .max(8),
  accent: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default("#184d47"),
});
export function parseJson(text: string): unknown {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/, "")
    .replace(/\s*```$/, "");
  return JSON.parse(cleaned);
}
export const terminal = new Set([
  "ready",
  "completed",
  "failed",
  "cancelled",
  "needs_review",
]);
export function escapeHtml(v: unknown) {
  return String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
// Render structured content instead of executing arbitrary model-authored HTML.
export function renderPage(
  raw: unknown,
  business: Record<string, any>,
  images: string[] = [],
) {
  const p = pageSchema.parse(raw),
    e = escapeHtml;
  const imageHtml = images.map((url, i) => {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url))
      throw Error("Unapproved image");
    return `<img src="${url}" alt="Illustrative ${e(business.service)} image" ${i ? 'loading="lazy"' : ""}>`;
  });
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${e(p.title)}</title><meta name="description" content="${e(p.description)}"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>*{box-sizing:border-box}body{margin:0;background:#f8faf7;color:#172521;font:18px/1.65 system-ui}header,main,footer{max-width:1120px;margin:auto;padding:28px}nav{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap}h1{font-size:clamp(36px,6vw,72px);line-height:1.08;max-width:900px}h2{font-size:32px}section{padding:40px 0}a{color:inherit;overflow-wrap:anywhere}.cta{display:inline-block;background:${p.accent};color:white;padding:14px 24px;border-radius:8px;text-decoration:none}a:focus-visible{outline:3px solid #d28000;outline-offset:4px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(250px,100%),1fr));gap:20px}.card{padding:24px;background:white;border:1px solid #dae3dc;border-radius:14px}img{width:100%;max-height:520px;object-fit:cover;border-radius:18px}footer{border-top:1px solid #dae3dc;font-size:14px}p{overflow-wrap:anywhere}</style></head><body><header><nav><strong>${e(business.businessName)}</strong><a href="tel:${e(business.phone)}">${e(business.phone)}</a></nav></header><main><section><p>${e(business.service)} · ${e(business.location)}</p><h1>${e(p.hero)}</h1><p>${e(p.intro)}</p><a class="cta" href="tel:${e(business.phone)}">Call ${e(business.phone)}</a></section>${imageHtml[0] || ""}<section><h2>Our services</h2><div class="grid">${p.services.map((s) => `<article class="card"><h3>${e(s.title)}</h3><p>${e(s.description)}</p></article>`).join("")}</div></section><section><h2>Serving ${e(business.location)}</h2><p>${e(p.approach)}</p></section>${imageHtml[1] || ""}<section><h2>Common questions</h2>${p.faq.map((f) => `<details class="card"><summary>${e(f.question)}</summary><p>${e(f.answer)}</p></details>`).join("")}</section><section><h2>Get in touch</h2><p>${e(business.address || business.location)}</p><a class="cta" href="tel:${e(business.phone)}">Call ${e(business.phone)}</a></section></main><footer>Website concept · Prepared for ${e(business.businessName)} · Illustrative images</footer></body></html>`;
}
