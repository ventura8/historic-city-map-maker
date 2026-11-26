# Security, cost and reliability review of the București dispărut plan (draft v2)

Verification: the research JSON was read and its verification corrections were applied. Facts the research did not cover were checked on 2026-10-11. Points marked **UNVERIFIED** could not be confirmed and need a smoke test.

## 0. Changes this lens makes to the draft plan

1. **Read user-entered secrets at runtime; don't use `defineSecret`.** Firebase says that after setting a new secret value "you must redeploy all functions that reference that secret". Secrets pasted into the Setup Assistant would then need a redeploy before they work.
   - Functions read `projects/P/secrets/X/versions/latest` through `@google-cloud/secret-manager`, with a 5-minute in-memory cache. They bust the cache when `setup/status.secretsRev` changes.
   - The Cloud Run Job uses `--set-secrets ENV=secret:latest`, which resolves fresh at each execution.
2. **Use two buckets**, both in us-central1, which is where the no-cost tier applies:
   - `<proj>.firebasestorage.app` is private. It holds admin uploads, rasters, USGS raw files and browse copies, protected by rules and admin claims.
   - `<proj>-public` holds only published derivatives: `manifest.json`, `web.webp`, `thumb.webp`. Only service accounts write to it.
   - A wrong rule can then never expose unpublished uploads or raw USGS files.
3. **Publish to Mapbox (MTS) only after approval.** The draft publishes at pipeline step 7. Iteration, previews and the GCP editor all run on our own GCS COG and preview files. Each MTS publish of a city crop at maxzoom ≥11 is about 5–30 CU, against 20 free CU per month. Re-georeferencing would otherwise burn CU on every attempt.
4. **Add a free Studio upload path.** Mapbox's Studio manual says tilesets uploaded in Studio are free: no processing or hosting charges, 20 uploads/month, 300 MB each.
   - The pipeline also exports a ≤300 MB 8-bit GeoTIFF (JPEG-compressed, z16–17 city crop).
   - With the user's permission, Claude uploads it through Chrome. The admin UI then finds the new tileset automatically via `GET /tilesets/v1/{user}`.
   - MTS (automatic, billed) stays the default only while estimated CU fits the free budget.
5. **Run short tasks driven by events, not long polling jobs.** The Cloud Run task exits when it is waiting on something outside us: USGS "preparing", USGS maintenance, or MTS processing. A single scheduled `ops.tick` function every 15 minutes resumes or finalizes. This uses 1 Cloud Scheduler job, inside the free allowance of 3.
6. **Check org policies at bootstrap.** A billing account or Free Trial can auto-create a standalone org with secure-by-default policies:
   - `constraints/iam.allowedPolicyMemberDomains` blocks `allUsers`. That breaks Firebase v2 `onCall` invoker bindings and a public bucket.
   - `constraints/iam.automaticIamGrantsForDefaultServiceAccounts` means the compute default SA has no Editor role, so functions builds can fail.
   - `constraints/iam.managed.disableServiceAccountKeyCreation` blocks keys.
   - The fixes are in §1.8.
7. **Region decision, made before Firestore exists:**
   - If Firestore is not created yet, choose `nam5` and put everything in `us-central1`. That avoids cross-region triggers and inter-region transfer. Public visitors never touch Firestore, and Firebase Auth is not EU-resident anyway.
   - If `eur3` is kept: Firestore-triggered functions go in `europe-west1`. Storage-triggered functions, the Cloud Run Job, buckets and Artifact Registry go in `us-central1`. Storage-heavy callables also go in `us-central1`.
8. **No owner email in the public repo.** The first admin is granted by a local bootstrap script that Claude runs with the user's own gcloud credentials. It uses the Admin SDK to set `admin:true` and create `admins/{uid}`. Invites store `sha256(lowercase email)` only.
9. **Gemini translation must use the paid tier, called server-side.** The Gemini API Additional Terms require API clients offered to users in the EEA to use Paid Services only. The admins are in Romania. Cost is under $0.05/month.
   - Do not enable the Firebase AI Logic client SDK. The Firebase web API key is public, so an AI endpoint reachable with it is a billing-abuse vector.
   - Instead, an admin-gated callable `assist.translate` calls Vertex AI or the Gemini API with the service account's credentials. No key is stored.
10. **Migrate legacy photos to structured fields; never render HTML from data.** The draft does not mention this. Details in §1.7.

---

## 1. Security

### 1.1 Service accounts and minimal IAM (exact role IDs)

