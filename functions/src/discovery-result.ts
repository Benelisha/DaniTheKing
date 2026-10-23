import { leadSchema } from "./domain";
import { z } from "zod";

export function discoveryResults(input: unknown, limit: number) {
  z.number().int().min(1).max(20).parse(limit);
  const result = z.object({
    leads: z.array(z.unknown()),
    gaps: z.array(z.string()).default([]),
  }).parse(input);
  return { ...result, leads: result.leads.slice(0, limit) };
}

// Providers sometimes use null for unknown optional text and omit URL schemes.
// Normalize formatting only; identity, phone and source validation stay strict.
export function discoveryCandidate(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return leadSchema.safeParse(input);
  const row = { ...input } as Record<string, unknown>;
  for (const key of ["websiteUrl", "researchNotes"])
    if (row[key] === null) row[key] = "";
  if (typeof row.websiteUrl === "string" && row.websiteUrl &&
      !/^[a-z][a-z\d+.-]*:/i.test(row.websiteUrl) &&
      /^(?:[a-z\d-]+\.)+[a-z]{2,}(?:[/?#][^\s]*)?$/i.test(row.websiteUrl))
    row.websiteUrl = `https://${row.websiteUrl}`;
  return leadSchema.safeParse(row);
}
