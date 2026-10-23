# DaniBoy · Phase one

Expo / React Native back office (web, Android, iOS source), NestJS API hosted in Firebase Functions v2, Firebase Auth, and Firestore. Project: `daniboy-be1c0`. Web: https://daniboy-be1c0.web.app

## Current deployment

- Firebase Hosting deployed; Google Firebase Auth enabled and hosting domains authorized.
- Firestore in `us-central1`; deny-all direct client rules deployed. Six **unconfirmed** starter candidates imported from the supplied workbook, preserving the pool business's uncertain historical domain.
- Blaze is enabled. The NestJS `api` function and `discoverLeads` scheduler are deployed in `us-central1` on Node 22. Hosting routes `/api/**` to the live backend; unsigned requests return HTTP 401. Build images have a seven-day retention policy.
- No Google Places or Brave Search credentials were supplied. Discovery explicitly reports `blocked` until both are configured. No live automated discovery run has been claimed.
- Only `daniel@alined.dev` and `doron.elisha@gmail.com` are allowed. Ben uses `doron.elisha@gmail.com`. These are application users, not Firebase console IAM grants.

## Use

Choose **Continue with Google** and select your approved Google account. Other accounts are automatically signed out before the workspace mounts; no lead data is loaded for them. The API verifies the Firebase ID token (including revocation), requires a verified email, and checks the exact server-side whitelist on **every** route. Frontend checks are only a convenience. Unlisted users cannot view or edit leads even if they register directly with Firebase Auth.

Search all loaded businesses by name, aliases, phone, service, or location; filter by service, call status and website assessment. Select a business to read its sources, review dated search evidence, log a call, append notes, or update website research. “Do not call” suppresses the call button. Notes and review activity retain their author and timestamp. Version checks protect against simultaneous edits; refresh after a conflict.

## Development

Node 22 is the deployed Functions runtime. Local checks also passed with Node 24.

```sh
npm ci
cp .env.example .env  # supply Firebase public web config; do not overwrite an existing configured .env
npm run web
npm run typecheck
npm test
firebase emulators:exec --only firestore,auth --project demo-daniboy 'npm test && node tests/firestore-rules.cjs'
npm run build:web
```

`npm test` runs pure unit tests; integration tests run when emulator environment variables are present. Tests cover access control, website evidence validation, timezone/DST schedule slots, phone deduplication, transaction races, preserved call history, stale edits, global run leases, missing credentials, and Firestore rules. Native app store binaries have not been built or device-tested.

## Configure discovery / redeploy

1. Blaze is already enabled for `daniboy-be1c0`. Keep it enabled for Functions and scheduling.
2. Update the server-only `DISCOVERY_CREDENTIALS` secret with both search keys (currently an empty configuration; never place these keys in `EXPO_PUBLIC_*`):

```sh
firebase functions:secrets:set DISCOVERY_CREDENTIALS --project daniboy-be1c0
```

Enter JSON with `googlePlacesApiKey` and `braveSearchApiKey`. The current `{}` configuration keeps runs clearly blocked until keys are supplied. Preserve any existing key when updating the JSON. Use Google Places API (New), with that API enabled and billing configured, and a Brave Search API plan suitable for your usage and retention needs. The implementation uses documented APIs, not scraping or a chat session token.

3. Deploy:

```sh
npm run deploy
```

The deploy command builds/tests and deploys `api`, `discoverLeads`, Firestore rules, and Hosting to the explicit project. A seven-day Artifact Registry cleanup policy is already configured. Redeploy Functions after changing the secret so they use the new version.

4. Sign in, check Discovery, save coverage, and run once. Confirm the run log before relying on automation. The defaults are **09:00, 13:00, 17:00 America/New_York**, eight candidates per run, the five initial categories, and five US cities. Times are editable in 15-minute increments. The switch is persisted by **Save schedule**. Disabling stops future runs; a run already in progress can finish.

A private Cloud Scheduler function checks slots every 15 minutes. Firestore run claims prevent reprocessing a slot; a global lease prevents simultaneous searches. The same local hour during a DST fall-back runs once. Missed slots are not backfilled. Provider failures are recorded and not silently retried, limiting unexpected search spending. At most 20 candidates per run; each checks business name, phone and a normalized name, plus up to three known aliases. A wall-clock budget stops before the function timeout.