| SA | Used by | Roles (scope) |
| --- | --- | --- |
| `gh-deployer@` | GitHub Actions through WIF impersonation | Project scope:<br>- `roles/firebasehosting.admin`<br>- `roles/firebaserules.admin`<br>- `roles/datastore.indexAdmin`<br>- `roles/cloudfunctions.developer`<br>- `roles/cloudscheduler.admin`<br>- `roles/cloudtasks.queueAdmin`<br>- `roles/serviceusage.serviceUsageConsumer`<br>- `roles/firebase.viewer`<br><br>Narrower scopes:<br>- `roles/artifactregistry.writer` on repo `pipeline` only<br>- `roles/run.developer` on job `raster-pipeline*` only<br>- `roles/iam.serviceAccountUser` on each runtime SA only (resource-level, never project-level)<br><br>No Secret Manager role, because functions don't declare `secrets:`.<br><br>**UNVERIFIED as a complete set.** Firebase publishes no least-privilege CI list. A community list adds `roles/firebase.admin`, `roles/cloudbuild.builds.editor`, `roles/eventarc.developer`, `roles/serviceusage.apiKeysViewer`. Add the narrowest role naming the permission in each 403. |
| `fn-admin@` | Callables (setup, usgs, jobs, assist, admins) | - `roles/datastore.user`<br>- `roles/firebaseauth.admin` (custom claims, revoking tokens)<br>- `roles/storage.objectAdmin` on both buckets<br>- `roles/secretmanager.secretAccessor` + `roles/secretmanager.secretVersionAdder` + `roles/secretmanager.secretVersionManager` per secret, on `usgs-username`, `usgs-app-token`, `mapbox-sk-bootstrap`, `mapbox-sk-tiles`<br>- `roles/run.jobsExecutorWithOverrides` (contains `run.jobs.run`, `run.jobs.runWithOverrides`, `run.executions.cancel`) on the job only<br>- `roles/run.viewer` on the job (`run.executions.get`)<br>- `roles/cloudtasks.enqueuer`<br>- `roles/aiplatform.user` only if Vertex AI is used for translation |
| `fn-events@` | Storage finalize, Firestore triggers, `ops.tick`, manifest task queue | - `roles/datastore.user`<br>- `roles/storage.objectAdmin` on both buckets<br>- `roles/eventarc.eventReceiver`<br>- `roles/run.invoker` on its own services<br>- `roles/run.jobsExecutorWithOverrides` + `roles/run.viewer` on the job<br>- `roles/secretmanager.secretAccessor` on `usgs-*` and `mapbox-sk-tiles` (order watch, MTS polling)<br>- `roles/cloudtasks.enqueuer` |
| `job-raster@` | Cloud Run Job | - `roles/datastore.user`<br>- `roles/storage.objectAdmin` on the private bucket (optional IAM condition on prefixes `rasters/`, `usgs-raw/`, `tmp/`; list calls need bucket-level handling)<br>- `roles/storage.objectCreator` on the public bucket, `previews/` only, if used<br>- `roles/secretmanager.secretAccessor` on `usgs-username`, `usgs-app-token`, `mapbox-sk-tiles` only<br><br>No Auth, Run or IAM roles. |
| Compute default SA | Functions build only | `roles/cloudbuild.builds.builder` if the secure-by-default org removed Editor. Never used as a runtime identity: set `serviceAccount` per function in `setGlobalOptions`. |

Firestore IAM cannot be scoped per collection, so `datastore.user` is accepted. Rules do not apply to the Admin SDK, which is why every server writer re-validates with the shared zod schemas.

### 1.2 Secrets end to end

| Secret | Created by | Accessible to | Notes |
| --- | --- | --- | --- |
| `usgs-username`, `usgs-app-token` | Human pastes the token into the Setup Assistant (shown for 60 s in ERS) → `setup.saveUsgs` | fn-admin, fn-events, job-raster | Verified on save with `login-token`. Store an optional expiry date in `setup/status` and remind the admin 14 days before. |
| `mapbox-sk-bootstrap` | Human creates it in the Mapbox console with scopes `tokens:read tokens:write styles:read styles:tiles fonts:read tilesets:read tilesets:write tilesets:list`. A token cannot mint scopes it does not have itself. | fn-admin only | This is the most sensitive secret. It is used only to mint and rotate the tokens below. |
| `mapbox-sk-tiles` | Minted by `setup.saveMapbox` through `POST /tokens/v2/{user}` with `tilesets:read/write/list` | job-raster, fn-events | Rotated quarterly by `ops.tick`. |
| Public tokens (not secret) | Minted with URL restrictions (§1.3) | Firestore `cities/{id}.mapbox`, then the manifest | |
| GCP/Firebase credentials | none (WIF + ADC) | | |
| reCAPTCHA Enterprise site key, Firebase web config | public | | Pin the API key with HTTP-referrer restriction to `https://<proj>.web.app/*` and `https://<proj>.firebaseapp.com/*`, plus an API-target allowlist, via `gcloud services api-keys update`. |

How a secret moves:

1. The admin UI input is `type=password` with `autocomplete=off`. It is never kept in state or storage, and is cleared after the call.
2. It is sent to an `onCall` function with `enforceAppCheck:true` and `consumeAppCheckToken:true` (replay-protected).
3. The callable checks: admin claim, `email_verified`, and `sign_in_provider=='google.com'`.
4. It validates the value upstream, then calls `versions.add`, then disables and destroys older versions. This keeps us within 6 free active versions.
5. It writes a non-secret health record to `setup/status`.
6. The value is never logged. A logger redactor removes `token`, `access_token=`, `X-Auth-Token` and the query part of USGS signed URLs.
7. Turn on Secret Manager Data Access audit logs (`DATA_READ`) to have an access trail. This fits inside the free 50 GiB of logging.

### 1.3 Mapbox public tokens

- **Viewer `pk`:** scopes `styles:read styles:tiles fonts:read`, allowedUrls `["https://ventura8.github.io"]`.
  - Use the origin only. Mapbox documents that the Referer is origin-only cross-origin, so a path never matches.
  - Smoke test that private `mapbox://ventura86.*` raster tiles load with it (**UNVERIFIED** that these scopes cover them).
- **Admin `pk`:** a separate token for `https://<proj>.web.app` and `https://<proj>.firebaseapp.com`. Separate tokens allow independent rotation and separate usage stats.
- **No dev token for localhost.** Unit and e2e tests stub `api.mapbox.com`. One nightly smoke test uses the admin `pk` against a preview channel. If a dev token is ever needed, it must include the port (`http://localhost:5173`); without a port only 80 and 443 match.
- **Never set `no-referrer` or `same-origin` referrer policies.** Both pages use `strict-origin-when-cross-origin`.
- **Panic callable `setup.rotatePublicToken`:** mints a new pk, rewrites the city doc, rebuilds the manifest, then deletes the old token after 10 minutes.
- URL restrictions are best-effort: the Referer can be spoofed outside browsers. So map-load abuse is handled with monitoring (§3.4), not prevention.

### 1.4 Firestore rules outline (Firestore fully private; the public reads only the manifest)

