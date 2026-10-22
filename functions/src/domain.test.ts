import test from "node:test";
import assert from "node:assert/strict";
import {
  authorizedEmail,
  DEFAULT_SETTINGS,
  leadId,
  leadSchema,
  profileSchema,
  onlinePresenceSchema,
  normalizePhone,
  scheduleSlot,
  settingsSchema,
} from "./domain";
import { directoryUrl } from "./discovery";
test("Only the two verified, exact whitelist emails are authorized", () => {
  assert.equal(authorizedEmail("DORON.ELISHA@gmail.com", true), true);
  assert.equal(authorizedEmail("daniel@alined.dev", true), true);
  for (const email of [
    "ben@example.com",
    "doron.elisha@gmail.com.attacker.com",
    null,
  ])
    assert.equal(authorizedEmail(email, true), false);
  assert.equal(authorizedEmail("daniel@alined.dev", false), false);
});
test("US phone formats deduplicate; invalid and foreign phones rejected", () => {
  assert.equal(leadId("(305) 930-0249"), leadId("+1 305 930 0249"));
  assert.equal(normalizePhone("3059300249"), "+13059300249");
  for (const v of ["123", "+44 207 123 4567", "0000000000"])
    assert.equal(normalizePhone(v), null);
});
test("Website assessments require dated evidence and actual site URL", () => {
  const base = {
    businessName: "Test business",
    phone: "3059300249",
    service: "Cleaning",
    location: "Miami, FL",
    sources: [
      {
        url: "https://example.com/listing",
        title: "Source",
        observedAt: new Date().toISOString(),
      },
    ],
  };
  assert.equal(leadSchema.safeParse(base).success, true);
  assert.equal(leadSchema.safeParse({ ...base, websiteUrl: "" }).success, true);
  assert.equal(leadSchema.safeParse({ ...base, websiteUrl: "not-a-url" }).success, false);
  assert.equal(
    leadSchema.safeParse({ ...base, websiteStatus: "No site found" }).success,
    false,
  );
  assert.equal(
    leadSchema.safeParse({
      ...base,
      websiteStatus: "Independent site found",
      websiteCheckedAt: new Date().toISOString(),
      evidence: [
        {
          query: "name",
          summary: "Found a candidate",
          checkedAt: new Date().toISOString(),
        },
      ],
    }).success,
    false,
  );
  assert.equal(
    leadSchema.safeParse({
      ...base,
      sources: [
        {
          url: "javascript:alert(1)",
          title: "Bad",
          observedAt: new Date().toISOString(),
        },
      ],
    }).success,
    false,
  );
});
test("Schedule handles timezone, daylight savings, disabled and non-slot ticks", () => {
  assert.equal(
    scheduleSlot(new Date("2026-10-22T13:00:00Z"), {...DEFAULT_SETTINGS,enabled:true}),
    "2026-10-22_0900",
  );
  assert.equal(
    scheduleSlot(new Date("2026-12-22T14:00:00Z"), {...DEFAULT_SETTINGS,enabled:true}),
    "2026-12-22_0900",
  );
  assert.equal(
    scheduleSlot(new Date("2026-10-22T13:15:00Z"), DEFAULT_SETTINGS),
    null,
  );
  assert.equal(
    scheduleSlot(new Date("2026-10-22T13:00:00Z"), {
      ...DEFAULT_SETTINGS,
      enabled: false,
    }),
    null,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      times: ["09:07", "13:00", "17:00"],
    }).success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({ ...DEFAULT_SETTINGS, timeZone: "Invalid" })
      .success,
    false,
  );
  assert.equal(
    settingsSchema.safeParse({
      ...DEFAULT_SETTINGS,
      times: ["09:00", "09:00", "17:00"],
    }).success,
    false,
  );
});
test("Directory hostname matching cannot be spoofed with a suffix", () => {
  assert.equal(directoryUrl("https://www.facebook.com/business"), true);
  assert.equal(directoryUrl("https://facebook.com.attacker.test"), false);
  assert.equal(directoryUrl("https://example.com"), false);
});

test("Enriched profiles validate ratings and distinct competitor websites", () => {
  const base = {
    businessName: "Test cleaning", phone: "3055550198", service: "House cleaning", location: "Miami, FL",
    sources: [{ url: "https://example.com/source", title: "Source", observedAt: "2026-10-22T18:00:00Z" }],
  };
  const competitor = { businessName: "Test competitor", service: "House cleaning", location: "Miami, FL", websiteUrl: "https://example.org", sourceUrl: "https://example.org/contact", verifiedAt: "2026-10-22T18:00:00Z", verificationNotes: "Contact page matches the listing phone and city." };
  assert.equal(leadSchema.safeParse({ ...base, competitors: [competitor] }).success, true);
  assert.equal(leadSchema.safeParse({ ...base, competitors: [competitor, { ...competitor, websiteUrl: "https://www.example.org/services" }] }).success, false);
  assert.equal(leadSchema.safeParse({ ...base, competitors: [{ ...competitor, websiteUrl: "javascript:alert(1)" }] }).success, false);
  assert.equal(leadSchema.safeParse({ ...base, profile: { rating: 6, sourceUrl: "https://example.com", observedAt: "2026-10-22T18:00:00Z" } }).success, false);
});

test("Social findings require dated provenance, real platform URLs and honest negative evidence", () => {
  const base = {platform:"Instagram",status:"Found",url:"https://www.instagram.com/localbusiness/",sourceUrl:"https://www.instagram.com/localbusiness/",checkedAt:new Date().toISOString()};
  assert.equal(onlinePresenceSchema.safeParse(base).success,true);
  assert.equal(onlinePresenceSchema.safeParse({...base,url:undefined}).success,false);
  assert.equal(onlinePresenceSchema.safeParse({...base,url:"https://instagram.com.attacker.test/business"}).success,false);
  assert.equal(onlinePresenceSchema.safeParse({...base,status:"Not found",url:undefined}).success,false);
  assert.equal(onlinePresenceSchema.safeParse({...base,status:"Not found",url:undefined,notes:"Searched exact business name and phone; no matching profile found."}).success,true);
  assert.equal(onlinePresenceSchema.safeParse({...base,checkedAt:undefined}).success,false);
  assert.equal(profileSchema.safeParse({sourceUrl:base.sourceUrl,observedAt:base.checkedAt,onlinePresence:[base,base]}).success,false);
});