## API / ingestion

Base URL: `https://daniboy-be1c0.web.app/api`

Every endpoint requires `Authorization: Bearer <Firebase ID token>` belonging to a verified whitelisted user. Never use the public Firebase API key as an ingestion credential. Machine-to-machine service accounts are intentionally not granted access in phase one.

- `GET /me`, `GET /leads?cursor=<id>` (100 per page), `GET /leads/:id/activity`
- `POST /leads` for one lead; `POST /ingest` for an array of 1–50 leads
- `PATCH /leads/:id` with `expectedVersion` and `callStatus` and/or `note`
- `PATCH /leads/:id/research` with `expectedVersion`, `websiteStatus`, `websiteUrl`, `sourceUrl`, and `summary`
- `GET /settings`, `PATCH /settings`, `GET /runs`, `POST /discovery/run`

See `data/starter-leads.json` for valid ingestion payloads and `functions/src/domain.ts` for complete validation. Statuses other than “Not checked” require evidence and a check date. “Independent site found” requires the site URL. Caller-supplied business URLs are displayed as links, never fetched by the backend.

Deduplication uses normalized US phone numbers, with transaction-safe deterministic IDs. Re-ingestion adds sources/aliases without resetting call status or notes. Matching normalized name/location with a different phone is flagged for review rather than automatically merged. Shared phone numbers can represent related businesses; review aliases before outreach. “No site found” means only that no independent website was found in those searches. An unfamiliar result domain becomes **Uncertain**, requiring human identity verification. Discovery excludes businesses with a listed independent website.

## Administrative setup

`scripts/firebase-admin.cjs` uses the existing Firebase CLI login in memory; it never prints tokens. Modes: `status`, `deployment`, `services`, `auth`, `webconfig`, and `seed`. Auth must be initialized once via Firebase Console → Authentication → Get started. `seed` creates missing records only and preserves existing ones. `scripts/build-seed.cjs` is an optional importer for the original temporary workbook-builder source; the checked-in JSON makes that temporary file unnecessary.

## Explicitly deferred

Website generation uses an authenticated Firebase queue and local GPT worker. See [GENERATION.md](docs/GENERATION.md) for setup. Public business facts and five competitor examples inform a custom landing page; private call notes are excluded.

## Local research and enriched calling profiles

- [Local LLM research brief](docs/RESEARCH-BRIEF.md): service searches, exclusion snapshots, evidence, public business details and five genuine competitors per job type/service area.
- [Backoffice API and import guide](docs/BACKOFFICE-API.md): bearer access, exact payloads, skip-existing imports, enrichment and outreach updates.

Leads → **Import / research guide** accepts pasted JSON. Profiles show collected Google ratings, address, hours, services, review excerpts and attributed image links. Competitor sections show five-reference progress without pretending unverified websites are real. No additional live fetching is introduced. Call-status selections save immediately; notes retain their explicit save button. Deploy both Hosting and Functions for these changes to reach production.

## Daily researched content and directory updates

A Codex thread automation is configured for 11:00 AM America/Recife to target 5–10 new evidence-backed home-service leads daily. See [daily research workflow](docs/DAILY-RESEARCH.md). It uses the local Firebase CLI operator login, with imports attributed to `codex-research`; no separate agent Gmail account or stored service-account key is created. The connected Gmail account is `doron.elisha@gmail.com`. Expired login, unavailable computer/app, or inaccessible evidence can block a run. No daily quota is guaranteed and no researched import has been claimed merely from scheduling it.

`node scripts/research.cjs snapshot research/existing.json` exports the complete collection and configured coverage. `node scripts/research.cjs import research/leads.json` validates at most ten records, requires a No site found assessment and five sourced competitors, skips existing phone/name/Maps matches, and checks the daily cap. Phone and name identity checks run in the write transaction; fuzzy identity checks remain a research obligation. The script uses existing local Firebase administrative access, distinct from the public user API. Do not share its login or export credentials.

Directory filters now include location, five-example coverage, incomplete research, duplicate review, and ready-to-call leads; sorting includes newest, alphabetical and fewest examples. Each row shows example coverage. The business editor updates address, public email, opening hours, services and research notes with source attribution and optimistic concurrency. `PATCH /leads/:id/content` is protected by the same verified-email guard and records an activity entry. It preserves call state and requires the current version.

