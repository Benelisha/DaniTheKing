# Backoffice API and import guide

## Access

Base URL: `https://daniboy-be1c0.web.app/api`.

This is an internet-accessible API with private team authorization on every route. Sign into the backoffice using Google. Requests carry `Authorization: Bearer <Firebase ID token>` and `Content-Type: application/json`. The Firebase public API key, a Google OAuth access token and a service account token are not substitutes. Tokens expire; the frontend obtains a current token from the signed-in Firebase user for each request. Never put bearer tokens in research files, CSVs, committed scripts or shared prompts.

Current exact verified-email allowlist: `daniel@alined.dev`, `doron.elisha@gmail.com`. The existing README identifies Ben with the latter account. Three separate identities are NOT configured. To grant a distinct third Google account, obtain its exact email and update BOTH `functions/src/domain.ts` and `src/firebase.ts`, then deploy. Do not authorize by display name. Direct Firestore client writes are denied; writes go through the API. The current guard checks a verified Firebase identity and allowlist; it does not require a specific Google provider claim.

## Use the backoffice

1. Sign in, choose Leads → **Import / research guide**.
2. Follow `RESEARCH-BRIEF.md` locally and prepare a JSON array.
3. Paste 1–50 records and choose **Import · skip existing phones**. CSV/file-picker upload is deferred. This uses `POST /ingest?skipExisting=true`.
4. Read the added/skipped result and review the directory. Existing phone matches are skipped transactionally, even when another importer adds the same phone at the same time. Name/location with a different phone is flagged; review before calling.
5. Open a business to inspect its profile, image/source links, review excerpts, website evidence and competitors. “Five competitors recorded” counts evidence-bearing entries, not independent automated verification. Missing data stays visibly unknown.
6. Call the business, then select a call status: the selection saves immediately through PATCH. Merely opening the dialer does not log a completed call. Notes use **Save call update**. Wait for the saved confirmation; failures show an error. Call history records author, timestamp, previous and new status. “Do not call” suppresses the call action.

These changes require deploying the updated frontend AND API. A local build does not change the hosted app or production Firestore.

## Routes

| Method and path | Input / result |
| --- | --- |
| GET `/me` | Signed-in email and service categories |
| GET `/leads?cursor=<id>` | `{leads, cursor}`; 100 per page; repeat until cursor is null |
| POST `/leads` | One research record; returns `{id, created}` |
| POST `/ingest?skipExisting=true` | Array of 1–50 records; `{results:[{id,created,skipped?}]}` |
| POST `/ingest` | Explicit enrichment/upsert mode; existing phones merge sources/aliases and supplied profile/competitors; preserves call status/history |
| GET `/leads/:id/activity` | Up to 100 newest activity records |
| PATCH `/leads/:id` | `{expectedVersion,callStatus?,note?}`; returns new version |
| PATCH `/leads/:id/research` | `{expectedVersion,websiteStatus,websiteUrl,sourceUrl,summary}` |
| GET / PATCH `/settings` | Discovery settings; outside the local-research workflow |
| GET `/runs` | Recent discovery runs |
| POST `/discovery/run` | Starts discovery; not needed for local LLM research |

401: missing/invalid/expired token. 403: unverified or unlisted account. 400: invalid payload. 404: missing lead. 409: stale version; reload, review the new state, then retry deliberately. Never overwrite another caller's changes silently.

## Record contract

Required: `businessName` (2–200 chars), `phone` (valid US), `service` (2–100), `location` (2–200), `sources` (1–30 objects with HTTP(S) `url`, `title` ≤200 and ISO UTC `observedAt`). Unknown keys are rejected.

Optional: `alternateNames` (≤10), `researchNotes` (≤5000), `websiteStatus`, `websiteUrl`, `websiteCheckedAt`, `evidence` (≤40), `profile`, `competitors` (≤5). Omit unknown optional fields instead of sending null. `websiteUrl` may be empty; `websiteCheckedAt` may be null.

Website statuses: `Not checked`, `No site found`, `Independent site found`, `Uncertain`, `Owner confirmed no website`. Any assessment other than `Not checked` requires `websiteCheckedAt` and at least one evidence object `{query, url?, summary, checkedAt}`. An independent site assessment also requires `websiteUrl`.

`profile` accepts `address`, `googleMapsUrl`, `googlePlaceId`, `rating` (0–5), `reviewCount` (nonnegative integer), `publicEmail`, `openingHours`, `services` (≤40 strings), `images` (≤10 `{url,sourceUrl,caption}`), `reviews` (≤10 `{text,author,sourceUrl,rating?,publishedAt?}`). Its `sourceUrl` and `observedAt` are required. Add field-specific provenance to evidence/sources where multiple sources contributed. Image links are displayed as links with attribution, not copied or fetched by the backend.

Each competitor requires `businessName`, `service`, `location`, HTTP(S) `websiteUrl`, HTTP(S) `sourceUrl`, ISO UTC `verifiedAt`, and `verificationNotes` (10–2000 chars). Domains must be distinct (case and `www` normalized). Research must additionally verify different businesses, genuine sites and relevant service areas. Partial sets are allowed as incomplete work; five verified competitors are required before reference use.

