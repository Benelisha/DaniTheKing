const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc } = require("firebase/firestore");
const fs = require("node:fs");
(async () => {
  const env = await initializeTestEnvironment({
    projectId: "demo-daniboy",
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  try {
    for (const context of [
      env.unauthenticatedContext(),
      env.authenticatedContext("allowed", {
        email: "daniel@alined.dev",
        email_verified: true,
      }),
    ]) {
      for (const path of [
        "leads/private",
        "settings/discovery",
        "runs/private",
        "identities/private",
        "googleVerifications/private",
        "generations/private",
        "generations/private/artifacts/page",
        "internal/generatorWorker",
      ]) {
        await assertFails(getDoc(doc(context.firestore(), path)));
        await assertFails(
          setDoc(doc(context.firestore(), path), { test: true }),
        );
      }
    }
    console.log(
      "Firestore rules verified: direct reads and writes denied, including whitelisted users.",
    );
  } finally {
    await env.cleanup();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