```text
rules_version = '2';
service cloud.firestore { match /databases/{db}/documents {
  function authed() { return request.auth != null && request.auth.token.email_verified == true
                     && request.auth.token.firebase.sign_in_provider == 'google.com'; }
  function isAdmin() { return authed() && request.auth.token.admin == true
                     && exists(/databases/$(db)/documents/admins/$(request.auth.uid)); } // immediate revocation
  function s(v,n){ return v is string && v.size() <= n; }
  function i18n(m,n){ return m is map && m.keys().hasOnly(['ro','en']) && (!('ro' in m)||s(m.ro,n)) && (!('en' in m)||s(m.en,n)); }
  function onlyChanged(keys){ return request.resource.data.diff(resource.data).affectedKeys().hasOnly(keys); }
  match /{d=**} { allow read, write: if false; }
  match /admins/{uid}   { allow read: if isAdmin() || (authed() && request.auth.uid == uid); allow write: if false; }
  match /setup/{doc}    { allow read: if isAdmin(); allow write: if false; }           // secrets never here
  match /cities/{c} {
    allow read: if isAdmin();
    allow update: if isAdmin() && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['mapbox','createdAt','id']);
    allow create, delete: if false;                                                    // callable only
    match /photos/{id} {
      allow read: if isAdmin();
      allow create, update: if isAdmin() && validPhoto(request.resource.data)        // hasOnly keys, i18n(title,200), i18n(description,5000),
        && request.resource.data.updatedBy == request.auth.uid                          // lat/lng within city bounds±0.5°, year 1800..2100,
        && (resource == null || !request.resource.data.diff(resource.data).affectedKeys()  // bearing 0..360, fov 1..180, license in ENUM,
              .hasAny(['image','exif','processing','createdAt','createdBy']))            // links: list size<=5
        && (request.resource.data.published == false
            || (resource != null && resource.data.processing == 'done' && request.resource.data.license != 'unknown'));
      allow delete: if isAdmin();
    }
    match /layers/{id} { allow read: if isAdmin();
      allow update: if isAdmin() && onlyChanged(['label','description','order','opacity','defaultVisible','published','attribution','updatedBy']);
      allow create, delete: if false; }
    match /jobs/{id} { allow read: if isAdmin();
      allow create: if isAdmin() && request.resource.data.status == 'queued'
        && request.resource.data.type in ['usgs-import','geotiff-import','regeoref','republish']
        && request.resource.data.createdBy == request.auth.uid && request.resource.data.keys().hasOnly([...]);
      allow update: if isAdmin() && onlyChanged(['cancelRequested']) && request.resource.data.cancelRequested == true;
      match /logs/{l} { allow read: if isAdmin(); allow write: if false; } }
    match /gcps/{layerId} { allow read: if isAdmin(); allow write: if isAdmin() && request.resource.data.points.size() <= 300; } // per-point check server-side
    match /usgsScenes/{e} { allow read: if isAdmin(); allow update: if isAdmin() && onlyChanged(['status','note'])
        && request.resource.data.status in ['candidate','ordered','rejected']; allow create, delete: if false; }
  }
}}
```

The `exists()` check adds one billed read per admin operation, which is negligible. Its benefit is that removing an admin takes effect immediately; a custom claim alone stays valid for up to 1 hour. On removal, also call `revokeRefreshTokens`.

### 1.5 Storage: rules, IAM, CORS and lifecycle

**Private bucket rules:**

```text
rules_version = '2';
service firebase.storage { match /b/{bucket}/o {
  function isAdmin() { return request.auth != null && request.auth.token.admin == true && request.auth.token.email_verified == true
     && firestore.exists(/databases/(default)/documents/admins/$(request.auth.uid)); }
  match /uploads/photos/{city}/{uid}/{up}/{f} { allow create: if isAdmin() && request.auth.uid == uid && city.matches('^[a-z0-9-]{2,32}$')
       && request.resource.size < 60 * 1024 * 1024 && request.resource.contentType.matches('image/(jpeg|png|webp|tiff|heic|heif)');
     allow read, delete: if isAdmin(); }                               // no SVG, ever
  match /uploads/rasters/{city}/{uid}/{up}/{f} { allow create: if isAdmin() && request.auth.uid == uid
       && request.resource.size < 8 * 1024 * 1024 * 1024 && request.resource.contentType.matches('image/tiff|application/octet-stream');
     allow read, delete: if isAdmin(); }
  match /{p=**} { allow read: if isAdmin(); allow write: if false; }   // derived artifacts: SAs only
}}
```

- Storage rules that call `firestore.exists()` need the Storage service agent to hold `roles/firebaserules.firestoreServiceAgent`. Grant it in bootstrap.

**Server-side checks on upload.** Never trust the client's `contentType`.