Example structure below is SYNTHETIC, not researched data. Do not import it as a real lead or count example.com as a competitor. Expand to five real verified competitors for a completed record.

```json
[
  {
    "businessName": "SYNTHETIC FORMAT EXAMPLE",
    "phone": "+13055550199",
    "service": "House cleaning",
    "location": "Miami, FL",
    "sources": [{"url":"https://example.com/listing","title":"Example source","observedAt":"2026-10-22T18:00:00Z"}],
    "websiteStatus": "Not checked",
    "researchNotes": "Format example only; research is incomplete.",
    "profile": {
      "address": "Example address",
      "sourceUrl": "https://example.com/listing",
      "observedAt": "2026-10-22T18:00:00Z",
      "images": [],
      "reviews": []
    },
    "competitors": [{
      "businessName":"SYNTHETIC COMPETITOR EXAMPLE",
      "service":"House cleaning",
      "location":"Miami, FL",
      "websiteUrl":"https://example.com",
      "sourceUrl":"https://example.com/contact",
      "verifiedAt":"2026-10-22T18:00:00Z",
      "verificationNotes":"Example only, not a verified competitor. Replace with actual identity evidence."
    }]
  }
]
```

## Existing leads and safe retries

Default frontend import skips existing phones entirely. To enrich a known lead intentionally, use authenticated `POST /leads` or `POST /ingest` without `skipExisting=true`. Supplied profile and competitor arrays replace those sections; send the complete desired sections, not partial deltas. Omit them to preserve existing values. Sources/aliases merge; newer dated website research can update research unless owner-confirmed. Call status and call history remain unchanged.

API input is validated for the whole batch before any write, but records are committed individually. A database/network failure can leave a partial batch. Retry skip-existing mode safely and reconcile IDs/counts. Default upsert retries may increment versions; they do not reset calling status.

Call statuses: `Not called`, `No answer`, `Follow up`, `Interested`, `Not interested`, `Wrong number`, `Do not call`. Example request body: `{"expectedVersion":1,"callStatus":"Follow up","note":"Spoke with owner; requested another call."}`. Use the current version from GET, not a hardcoded value. Notes are activity entries rather than an overwritten text field.

## Profile editing and scheduled operator imports

`PATCH /leads/:id/content` accepts `{expectedVersion, researchNotes, profile?}`. The optional profile uses the complete profile schema above and replaces that section; omit it to preserve existing details. The endpoint checks the current version and records the editor in activity history, preserving calls and notes. Daniel can use **Edit business details** directly in the business profile for address, public email, hours, services and research notes.

The authorized daily Codex workflow is documented in `DAILY-RESEARCH.md`. Its local operator script uses the existing Firebase CLI administrator login and shared validated transaction writer; it does not change public API authorization or direct client rules. This supersedes the manual-only import handoff for that scheduled workflow. Imports require five sourced business examples and a dated No site found assessment; human verification is still needed to establish authenticity. No independent website found is a search result, not owner confirmation.

## Social and platform presence
`profile.onlinePresence` supports up to eight unique platform entries: Instagram, Facebook, LinkedIn, TikTok, YouTube, X, Nextdoor and Yelp. Each entry has platform, status (`Found`, `Not found`, `Not checked`), sourceUrl and ISO checkedAt, plus optional url and notes. Found requires a public URL on the matching platform domain. Not found requires search notes and cannot have a profile URL. Missing entries mean Not checked, never absence. Existing business source links also surface their recorded platforms automatically; competitor/generated websites are excluded. Website status continues to use websiteStatus/websiteUrl. Edit social findings in Edit business details.

## Google verification and generation

`GET /leads` returns verified Google businesses. `?view=unverified` returns the review queue; `?view=all` returns all records for deduplication. Follow pagination even when a filtered page is empty.

`POST /leads` and `POST /ingest` require a full Maps listing URL in `profile.googleMapsUrl`. They do not grant verification. Client-supplied verification or generation fields are rejected.

`POST /leads/:id/verification`: `{expectedVersion,status,listingUrl,notes,nameMatched,phoneMatched,areaMatched,placeId?}`. Status is `verified`, `ambiguous` or `unmatched`. Verification requires all three match attestations and an actual listing URL. Reviewer and time are server-assigned. Identity edits invalidate eligibility.

`POST /leads/:id/generations`: `{expectedVersion}`. Returns `{id,status}`; duplicate requests reuse the active job. Requires verification, phone and five examples.

`GET /generations/:id`: safe job status, error, published URL and usage. It does not expose private artifacts, snapshots or prompts.

`POST /generations/:id/retry`: `{}`. Requeues the latest failed job with its existing snapshot, artifacts and budget reservations. Identity must still match; no Do not call leads.

`GET /generator/status`: `{online,ready,lastSeen}`. An offline worker does not prevent queueing.

See GENERATION.md for local setup, storage, recovery and publishing.
