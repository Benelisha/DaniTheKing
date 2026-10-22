// Import only the literal starter rows; do not execute the workbook builder.
const fs = require("node:fs"),
  vm = require("node:vm");
const text = fs.readFileSync(
  "/private/tmp/home-service-leads/build.mjs",
  "utf8",
);
const literal = text.slice(
  text.indexOf("const rows=") + 11,
  text.indexOf("\ns.getRange"),
);
const rows = vm.runInNewContext(literal, {}, { timeout: 1000 });
const checkedAt = "2026-10-22T00:00:00.000Z";
fs.writeFileSync(
  "data/starter-leads.json",
  JSON.stringify(
    rows.map((r) => ({
      businessName: r[0],
      phone: r[3],
      service: r[1],
      location: r[2],
      sources: [
        { url: r[8], title: "Starter research source", observedAt: checkedAt },
      ],
      websiteStatus: r[4].startsWith("Uncertain")
        ? "Uncertain"
        : "No site found",
      websiteCheckedAt: checkedAt,
      evidence: [
        {
          query: "Imported starter research — October 22, 2026",
          url: r[8],
          summary:
            r[7] +
            " Imported date has day-level precision; not a new live verification.",
          checkedAt,
        },
      ],
      researchNotes:
        r[7] +
        " Unconfirmed candidate; verify business identity, current phone ownership and independent website before outreach.",
    })),
    null,
    2,
  ) + "\n",
);
console.log("Prepared 6 unconfirmed starter candidates.");
