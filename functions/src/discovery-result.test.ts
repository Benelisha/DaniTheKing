import test from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "./managed-domain";
import { discoveryCandidate, discoveryResults } from "./discovery-result";

test("discovery caps excess provider candidates to the saved limit without rejecting the run", () => {
  const leads = Array.from({ length: 25 }, (_, id) => ({ id }));
  assert.deepEqual(discoveryResults({ leads, gaps: ["Missing evidence"] }, 20), {
    leads: leads.slice(0, 20), gaps: ["Missing evidence"],
  });
  assert.equal(discoveryResults({ leads }, 3).leads.length, 3);
  assert.throws(() => discoveryResults({ leads: "invalid" }, 20));
  assert.throws(() => discoveryResults({ leads }, 21));
});

test("grounded research accepts one fenced payload with surrounding prose", () => {
  const data = { leads: [{ businessName: "Business with {braces}" }], gaps: [] };
  assert.deepEqual(parseJson(`Here are the businesses:\n\n\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\nSources checked.`), data);
  assert.deepEqual(parseJson(JSON.stringify(data)), data);
  assert.throws(() => parseJson('Here are businesses without JSON'));
  assert.throws(() => parseJson('```json\n{}\n```\n```json\n{}\n```'));
  assert.throws(() => parseJson('```json\n{"leads": [\n```'));
});

const candidate = {
  businessName: "Example Pool Care", phone: "602-555-0123",
  service: "Pool and spa service", location: "Phoenix, AZ",
  sources: [{ url: "https://example.com/contact", title: "Contact", observedAt: "2026-10-23T14:54:35.997Z" }],
  websiteStatus: "Not checked", websiteUrl: null, researchNotes: null,
};
test("discovery normalizes optional provider formatting while keeping required evidence strict", () => {
  const result = discoveryCandidate(candidate);
  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.websiteUrl, "");
    assert.equal(result.data.researchNotes, "");
    assert.equal(result.data.websiteStatus, "Not checked");
  }
  const url = discoveryCandidate({ ...candidate, websiteUrl: "www.example.com/contact" });
  assert.equal(url.success && url.data.websiteUrl, "https://www.example.com/contact");
  for (const patch of [{ phone: null }, { sources: [] }, { websiteUrl: "javascript:alert(1)" }, { websiteUrl: "not a url" }])
    assert.equal(discoveryCandidate({ ...candidate, ...patch }).success, false);
});
