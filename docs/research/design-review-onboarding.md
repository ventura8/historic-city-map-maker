# Automation and onboarding report for București dispărut: keeping admin input to a minimum

Scope: the three areas you asked for (every human touchpoint, the three setup wizards, and what is over-engineered for v1). Everything is checked against the draft plan, research.json (where verification corrections take precedence), the repo, and live checks I ran on 2026-10-11.

## 0. Findings that change the draft

1. **Mapbox demo access is an outage risk, not only a quota limit.** A demo account that hits any cap loses all Mapbox APIs until it upgrades, so the public site would go blank after about 5,000 map loads. Demo accounts also cannot create tokens at all.
   - The payment step therefore has to be a hard gate before launch.
   - Once a valid secret (`sk`) token with `tilesets:write` exists, that proves the account has left demo. The wizard needs no separate check.
   - When upgrading, choose **"Rotate token"**. We never use the default token anyway.
2. **The Mapbox username never has to be typed.** `GET https://api.mapbox.com/tokens/v2?access_token=<sk>` returns `{code:"TokenValid", token:{usage:"sk", user:"ventura86", authorization:"…"}}`.
3. **Mapbox has no way to pre-fill a token through the URL.** Neither the Console nor the docs offer one. The workaround is for Claude to tick the scopes in Chrome (with your permission). The human then copies the value, which is shown only once, and pastes it into the app.
4. **USGS approval can be detected automatically.** The M2M API has a `permissions` endpoint ("Returns a list of user permissions for the authenticated user"). It also has `tram-order-search` and `tram-order-status` (these need the MACHINE role), which may let us detect on-demand scan orders without asking the admin.
   - Scene search works without the MACHINE role (callusgs), so harvesting Bucharest scenes can start before download approval arrives.
   - The exact values `permissions` returns are unverified. Check them on the first real token.
5. **The USGS application token is shown for only 60 seconds** (USGS PDF). The wizard must open the paste box first, then the ERS page side by side, and show a countdown.
6. **The EarthExplorer deep link format is verified.** `https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/` returns 200 with the title "Full Display of DS009013039DV181".
   - The datasetId for `corona2` is `5e839febdccb64b3`.
   - The datasetIds for `declassii` and `declassiii` must be read at runtime from `dataset-search` (field `datasetId`).
7. **The Blaze upgrade deep link is verified** in the firebase-tools source: `https://console.firebase.google.com/project/${projectId}/usage/details`.
8. **The admin needs no Firebase config file.** On Firebase Hosting, `fetch('/__/firebase/init.json')` returns the project config.
9. **GitHub needs no input.** `gh` is already authenticated as ventura8 with `repo` and `workflow` scopes. Claude can do the Pages switch, workflows, variables and the WIF identifiers.
   - With Blaze and Cloud Run, no GitHub token is needed in the browser, so the fine-grained PAT goes away.
   - PAT URL pre-fill does exist (`settings/personal-access-tokens/new?name=&description=&expires_in=&actions=write`), but it is not needed.
10. **The Google sign-in provider cannot be enabled through the API alone.** `defaultSupportedIdpConfigs/google.com` needs an OAuth `clientId`/`clientSecret`. That means one console visit, which Claude can do in Chrome with your permission.
    - Authorized domains (including `localhost`, which new projects no longer include) and the email-link provider can both be set through the Identity Toolkit `updateConfig` API.
11. **gcloud and the firebase CLI are not installed.** Node 22, docker and gh are present.
    - Plan: a user-level gcloud install (needs one download approval) and `npx firebase-tools@15`.
12. **Three old layers have no USGS source.** 1927 (Compagnie Aérienne Française), 1938 (Luftwaffe/NARA) and 1943 (SAAF) disappear under the "no fostulbucuresti" rule. The admin's "Upload a scan or GeoTIFF" path covers them only if you obtain the originals. **This is your decision to make.**
13. **Cloud Shell gives no shortcut for self-hosters.** "Open in Cloud Shell" for a non-Google repo opens a temporary environment **without** the user's credentials, so it is no better than a local `npx` bootstrap.