The lead directory and business profile include **Generate**, live job status and a website link to its right. Verified Google identity and five competitor examples are required. Existing unverified records remain in **Needs verification**. The separate prospect Hosting site preserves demo pages across backoffice deployments.

## Deploy on every push

Every Git push must be accompanied by a successful deployment of that revision. `.github/workflows/deploy.yml` runs on every branch push, checks types, tests and builds, then deploys Hosting, Functions and Firestore to `daniboy-be1c0`. Monitor the Actions result after pushing. Failed validation stops deployment and must be fixed before the work is considered delivered.

Before the first Actions deployment, set these GitHub repository **variables**:

- `EXPO_PUBLIC_FIREBASE_API_KEY` and `EXPO_PUBLIC_FIREBASE_APP_ID`: the public Firebase web configuration from the local `.env`.
- `GCP_WORKLOAD_IDENTITY_PROVIDER`: full Google Cloud Workload Identity provider resource name.
- `GCP_DEPLOY_SERVICE_ACCOUNT`: deployment service account email.

Configure the identity provider to trust only `Benelisha/DaniTheKing` and allow that repository's GitHub identity to impersonate the deployment account. Grant the account the Firebase deployment permissions needed for Hosting, Functions, Firestore, service-account impersonation, and access to the existing Functions secrets. This uses short-lived credentials; do not upload local Firebase login tokens or private service-account keys. See the [Google authentication action setup](https://github.com/google-github-actions/auth) and [Firebase CI authentication documentation](https://firebase.google.com/docs/cli#cli-ci-systems).

The workflow is prepared locally; cloud identity configuration and a successful Actions run must be confirmed before claiming automatic deployment is active. Until then, use `npm run deploy` with the existing local Firebase operator login for each push.

## Current discovery policy

Automated provider discovery is disabled regardless of stored settings or keys. Only manually verified Google Maps businesses appear in the working list. Older provider-setup documentation describes a retained integration, not the active research workflow. See [generation and verification setup](docs/GENERATION.md).

### Hosted Website Studio

Website Studio design and Compare & improve run in the `studioTask` Firebase task queue in `us-central1`, using the existing Secret Manager `GEMINI_API_KEY` and configured Gemini text model. They do not use a user's Codex login, laptop, or local worker. Chromium renders the bundled production website on desktop and mobile; screenshots and observed competitor pages inform the model, and browser checks still gate publishing.

Generate all uses Storio’s backend-owned pipeline pattern: `POST /api/sites/leads/:id/generate` accepts `{revision, requestId}` and returns immediately after creating a durable `studioRuns` record. One named Cloud Task runs Examples → Blueprint → Brief → Content → Design → Review, saving each stage to the studio before advancing. Duplicate starts attach to the live run. The frontend only reads progress through the authenticated API, so refreshing or closing the studio does not stop generation. `POST /api/sites/leads/:id/generation/stop` stops after the current saved stage. Failed runs resume from the first missing step when Generate all is pressed again; a failing quality review is reported as `needs_review` and still blocks publishing.

Runs use a heartbeat and fenced writes. Cloud Tasks makes one attempt per run; the recovery scheduler marks interrupted runs failed for explicit retry rather than repeating paid AI work automatically. Separate legacy single-stage jobs retain their bounded queue recovery.

Competitor text, computed visual evidence and screenshots are checkpointed privately in Firebase Storage, indexed by the exact ordered website URLs and research format version under `websiteStudios/:id/research`. Blueprint, design and review reuse that checkpoint, including across failed/restarted runs. Selecting different URLs captures new evidence; a missing or corrupt checkpoint is recaptured. At least three websites must have usable browser evidence. Previously saved example selections and completed draft steps are preserved, but older screenshots that were never persisted must be captured once.

Firebase predeploy builds and packages the shared renderer and worker into the ignored `functions/studio-runtime` directory. No credentials are packaged. `npm run worker:studio` and its installer are retired. Remove an existing macOS agent with `launchctl bootout gui/$(id -u)/dev.benlish.daniboy.website-studio`.
