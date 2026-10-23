import test from "node:test";
import assert from "node:assert/strict";
import {
  findingSchema,
  pageSchema,
  personSchema,
  referenceSchema,
  renderPage,
  managedSettingsSchema,
} from "./managed-domain";
const page = {
  title: "Pool care",
  description: "Local pool care",
  hero: "Pool care for your home",
  intro: "Call to discuss your needs.",
  services: [
    { title: "Pool cleaning", description: "Discuss available services." },
  ],
  approach: "Contact us for service availability.",
  faq: [],
  accent: "#184d47",
};
test("review mentions cannot claim confirmed staff identity", () => {
  const p = personSchema.parse({
    name: "Mike",
    role: "",
    sourceUrl: "https://example.com/review",
    excerpt: "Mike cleaned our pool yesterday.",
    sourceType: "review-mention",
    confidence: "confirmed",
  });
  assert.equal(p.confidence, "possible");
});
test("people require evidence and a source", () => {
  assert.equal(
    personSchema.safeParse({
      name: "Mike",
      sourceType: "official-team",
      confidence: "confirmed",
    }).success,
    false,
  );
});
test("competitor analysis requires five strengths and weaknesses", () => {
  assert.equal(
    referenceSchema.safeParse({
      businessName: "Pool co",
      websiteUrl: "https://example.com",
      observations: "A".repeat(60),
      strengths: ["Nice"],
      weaknesses: [],
    }).success,
    false,
  );
});
test("renderer escapes model content and permits no active injection", () => {
  const html = renderPage(
    { ...page, hero: "<script>alert(1)</script>" },
    {
      businessName: "A & B",
      phone: "+12125551234",
      service: "Pool cleaning",
      location: "Miami, FL",
    },
  );
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("noindex,nofollow"));
  assert.equal((html.match(/class="cta"/g) || []).length, 2);
});
test("renderer rejects unapproved remote images", () => {
  assert.throws(
    () =>
      renderPage(page, { businessName: "Test" }, [
        "https://evil.example/image.png",
      ]),
    /Unapproved image/,
  );
});
test("CSS cannot be injected through accent", () => {
  assert.equal(
    pageSchema.safeParse({
      ...page,
      accent: "red; background:url(https://evil.example)",
    }).success,
    false,
  );
});
test("managed workflows default off with a five dollar budget", () => {
  const s = managedSettingsSchema.parse({});
  assert.equal(s.enabled, false);
  assert.equal(s.budgetUsd, 5);
});
test("findings require a summary and preserve explicit research gaps", () => {
  const f = findingSchema.parse({
    summary: "No owner found",
    gaps: ["Official website unavailable"],
  });
  assert.deepEqual(f.people, []);
  assert.equal(f.gaps.length, 1);
});
