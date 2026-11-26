# M2b interfaces: the admin app's contracts the parallel agents build on

Written on 2026-10-12 by the M2b contracts agent, alone in the tree before the admin workstreams start in parallel.
Read it together with `PLAN.md` (Addendum 1: every human step happens inside the Setup Assistant, billing and
provisioning from the browser with the admin's own Google token; Addendum 2: GA4 behind consent and Cloud Error
Reporting; Addendum 3: edit anything), `design-review-onboarding.md` (the wizards of §2, the verified deep links, the
60 s USGS token, the Mapbox token scopes), `design-review-security-cost.md` (service accounts and roles §1.1, secrets
§1.2, App Check §1.6, CSP §1.8, Workload Identity Federation §2, the budget §3.4), `M2-interfaces.md` (the callables,
the Firestore model, the fakes and the change requests M2b takes over), `M1-interfaces.md` and `packages/ui/README.md`
(the Material 3 kit, the window classes).

Everything marked **done** exists and is tested (100 % lines and branches per file); everything else is a contract the
owning workstream implements exactly as written. A change to anything here goes through
[Change requests](#change-requests), never by editing another workstream's files. Nothing in M2b touches a real
Google, Mapbox or USGS endpoint, creates a cloud resource or deploys: the admin runs against the Firebase emulators
(project `demo-hcm`) and the fake upstreams of `@hcm/test-support`. Facts that could not be checked without a real
project are marked **UNVERIFIED**; each names how the first real run proves it.

## 0. What this contract decides

1. **Bootstrap mode** (§3.2). Cloud Functions need the Blaze plan and billing is itself a Setup step, so the first four
   steps run with no deployed function and no Firestore access: Firebase Auth's Google sign-in (works on Spark), then
   Google REST APIs called from the browser with the owner's own OAuth token, step state in memory and
   `sessionStorage` (never a token, an address or a secret). The admin decides between bootstrap and normal mode with a
   probe of `admin.session` before sign-in, and the owner check with Resource Manager after it.
2. **The automatic owner claim** (§3.3 d2). As soon as every registry function is deployed and the server answers, the
   app calls `admin.claim` with the Google token it already holds (no click), refreshes the ID token, creates the city,
   records the bootstrap results with `setup.recordCloud` and switches to normal mode. Without a live token it costs
   one click (a browser opens a popup only from a click).
3. **Incremental Google scopes** (§2): read-only Cloud at sign-in in bootstrap mode, `cloud-billing` for billing,
   `cloud-platform` for provisioning, `analytics.edit` for the GA4 stream setting, none for daily use; each requested
   with `GoogleAuthProvider.addScope` only when its step runs, kept in memory for at most an hour.
4. **The $5 budget** is created in step (b) with e-mail alerts; its Pub/Sub notification is attached in step (c), once
   the Pub/Sub API (a billed API) is enabled and the `budget` topic exists (§3.3 b, §3.4 item `budget-alerts`).
5. **Two doctor items join** `PROVISION_ITEMS` (**done**): `crash-alerts` (a Cloud Monitoring e-mail channel and a
   log-based alert policy for new crash reports) and `api-key` (the browser API key's referrer restriction).
6. **The city document** is created by a new callable `setup.createCity` right after the claim (CR-M2b-1): the rules
   never let a client create a city, and `setup.saveMapbox` needs the city.
7. **The legacy import uploads the originals** (`seed/bucharest/photos/`), not the 1600 px seed derivatives, through
   the normal photo pipeline (§3.3 h): `photos.onUpload` makes the 2048 px and 400 px WebP files, and the originals the
   rights review may need stay private. A deviation from the brief, which said "derivatives"; recorded in
   `DECISIONS-for-review.md` §23d.
8. **The admin's texts** are two catalogues in `@hcm/shared` (**done**), `admin-shell` and `admin-setup`, kept out of
   the viewer bundle like the API catalogue; Lit elements in `packages/ui/src/admin/**` read them, and `packages/admin`
   (DOM-free logic) shares their key types.
9. **Contract code** (**done**): `packages/admin/src/google/scopes.ts` (the scopes), `packages/admin/src/setup/steps.ts`
   (the step graph and the input budgets), `packages/admin/src/routing/routes.ts` (the hash routes).
10. **The e2e admin tier** replaces only Google's consent popup with a stand-in page of the mock APIs and simulates "not
    deployed yet" at the network edge; everything owned runs for real against the emulators (§6).

## 1. Admin information architecture

### 1.1 Routes

Hash routes (`packages/admin/src/routing/routes.ts`, **done**): `#/<route>` plus at most two id segments of
`^[A-Za-z0-9_-]{1,64}$`. Hash routing needs no Hosting rewrite and keeps one `index.html`.

| Route | Addresses | Page | Needs the server | Icon | Built in | Scenarios |
| --- | --- | --- | --- | --- | --- | --- |
| `setup` | `#/setup`, `#/setup/<step>` (a `SETUP_STEPS` id opens that step) | Setup Assistant (§3) | no | `checklist` | M2b, setup-ui | A03–A07, A22, A25–A28, A30 |
| `photos` | `#/photos`, `#/photos/<photoId>` | photo list and editor | yes | `photo_library` | M2c | A08–A10 |
| `pois` | `#/pois`, `#/pois/<poiId>` | points of interest and their categories | yes | `place` | M2c | Addendum 3 rows |
| `layers` | `#/layers`, `#/layers/<layerId>` | historical layers (imagery search in M3) | yes | `layers` | M2c, M3 | A11–A17 |
| `jobs` | `#/jobs`, `#/jobs/<jobId>` | raster jobs | yes | `pending_actions` | M3 | A18 |
| `settings` | `#/settings` | city settings | yes | `settings` | M2c | A19 |
| `admins` | `#/admins` | admins and invitations (`admins.list`, `invite`, `revoke`) | yes | `group` | M2b, admin-shell | A02 |
| `history` | `#/history/<entity>/<id>` (`HISTORY_ENTITIES`) | edit history and revert | yes | `history` | M2c | A23 |
| `crashes` | `#/crashes` | crash groups (`telemetry.listGroups`) | yes | `bug_report` | M2b, setup-ui | A22 |

- `parseAdminRoute` returns null for anything that is not exactly a known route; the shell then opens
  `DEFAULT_ADMIN_ROUTE` (Setup) with the snackbar `adminShell.route.notFound` (S-A29-BAD-UNKNOWN-ROUTE).
- A route that needs the server, opened in bootstrap mode, opens Setup with `adminShell.route.needsBackend`
  (S-A25-BAD-PAGE-NEEDS-SERVER). A route whose page is not built yet (M2c) is left out of the navigation and opens Setup
  with `adminShell.route.notFound`; the shell's page registry (`registerAdminPage(id, load)`, admin-shell) imports each
  page lazily, so a later workstream adds a page without touching the shell.
- Signed out, the requested address is kept (`sessionStorage` key `hcm:admin:returnTo`, a route hash only) and opened
  after sign-in (S-A20-BAD-SIGNED-OUT-DEEP-LINK).
- While `setup.status` says `ready: false`, the first screen after sign-in is Setup, unless the address named another
  route.

### 1.2 Shell layout per window class

The shell host measures itself with `WindowClassController` (`packages/ui/src/layout/window-class.ts`); M3 rules: a
navigation bar on compact windows, a navigation rail from medium, the expanded rail (M3 Expressive's replacement of the
drawer) from large; never a drawer.

| Window class | Navigation | Top | Setup page |
| --- | --- | --- | --- |
| compact (below 600) | navigation bar at the bottom: Setup, Photos, Places, Layers, More (the rest in a modal bottom sheet) | small top app bar: page title, account button (language, theme, sign out) | one column of step cards; the open step expands in place |
| compact height (below 480: a landscape phone) | collapsed navigation rail on the leading edge instead of the bar (the bar would eat the height) | none; the account button sits at the rail's foot | one column |
| medium (600–839) | collapsed navigation rail, every destination (icon with its label below) | top app bar | one column, wider cards |
| expanded (840–1199) | collapsed navigation rail | top app bar | list and detail: the step list under the progress ring, the open step beside it |
| large and extra-large (from 1200) | expanded navigation rail (labels beside the icons, not modal) | top app bar | list and detail, the detail pane at most 840 px wide |

- In bootstrap mode the navigation holds Setup only and a banner says `adminShell.bootstrap.banner`.
- Touch targets 48 px, safe areas, `dvh`, logical properties, focus order = visual order, the tour's layout checks
  (`data-layout-check`) on every floating control; the admin tour joins the tour tier with A21 (`ui_m3_adaptive_skill.md`).
- Elements (Lit, `hcm-` prefix, `packages/ui/src/admin/**`): admin-shell builds `hcm-admin-shell` (layout, navigation,
  top bar, banner, snackbar host), `hcm-admin-nav` (bar, rail and expanded rail from one list), `hcm-account-menu`,
  and under `auth/` `hcm-sign-in`, `hcm-consent-note` (the inline explanation before a Google popup, §2.4),
  `hcm-claim-panel`, `hcm-join-panel`, `hcm-blocked-panel` (not owner, not admin, server down, configuration missing);
  setup-ui builds `hcm-setup-page`, `hcm-setup-step` and one body per step (`hcm-setup-billing`, `hcm-setup-provision`
  with the doctor list, `hcm-setup-deploy`, `hcm-setup-mapbox`, `hcm-setup-usgs` with the countdown,
  `hcm-setup-analytics`, `hcm-setup-import`) and `hcm-crash-groups` (the panel and the `#/crashes` page).

### 1.3 Auth states

`AdminAuthState` (admin-shell, `packages/admin/src/auth/`), one value at a time:

| State | Entered when | Screen | Leaves to |
| --- | --- | --- | --- |
| `starting` | the page loads | loading indicator | `configMissing`, `signedOut`, `probing` |
| `configMissing` | `/__/firebase/init.json` is unreadable or fails its schema | blocked panel, `adminShell.config.missing`, Reload | (reload) |
| `signedOut` | no Firebase user; sign-out; the session was revoked | sign-in panel (with `adminShell.session.expired` after a revocation) | `signingIn` |
| `signingIn` | the sign-in click opened Google's popup | `adminShell.auth.signingIn` | `probing`; `signedOut` with `popupClosed` or `popupBlocked` |
| `probing` | a Firebase user exists | loading indicator | every state below |
| `bootstrap` | the server did not answer and the account owns the project (§3.2) | Setup in bootstrap mode | `claiming` once the server answers |
| `notOwner` | the server did not answer, the account does not own the project and Cloud Functions was never enabled | blocked panel, `adminShell.auth.notOwner`, Sign out | `signedOut` |
| `backendDown` | the server did not answer, the account does not own the project, Cloud Functions is enabled (a set-up map whose server is down) | blocked panel, `adminShell.backend.down`, Try again | `probing` |
| `claimPending` | `admin.session` says `ownerClaimed: false` and no live Google token satisfies `cloudReadOnly` | claim panel: one click (`adminShell.auth.claimAction`) | `claiming` |
| `claiming` | `admin.claim` is running (automatic after the deployment, or the click) | `adminShell.auth.claiming` | `admin`; `claimPending` with the error |
| `joinPending` | `admin.session` says `invitePending` | join panel | `admin` |
| `notAdmin` | the map has an owner and no invitation waits | blocked panel, `adminShell.auth.notAdmin`, then sign-out (S-A01-BAD-STRANGER) | `signedOut` |
| `admin` | `admin.session` says `admin` and `claim` | the shell in normal mode | `signedOut`, `backendDown` |
| `visitor` | M13: on `#/contribute/<city>`, `admin.session` says the map has an owner and the account is no admin | the Contribute page, no navigation | `signedOut` |
| `contributeClosed` | M13: on `#/contribute/<city>`, a start-up deploy's map or `ownerClaimed: false` (`docs/research/M13-roles.md` §3; there a server that does not answer, or a refused session, is `backendDown` in a contributor's words) | blocked panel, `adminShell.welcome.closed`, Back to the map | `signedOut` |

### 1.4 Boot sequence

1. `fetch('/__/firebase/init.json')` (a Hosting reserved URL; the e2e admin server answers it with the `demo-hcm`
   emulator configuration) validated by `firebaseWebConfigSchema` (admin-shell, `packages/admin/src/app/config.ts`):
   `projectId`, `appId`, `apiKey`, `authDomain`, `messagingSenderId` (the project number), optional `storageBucket` and
   `measurementId`. Failure: `configMissing`. The web configuration is never committed.
2. `fetch('/runtime.json')`, optional (a 404 means none): `{release, appCheckSiteKey?}`, written by the deploy
   (`DECISIONS-for-review.md` §23b). No site key: no App Check (bootstrap mode, the e2e build, the first deploys).
3. `initializeApp(config)`; App Check with reCAPTCHA Enterprise only when the site key exists. The `e2e` build mode
   connects Auth, Firestore, Storage and Functions to the emulators (that branch is unit-tested too).
4. **Probe**, before sign-in: `httpsCallable(functions, 'admin-session', {timeout: 10_000})({})`. A deployed callable
   answers an anonymous call with `unauthenticated` (its access rule) through CORS; any `FunctionsError` other than
   `internal`, `unavailable`, `deadline-exceeded` or `not-found` means the server answers. A missing function's 404 has
   no CORS headers, which the SDK reports as `internal`, the same as a network failure: the probe alone cannot tell "not
   deployed" from "down", so §3.2 asks Google. A probe that timed out (`deadline-exceeded`) is sent again, up to three
   in all (`PROBE_ATTEMPTS`, `docs/LESSONS.md` 120): a cold start slower than the timeout answers the next one. A server
   that only times out corrects itself later: an owner lands in bootstrap mode, whose step (d) finds every function
   `ACTIVE` and probes again; anyone else sees Try again.
5. `onAuthStateChanged`: no user, `signedOut`; a user, `probing`: the server answers, `admin.session` (M2 flows); it
   does not, the bootstrap classification of §3.2.
6. The route (§1.1).

### 1.5 Session expiry

- **Firebase ID token** (an hour): the SDK refreshes it silently; callables and Firestore keep working (S-A20-HAPPY).
  `refreshToken: true` from `admin.session`, `admin.claim` or `admin.join`: `getIdToken(true)` once, then
  `admin.session` again (S-A01-BAD-CLAIM-DELAY).
- **Revocation**: a callable answering `apiError.notAdmin`, or Firestore `permission-denied` on an admin read, makes
  the shell ask `admin.session` again; not an admin any more: `notAdmin`. A revoked refresh token
  (`auth/user-token-expired`): `signedOut` with `adminShell.session.expired` (S-A20-BAD-ADMIN-REMOVED).
- **Google access token** (an hour, memory only, §2.3): a step checks that the token it needs has at least five
  minutes left before it starts a batch of calls; otherwise, or after a Google 401 mid-run, the token is dropped, the
  step stops where it is and shows `adminShell.session.googleExpired` with Continue (one click, one consent); the
  provisioner and the import resume idempotently (S-A04-BAD-TOKEN-EXPIRED-MID-RUN).
- **Hidden tab**: every poll pauses (`visibilitychange`) and the detections run again when the tab shows.
- **Sign-out**: `signOut(auth)`, every Google token dropped, every `sessionStorage` key `hcm:admin:*` removed, then
  `signedOut`.

### 1.6 Texts, language and icons

- The catalogues (**done**): `packages/shared/src/i18n/admin-shell/` (`translateAdminShell`, keys `adminShell.*`,
  owned by admin-shell) and `packages/shared/src/i18n/admin-setup/` (`translateAdminSetup`, keys `adminSetup.*`, owned
  by setup-ui), plus the API catalogue for callable errors (`translateApiError`). Romanian is the key source, English is
  typed against it, the `i18n` gate checks both folders; a step title is `adminSetup.step.<SETUP_STEPS id>`, a doctor
  item `adminSetup.provision.item.<PROVISION_ITEMS id>` (both pinned by `packages/shared/test/i18n-admin.test.ts`).
  A workstream adds keys only to its own catalogue; a message used by both is a change request to the owner.
- Language: `?lang=en` (any of the interface's 25 languages since 2026-11-12, `docs/I18N.md`), then the stored choice
  (`localStorage` `hcm:admin:lang`), then the browser's language, then Romanian; switching keeps form state (A21);
  `<html lang>` and `dir` follow it; a language beyond Romanian and English is fetched first (`/admin/i18n/<locale>.json`).
- Icons: the navigation and setup icons (`checklist`, `pending_actions`, `group`, `history`, `bug_report`,
  `check_circle`, `schedule`, `credit_card`, `cloud`, `key`, `content_copy`, `content_paste`, `timer`, `upload`,
  `account_circle`, `logout`, `info`) are not in `UI_ICONS` yet. admin-shell owns `packages/ui/src/icons.ts` and the
  font subset in M2b and adds them all in its first change; setup-ui asks admin-shell for any other. Recommended:
  a second subset for the admin (`material-symbols-rounded-admin.woff2`, registered only by the admin), so the
  visitors' icon font does not grow (`DECISIONS-for-review.md` §23f).

### 1.7 The mount seam

`packages/admin` holds DOM-free logic, tested in Node; the Lit elements live in `packages/ui/src/admin/**` (Vitest
browser mode exists only for `packages/ui` until `DECISIONS-for-review.md` §9 is approved). The seam:

```ts
// packages/admin/src/app/mount.ts (admin-shell)
export interface AdminDeps {
    readonly config: FirebaseWebConfig; // §1.4 step 1
    readonly runtime: AdminRuntime; // §1.4 step 2
    readonly project: ProjectConfig; // infra/project.json, §3.7
    readonly firebase: FirebasePorts; // auth, callables, firestore, storage (adapters in packages/admin/src/firebase/)
    readonly google: GoogleAuthPort; // §2.2; the e2e build swaps only this port (§2.6)
    readonly fetch: typeof fetch; // the Google REST clients' transport
    readonly clock: Clock; // polls, countdowns, token expiry
    readonly session: KeyValueStore; // sessionStorage, try/catch inside
    readonly local: KeyValueStore; // localStorage (the language only)
    readonly location: HashLocation; // read, write and listen to the hash
    readonly log: Logger; // createLogger('admin', ...)
}

export interface AdminApp {
    readonly state: AdminState; // {auth, mode: 'bootstrap' | 'normal', route, locale, setup}
    subscribe(listener: (state: AdminState) => void): () => void;
    readonly intents: AdminIntents; // signIn, signOut, navigate, setLocale, retry, setup.* (setup-ui)
}

export function mount(deps: AdminDeps): AdminApp;
```

- The entry `packages/admin/src/index.ts` (admin-shell) builds the real ports, registers the elements with
  `defineAdminElements()` from the new `@hcm/ui/admin` entry (`packages/ui/package.json` `exports["./admin"]`,
  admin-shell), mounts, and hands the `AdminApp` to `<hcm-admin-shell>`; the viewer never imports `@hcm/ui/admin`.
- `packages/ui` cannot import `@hcm/admin` (layering), so the elements read a mirrored structural port, as the viewer
  does (`packages/ui/src/viewer/store-port.ts`): `packages/ui/src/admin/admin-port.ts` (admin-shell) and
  `packages/ui/src/admin/setup/setup-port.ts` (setup-ui); a type test in `packages/admin/test/` proves the real
  `AdminApp` satisfies both.
- The Firebase JS SDK (`firebase` 13.0.0, the engine's pin) is imported only by `packages/admin/src/firebase/**`
  adapters and the entry; the Google REST clients use `fetch` only (proposed gate: `DECISIONS-for-review.md` §23a).

## 2. Google OAuth

### 2.1 Scopes per step

`GOOGLE_SCOPES` (**done**, `packages/admin/src/google/scopes.ts`); `unsatisfiedScopes(granted, needed)` treats
`cloud-platform` as satisfying the read-only and billing Cloud scopes, never `analytics.edit`.

| When | Scope | Asked by | Used for |
| --- | --- | --- | --- |
| (a) sign-in, bootstrap mode | `cloud-platform.read-only` (`CLAIM_OAUTH_SCOPE`) | the Sign in click, only when the probe got no answer | Resource Manager v3 `projects/{id}:testIamPermissions` (`OWNER_PERMISSION`); Service Usage reads of `services/{api}` |
| (b) billing and budget | `cloud-billing`; `cloud-platform` instead when Cloud Billing or the Budget API is disabled and must be enabled first | the Link billing click | Cloud Billing v1 `billingAccounts`, `projects/{id}/billingInfo` (get, update); Budget API v1 `billingAccounts/{a}/budgets` (list, create, patch) |
| (c) provisioning, and Re-check of the billing or provisioning card in normal mode | `cloud-platform` | the Prepare the project click, the Re-check click | every API of §3.4 |
| (d) deployment | the (c) token | nothing (automatic) | Cloud Functions v2 `functions` list |
| (d2) owner claim | the (c) token, or `cloud-platform.read-only` when it is gone | nothing, or the claim click | sent once to `admin.claim` |
| (g) GA4 stream setting; the crash e-mail switch | `analytics.edit`; `cloud-platform` | their clicks | Analytics Admin `enhancedMeasurementSettings`; Monitoring `alertPolicies` |
| claim by a returning owner (normal mode, `ownerClaimed: false`) | `cloud-platform.read-only` | the claim click | `admin.claim` (S-A01-HAPPY) |
| daily use | none (the sign-in's `openid`, `email`, `profile`) | | |

### 2.2 Asking for a scope

The `GoogleAuthPort` (admin-shell, `packages/admin/src/auth/google-auth.ts`):

```ts
export interface GoogleAccess {
    readonly token: string; // ya29.…, memory only
    readonly scopes: readonly string[]; // granted, from tokeninfo
    readonly expiresAt: number; // epoch ms
}

export interface GoogleAuthPort {
    /** Opens Google's popup; must be the first await of a click handler (popup blockers). */
    request(scope: GoogleScope | null, options: { readonly loginHint?: string }): Promise<GoogleAccess | null>;
}
```

Production implementation, with the Firebase Auth SDK:

```ts
const provider = new GoogleAuthProvider();
if (scope !== null) provider.addScope(GOOGLE_SCOPES[scope]);
provider.setCustomParameters({ include_granted_scopes: 'true', ...(loginHint ? { login_hint: loginHint } : {}) });
const result = auth.currentUser === null ? await signInWithPopup(auth, provider) : await reauthenticateWithPopup(auth.currentUser, provider);
const token = GoogleAuthProvider.credentialFromResult(result)?.accessToken; // never persisted by Firebase
```

- `include_granted_scopes` is Google's incremental authorization: the (c) token also carries the earlier grants.
  `login_hint` is the signed-in address, so a re-authentication skips the account chooser.
- The granted scopes and the lifetime come from tokeninfo (`POST https://oauth2.googleapis.com/tokeninfo` with
  `Authorization: Bearer`, as `admin.claim`'s adapter does): `unsatisfiedScopes` not empty means
  `adminShell.oauth.scopeDenied` (Google's granular consent lets the user untick a scope) and no API is called with the
  token; a different `email` means `adminShell.oauth.wrongAccount`. **UNVERIFIED**: that tokeninfo answers a browser
  with CORS headers; if it does not, the token is used as is and a Google 403 with reason
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT` maps to the same `scopeDenied`. `expiresAt` = now + `expires_in`, or now + 3540 s.
- A popup is opened only from a click: the consent note (§2.4) is inline text next to the button, never a dialog in
  between, so every consent costs exactly one in-app click.

### 2.3 Lifetime: memory only

- `GoogleAccessStore` (admin-shell) keeps at most one `GoogleAccess` per Firebase user in memory: never in Firestore,
  `localStorage`, `sessionStorage`, IndexedDB, a cookie, a URL, a log line or an error report (`createLogger` redacts
  `token` keys; `redactText` strips `ya29.`). It is dropped on sign-out, on a user change and on any Google 401.
- No refresh token exists in the browser (Firebase's popup gives none, and the admin never asks for offline access):
  renewing means the re-authentication popup, from the Continue button (§1.5). S-A27-BAD-TOKEN-NEVER-STORED searches
  every browser store and every request for the token after each step.

### 2.4 The consent note and Google's "unverified app" screen

Before each scope popup the step shows, inline, `hcm-consent-note` (admin-shell) with:

- why: `adminShell.oauth.why.<scope>` (with `{projectId}` or `{amount}`), and `adminShell.oauth.notKept`;
- for the Cloud and Analytics scopes: `adminShell.oauth.unverified` and `adminShell.oauth.unverifiedHow` (`{domain}`
  is the `authDomain`).

| Key | Romanian | English |
| --- | --- | --- |
| `adminShell.oauth.unverified` | Google poate spune că nu a verificat aplicația. E normal: aplicația este a proiectului tău. | Google may say that it has not verified this app. That is expected: the app belongs to your project. |
| `adminShell.oauth.unverifiedHow` | Atunci alege opțiunile avansate și continuă spre {domain}. | If so, open the advanced options and continue to {domain}. |
| `adminShell.oauth.notKept` | Permisiunea rămâne doar în această filă, cel mult o oră, și nu este salvată nicăieri. | The permission stays in this tab only, for at most an hour, and is never saved. |

Why Google shows it: `cloud-platform`, `cloud-platform.read-only`, `cloud-billing` and `analytics.edit` are
"sensitive" scopes, and the OAuth consent screen Firebase created with the Google provider (public name "București
dispărut") is not verified by Google; verification is pointless for a tool its own owner uses. Only the owner ever
sees these scopes; invited admins ask for none. **UNVERIFIED**, to check on the owner's first real sign-in (Claude,
with the user's yes): whether Google skips the screen for the project's own owner, and whether the consent screen's
publishing status is "Testing" (then only listed test users may consent, and the owner must be one; the doctor cannot
change it, the guide says where).

### 2.5 Failures

| Failure | Shown | Then |
| --- | --- | --- |
| `auth/popup-blocked` | `adminShell.oauth.popupBlocked` | Retry (a click) |
| `auth/popup-closed-by-user`, `auth/cancelled-popup-request` | `adminShell.oauth.popupClosed` | nothing changed; the button again |
| tokeninfo lacks the scope, or a 403 `ACCESS_TOKEN_SCOPE_INSUFFICIENT` | `adminShell.oauth.scopeDenied` with `{scope}` = `adminShell.oauth.scope.<name>` | nothing called; Retry asks again |
| `auth/user-mismatch` (re-authentication with another account) or another tokeninfo `email` | `adminShell.oauth.wrongAccount` | token dropped |
| `auth/network-request-failed` | `apiError.unavailable` | Retry |
| a Google 401 during a step | `adminShell.session.googleExpired` | Continue (§1.5) |

### 2.6 The e2e stand-in for Google's consent

Google's OAuth is an outside boundary, so the e2e tier mocks it and nothing else. The `e2e` build mode swaps the
`GoogleAuthPort` for `createStandInGoogleAuth` (admin-shell, unit-tested): it opens
`http://127.0.0.1:4311/__oauth/authorize?scope=…&login_hint=…&test=<id>` (a page of the mock APIs, admin-e2e) listing
the requested scopes as ticked checkboxes with Allow and Cancel. Allow posts `{idToken, accessToken, scope,
expiresIn}` to the opener (`postMessage`, origin-checked); `idToken` is the unsigned JSON the Auth emulator accepts
for Google (`{"sub", "email", "email_verified": true}`), and the admin signs in with
`signInWithCredential(auth, GoogleAuthProvider.credential(idToken, accessToken))` (or `reauthenticateWithCredential`).
The stand-in registers the issued access token as a `GoogleGrant` of the fake identity (the ticked scopes, the fixture
OAuth client, the chosen account) in the test's partition and in the shared partition `''`, because the Functions
emulator reaches the fakes without the test's id until CR-M2-22's forwarding lands (CR-M2b-3). The production port is
covered by unit tests over a fake of the Firebase Auth functions, never by e2e.

## 3. Bootstrap order and the Setup Assistant

### 3.1 Why the order matters

- Cloud Functions require Blaze; linking billing is step (b). So (a)–(d) must work with no deployed function.
- Firestore rules deny everyone who is not an admin, and only `admin.claim` (a function) makes an admin. So (a)–(d)
  never read or write Firestore or Storage.
- The App Check key is created in (c) and reaches the admin only with a deploy (§1.4). So bootstrap mode never
  initializes App Check, and the server runs App Check in `monitor` mode until a week after the admin ships it
  (`M2-interfaces.md` §3.0).
- What works on Spark: Firebase Hosting (the admin is deployed once by Claude, with the user's yes, PLAN Addendum 1),
  Firebase Auth with the Google provider, and Google REST APIs called with the user's own token.

### 3.2 Modes and what is kept where

- **Normal mode**: the probe got an answer. `admin.session` drives the M2 flows (claim, join, stranger, dashboard).
- **Bootstrap mode**: the probe got no answer. The sign-in asks for `cloudReadOnly`, then:
  1. Resource Manager `testIamPermissions` grants `OWNER_PERMISSION`: `bootstrap`.
  2. It does not, and Service Usage reports `cloudfunctions.googleapis.com` disabled (a map never set up): `notOwner`.
  3. It does not, and Cloud Functions is enabled (a set-up map whose server is down), or the check itself is
     unavailable: `backendDown`.
- In bootstrap mode the admin calls nothing of the backend but the probe: no Firestore, no Storage, no callable, no App
  Check (S-A25-HAPPY reads the recorded calls). It polls (d) and the probe.
- **The switch** (d2): every registry function `ACTIVE` and the probe answers, then `admin.claim`, `getIdToken(true)`,
  `admin.session`, `setup.createCity` (CR-M2b-1), `setup.recordCloud({billing, provision})` from the bootstrap
  record, `setup.status`; the bootstrap record is deleted; normal mode. From then on `setup/status` is the record.

The bootstrap record (setup-ui, `packages/admin/src/setup/bootstrap-record.ts`): `sessionStorage` key
`hcm:admin:bootstrap:<projectId>`, validated when read (a malformed or foreign record is dropped):

```ts
interface BootstrapRecord {
    readonly version: 1;
    readonly projectId: string;
    readonly updatedAt: string; // ISO 8601
    readonly steps: Partial<Record<'signIn' | 'billing' | 'provision' | 'deploy', StepHealth>>;
    readonly billing?: { readonly accountName?: string; readonly budgetId?: string; readonly budgetAmount?: number; readonly currency?: string };
    readonly provision?: { readonly items: readonly { readonly id: ProvisionItem; readonly state: ServiceState; readonly detail?: string; readonly params?: Readonly<Record<string, string>> }[] };
    readonly deploy?: { readonly ready: number; readonly total: number; readonly failed?: readonly string[] };
}
// StepHealth = {state: ServiceState, checkedAt: string, detail?: an apiError.*, adminShell.* or adminSetup.* key, params?}
```

Never in it: an access or ID token, an e-mail address, a secret, a billing account's display name.

### 3.3 The step graph

`SETUP_STEPS` and `SETUP_STEP_SPECS` (**done**, `packages/admin/src/setup/steps.ts`) hold the order, the prerequisites,
the scope, the area and the input budget of each step; `nextSetupStep(done)` is the step the page opens at.

| Step | Mode | Detection | Action | Human only | Inputs, consents | Records |
| --- | --- | --- | --- | --- | --- | --- |
| (a) `signIn` | bootstrap | probe; `testIamPermissions` | Sign in with Google (read-only Cloud scope) | the Google consent | 1, 1 | memory, bootstrap record |
| (b) `billing` | bootstrap | `billingInfo`, `billingAccounts`, budgets by name | link the account (Blaze), create the budget | a billing account with a card, on Google's page | 1, 1 (+1 to choose among several accounts) | bootstrap record, then `setup.recordCloud` |
| (c) `provision` | bootstrap | the doctor (§3.4) | plan, apply, doctor | consent; org-policy changes, if any | 1, 1 (+1 per retry) | bootstrap record, then `setup.recordCloud` |
| (d) `deploy` | bootstrap | Cloud Functions v2 list against the registry; the probe | none: explains the deploy | saying yes to Claude's deploy, or pushing to `master` | 0, 0 | bootstrap record |
| (d2) `claim` | switch | (d) ok and the probe answers | `admin.claim`, ID token refresh, `setup.createCity`, `setup.recordCloud` | nothing (or one click if the token is gone) | 0, 0 (+1, +1) | `setup/owner`, `admins/{uid}`, `cities/{city}`, `setup/status` |
| (e) `mapbox` | normal | `setup.status` `mapbox` | paste the secret token, Save: `setup.saveMapbox` | account, card, token creation on Mapbox's pages | 2, 0 | `setup/status.mapbox`, `cities/{city}.mapbox` |
| (f) `usgs` | normal | `setup.status` `usgs` | username, open the token page (countdown), paste: `setup.saveUsgs` | ERS account, M2M request, token creation on USGS's pages | 3, 0 | `setup/status.usgs` |
| (g) `analytics` | normal | `setup.analyticsConfig`; the stream setting; `telemetry.listGroups` | turn off history page views; crash e-mails switch | enabling Google Analytics and its terms on Google's page | 1, 1 | `setup/status.analytics`, the city, the stream |
| (h) `legacyImport` | normal | the photo documents by id and `legacyId` (and, since M5 §12, each photo's `history`) | Import the photos (57), or Import the missing photos (n) | nothing | 1, 0 | `cities/bucharest/photos/*` |

#### (a) Sign-in and ownership

- The probe got no answer, so the sign-in panel shows the consent note for `cloudReadOnly` and the button
  `adminShell.auth.signIn`; one click opens Google's popup with the read-only scope (`login_hint` empty the first time).
- Resource Manager v3 `POST https://cloudresourcemanager.googleapis.com/v3/projects/{projectId}:testIamPermissions`
  `{permissions: ['resourcemanager.projects.setIamPolicy']}`; then §3.2 decides `bootstrap`, `notOwner` or
  `backendDown`.
- Resource Manager disabled (`SERVICE_DISABLED`): the card says `apiError.cloud.apiDisabled` with `{api}` and offers
  "Enable with Google" (one click, `cloudPlatform`), which enables it with Service Usage and checks again. **UNVERIFIED**
  which APIs a new Firebase project has enabled; the fakes assume `SPARK_SERVICES` of `@hcm/test-support`.
- Scenarios: S-A25-HAPPY, S-A25-BAD-NOT-OWNER, S-A25-BAD-SERVER-DOWN, S-A27-HAPPY-UNVERIFIED-NOTICE.

#### (b) Billing and budget

- Before the click, the card states the cost (`adminSetup.billing.cost`, `adminSetup.billing.budget`) and the consent
  note. With the (a) token, Service Usage tells whether `cloudbilling.googleapis.com` and
  `billingbudgets.googleapis.com` are enabled; both can be enabled on Spark. If either is disabled, the popup asks
  `cloudPlatform` instead of `cloudBilling` and enables them first with `services:batchEnable` (the (c) step then needs
  no new consent).
- One click (`adminSetup.billing.link`), one popup, then in order:
  1. `GET https://cloudbilling.googleapis.com/v1/projects/{projectId}/billingInfo`: `billingEnabled` with an open
     account: nothing to link.
  2. `GET https://cloudbilling.googleapis.com/v1/billingAccounts`, the `open` ones: none, the card says
     `adminSetup.billing.noAccount` with the verified deep link `gcp.billingAccounts` (`packages/admin/src/setup/links.json`;
     the card is entered on Google's page), and lists the accounts every 10 s while the tab is visible, for 30 minutes,
     then offers Check again; when one appears the link proceeds (the click that started the step named the action).
     Several: a choice (`adminSetup.billing.chooseAccount`, one more input), the first open one preselected. One: it.
  3. `PUT https://cloudbilling.googleapis.com/v1/projects/{projectId}/billingInfo` `{billingAccountName}`: the project
     is on Blaze. Refusals: the account's project quota (`FAILED_PRECONDITION` naming the quota):
     `adminSetup.billing.quota`; 403: `apiError.cloud.permission` with `{role: 'roles/billing.user'}`; the deep link
     `gcp.blazeUpgrade` is the manual fallback.
  4. The budget: `GET https://billingbudgets.googleapis.com/v1/billingAccounts/{account}/budgets`; one named
     `historic-city-map <projectId>`: `PATCH` it to the spec (idempotent); none: `POST` it. Spec: `budgetFilter
     {projects: ['projects/<number>'], calendarPeriod: 'MONTH'}`; `amount.specifiedAmount` in the account's
     `currencyCode` (`BUDGET_AMOUNTS`, setup-ui: USD 5, EUR 5, GBP 4, RON 25, any other currency 5 units, shown on the
     card before the click); `thresholdRules` 0.5, 0.9 and 1.0 of current spend and 1.0 of forecasted spend;
     `notificationsRule {disableDefaultIamRecipients: false}` (e-mails to the billing admins). The Pub/Sub topic joins in
     (c) (`budget-alerts`). 403: `apiError.cloud.permission` with `{role: 'roles/billing.costsManager'}`, the link stays,
     Retry creates only the budget.
- Records: `billing` `{state, accountName, budgetId, budgetAmount, currency}` in the bootstrap record;
  `setup.recordCloud({billing: {state, budgetId, budgetAmount, currency}})` after the claim (`budgetId` matches
  `billingAccounts/<id>/budgets/<id>`, as `setupStatusDocSchema` requires).
- Scenarios: S-A04-HAPPY, S-A04-BAD-NOT-ENABLED, S-A04-BAD-SEVERAL-ACCOUNTS, S-A04-BAD-BILLING-QUOTA,
  S-A04-BAD-BUDGET-EXISTS, S-A04-BAD-BUDGET-PERMISSION, S-A04-BAD-API-PERMISSION.

#### (c) Provision cloud

- One click (`adminSetup.provision.run`), one popup (`cloudPlatform`), then the provisioner (§3.4) plans, applies in
  order and shows every `PROVISION_ITEMS` item with its state chip; `adminSetup.provision.retry` reruns only the items
  that are not `ok`. The `scheduler` item, whose job only the first deploy creates, is `pending` with
  `adminSetup.provision.afterDeploy` until (d) is done, then the doctor checks it.
- Records: `provision.items` in the bootstrap record; `setup.recordCloud({provision: {items}})` after the claim; in
  normal mode Re-check (one click, one consent) runs the doctor read-only and records it at once.
- Scenarios: S-A04-HAPPY-PROVISION, S-A04-BAD-PARTIAL-FAILURE, S-A04-BAD-ORG-POLICY, S-A04-BAD-TOKEN-EXPIRED-MID-RUN.

#### (d) The server's deployment

- Detection, with the (c) token: `GET https://cloudfunctions.googleapis.com/v2/projects/{projectId}/locations/us-central1/functions`
  (every page). Expected names: `deployedName(name)` of every `CALLABLES`, `HTTP_ENDPOINTS` and `BACKGROUND_FUNCTIONS`
  entry (32 today). All `ACTIVE`: `ok`; some: `pending` with `adminSetup.deploy.progress {ready, total}`; one
  `FAILED`: `invalid` with `adminSetup.deploy.failed {name}`; 403 `SERVICE_DISABLED`: `missing` (nothing deployed).
  Every 30 s while visible, for two hours. Then the probe must answer (a deployed but unreachable callable, for example
  an org policy refusing the `allUsers` invoker, is `invalid` with the fix of `DECISIONS-for-review.md` §23c).
- What the card says (`adminSetup.deploy.explain`): the server is installed by the `ci.yml` deploy job through
  Workload Identity Federation, or by Claude from the developer machine (`firebase deploy`, ask first). It shows the
  non-secret repository variables the `deploy-firebase` job reads, from the `workload-identity` item, with copy
  buttons: `GCP_WIF_PROVIDER` (`projects/<number>/locations/global/workloadIdentityPools/github/providers/site-master`),
  `GCP_DEPLOY_SA` (`gh-deployer@<projectId>.iam.gserviceaccount.com`), `GCP_PROJECT_ID` and `DEPLOY_ENABLED=true`;
  Claude sets them with `gh variable set` after the user's yes, one at a time.
- The token is older than an hour when the functions appear: Continue (§1.5).
- Scenarios: S-A26-HAPPY, S-A26-BAD-PARTIAL-DEPLOY.

#### (d2) The automatic owner claim

- When (d) is `ok` and the probe answers: a live token satisfying `cloudReadOnly` (the (c) `cloud-platform` token
  does) goes to `admin.claim` at once, no click; `refreshToken: true`, then `getIdToken(true)` and `admin.session`
  (`admin`). No live token (a reload, an hour): `claimPending`, one click, a read-only popup, the claim.
- Then, automatically: `setup.createCity` with the bundled city seed (`legacy/bucharest/city.json`, §3.3 h; idempotent),
  `setup.recordCloud` with the bootstrap record's billing and provisioning, `setup.status`; Setup opens at (e).
- Refusals: `apiError.claim.tokenMismatch` (the server checks the token's OAuth client against `HCM_OAUTH_CLIENT_IDS`,
  unset until `DECISIONS-for-review.md` §22a or CR-M2b-2 lands) and `apiError.claim.alreadyClaimed` show their message
  and leave the state at `claimPending` or `notAdmin`; `apiError.claim.notOwner` cannot follow a passed (a).
- Scenarios: S-A26-HAPPY, S-A26-BAD-TOKEN-GONE, S-A26-BAD-CLAIM-REFUSED, S-A01-HAPPY (the returning owner).

#### (e) Mapbox

- The M2 card (`M2-interfaces.md` §3.3, A05, A06): links `mapbox.signup`, `mapbox.console` (leaving the demo or trial
  plan: card and billing address on Mapbox's page; choose "Rotate token"), `mapbox.usageThresholds`,
  `mapbox.accessTokens`; the `MAPBOX_BOOTSTRAP_SCOPES` checklist with a copy button; the paste box (`type=password`,
  `autocomplete=off`, never in state or storage, cleared after the call), `classifyMapboxToken` live (a `pk.` is
  explained before any call); Save: `setup.saveMapbox({cityId, secretToken})`. Errors per M2 §3.3 and CR-M2-40.
- Inputs 2 (paste, Save). Scenarios: A05, A06.

#### (f) USGS

- Links `usgs.register` (with a copy block of suggested answers: individual, non-commercial historical research) and
  `usgs.accessRequest` (the pre-written M2M justification with a copy button: datasets `corona2`, `declassii`,
  `declassiii`, the city's bounding box, non-commercial, a few scenes a month); the human submits both on ERS.
- The token: the username field (one fill), then `adminSetup.usgs.openTokenPage` (one click) opens and focuses the
  paste box **first**, starts the 60 s countdown (`adminSetup.usgs.countdown`, the clock port), then opens
  `usgs.applicationToken` in a new tab. A paste with the username filled calls `setup.saveUsgs({username,
  applicationToken, expiresOn?})` at once (live verification, no Save click); the optional expiry date is one more
  input. The countdown ending with nothing pasted shows `adminSetup.usgs.expired`; the box stays open and the button
  starts again (ERS shows a token for about 60 s; a new one must be created). After saving: `pending` with
  `apiError.usgs.accessPending` and the next check (M2's `ops.tick`), green on approval.
- Inputs 3. Scenarios: A07, S-A07-HAPPY-COUNTDOWN, S-A07-BAD-COUNTDOWN-EXPIRED.

#### (g) Analytics and crash reports

- `setup.analyticsConfig({cityId})` when the card opens, and every 15 s for 15 minutes after the owner followed the
  deep link to enable Google Analytics (the GA terms are accepted on Google's page; the Firebase console's analytics
  integration page joins `links.json` only once verified by `contract.yml`).
- The GA4 stream setting (CR-M2-37): one click (`analyticsEdit`): the property and stream from Firebase Management
  `projects/{id}/analyticsDetails`, then Analytics Admin `PATCH
  properties/{property}/dataStreams/{stream}/enhancedMeasurementSettings?updateMask=pageChangesEnabled`
  `{pageChangesEnabled: false}` and a read-back; the card shows it checked. **UNVERIFIED**: the API version
  (`v1alpha` documents `enhancedMeasurementSettings`).
- Crash reports: the panel lists `telemetry.listGroups` (also the `#/crashes` page); the switch
  `adminSetup.analytics.crashEmails` turns the `crash-alerts` alert policy's `enabled` on or off (default on, created by
  (c)); it needs `cloudPlatform` (one click, one consent).
- Inputs 1 (the stream setting), consents 1. Scenarios: A22, S-A22-HAPPY-STREAM-SETTING, S-A22-BAD-NO-STREAM,
  S-A22-HAPPY-CRASH-ALERTS.

#### (h) The legacy Bucharest import

- Bundled by the admin build (admin-e2e owns `scripts/site/`'s admin target): `legacy/bucharest/city.json` (the city
  of `seed/bucharest/manifest.static.json`, for `setup.createCity`), `legacy/bucharest/photos.json`
  (`migrateLegacyPhotos` of `seed/bucharest/photos.legacy.geojson`: 45 records, each `{sourceFile, legacyId?, photo}`)
  and the referenced originals under `legacy/bucharest/originals/` (45 records, 46 MB including `Ferdinand.png`,
  29.5 MB, within the 60 MiB upload limit). Hosting serves them; they are fetched only by an import.
- One click (`adminSetup.import.action`), then per record, three at a time:
  1. The document id is the record's stable slug (`photo.id`); `getDoc`: done (`processing: 'done'` with an `image`):
     skip; `pending` or `failed` without an `image`: upload again (step 3); missing, and no other photo has the same
     `legacyId` (a `where('legacyId', '==', …)` query): create it.
  2. Create (`setDoc`, validated with `photoDocSchema` first, the fields of `CLIENT_WRITES.photo.create` only): title,
     description, links, year or `dateText`, author, `license: 'permission-legacy'`, `rightsReview: true`, `legacyId`,
     location, bearing, fov, `published: false`, `processing: 'pending'`, the stamp.
  3. Upload the original (`fetch` of the bundled file) to `STORAGE_PATHS.photoUpload(city, uid, id, '<nonce>.<ext>')`
     with `customMetadata.originalName`; `photos.onUpload` does the rest.
  4. Watch the document until `processing: 'done'`, then `published: true` (as the static site shows them today, the
     rights review flag kept), or `failed`, listed with its `processingError` (`adminSetup.import.failed`).
- Progress `adminSetup.import.progress`, end `adminSetup.import.done`. Idempotent by document id and `legacyId`; a
  closed tab resumes on the next click; an unused upload is deleted by the bucket's 7-day `uploads/` rule. The manifest
  lists the photos once Mapbox is set (`apiError.mapbox.notConfigured` keeps the last manifest before that).
- Inputs 1. Scenarios: S-A28-HAPPY, S-A28-BAD-RERUN-IDEMPOTENT, S-A28-BAD-RESUME, S-A28-BAD-PROCESSING-FAILED.

### 3.4 The provisioner

google-clients, `packages/admin/src/provision/`: `planProvision(project, observed)` (what each item lacks),
`applyProvision(plan, clients, onItem)` (creates or patches what is missing, item by item) and
`doctorProvision(project, clients)` (read-only, the same observations). Every item is
`{id, observe(), ensure()}` over the typed REST clients of `packages/admin/src/google/` (each a `fetch` with the token,
Google's error JSON mapped to `GoogleFailure`: `unauthorized`, `forbidden` with `role` or `api`
(`SERVICE_DISABLED`), `notFound`, `conflict` (`ALREADY_EXISTS`, an IAM etag `ABORTED`, retried three times),
`rateLimited`, `unavailable`, `invalid`, `orgPolicy` with `{constraint}`; long-running operations polled to `done`).
An item failing marks itself and every item that depends on it (`pending`, waiting) and the run goes on; a second run
writes nothing when everything is in place (S-A04-HAPPY-PROVISION counts the writes).

Execution order (the screen order is `PROVISION_ITEMS`):

| # | Item | Observe, then ensure |
| --- | --- | --- |
| 1 | `apis` | Service Usage `GET projects/{n}/services?filter=state:ENABLED`; `POST services:batchEnable` (at most 20 per call) of the APIs below |
| 2 | `org-policies` | Resource Manager v3 `GET projects/{id}`: no `parent`, no organisation, `ok`. Otherwise Org Policy v2 `projects/{id}/policies/{c}:getEffectivePolicy` for `iam.allowedPolicyMemberDomains`, `storage.publicAccessPrevention`, `iam.automaticIamGrantsForDefaultServiceAccounts`; read only, each finding steers a later item (table below) |
| 3 | `service-accounts` | IAM `POST projects/{id}/serviceAccounts` for `fn-admin`, `fn-events`, `job-raster`, `gh-deployer` (a 409 is success) |
| 4 | `buckets` | the default bucket `<projectId>.firebasestorage.app` in `us-central1` through the Firebase Storage API (`POST https://firebasestorage.googleapis.com/v1alpha/projects/{number}/defaultBucket` `{location: 'us-central1'}`, **UNVERIFIED** shape; needs Blaze since October 2024); the public bucket `<projectId>-public` through the Cloud Storage JSON API (`us-central1`, `STANDARD`, uniform bucket-level access, `publicAccessPrevention: 'inherited'`) and its public read: `allUsers` `roles/storage.legacyObjectReader` (get without list; `roles/storage.objectViewer` when refused, **UNVERIFIED** under uniform access). A name taken by another project: `invalid` with `apiError.conflict` and the bucket's name |
| 5 | `bucket-cors` | `PATCH b/{bucket}` `cors`: public `[{origin: ['*'], method: ['GET', 'HEAD'], responseHeader: ['Content-Type', 'Range', 'Content-Range', 'ETag', 'Accept-Ranges'], maxAgeSeconds: 3600}]`; private the same for the admin's two origins |
| 6 | `bucket-lifecycle` | private: `lifecycle.rule` delete `tmp/` after 1 day and `uploads/` after 7 (M3 adds `usgs-raw/`), `softDeletePolicy.retentionDurationSeconds: 0`; public keeps the default 7-day soft delete |
| 7 | `secrets` | Secret Manager `POST projects/{id}/secrets?secretId=` `usgs-username`, `usgs-app-token`, `mapbox-sk-bootstrap`, `mapbox-sk-tiles` (automatic replication, label `app=historic-city-map`, no version: the values arrive through `setup.saveUsgs` and `setup.saveMapbox`) |
| 8 | `iam` | the role table below: project bindings (Resource Manager `getIamPolicy` and `setIamPolicy` with `requestedPolicyVersion: 3` and the etag), bucket, secret and service-account bindings; service agents created first with Service Usage `v1beta1 …/services/{api}:generateServiceIdentity` |
| 9 | `budget-alerts` | Pub/Sub `PUT projects/{id}/topics/budget`; `roles/pubsub.publisher` on it for `billing-budget-alert@system.gserviceaccount.com` (**UNVERIFIED** whether the Budget API grants it itself); `PATCH` the (b) budget (found by name when the record is gone) `notificationsRule.pubsubTopic` and `schemaVersion: '1.0'` |
| 10 | `workload-identity` | IAM `projects/{n}/locations/global/workloadIdentityPools/github` (a `DELETED` pool is undeleted, never recreated) and its provider `site-master`: issuer `https://token.actions.githubusercontent.com`, mapping `google.subject=assertion.sub`, `attribute.repository_id`, `attribute.repository_owner_id`, `attribute.ref`, condition `assertion.repository_owner_id=='<ownerId>' && assertion.repository_id=='<repoId>' && assertion.ref=='refs/heads/master' && assertion.environment=='deploy'` (the `environment: deploy` of `ci.yml`'s deploy jobs; the security review wrote `production`) with the numeric ids of `infra/project.json` (patched when it differs); `roles/iam.workloadIdentityUser` on `gh-deployer@` for `principalSet://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/github/attribute.repository_id/<repoId>`. IAM propagation takes about five minutes: the first CI run after it is the test |
| 11 | `app-check` | reCAPTCHA Enterprise `POST projects/{id}/keys` (found by `displayName` `historic-city-map admin`; `webSettings {integrationType: 'SCORE', allowedDomains: ['<projectId>.web.app', '<projectId>.firebaseapp.com']}`); App Check `PATCH projects/{number}/apps/{appId}/recaptchaEnterpriseConfig` `{siteKey, tokenTtl: '3600s'}`. Enforcement stays off (monitor) until a week after the admin ships it; switching it on is a later settings action |
| 12 | `crash-alerts` | Monitoring v3 notification channel (`type: 'email'`, `labels.email_address` = the owner's verified address, used only here, in the owner's own project; `displayName` `historic-city-map crashes`) and an alert policy `historic-city-map new crash reports` with `conditionMatchedLog.filter` `jsonPayload."@type"="type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent"`, `alertStrategy.notificationRateLimit.period: '3600s'`, `autoClose: '1800s'`, `enabled: true`. Error Reporting's own "new error" e-mails are a console setting without a public API (**UNVERIFIED**); the card links to it. Cloud Monitoring may bill alert conditions (about USD 0.10 a month each, **UNVERIFIED** date) |
| 13 | `api-key` | API Keys v2 `GET projects/{id}/locations/global/keys`, the key whose `:getKeyString` equals the web configuration's `apiKey`; `PATCH` `restrictions.browserKeyRestrictions.allowedReferrers` = `https://<projectId>.web.app/*`, `https://<projectId>.firebaseapp.com/*` and each viewer origin of `infra/project.json` with `/*` (GA4 in the viewer uses the same key); API targets unchanged (the list Auth, Installations, App Check and GA4 need is **UNVERIFIED**) |
| 14 | `task-queues` | Cloud Tasks v2 `GET projects/{id}/locations/us-central1/queues/publish-buildManifest` (`MANIFEST_QUEUE`); missing: `POST projects/{id}/locations/us-central1/queues` with `rateLimits.maxConcurrentDispatches: 1`, which the first deploy then updates with the function's own settings (firebase-tools updates an existing queue) |
| 15 | `scheduler` | Cloud Scheduler: the job firebase-tools creates for `ops.tick`, found by its target function: `pending` before (d) |

APIs the `apis` item enables (Spark-safe ones may already be on from (a) and (b)): `cloudresourcemanager`,
`serviceusage`, `cloudbilling`, `billingbudgets`, `iam`, `iamcredentials`, `sts`, `cloudfunctions`, `run`,
`cloudbuild`, `artifactregistry`, `eventarc`, `pubsub`, `cloudscheduler`, `cloudtasks`, `secretmanager`, `storage`,
`firebasestorage`, `firebaseappcheck`, `recaptchaenterprise`, `firebaseinstallations`, `monitoring`, `logging`,
`clouderrorreporting`, `orgpolicy`, `apikeys`, `analyticsadmin` (each `<name>.googleapis.com`).

#### 3.4.1 Roles (security review §1.1, M2 §4.3, `DECISIONS-for-review.md` §19b; CR-M2-5)

| Member | Role | On | When |
| --- | --- | --- | --- |
| `fn-admin@` | `roles/datastore.user`, `roles/firebaseauth.admin`, `roles/firebase.viewer`, `roles/errorreporting.viewer`, `roles/cloudtasks.enqueuer` | project | M2b |
| `fn-admin@` | `roles/storage.objectAdmin` | both buckets | M2b |
| `fn-admin@` | `roles/secretmanager.secretAccessor`, `roles/secretmanager.secretVersionAdder`, `roles/secretmanager.secretVersionManager` | each of the four secrets | M2b |
| `fn-admin@`, `fn-events@` | `roles/iam.serviceAccountUser` | itself (a Cloud Tasks task's OIDC token; **UNVERIFIED** need, the self-test's `task-queue` check proves it) | M2b |
| `fn-admin@`, `fn-events@` | `roles/run.jobsExecutorWithOverrides`, `roles/run.viewer` | the `raster-pipeline` jobs | M3 |
| `fn-events@` | `roles/datastore.user`, `roles/eventarc.eventReceiver`, `roles/cloudtasks.enqueuer` | project | M2b |
| `fn-events@` | `roles/storage.objectAdmin` | both buckets | M2b |
| `fn-events@` | `roles/secretmanager.secretAccessor` | `usgs-username`, `usgs-app-token`, `mapbox-sk-tiles` | M2b |
| `fn-events@` | `roles/run.invoker` | its own services (the Eventarc triggers) | after (d), when firebase-tools has not granted it |
| `job-raster@` | `roles/datastore.user` | project | M2b |
| `job-raster@` | `roles/storage.objectAdmin`; `roles/storage.objectCreator` (`previews/`) | private bucket; public bucket | M2b; M3 |
| `job-raster@` | `roles/secretmanager.secretAccessor` | `usgs-username`, `usgs-app-token`, `mapbox-sk-tiles` | M2b |
| `gh-deployer@` | `roles/firebasehosting.admin`, `roles/firebaserules.admin`, `roles/datastore.indexAdmin`, `roles/cloudfunctions.developer`, `roles/cloudscheduler.admin`, `roles/cloudtasks.queueAdmin`, `roles/serviceusage.serviceUsageConsumer`, `roles/firebase.viewer` | project | M2b (**UNVERIFIED** as a complete set: the narrowest role naming the permission of each 403 of the first CI deploy is added) |
| `gh-deployer@` | `roles/iam.serviceAccountUser` | `fn-admin@`, `fn-events@`, `job-raster@` (never project-wide) | M2b |
| `gh-deployer@` | `roles/artifactregistry.writer`; `roles/run.developer` | repository `pipeline`; jobs `raster-pipeline*` | M3 |
| the WIF principal set | `roles/iam.workloadIdentityUser` | `gh-deployer@` | M2b (`workload-identity`) |
| Firebase Storage service agent `service-<number>@gcp-sa-firebasestorage.iam.gserviceaccount.com` | `roles/firebaserules.firestoreServiceAgent` | project (Storage rules read Firestore) | M2b |
| Cloud Storage service agent `service-<number>@gs-project-accounts.iam.gserviceaccount.com` | `roles/pubsub.publisher` | project (2nd-generation Storage triggers) | M2b |
| compute default `<number>-compute@developer.gserviceaccount.com` | `roles/cloudbuild.builds.builder` | project | only when `iam.automaticIamGrantsForDefaultServiceAccounts` is enforced; since 2026-10-31 whenever the account exists, and its `roles/editor` is then removed (`M6-interfaces.md` §1.2, `DECISIONS-for-review.md` §75g) |
| `billing-budget-alert@system.gserviceaccount.com` | `roles/pubsub.publisher` | topic `budget` | M2b (`budget-alerts`) |

#### 3.4.2 Organisation policies

| Constraint (effective) | Effect | Handling |
| --- | --- | --- |
| `iam.allowedPolicyMemberDomains` | `allUsers` refused: no public bucket read, no public callable invoker | `buckets` is `invalid` with `adminSetup.provision.orgPolicy {constraint}` and the fallback named (a Firebase-rules public path, security review §1.5); (d) names the `--no-invoker-iam-check` step (§23c). S-A04-BAD-ORG-POLICY |
| `storage.publicAccessPrevention` | the public bucket cannot be public | same as above |
| `iam.automaticIamGrantsForDefaultServiceAccounts` | the compute default account has no Editor role, so function builds fail | `iam` adds `roles/cloudbuild.builds.builder` to it (since 2026-10-31 on every project with the account, §75g) |

Changing an organisation policy is a settings change of the user's own (the guide says how); the provisioner never
does it.

### 3.5 Input budget

- Counted (e2e `inputBudget`): every in-app click, fill, paste and file choice of a flow. Not counted: following a deep
  link to a provider's page and the human-only work there. Google's consent page is counted apart (`consents`).
- Happy-path limits: `SETUP_STEP_SPECS[step].inputs` and `.consents` (**done**); the whole Setup Assistant from sign-in
  to the import: `setupInputBudget()` = 10 inputs and 4 consents (S-A30-HAPPY); the bootstrap part 3 and 3.
- Allowances on a bad path: one more input to choose among several billing accounts, one per retry of a failed item,
  one input and one consent to renew an expired Google token or to claim without a live token; a step never asks
  again for anything it detected (S-A30-BAD-RETRY-COSTS-ONE).

### 3.6 Polling

| What | Interval | Stops after | Paused while hidden |
| --- | --- | --- | --- |
| a new billing account (b) | 10 s | 30 min (then Check again) | yes |
| the deployment (d) and the probe | 30 s | 2 h | yes |
| Google Analytics enabled (g) | 15 s | 15 min after the deep link | yes |
| the legacy import (h) | Firestore `onSnapshot` per document | done or failed | no |
| USGS approval | none in the page: `ops.tick` every 6 h (M2); the card shows `nextCheckAt` | | |

Every interval runs on the injected clock, so tests advance it; a poll's failure shows on its card and the poll goes on.

### 3.7 `infra/project.json`

Committed, public (google-clients writes it with `gh api` reads of the numeric ids; schema
`packages/admin/src/provision/project-config.ts`), bundled into the admin build; the provisioner refuses to run when
its `projectId` differs from the web configuration's (`invalid`, "this build belongs to project X"):

```json
{
    "projectId": "bucurestiul-disparut",
    "projectNumber": "804854330662",
    "region": "us-central1",
    "cities": ["bucharest"],
    "viewerOrigins": ["https://ventura8.github.io"],
    "github": { "owner": "ventura8", "ownerId": 0, "repo": "bucurestiuldisparut.github.io", "repoId": 0, "branch": "master", "environment": "deploy" }
}
```

(`ownerId` and `repoId` are the numbers `gh api users/ventura8 --jq .id` and `gh api
repos/ventura8/historic-city-map-maker --jq .id` print; the e2e build uses the fixture values of
`@hcm/test-support`.)

## 4. Module ownership

Each workstream writes only its own paths; reading and importing anything is fine; anything else is a change request.

| Workstream | Owns (writes) | Notes |
| --- | --- | --- |
| contracts (**done**) | this file; `packages/shared/src/i18n/{catalogue.ts,admin-shell/**,admin-setup/**}` (the skeletons), `PROVISION_ITEMS`; `packages/admin/src/google/scopes.ts`, `packages/admin/src/setup/steps.ts`, `packages/admin/src/routing/routes.ts` and their tests; the M2b rows of `e2e/scenarios.json` | After the parallel build starts, `scopes.ts` belongs to google-clients, `steps.ts` to setup-ui, `routes.ts` to admin-shell (with their tests); the rest changes through a change request. |
| admin-shell | `packages/admin/src/{app,auth,routing,state,firebase}/**`, `packages/admin/src/index.ts`, `packages/admin/vite.config.ts` (the `e2e` build mode), `packages/admin/package.json` (the `firebase` 13.0.0 dependency, in the lockfile), `packages/ui/src/admin/{shell,auth}/**`, `packages/ui/src/admin/{index.ts,admin-port.ts,define.ts}`, `packages/ui/package.json` (`./admin`), `packages/ui/src/icons.ts` and the font subset, `packages/shared/src/i18n/admin-shell/**`; tests `packages/admin/test/{app,auth,routing,state,firebase}/**`, `packages/ui/test/admin/{shell,auth}/**` | the boot, the auth states, the Google consent port and its e2e stand-in client, the routes and the page registry, the shell layout, `#/admins` (A02) |
| setup-ui | `packages/admin/src/setup/**` (the step state machine, the detections, polling, the bootstrap record, `BUDGET_AMOUNTS`, `links.json`), `packages/ui/src/admin/setup/**`, `packages/shared/src/i18n/admin-setup/**`; tests `packages/admin/test/setup/**`, `packages/ui/test/admin/setup/**` | the Setup page, every card, the doctor list, the USGS countdown, the import card, the crash panel and `#/crashes`; CR-M2-40 |
| google-clients | `packages/admin/src/google/**` (typed REST clients over `fetch`, `GoogleFailure`), `packages/admin/src/provision/**` (plan, apply, doctor, `project-config.ts`), `packages/admin/src/import/**` (the legacy import), `infra/project.json`, the new Google fakes and fixtures in `packages/test-support/src/{fakes,api-fixtures}/**` (§6); tests `packages/admin/test/{google,provision,import}/**`, `packages/test-support` tests | CR-M2-5 (the roles), CR-M2-37 (the GA4 stream) |
| admin-e2e | `e2e/admin/**` (specs, fixtures, the world's admin part), `e2e/mock-apis/**` additions (the Google hosts, the OAuth stand-in page, the admin server), `e2e/support/**` admin additions, `e2e/projects.ts` and `e2e/playwright.config.ts` (the admin tier), `e2e/package.json` (`@hcm/admin` for the budgets), `scripts/site/**` (the admin build: `index.html` generated from TypeScript like the viewer's, the `legacy/bucharest/` bundle, the `e2e` mode), `e2e/scenarios.json` and `docs/E2E_SCENARIOS.md` during M2b | CR-M2-6, CR-M2-21, CR-M2-39 with the integrator |
| integrator | `firebase.json` (Hosting headers and CSP), `functions/**` (the backend change requests), root `package.json`, `docs/*.md`, `.agent/**`, `.agents/**`, `.claude/**`, `docs/research/M0-handoff.md`, `docs/research/DECISIONS-for-review.md` | wires the workstreams, resolves the change requests |

- Tests live under `packages/<pkg>/test/**` mirroring `src/`; Lit elements are tested in the `ui` Vitest project
  (Chromium), with roles, names, keys and both languages; logic in the `admin` project (Node), with fakes of the ports.
- Coverage 90 % or more per file, lines and branches; no inline suppression; ESLint `strictTypeChecked`, complexity 5,
  400 lines per file, 60 per function; knip fails on an unused export, so an export exists only once something imports
  it (a test counts).
- Two workstreams touch `package-lock.json` (admin-shell for `firebase`, admin-e2e for `@hcm/admin` in `e2e`): each
  runs `npm install` in the digest-pinned Node container (`docs/SETUP.md`), and the integrator regenerates the lockfile
  the same way when the two meet.
- Docs, skills and their mirrors, `docs/LESSONS.md` and `docs/research/M0-handoff.md` are the integrator's: a workstream
  reports what it learned, and the docs it would change, as a change request row here.

## 5. Scenario rows registered (planned)

New and refined rows in `e2e/scenarios.json`, all `e2e-admin` and `planned` (the generated `docs/E2E_SCENARIOS.md`
lists them):

- **A04** billing and provisioning: `S-A04-HAPPY`, `S-A04-BAD-NOT-ENABLED` and `S-A04-HAPPY-PROVISION` refined;
  new `S-A04-BAD-SEVERAL-ACCOUNTS`, `S-A04-BAD-BILLING-QUOTA`, `S-A04-BAD-BUDGET-EXISTS`,
  `S-A04-BAD-BUDGET-PERMISSION`, `S-A04-BAD-PARTIAL-FAILURE`, `S-A04-BAD-TOKEN-EXPIRED-MID-RUN`.
- **A07** USGS: `S-A07-HAPPY-COUNTDOWN`, `S-A07-BAD-COUNTDOWN-EXPIRED`.
- **A22** analytics and crash setup: `S-A22-HAPPY-STREAM-SETTING`, `S-A22-BAD-NO-STREAM`, `S-A22-HAPPY-CRASH-ALERTS`.
- **A25** (new) bootstrap mode before Blaze: `S-A25-HAPPY`, `S-A25-BAD-NOT-OWNER`, `S-A25-BAD-SERVER-DOWN`,
  `S-A25-BAD-RELOAD-KEEPS-STEPS`, `S-A25-BAD-PAGE-NEEDS-SERVER`.
- **A26** (new) deployment detection and the automatic owner claim: `S-A26-HAPPY`, `S-A26-BAD-PARTIAL-DEPLOY`,
  `S-A26-BAD-TOKEN-GONE`, `S-A26-BAD-CLAIM-REFUSED`.
- **A27** (new) Google OAuth scopes: `S-A27-HAPPY`, `S-A27-HAPPY-UNVERIFIED-NOTICE`, `S-A27-BAD-SCOPE-DENIED`,
  `S-A27-BAD-POPUP-CLOSED`, `S-A27-BAD-WRONG-ACCOUNT`, `S-A27-BAD-TOKEN-NEVER-STORED`.
- **A28** (new) the legacy Bucharest import: `S-A28-HAPPY`, `S-A28-BAD-RERUN-IDEMPOTENT`, `S-A28-BAD-RESUME`,
  `S-A28-BAD-PROCESSING-FAILED`.
- **A29** (new) navigation and layout: `S-A29-HAPPY`, `S-A29-BAD-UNKNOWN-ROUTE`, `S-A29-BAD-LANDSCAPE-PHONE`.
- **A30** (new) minimum admin input: `S-A30-HAPPY`, `S-A30-BAD-RETRY-COSTS-ONE`.

The brief's bootstrap, OAuth, import and input-budget behaviours took the next free ids, A25–A30
(`e2e_scenario_matrix_skill.md` rule 4). A01–A03, A05, A06, A20 and A21 keep their M2 rows; the admin-e2e workstream
tags them as the specs land.

## 6. Fakes and the e2e admin world

### 6.1 New fakes (google-clients)

In `packages/test-support/src/fakes/` with fixtures in `api-fixtures/`, following `M2-interfaces.md` §7 (one world per
`x-hcm-test` partition, Google's error JSON, `SERVICE_DISABLED` naming the API, LROs done at once, every write
recorded):

- Cloud Functions v2 `functions` list: scenarios `none` (403 `SERVICE_DISABLED` until the API is on), `partial`,
  `deployed` (every registry name `ACTIVE`), `failed` (one `FAILED`);
- Pub/Sub topics and their IAM; Org Policy `getEffectivePolicy` (no parent by default; scenario `domainRestricted`
  matching Resource Manager's `allowedMemberDomains`); Resource Manager v3 `projects.get` with or without a parent;
- the Firebase Storage default bucket; reCAPTCHA Enterprise keys; App Check `recaptchaEnterpriseConfig`;
- Monitoring notification channels and alert policies; API Keys (`keys`, `:getKeyString`, `PATCH`);
- Analytics Admin `enhancedMeasurementSettings`; Firebase Management `analyticsDetails` (exists);
- Service Usage `generateServiceIdentity`; Cloud Billing: several open accounts, the project-quota refusal; Budget
  API: `PATCH`, a 403 for a missing billing role;
- tokeninfo grants issued by the OAuth stand-in (§2.6), with any scope set.

### 6.2 The admin tier

- **Servers**: the emulators (`auth`, `firestore`, `storage`, `functions` from `functions/dist/`, `pubsub`, `tasks`)
  under `--project demo-hcm` with `HCM_UPSTREAM_BASE` = the mock APIs, `HCM_OAUTH_CLIENT_IDS` = the fixture client id,
  `HCM_ADMIN_ORIGINS` = the admin server's origin (CR-M2-39, CR-M2b-4); the mock APIs (`127.0.0.1:4311`, with the
  fake upstreams, the OAuth stand-in and `/__oauth/*`); the admin server (`127.0.0.1:4312`, admin-e2e) serving the
  `e2e` build of `packages/admin/dist` with the headers of `firebase.json` minus `upgrade-insecure-requests` and plus
  the emulator and mock origins in `connect-src` (a unit test proves those are the only differences), and answering
  `/__/firebase/init.json` (the `demo-hcm` configuration) and `/runtime.json` (`{release: 'e2e'}`). The Hosting
  emulator is not used: it would apply `upgrade-insecure-requests` to the http emulators.
- **Network**: the admin projects forward `upstreamHosts()` and the `authorization` header to the mock APIs (CR-M2-21);
  loopback passes; anything else fails the test (the firewall).
- **"Not deployed yet"**: bootstrap specs abort the browser's requests to the Functions emulator origin at the network
  edge (`page.route`) and set the fake Cloud Functions list to `none`; "deploying" lifts the route and switches the
  list to `deployed`, so the real `admin.claim` runs on the emulator against the fake tokeninfo and Resource Manager.
- **Isolation**: `setup/owner`, `setup/status` and `admins/*` are per project, so the admin tier runs in one worker,
  each test starting from emptied emulators (the Firestore and Auth emulators' REST resets) and a seeded world;
  content specs (M2c) namespace by city id as before.
- **Projects**: `admin-c360-ro`, `admin-m768-ro`, `admin-l1440-ro`, `admin-l1440-en`; Firefox and WebKit for the
  forms (the paste boxes, the USGS countdown); the admin tour (11 viewports, light and dark, RO and EN) with A21.
- **Budgets**: one `inputBudget.flow(step, SETUP_STEP_SPECS[step].inputs)` per step, a `consents` flow on the stand-in
  page; S-A30-HAPPY walks the whole assistant.

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract; the
integrator (or the owner) applies it. Ids are `CR-M2b-<n>`; status `open`, `accepted`, `done` or `rejected`. Open M2
requests this milestone takes over: CR-M2-5 (google-clients), CR-M2-6 and CR-M2-21 (admin-e2e), CR-M2-22 (integrator,
CR-M2b-3), CR-M2-37 (google-clients and setup-ui), CR-M2-39 (integrator and admin-e2e), CR-M2-40 (setup-ui).

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-M2b-1 | contracts | contracts (`packages/shared/src/api/setup.ts`, the registry) and the integrator (`functions/src/setup/`) | A callable `setup.createCity` (admin, App Check `enforce`, owner fn-setup, `fn-admin@`): request `{cityId, city}` with the city fields of `cityDocSchema` a client may not create (name, center, zoom, bounds, about, credits, theme, basemap) from the bundled seed; creates `cities/{city}` once, stamped with the caller, server-owned fields (`id`, `createdAt`) set, validated with `cityDocSchema`; an existing city answers `{created: false}` unchanged. Registry, schema, handler and `functions/test/index.test.ts` land together (the exports must equal the registry) | the rules never let a client create a city, and `setup.saveMapbox` needs one (`requireCity`); `CLIENT_WRITES` already says cities are created by callables (planned for M5): this brings the first one forward | done (integrator: `createCityRequestSchema` and the registry row in `@hcm/shared`, `functions/src/setup/create-city.ts` in one transaction, `RUNTIME_ACCOUNTS` `fn-admin`, tests; the city is created **published**, see the integration addendum and `DECISIONS-for-review.md` §25a) |
| CR-M2b-2 | contracts | integrator (`functions/src/deps.ts`, `functions/src/admin/claim.ts`) | When `HCM_OAUTH_CLIENT_IDS` is unset, `admin.claim` reads the Google provider's web client id from Identity Toolkit (`GET https://identitytoolkit.googleapis.com/admin/v2/projects/{id}/defaultSupportedIdpConfigs/google.com`, `fn-admin@` holds `roles/firebaseauth.admin`), cached per instance | the automatic claim (d2) must not need a deploy-time value nobody sets yet (`DECISIONS-for-review.md` §22a); the access token's audience is that client | done (integrator: `FirebaseManagement.googleSignInClientId`, Identity Toolkit admin v2 over REST with the runtime account's token, cached per instance, a failed read forgotten; `admin.claim` uses it when `HCM_OAUTH_CLIENT_IDS` is empty; the fake upstreams answer the fixture client, `googleSignInOff` removes it; the e2e emulators set no client id, so the journey's claim goes this way. UNVERIFIED: the answer's shape, which also holds the client secret, never read) |
| CR-M2b-3 | admin-e2e | integrator (`functions/src/api/callable.ts`, `functions/src/adapters/emulator-fetch.ts`) | CR-M2-22's forwarding of the callable request's `x-hcm-test` to the fake upstreams (an `AsyncLocalStorage` set in `defineCallable`) | per-test upstream state for `admin.claim` and `setup.*` in the admin tier; until then the stand-in also writes its grants into partition `''` | open (the journey gives the server's world the secrets the browser's provisioning created, `secret-manager.provisioned` on partition `''`, until it lands) |
| CR-M2b-4 | admin-e2e | integrator (`functions/src/deps.ts`) | `HCM_ADMIN_ORIGINS` and `HCM_ERROR_ENDPOINT` overrides read only in the Functions emulator, accepting a loopback `http` origin there (CR-M2-39) | `telemetry.reportError` checks the admin's origin, `admins.invite` answers `adminUrl` | open (no spec needs it yet; the override must reach only the crash endpoint's origin check and `adminUrl`, never `adminOrigins`, whose https origins the minted admin token and its response schema require) |
| CR-M2b-5 | contracts | integrator (`firebase.json`) | Hosting: `Cache-Control: public, max-age=86400` for `legacy/**` (the bundled import files are not content-hashed); nothing else changes in the CSP (`connect-src https://*.googleapis.com` already covers every Google API of §3.4) | the import fetches 46 MB once; the rest of the headers stay as M2 set them | done (integrator: `firebase.json` `legacy/**` → `public, max-age=86400`, after the `no-cache` rule; `scripts/site/test/admin-hosting.test.ts`) |
| CR-M2b-6 | contracts | integrator, ask first (`.github/workflows/ci.yml`) | `DECISIONS-for-review.md` §23b (`runtime.json` with the App Check site key at deploy) and §23c (the invoker fix under domain-restricted sharing) | App Check in the admin; callables under an organisation policy | open |
| CR-M2b-7 | contracts | integrator, ask first (`.dependency-cruiser.cjs`) | `DECISIONS-for-review.md` §23a (the admin's layering) | keeps `packages/admin` DOM-free and the REST clients SDK-free | open |
| CR-M2b-8 | contracts | the integrator (`docs/ADMIN_GUIDE.en.md`; its Romanian twin was removed by DECISIONS §157) | Screenshots, the exact messages and the troubleshooting of every card, once the cards exist | the guides describe what the admin does | done (integrator: both guides' Setup chapters as built: every card, its texts, the troubleshooting table) |
| CR-M2b-9 | admin-e2e | integrator (root `package.json`) | Root scripts: `build:site:e2e` = `npm run build --workspace @hcm/engine && npm run build --workspace @hcm/functions && npm run build:e2e --workspace @hcm/admin && node --import ./scripts/site/register-ts.mjs e2e/scripts/build-site.ts` (the e2e build script then writes the admin's page, fonts and legacy bundle into `packages/admin/dist` whenever `E2E_TIER` includes `admin`); `build:admin` = `npm run build --workspace @hcm/admin && node --import ./scripts/site/register-ts.mjs scripts/site/build-admin.ts` (§23b's deploy step; also the `build` stage after `vite-build`, which empties `packages/admin/dist`) | the admin tier serves the e2e build of `packages/admin/dist` and the Functions emulator loads `functions/dist`, which a clean checkout lacks (`e2e-build` then fails with `packages/admin/dist/admin.iife.js is missing`); Hosting deploys `packages/admin/dist`, which has no `index.html` without the admin target of `scripts/site/` | done (integrator: root `build:site:e2e` also builds `functions/dist` and the admin's e2e bundle; `build:admin`; the root `build` ends with the admin's site step, and Hosting's `predeploy` runs `build:admin`) |
| CR-M2b-10 | admin-e2e | admin-shell (`packages/admin/package.json`), then admin-e2e (`e2e/package.json`) | A `build:e2e` script (`vite build --mode e2e`, what `src/index.ts` reads as `E2E_BUILD`); `exports` for the DOM-free contract modules the e2e tier reads: `./setup/steps` (`./src/setup/steps.ts`) and `./google/scopes` (`./src/google/scopes.ts`), since the root entry imports CSS and Lit, which Playwright's Node runner cannot load. Then admin-e2e adds `@hcm/admin` to `e2e/package.json` (lockfile regenerated in the Node container) and replaces its relative imports of `packages/admin/src/` (`e2e/admin/support/budget.ts`, `e2e/admin/specs/smoke.spec.ts`, `e2e/admin/harness/consent.spec.ts`; `e2e/tsconfig.json` references `packages/admin` meanwhile) | the input budgets and the scopes of the specs come from the contract code (§3.5, §2.1) | done (admin-shell: `build:e2e` and the two `exports`; the `e2e/package.json` part is admin-e2e's) |
| CR-M2b-11 | admin-e2e | admin-shell (information) | What the admin tier provides, as built: the page (`scripts/site/src/admin/page.ts`) holds `<hcm-admin-shell>`, loads `admin.css` and then `admin.iife.js` (deferred; the bundle the bundle budget measures) and no meta CSP; `scripts/site/src/admin/build.ts` copies every `packages/ui/fonts/*.woff2` and `LICENSES.md` to `fonts/` next to the page (an admin icon subset, §23f, is picked up there); the stand-in reads a non-empty `?test=` of the authorize URL, else the `x-hcm-test` header the e2e network adds to a page's requests to the mock APIs, so the admin need not know the test id; Cancel posts `{cancelled: true}` before closing; the anonymous probe's 401 is an expected console error of the admin tier (`expectedConsoleErrors`). Not done: a WebKit project would need the Auth emulator's origin in the e2e `frame-src` (Firebase Auth preloads its popup iframe on Safari), a second difference from `firebase.json` | the page, the stand-in and the client agree without further changes; checked on 2026-10-12 against the work-in-progress e2e build: the owner signs in, claims the map on the emulator and reaches the shell, the stranger is told and signs out | done |
| CR-M2b-12 | admin-e2e | setup-ui and google-clients (`packages/admin/src/setup/`, `packages/admin/src/import/`), contracts | The bundled `legacy/bucharest/city.json` is the seed manifest's city, whose `id` is `bucuresti` and whose `center` is `[lng, lat]` and `bounds` `[[w, s], [e, n]]` (manifest shape), while §3.3 h and `infra/project.json` name the city `bucharest` and `setup.createCity` takes `cityDocSchema` fields: the import should create and fill `cities/bucharest` from it, mapping the fields | otherwise the created city and the imported photos (`cities/bucharest/photos/*`) disagree on the id | done (CR-M2b-18 and the wiring: `cityId` is `infra/project.json`'s first city) |
| CR-M2b-13 | admin-e2e | integrator (docs, skills and mirrors, `docs/LESSONS.md`, `docs/research/M0-handoff.md`, `docs/research/M2-interfaces.md`) | Document the admin tier: `docs/TESTING.md` (E2E today, Network isolation, Emulators: the admin projects' `forwardUpstreams`, the admin server with its `/__harness` page, the emulators as a `webServer` ready once `admin-session` is loaded, the lease, the probe's expected 401, the `admin-*` projects, `E2E_TIER=admin`); `.agent/skills/quality/e2e_scenario_matrix_skill.md` and `testing_strategy_skill.md` (tier `admin`, behaviour A00, the admin fixtures `persona`, `mapOwner`, `adminWorld`, `upstream`, `consent`, `setupBudget`, `serverDeployment`, the base option `expectedConsoleErrors`); `.agent/skills/web/web_security_skill.md` (the admin CSP's source `scripts/site/src/admin/csp.ts`, kept equal to `firebase.json` by `scripts/site/test/admin-csp.test.ts`); M0 hand-off section 10q; the status of CR-M2-6 and CR-M2-21 (done by this workstream; `HCM_ADMIN_ORIGINS` of CR-M2b-4 is already set in the emulator's environment, `e2e/admin/world.ts`); `docs/LESSONS.md`: (1) a document a Playwright route fulfils has no address space, so Chromium's Local Network Access refuses its requests to the loopback emulators (the harness page is served by the admin server instead); (2) Chromium logs a callable's expected 401 as a console error | docs follow the code; the workstream reports, the integrator writes | done (integrator: `docs/TESTING.md`, the scenario and testing skills, the security skill, the M0 hand-off, `docs/LESSONS.md` 42) |
| CR-M2b-14 | google-clients | admin-shell (`packages/admin/package.json`) | `zod` (the root pin, 4.6.6) as a dependency of `@hcm/admin`: `packages/admin/src/provision/project-config.ts`, `packages/admin/src/import/bundle.ts` and `packages/admin/src/import/city.ts` import it, as do admin-shell's `app/config.ts`, `auth/ownership.ts` and `auth/stand-in.ts` | until then knip reports an unlisted dependency and dependency-cruiser `no-non-package-json` | done (admin-shell: `zod` 4.6.6 and `firebase` 13.0.0 in `packages/admin/package.json`, the lockfile updated in the Node container) |
| CR-M2b-15 | google-clients | admin-shell (`packages/admin/src/app/`, `packages/admin/src/firebase/`) | Wiring and one adapter. `createSetupCloud({fetch, sleep, log, project, web, ownerEmail})` (`packages/admin/src/provision/setup-cloud.ts`) is setup-ui's `SetupCloud` (a type test in `packages/admin/test/provision/setup-cloud.test.ts` proves it) and `createLegacyImport({fetch, store, cityId, baseUrl, uid, nonce, sleep, log})` (`packages/admin/src/import/legacy-import.ts`) its `SetupLegacyImport`. admin-shell passes `project` = the bundled `infra/project.json` through `parseProjectConfig` (the e2e build: `E2E_PROJECT_CONFIG` of `@hcm/test-support/fakes`), `web` = `{projectId, appId, apiKey}` of `/__/firebase/init.json`, `ownerEmail` = the signed-in user's verified address, `cityId` = `project.cities[0]`, `baseUrl` = `document.baseURI`, `nonce` = `crypto.randomUUID()`, `sleep` = the clock's, and a `LegacyPhotoStore` over the Firebase SDK: `read` and `watch` (`getDoc`, `onSnapshot`, each mapped to `{processing, hasImage: 'image' in doc, published, processingError}`), `findByLegacyId` (`where('legacyId', '==', …)`, `limit(1)`), `create` (`setDoc` with `updatedBy` and `createdBy` = uid, `updatedAt` and `createdAt` = `serverTimestamp()`: the rules' `stamped()` and `created()`), `upload` (`uploadBytes` with `customMetadata.originalName`), `publish` (`updateDoc` `{published: true}` and the stamp) | the Setup Assistant's billing, provisioning, deployment, GA4 and crash-alert calls and the import need these at mount | done (admin-shell: `packages/admin/src/app/setup-wiring.ts` composes `createSetupCloud` and `createLegacyImport`; the `LegacyPhotoStore` is `legacyPhotoStore` of `packages/admin/src/app/legacy-photos.ts`, over the shell's Firestore and Storage ports; `project` is the page's `/project.json`, CR-M2b-26) |
| CR-M2b-16 | google-clients | setup-ui (`packages/shared/src/i18n/admin-setup/**`) | Two keys: `adminSetup.provision.waiting` `{item}` (an item left `pending` because an item it needs is not `ok` is reported `{state: 'pending', params: {item}}` without a detail today; the card can name it with `adminSetup.provision.item.<item>`) and `adminSetup.provision.wrongProject` `{projectId}` (a build whose `infra/project.json` names another project reports every item `invalid` with `apiError.invalidRequest` and `{projectId}` meanwhile). Also: `apiError.cloud.permission` says the server account lacks the role, while a browser-side Google call fails for the owner's own account; with an `adminSetup.cloud.permission` key google-clients would switch `failureMessage` to it | the doctor list says why an item waits, and the role message names the right account | done (keys, CR-M2b-22); switching the browser-side refusals to `adminSetup.cloud.permission` is CR-M2b-32 |
| CR-M2b-17 | google-clients | contracts and integrator (this file §3.4, `.agent/skills/web/admin_setup_assistant_skill.md`) | As built, where §3.4's sketch differs: `planProvision(observed, only)` (pure: the items of `only`, every item when null, not `ok` in `observed`), `applyProvision(plan, deps, onItem)` and `doctorProvision(deps, only, onItem)` with `deps = {project, web, ownerEmail, clients, log}`, both resolving to `{items, stopped}` (`stopped`: a Google 401 ended the run); an item is `{id, after, observe}` and an observation that lacks something carries the `fix` bound to what it read (no separate `ensure`), followed by a second observation; API Keys' `:getKeyString` is the REST `GET …/keys/{key}/keyString`; the Cloud Storage service agent comes from `GET storage/v1/projects/{id}/serviceAccount`, Service Usage's `generateServiceIdentity` names Firebase Storage's; `fn-events@`'s `roles/run.invoker` (after (d)) is not provisioned (firebase-tools grants it on deploy); `budget-alerts` without the (b) budget is `pending` with `{item: 'billing'}`; the `scheduler` item reads the Cloud Functions list itself to tell "not deployed yet" (`pending`, `adminSetup.provision.afterDeploy`) from "deployed but no job" (`invalid`, `apiError.notFound`). Failures are `GoogleApiError`s whose `GoogleFailure` fields are also the error's own (`kind`, `status`, `reason`, `api`, `role`, `permission`, `constraint`, `retryAfterSeconds`), so setup-ui's `googleFailure(error)` reads them; `failureMessage` maps them to keys; a 429, a 5xx or a network failure is retried 3 times after 1, 2, 4 s (or `Retry-After`, at most 30 s); an IAM etag conflict is merged again, at most 3 writes | the contract the admin-shell wiring and the docs follow | done (information) |
| CR-M2b-18 | google-clients | setup-ui (answer to CR-M2b-12) | The import takes its `cityId` from `infra/project.json` (`bucharest`) and reads `legacy/bucharest/photos.json`, so the photos land in `cities/bucharest/photos/*` whatever the seed's own id; `legacyCityFields(raw)` (`packages/admin/src/import/city.ts`) maps the bundled manifest city (`center` `[lng, lat]`, `bounds` `[[w, s], [e, n]]`) to the `cityDocSchema` fields `setup.createCity` writes under that id (no `id`, `mapbox` or `analytics`: the server owns them) | the created city and the imported photos agree on `bucharest` | done (google-clients part; `setup.createCity` itself is CR-M2b-1) |
| CR-M2b-19 | google-clients | integrator (docs, skills and mirrors, `docs/LESSONS.md`, `docs/research/M0-handoff.md`, `docs/research/M2-interfaces.md`) | Mark CR-M2-5 done (the `iam` item binds the role table of §3.4.1, `packages/admin/src/provision/resources.ts`) and CR-M2-37 done on the client side (`createAnalyticsClient`, `SetupCloud.disablePageChanges` turns `pageChangesEnabled` off and reads it back; the card's checkmark is setup-ui's). Document: `docs/TESTING.md` → *Fake upstreams*: the new services (`cloud-functions`, `cloud-scheduler`, `pubsub`, `org-policy`, `firebase-storage`, `recaptcha-enterprise`, `app-check`, `monitoring`, `api-keys`, `analytics-admin`) and scenarios (`cloud-functions.none`, `.partial`, `.deployed`, `.failed`, the preset `google.deployed`, `resource-manager.inOrganization`, `org-policy.noDefaultGrants`, `org-policy.publicAccessPrevented`, `cloud-storage.publicBucketTaken`, `cloud-storage.legacyRolesRefused`, `cloud-billing.severalAccounts`, `cloud-billing.quotaExceeded`, `billing-budgets.budgetForbidden`, `iam.poolDeleted`), `E2E_PROJECT_CONFIG`, and that Resource Manager's project has no parent unless a scenario puts it in an organisation; the admin skill's provisioner paragraph (CR-M2b-17); the M0 hand-off: the new paths `infra/project.json`, `packages/admin/src/google/`, `packages/admin/src/provision/`, `packages/admin/src/import/`; `docs/LESSONS.md`: (1) the fake `GoogleProjects` made a project first named by its number a phantom project, so Service Usage refused billed APIs on a project whose billing was linked (`demo-hcm` is now known from the start); (2) polling a long-running operation must not resend the start call's method, query and body (IAM's create was POSTed again to the operation URL); (3) a fixture named `service-account.*.json` trips the repo policy's secret-file rule (renamed `cloud-storage/storage-agent.get.json`) | docs follow the code; the workstream reports, the integrator writes | done (integrator: `docs/TESTING.md` → *Fake upstreams*, the admin skill, the M0 hand-off, `docs/LESSONS.md` 43, 44, the repo-policy quirk in the pipeline skill; CR-M2-5 and CR-M2-37 marked done) |
| CR-M2b-20 | setup-ui | admin-shell (`packages/admin/src/index.ts`, `packages/admin/src/routing/pages.ts`, `packages/ui/src/admin/admin-port.ts`, `packages/ui/src/admin/define.ts`) | Wire the Setup Assistant. `deps.setup` of `mount` = `createSetupModule({cloud, importer, createCity, cityId, cityBBox})` (`packages/admin/src/setup/module.ts`) in place of `NO_SETUP`: `cloud` and `importer` are google-clients' `createSetupCloud(...)` and `createLegacyImport(...)` (CR-M2b-15), `createCity` calls `setup.createCity` (CR-M2b-1) with `legacyCityFields` of the bundled city, `cityId` = `project.cities[0]` (setup-ui's part of CR-M2b-12: the created city, the import and the cards all use it), `cityBBox` = the bundled city's bounds as `[west, south, east, north]` (or null). The module reads `config.messagingSenderId` as the project number (§1.4), calls `serverReady()` once step (d) sees every function `ACTIVE`, follows `auth` (`bootstrap`: start-up mode; `admin`: normal mode, which creates the city, records the bootstrap and loads `setup/status`; `claiming`: the claim card) and `route` (`#/setup/<step>` opens that step), and puts the controller's state in `AdminState.setup`. The page registry loads `SETUP_PAGE_TAGS.setup` (`hcm-setup-page`) and `SETUP_PAGE_TAGS.crashes` (`hcm-crashes-page`) after `defineSetupElements()` (`packages/ui/src/admin/setup/define.ts`); the outlet's `state.setup` and `app.intents.setup` are what the pages read, so `AdminStatePort` gains `setup: SetupViewState \| null` and `AdminIntentsPort` `setup: SetupIntentsPort \| null` (`packages/ui/src/admin/setup/setup-port.ts`), and the admin's type test checks the controller's state and intents against them (a scratch compile on 2026-10-12: `SetupController` is assignable to `SetupPort`, `createSetupModule(...)` to `SetupModuleSpec<SetupState \| null, SetupController['intents']>`, google-clients' adapters to `SetupModuleOptions`) | `NO_SETUP` and the page outlet are the seams admin-shell left for setup-ui | done (admin-shell: `setupModuleFor` in `packages/admin/src/app/setup-wiring.ts`, mounted by `browserDeps` of `packages/admin/src/index.ts` when the page serves `/project.json`; the registry loads `setup` and `crashes` after `defineSetupElements()`, re-exported by `@hcm/ui/admin`; `AdminStatePort.setup` and `AdminIntentsPort.setup` added, pinned by `packages/admin/test/app/admin-port.test.ts`; `cityBBox` is null for now: the bundled city is fetched only when `setup.createCity` runs, CR-M2b-29) |
| CR-M2b-21 | setup-ui | contracts (`packages/shared/src/i18n/api/{ro,en}.ts`, `packages/shared/src/api/errors.ts`) and the integrator (`functions/src/setup/`) | (a) `setup.recordCloud` accepts only API error codes as reasons, so the doctor's `adminSetup.provision.orgPolicy` `{constraint}`, `afterDeploy` and `waiting` reasons are dropped when the bootstrap record is stored after the claim (each item keeps its state): an `apiError.cloud.orgPolicy` `{constraint}` code would keep the organisation-policy finding in `setup/status`. (b) The server's `provision.state` is the worst item, so the scheduler item, `pending` until the first deploy creates its job, holds `ready` back after the claim; the admin counts a pending scheduler as done (`provisionHealth`) and re-reads it with the live token once step (d) is done, but without that token the owner has to Re-check provisioning (one click, one consent): the server's worst state should skip a `pending` scheduler too | the recorded `setup/status`, `ready` and the cards agree | partly done (integrator: (b) a scheduler item `pending` no longer holds the provisioning area back, `functions/src/setup/record-cloud.ts`; (a) open) |
| CR-M2b-22 | setup-ui | google-clients (answer to CR-M2b-16) | Added to `packages/shared/src/i18n/admin-setup/`: `adminSetup.provision.waiting` `{item}` (the card also shows it for an item that comes with `params.item` and no reason: `itemMessage` of `packages/admin/src/setup/records.ts`; the `item` value is shown by the item's or the step's label), `adminSetup.provision.wrongProject` `{projectId}` and `adminSetup.cloud.permission` `{role}`, all three recordable in the bootstrap record. The cards' own refusals keep `apiError.cloud.permission`, as §3.3 b and the A04 rows name it; switching the browser-side refusals to `adminSetup.cloud.permission` is a contract change (this file and those rows) | the doctor list says why an item waits | done (keys) |
| CR-M2b-23 | setup-ui | admin-e2e (information) | Hooks of the Setup Assistant as built: each card `hcm-setup-step[data-step=<id>]` carries `data-state`, `data-inputs`, `data-input-budget`, `data-consents` and `data-consent-budget` (the controller's counts of the step's own clicks, fills, pastes and Google popups against `SETUP_STEP_SPECS`), the page `hcm-setup-page` carries `data-inputs` and `data-consents` (the whole assistant) and `window-class`; a recorded reason is `.detail[data-detail=<key>]` (language-free), a doctor row `[data-item=<id>][data-state]`, an import failure `[data-photo=<id>]`, a crash group `[data-group=<id>]`. The USGS token page is an `<a target=_blank>` whose click focuses the paste box and starts the 60 s countdown before the browser opens ERS (a spec that must not open ERS prevents the default); a paste is an `input` event with `inputType: 'insertFromPaste'` and saves at once when the username is filled (Enter saves a typed token); opening a card is navigation and not counted. Every poll runs on the shell's clock (`page.clock`) and pauses while the tab is hidden: billing accounts every 10 s for 30 minutes, the deployment every 30 s for 2 hours, Google Analytics every 15 s for 15 minutes after the card's Firebase console link; a failed check doubles the wait, up to 4 intervals | the specs drive the cards from outside | done (information) |
| CR-M2b-24 | setup-ui | integrator (docs, skills and mirrors, `docs/LESSONS.md`, `docs/research/M0-handoff.md`, `packages/ui/README.md`) | Document the Setup Assistant as built. `.agent/skills/web/admin_setup_assistant_skill.md` (*Implementation rules*): the controller over ports (`packages/admin/src/setup/ports.ts`), one flow per step, the bootstrap record's validation (no token, address or display name can pass: a parameter `redactText` would change is refused), polling and the countdown on the shell's clock, the input counters (CR-M2b-23), `createSetupModule` (CR-M2b-20); `packages/ui/README.md` and `ui_m3_adaptive_skill.md`: the admin's setup elements of `packages/ui/src/admin/setup/` and their tests; `docs/TESTING.md`: the admin unit tests over `packages/admin/test/setup/harness.ts`; M0 hand-off: the paths `packages/admin/src/setup/` and `packages/ui/src/admin/setup/`; the admin guides (CR-M2b-8): the cards' texts are `packages/shared/src/i18n/admin-setup/`. `docs/LESSONS.md`: (1) an element that measures its own window class with a `ResizeObserver` and changes its layout from the callback resizes the element it observes ("ResizeObserver loop completed with undelivered notifications"): `hcm-setup-page` follows only the width class and applies a change on the next animation frame (the kit's `WindowClassController` has the same risk on a content-sized host); (2) `Intl.NumberFormat` puts a no-break space (U+00A0) between the amount and the currency in `ro-RO`: tests compare with `\u00a0`; (3) Prettier reflows a long Lit template and the text gains its line breaks: tests trim `textContent`; (4) Lit's `live` directive is a dependency Vite optimises on first use (the cold-cache reload of `DECISIONS-for-review.md` §14): the crash switch sets itself back from its change handler instead | docs follow the code; the workstream reports, the integrator writes | done (integrator: the admin skill, `packages/ui/README.md`, `docs/TESTING.md`, the M0 hand-off, `docs/LESSONS.md` 45 and the tooling quirks) |
| CR-M2b-25 | setup-ui | integrator (the weekly `contract.yml`, with the user's yes for the probe) | Verify the project's Google Analytics integration page `https://console.firebase.google.com/project/{projectId}/settings/integrations/analytics` and, once it answers like the other Firebase console links, add it to `packages/admin/src/setup/links.json` as `gcp.analyticsIntegration` (setup-ui then links it from the analytics card in place of the console's home page, `gcp.firebaseConsole`, which is the only verified link today) | S-A22-BAD-ANALYTICS-NOT-ENABLED's deep link should open the exact page | open |
| CR-M2b-26 | admin-shell | admin-e2e (`scripts/site/` admin target, the e2e admin server) | Serve `/project.json` next to `index.html`: the production admin build copies `infra/project.json`, the e2e admin server answers `E2E_PROJECT_CONFIG` of `@hcm/test-support/fakes`. `loadProject` (`packages/admin/src/app/config.ts`) reads it with `parseProjectConfig` at boot; without it the shell runs, Setup says it is not available, and the log says `no project.json: the Setup Assistant is not available`. The page also serves `legacy/<city>/city.json`, which `setup.createCity` reads | the provisioner must not run against a project the page did not name (§3.7), and the e2e world's project differs from the real one, so one bundled file cannot serve both builds | done (integrator: the site build writes `project.json` from `infra/project.json`, `scripts/site/src/admin/project.ts`; the e2e admin server answers `E2E_PROJECT_CONFIG`) |
| CR-M2b-27 | admin-shell | contracts (this file §1.3–§1.7) | Record the shell as built where it differs from §1.7: `AdminDeps` adds `visibility`, `languages` (`navigator.languages`), `pages` (the `PageRegistry`), `telemetry` (a factory over the live language, window class and mode) and `setup` (a `SetupModuleSpec`, `packages/admin/src/app/services.ts`); `project` is any `{projectId, cities}` (google-clients' `ProjectConfig` when the page serves one); `AdminApp` adds `loadPage`, `telemetry` and `destroy`; the intents add `claim`, `join`, `enableApi`, `reload`, `setTheme`, `previewTheme`, `setConsent`, `dismissNotice`, `setWindowClass`, `listAdmins`, `inviteAdmin`, `revokeAdmin`; `HashLocation` adds `search`, `page` and `reload`; `localStorage` also keeps the theme (`hcm:admin:theme`) and the analytics answer (`hcm:admin:consent`, Addendum 2 stores it); `GoogleAuthError` carries a `code` (Firebase's, or `hcm/scope-denied`, `hcm/wrong-account`, `hcm/consent-failed`); in §3.2 a Service Usage 403 (the account cannot even read the project) is `notOwner` and an outage `backendDown`; a reload in start-up mode shows the sign-in panel asking for the read-only scope again (`gate.reconsent`), and a disabled Resource Manager is offered on that panel (`gate.enableApi`) | the contract stays the one source; `packages/ui/src/admin/admin-port.ts` and `packages/admin/test/app/admin-port.test.ts` already pin the shapes | done (recorded in the integration addendum below; `admin-port.ts` and its type test stay the pins) |
| CR-M2b-28 | admin-shell | contracts and integrator (with CR-M2b-1) | When `setup.createCity` joins the registry, admin-shell replaces `createCityCall` (`packages/admin/src/firebase/adapters.ts`: `httpsCallable(functions, 'setup-createCity')`, the answer read leniently) by `callables.call('setup.createCity', …)` | information: today it is called by its deployed name, so the step works as soon as the function is deployed | done (integrator: `setup-wiring.ts` calls `callables.call('setup.createCity', …)`; `createCityCall` removed) |
| CR-M2b-29 | admin-shell | admin-e2e and setup-ui | `cityBBox` of the Setup Assistant's host (the USGS access request's bounding box) is null today: the shell learns the city's bounds only when it fetches the bundled `city.json` for `setup.createCity`. Proposal: the site build writes the bounds into `project.json` (`cities` stays the list; a `bounds` map by city), or setup-ui reads them from `setup/status` once the city exists | the pre-written USGS justification can name the area | open |
| CR-M2b-30 | admin-shell | contracts (`packages/shared/`), integrator | One crash reporter for both apps: move the DOM-free parts of `packages/engine/src/telemetry/errors.ts` and `cookies.ts` into `@hcm/shared`, so `packages/admin/src/app/errors.ts` (which mirrors them, because dependency-cruiser forbids the admin importing the engine) and the engine share one copy | the planned jscpd gate (2 %) would count the copy; one place for the redaction and rate-limit rules | open |
| CR-M2b-31 | admin-shell | integrator (docs, skills and mirrors, `docs/LESSONS.md`, `packages/ui/README.md`) | Document the shell as built: `packages/ui/README.md` (the `@hcm/ui/admin` entry: shell, navigation, account menu, page outlet, `#/admins`, the auth panels and `hcm-consent-note`, `admin-port.ts`, `shellLayout`); `.agent/skills/web/admin_setup_assistant_skill.md` (the auth controller `packages/admin/src/auth/controller.ts`, the bootstrap check `packages/admin/src/auth/ownership.ts`, the Google port and its stand-in, the page registry and `registerAdminPage`, `ShellServices` and `SetupModuleSpec`, `/project.json`, `E2E_KIT` keeping the stand-in out of the production bundle); `.agent/skills/firebase/analytics_and_crash_skill.md` (the admin's GA4 on its default app after consent, `hcm:admin:consent`, crash reports to `telemetry.reportError` only once the server answers, as the `admin` service); `.agent/skills/web/i18n_skill.md` (the shell reuses the viewer's `language.*`, `theme.*` and `consent.*`); `.agent/skills/web/ui_m3_adaptive_skill.md` (bar, rail and expanded rail; the account button at the rail's foot on a landscape phone; the snackbar fixed above the bar); `docs/TESTING.md` (the shell's node fakes `packages/admin/test/app/fakes.ts`, the elements' `packages/ui/test/admin/shell/fake-app.ts`); `docs/LESSONS.md`: (1) `firebase/firestore`'s declarations name `Temporal`, so with `skipLibCheck` off the admin's tsconfigs add `esnext.temporal`; (2) `Object.assign` copies a getter's value, not the accessor: a test double of `document.cookie` needs `Object.defineProperty`; (3) Firebase may announce a popup's user before `signInWithPopup` resolves, so the controller evaluates each uid once and lets the click's own flow continue | docs follow the code; the workstream reports, the integrator writes | done (integrator: `packages/ui/README.md`, the admin, analytics, i18n and UI skills, `docs/TESTING.md`, `docs/LESSONS.md` 46 and the tooling quirks) |
| CR-M2b-32 | integrator | setup-ui, google-clients and contracts (`packages/admin/src/google/failure.ts`, `packages/admin/src/setup/billing.ts`, the A04 rows, `functions/src/setup/record-cloud.ts`) | Show a browser-side Google refusal as `adminSetup.cloud.permission` ("Your Google account lacks the role {role} needed here.") instead of `apiError.cloud.permission`, which blames the server's account; `setup.recordCloud` must then keep that reason (with CR-M2b-21 a) | the owner's own account is the one Google refused | open |
| CR-M2b-33 | integrator | contracts (§3.6) and setup-ui | The analytics card turns green when the measurement id is found and the next step opens, while its GA4 stream setting is still to do; either the step stays open until the stream setting is done, or the card says the setting is left. Today the owner reopens the card (navigation, not counted) | the stream setting is part of step (g)'s input budget | done (integrator: `withStep` keeps a green analytics card open while its stream setting is to do, `keepsOpen` in `packages/admin/src/setup/state.ts`) |
| CR-M2b-34 | integrator | setup-ui (`packages/ui/src/admin/setup/hcm-setup-page.ts`) | On extra-large windows the list and the detail pane (840 px at most) sit at the left with the rest of the width empty (the 2560 px review screenshots); centre the pair or let the detail grow to the M3 maximum | the large-screen layout of the review set | done (integrator: the page is at most 1256 px wide and centred) |

## Addendum A (2026-10-12, integrator): the admin as integrated

The four workstreams' code was wired into one admin and walked end to end by the owner's journey
(`e2e/admin/specs/journey.spec.ts`, behaviour rows of §5 flipped to `exists`): start-up mode, billing with no account
yet, provisioning with a failing item and its retry, the deployment and the automatic claim, Mapbox from a demo account to
a paid one, USGS from a pending role to the approval found by `ops.tick`, analytics with the GA4 stream setting, and the
45-photo import up to the city's manifest, at the four admin projects (compact, medium, expanded, English).

### A.1 The shell as built (CR-M2b-17, CR-M2b-27)

- `AdminDeps` adds `visibility`, `languages`, `pages` (the `PageRegistry`), `telemetry` and `setup` (a
  `SetupModuleSpec`); `project` is any `{projectId, cities}` (the page's `/project.json` when it serves one); `AdminApp`
  adds `loadPage`, `telemetry` and `destroy`; the intents add `claim`, `join`, `enableApi`, `reload`, `setTheme`,
  `previewTheme`, `setConsent`, `dismissNotice`, `setWindowClass`, `listAdmins`, `inviteAdmin` and `revokeAdmin`, and the
  Setup Assistant's own `draftUsgs` (the username and expiry date as typed).
- `localStorage` keeps the language (`hcm:admin:lang`), the theme (`hcm:admin:theme`) and the analytics answer
  (`hcm:admin:consent`). A Service Usage 403 in §3.2 is `notOwner`; an outage is `backendDown`; a reload in start-up mode
  asks for the read-only scope again on the sign-in panel.
- The provisioner's functions are `planProvision(observed, only)`, `applyProvision(plan, deps, onItem)` and
  `doctorProvision(deps, only, onItem)`; an item is `{id, after, observe}` whose observation carries its fix.

### A.2 What the integration changed

- **Backend**: `admin.claim` accepts the project's Google sign-in client, read from Identity Toolkit, when
  `HCM_OAUTH_CLIENT_IDS` is unset (CR-M2b-2; the e2e emulators no longer set it). `setup.createCity` (CR-M2b-1) creates the city **published**, since the bundled city is public on the old
  site: its manifest appears once `setup.saveMapbox` writes the viewer token (`DECISIONS-for-review.md` §25a). A
  scheduler item `pending` until the first deploy no longer holds the provisioning area back (CR-M2b-21 b). Two legacy
  photos are never each other's duplicate in `photos.onUpload` (the old site used one file at two spots).
- **The Functions emulator**: with fakes, secrets live in the fake Secret Manager (the emulator runs each function in its
  own process); the Admin SDK is told the task queue's service account (no metadata server, 14 s per enqueue otherwise);
  manifest tasks carry no id (the Cloud Tasks emulator dispatches at once). Deployed, nothing changes.
- **The Setup Assistant**: the billing button waits while the billing APIs are detected (a click before would ask the
  wrong scope); the start no longer replaces a card the owner opened meanwhile; the consent note follows the card's next
  popup (`scope`), so a done analytics card keeps it for the stream setting, and that card stays open until the setting
  is done (CR-M2b-33); the page is centred on wide windows (CR-M2b-34); the USGS username and expiry live in the
  state (a layout change re-creates the card); the legacy import ignores a `legacyId` shared by several records (the old
  site gave Bateriilor and Ferdinand the same one).
- **Hosting and the build**: `project.json` next to `index.html` (CR-M2b-26), `legacy/**` cached for a day (CR-M2b-5),
  `predeploy` running `npm run build:admin`, the root `build` and `build:site:e2e` completing the admin's folder
  (CR-M2b-9).
- **The e2e admin tier**: Google's 404 for a resource the provisioner reads before creating it is an expected console
  error; each test resets both worlds of the fake upstreams and the stand-in's consent records; a paste goes through
  the clipboard (`InputFlow.paste`); bad paths declare their input allowance and `SetupBudget.allowance()` takes it off the
  whole assistant's count; `EmulatorWorld.runOpsTick()` runs the scheduled tick (the server's clock cannot move, so the
  journey moves the check's time); `HCM_SCREENSHOTS` makes the journey save the review screenshots of every step.

### A.3 Still open

CR-M2b-3, CR-M2b-4,
CR-M2b-6 and CR-M2b-7 (ask first), CR-M2b-21 a, CR-M2b-25, CR-M2b-29, CR-M2b-30, CR-M2b-32.

## Addendum 2026-10-18: the start-up deploy and the release (follow-ups agent)

- **§1.4 step 2**: `runtime.json` is written by the admin's site build (`scripts/site/src/admin/runtime.ts`, so Hosting's
  `predeploy` produces it): `release` is `<root package.json version>+<short commit>` (the commit from `HCM_COMMIT`,
  `GITHUB_SHA` or the checkout's `HEAD`), which the boot log and every crash report name instead of `dev`; `startUp: true`
  when the deploy sets `HCM_ADMIN_START_UP=1` (a new map's Hosting-only deploy). The App Check site key joins it with the
  deploy milestone (§23b of `DECISIONS-for-review.md`).
- **§1.4 step 4**: a start-up deploy skips the anonymous probe: a function that is not deployed answers 404 without CORS
  headers, which the browser logs as an error whatever the request's mode (a `no-cors` fetch still logs "Failed to load
  resource"), and the live admin of 2026-10-17 showed it. Bootstrap mode starts at once; step (d) learns from Google that
  every function is `ACTIVE` and only then probes. A browser that has had the server's answer before
  (`hcm:admin:serverSeen` in `localStorage`) probes despite `startUp`, as the server has been installed since. Without
  `startUp` the probe runs as before (`S-A25-BAD-NO-START-UP-DEPLOY`).

## Addendum 2026-10-18: minimum input (adversarial reviewer)

- **Step (e) takes one input**: a pasted secret token is saved at once (no Save click), like the USGS paste; a public or
  malformed paste is explained and counted, nothing sent; a typed token goes with Enter or Save. `SETUP_STEP_SPECS`
  mapbox `inputs: 1`, so §3.5's `setupInputBudget()` is 9 inputs and 4 consents (was 10). `DECISIONS-for-review.md` §38a.
