// Administrative setup using the existing Firebase CLI login. Tokens remain in memory.
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.join(
  execFileSync("npm", ["root", "-g"], { encoding: "utf8" }).trim(),
  "firebase-tools/lib",
);
const config = require(path.join(root, "configstore")).configstore;
const { requireAuth } = require(path.join(root, "requireAuth"));
const { getAccessToken, Client } = require(path.join(root, "apiv2"));
const project = "daniboy-be1c0";
async function client(origin, version) {
  return new Client({ urlPrefix: origin, apiVersion: version });
}
(async () => {
  await requireAuth({
    project,
    user: config.get("user"),
    tokens: config.get("tokens"),
  });
  const mode = process.argv[2];
  if (mode === "status") {
    const b = await (await client("https://cloudbilling.googleapis.com", "v1")).get(`/projects/${project}/billingInfo`);
    const a = await (await client("https://identitytoolkit.googleapis.com", "admin/v2")).get(`/projects/${project}/config`, {skipLog:{resBody:true}});
    console.log(JSON.stringify({billingEnabled:!!b.body.billingEnabled,emailPasswordEnabled:!!a.body.signIn?.email?.enabled,hostingDomainAuthorized:a.body.authorizedDomains?.includes(`${project}.web.app`)}));
  }
  if (mode === "deployment") {
    const functions = await client("https://cloudfunctions.googleapis.com", "v2");
    for (const name of ["api", "discoverLeads"]) {
      const result = await functions.get(`/projects/${project}/locations/us-central1/functions/${name}`, {skipLog:{resBody:true}});
      console.log(JSON.stringify({function:name,state:result.body.state,runtime:result.body.buildConfig?.runtime}));
    }
    const scheduler = await client("https://cloudscheduler.googleapis.com", "v1");
    const result = await scheduler.get(`/projects/${project}/locations/us-central1/jobs`, {skipLog:{resBody:true}});
    console.log(JSON.stringify((result.body.jobs || []).map(j=>({name:j.name,state:j.state,schedule:j.schedule,timeZone:j.timeZone}))));
  }
  if (mode === "services") {
    const c = await client("https://serviceusage.googleapis.com", "v1");
    for (const service of [
      "firestore.googleapis.com",
      "identitytoolkit.googleapis.com",
    ]) {
      await c.post(
        `/projects/${project}/services/${service}:enable`,
        {},
        { skipLog: { reqBody: true, resBody: true } },
      );
      console.log(`Enabled ${service}`);
    }
    const billing = await client("https://cloudbilling.googleapis.com", "v1");
    const b = await billing.get(`/projects/${project}/billingInfo`);
    console.log("Billing enabled:", !!b.body.billingEnabled);
  }
  if (mode === "auth") {
    const c = await client(
      "https://identitytoolkit.googleapis.com",
      "admin/v2",
    );
    // Initialize Firebase Auth once in the Firebase console before running this mode.
    const current = await c.get(`/projects/${project}/config`, {
      skipLog: { resBody: true },
    });
    const domains = [
      ...new Set([
        ...(current.body.authorizedDomains || []),
        "localhost",
        `${project}.web.app`,
        `${project}.firebaseapp.com`,
      ]),
    ];
    await c.patch(
      `/projects/${project}/config`,
      {
        signIn: { email: { enabled: true, passwordRequired: true } },
        authorizedDomains: domains,
      },
      {
        queryParams: { updateMask: "signIn.email,authorizedDomains" },
        skipLog: { reqBody: true, resBody: true },
      },
    );
    console.log("Email/password auth enabled; hosting domains authorized.");
  }
  if (mode === "seed") {
    const {
      leadSchema,
      leadId,
      nameKey,
      normalizePhone,
      DEFAULT_SETTINGS,
    } = require("../functions/lib/domain");
    const c = await client("https://firestore.googleapis.com", "v1");
    function value(v) {
      if (v === null) return { nullValue: null };
      if (typeof v === "string") return { stringValue: v };
      if (typeof v === "boolean") return { booleanValue: v };
      if (typeof v === "number") return { integerValue: String(v) };
      if (Array.isArray(v)) return { arrayValue: { values: v.map(value) } };
      return {
        mapValue: {
          fields: Object.fromEntries(
            Object.entries(v).map(([k, x]) => [k, value(x)]),
          ),
        },
      };
    }
    async function create(path, data) {
      const resource = `/projects/${project}/databases/(default)/documents/${path}`;
      try {
        await c.get(resource, { skipLog: { resBody: true } });
        console.log(path, "already exists; preserved");
        return;
      } catch (e) {
        if (e.status !== 404) throw e;
      }
      await c.patch(
        resource,
        { fields: value(data).mapValue.fields },
        {
          queryParams: { "currentDocument.exists": "false" },
          skipLog: { reqBody: true, resBody: true },
        },
      );
      console.log(path, "created");
    }
    for (const raw of require("../data/starter-leads.json")) {
      const row = leadSchema.parse(raw);
      const now = new Date().toISOString();
      await create(`leads/${leadId(row.phone)}`, {
        ...row,
        phone: normalizePhone(row.phone),
        callStatus: "Not called",
        version: 1,
        createdAt: now,
        updatedAt: now,
        createdBy: "starter-import",
        potentialDuplicateId: null,
      });
      await create(`identities/${nameKey(row.businessName, row.location)}`, {
        leadId: leadId(row.phone),
      });
    }
    await create("settings/discovery", DEFAULT_SETTINGS);
  }
  if (mode === "webconfig") {
    const c = await client("https://firebase.googleapis.com", "v1beta1");
    const r = await c.get(
      `/projects/${project}/webApps/1:822173953967:web:d29b7514ff381cbe51c95a/config`,
      { skipLog: { resBody: true } },
    );
    const v = r.body;
    require("node:fs").writeFileSync(
      ".env",
      `EXPO_PUBLIC_FIREBASE_API_KEY=${v.apiKey}\nEXPO_PUBLIC_FIREBASE_AUTH_DOMAIN=${v.authDomain}\nEXPO_PUBLIC_FIREBASE_PROJECT_ID=${project}\nEXPO_PUBLIC_FIREBASE_APP_ID=${v.appId}\nEXPO_PUBLIC_API_URL=https://${project}.web.app/api\n`,
    );
    console.log("Public web configuration saved to ignored .env");
  }
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
