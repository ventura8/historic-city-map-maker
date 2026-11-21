# M2 interfaces: the backend contracts the parallel agents build on

Written on 2026-10-12 by the M2 contracts agent, alone in the tree, before the M2 backend workstreams start in
parallel. Read it together with `PLAN.md` (Addenda 1–3), `design-review-security-cost.md` (IAM §1.1, secrets §1.2,
public tokens §1.3, rules §1.4–§1.5, reliability §4), `design-review-onboarding.md` (the wizards of §2),
`M1-interfaces.md` (the viewer contracts and CR-1 to CR-21), `M0-handoff.md` (toolchain, gates, workspaces) and
`docs/ENGINE_API.md` (the public manifest).

Everything marked **done** exists and is tested (100 % lines and branches per file); everything else is a contract the
owning workstream implements exactly as written. A change to anything here goes through
[Change requests](#change-requests), never by editing another workstream's files. Nothing in M2 touches a real Google,
Mapbox or USGS endpoint: every test runs against the Firebase emulators (project `demo-hcm`) and local fakes.

## 1. Module ownership

| Workstream | Owns (writes) | Notes |
| --- | --- | --- |
| contracts (**done**) | `packages/shared/src/{schemas,api,i18n/api,text/redact.ts}/**` (the M2 parts), `functions/src/ports/**`, `functions/src/api/**`, this file | After the parallel build starts, these change only through a change request. Exception: a workstream that first imports a port's secondary type (`AuthUser`, `QueryOptions`, `DocumentTransaction`, ...) adds `export` to it (they stay file-local until someone imports them, or knip reports them) and says so in its report. |
| rules | `firebase/firestore.rules`, `firebase/storage.rules`, `firebase/firestore.indexes.json`, `firebase/rules-tests/**` | Mirrors `CLIENT_WRITES` and the paths of §2 (CR-M2-1). |
| fn-admin | `functions/src/{admin,history,telemetry}/**`, `functions/src/adapters/{documents,auth-admin,error-reporting}.ts`, their tests under `functions/test/{admin,history,telemetry,adapters}/**` | `admin.*`, `admins.*`, `history.*`, `telemetry.*`; the Firestore, Auth and Error Reporting adapters. |
| fn-setup | `functions/src/setup/**`, `functions/src/adapters/{secret-manager,mapbox,usgs,firebase-management,resource-manager}.ts`, tests under `functions/test/{setup,adapters}/**` | `setup.*`; the Secret Manager adapter replaces `adapters/secret-store-rest.ts` (rename, same behaviour); moves `setup-status` from the M0 `triggers/` and `handlers/` folders into `setup/` and deletes those folders and `triggers/admin-guard.ts` (superseded by `functions/src/api/access.ts`). |
| fn-content | `functions/src/{photos,publish,ops}/**`, `functions/src/adapters/{storage,cloud-tasks,image}.ts`, tests under `functions/test/{photos,publish,ops,adapters}/**` | `photos.*`, `publish.*`, `ops.*`. |
| fakes | `packages/test-support/src/{api-fixtures,fakes}/**` (with their `package.json` exports), `functions/test/support/**` | The upstream fixtures and fakes every tier shares (§7), and the in-memory port fakes the three function workstreams use. |
| integrator | `functions/src/index.ts`, `functions/src/global-options.ts`, `functions/src/deps.ts`, `functions/package.json`, `firebase.json`, `docs/*.md`, `.agent/**`, `.agents/**`, `.claude/**`, `e2e/scenarios.json` after this task | Wires the registry (§3) into exports, picks the adapters, resolves the change requests. |

Adapters a workstream writes are its own, even when another workstream's handler uses them; a missing adapter method is
a change request to its owner. Ask-first files (`AGENTS.md` → *Boundaries*) stay ask-first: the proposals of this
milestone are `DECISIONS-for-review.md` §19.

Tests live under `functions/test/<folder>/**` mirroring `functions/src/<folder>/**`, and name their scenarios (§6) with
the tag `@S-…` anywhere in the file, usually in the test title (the `e2e-matrix` gate reads `functions/test/` and
`firebase/rules-tests/`; a `Scenarios:` line is matched only at the start of a line, as Python docstrings write it).

## 2. Firestore model (done)

`@hcm/shared` holds every document schema; every server writer validates with it before writing (the Admin SDK
bypasses the rules) and every reader validates what it reads.

| File | Exports |
| --- | --- |
| `packages/shared/src/schemas/firestore-common.ts` | `timestampSchema`, `TimestampLike`, `timestampFromDate`, `timestampToDate`, `uidSchema`, `sha256Schema`, `SYSTEM_WRITERS`, `systemWriter`, the audit `stamp` |
| `packages/shared/src/schemas/firestore.ts` | content: `cityDocSchema`, `photoDocSchema`, `layerDocSchema`, `poiDocSchema`, `poiCategoryDocSchema`, `historyEntryDocSchema`; `FIRESTORE_LICENSES`, `PROCESSING_STATES`, `LAYER_STATUSES`, `USGS_DATASETS`, `GEOREF_METHODS`, `HISTORY_ENTITIES`, `HISTORY_ACTIONS`, `PHOTO_CONTENT_TYPES`, `mapboxTokenIdSchema`, `httpsOriginSchema` |
| `packages/shared/src/schemas/firestore-ops.ts` | operations: `jobDocSchema`, `jobLogDocSchema`, `usgsSceneDocSchema`, `setupStatusDocSchema`, `ownerDocSchema`, `adminDocSchema`, `inviteDocSchema`, `usageDocSchema`, `opsGuardDocSchema`, `manifestStateDocSchema`; `JOB_*`, `USGS_SCENE_STATUSES`, `SERVICE_STATES`, `SETUP_AREAS`, `PROVISION_ITEMS`, `USGS_ROLES`, `ADMIN_ROLES`, `GUARD_*`, `OPS_STEPS`, `MANIFEST_BUILD_STATES`, `MANIFEST_ENTITIES` |
| `packages/shared/src/schemas/client-writes.ts` | `CLIENT_WRITES`: per collection, the fields a client create may contain and an update may change |
| `packages/shared/src/schemas/paths.ts` | `FIRESTORE_PATHS`, `STORAGE_PATHS`, `auditedDocumentPath`, `parseAuditedDocumentPath`, `parsePhotoUploadPath`, `publicObjectUrl`, `CITY_ID_PATTERN`, `cityIdSchema`, `UPLOAD_FILE_PATTERN`, `PHOTO_EXTENSIONS`, `PHOTO_VARIANTS` |

### 2.1 Documents

| Path | Schema | Written by | Client (rules) |
| --- | --- | --- | --- |
| `cities/{city}` | `cityDocSchema` | admins (settings), `setup.saveMapbox` / `rotatePublicToken` (`mapbox`), `setup.analyticsConfig` (`analytics`) | read, update `CLIENT_WRITES.city.update` |
| `cities/{city}/photos/{photo}` | `photoDocSchema` | admins; `photos.onUpload` (`image`, `exif`, `processing`, `processingError`, `duplicateOf`, `suggested`, `original`) | read, create, update, delete |
| `cities/{city}/layers/{layer}` | `layerDocSchema` | the pipeline (M3); admins (presentation, opacity, `adjustments`) | read, update |
| `cities/{city}/pois/{poi}` | `poiDocSchema` | admins | read, create, update, delete |
| `cities/{city}/poiCategories/{category}` | `poiCategoryDocSchema` | admins | read, create, update, delete |
| `<audited document>/history/{entry}` | `historyEntryDocSchema` | `history.on*Write`, `history.revert` | read only |
| `cities/{city}/jobs/{job}` (+ `logs/{line}`) | `jobDocSchema`, `jobLogDocSchema` | admins create `queued`; the dispatcher and the pipeline (M3) | read; create; update `cancelRequested` |
| `cities/{city}/usgsScenes/{entity}` | `usgsSceneDocSchema` | the harvest (M3); admins triage | read; update `status`, `note` |
| `setup/status` | `setupStatusDocSchema` | `setup.*`, `ops.tick` | read only |
| `setup/owner` | `ownerDocSchema` | `admin.claim` (created once) | read only |
| `admins/{uid}` | `adminDocSchema` | `admin.claim`, `admin.join`, `admins.revoke`, the bootstrap script | read (own or admin) |
| `invites/{sha256}` | `inviteDocSchema` | `admins.invite`; deleted by `admin.join`, `admins.revoke`, `ops.tick` | read only |
| `usage/mapbox-YYYY-MM` | `usageDocSchema` | the publisher (M3) | read only |
| `ops/guard` | `opsGuardDocSchema` | `ops.tick`, `ops.onBudget` | read only |
| `manifests/{city}` | `manifestStateDocSchema` | `publish.*` | read only |

`setup/status` holds one record per Setup Assistant area (`SETUP_AREAS`: billing, provision, mapbox, usgs, analytics,
crash), each `{state, checkedAt?, detail?, params?}` plus its area's non-secret fields; `state` is one of
`SERVICE_STATES` (`missing`, `pending` = waiting for someone outside such as the USGS approval, `ok`, `invalid`,
`unavailable` = the service did not answer); `detail` is an error code (§3.0) with its `params`, never free text.

### 2.2 Audit stamp and history

- **Every** document carries `updatedBy` and `updatedAt`. A client write stamps its uid and `serverTimestamp()` (the
  rules check both); a callable stamps the calling admin's uid; a trigger or the scheduler stamps
  `systemWriter('<family>')` (`system:history`, `system:photos`, `system:publish`, `system:ops`, `system:setup`,
  `system:pipeline`, ...). Handlers write times with `timestampFromDate(clock.now())`.
- **History** (PLAN Addendum 3): the triggers `history.on{City,Layer,Photo,Poi,PoiCategory}Write`
  (`onDocumentWrittenWithAuthContext`, so a delete knows who deleted) write one entry per change into the document's
  `history` subcollection, id `historyEntryId(eventTime, event.id)` (sorts by time; a redelivered event writes the same
  entry). `cityId` names the document's city (the admin's recent changes ask one city's entries across the collection
  group, CR-M2c-14), `previous` is the whole document before the change (none for a create), `changedFields` the top-level keys
  whose values differ, the stamp the change's own (a delete: `event.authId`, else `system:<authType>`, at the event's time but never before the version it deleted, `docs/LESSONS.md` 121). After writing,
  the trigger deletes the oldest entries beyond `HISTORY_KEEP` (50).
- `history.revert` writes the restored document **and** its own `revert` entry (`revertOf` = the restored entry,
  `previous` = the version it replaced, null when it restores a deleted document) in one transaction; the trigger
  skips a change whose newest entry is a `revert` with the same `updatedAt`.

### 2.3 Client writes: CR-1 and CR-4 resolved

`CLIENT_WRITES` (`client-writes.ts`) is the contract the rules mirror; `packages/shared/test/schemas/client-writes.test.ts`
pins that every listed field belongs to its schema, every write carries the stamp, and no server-owned field is
listed. What the rules must change (CR-M2-1, owner: rules):

- **CR-1**: photos accept `dateText` (`{ro, en?}`, ≤ 100) and require `title.ro` (`localizedPartial`: Romanian
  required, English optional), for create and update.
- **CR-4**: `pois/{poi}` and `poiCategories/{category}`: admin create, update and delete with exactly the fields of
  `CLIENT_WRITES.poi` / `.poiCategory` (geometry `{type:'Point', point}`, `{type:'LineString', points}` or
  `{type:'Polygon', rings:[{points}]}` with at most 500 vertices and 20 rings, `category` an id, `photoIds` ≤ 20,
  `links` ≤ 5, icon `^[a-z0-9_]{1,64}$`, colour `#rrggbb`, `defaultOpacity` 0–1); `history/{entry}` under every audited
  document (`cities/{city}/history/{entry}` and `cities/{city}/{collection}/{id}/history/{entry}` for `layers`,
  `photos`, `pois`, `poiCategories`): admin read, never written by a client;
  `layers`: admins may also change `adjustments` (the four `LAYER_ADJUSTMENT_RANGES`, `brightnessMin ≤
  brightnessMax`), `year`, `date`; `cities/{city}`: `photosOverlay.defaultOpacity` 0–1, and `analytics` and `engine`
  join `id`, `mapbox`, `createdAt` as server-owned.
- **Stamps everywhere**: job creates carry `updatedBy`/`updatedAt` too (`CLIENT_WRITES.job`), so does the
  cancellation and every `usgsScenes` triage update.
- **Server-owned photo fields** join the photo key list: `processingError`, `duplicateOf`, `suggested`, `original`
  (never client-writable, like `image`, `exif`, `processing`).
