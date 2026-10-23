import { leadSchema } from "./domain";

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
