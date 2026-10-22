// Isolated QA only. Never connects to the production project.
if (
  !process.env.FIRESTORE_EMULATOR_HOST ||
  !process.env.FIREBASE_AUTH_EMULATOR_HOST
)
  throw new Error("Start through emulators:exec.");
process.env.FUNCTIONS_EMULATOR = "true";
process.env.DISCOVERY_CREDENTIALS = "{}";
const { initializeApp } = require("firebase-admin/app");
initializeApp({ projectId: "demo-daniboy" });
(async () => {
  const { getAuth } = require("firebase-admin/auth");
  const { upsertLead, db } = require("../functions/lib/store");
  const { leadSchema, DEFAULT_SETTINGS } = require("../functions/lib/domain");
  await getAuth().createUser({
    email: "daniel@alined.dev",
    emailVerified: true,
    password: "Emulator-only-password-42",
  });
  for (const lead of require("../data/starter-leads.json"))
    await upsertLead(leadSchema.parse(lead), "emulator");
  await db().doc("settings/discovery").set(DEFAULT_SETTINGS);
  const app = await require("../functions/lib/api").createApi((server) =>
    server.use(require("express").static("/private/tmp/daniboy-preview")),
  );
  app.listen(5011, "127.0.0.1", () =>
    console.log("QA preview: http://localhost:5011 (demo-daniboy only)"),
  );
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