- **New read-only collections** for admins: `invites/{id}`, `manifests/{city}`, `setup/owner` (inside `setup/{doc}`).

### 2.4 Paths and buckets

`FIRESTORE_PATHS` and `STORAGE_PATHS` spell every path; builders throw a `RangeError` on an id that could leave its
segment. City ids are lowercase (`CITY_ID_PATTERN` = `^[a-z0-9-]{2,32}$`, what `storage.rules` already matches; the
manifest's `city.id` keeps the wider `ID_PATTERN`).

| Object | Bucket | Path |
| --- | --- | --- |
| photo upload (client) | private | `uploads/photos/{city}/{uid}/{photo}/{nonce}.{ext}`; `{photo}` is the photo document created just before; the original file name travels as the custom metadata `originalName` |
| photo original | private | `originals/photos/{city}/{photo}/{sha256}.{ext}` |
| photo derivatives | public | `photos/{city}/{photo}/{sha8}/{web,thumb}.webp`, `Cache-Control: public, max-age=31536000, immutable` |
| manifest | public | `cities/{city}/manifest.json`, gzip, `Cache-Control: public, max-age=60` |

Public URLs are `publicObjectUrl(bucket, path)` = `https://storage.googleapis.com/<bucket>/<path>`.

## 3. API contracts (`packages/shared/src/api/**`, done)

`CALLABLES`, `HTTP_ENDPOINTS` and `BACKGROUND_FUNCTIONS` (`packages/shared/src/api/registry.ts`) list every function with
its owner. The functions validate requests and responses against these schemas; the admin calls
`httpsCallable(functions, deployedName(name))` (`admin.claim` deploys as `admin-claim`) and validates the answer.

### 3.0 Conventions

- **Plumbing (done)**: `defineCallable(name, handler, getDeps)` (`functions/src/api/callable.ts`) builds every
  callable: options from the registry (`maxInstances`; App Check from `HCM_APP_CHECK`: `monitor` until the admin ships
  reCAPTCHA Enterprise and a week passes, then `enforce`, with `consumeAppCheckToken` for `consume` callables), the
  access rule (`requireAccess`, `functions/src/api/access.ts`: `signedIn` = verified Google account; `admin` = also
  the claim and `admins/{uid}`), request validation (`apiError.invalidRequest` with the field issues), the pure handler
  `(deps, caller, data) => Promise<response>`, response validation (a mismatch is logged and answered
  `apiError.internal`). Handlers throw `ApiError(code, params?)` (`functions/src/api/api-error.ts`); `toHttpsError`
  turns it into `HttpsError(API_ERRORS[code].status, code, details)`.
- **Error codes** are i18n keys: `packages/shared/src/i18n/api/{ro,en}.ts` (the backend's own catalogue, kept out of the
  viewer bundle; the `i18n` gate checks it), mapped to their callable status, HTTP status and retryability by
  `API_ERRORS`. `details` = `{code, params?, issues?}` (`apiErrorDetailsSchema`); the admin shows
  `translateApiError(locale, code, params)` and reads a failure with `apiErrorFromFailure(error.code, error.details)`.
- **Upstream failures**: adapters throw `UpstreamError(service, failure)` (§4.1). A handler maps the failures it
  expects to its specific codes; anything it does not map falls back (`rateLimited` → `apiError.rateLimited`,
  `maintenance`/`unavailable` → `apiError.unavailable`, `conflict` → `apiError.conflict`, `notFound` →
  `apiError.notFound`, the rest → `apiError.internal`, logged).
- **Secrets** never appear in a response, a document, a log line or an error: the logger redacts secret-looking keys,
  `redactText` (`packages/shared/src/text/redact.ts`) strips tokens, keys, addresses and URL queries from free text.
- **Times** travel as ISO 8601 strings (`isoTimeSchema`), are stored as timestamps.

### 3.1 `admin.*` and `admins.*` (fn-admin; A01, A02, A20)

| Callable | Access | Request → response | Errors |
| --- | --- | --- | --- |
| `admin.session` | signedIn | `{}` → `{admin, role, claim, refreshToken, ownerClaimed, invitePending}` | |
| `admin.claim` | signedIn, consume | `{googleAccessToken}` → `{role:'owner', refreshToken:true}` | `claim.tokenInvalid`, `claim.tokenMismatch`, `claim.scopeMissing`, `claim.notOwner`, `claim.alreadyClaimed` |
| `admin.join` | signedIn, consume | `{}` → `{role, refreshToken:true}` | `invite.notFound`, `invite.expired` |
| `admins.invite` | admin | `{email}` → `{inviteId, expiresAt, signInUrl}` | `invite.alreadyAdmin` |
| `admins.revoke` | admin | `{kind:'admin', uid}` or `{kind:'invite', inviteId}` → `{revoked:true}` | `revoke.owner`, `revoke.self`, `notFound` |
| `admins.list` | admin | `{}` → `{admins[], invites[]}` | |

**Owner claim, no e-mail address anywhere** (`admin.claim`):

1. The admin app asks Google for `CLAIM_OAUTH_SCOPE` (`cloud-platform.read-only`, incremental consent) and sends the
   access token it got.
2. `iam.tokenInfo(token)`: an invalid or expired token → `apiError.claim.tokenInvalid`. Its `email` must equal the
   caller's verified ID-token address (case-insensitive) and its `audience` must be one of `config.oauthClientIds`,
   else `apiError.claim.tokenMismatch`; its scopes must include `CLAIM_OAUTH_SCOPE` or `cloud-platform`, else
   `apiError.claim.scopeMissing`.
3. `iam.testProjectPermissions(config.projectId, token, [OWNER_PERMISSION])` with **the caller's** token must grant
   `resourcemanager.projects.setIamPolicy`, else `apiError.claim.notOwner` with `{projectId}`.
4. A transaction creates `setup/owner` `{uid, claimedAt}`; when it exists for another uid →
   `apiError.claim.alreadyClaimed` (the same uid again is an idempotent success). It writes `admins/{uid}` (`role:
   owner`, the verified address and name from the ID token, the stamp).
5. `auth.setAdminClaim(uid, true)`; the response tells the app to refresh its ID token. The access token is used for
   these two calls only, never stored, never logged.

**Invitations**: `admins.invite` stores `invites/{inviteIdFor(email)}` (SHA-256 of the trimmed, lowercase address;
`role: 'admin'`, `invitedBy`, `createdAt`, `expiresAt` = now + `INVITE_TTL_DAYS`) and answers the admin's address; no
mail is sent in M2 (the inviter shares the link; an e-mail-link invitation is a later option). A re-invitation resets
the expiry; an address that already belongs to an admin → `apiError.invite.alreadyAdmin`. `admin.join` hashes the
caller's verified address, checks the invitation (missing → `invite.notFound`, expired → `invite.expired`), then in one
transaction creates `admins/{uid}` and deletes the invitation, then sets the claim. `admin.session` reports a pending
invitation, whether the map has an owner, and `refreshToken` when the document and the claim disagree.

**Revocation**: never the owner (`revoke.owner`), never oneself (`revoke.self`), so a map always keeps an admin. It
deletes `admins/{uid}`, removes the claim and revokes the refresh tokens; the access rule and the security rules deny
the next call at once because they also require the document (S-A20-BAD-ADMIN-REMOVED).

### 3.2 `history.*` (fn-admin; A23)

| Callable | Access | Request → response | Errors |
| --- | --- | --- | --- |
| `history.revert` | admin | `{cityId, entity, entityId, entryId}` → `{restoredFields}` | `history.notFound`, `history.nothingToRestore`, `history.invalidSnapshot` (`{count}`), `history.placeYear` |

Admins read history with the Firestore SDK (`FIRESTORE_PATHS.history(document)`, ordered by id). A revert restores
the client-editable fields (`CLIENT_WRITES[entity].update`) from `previous`, keeps the current value of every
server-owned field (a revert never resurrects a rotated token or a replaced image; a deleted document comes back with
its snapshot's), stamps the caller, and validates the result with the entity's schema first: a snapshot that today's
schema refuses is not written (`invalidSnapshot` with the number of issues), nor a place's version without a year over
a place that names one (`placeYear`, M2c §7.2). The entry of a create has nothing to
restore.

### 3.3 `setup.*` (fn-setup; A03–A07, A22)

| Callable | Access | Request → response | Errors |
| --- | --- | --- | --- |
| `setup.status` | admin | `{}` → `SetupStatusView` | |
| `setup.selfTest` | admin | `{}` → `{checks[], status}` | per check, in `checks[].detail` |
| `setup.recordCloud` | admin | `{billing?, provision?}` → `{status}` | |
| `setup.saveMapbox` | admin, consume | `{cityId, secretToken}` → `{mapbox, viewer:{tokenId, allowedUrls}, admin:{…}}` | `mapbox.publicToken`, `mapbox.tokenFormat`, `mapbox.tokenInvalid`, `mapbox.missingScopes` (`{scopes}`), `mapbox.mintRefused`, `mapbox.unavailable`, `secrets.unavailable` |
| `setup.saveUsgs` | admin, consume | `{username, applicationToken, expiresOn?}` → `{usgs}` | `usgs.credentials`, `usgs.maintenance`, `usgs.unavailable`, `rateLimited`, `secrets.unavailable` |
| `setup.rotatePublicToken` | admin, consume | `{cityId, audience}` → `{tokenId, retiresOldAt, manifestQueued}` | `mapbox.notConfigured`, `mapbox.mintRefused` |
| `setup.analyticsConfig` | admin | `{cityId}` → `{analytics, measurementId, firebase, manifestQueued}` | `analytics.noWebApp`, `analytics.notEnabled`, `cloud.permission` (`{role}`), `cloud.apiDisabled` (`{api}`) |

- **`setup.status`** reads `setup/status` leniently (the `SetupRecords` port: field by field, an unknown or malformed
  field falls back to its default and never leaves the function) and answers `setupStatusViewSchema`; `ready` is
  `setupReady(view)`: billing, provision, Mapbox and USGS `ok`.
- **`setup.saveMapbox`** (onboarding §2B, security review §1.3): `classifyMapboxToken` refuses a `pk.` or anything
  that is not an `sk.` before any call; `mapbox.retrieveToken` (must be `TokenValid`, `usage: 'sk'`; the `user` is the
  username, never typed); `mapbox.listTokens(user)` finds the token by id and `missingScopes(scopes)` must be empty
  (`MAPBOX_BOOTSTRAP_SCOPES`); then `mapbox-sk-bootstrap` goes to Secret Manager; the tiles token
  (`MAPBOX_TILES_SCOPES`) is minted once into `mapbox-sk-tiles` (kept while its id still exists); the viewer token
  (`MAPBOX_PUBLIC_SCOPES`, `allowedUrls` = `config.viewerOrigins`) and the admin token (`config.adminOrigins`) are
  updated in place when their ids still exist, else created; the viewer token goes to `cities/{city}.mapbox`, the admin
  token to `setup/status.mapbox`; `secretsRev` is bumped. A second save adds no token (S-A06-BAD-SAVED-TWICE). Mapbox
  refusing to create a token (a demo account, billing not confirmed) is `mapbox.mintRefused`.
- **`setup.saveUsgs`** (onboarding §2C): `usgs.login` → `usgs.permissions` → `usgs.logout` (always); both values go to
  Secret Manager; `usgs` becomes `ok` with the `download` role, else `pending` with `nextCheckAt` = now +
  `USGS_RECHECK_HOURS`; `expiresOn` becomes `tokenExpiresAt` (the card reminds `USGS_EXPIRY_REMINDER_DAYS` before).
- **`setup.selfTest`** runs `SELF_TEST_CHECKS` in order with the runtime service account, each isolated: a Firestore
  read, the Secret Manager reads, a write and delete in each bucket (`tmp/selftest`), a manifest rebuild enqueued for
  each city (harmless), Mapbox `retrieveToken` with the stored token, a USGS login and logout, Firebase Management
  `listWebApps`, Error Reporting `listGroups(24 h, 1)`; it updates the Mapbox, USGS and crash records.
- **`setup.recordCloud`**: the browser-side Google Cloud steps (PLAN Addendum 1: billing via `cloudbilling`, the $5
  budget via `billingbudgets`, Provision cloud with the admin's own token) report what they found; the server stamps the
  caller and stores it; `provision.state` is the worst item state (`invalid` > `unavailable` > `missing` > `pending` >
  `ok`).
- **`setup.rotatePublicToken`**: mints a new public token with the same origins, writes it (the city document for the
  viewer, which triggers a manifest rebuild), and queues the old id in `setup/status.mapbox.retiring` with `retireAt`
  = now + `TOKEN_RETIRE_MINUTES`; `ops.tick` deletes it then.
- **`setup.analyticsConfig`**: `firebase.listWebApps` (an `ACTIVE` app, else `analytics.noWebApp`) →
  `webAppConfig`; without `measurementId` → `analytics.notEnabled` (the card's deep link enables Google Analytics);
  writes `cities/{city}.analytics` `{measurementId, firebase: {apiKey, appId, projectId}}` (public identifiers, never
  committed: CR-9 of M1) and `setup/status.analytics`. The manifest builder adds `analytics.errorEndpoint` =
  `config.errorEndpoint` to every manifest, so crash reports work before analytics is set up.

### 3.4 `telemetry.*` (fn-admin; V20, A22, A24)

`telemetry.reportError` is the one public HTTPS function (`onRequest`, `maxInstances` 2), URL
`https://us-central1-<project>.cloudfunctions.net/telemetry-reportError` (`config.errorEndpoint`). In order:

1. `OPTIONS` from an allowed origin → 204 with `Access-Control-Allow-Origin: <origin>`, `-Methods: POST`,
   `-Headers: content-type`, `-Max-Age: 3600`; any method but `POST` → 405.
2. `Origin` must be one of `config.viewerOrigins` or `config.adminOrigins`, else 403 `apiError.telemetry.origin`
   (no CORS header); the origin decides the service (`viewer` or `admin`).
3. A body over `ERROR_REPORT_MAX_BYTES` (16 KiB) → 413 `apiError.telemetry.tooLarge`, before parsing.
4. Rate limits per instance (`ERROR_REPORT_LIMITS`: 10 per client per minute, 120 per instance; the client is a
   salted hash of the IP held in memory only) → 429 `apiError.rateLimited` with `Retry-After: 60`.
5. The body is JSON whether sent as `text/plain` (the engine, no preflight) or `application/json`; invalid JSON or
   anything `errorReportSchema` refuses → 400 `apiError.invalidRequest` with the issues.
6. `redactText` again on message, stack and page; one `ErrorReporter.report(event)`: a structured log entry, severity
   ERROR, `jsonPayload` = `reportedErrorEventSchema` (`@type` ReportedErrorEvent, `message` = the stack or the message,
   `serviceContext {service, version: release}`, `context.httpRequest.url` = the page, `context.reportLocation`
   always set so Error Reporting groups non-V8 stacks too, `hcm` = the rest). No Firestore write per report.
7. 204 with `Access-Control-Allow-Origin: <origin>`. Error responses carry the JSON `apiErrorDetails`.

| Callable | Access | Request → response | Errors |
| --- | --- | --- | --- |
| `telemetry.listGroups` | admin | `{hours: 24 \| 168 \| 720, pageSize, pageToken?}` → `{groups[], nextPageToken?}` | `errorReporting.unavailable`, `cloud.permission` (`roles/errorreporting.viewer`) |

### 3.5 `publish.*` (fn-content; A10, A19)

- **Triggers** `publish.on{City,Layer,Photo,Poi,PoiCategory}Write`: a write requests a build when `published`
  changes, or when the document is published (before or after) and a field the manifest carries changed (the builder's
  own field map, `functions/src/publish/`). A request is a transaction on `manifests/{city}` (`requestedVersion` + 1,
  `status: 'queued'`) plus `tasks.enqueue('publish-buildManifest', {cityId, requestedVersion, full: false}, {id:
  manifestTaskId(city, now), delaySeconds: MANIFEST_DEBOUNCE_SECONDS})`: writes within one minute share a build.
- **`publish.rebuildManifest`** (admin): `{cityId, full?}` → `{requestedVersion, queued}` (`queued: false` when this
  window's build was already queued).
- **`publish.buildManifest`** (task queue, `maxConcurrentDispatches: 1`, so builds never race): reads the city and
  every published layer, photo (only `processing: 'done'` with an `image`), POI and category; maps each to its manifest
  shape (`geometryFromDoc`, `{lat, lng}` → `[lng, lat]`, boxes to `[[w, s], [e, n]]`); a document that fails its
  manifest schema is skipped and listed in `manifests/{city}.skipped` (entity, id, first issue), never fails the build;
  the whole manifest passes `validateManifest`; uploads gzip to `STORAGE_PATHS.manifest` with `MANIFEST_CACHE_CONTROL`;
  records `builtVersion` (the version it started from), `builtAt`, `url`, `sha256`, `bytes`, `counts`. When
  `requestedVersion` moved on meanwhile, it queues the next build. M2 always builds in full (a city has about a hundred
  documents); the incremental build of security review §4.5 waits for a city past 500 documents.

### 3.6 `photos.*` (fn-content; A08–A10)

1. The admin creates `cities/{city}/photos/{photo}` (`processing: 'pending'`, `published: false`, the sticky author,
   source and licence, the last pin as `location`), then uploads the file to `STORAGE_PATHS.photoUpload(city, uid,
   photo, '<nonce>.<ext>')` with `customMetadata.originalName`.
2. **`photos.onUpload`** (Storage finalize on the private bucket, 2 GiB (1 GiB since 2026-11-12, `docs/research/M7-local-worker.md` §4.6), concurrency 1, `maxInstances` 5):
   `parsePhotoUploadPath` (anything else is ignored); the photo document must exist (else the upload is deleted);
   `images.inspect` sniffs the bytes: not an accepted type → `processing: 'failed'`, `processingError:
   apiError.photo.unsupportedType`; over `PHOTO_LIMITS.maxInputPixels` → `apiError.photo.tooLarge` (`{megapixels:
   '200'}`); unreadable → `apiError.photo.unreadable`; the SHA-256 of an existing photo's original →
   `apiError.photo.duplicate` with `duplicateOf`. Otherwise: the original is copied to `STORAGE_PATHS.photoOriginal`,
   the WebP derivatives (2048 px and 400 px, metadata stripped, EXIF orientation applied) are written create-only to the
   public bucket, and the document gets `image`, `exif` (plain values), `suggested` (EXIF GPS and direction; year and
   title from `originalName` with the migration's `yearIn`; an EXIF date later than the file-name year is ignored),
   `original`, `processing: 'done'`, stamped `system:photos`; the upload is deleted.
3. **Replacing the image** is a new upload into the same photo folder; the old derivatives are deleted by `ops.tick`
   once no manifest names them. **`photos.reprocess`** (admin) copies the original back into a new upload, which runs
   step 2 again.

### 3.7 `ops.*` (fn-content)

`ops.tick` (`OPS_TICK_SCHEDULE`, every 15 minutes; one Scheduler job) runs `OPS_STEPS` in order, each isolated (a
failure is recorded in `ops/guard.lastTick.steps` and the next step runs): `guard` (create `ops/guard` green when
missing), `jobs` and `mts` (M3; report ok), `manifests` (the nightly full rebuild after `NIGHTLY_HOUR_UTC`, once per
day; delete public objects no manifest names, older than `UNPUBLISH_DELETE_MINUTES`), `health` (daily: Mapbox
`retrieveToken` and a USGS login; a `pending` USGS role whose `nextCheckAt` passed is checked again and turns `ok` on
approval), `tokens` (delete `setup/status.mapbox.retiring` tokens past `retireAt`), `invites` (delete expired
invitations), `users` (delete Auth accounts without an `admins/{uid}` document created more than `STALE_USER_HOURS`
ago; never the owner); since M28 `sources` (place one city a tick in its country with one Nominatim reverse lookup, then refresh at most one `countrySources/{country}` list that is missing or a month old: the curated list or Wikidata's institutions, every website checked; `docs/research/M28-sources.md` §10). `ops.onBudget` (Pub/Sub topic `budget`) turns `ops/guard` red when the cost reaches the budget;
it never touches the public site; turning it green again is an admin action of M3 (nothing consumes the guard before
the raster pipeline).

## 4. Ports (`functions/src/ports/**`, done)

| Port | File | What | Adapter (owner) |
| --- | --- | --- | --- |
| `DocumentStore` | `documents.ts` | Firestore: `get`, `create`, `set`, `delete`, `query` (valid documents and the invalid ones apart), `transaction`; every read and write validated with a shared schema | `adapters/documents.ts` (fn-admin) |
| `AuthAdmin` | `auth-admin.ts` | `getUser`, `setAdminClaim`, `revokeSessions`, `deleteUser`, `listUsers` | `adapters/auth-admin.ts` (fn-admin) |
| `SecretStore` | `secret-store.ts` | M0: `read`, `write` (adds a version and destroys older ones), `invalidate`; 5-minute cache busted by `secretsRev` | `adapters/secret-manager.ts` (fn-setup) |
| `GoogleIam` | `google-iam.ts` | `tokenInfo(accessToken)`, `testProjectPermissions(projectId, accessToken, permissions)`, with the caller's token | `adapters/resource-manager.ts` (fn-setup) |
| `FirebaseManagement` | `firebase-management.ts` | `listWebApps`, `webAppConfig` | `adapters/firebase-management.ts` (fn-setup) |
| `ErrorReporter` | `error-reporter.ts` | `report(event)` (structured log), `listGroups(request)` (REST) | `adapters/error-reporting.ts` (fn-admin) |
| `TaskQueue` | `task-queue.ts` | `enqueue(queue, payload, {id, delaySeconds})` → false when the id exists | `adapters/cloud-tasks.ts` (fn-content) |
| `BlobStore` | `blob-store.ts` | `stat`, `read`, `write` (create-only with `ifGenerationMatch: 0`), `copy`, `delete`, `list` by bucket role | `adapters/storage.ts` (fn-content) |
| `ImageProcessor` | `image-processor.ts` | `inspect(bytes)` (magic bytes, size, EXIF), `webp(bytes, {longEdge, quality})` | `adapters/image.ts` (fn-content) |
| `MapboxApi` | `mapbox-api.ts` | `retrieveToken`, `listTokens`, `createToken`, `updateToken`, `deleteToken` | `adapters/mapbox.ts` (fn-setup) |
| `UsgsApi` | `usgs-api.ts` | `login`, `permissions`, `logout` | `adapters/usgs.ts` (fn-setup) |
| `Clock`, `TokenProvider`, `CloudRunJobs` | M0 files | unchanged (`CloudRunJobs` is M3) | M0 adapters |
| `AdminDirectory`, `SetupRecords` | M0 files | the existence check of `admins/{uid}` (the access rule) and the lenient read of `setup/status` | `adapters/firestore.ts` (M0; fn-admin keeps it) |

`Ports` (`ports/index.ts`) aggregates them with `log: Logger` and `config: RuntimeConfig`; a handler takes
`Pick<Ports, …>`. Google APIs are called over REST with `fetch` (no gRPC clients), with tokens from `TokenProvider`;
firebase-admin is used for Firestore, Auth and the task queue (REST underneath).

### 4.1 Upstream failures

`UpstreamError(service, failure, {status?, retryAfterSeconds?})` (`ports/errors.ts`, done) is what every adapter throws;
`InvalidDocumentError(path, issues)` is what `DocumentStore` throws for a document its schema refuses.

| Failure | Typical source | Handler maps it to |
| --- | --- | --- |
| `unauthorized` | 401; Mapbox `TokenInvalid`; USGS HTML 403 or `AUTH_INVALID`; tokeninfo 400 | `mapbox.tokenInvalid`, `usgs.credentials`, `claim.tokenInvalid` |
| `forbidden` | 403 with JSON (a missing role or scope; `SERVICE_DISABLED` sets `api`) | `cloud.permission`, `cloud.apiDisabled`, `mapbox.missingScopes`, `mapbox.mintRefused` |
| `notFound` / `conflict` | 404 / 409, `ifGenerationMatch` | `notFound` / `conflict`, or idempotent success |
| `rateLimited` | 429, USGS `RATE_LIMIT` | `rateLimited` |
| `maintenance` | USGS HTML 503 "Application Offline" | `usgs.maintenance` |
| `unavailable` | other 5xx, network, timeout | `mapbox.unavailable`, `usgs.unavailable`, `errorReporting.unavailable`, `unavailable` |
| `invalid` | 400 or 422 about our request, an unreadable answer | `mapbox.mintRefused`, `photo.unreadable`, `internal` |

### 4.2 Runtime configuration

`RuntimeConfig` (`ports/runtime-config.ts`) is built by `deps.ts` from the environment: `projectId` (`GCLOUD_PROJECT`),
`region` `us-central1`, `buckets` (`<project>.firebasestorage.app`, `<project>-public`), `viewerOrigins`
(`HCM_VIEWER_ORIGINS`, default `https://ventura8.github.io`), `adminOrigins` (`https://<project>.web.app`,
`https://<project>.firebaseapp.com`), `adminUrl`, `oauthClientIds` (`HCM_OAUTH_CLIENT_IDS`: the Google sign-in
provider's web client), `errorEndpoint`, `appCheck` (`HCM_APP_CHECK`). The emulator values live in the planned
`e2e/env` (no secret among them).

### 4.3 IAM this adds to security review §1.1

`fn-admin@`: `roles/firebase.viewer` (Firebase Management) and `roles/errorreporting.viewer` (`groupStats`). Resource
Manager needs no role: `admin.claim` uses the caller's own token. `ops.tick` needs `mapbox-sk-bootstrap` (token
retirement, the daily Mapbox check) and Firebase Auth (stale accounts), which `fn-events@` does not hold: the proposal
is to run `ops.tick` as `fn-admin@`, which holds both already, rather than widen `fn-events@`
(`DECISIONS-for-review.md` §19b). These join the `iam` item of the Provision cloud doctor (CR-M2-5).

## 5. Functions layout

```text
functions/src/
  index.ts             integrator: export * as admin, admins, history, telemetry, setup, publish, photos, ops
  global-options.ts    integrator: region, maxInstances, the runtime service account per family
  deps.ts              integrator: composition root (RuntimeConfig, adapters), created on first use
  api/                 contracts (done): defineCallable, requireAccess, ApiError, toHttpsError
  ports/               contracts (done): the port interfaces, UpstreamError, InvalidDocumentError
  admin/  history/  telemetry/       fn-admin: one file per function (trigger + pure handler), helpers next to them
  setup/                             fn-setup
  photos/  publish/  ops/            fn-content
  adapters/            each adapter's owner (§4)
```

A function file exports its trigger, built with `defineCallable` (callables) or the v2 `onRequest`,
`onDocumentWrittenWithAuthContext`, `onObjectFinalized`, `onTaskDispatched`, `onSchedule`, `onMessagePublished`, and
its pure handler; the folder's `index.ts` re-exports the triggers under their registry names (`export { claim } from
'./claim.js'` in `admin/index.ts`). Handlers never import `firebase-functions`. Every trigger takes `getDeps` from
`deps.ts` (integrator); until the integrator wires the new ports, a workstream builds its `Pick<Ports, …>` from fakes
in its tests. `functions/test/index.test.ts` (integrator) checks that the exports are exactly the registry's
`deployedName`s.

## 6. Scenario rows registered (planned)

New and refined rows in `e2e/scenarios.json` (the generated `docs/E2E_SCENARIOS.md` lists them all):

- **A01** owner claim: `S-A01-HAPPY` (the Resource Manager proof), `S-A01-BAD-NOT-OWNER`, `S-A01-BAD-FOREIGN-TOKEN`,
  `S-A01-BAD-ALREADY-CLAIMED`, plus the refined stranger, popup and claim-delay rows.
- **A02** invitations: `S-A02-HAPPY` (hash only, `admin.join`), `S-A02-BAD-EXPIRED-INVITE`, `S-A02-BAD-OTHER-ADDRESS`,
  `S-A02-BAD-NO-ADDRESS-STORED`; `S-A02-BAD-LAST-ADMIN` became "an admin cannot remove themselves".
- **A03–A07** setup: the status screen with six areas and the self-test (`S-A03-BAD-SELFTEST-FAILURE`,
  `S-A03-BAD-NOTHING-SECRET-LEAVES`); A04 is now "Google Cloud billing and provisioning" (`S-A04-HAPPY-PROVISION`,
  `S-A04-BAD-ORG-POLICY`); A05 detects the demo plan through a refused mint; A06 `S-A06-HAPPY-ROTATE`,
  `S-A06-BAD-SAVED-TWICE`; A07 `S-A07-BAD-TOKEN-EXPIRING`.
- **A20** session: `S-A20-BAD-UNVERIFIED-ACCOUNT`, `S-A20-BAD-NO-APP-CHECK`.
- **A22** analytics and crash setup: `S-A22-BAD-MISSING-ROLE`.
- **A23**, new, edit history and revert (the brief called it A22, which was taken): `S-A23-HAPPY`,
  `S-A23-BAD-INVALID-SNAPSHOT`, `S-A23-BAD-CREATION-ENTRY`, `S-A23-BAD-CLIENT-WRITE` (rules tier).
- **A24**, new, the crash reporting endpoint (the brief's A23): `S-A24-HAPPY`, `S-A24-BAD-FOREIGN-ORIGIN`,
  `S-A24-BAD-RATE-LIMITED`, `S-A24-BAD-TOO-LARGE`, `S-A24-BAD-INVALID-BODY`.

Rows on the `functions` tier are named by `functions/test/**`, the `rules` row by `firebase/rules-tests/**` (an `@S-…`
tag); `e2e-admin` rows wait for the admin UI and its emulator tier.

## 7. Fixtures and fakes (the fakes workstream)

`packages/test-support/src/api-fixtures/` holds JSON response bodies, one file per upstream call and outcome, shared by
the functions' adapter tests, the admin's e2e mock server (`e2e/mock-apis/`) and the Python pipeline later; every value
is a generated test value that names its scenario (no real token, key, address or id; values shaped like Google keys
or tokens are assembled at run time, as `e2e/fixtures/world.ts` does). At least:

- Mapbox Tokens API: `GET /tokens/v2` valid `sk` / valid `pk` / `TokenInvalid` (401); `GET /tokens/v2/{user}` with all
  bootstrap scopes and with some missing; `POST` created (public and secret), 403 (demo account), 422 (billing);
  `PATCH` updated; `DELETE` 204; 5xx.
- USGS M2M: `login-token` ok, JSON `AUTH_INVALID` (HTTP 500), HTML 403, HTML 503 "Application Offline",
  `RATE_LIMIT`; `permissions` with and without download; `logout`.
- Google: tokeninfo (the owner, another account, another client, missing scope, expired 400), Resource Manager
  `testIamPermissions` (granted, empty, 403), Firebase Management `webApps` (one active, none) and `config` (with and
  without `measurementId`, 403, `SERVICE_DISABLED`), Error Reporting `groupStats` (two groups, empty, 503), Cloud
  Billing `billingInfo` and `billingAccounts` (enabled, none), Budgets `create`.
- A fake `fetch` (route table → `Response`, recording each call) in `packages/test-support/src/fakes/`, so adapter tests
  need no msw; the e2e mock server serves the same fixtures over HTTP.

`functions/test/support/` holds the in-memory port fakes: a `DocumentStore` over a `Map` that validates like the
adapter, `AuthAdmin`, `SecretStore` (exists: `adapters/secret-store-memory.ts`), `TaskQueue`, `BlobStore`,
`ImageProcessor`, `GoogleIam`, `FirebaseManagement`, `ErrorReporter`, `MapboxApi`, `UsgsApi` (each scripted per test,
recording its calls), plus the existing clock, logger and caller helpers.

## 8. i18n

The backend's messages are `packages/shared/src/i18n/api/{ro,en}.ts` (47 codes, Romanian first, typed `ApiMessages`),
checked by the `i18n` gate, which now reads every folder directly inside a `packages/*/src/i18n/` folder too. They are
never part of the viewer bundle (the engine imports none of them; `@hcm/shared` has no side effects). The admin's own
UI texts belong to the admin workstream (its own catalogue, `packages/admin/src/i18n/`).

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract;
the integrator (or the owner) applies it. Ids are `CR-M2-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-M2-1 | contracts | rules (`firebase/firestore.rules`, `firebase/storage.rules`, rules tests) | Mirror `CLIENT_WRITES` and §2.3: CR-1 (photo `dateText`, `title.ro` required), CR-4 (POIs, POI categories, history read-only, layer `adjustments`/`year`/`date`, city `photosOverlay`), stamps on job creates and scene triage, server-owned `analytics`/`engine` on cities and the four new photo fields, admin read on `invites`, `manifests`, `setup/owner`; rules tests import `CLIENT_WRITES` so a schema change fails them | M1 CR-1 and CR-4, PLAN Addendum 3, "every document audited" | done (rules: `firebase/firestore.rules` mirrors `CLIENT_WRITES`; `firebase/rules-tests` imports it, the document schemas and the paths; follow-ups CR-M2-26 to CR-M2-28) |
| CR-M2-2 | contracts | integrator (`functions/src/index.ts`, `deps.ts`, `global-options.ts`, `functions/package.json`) | Export every registry function under its `deployedName` (`functions/test/index.test.ts` compares with `CALLABLES`, `HTTP_ENDPOINTS`, `BACKGROUND_FUNCTIONS`); build `RuntimeConfig` and the new ports in `deps.ts`; per-family runtime service accounts; add the npm dependencies the adapters need (`sharp` 0.35.5 for `adapters/image.ts`, already a root devDependency), each pinned and in `functions/dist/package.json` | the workstreams build feature folders against the registry; the composition root is shared | done (integrator: `functions/src/index.ts` exports the 32 registry functions, `functions/test/index.test.ts` compares them; `deps.ts` builds `RuntimeConfig` and every port but `jobs` (M3); `global-options.ts` `runAs`; `sharp` 0.35.5 in `functions/package.json` and `functions/dist/package.json`; Addendum A) |
| CR-M2-3 | contracts | integrator, ask first (`.dependency-cruiser.cjs`) | Layering rules for `functions/`: handlers and `api/` never import `firebase-admin` or `google-auth-library`; only `adapters/` do; feature folders import each other only through `ports/`, `api/` and `@hcm/shared` | keeps the handlers pure and the three workstreams independent | open (ask-first proposal, `DECISIONS-for-review.md` §19a; the integrated tree follows it: feature folders share helpers only through `functions/src/api/`) |
| CR-M2-4 | contracts | engine-core (`packages/engine/src/telemetry/errors.ts`, `telemetry-port.ts`) | Use `redactText` and the `ErrorReport` type of `@hcm/shared` instead of the engine's copies (same rules, plus `ya29.` access tokens) | one redaction rule and one report shape for the reporter and the endpoint | done (viewer workstream: `errors.ts` imports `redactText` of `@hcm/shared`; `ErrorReportPayload` and `ErrorSource` are `ErrorReport` and `ErrorReport['source']`) |
| CR-M2-5 | contracts | the provisioner (admin, Provision cloud `iam` item) and the bootstrap | The roles of §4.3 | Firebase Management, Error Reporting, stale-user cleanup and token retirement | done (M2b: the provisioner's `iam` item binds the role table, `packages/admin/src/provision/resources.ts`; the code side was done in M2) |
| CR-M2-6 | contracts | e2e-infra / admin (`e2e/**`) | The admin tier under the emulators (auth, firestore, storage, functions on `functions/dist`) with the mock Google, Mapbox and USGS APIs serving the §7 fixtures; `e2e/env` with the `HCM_*` values of §4.2 | the `e2e-admin` rows of §6 | done (M2b: the admin tier of `e2e/projects.ts`, the emulators of `e2e/admin/world.ts` and the owner's journey `e2e/admin/specs/journey.spec.ts`) |
| CR-M2-7 | contracts | pipeline (M3, `pipeline/src/hcm_pipeline`) | Job documents and log lines follow `jobDocSchema` / `jobLogDocSchema` (stamp `system:pipeline` required, `steps`, `lease`, `machine`, `attempt`) | the pipeline writes the same documents the functions and the admin read | open (M3) |
| CR-M2-8 | fn-admin | integrator (`functions/src/index.ts`, `deps.ts`, `global-options.ts`) | Wire the fn-admin families as exported objects: `export const admin = adminFunctions(getDeps)`, `admins = adminsFunctions(getDeps)`, `history = historyFunctions(getDeps)`, `telemetry = telemetryFunctions(getDeps)` (`functions/src/{admin,history,telemetry}/index.ts`; Firebase deploys an exported object's functions as `<export>-<key>`). `getDeps()` must return `Ports` (at least `log`, `clock`, `config`, `admins`, `documents` = `createDocumentStore(getFirestore(app))`, `auth` = `createAuthAdmin(getAuth(app))`, `errors` = `createErrorReporter({projectId, tokens, fetch, write})` with `write` of `firebase-functions/logger`, `iam` = fn-setup's `adapters/resource-manager.ts`). Service accounts: `fn-admin@` for `admin.*`, `admins.*`, `history.revert`, `telemetry.listGroups`; `fn-events@` for `history.on*Write` and `telemetry.reportError` (it only writes a log entry: no role) | §5 asks each function file to import `getDeps` from `deps.ts`, whose M0 `Deps` lacks the M2 ports, so a direct import breaks `tsc` for every workstream until CR-M2-2 lands; a family factory compiles today and changes only the export statement | done (integrator, Addendum A) |
| CR-M2-9 | fn-admin | contracts (§2.2, §3.2), admin, fakes (`functions/test/support/**`) | History lists newest first by `updatedAt desc`, not by id desc: the Firestore emulator refuses descending key scans (`FAILED_PRECONDITION: Firestore does not support descending key scans`), so `orderBy('__name__', 'desc')` can never be tested. The trigger's skip rule matches any listed `revert` entry with the same `updatedAt` (not only the newest), which also holds when triggers run out of order; trimming still keeps the newest `HISTORY_KEEP` by id. The admin's history panel orders by `updatedAt desc`; the in-memory `DocumentStore` fake supports `orderBy` on a timestamp field and on `__name__` ascending | found by `functions/test/adapters/documents.test.ts` on the emulator | done (fakes: `createFakeDocumentStore` orders by a timestamp field and refuses `__name__` descending; contract: Addendum A amends §3.2) |
| CR-M2-10 | fn-admin | integrator (`e2e/scenarios.json`, `docs/E2E_SCENARIOS.md`) | Flip to `exists` the rows the fn-admin tests name: `S-A01-BAD-FOREIGN-TOKEN`, `S-A01-BAD-ALREADY-CLAIMED`, `S-A02-BAD-EXPIRED-INVITE` (the `admin.join` half; the `ops.tick` deletion is fn-content's), `S-A02-BAD-NO-ADDRESS-STORED`, `S-A20-BAD-UNVERIFIED-ACCOUNT`, `S-A23-BAD-INVALID-SNAPSHOT`, `S-A23-BAD-CREATION-ENTRY`, `S-A24-HAPPY`, `S-A24-BAD-FOREIGN-ORIGIN`, `S-A24-BAD-RATE-LIMITED`, `S-A24-BAD-TOO-LARGE`, `S-A24-BAD-INVALID-BODY`; regenerate the doc. `S-A20-BAD-NO-APP-CHECK` stays planned: firebase-functions checks App Check on the HTTP path, which `.run()` skips (e2e-admin tier) | the `e2e-matrix` gate fails while a `planned` row is named by a test | done (integrator: the 12 rows `exists`, `docs/E2E_SCENARIOS.md` regenerated; `S-A02-BAD-EXPIRED-INVITE` also names `functions/test/ops/accounts.test.ts`) |
| CR-M2-11 | fn-admin | contracts (`functions/src/ports/errors.ts`, §4.1, §5) | (a) `UpstreamError` gains `api?: string` for `SERVICE_DISABLED` (§4.1 says it sets `api`, the class has no such field); until then `telemetry.listGroups` answers every `forbidden` with `cloud.permission` naming `roles/errorreporting.viewer`, a disabled API included. (b) §5 "exports its pure handler": the fn-admin handlers stay module-local unless a test imports them (`recordHistory`, `handleErrorReport`), because knip fails on unused exports; tests drive them through `.run()`. (c) `VerifiedCaller` has no display name: `admin.claim` and `admin.join` read it with `AuthAdmin.getUser` | the contract as written cannot be met as is | done (integrator: (a) `UpstreamError.api`, set by `GoogleApiError` and the Error Reporting adapter; `telemetry.listGroups` answers `cloud.apiDisabled {api}`; (b) and (c) accepted as written, Addendum A) |
| CR-M2-12 | fn-admin | integrator (`docs/*.md`, `.agent/**`, `.agents/skills/**`, `.claude/skills/**`) | Sync the docs: `functions_skill.md` (family factories, the real Firestore and Auth adapters on the emulators with a fresh named database per test, `functions/test/admin/world.ts`), `analytics_and_crash_skill.md` (the per-client key is the last `X-Forwarded-For` hop; at most 2 × 120 reports a minute project-wide; a stack frame is parsed before redaction; a preflight from a foreign origin is 405; refusals after the origin check carry `Access-Control-Allow-Origin`; Firefox and Safari stacks get the message in front), `rules_and_emulators_skill.md` (no descending key scans on the emulator), `docs/TESTING.md`, `docs/ARCHITECTURE.md`; `docs/LESSONS.md`: the emulator refuses `__name__ desc` (pinned by the documents adapter test), and `redactText` drops a frame's `:line:col` with the query of its URL (pinned by `functions/test/telemetry/error-event.test.ts`) | fn-admin owns no doc or agent asset | done (integrator: the skills, `docs/TESTING.md`, `docs/ARCHITECTURE.md`, `docs/LESSONS.md` #30 and #31) |
| CR-M2-13 | fn-setup | integrator (`functions/src/index.ts`, `deps.ts`, `global-options.ts`) | Wire `export const setup = defineSetupFunctions(getDeps)` (`functions/src/setup/index.ts`, deployed as `setup-<name>`) in place of the M0 `export * as setup from './triggers/setup.js'`. In `deps.ts`: `secrets` = `createSecretManagerStore({projectId, tokens, fetch, clock, log, ttlMs: 300_000, revision: secretsRevision(setupRecords)})` (`adapters/secret-manager.ts`, which replaces `createRestSecretStore`; the memory store stays for the emulator), `mapbox` = `createMapboxApi({fetch})`, `usgs` = `createUsgsApi({fetch, log})`, `firebase` = `createFirebaseManagement({tokens, fetch})`, `iam` = `createGoogleIam({fetch})` (`adapters/resource-manager.ts`, also used by `admin.claim`). Every `setup.*` runs as `fn-admin@`. Once `index.ts` and `deps.ts` stop importing them, fn-setup deletes the M0 leftovers: `functions/src/{triggers,handlers}/`, `functions/src/adapters/secret-store-rest.ts`, `functions/test/{triggers,handlers}/`, `functions/test/adapters/secret-store-rest.test.ts`. They stay for now because deleting them breaks `tsc` for every workstream | same reason as CR-M2-8: a family factory compiles against the M0 `Deps`, and only the export statement changes | done (integrator: `setup = defineSetupFunctions(getDeps)`, the adapters wired, every `setup.*` as `fn-admin@`; the M0 `triggers/`, `handlers/`, `secret-store-rest.ts` and their tests deleted) |
| CR-M2-14 | fn-setup | integrator (`deps.ts`) and e2e-infra (`e2e/env`, CR-M2-6) | In the Functions emulator (`FUNCTIONS_EMULATOR=true`) the REST adapters must never reach a real host. `deps.ts` should pass them a `fetch` that sends `api.mapbox.com`, `m2m.cr.usgs.gov`, `oauth2.googleapis.com` and `*.googleapis.com` to the mock APIs (a base URL such as `HCM_UPSTREAM_BASE` in `e2e/env`) and refuses every other host. The adapters take `fetch` injected and hard-code only the public base URLs | the `setup.*` callables call Mapbox, USGS and Google directly, and nothing in M2 may touch a real endpoint | done (integrator: `functions/src/adapters/emulator-fetch.ts`; the `e2e/env` values stay with CR-M2-6) |
| CR-M2-15 | fn-setup | contracts (`functions/src/ports/mapbox-api.ts`, `secret-store.ts`, `packages/shared/src/schemas/paths.ts`) | (a) Add `MapboxApi.listTilesets(user, token, limit)` → `{id, name?}[]`. It is already implemented and tested (`MapboxTilesetsApi` in `adapters/mapbox.ts`) against the fake's `/tilesets/v1`. The M3 publisher uses it to find Studio uploads; it is also onboarding §2B step B5.3. (b) Add `FIRESTORE_PATHS.cities` (`'cities'`): until then, `setup/self-test-checks.ts` queries the collection with a literal. (c) The `UpstreamError.api` of CR-M2-11 (a): fn-setup's `GoogleApiError` (`adapters/google-call.ts`) already carries it, and `setup/failures.ts` reads it with `'api' in error`, so `cloud.apiDisabled {api}` works today for Firebase Management, Secret Manager and Cloud Storage. (d) The comment on `SecretStore.write` should also say that older enabled versions are destroyed (security review §1.2) | the port and the path list are contracts-owned | done for (b) `FIRESTORE_PATHS.cities`, (c) `UpstreamError.api`, (d) the `SecretStore.write` comment; (a) `MapboxApi.listTilesets` joins the port with its first user, the M3 publisher (the adapter already has it) |
| CR-M2-16 | fn-setup | contracts (`packages/shared/src/i18n/api/{ro,en}.ts`, `api/errors.ts`) | Add the code `apiError.usgs.accessPending` (`failed-precondition`). RO: „USGS nu a aprobat încă accesul M2M pentru acest cont. Verificăm din nou la fiecare 6 ore.” EN: "USGS has not approved M2M access for this account yet. We check again every 6 hours." Then `usgsRecord` (`functions/src/setup/usgs-check.ts`) sets it as the `detail` of a `pending` USGS record: a login refused with `AUTH_UNAUTHORIZED` (the account has no M2M access), or a `permissions` list without `download`. Mapbox needs no new code: a demo account (403 on token creation) and unconfirmed billing (422) both answer `apiError.mapbox.mintRefused`, whose message already names the step | the missing MACHINE role should be an actionable reason on the record, like every other area's | done (integrator: `apiError.usgs.accessPending` (`failed-precondition`), set on every `pending` USGS record by `setup.*` and `ops.tick`) |
| CR-M2-17 | fn-setup | fakes (`packages/test-support/src/fakes/`, `api-fixtures/`) | (a) tokeninfo should also read the token from `Authorization: Bearer` on POST. That is google-auth-library's `getTokenInfo` shape, which `adapters/resource-manager.ts` uses so that the token never appears in a URL or a body. Today the fake reads only the query or the form body, so in the e2e tier every token would read as expired (`functions/test/adapters/resource-manager.test.ts` answers tokeninfo from its own route table meanwhile). (b) Add a USGS account without M2M access: `login-token` answering `AUTH_UNAUTHORIZED` (M2M itself spells it `AUTH_UNAUTHROIZED`; the adapter accepts both), e.g. `USGS_CREDENTIALS.noAccess` with a fixture `usgs/login-token.no-m2m-access.json`. (c) Secret Manager `versions.list` should honour `filter=state:ENABLED` (today it also lists `DISABLED` versions) | the e2e tier runs the same adapters against these fakes | done (fakes: tokeninfo also reads `Authorization: Bearer`; `USGS_CREDENTIALS.noAccess` with `usgs/login-token.no-m2m-access.json`, `AUTH_UNAUTHROIZED`, approved by `usgs.m2mApproved`; `versions.list` honours `filter=state:<STATE>` and lists destroyed versions otherwise, as Secret Manager does) |
| CR-M2-18 | fn-setup | fn-content (`functions/src/ops/**`) | (a) The `health` step should check USGS again when `state` is `pending` **or** `unavailable` and `nextCheckAt` has passed: `setup.saveUsgs` keeps credentials pasted during maintenance as `unavailable` with `nextCheckAt` = now + 6 h, and `setup.selfTest` sets `nextCheckAt` the same way. `checkUsgs` and `usgsRecord` (`functions/src/setup/usgs-check.ts`) do the check and build the record. Importing them crosses feature folders (CR-M2-3), so either accept that import or let fn-setup move them to a shared place. (b) The `tokens` step reads `setup/status.mapbox.{user, retiring[]}` and `mapbox-sk-bootstrap`; there are at most 10 retiring entries, because `setup.rotatePublicToken` refuses an 11th with `apiError.rateLimited`. (c) The `task-queue` check of `setup.selfTest` requests a rebuild the way the publish triggers do: on `manifests/{city}`, `requestedVersion` + 1 and `status: 'queued'` (`builtVersion` 0 for a new document, stamped with the caller), then `publish-buildManifest` with `manifestTaskId`. Please confirm the builder accepts that | these are shared records and protocols between `setup.*` and `ops.tick` | done by fn-content: (a) `ops/services.ts` checks USGS again at `nextCheckAt` while `pending` or `unavailable`, and a check that finds USGS unavailable sets `nextCheckAt` = now + 6 h; its own implementation, no import across feature folders; (b) as built (`retireTokens`); (c) confirmed: the builder starts from the larger of the document's and the task's `requestedVersion`, a new document with `builtVersion` 0 is fine |
| CR-M2-19 | fn-setup | integrator (`e2e/scenarios.json`, `docs/E2E_SCENARIOS.md`) | Flip to `exists` the two `functions`-tier rows the fn-setup tests name, then regenerate the doc: `S-A03-BAD-NOTHING-SECRET-LEAVES` (`functions/test/setup/status.test.ts`) and `S-A06-BAD-SAVED-TWICE` (`functions/test/setup/save-mapbox.test.ts`). The `e2e-admin` rows of A03–A07 and A22 stay `planned`; their backend half is covered by `functions/test/setup/*.test.ts` without tags | the `e2e-matrix` gate fails while a `planned` row is named by a test | done (integrator) |
| CR-M2-20 | fn-setup | integrator (`docs/*.md`, `.agent/**`, `.agents/skills/**`, `.claude/skills/**`) | Sync the docs. `functions_skill.md`: `defineSetupFunctions`; the setup tests run the real REST adapters over `createUpstreamFakes()` with a per-test `intercept` (`functions/test/setup/world.ts`); Secret Manager writes a version and destroys the older enabled ones, and its read cache is keyed by `secretsRev`. `pipeline/usgs_m2m_skill.md`: the adapter's failure table, including `AUTH_UNAUTHORIZED` → `forbidden` → `pending`; a paste during maintenance is kept as `unavailable`; logout always runs. `pipeline/mapbox_publishing_skill.md`: token notes `historic-city-map <project> <purpose> [city] (auto)` (purpose `viewer`, `admin` or `tiles`), found by id and then by note so a half-finished save never adds tokens; leftover tiles tokens are deleted; the retiring list. `web/admin_setup_assistant_skill.md`: a failed save records its reason on the card unless the card holds a working or pending configuration. `quality/ci_quality_gates_skill.md`: ESLint `complexity` counts optional chaining (`?.`); `sonarjs/super-linear-regex` flags a `Link`-header regex, so split the header instead. Also `docs/TESTING.md`, `docs/ARCHITECTURE.md`, and `docs/ADMIN_GUIDE.{ro,en}.md` (a USGS paste during maintenance is kept and checked later) | fn-setup owns no doc or agent asset | done (integrator: `functions_skill.md`, `usgs_m2m_skill.md`, `mapbox_publishing_skill.md`, `admin_setup_assistant_skill.md`, `ci_quality_gates_skill.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`, both admin guides) |
| CR-M2-21 | fakes | e2e-infra / admin (`e2e/support/network.ts`, `e2e/support/test.ts`; CR-M2-6) | The mock APIs already serve the fake upstreams (`createUpstreamExtension()` in `e2e/mock-apis/main.ts`, one world per `x-hcm-test`). The admin projects' browser network should forward `upstreamHosts()` of `@hcm/test-support/fakes` to them and add `authorization` to `FORWARDED_HEADERS` (the viewer projects keep today's allowlist, so a viewer that reached Google is still blocked), and an admin fixture should drive `/__upstream/scenario`, `/__upstream/fail` and `/__upstream/calls` with the test's id | the admin's browser calls Cloud Billing, Service Usage, IAM, Resource Manager and Firebase Management directly (PLAN Addendum 1) | done (M2b: `forwardUpstreams` of the admin projects, `e2e/support/network.ts`) |
| CR-M2-22 | fakes | integrator (`deps.ts`) and e2e-infra (`e2e/env`), with CR-M2-14 | The emulator `fetch` of CR-M2-14 rewrites `https://<host><path>` to `<HCM_UPSTREAM_BASE>/h/<host><path>` (the mock APIs on `127.0.0.1:4311` answer it; `startUpstreamServer({port})` of `@hcm/test-support/fakes/http` is the same fakes on a port of their own) and forwards the callable request's `x-hcm-test` header when there is one. Calls without it share the partition `''`: a test that changes upstream state through the control endpoints runs alone or relies on the scenario credentials, which need no state | the Functions emulator's adapters reach the same fakes as the browser, per test | partly done (integrator: the rewrite to `<HCM_UPSTREAM_BASE>/h/<host><path>`, loopback bases only, in `emulator-fetch.ts`); forwarding the callable request's `x-hcm-test` needs the request in scope of the adapters (an `AsyncLocalStorage` in `defineCallable`), open for M2b with CR-M2-6 |
| CR-M2-23 | fakes | contracts (`functions/src/ports/errors.ts`) | `UpstreamService` has no member for the image processor, whose `inspect` rejects with `UpstreamError` `invalid` (§3.6): add `'image'`. `createFakeImageProcessor` uses `'cloud-storage'` meanwhile | an unreadable photo is not a Cloud Storage failure | done (integrator: `UpstreamService` `'image'`, thrown by `adapters/image.ts` and the image fake) |
| CR-M2-24 | fakes | integrator (`.agent/**`, `.agents/skills/**`, `.claude/skills/**`, `docs/research/M0-handoff.md`) | Sync the agent assets with the fakes (`docs/TESTING.md` → *Fake upstreams* is done): `testing_strategy_skill.md` *Seams and fakes* (fixtures `@hcm/test-support/api-fixtures`, `createFakeFetch`/`routeTable`, `createUpstreamFakes` with `scenario`/`fail`, the HTTP server and its partitions, the port fakes of `functions/test/support/`, the credential constants `GOOGLE_TOKENS`, `MAPBOX_TOKENS`, `USGS_CREDENTIALS`), `e2e_scenario_matrix_skill.md` (the mock APIs' `MockExtension` and `/__upstream/…`), `functions_skill.md` *Tests*, an M0-handoff entry. Lessons: a fixture `call` that does not start with its method was caught by the catalogue test; prettier's line breaks pushed fakes past `max-lines-per-function`, so a service's routes are built by helper functions | the fakes workstream owns no agent asset | done (integrator: `testing_strategy_skill.md`, `e2e_scenario_matrix_skill.md`, `functions_skill.md`; the entry in `M0-handoff.md` §10p) |
| CR-M2-25 | fakes | fn-content (`functions/test/ops/fakes.ts`, `functions/test/publish/fakes.ts`) | Optional: the shared fakes now exist (`createFakeAuthAdmin`, `createFakeMapboxApi`, `createFakeUsgsApi`, `createFakeBlobStore`, `createFakeTaskQueue`, `createFakeDocumentStore` in `functions/test/support/`); the local copies can go | one fake per port keeps the scenario credentials the same in every tier | declined for M2 by fn-content: its local fakes also carry the movable clock, `contentDeps`, `adminCall` and the `put`/`object`/`paths` helpers 250 tests use; switching to the shared fakes is a mechanical follow-up |
| CR-M2-26 | rules | integrator (`e2e/scenarios.json`, `docs/E2E_SCENARIOS.md`) | Flip `S-A23-BAD-CLIENT-WRITE` (tier `rules`) to `exists`: `firebase/rules-tests/test/history.test.ts` names it for each of the five audited entities. Regenerate the doc | the `e2e-matrix` gate fails while a `planned` row is named by a test | done (integrator) |
| CR-M2-27 | rules | integrator (`docs/*.md`, `.agent/**`, `.agents/skills/**`, `.claude/skills/**`) | Sync the docs with the M2 rules. `rules_and_emulators_skill.md`: the personas (`anonymous`, `stranger`, `invited`, `unverified`, `otherProvider`, `revoked` = claim without document, `pending` = document without claim, `admin`); the test files (`matrix.test.ts`: every persona × collection × get, list, create, update, delete; `client-writes.test.ts`: each `CLIENT_WRITES` field allowed, each other schema field refused, read back through zod; `documents.test.ts`: the fixtures are complete, schema-valid documents; `limits.test.ts`; `indexes.test.ts`); one cached context per persona (a context per request made the suite 3× slower); **the 1000-expression limit**: a request evaluating more is denied, every reference to a function argument evaluates the argument again (about ten per check), so a text is one bounded pattern (`[\s\S]{1,200}`, chained blocks above 1000), an optional field is checked with its neutral default (`data.get('bearing', 0)`), and the heaviest legitimate write (a photo with every field and five links, every editable field of a city at once) uses about 650 of 1000; the whole document is validated on every write, the photo location against the city only on create and when it changes, the publish gate only when `published` or `license` changes; `gcps` is gone until M3. Storage: a photo upload needs the photo document (`firestore.exists`, the second cross-service call of the request), a name of `UPLOAD_FILE_PATTERN`, 1 byte to 60 MiB, `originalName` up to 255 characters; raster upload ids follow `ID_PATTERN`. `docs/LESSONS.md`: the expression limit (found by `photos.test.ts`: every full photo create was denied, the emulator's `firestore-debug.log` names it) and the argument re-evaluation. `docs/TESTING.md` (rules tier: about 715 tests, 30 s), `docs/ARCHITECTURE.md` (rules summary, indexes) | the rules workstream owns no doc or agent asset | done (integrator: `rules_and_emulators_skill.md`, `docs/TESTING.md`, `docs/ARCHITECTURE.md`, `docs/LESSONS.md` #29) |
| CR-M2-28 | rules | contracts (§2.3, §2.4) and the admin | Write into the contract what the rules enforce beyond `CLIENT_WRITES`, so the admin never meets a surprise denial: (a) an optional text that is blank but not empty passes the rules and is refused by the server's zod read, so the admin validates with the shared schemas before every write; required titles (`title.ro`, `name.ro`, `label.ro`) are refused blank by the rules too; (b) photo, POI, POI category and job ids follow `ID_PATTERN`, and no category is called `photos` (`PHOTOS_OVERLAY_ID`); (c) a photo's location lies within the city bounds ± 0.5° on create and whenever it changes; (d) publishing (or changing the licence of) a photo needs `processing: 'done'`, an `image` and a licence other than `unknown`; unpublishing is always allowed; (e) a job can be cancelled only while it is not `succeeded`, `failed` or `cancelled`; (f) a scene's `status` may be set to `candidate`, `ordered` or `rejected` only, its `note` changed whatever the status; (g) the admin's queries have these composite indexes (`firebase/firestore.indexes.json`): photos by `published`, `processing`, `license` or `rightsReview` then `updatedAt desc`; POIs by `category` or `published` then `updatedAt desc`; layers by `published` then `order`; jobs by `status` then `createdAt` (both directions); history by `action` then `updatedAt desc`. Ordering a single collection by one field needs no entry (and a history is listed by `updatedAt desc`, CR-M2-9) | the admin is built against the contract, not the rules file | done (integrator: Addendum A, written into the contract) |
| CR-M2-29 | fn-content | integrator (`functions/src/index.ts`, `deps.ts`, `global-options.ts`, `functions/package.json`) | Wire `export const photos = photosFunctions(getDeps)`, `publish = publishFunctions(getDeps)`, `ops = opsFunctions(getDeps)` (`functions/src/{photos,publish,ops}/index.ts`, deployed as `<group>-<key>`), as CR-M2-8 and CR-M2-13. `getDeps()` must cover their `PhotosDeps`, `PublishDeps` and `OpsDeps`: `blobs` = `createStorageBlobStore(getStorage(app), config.buckets)`, `tasks` = `createCloudTaskQueue(getFunctions(app), config.region)`, `images` = `createSharpImageProcessor()`, plus `log`, `clock`, `config`, `documents`, `admins`, `auth`, `secrets`, `mapbox`, `usgs`. `functions/package.json`: `"sharp": "0.35.5"` (external, so it lands in `functions/dist/package.json`; Cloud Build installs the Linux x64 prebuilt). `photos.onUpload` resolves its bucket when `index.ts` loads (`FIREBASE_CONFIG.storageBucket`, or pass `config.buckets.private` as `photosFunctions(getDeps, bucket)`'s second argument): `functions/test/index.test.ts` must stub `FIREBASE_CONFIG` or pass the bucket. Service accounts: `fn-events@` for `photos.onUpload`, `publish.on*Write` and `publish.buildManifest`; `fn-admin@` for `ops.tick` (§19b), `ops.onBudget`, `photos.reprocess` and `publish.rebuildManifest` | same reason as CR-M2-8: family factories compile against the M0 `Deps`; the adapters and `sharp` are fn-content's, the composition root is not | done (integrator, Addendum A; `photos.onUpload` gets `privateBucket(env)`, the bucket the Storage adapter writes) |
| CR-M2-30 | fn-content | contracts (`packages/shared/src/i18n/api/{ro,en}.ts`, `packages/shared/src/api/errors.ts`) | Add `apiError.photo.heicUnsupported` (`invalid-argument`). RO: „Fotografiile HEIC (iPhone) nu pot fi convertite încă pe server. Exportă fotografia ca JPEG (pe iPhone: Setări → Cameră → Formate → Cel mai compatibil) și încarc-o din nou.” EN: "HEIC photos (iPhone) cannot be converted on the server yet. Export the photo as JPEG (on an iPhone: Settings → Camera → Formats → Most Compatible) and upload it again." Drop HEIC from `apiError.photo.unsupportedType` ("Only JPEG, PNG, WebP or TIFF photos are accepted."). Then `HEIC_ERROR` in `functions/src/photos/upload.ts` becomes the new code (one line) and its test expectation follows | sharp's prebuilt libvips reads AVIF only (`sharp.format.heif.input.fileSuffix` is `['.avif']`), so HEIC cannot be converted on the server as security review §1.7 assumed; testability review asks for an actionable message (S-A08-BAD-UNSUPPORTED-TYPE). Decision: `DECISIONS-for-review.md` §20b | done (integrator: `apiError.photo.heicUnsupported`; `unsupportedType` no longer names HEIC; `HEIC_ERROR` uses it) |
| CR-M2-31 | fn-content | contracts (`functions/src/ports/image-processor.ts`, `errors.ts`, `packages/shared/src/schemas/paths.ts`, `functions/src/api/`) | (a) `ImageProcessor.inspect`'s comment: the adapter reports the size of an image over the pixel limit (header only, never decoded) instead of rejecting, so `photos.onUpload` answers `photo.tooLarge`; `webp` enforces `limitInputPixels`. (b) `UpstreamService` `'image'` (= CR-M2-23): `adapters/image.ts` throws `cloud-storage` `invalid` meanwhile. (c) `FIRESTORE_PATHS.cities` (= CR-M2-15 b): `ops/manifests.ts` uses the literal. (d) The derivative metadata key `writtenAt` as a shared constant beside `STORAGE_PATHS`: `photos/upload.ts` writes it on every public derivative, `ops/manifests.ts` reads it; each keeps a copy. (e) `compact` and `omit` in `functions/src/api/` (or `@hcm/shared`): `photos/objects.ts` and `ops/objects.ts` are copies because feature folders may not import each other (CR-M2-3). (f) The secondary port types fn-content first imported are now exported: `BucketRole`, `BlobMetadata`, `WriteOptions` (`blob-store.ts`), `ExifSummary`, `ImageInspection` (`image-processor.ts`), `StoredDocument`, `InvalidDocument`, `QueryResult` (`documents.ts`), `AuthUser` (`auth-admin.ts`) | contract text and shared names | done (integrator: (a) the port comment, (b) = CR-M2-23, (c) = CR-M2-15 (b), (d) `DERIVATIVE_WRITTEN_AT` in `@hcm/shared`, (e) `compact` and `omit` in `functions/src/api/objects.ts`, (f) done) |
| CR-M2-32 | fn-content | contracts (§3.5–§3.7), review (`DECISIONS-for-review.md` §20a) | Record what fn-content built where the text was silent or differs: (a) an unpublished photo keeps its public derivatives; the sweep deletes only files no photo document and no served manifest names (replaced images, deleted photos), at least `UNPUBLISH_DELETE_MINUTES` after they were written and after the last build (§20a); (b) the sweep runs with the nightly rebuild, once a day, not on every tick (it reads every photo document of the city); (c) a layer is listed when `published` and `status: 'ready'`; a photo when `published`, `processing: 'done'` and with an `image`; every POI category; a POI's `photoIds` keep only listed photos; (d) city defaults: center = middle of the bounds, zoom 13 within min 10 and max 20 unless set, basemap `mapbox://styles/mapbox/standard`; English falls back to Romanian where the manifest needs both; (e) `manifests/{city}`: `error` is `apiError.mapbox.notConfigured` (no public token) or `apiError.invalidRequest` (another city issue, its paths logged), a failed build keeps the last good `url`, `sha256`, `bytes`, `counts`, `builtAt` and `builtVersion`; `sha256` is the manifest JSON's, `bytes` the stored gzip size; an unpublished or deleted city has its manifest deleted (`status: 'idle'`); (f) a manifest above `MANIFEST_SPLIT_BYTES` is still published, with a warning log (the split waits for the engine); (g) a document refused for its own fields is dropped first, the rules across documents run on the next pass (zod skips an object's refinements while a field is invalid) | the contract should say what the code does | done (integrator: Addendum A, written into the contract) |
| CR-M2-33 | fn-content | integrator (`e2e/scenarios.json`, `docs/E2E_SCENARIOS.md`) | Register `functions`-tier rows (area `admin`) for the fn-content behaviours with status `exists`, then fn-content tags these tests (the gate refuses tags on unknown or `planned` rows, so rows and tags land together): A08 `S-A08-HAPPY-PROCESSED` (`photos/upload.test.ts` `happyPath_theUploadBecomesOriginalDerivativesAndSuggestions`), `S-A08-BAD-NOT-A-PHOTO` (SVG, PDF), `S-A08-BAD-HEIC`, `S-A08-BAD-PIXEL-LIMIT`, `S-A08-BAD-DUPLICATE-HASH`, `S-A08-BAD-STORAGE-DOWN` (`photos/upload.test.ts`, `photos/reprocess.test.ts`); A10 `S-A10-HAPPY-MANIFEST-BUILT`, `S-A10-BAD-DOCUMENT-SKIPPED`, `S-A10-BAD-NO-PUBLIC-TOKEN`, `S-A10-BAD-WRITE-DURING-BUILD` (`publish/build-manifest.test.ts`), `S-A10-BAD-NOTHING-TO-PUBLISH` (`publish/fields.test.ts`, `publish/on-write.test.ts`); A03 `S-A03-BAD-USGS-STILL-PENDING` (`ops/services.test.ts`); A06 the functions half of `S-A06-HAPPY-ROTATE` (`ops/services.test.ts` `retireTokens`); A20 `S-A20-BAD-STALE-ACCOUNT` (`ops/accounts.test.ts`) | a happy and a bad row per behaviour, named by its tests | done (integrator: 14 `functions` rows `exists`, their tests tagged; `S-A06-HAPPY-ROTATE`'s functions half is `S-A06-HAPPY-OLD-TOKEN-RETIRED`) |
| CR-M2-34 | fn-content | integrator (`scripts/ci/run-emulated-tests.sh`; ask first if it goes into `vitest.config.ts`) | Run the emulated tests with `METADATA_SERVER_DETECTION=none`: firebase-admin's Firestore client probes the GCE metadata server (`MetadataLookupWarning: ... ETIMEDOUT, ENOTFOUND`), a network call the tests must not make, and on a busy machine it pushes the M0 `functions/test/adapters/firestore.test.ts` and `functions/test/triggers/setup.test.ts` past their 10-second hook timeout (seen here). `functions/test/publish/on-write.test.ts` stubs it for itself | no network in tests; flaky timeouts | done (integrator: `export METADATA_SERVER_DETECTION=none` in `scripts/ci/run-emulated-tests.sh`) |
| CR-M2-35 | fn-content | integrator (`docs/*.md`, `.agent/**`, `.agents/skills/**`, `.claude/skills/**`), rules (`firebase/storage.rules` comment) | Sync the docs with fn-content: `functions_skill.md` (the photos, publish and ops factories; CR-M2-32's build behaviour; the sharp adapter: magic bytes first, header-only inspection, HEIC refused); `testing_strategy_skill.md` (in-memory documents, blobs and tasks; real sharp on generated images with hand-made PNG headers for the pixel limit and broken pixels; the Storage adapter on the emulator; `.run()` with emulator snapshots; `METADATA_SERVER_DETECTION=none`); `web_security_skill.md` and the `storage.rules` comment ("HEIC is converted server-side" → refused with a message, CR-M2-30); `docs/LESSONS.md`: the Storage emulator ignores `ifGenerationMatch` (the conflict mapping is unit-tested), zod skips refinements while a field is invalid, an LCG modulo 64 compresses well (incompressible test data comes from hash output) | the Markdown update rule | done (integrator: the skills, `docs/LESSONS.md` #32, the `firebase/storage.rules` comment) |
| CR-M2-36 | viewer | integrator or the site build's owner (`scripts/site/src/csp.ts`, its tests) | Drop `firebaselogging.googleapis.com` and `firebaselogging-pa.googleapis.com` from the city page's CSP (and the e2e mock hosts if nothing else uses them) | the public viewer no longer loads Performance Monitoring (`docs/research/DECISIONS-for-review.md` §18a, applied): a host no code needs should not be allowed | done (integrator: `scripts/site/src/csp.ts` without the `firebaselogging` hosts, pinned by `scripts/site/test/csp.test.ts`; the e2e mock hosts stay, so `S-V19-BAD-HASH-NEVER-SENT` still sees a request there) |
| CR-M2-37 | viewer | the provisioner (admin, the Analytics and crash reporting card) | When the GA4 web stream is created or detected, set `enhancedMeasurementSettings.pageChangesEnabled` to false (Analytics Admin API, REST behind a port) and show it as checked | gtag.js's history-change page views would send `location.href` with the hash, which the viewer rewrites on every move with `history.replaceState`; the viewer itself sets `page_location` without the hash and turns the automatic page view off | done (M2b: `SetupCloud.disablePageChanges` turns `pageChangesEnabled` off and reads it back; the analytics card shows it, `S-A22-HAPPY-STREAM-SETTING`) |
| CR-M2-38 | viewer | integrator (`docs/*.md`, `.agent/**`, `.agents/skills/**`, `.claude/skills/**`, `e2e/scenarios.json`, `docs/E2E_SCENARIOS.md`) | Review only: the viewer workstream synced its own facts in place (`docs/ARCHITECTURE.md`, `docs/ENGINE_API.md`, `docs/TESTING.md`, both admin guides, `docs/LESSONS.md` #23–#28, the analytics, viewer, UI, security and e2e skills, the catalogue, the `firebase` digest and its mirror) and registered its 11 rows | the brief asked for the rows and the lessons; the other docs describe only the viewer's changes | done (integrator: reviewed; kept as written, plus the USGS and HEIC lines of the admin guides) |
| CR-M2-39 | integrator | e2e-infra / admin (`e2e/env`, CR-M2-6) | The emulator values of `RuntimeConfig`: `adminOrigins` and `adminUrl` follow the project (`https://demo-hcm.web.app`), and `errorEndpoint` is the production URL shape (the manifest schema wants `https`). The admin's e2e tier needs either `HCM_ADMIN_ORIGINS` and `HCM_ERROR_ENDPOINT` overrides in `deps.ts` (a contract change of §4.2) or a Hosting emulator origin it can accept as is | `telemetry.reportError` checks the `Origin` against these lists, and `admins.invite` answers `adminUrl` | partly done (M2b: `HCM_ADMIN_ORIGINS` is set in the emulator's environment; reading it is CR-M2b-4, which must keep the minted admin token's https origins) |
| CR-M2-40 | integrator | admin (`packages/admin/src/`) | Show the codes added during the integration: `apiError.usgs.accessPending` as the reason of a `pending` USGS card, `apiError.photo.heicUnsupported` on a refused HEIC photo, `apiError.cloud.apiDisabled` (`{api}`) from `telemetry.listGroups` with the deep link that enables the API | the backend answers them since Addendum A | done (M2b: setup-ui shows every code, `packages/admin/src/setup/messages.ts`) |

## Addendum A: integration (2026-10-12)

Added by the M2 integrator, alone in the tree after the parallel workstreams (rules, fn-admin, fn-setup, fn-content,
fakes, viewer). Everything below exists and is tested; the change-request table above says what each request became.

### A.1 Wiring

- `functions/src/index.ts` exports eight groups, one per registry namespace, each from its folder's factory:
  `admin`, `admins`, `history`, `telemetry`, `setup`, `publish`, `photos` (`photosFunctions(getDeps,
  privateBucket(process.env))`) and `ops`: the 32 functions of `CALLABLES`, `HTTP_ENDPOINTS` and
  `BACKGROUND_FUNCTIONS`, deployed as `<group>-<name>`. `functions/test/index.test.ts` fails unless the exports are
  exactly the registry, each in `us-central1`, with its registry cap (callables, the crash endpoint) or at most 5, and
  with its service account.
- `functions/src/global-options.ts`: `setGlobalOptions({region: 'us-central1', maxInstances: 5, concurrency: 80,
  serviceAccount: 'fn-events@'})`, and `RUNTIME_ACCOUNTS`, the account of every registry name, applied by
  `runAs(name)` in each trigger's options (`callableOptions` for callables): `fn-admin@` for the 17 callables and
  `ops.*` (§19b option 1), `fn-events@` for the ten Firestore triggers, `photos.onUpload`, `publish.buildManifest` and
  `telemetry.reportError`. `fn-admin@` is firebase-tools' shorthand for `fn-admin@<project>.iam.gserviceaccount.com`.
- `functions/src/deps.ts`: `Deps` = `Omit<Ports, 'jobs'>` (M3 adds `CloudRunJobs`). `runtimeConfig(env)` follows §4.2,
  with one refinement: `buckets.private` is the `storageBucket` of `FIREBASE_CONFIG` when it names one (the project's
  default bucket, which the Storage rules and the admin's uploads use), else `<project>.firebasestorage.app`. In the
  Functions emulator (`FUNCTIONS_EMULATOR=true`) secrets stay in memory, the REST adapters get
  `createEmulatorFetch(HCM_UPSTREAM_BASE)` (CR-M2-14, CR-M2-22: `https://` calls to `api.mapbox.com`,
  `m2m.cr.usgs.gov` and `*.googleapis.com` go to `<base>/h/<host><path>`, a loopback base only; anything else fails like
  a network error) and a placeholder token instead of Application Default Credentials.
- `functions/build.mjs` bundles everything but the functions' own npm dependencies (`firebase-admin`,
  `firebase-functions`, `google-auth-library`, `sharp`), fails on a bare import that is neither a Node built-in nor
  pinned, and loads the bundle to check every export's deploy manifest. The earlier configuration left `zod` external,
  so the artifact would have crashed at its first cold start (`docs/LESSONS.md` #34). The Functions emulator loads all
  32 functions from `functions/dist/` (`firebase.json` gained the Pub/Sub and Cloud Tasks emulators).
- `firebase.json`: Hosting site `bucurestiul-disparut` with the security review's headers (frames only for the two auth
  domains, Google sign-in and reCAPTCHA); `.firebaserc`: `default: bucurestiul-disparut`, `e2e: demo-hcm`.

### A.2 Contract amendments

- **§3.2 History** (CR-M2-9): a history is listed newest first by `updatedAt` descending, never by id (the Firestore
  emulator refuses descending key scans); the trigger skips a change when any listed `revert` entry has the same
  `updatedAt`; trimming keeps the newest `HISTORY_KEEP` by id.
- **§3.1, §3.2 handlers** (CR-M2-11 b, c): a function file exports its pure handler only when a test imports it (knip
  fails on unused exports); tests drive the rest through `.run()`. `VerifiedCaller` carries no display name:
  `admin.claim` and `admin.join` read it with `AuthAdmin.getUser`.
- **§3.3 USGS** (CR-M2-16): a `pending` USGS record (a `permissions` list without `download`, or a login refused with
  `AUTH_UNAUTHORIZED`) carries `detail: apiError.usgs.accessPending` and `nextCheckAt` = now + `USGS_RECHECK_HOURS`,
  written the same way by `setup.saveUsgs`, `setup.selfTest` and `ops.tick`.
- **§3.6 Photos** (CR-M2-30): HEIC and HEIF fail with `apiError.photo.heicUnsupported` (`invalid-argument`; the
  message says how to export a JPEG); `apiError.photo.unsupportedType` names JPEG, PNG, WebP and TIFF only.
  `ImageProcessor.inspect` reads the header only: an image over the pixel limit is reported with its size (the handler
  answers `photo.tooLarge`), HEIC with its type and no size.
- **§4.1 Upstream failures** (CR-M2-11 a, CR-M2-23): `UpstreamError` carries `api` (the Google API a
  `SERVICE_DISABLED` refusal names) and the service `'image'` (bytes sharp cannot read). `telemetry.listGroups`
  answers a disabled Error Reporting API with `apiError.cloud.apiDisabled {api}`.
- **§2.4 Paths and shared names** (CR-M2-15 b, CR-M2-31 d, e): `FIRESTORE_PATHS.cities` (`'cities'`);
  `DERIVATIVE_WRITTEN_AT` (`'writtenAt'`, the custom metadata of every public derivative); `compact` and `omit` in
  `functions/src/api/objects.ts`.
- **§8 i18n**: the API catalogue has 49 codes.
- **What the rules enforce beyond `CLIENT_WRITES`** (CR-M2-28), so the admin never meets a surprise denial: (a) an
  optional text that is blank but not empty passes the rules and is refused by the server's zod read, so the admin
  validates with the shared schemas before every write; required titles (`title.ro`, `name.ro`, `label.ro`) are refused
  blank; (b) photo, POI, POI category and job ids follow `ID_PATTERN`, and no category is called `photos`; (c) a photo's
  location lies within the city bounds ± 0.5° on create and whenever it changes; (d) publishing (or changing the licence
  of) a photo needs `processing: 'done'`, an `image` and a licence other than `unknown`; unpublishing is always allowed;
  (e) a job can be cancelled only while it is not `succeeded`, `failed` or `cancelled`; (f) a scene's `status` may be
  set to `candidate`, `ordered` or `rejected` only, its `note` changed whatever the status; (g) the admin's queries
  have the composite indexes of `firebase/firestore.indexes.json` (photos by `published`, `processing`, `license` or
  `rightsReview` then `updatedAt desc`; POIs by `category` or `published` then `updatedAt desc`; layers by `published`
  then `order`; jobs by `status` then `createdAt`, both directions; history by `action` then `updatedAt desc`).
- **The manifest build as built** (CR-M2-32): (a) an unpublished photo keeps its public derivatives; the sweep deletes
  only files no photo document and no served manifest names, at least `UNPUBLISH_DELETE_MINUTES` after they were
  written and after the last build (`DECISIONS-for-review.md` §20a); (b) the sweep runs with the nightly rebuild, once
  a day; (c) a layer is listed when `published` and `status: 'ready'`, a photo when `published`, `processing: 'done'`
  and with an `image`, every POI category, and a POI's `photoIds` keep only listed photos; (d) city defaults: centre =
  middle of the bounds, zoom 13 within 10 and 20 unless set, basemap `mapbox://styles/mapbox/standard`, English falls
  back to Romanian where the manifest needs both; (e) `manifests/{city}.error` is `apiError.mapbox.notConfigured` (no
  public token) or `apiError.invalidRequest` (another city issue), a failed build keeps the last good `url`, `sha256`,
  `bytes`, `counts`, `builtAt` and `builtVersion`; `sha256` is the manifest JSON's, `bytes` the stored gzip size; an
  unpublished or deleted city has its manifest deleted (`status: 'idle'`); (f) a manifest above `MANIFEST_SPLIT_BYTES`
  is still published, with a warning log; (g) a document refused for its own fields is dropped first, the rules across
  documents run on the next pass (zod skips an object's refinements while a field is invalid).

### A.3 Scenarios

The 15 rows CR-M2-10, CR-M2-19 and CR-M2-26 named are `exists`; CR-M2-33 registered 14 `functions` rows, all `exists`
and tagged: `S-A03-BAD-USGS-STILL-PENDING`, `S-A06-HAPPY-OLD-TOKEN-RETIRED`, `S-A08-HAPPY-PROCESSED`,
`S-A08-BAD-NOT-A-PHOTO`, `S-A08-BAD-HEIC`, `S-A08-BAD-PIXEL-LIMIT`, `S-A08-BAD-DUPLICATE-HASH`,
`S-A08-BAD-STORAGE-DOWN`, `S-A10-HAPPY-MANIFEST-BUILT`, `S-A10-BAD-DOCUMENT-SKIPPED`, `S-A10-BAD-NO-PUBLIC-TOKEN`,
`S-A10-BAD-WRITE-DURING-BUILD`, `S-A10-BAD-NOTHING-TO-PUBLISH`, `S-A20-BAD-STALE-ACCOUNT`. `S-A20-BAD-NO-APP-CHECK`
and every `e2e-admin` row stay `planned` until the admin's emulator tier (M2b).

### A.4 Still open

CR-M2-3 (ask first, §19a), CR-M2-5 and CR-M2-37 (the provisioner), CR-M2-6, CR-M2-21, CR-M2-22 (the `x-hcm-test`
forwarding), CR-M2-39 and CR-M2-40 (M2b), CR-M2-7 (M3), CR-M2-15 (a) (M3). Decisions: `DECISIONS-for-review.md` §22
(deploy-time configuration, a lockfile for `functions/dist/`, sharp at cold start).

## Addendum B: handed over to M2b (2026-10-12)

Added by the M2b contracts agent. The open requests CR-M2-5 (the provisioner's roles), CR-M2-6 and CR-M2-21 (the
admin's e2e tier), CR-M2-22 (the `x-hcm-test` forwarding), CR-M2-37 (the GA4 stream setting), CR-M2-39 (the emulator's
admin origins) and CR-M2-40 (the admin shows the integration's error codes) are assigned to the M2b workstreams in
`M2b-interfaces.md` → *Change requests*. `PROVISION_ITEMS` gained `crash-alerts` and `api-key` (`M2b-interfaces.md`
§0, §3.4); `setup.recordCloud` and `setup.status` accept them unchanged.

## Addendum C: handed over to M3 (2026-10-23)

Added by the M3 contracts agent. CR-M2-7 (the pipeline writes `jobDocSchema` and `jobLogDocSchema` documents) is
answered by `M3-interfaces.md` §2.3 (who writes which field in which status) and the golden documents of
`pipeline/tests/contracts/`; the pipeline workstream implements it. CR-M2-15 (a) (`MapboxApi.listTilesets` for the
publisher) becomes the `MapboxTilesets` port of `functions/src/ports/mapbox-tilesets.ts` (CR-M3-4: fn-setup's
`MapboxTilesetsApi` moves into its adapter). The `CloudRunJobs` port gained `get` and run options; `Deps` leaves out the
five M3 ports until fn-imagery wires them.

## The city's tab icon (2026-11-08)

The owner (2026-11-08): the Layers panel's map icon is the default browser tab icon of the app, and the admin can change
it. Behaviours V54 (the public page), V55 (the default in the user's theme) and A101 (Settings → Browser tab icon); the page's side is
[ENGINE_API.md](../ENGINE_API.md) → *The page's tab icon*; the choices are `DECISIONS-for-review.md` §165.

- **`cities.setIcon`** (`cityEditor`, `fn-cities`, App Check enforced; `functions/src/cities/set-icon.ts`; schemas
  `packages/shared/src/api/city-icon.ts`): `{kind: 'upload', cityId, image}` (standard base64 of the file, at
  most `CITY_ICON_LIMITS.maxBase64Chars`) or `{kind: 'reset', cityId}` → `{source, url, sha256}`. The bytes are checked before
  anything is written: their type from the magic numbers (`ImageProcessor.inspect`; PNG or WebP only, so an SVG, a
  JPEG, a PDF or a renamed file is `apiError.cityIcon.badType`), at most 1 MB (`tooBig {max}`), both sides at least 192 px
  (`tooSmall {min}`) and at most 4096 px (`tooLarge {max}`), sides within 1.25 of each other (`notSquare`), one frame
  (`animated`), readable (`invalid`). A `reset` draws the default: `mapIconSvg(theme.seedColor)` of `@hcm/shared`, our own
  SVG text, never a user's. A missing city is `apiError.notFound`.
- **The files**: `ImageProcessor.iconPng(source, size)` fits the source inside a square (transparent padding, never
  cropped, no metadata, `limitInputPixels`), and `STORAGE_PATHS.cityIcon(city, size)` (`cities/<city>/icon-<size>.png`,
  sizes `CITY_ICON_SIZES`: 32, 180, 512) in the **public** bucket, `Cache-Control: public, max-age=300`, overwritten in
  place: the pages link these fixed names (`functions/src/api/city-icon.ts`).
- **The tab's own copy** (2026-11-12, `DECISIONS-for-review.md` §166): an upload is also written at 32 px to
  `STORAGE_PATHS.cityOwnIcon(city)` (`cities/<city>/icon-own-32.png`, the same cache), and drawing the default (a `reset`,
  the build) deletes it. A city's pages show that file in the tab in every theme; without it they draw the default
  themselves, in the visitor's theme. Its absence is how a page knows the icon is the default without reading Firestore.
- **The record**: `cities/{city}.icon` (`cityDocSchema`): `source` (`default` | `custom`), the default's `seedColor`,
  `url` (the 180 px file, the admin's preview), `sha256` (the source's: the upload's bytes or the default's SVG), its own stamp. Server-owned: it is not in
  `CLIENT_WRITES.city.update`, so the rules refuse it to every client (S-A101-BAD-CLIENT-WRITE); not in
  `MANIFEST_FIELDS`, so writing it requests no build; an icon-only write is not listed in the city's history
  (`UNLISTED_FIELDS` of `functions/src/history/record.ts`), and a revert keeps the current icon (server-owned).
- **The default, kept by the build**: `publish.buildManifest` first runs `ensureCityIcon` (`functions/src/publish/icon.ts`):
  a city without an icon, or whose default wears an old seed colour, gets the default drawn; an upload is left alone (and
  an upload made while the default was drawn wins). A failure is logged and never fails the manifest. A new city's first
  write requests a build, so every city has its icon before visitors can see it.