## 1. Every human touchpoint and what removes it

Legend for "Who does it after the fix":

- **0**: fully automatic.
- **C**: Claude does it, either in a CLI or by driving Chrome, after one "yes" from you.
- **H**: the human must do it (an account, a password, a card, a secret paste, or accepting terms).

### 1A. Initial setup of this repo, done by Claude for the owner

| # | Touchpoint | Mechanism | Who does it after the fix |
| --- | --- | --- | --- |
| 1 | Install gcloud (user-level, no sudo) and firebase-tools (`npx`) | Claude, with one download approval | C |
| 2 | `gcloud auth login --update-adc` and `firebase login` | Human clicks Allow in the Google consent screen. Try ADC reuse in firebase-tools so only one consent is needed (unverified). | H (1–2 clicks) |
| 3 | Accept Google Cloud and Firebase Terms (first time only) | Acceptance is per account. Detected from the `projects:create` / `addfirebase` error. | H (1 click, only if prompted) |
| 4 | Project ID, display name | Generated: `bucuresti-disparut-<rand4>` | 0 |
| 5 | Billing account and card | **Prohibited for Claude.** Deep links: `console.cloud.google.com/billing` (verified page; the `/billing/create` path is unverified because it sits behind login). | H (~3 min) |
| 6 | Link billing to the project | If `gcloud billing accounts list --filter=open=true` returns exactly one account, ask "link X?" and run `gcloud billing projects link`. Detect with `gcloud beta billing projects describe` returning `billingEnabled: true`. | C (one yes) |
| 7 | Budget alert | Budget API `POST billingbudgets.googleapis.com/v1/billingAccounts/{id}/budgets`, scoped to the project. Default €10/month with thresholds at 50/90/100% plus forecasted 100%. Single-project budgets are allowed for project owners. | C (confirm amount) |
| 8 | Enable APIs; Firestore `eur3`; default bucket in `us-central1` plus CORS; Hosting site | gcloud / firebase-tools / REST | 0 |
| 9 | Auth: authorized domains, email-link provider | Identity Toolkit `updateConfig` | 0 |
| 10 | Auth: Google provider and support email | `console.firebase.google.com/project/<id>/authentication/providers` (standard path; verify) | C (Chrome, one yes) |
| 11 | CI identity | WIF pool and provider via gcloud; `gh variable set` for the identifiers. No keys, so the org-policy key ban does not matter. | 0 |
| 12 | Deploy functions, rules, hosting and the Cloud Run Job image (Cloud Build) | Scripted and idempotent (`bootstrap` / `doctor`) | 0 |
| 13 | Owner admin | Bootstrap writes `setup/owner` from `gcloud config get account`. The first Google sign-in gets the admin claim. | H (1 click) |
| 14 | City config | Center and zoom are taken from the old `index.html` (`[26.085298, 44.427037]`, z15). The bbox comes from Nominatim (Bucharest relation). RO/EN names come from Wikidata. Seed colour is a default. | 0 |
| 15 | Photo migration (44 points and 34 cones) | Script steps (details below the table) | 0 (plus an optional review filter) |
| 16 | Remove all fostulbucuresti tokens, style and tilesets | Codemod | 0 |
| 17 | Mapbox: billing address and card (ventura86 is blocked on "confirm billing information") | **Card: H only. Address: personal data, so the human enters it.** | H (~3 min) |
| 18 | Mapbox: usage alert thresholds | `https://console.mapbox.com/account/settings/usage-thresholds` (verified in the docs) | C (Chrome, one yes) |
| 19 | Mapbox: create the secret token | Claude ticks the scopes in Chrome (see 2B). The human copies the value and pastes it into Admin › Integrations. | C + H (1 paste) |
| 20 | Mapbox public token | Minted automatically through the Tokens API, with allowedUrls computed from config | 0 |
| 21 | USGS: ERS registration and email verification | **Account creation, so H only.** The wizard provides suggested answers for the questionnaire. | H (~5 min) |
| 22 | USGS: M2M access request | Pre-written justification. Claude can fill and submit it on your logged-in session with explicit approval. | C/H |
| 23 | USGS: application token | 60-second window, so H must paste it | H (1 paste plus the username) |
| 24 | SonarQube Cloud | Sign in with GitHub (H, OAuth). Claude imports the repo in Chrome. Generating `SONAR_TOKEN` and pasting it into `gh secret set SONAR_TOKEN` (or the repo's `/settings/secrets/actions/new`) is H. | H (1 OAuth + 1 paste) |
| 25 | Custom domain | None in v1 (stays on `ventura8.github.io`) | 0 |

Photo migration steps (row 15):

- Rewrite the 33 `http://fostulbucuresti.github.io/...` URLs to local files. All 44 exist.
- Link each cone polygon to its point by the shared `photo` URL.
- Normalise years: 25 are blank; take them from filenames (for example "Arionoaia 1978.jpg") and parse values like `"Iulie 1936"` to 1936.
- Convert `Ferdinand.png` (29.5 MB) to WebP and keep the original in Storage.
- Records still missing a year or author (13 have no author) get a "Needs review" chip instead of blocking.

**Owner's total input:** about 15–20 minutes of human-only actions (cards ×2, ERS account, OAuth consents, 3 pastes), plus about 6 one-word approvals. Everything else is automatic or done by Claude.

### 1B. A new city admin, starting from the starter kit

The draft assumes every city self-hosts the full stack, which means 3 accounts and 2 cards. Recommendation: offer three tiers, with Tier A as the default.

| Tier | Human input | Mechanism |
| --- | --- | --- |
| **A. Invited city on the shared instance (default)** | The owner types one email. The invitee clicks one link, types one city name, and clicks "Import recommended". | Details below the table |
| **B. Self-host the full stack** | Same as §1A rows 2, 3, 5, 17, 19, 21, 23 (two cards, three pastes) | Details below the table |
| **C. Static export (no backend)** | Zero accounts if tilesets are public | Details below the table |

How each tier works:

- **Tier A.** Uses the existing `cities/{cityId}` model.
  - The owner's admin calls `sendSignInLinkToEmail` (the email-link provider). The Firebase-sent sign-in email is the invitation, so no SMTP or secrets are needed.
  - City creation: Nominatim autocomplete gives the bbox and center. Wikidata gives the RO/EN names. A Wikipedia intro becomes the About draft (editable).
  - A USGS harvest runs automatically with the shared credentials.
  - The public URL is created automatically at `https://<proj>.web.app/c/<city>/`.
  - Optional own repo, using a verified GitHub link: `https://github.com/new?owner=@me&name=<city>-disparut&template_owner=ventura8&template_name=historic-city-starter`. `config.js` only needs `{cityId, manifestUrl}`, and the admin offers it as a one-click download.
  - **Open decision for you:** a per-city quota (number of tilesets, storage GB), because the owner pays.
- **Tier B.** Runs `npx create-historic-city` (local, not Cloud Shell; see §0.13), which goes through wizards 2A, 2B and 2C. Same idempotent `doctor` command.
- **Tier C.** "Export city" produces `manifest.json` plus photos, ready for any static host.
  - Set tilesets to `private:false`, which any token can read, so an exported city can use any Mapbox `pk`.
  - The engine reads the inline manifest.

### 1C. Day-to-day use

Cases marked **(rare)** have a fallback that only applies when the main path fails.

| Flow | Unavoidable input | Automated / pre-filled / detected |
| --- | --- | --- |
| **Add photo** | Dropping the files. Placing the pin (historic scans rarely carry GPS). | Converted to WebP 2048 px plus a 400 px thumbnail, with sha256 deduplication. |
| | | EXIF GPS, date and direction are used when present. |
| | | EXIF date is ignored when it is later than the year in the filename (it is the scan date). |
| | | Year is taken from the filename or title with a regex. |
| | | RO title comes from the cleaned-up filename. |
| | | Location guess: geocode street names in the title with Nominatim (OpenHistoricalMap as an optional fallback for demolished streets, unverified). Otherwise the last pin position. |
| | | Bearing: "click what the camera looked at" (one click computes the bearing) instead of rotating a handle. Default FOV 60°. |
| | | Author, source and licence stay sticky across a batch. |
| | | **Published on save** with an Unpublish toggle (admins only, so drafts add clicks for no benefit). |
| **Layer from a free USGS scan** | One click, "Import" or "Import recommended" | Harvest runs on city creation and monthly (Declass-3 is still being ingested). Avoid the monthly Wednesday maintenance windows; parse the EROS notifications page. |
| | | Scenes are ranked by coverage, Bucharest's position near the frame centre, camera resolution and free versus paid. One recommendation per date. |
| | | Labels come from `Acquisition Date` plus the camera ("KH-4A Corona, 1966-07-12"). Attribution: "USGS EROS, declassified (public domain)". |
| | | maxzoom by camera (KH-4 16, KH-9 panoramic or KH-7 17, KH-9 mapping 15). Frames with the same date are mosaicked into one tileset to save hosting days. |
| | | Corner homography gives the first guess. Checkpoint RMSE then decides: auto-publish below a threshold, otherwise the layer goes to a review queue. |
| | | A cost estimate (MB and compute units against the free tier) is shown before importing. |
| **Buy and import an unscanned frame** | EarthExplorer login, add to basket, On-Demand order, pay USGS by card or phone (**Claude may not pay**) | Prepared for the admin: deep link per scene, copyable entity-ID list, recommended resolution (7 µm), total cost ($30 × n + $5). |
| | | Orderability is checked first (`options.order`). Some films are held only by NARA. |
| | | Clicking "Buy" records `orderIntent`, so no "I ordered it" button is needed (keep one as an optional override). |
| | | Detection: `tram-order-search` (unverified for declass orders), then a daily `download-options` check per watched scene until `available` turns true. That automatically creates the import job and sends a notification. |
| | | Reminders on day 7 and day 12 if the order is still unpaid or unavailable, because USGS deletes unpaid orders after 2 weeks. |
| **Re-align** | Dragging a few points, only when RMSE is high | Auto points are pre-loaded and coloured by residual. The worst point is highlighted. Snap to OSM intersections. Live preview. One-click re-run. |
| **Publish** | None | `manifest.json` is rebuilt automatically (debounced) on any write. A "Preview as visitor" link is provided. |
| **Credentials upkeep** | Paste again only on expiry or revocation | Scheduled daily health check: USGS `login-token` and `permissions`, Mapbox `tokens/v2` retrieve. Status chips. Reminder 14 days before a USGS token's expiry date. |
| **Notifications** | One "Allow notifications" click | An in-app inbox comes first. FCM web push comes later: the default VAPID key may fail on Chrome, so Claude generates the key pair in the console (it is a public key). |

## 2. Setup Assistant wizards in detail

The UI is one Setup page with a progress ring and three cards. Each step shows:

- a status chip (detected automatically),
- the reason for the step and its cost,
- an "Open page" deep link (new tab),
- "Do it for me" where a Claude or server action exists,
- a paste box with live verification,
- automatic advance once the step is detected.

The bootstrap and the app share one source of truth, `setup/status`, which holds no secrets. Secrets go only to Secret Manager through the `setup.*` callables.

### 2A. Google Cloud billing (Blaze) and budget

This runs in the bootstrap CLI for Bucharest and for Tier B. Inside the app it is only a health card.

| Step | Deep link | Pre-fill | Completion detection |
| --- | --- | --- | --- |
| A1 Sign in | `gcloud auth login --update-adc` | — | `gcloud auth list` has an active account. Owner email is captured. |
| A2 Terms | `https://console.firebase.google.com/` | — | `firebase projects:create` succeeds (a terms error means not accepted) |
| A3 Billing account | `https://console.cloud.google.com/billing` (verified docs page); `/billing/create` (unverified) | — (card is H) | Poll `gcloud billing accounts list --filter=open=true` |
| A4 Link (Blaze) | CLI link, or `https://console.firebase.google.com/project/<id>/usage/details` (verified) | Account preselected when there is only one | `gcloud beta billing projects describe <id>` returns `billingEnabled: true`; an API enable no longer returns a billing error |
| A5 Budget | Created through the API (no page) | €10, 50/90/100% plus forecast | Budget API `list`. The budget ID is stored in `setup/status`. |
| A6 Optional soft cap | Budget → Pub/Sub → function sets `setup/limits.pipelinePaused=true` | — | Do **not** disable billing, because Google warns resources may be deleted |

Inside the app, the GCP card is green whenever the `setup.status` callable answers, since Functions only run on Blaze. The budget details shown come from `setup/status`.

### 2B. Mapbox: account, payment and tokens

| Step | Deep link (verified unless noted) | Pre-fill | Detection |
| --- | --- | --- | --- |
| B1 Sign up (Tier B only) | `https://account.mapbox.com/auth/signup/` | — | **Impossible** until a token exists. The email confirmation link is valid for 24 hours. |
| B2 Exit demo (card and address) | `https://console.mapbox.com/` → "Add payment method" banner. No dedicated URL is documented. | Instruction: pick **Rotate token** | Indirect: B4 can only succeed after upgrading, since demo accounts cannot create tokens. Then `GET /tokens/v2/{user}` lists more than one token. |
| B3 Usage alerts | `https://console.mapbox.com/account/settings/usage-thresholds` | C ticks the thresholds | **Impossible** (no API); manual checkbox |
| B4 Secret token | `https://console.mapbox.com/account/access-tokens/` → Create a token | **No URL pre-fill exists.** C fills the name and ticks the scopes; the scope list is also shown as a copyable checklist. | — |
| B5 Paste and verify (callable) | — | — | Details below the table |
| B6 Auto-mint the public token | — | Details below the table | Details below the table |

B4 details:

- Name: `historic-map-server`.
- Scopes:
  - Public: `styles:read`, `styles:tiles`, `fonts:read`. These are required because a token can only mint scopes it holds itself.
  - Secret: `tilesets:read`, `tilesets:write`, `tilesets:list`, `tokens:read`, `tokens:write`.
- No URL restrictions.

B5 checks, in order:

1. `GET api.mapbox.com/tokens/v2?access_token=sk` must return `TokenValid` with `usage=sk`. The `user` field is saved as the username.
2. `GET /tokens/v2/{user}` (needs `tokens:read`): find this token's entry by `authorization` id and compare its scopes with the required set (matching logic to confirm). Missing scopes produce an exact message naming them.
3. Optionally, check `tilesets:list` with `GET /tilesets/v1/{user}?limit=1`.

B6 details:

- Request: `POST /tokens/v2/{user}` with `{note:"<city> public (auto)", scopes:[styles:read, styles:tiles, fonts:read], allowedUrls:[origins]}`.
- Origins are computed: the GitHub Pages origin `https://ventura8.github.io` (origin only, because the browser sends only the origin as Referer), `https://<proj>.web.app`, `https://<proj>.firebaseapp.com` and any custom domains. A **separate dev token** is minted for `http://localhost:<port>`.
- When config changes, the token is updated with `PATCH`.
- Success is the 201 response; the token is written to the city document and the manifest.

### 2C. USGS: account, M2M access, token and scan ordering

| Step | Deep link | Pre-fill | Detection |
| --- | --- | --- | --- |
| C1 Register | `https://ers.cr.usgs.gov/register` (live 200) | Copy block of suggested answers (individual, non-commercial historical research) | **Impossible.** "I registered" checkbox, or skip ahead because C5 proves it. |
| C2 Request M2M access | `https://ers.cr.usgs.gov/profile/access` (exists; 302 to login). ERS menu "Access Request". | Pre-written justification (below the table), with a copy button. C submits it in your session after a yes. | **Impossible** (no API). The app records the timestamp and shows an ETA of 24–48 business hours. |
| C3 Application token | `https://ers.cr.usgs.gov/password/appgenerate` (exists; 302 to login), the "Create Application Token" button on Profile Home | Name `historic-map-<city>`. No expiry, or one year plus a reminder. Tick "M2M API". **The paste box opens first and a 60-second countdown is shown.** | — |
| C4 Paste username and token | — | — | `login-token`. Parse JSON on any HTTP status: errors arrive as HTTP 500 JSON, and HTML 403 means invalid or expired. |
| C5 Approval check | — | — | `permissions` returns the role list. If downloads are not allowed, mark "Awaiting approval" and recheck every 6 h; it turns green automatically and notifies. Meanwhile run `dataset-search {"datasetName":"declass"}` to cache aliases and datasetIds, and start the bbox `scene-search` harvest, since search works without MACHINE. |
| C6 Buy a scan (per scene) | `https://earthexplorer.usgs.gov/scene/metadata/full/{datasetId}/{entityId}/` (verified pattern). EarthExplorer Item Basket → On-Demand → Start Order. | Entity list, 7 µm, total cost, support contacts (<custserv@usgs.gov>, 1-800-252-4547) | `tram-order-search` (unverified), then daily `download-options.available`. Payment itself is **impossible** to detect, except possibly through TRAM order status. |

C2 justification contents: datasets `corona2`, `declassii` and `declassiii`; the Bucharest bbox; non-commercial; a few scenes per month.

The C3 ordering problem is unresolved: it is unknown whether the "M2M API" scope can be ticked before access is approved. The wizard should try right after C2. If the checkbox is missing, it asks the admin to return after the USGS approval email and sends a reminder at about 2 business days.

## 3. What is essential for v1, what is over-engineered, and the delivery order

**Essential for v1:**

- Viewer engine: manifest, layers, timeline, opacity, photos and cones, RO/EN, Material 3 (M3) responsive.
- Photo migration.
- Auth with an admin allowlist.
- Photos CRUD with Storage and the `onUpload` derivatives.
- Manifest publisher.
- Integrations page (paste, verify, auto-mint the Mapbox public token, store the USGS token).
- USGS harvest and free import.
- Cloud Run GDAL job: fetch, crop, **corner homography plus manual GCP editor (OSM vector reference)**, poly2/TPS warp, checkpoint RMSE, MTS publish.
- Quality gates in CI from day 1: lint, unit, e2e with emulators and MSW fixtures for USGS and Mapbox, ≥90% coverage per file, Sonar.

**Over-engineered for v1, so defer:**

- Fully automatic GCPs (SIFT/LightGlue against Sentinel-2, AROSICS). This is research-grade work, success rates on 1960s film are low, and Sentinel-2 only gives about 10 m. Move to M4 as a "suggest points" helper.
- IIIF Level-0 tiles. Use a DZI from `vips dzsave` with OpenSeadragon instead.
- Swipe compare. It needs two Map objects, which doubles billed map loads.
- `assist.*` (Nominatim titles, Gemini translations).
- FCM push.
- Budget soft cap.
- PMTiles fallback.
- Separate `regeoref` and `republish` job types: merge them into one `process` job with stage flags.
- `gcps/{layerId}` as its own collection: store GCPs in the layer document (100 points is well under 1 MiB).
- `jobs.cancel` UI polish.
- Multi-city starter kit, jsDelivr semver releases and third-party wizard polish: all M5.

**Milestones**, each one shippable and green in CI:

- **M0, day 0. Start the slow human tasks first, in parallel (about 20 minutes of human time):**
  - USGS registration and M2M request (starts the 24–48 business-hour clock).
  - Mapbox address and card.
  - GCP billing account.
  - Claude meanwhile scaffolds the monorepo, CI, quality gates and WIF, and installs gcloud.
- **M1, week 1. Bucharest is live as a static site.**
  - Engine with the migrated photos and cones, served from repo or Pages, on a Mapbox Standard basemap. The public token is pasted once by the human into `gh variable set MAPBOX_PK`, and CI injects it at build time.
  - No historical layers yet; a "Layers coming soon" notice.
  - Master is replaced once you approve.
- **M2. Backend.**
  - Blaze, Firestore, Storage and Hosting admin.
  - Photos CRUD (the daily flow), with photos migrated to Storage.
  - Manifest publisher.
  - Integrations page: Mapbox auto-mint and USGS verification with automatic approval detection.
- **M3. First historical layers.**
  - Harvest and the recommended 1966 KH-4A, 1976/1977/1980 KH-9 panoramic and 1978 KH-9 mapping scenes, which are likely already scanned and free.
  - Cloud Run pipeline, manual GCP editor, MTS publishing.
- **M4. Purchases and assisted alignment.**
  - Buy-scan flow, `watchOrders`, automatic import on delivery. This must ship before a 3–4-week order arrives.
  - Auto-GCP suggestions, swipe compare, AI drafts.
- **M5. Multi-city.**
  - Tier A invitations and city wizard, Tier B bootstrap, Tier C export.
  - jsDelivr engine releases. Photos are not in the tree at release tags, so the 150 MB package limit is not an issue.

**Sources checked this session:**

- Mapbox: [demo access](https://docs.mapbox.com/accounts/guides/demo-access.md), [sign-up](https://docs.mapbox.com/accounts/guides/signup.md), [tokens guide](https://docs.mapbox.com/accounts/guides/tokens.md), [Tokens API](https://docs.mapbox.com/api/accounts/tokens.md).
- GitHub: [PAT URL pre-fill](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [new-repo URL parameters](https://github.blog/changelog/2023-04-27-pre-fill-form-fields-when-creating-a-new-repo).
- Google Cloud: [Cloud Shell links](https://docs.cloud.google.com/shell/docs/open-in-cloud-shell), [link billing](https://docs.cloud.google.com/billing/docs/how-to/modify-project), [verify billing](https://docs.cloud.google.com/billing/docs/how-to/verify-billing-enabled), [Budget API](https://docs.cloud.google.com/billing/docs/how-to/budget-api).
- Firebase: [Hosting reserved URLs](https://firebase.google.com/docs/hosting/reserved-urls), [FCM GetTokenOptions](https://firebase.google.com/docs/reference/js/messaging.gettokenoptions), [Identity Toolkit defaultSupportedIdpConfigs](https://docs.cloud.google.com/identity-platform/docs/reference/rest/v2/projects.defaultSupportedIdpConfigs), [firebase-tools ensureApiEnabled.ts](https://github.com/firebase/firebase-tools/blob/master/src/ensureApiEnabled.ts).
- USGS: [callusgs api.py](https://github.com/Florian-Katerndahl/callusgs/blob/main/callusgs/api.py), [usgsxplore](https://pypi.org/project/usgsxplore/), [M2M Application Token PDF](https://www.usgs.gov/media/files/m2m-application-token-documentation).
- Live curl probes: ERS register, profile/access and password/appgenerate; the EarthExplorer scene metadata URL.

### Critical Files for Implementation

- /home/sergiu-alexandrescu/.claude/plans/i-want-us-to-vivid-ullman.md: the draft to amend (Setup Assistant, milestones, deferrals).
- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/geojson/photos.json: migration source (URL rewrite, linking cones to points, year parsing).
- /home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/index.html: center and zoom, old layer dates and attributions, and the fostulbucuresti references to remove.
- /tmp/claude-1000/-home-sergiu-alexandrescu-Projects-bucurestiuldisparut-github-io/bcb523ba-b76b-40f0-a1d6-8fa274148f48/scratchpad/research.json: the USGS, Mapbox and Firebase facts and corrections the wizards depend on.
- To be created: `infra/bootstrap` (idempotent `doctor` CLI for wizard 2A), `functions/src/setup/*` (Mapbox and USGS verify, mint and health checks), `packages/admin/src/setup/` (wizard UI and `setup/status` schema).
