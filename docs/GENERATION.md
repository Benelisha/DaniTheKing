# Verified leads and local website generator

The backoffice shows only manually verified Google Maps businesses by default. **Needs verification** preserves existing records, notes and call history. Open a full Google listing, match name, phone and address/service area, then save the review. A search-only URL, short link or directory page is not sufficient. Review records are server-owned in `googleVerifications/{leadId}` and bound to a fingerprint of business identity. Imports never grant verification. Automated provider discovery is disabled.

## Start on this computer

1. `npm ci` and `npm run typecheck`.
2. Copy `.env.worker.example` to `.env.worker` if it does not exist. Set an **OpenAI** API key there. A Google/Gemini API key will not work. Never put secrets in `EXPO_PUBLIC_*` or Git.
3. Use existing Firebase CLI login with `FIREBASE_CLI_AUTH=true`, or configure Application Default Credentials outside this repository. The worker requires Firestore and Firebase Hosting permissions in `daniboy-be1c0`. CLI-login reuse holds its refresh token in memory and does not create another credential file.
4. Set `GENERATOR_CHROME_PATH` to installed Chrome, or run `npx playwright install chromium` and omit that variable.
5. `npm run worker`. Leave the process running and computer awake. For setup only: `npm run worker -- --setup`.

No public localhost, tunnel account or subscription is needed. The worker connects outbound to Firebase. Offline jobs wait in Firestore. The web app shows heartbeat-based online status. The worker exits immediately with an actionable message when its OpenAI key is missing.

## Generate

Only the two approved verified users can queue jobs. A lead needs a current manual Google review, a usable phone, five distinct example domains and no Do not call status. Generate captures a snapshot of public facts; private call notes and internal research notes are excluded. Each reference is rendered in an isolated browser, with public-IP-only GET requests pinned to validated addresses, no credentials and no downloads. If any reference cannot be inspected, the job fails with the affected URL.

The versioned prompt combines reference screenshots, page structure, typography, colors, CTAs and business facts. GPT returns custom HTML/CSS as structured JSON. No generated code is executed as commands, installed, or granted local filesystem access. Output excludes scripts, external assets, tracking and forms. Copy and visual treatment are original; competitor branding, testimonials, photos and claims are not reused.

The default is `gpt-5-mini`, with reference prices checked on 2026-10-22: $0.25/M input tokens and $2/M output tokens. This is configurable; other models require explicit positive price configuration. Review model availability and pricing before changing it. Each job reserves a conservative maximum before a request, logs actual usage after a response, caps output at 16,000 tokens, and permits one repair attempt. The $1 cap includes reservations for timed-out requests with unknown usage. A failed/ambiguous request is never automatically retried for another API charge. **Retry saved job** is explicit and retains its budget ledger; publishing retries reuse saved HTML.

## Storage, recovery and publishing

- `generations/{uuid}`: requester, snapshot, version, budget/usage, status, lease, timestamps and safe error.
- `generations/{uuid}/references/{0..4}`: reference analysis and screenshots.
- `generations/{uuid}/artifacts/*`: prompts, responses, validated HTML/hash and mobile/desktop previews. Firestore client rules deny access; only trusted server/local code can read these records.
- `internal/generatorLock`: renewable global lease; one worker processes/publishes at a time. Expired jobs resume from saved artifacts. A request interrupted before its response is saved requires explicit retry, retaining reserved spend.
- `internal/generatorWorker`: heartbeat and readiness.

Static pages publish to `daniboy-be1c0-prospects`, a separate Firebase Hosting site in **the same project**, at `https://daniboy-be1c0-prospects.web.app/{leadId}/`. Each release starts from the entire live file manifest, replaces only the selected page, and preserves other prospect pages. Missing existing assets abort publication. A failed live check restores the prior release when available. Previous versions remain recoverable through Firebase Hosting. The normal GitHub/local backoffice deployment targets only `daniboy-be1c0`, never the prospect site.

The public URL is saved on the lead only after a live page check verifies the generation marker. Regeneration keeps the previous URL available. Demos include semantic HTML, title/description, Open Graph data and factual LocalBusiness schema, plus `noindex` metadata and response headers. After sale, manually deploy the saved artifact to a custom domain, remove demo/noindex markers, and set canonical/sitemap details. Payment, customer accounts, inquiry forms and automated custom-domain setup are outside this version.

## Checks

`npm run typecheck`, `npm test`, `npm run test:emulators`, `npm run build:web`.

`GENERATOR_CHROME_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' node worker/render-smoke.cjs` verifies the renderer at 375px and 1440px using an explicitly fictional local fixture; it is not a paid GPT generation or a real prospect site. Screenshots are saved under ignored `worker-artifacts/qa/`.

Every Git push must be followed through successful Firebase deployment. Watch GitHub Actions first; when repository federation configuration is absent, deploy the same revision locally with `npm run deploy` and report that fallback.