- Sniff magic bytes with `file-type`.
- Set sharp's `limitInputPixels` to about 200 MP. Check `photos/Ferdinand.png` (29.5 MB) against it.
- Strip all metadata from public derivatives (sharp's default). Copy only the needed EXIF fields into Firestore as plain text.

**Public bucket.**

- Use uniform bucket-level access and grant `allUsers` → `roles/storage.legacyObjectReader`. That allows get without list; `objectViewer` would also allow listing. **UNVERIFIED** that this role is grantable under UBLA; fall back to `objectViewer`.
- If domain-restricted sharing blocks `allUsers`, use a Firebase-linked public bucket with the rule `match /public/{p=**} { allow read: if true; allow write: if false; }` and serve URLs from `firebasestorage.googleapis.com/...?...alt=media`. This needs no IAM change.

**Cache headers.**

- Images use content-hashed paths `photos/{city}/{id}/{sha8}/web.webp` with `Cache-Control: public, max-age=31536000, immutable`.
- The manifest uses `public, max-age=60`, stored with `Content-Encoding: gzip`.

**CORS** (`gcloud storage buckets update gs://B --cors-file=cors.json`):

```json
// public bucket
[{"origin":["*"],"method":["GET","HEAD"],"responseHeader":["Content-Type","Range","Content-Range","ETag","Accept-Ranges"],"maxAgeSeconds":3600}]
// private bucket (Firebase docs: needed for getBlob/fetch/Mapbox image sources)
[{"origin":["https://<proj>.web.app","https://<proj>.firebaseapp.com"],"method":["GET","HEAD"],"responseHeader":["Content-Type","Range","Content-Range","ETag"],"maxAgeSeconds":3600}]
```

- The admin loads private previews with `getBlob()` into a `blob:` URL, not long-lived download-token URLs.

**Lifecycle and cost:**

| Prefix | Rule |
| --- | --- |
| `tmp/` | delete after 1 day |
| `uploads/` | delete after 7 days (orphans) |
| `usgs-raw/` for frames that were already free | delete after 30 days; USGS is the archive and they are re-downloadable |
| `usgs-raw/` for paid on-demand scans | move to `ARCHIVE` after 30 days. Later free re-download is **UNVERIFIED**, so keep them. |

- Set `--soft-delete-duration=0` on the private bucket, because multi-GB scratch deletions would otherwise be billed for 7 more days. Keep the default 7 days on the public bucket.

### 1.6 App Check

- **Admin: yes.** Use reCAPTCHA Enterprise; 10k assessments/month are free, and tokens are cached for about 1 hour.
  - Enforce on Firestore and all callables. Sensitive callables use `consumeAppCheckToken`.
  - Run in monitor-only mode for 1 week, then enforce.
  - Create the key with `gcloud recaptcha keys create --web --integration-type=SCORE --domains=<proj>.web.app,<proj>.firebaseapp.com`.
  - Skip App Check on Storage: admin claims already gate it, and App Check would complicate a Firebase-API public fallback.
- **Public viewer: none needed.** It loads no Firebase SDK at all, only static JSON and images. So it has no quota-abuse surface beyond GCS egress and Mapbox map loads.
- **Emulators and e2e:** use the debug provider. Do not add `localhost` to production authorized domains. Projects created after 2025-04-28 don't authorize it by default, and the emulator doesn't need it.

### 1.7 XSS surfaces (concrete)

1. **Legacy data contains HTML.** In `geojson/photos.json`, `properties.source` holds `<a href="https://www.facebook.com/..." target="_blank">` and `<a href="https://www.flickr.com/...">`. `properties.description` holds `<p>Alte legături:&nbsp;<a href="http://www.costingheorghe.ro/...">`.
   - The current `index.html:575` concatenates title, author, source and description into `Popup.setHTML`. That is the pattern to eliminate.
   - The migrator parses anchors into `links:[{url,label}]` (https only; http is upgraded or dropped) plus plain text. It stores no HTML.
2. **Rendering rules:**
   - Use Lit or Material Web templates, which auto-escape, plus `textContent`. Mapbox popups use `setDOMContent`.
   - ESLint enforces this with `eslint-plugin-no-unsanitized` and `no-restricted-syntax`/`no-restricted-properties` bans on `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTML`, `document.write`, `eval` and `new Function`.
   - It also bans imports of `lit/directives/unsafe-html.js` and `unsafe-svg`. Sonar flags the same patterns.
3. **URLs:** zod requires `https:` only. Image URLs must match our bucket prefix exactly. External links get `rel="noopener noreferrer nofollow ugc"`. Deep link `#photo=<id>` is checked against `^[A-Za-z0-9_-]{1,40}$` and looked up in a Map, never put into a selector.
4. **Untrusted strings shown in the admin**, all rendered as text only:
   - EXIF `ImageDescription`/`Artist`, which attacker-crafted images can carry
   - USGS metadata, and USGS 503/403 HTML bodies that appear in job logs
   - Nominatim results
   - Gemini drafts
   - Mapbox job errors
5. **Manifest:** use `z.strictObject` everywhere, which strips unknown keys and blocks prototype-pollution keys. Rich "about" text is a minimal markdown subset (bold, italic, https links) rendered to DOM nodes, never HTML. Add a Trusted Types policy in report-only mode first.
6. **Uploads:** no SVG accepted. HEIC is converted server-side.

### 1.8 CSP and headers

**Admin (Firebase Hosting `firebase.json` headers).**

- Bundle Firebase and mapbox-gl from npm so that `script-src 'self'` works. Set `authDomain = "<proj>.web.app"` (same origin, per the Firebase redirect best practices).

```text
Content-Security-Policy: default-src 'self'; script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/ [+ 'wasm-unsafe-eval' only if Standard style used in admin];
 connect-src 'self' https://*.googleapis.com https://*.cloudfunctions.net https://*.run.app https://api.mapbox.com https://events.mapbox.com https://*.tiles.mapbox.com https://storage.googleapis.com;
 img-src 'self' data: blob: https://storage.googleapis.com https://firebasestorage.googleapis.com https://api.mapbox.com https://lh3.googleusercontent.com https://tile.openstreetmap.org;
 frame-src https://<proj>.web.app https://<proj>.firebaseapp.com https://accounts.google.com https://www.google.com/recaptcha/ https://recaptcha.google.com;
 worker-src 'self' blob:; style-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
Content-Security-Policy-Report-Only: require-trusted-types-for 'script'
Cross-Origin-Opener-Policy: same-origin-allow-popups   (popup sign-in)   ·  Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff  ·  Permissions-Policy: camera=(), microphone=(), geolocation=(self)
```

**Public site (GitHub Pages, so only a `<meta>` CSP).** Meta CSP cannot set `frame-ancestors` or reporting.

```text
default-src 'none'; script-src 'self' https://api.mapbox.com/mapbox-gl-js/ 'wasm-unsafe-eval'; style-src 'self' https://api.mapbox.com/mapbox-gl-js/;
img-src 'self' data: blob: https://storage.googleapis.com/<proj>-public/ https://api.mapbox.com; connect-src https://api.mapbox.com https://events.mapbox.com
https://*.tiles.mapbox.com https://storage.googleapis.com/<proj>-public/; worker-src blob:; font-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'
```

- `'wasm-unsafe-eval'` is required by Mapbox for the Standard style.
- Add `<meta name="referrer" content="strict-origin-when-cross-origin">`.
- Bucharest should serve the engine same-origin: CI copies `dist/` into the Pages artifact. jsDelivr `@1` is for third-party cities only. If a site loads from jsDelivr, pin an exact version with `integrity` and `crossorigin`; SRI is impossible with range URLs.
- Self-host fonts (Roboto Flex, Material Symbols). No Google Fonts, for GDPR reasons; LG München I 2022 ruled against Google Fonts embedding.
- The service worker must never cache `api.mapbox.com` or `*.tiles.mapbox.com` (Mapbox Product Terms §1.9).

**Org-policy pitfalls, detected and fixed by bootstrap.**

1. Run `gcloud projects describe P --format='value(parent)'`. If there is a parent, check `gcloud org-policies describe <c> --project P --effective` for:
   - `iam.allowedPolicyMemberDomains`
   - `iam.managed.disableServiceAccountKeyCreation`
   - `iam.automaticIamGrantsForDefaultServiceAccounts`
   - `storage.uniformBucketLevelAccess`
2. Fixes for domain-restricted sharing:
   - For callables, after deploy run `gcloud run services update <fn> --region R --no-invoker-iam-check`. This is GA since 2025-03-28 and needs no `allUsers` binding. Whether firebase-tools sets this itself is **UNVERIFIED**; if a deploy fails trying to set `allUsers`, use this post-deploy step.
   - For the public bucket, use the Firebase-rules fallback from §1.5.
   - The org-owner override is also possible: the Gmail standalone-org creator holds `roles/resourcemanager.organizationAdmin`, can grant themselves `roles/orgpolicy.policyAdmin`, and then sets a project-level `allowAll`. Changing org policy is a settings change and needs the user's explicit yes.

---

## 2. CI deployment through Workload Identity Federation

Claude runs these locally under the user's gcloud login. Each is a settings change, so each needs the user's yes in chat.

```bash
P=<project-id>; PN=$(gcloud projects describe $P --format='value(projectNumber)')
REPO_ID=$(gh api repos/ventura8/bucurestiuldisparut.github.io --jq .id); OWNER_ID=$(gh api users/ventura8 --jq .id)
gcloud services enable iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project $P
gcloud iam workload-identity-pools create github --project $P --location global --display-name "GitHub Actions"
gcloud iam workload-identity-pools providers create-oidc site-master --project $P --location global --workload-identity-pool github \
  --issuer-uri https://token.actions.githubusercontent.com \
  --attribute-mapping "google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.ref=assertion.ref" \
  --attribute-condition "assertion.repository_owner_id=='${OWNER_ID}' && assertion.repository_id=='${REPO_ID}' && assertion.ref=='refs/heads/master' && assertion.environment=='production'"
gcloud iam service-accounts create gh-deployer --project $P
gcloud iam service-accounts add-iam-policy-binding gh-deployer@$P.iam.gserviceaccount.com --project $P \
  --role roles/iam.workloadIdentityUser \
  --member "principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository_id/$REPO_ID"
# then the role grants from §1.1; wait ≥5 min for propagation (auth README)
```

- Conditions use numeric IDs, which Google recommends against repo-name squatting.
- Only jobs on `master` that declare `environment: production` can authenticate. Restrict that environment to `master` in GitHub too.
- Workflows triggered by `pull_request` from forks never get `id-token`. Ban `pull_request_target`. Pin actions by commit SHA. Only the deploy job sets `permissions: {contents: read, id-token: write}`.

Workflow steps:

1. `google-github-actions/auth@v3` (pinned by SHA) with `workload_identity_provider`, `service_account: gh-deployer@…`, `create_credentials_file: true`, `export_environment_variables: true`.
2. Then `npx -y firebase-tools@15.33.0 deploy --only hosting,functions,firestore,storage --project $P --non-interactive --force`.
3. Then `gcloud run jobs deploy raster-pipeline …` with an image digest that CI built and pushed to Artifact Registry. Use `docker/build-push-action` on path-filtered changes only.

**Does firebase-tools work with WIF?**

- It is not officially documented. The auth README still says "not supported by Firebase Admin SDK", but that is stale for firebase-admin-node ≥13, where issue #1377 was fixed by PR #2466.
- Community reports, including a 2026-02 write-up, show `firebase deploy` working with impersonation plus a credentials file. Known failure modes are missing roles (403s), the credentials file not exported, and impersonation binding errors.
- The external_account credentials file re-fetches the GitHub OIDC token during the job, so long deploys can refresh. Avoid `token_format: access_token`.
- Treat the first CI run as the test.

**Fallbacks, in order:**

1. Deploy from the developer machine. Claude runs `firebase deploy` under the user's own login, and CI keeps tests, builds, engine tags and image pushes. This needs no new secret.
2. A service-account key, only if no org policy blocks it: GitHub environment secret, required reviewer, 90-day rotation.

Never use `FIREBASE_TOKEN`; it is deprecated.

---

## 3. Monthly cost model

Assumptions:

- Per page view: 1 manifest (60 KB gz at 2k photos), about 3 thumbnails at 25 KB and 2 web images at 350 KB, so roughly 1 MB and 6 GCS reads.
- Per raster layer stored in GCS: crop about 0.7 GB, COG about 0.2–0.3 GB, IIIF tiles about 0.3 GB.
- Photo originals average about 3 MB.

### 3.1 Steady state

| Item | Small (50 photos, 10 tilesets, 5k views) | Large (2,000 photos, 25 tilesets, 50k views) | Basis |
| --- | --- | --- | --- |
| GCS storage, us-central1 | about 12 GB, roughly $0.15 | about 37 GB, roughly $0.65 | $0.020/GB-month after 5 GB free (third-party 2026 sources; verify) |
| GCS egress, public | about 5 GB, $0 | about 50 GB, $0 | 100 GB/month free (Firebase pricing, confirmed). Beyond that about $0.12/GB. |
| GCS reads | 30k, $0 | 300k, about $0.10 | 50k/month free, then $0.004 per 10k |
| Firestore | $0 | $0–1 | Within 50k reads/day if the manifest builder is incremental (§4.5) and admin lists are paginated |
| Functions (2nd gen) | $0 | $0 | Free invocations and compute; set `maxInstances` caps |
| Cloud Run Jobs, per import | about $0.3 (4 vCPU, 16 GiB, 45 min) to $0.75 (8 vCPU, 32 GiB, 60 min) list price | same | $0.000018/vCPU-s and $0.000002/GiB-s. The free tier for jobs is 240k vCPU-s and 450k GiB-s/month per billing account (official table as summarised by search; verify), which is about 8–20 imports/month at $0. |
| Artifact Registry | about $0.25 | about $0.25 | Pipeline image about 1.5 GB × 2 kept versions; 0.5 GB free. Use cleanup policies and `firebase functions:artifacts:setpolicy`. |
| Cloud Build | $0 | $0 | 120 min/day free (Firebase pricing). The pipeline image is built on GitHub Actions instead. |
| Secret Manager | $0 | $0 | 4 active versions (6 free); runtime cache keeps accesses under 10k/month |
| Scheduler, Tasks, Hosting, App Check, Logging | $0 | $0 | 1 Scheduler job; Hosting admin only (10 GB stored, 360 MB/day free) |
| Cloud Run egress to Mapbox | about $0.06 per import | | About 0.5 GB upload |
| Gemini (paid tier) | under $0.01 | under $0.05 | |
| **GCP total** | **about $0.5/month** | **about $1–2/month** | |
| Mapbox map loads | $0 | $0 at exactly 50k. At 60k, $50. | $5/1k for 50–100k, $4/1k for 100–200k. Compare mode costs 2 loads per view. |
| Mapbox hosting days | 300 days, $0 | 750–775 days, $0–0.34 | $0.0137/day beyond 750. Studio-uploaded tilesets are $0. |
| Mapbox processing | | | 10 GB and 20 CU free per month, then $0.007/MB and $0.90/CU. One city crop at maxzoom ≥11 is about 5–30 CU. **The initial backlog of 10–25 layers in one month is about 50–750 CU, roughly $27–$657 one-time**, unless it is spread across months, kept at z16, or sent through the free Studio path. |
| USGS | | | $0 for already-scanned frames. On-demand scan: $30/frame + $5/order, one-time, paid by the human. |

### 3.2 Spike (viral month, 500k views)

| Item | Cost |
| --- | --- |
| GCS egress | about 500 GB, so 400 × $0.12 ≈ $48, plus about $1.2 for reads |
| **Mapbox map loads** | **$250 + $400 + $900 ≈ $1,550** |

Mapbox is the dominant risk.

### 3.3 Mapbox cost guards, all automatic

1. **Before any publish**, a `estimateCu(sourceMB, maxzoom)` check runs. It uses the doc table first, then our calibration from past jobs, and `tilesets estimate-cu` if available. It compares against a month-to-date counter in `usage/mapbox-YYYY-MM`. If over budget (default 20 CU), the admin sees one card with three choices:
   - "Free: Studio upload" (Claude does it)
   - "Defer to next month" (default; `ops.tick` publishes on the 1st)
   - "Pay ~$X"
2. **Deterministic tileset and source ids per layer** (`ventura86.buc-1966-kh4a`). Re-publish only if the source sha256 differs from `mapbox.publishedSourceSha`. Retries never create new tilesets.
3. **Choose maxzoom per sensor:** z16 for KH-4, z17 only for KH-9 panoramic and KH-7. Crop to the city polygon.
4. **Limit published tilesets to 24** without explicit approval, and auto-delete rejected draft tilesets.
5. **e2e and unit tests always stub Mapbox.** Only one nightly real smoke load runs.
6. Use one Map instance. Create the compare map lazily.
7. Mapbox has **no spending cap** (FAQ). Set up Usage notifications in the console: map loads at 25k, 40k and 50k; CU at 10 and 20; hosting days at 600 and 750. Claude can do this in Chrome with the user's permission.

### 3.4 GCP spend guards

- **Budget** of $5/month on the billing account, filtered to the project, with alerts at 50%, 90%, 100% and forecast 100%. Plus a $20 "panic" threshold that publishes to Pub/Sub:

  ```text
  gcloud billing budgets create --billing-account=$BA --display-name=bucuresti \
    --budget-amount=5USD --filter-projects=projects/$P \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 \
    --threshold-rule=percent=1.0 --threshold-rule=percent=1.0,basis=forecasted-spend \
    --notifications-rule-pubsub-topic=projects/$P/topics/budget
  ```

- **`ops.onBudget` function** sets `ops/guard.state=red`. Red pauses raster dispatch, MTS publishes and AI assists. It never touches the public site and never disables billing, since disabling billing risks deleting data.
- **Billing data lags by hours**, so in-app hard caps also apply: at most 10 raster jobs/day, 1–2 running at once, and per-uid callable rate limits in Firestore.
- **Per-function caps:** callables `maxInstances` 3–5, `photos.onUpload` 5 with concurrency 1 and 2 GiB, manifest builder 1. Firebase Functions spend caps are Preview and optional.

---

## 4. Reliability

### 4.1 Job state machine (`cities/{c}/jobs/{id}`)

States:

- `queued` → `starting` → `running{step}`
- then one of `waiting_usgs{retryAt}`, `mts_processing{mapboxJobId}`, or `awaiting_approval`
- ending in `succeeded`, `failed` or `cancelled`

Each step stores `steps.{name}.{status, outputs:{gcsPath, generation, sha256}}`.

**Dispatch** (`jobs.onCreate` is at-least-once):

1. A transaction moves `queued` to `starting` and sets `dispatchAt`.
2. It calls `jobs.run` with override env `JOB_ID` and stores `executionName`.
3. If the API call fails, it reverts to `queued` and rethrows (`retry:true`).
4. `ops.tick` re-dispatches any job stuck in `starting` for more than 10 minutes without an `executionName`.

**Inside the container:**

- A lease transaction (`leaseOwner = CLOUD_RUN_EXECUTION/TASK_ATTEMPT`, 10-minute TTL, 60 s heartbeat) makes duplicate executions exit 0.
- Each step is skipped if its recorded outputs exist with a matching generation. GCS create-once uses `ifGenerationMatch=0`.
- Settings: `--max-retries 2`, `--task-timeout 6h` (up to 168 h has been GA since 2025-11-11).
- On SIGTERM the container has about 10 s before SIGKILL, so it records `interrupted` and does nothing heavy.
- **Cancel:** a `cancelRequested` flag is checked on each heartbeat, plus `executions.cancel`.

**OOM handling:** run-with-overrides cannot change CPU or memory. So deploy two job definitions:

- `raster-pipeline` (4 vCPU, 16 GiB)
- `raster-pipeline-xl` (8 vCPU, 32 GiB, the Cloud Run Job maximum)

The dispatcher picks `-xl` for KH-9 panoramic frames, or after an exit code 137 or "memory limit exceeded".

### 4.2 USGS

- **Response handling.** Parse the body on every status; JSON errors come back as HTTP 500.

  | Response | Action |
  | --- | --- |
  | HTML 503 "Application Offline" | Maintenance. Set `waiting_usgs` with backoff 30 min → 1 h → 2 h → … max 12 h, and exit, so no idle vCPU is billed. |
  | HTML 403 | Re-login once. If it repeats, mark `setup/status.usgs=invalid` and notify. |
  | `RATE_LIMIT` or 429 | Jittered backoff; honour `Retry-After`. |
  | Other `errorCode` | Fail the step with a mapped message. |

- **Maintenance windows** are monthly, usually Wednesday from about 07:00 CT to 14:00–18:00 CT, with extra out-of-cycle windows. They are not on Tuesdays. Federal funding lapses also stall the service, so treat it as `waiting_usgs`.
- **2 h API key.** The `M2MSession` class re-logs-in proactively at 100 minutes and on any 403. Every execution logs in on its own and calls `logout` in `finally`.
- **Deterministic labels.** `download-request` uses `label = "bd-{jobId}"`, so retries reuse the same request. If still preparing after about 10 minutes, set `waiting_usgs`. Clean up with `download-order-remove` on success.
- **Download resume.** Stream USGS bytes into a GCS resumable upload in 64 MiB chunks, persisting `{uploadSessionUri, offset, sha256State}`. GCS sessions live 1 week. Resume with HTTP `Range` if the USGS server honours it (**UNVERIFIED**); otherwise restart from zero.
  - On 403 or 410 for the signed URL, call `download-retrieve` again for a fresh URL.
  - Verify the final size against `download-options.filesize`.
- **Extraction** is a separate, idempotent step. It reads `usgs-raw/*.tgz` from GCS (free in-region) with `tarfile` in `r|gz` mode and writes only the needed `_a.._d` segments to `raster-seg/`. Later steps read segments through GDAL `/vsigs/` (ranged reads), so there are no large local copies.

### 4.3 Memory and scratch options in 2026

| Option | Status | Use |
| --- | --- | --- |
| In-memory `/tmp` | GA; counts against memory | Default. Peak is about 10 GB: crop ≤1.5 GB, warp output and temp ≤1.5 GB, `GDAL_CACHEMAX` 4 GB, OpenCV on downsampled images about 3 GB. So 16 GiB suffices, and KH-9 panoramic frames use 32 GiB. |
| Ephemeral disk | **Preview since 2026-04-20.** 1–100 GiB per volume, 10 GiB per instance by default, 100 GiB/region quota, gen2 only, no live migration, pre-GA terms | Optional feature flag: 4 vCPU / 8 GiB plus a 50 GiB disk would cut memory cost. Not the default. |
| Cloud Storage FUSE | GA (mount options GA 2025-09-23) | Read-only inputs only. GDAL random writes get staged in memory, so there is no gain. Prefer `/vsigs/`. |

Settings: `GDAL_NUM_THREADS=ALL_CPUS`, `gdalwarp -wm 2048 -multi`, `CPL_VSIL_USE_TEMP_FILE_FOR_RANDOM_WRITE=YES`.

### 4.4 MTS publishing

- **Upload:** `PUT` replaces the source, so a retry is idempotent. Run publishes through one queue because of the 2/min limit, with 429 backoff.
- **Processing:** after `publish`, store `mapboxJobId`, set `mts_processing`, and exit. `ops.tick` polls `GET /tilesets/v1/{id}/jobs/{jobId}`.
  - On `success`, run a tile smoke test (centre at z14 returns a non-empty 200), then `awaiting_approval` or auto-approve.
  - On `failed`, copy `errors`/`warnings`. Recipe errors are not retried; internal errors are retried once.
- **Lag:** new tiles appear only as cached tiles expire, so tell the admin.
- **Cleanup:** delete tileset and source on layer delete, with tombstone retries, to stop hosting-day charges.

### 4.5 Manifest regeneration races

- **Debounced, serialised builds.** Triggers fire only when public fields or `published` change; before/after diff in the trigger. They enqueue an `onTaskDispatched` builder with `maxConcurrentDispatches: 1`, `scheduleDelaySeconds: 60`, and dedupe id `manifest-{city}-{floor(now/60s)}`. Serialisation removes overwrite races.
- **Catching missed writes.** `requestedVersion` is incremented on every relevant write. After upload, if `requestedVersion` is greater than the version this build started with, enqueue another build.
- **Incremental build.** Read the previous manifest from GCS, apply docs with `updatedAt > builtAt` plus tombstones, run a full rebuild nightly from `ops.tick`, and read at a consistent `readTime`.
- **Validation.** zod-parse each doc; an invalid doc is skipped and flagged, never fails the whole manifest. Include only photos with `processing=='done'` whose derivatives exist.
- **Size guard.** Above 2 MB gzip, split into `layers.json` plus `photos-index.json` plus per-photo detail.
- **Unpublish.** Remove from the manifest first. Delete public objects 10 minutes later so cached manifests (60 s) don't show broken images.
- **Public viewer fallback.** If the manifest fetch fails, use the last good manifest from Cache Storage.

### 4.6 Other partial failures

- **Storage finalize:** derived paths are deterministic by sha256, so reprocessing is idempotent. On failure set `processing:'failed'` and offer a "Reprocess" callable.
- **Mapbox succeeded but the Firestore write failed:** the retry sees the tileset with a matching source sha and goes straight to finalize.
- **Missing or invalid secret:** fail fast with a Setup Assistant deep link.
- **All job logs** go through the redactor before writing to `jobs/{id}/logs`, capped at 500 lines.

---

## 5. Legal and licensing (not legal advice)

### Mapbox Product Terms (2026-07-21)

- §2.8.2 forbids using Mapbox satellite or aerial imagery "to improve the accuracy of or otherwise enhance any imagery". So no Mapbox Satellite in the georeferencer, either automatic or manual.
- §1.6 bans tracing, deriving or extracting. Avoid Mapbox Streets as a GCP source too.
- §1.9 bans bulk downloads and caching. Hence no service-worker tile cache.
- Keep the Mapbox logo and attribution visible; Material overlays must not cover them.
- Don't use Mapbox temporary geocoding for titles that are stored permanently. Use Nominatim.

### OSM

- The ODbL applies. Credit "© OpenStreetMap contributors" wherever OSM-derived suggestions or references appear.
- A layer georeferenced with OSM-picked GCPs is a Produced Work, so add it to the layer `attribution`.
- tile.openstreetmap.org is acceptable only for light interactive admin use, with attribution and no prefetching.

### Nominatim policy

- Absolute maximum 1 request/second for the whole app. Enforce it with a Cloud Tasks queue at `maxDispatchesPerSecond: 1`.
- Mandatory caching (`geocache/{lat5,lng5}`). Custom User-Agent `bucurestiuldisparut-admin/1 (+https://github.com/ventura8/…)`.
- No bulk or grid reverse geocoding and no autocomplete. Show attribution.
- The policy also requires LLM-generated code to follow the policy, so link it in code.

### Reference imagery

- Copernicus Sentinel-2 (Earth Search) is open; credit "Contains modified Copernicus Sentinel data YYYY".
- EOX s2cloudless 2016 is CC BY 4.0. The 2018–2021 releases are CC BY-NC-SA, acceptable only while the project stays non-commercial.

### USGS

- Declassified imagery is public domain. The courtesy credit is "Courtesy of the U.S. Geological Survey".
- On-demand scanning covers only USGS duplicate film; NARA holds the originals. The admin must check the basket icon before promising a purchase.
- The ERS account is personal to the owner. Keep admins few and note this in the Setup Assistant.

### Photo copyright

- The 44 legacy photos come from named private authors (Ion Mureșan 26 features, Dan Vartanian 26, Dan Perry, Gheorghe Leahu, Florin Paraschiv, Mihai Isăcescu) plus 16 features with no author. The repo has no LICENSE.
- GitHub's terms let others view and fork public content on GitHub, not republish it elsewhere such as Firebase Storage.
- Migrate with `license:'permission-legacy'` and `rightsReview:true`. Show a "Rights review" queue (one click to confirm each), a takedown and contact link in About, and recommend contacting the fostulbucuresti maintainers.
- The Realitatea Ilustrată 1934–35 scans are likely public domain in Romania (anonymous works, 70 years after publication).
- Schema fields: `license` enum (CC0, CC-BY-4.0, CC-BY-SA-4.0, PD, permission, permission-legacy, unknown), `author`, `rightsHolder`, `sourceUrl`/`sourceLabel`, and an admin-only `permissionNote`. A photo with license `unknown` cannot be published.
- Give the engine code its own LICENSE (MIT or Apache-2.0) that explicitly excludes photos and data. jsDelivr's terms expect a licence, and immutable files are kept permanently, so never tag a commit that contains anything you may need to retract.

### GDPR

- **Admins:** store uid, email, name and an invite hash in Firebase Auth and Firestore. Delete on removal. Log uids, not emails.
- **Stray sign-ups:** a `beforeUserCreated` blocking function rejects non-invited sign-ups. It needs the Identity Platform upgrade, which is free under 50k MAU. Without it, `ops.tick` deletes non-admin users after 24 h.
- **Visitors:** no cookies and no analytics. Mapbox telemetry sends the visitor's IP to Mapbox and stores a localStorage id; disclose this as a residual risk. GitHub Pages, jsDelivr and GCS also see IPs.
- **Privacy notice** in About (RO and EN) lists the processors: Google/Firebase, Mapbox, GitHub, jsDelivr.
- **EXIF** is stripped from public files.
- The Gemini paid-tier requirement for EEA users is covered in §0.9.

---

## 6. Steps only the human can do vs everything else

**Human only:**

- Creating accounts: Google billing account, Mapbox account, USGS ERS account
- Entering card details and billing addresses (Google, Mapbox, USGS payment)
- Copying and pasting tokens into the Setup Assistant: the ERS app token (visible for 60 s) and the Mapbox `sk` (shown once)
- Clicking "Allow" on OAuth consent screens and typing any password

**Claude, with the user's yes per action:**

- Every gcloud, firebase and gh command: bootstrap, WIF, IAM, buckets, CORS, budgets, reCAPTCHA key, org-policy checks
- Navigating Chrome to the exact pages
- Ticking Mapbox token scope boxes
- Setting Mapbox usage notifications
- Pre-filling the USGS M2M justification, which the user submits
- Studio GeoTIFF uploads

Everything after the secrets are pasted is automatic.

### Critical Files for Implementation

- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/geojson/photos.json (legacy HTML in `source`/`description`; the migration input)
- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/index.html (line 575: the `setHTML` XSS pattern and `fostulbucuresti` tokens to remove)
- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/infra/bootstrap.sh (new: WIF, service accounts, IAM, buckets, CORS, lifecycle, budgets, org-policy checks, owner grant)
- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/infra/firestore.rules and /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/infra/storage.rules (new)
- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/firebase.json (new: Hosting CSP and headers) and /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/pipeline/ (new: job state machine, USGS client, MTS cost gate)
