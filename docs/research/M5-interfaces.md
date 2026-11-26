# M5 interfaces: multi-city, engine releases, the starter kit, create-historic-city and the static export

Written on 2026-10-25 by the M5 contracts agent, alone in the tree before the four M5 workstreams (multi-city, release,
kit-cli, export) start in parallel. Read it together with `PLAN.md` (*M5, multi-city*: engine releases on jsDelivr, the
starter-kit template repository, the `create-historic-city` bootstrap for self-hosting, the static export; the
*Architecture*: a data-driven engine from a CDN and a three-file city kit), `../ENGINE_API.md` (the engine's public
contract and its versioning rules), `M2-interfaces.md` (the Firestore model, `CLIENT_WRITES`, the callable plumbing,
the ports), `M2b-interfaces.md` (the admin's routes, the Setup Assistant, the provisioner, `project.json`),
`M2c-interfaces.md` (the list and detail layout, Settings, the tour), `M3-interfaces.md` and `M3-status.md` (the harvest,
the compute-unit guard, the daily job cap), `M4-interfaces.md` and `M4-status.md` (the notifications' fan-out, the
assists' caps), `../releases/README.md` and the `prepare-release`, `setup-assistant`, `e2e-scenarios` and `firebase`
skills.

Everything marked **done** exists and is tested (100 % lines and branches per file); everything else is a contract the
owning workstream implements exactly as written. A change to anything here goes through
[Change requests](#change-requests), never by editing another workstream's files. Nothing in M5 calls a real Google,
Mapbox, USGS, STAC, Nominatim, Vertex AI, OpenStreetMap, npm or jsDelivr endpoint, creates a cloud resource or a GitHub
repository, deploys, publishes to npm, pushes or tags, and nothing is downloaded: every test runs against the Firebase
emulators (project `demo-hcm`), the shared fakes of `@hcm/test-support`, the e2e mock servers (jsDelivr among them) and
fake command-line tools on `PATH`. Each of those human or ask-first steps is prepared with its exact command (§2.6,
§3.5, §4.6, §11). Facts that could not be checked without a real account or a real tag are marked **UNVERIFIED**, each
with how the first real run proves it (§10).

## 0. What this contract decides

1. **Many cities in one project** (§1): membership lives on the admin's own document, `admins/{uid}.cities`, a map of
   city id to role (`owner` or `editor`), written by the functions only. The project's owner (the account that claimed
   the project) creates cities and sets their budgets; a city's owner invites and removes its admins and exports it; an
   editor edits its content. The rules read the membership with one `get` per request and close every city path to the
   admins of other cities; every callable that takes a `cityId` checks it after validating the request. The admin gains
   a city switcher (addresses `#/c/<city>/...`, one city per page load) and a **New city** flow of three inputs (two since
   the reviews' `cities.locate`, §1.6): a name,
   a rectangle dragged on the map, Create. The first USGS harvest of a new city runs at the next `imagery.tick`; a new
   city starts empty and unpublished (the legacy import stays Bucharest's). Each city may get a share of the project's
   budgets (`cities/{city}.limits`, counted in `cities/{city}/usage/{month}`); the project's own caps still hold. The
   public sites are `sites/<city>/`, built into `dist/site/<city>/` and assembled into one GitHub Pages tree with
   Bucharest at the root (its old links keep working) and every other city at `/<city>/`.
2. **Engine releases on jsDelivr** (§2): the first release is **v1.0.0** (the v1 surface of `ENGINE_API.md`). Every
   `package.json` of the repository, `ENGINE_VERSION` and the starter kit's pins carry the same version. The release
   commit holds the built engine in `cdn/engine/` (the files of `packages/engine/dist` without source maps) with
   `cdn/engine/release.json`: the version, the pinned base address and the SHA-384 Subresource Integrity of every file
   (`engineReleaseSchema`, done). jsDelivr serves it at
   `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@vX.Y.Z/cdn/engine/<file>`. The `release` stage
   gains the gates that tie the tag, the versions, `cdn/engine/`, `release.json` and the kit's pins together; the
   workflow's publishing additions (attaching `release.json` and the CLI's package to the GitHub Release, the jsDelivr
   purge of the `@1` alias) are proposals for the user's yes. The first release is prepared (versions, both
   release-note files, `cdn/engine/`), never tagged.
3. **The starter kit** (§3): `templates/starter-kit/` holds the three files a city owner needs: `index.html` (a meta
   Content Security Policy, Mapbox GL JS 3.32.0 from api.mapbox.com and the engine's IIFE and stylesheet from the pinned
   jsDelivr folder, each with `integrity`, and `<hcm-map-viewer manifest-url="city.json">` with a bilingual loading
   note that stays when the engine cannot load), `city.json` (a City Manifest v1: an example city with places and no
   photos, whose rights would not travel) and `README.md` (Romanian and English). A later, ask-first step turns the
   folder into a GitHub template repository. An e2e tier boots it against the mock world.
4. **`create-historic-city`** (§4): a self-host bootstrap CLI in `packages/create-historic-city/` (Node 24, no runtime
   dependency: one bundled file), run as `npm create historic-city@1`. It scaffolds a city folder from the kit with
   minimum input, and, for a Firebase project of the owner's own, walks the human steps by running the owner's own
   `firebase` and `gcloud` (one `y/N` consent per step) and opening the right pages, never asking for, typing or
   printing a credential; `--dry-run` prints everything and changes nothing; every test runs on fakes. Publishing it to
   npm is a prepared, ask-first step.
5. **The static export** (§5): a city owner exports the city in two inputs (Export, Download) as a zip that serves the
   city from any static host with no Firebase: the kit's page with the engine beside it, the published manifest as
   `city.json` with relative photo addresses and without the project's analytics ids, the photos' public files, a
   README, `RIGHTS.md` (the photos licensed for this map only) and, when asked, the scans of the USGS layers (public
   domain); other layers keep their tile references. The zip is built by a task into the private bucket and downloaded
   through a signed address that lives 15 minutes.
6. **Ownership** (§6): four workstreams; release is also the integrator (docs, the agent assets, the status file, the
   prepared release) and works last; the shared files' marked sections; the order of work; the change-request process.

Done by this contract (CR-M5-1): the shared schemas and pure helpers `packages/shared/src/schemas/cities.ts` (a city id's checks and rectangle since 2026-11-12 in `city-id.ts`, which imports no schema, re-exported: docs/LESSONS.md 593),
`city-export.ts` and `engine-release.ts`; the API schemas `packages/shared/src/api/cities.ts` and `city-export.ts`; the
paths `FIRESTORE_PATHS.cityUsage`, `.cityExports`, `.cityExport` and `STORAGE_PATHS.cityExport`; the system writers
`cities` and `export`; thirteen error codes in both languages (`apiError.city.*`, `apiError.export.*`); the catalogue
folders `packages/shared/src/i18n/admin-cities/` and `admin-export/` merged into `translateAdminContent`, and the
switcher's `adminShell.city.*` texts; the M5 input budgets (`packages/admin/src/content/budgets.ts`, sections `cities`
and `export`); the tour inventory's empty M5 sections (`e2e/tour/states.ts`); the 56 planned scenario rows of nine new
behaviours (§7.1) and the regenerated `docs/E2E_SCENARIOS.md`; the decisions log (`DECISIONS-for-review.md` §58). No
registry row, function, rule, screen or workflow changed: each joins with its implementation (§6).

## 1. Multi-city (multi-city)

### 1.1 What is per city today, and what still assumes Bucharest

The backend was written per city from M2 (`cities/{city}/**`, `manifests/{city}`, `ops/harvest-{city}`, a `cityId` on
every callable request, history entries and notification events, `STORAGE_PATHS` with the city segment) and its
schedulers already walk every city (the nightly manifest rebuild, the monthly harvest, the dispatcher, the tileset cap of
the Mapbox account). What still assumes one city, found by searching for `bucharest`, `București`, `cities[0]` and
`isAdmin()`:

| Where | Today | M5 |
| --- | --- | --- |
| `firebase/firestore.rules` | `isAdmin()` guards every `cities/{city}/**` match, `manifests/{city}`, `ops/*` and the history collection-group list; any admin reads every `admins/{uid}` and every invitation | membership functions (§1.4): every city path needs a role in that city; `admins/{uid}` is readable by its owner and the project owner; invitations by the project owner (city owners list theirs through `admins.list`) |
| `firebase/storage.rules` | `isAdmin()` and `ownUpload` for uploads; any admin reads every private object | the uploader is a member of the path's city; private reads per city prefix (§1.4) |
| `functions/src/api/access.ts` | `requireAccess`: `signedIn` or `admin` | adds `cityEditor`, `cityOwner`, `projectOwner` (§1.3) |
| `packages/shared/src/api/registry.ts` | every callable `access: 'admin'` | the M5 access per callable (§1.3), changed with `requireAccess` in one change |
| `functions/src/notify/` (`notify.onEvent`) | fans every event out to every admin | a city's event to that city's members, a project event to every admin (§1.9) |
| `functions/src/api/notification-event.ts` | links `#/<route>` | a city's event links `adminCityLink(cityId, route)` (`#/c/<city>/<route>`, done) |
| `functions/src/imagery/limits.ts`, `publish-guard.ts`, `functions/src/assist/` | project caps only | plus the city's share (§1.8) |
| `functions/src/setup/create-city.ts` | creates the bundled city | also records the caller as its owner (`admins/{uid}.cities`) |
| `packages/admin/src/app/content-services.ts`, `shell-watches.ts`, `content/services.ts` | the content city is `project.cities[0]` (the `e2e` build: `?city=`) | the shell's current city (§1.5); the e2e worlds address theirs with `#/c/<city>/` |
| `packages/admin/src/app/setup-wiring.ts` (`DEFAULT_CITY`), `packages/admin/src/index.ts` (`projectOf`) | the bundled city | unchanged: they name the bundled city whose legacy seed the admin build ships; the admin's own cities come from `admin.session` |
| `packages/admin/src/routing/routes.ts` | `#/<route>[/<id>[/<id>]]` | an optional `#/c/<city>/` prefix (§1.5) |
| `packages/ui/src/admin/setup/setup-text.ts` | dates in `Europe/Bucharest` | the admin's own time zone (as M4's §57 did for orders) |
| `infra/project.json` `cities` | the project's city | the bundled cities: the ones whose sites and legacy seed this repository holds (a city created in the admin needs no entry) |
| `scripts/site/src/cli.ts` (`DEFAULT_SITES`) | `sites/bucharest` and `starter-kit` | every `sites/*/` with a `site.json`, then `starter-kit`; a Pages tree (§1.10) |
| `.github/workflows/ci.yml` | uploads `dist/site/bucharest` to Pages | uploads `dist/pages` (§1.10; a proposal, ask first) |
| `packages/test-support/src/fakes/project.ts` | `cities: ['bucharest']` | unchanged; the multi-city fakes add a second city and its members |
| `scripts/site/src/admin/legacy.ts` (`legacy/bucharest`) | the legacy bundle | unchanged: the legacy import is Bucharest's and no other city gets one |
| `packages/shared/src/schemas/assist.ts` (`NOMINATIM_USER_AGENT`) | names this repository | unchanged: it identifies the software |

What stays the project's, shared by its cities: the Firebase project and its two buckets, the Mapbox account (one secret
token, its 24-tileset cap and its monthly compute units), the USGS account, the Google Cloud budget and its guard
(`ops/guard` pauses every city's imagery, never a site), the Setup Assistant, the crash reports, the GA4 property.

### 1.2 Roles and membership

- `admins/{uid}` keeps `role` (`owner`: the account that claimed the project; `admin`: any other) and gains `cities`
  (`cityRolesSchema`, done): `{ "<cityId>": "owner" | "editor" }`, at most `MAX_CITIES` (20) entries, written by the
  functions only (`system:cities`). The custom claim stays `admin: true`; the city roles are never in the token (a
  removal takes effect at once, and a token stays small). `admin.claim` writes a new owner's document with `cities: {}`
  (never without the field, the mark of a document from before M5) and `setup.createCity` then adds the bundled city
  (`docs/LESSONS.md` 258).
- **Who does what.** The project owner: creates cities (`cities.create`), sets their budgets (`cities.setLimits`), runs
  Setup; is the owner of every city they create. A city's `owner`: everything an editor does, plus invites, roles and
  removals of that city's admins, the export. An `editor`: the city's content (photos, places, layers, imagery, settings
  but its budget). `hasCityRole(roles, city, needed)` (done) is the one rule: an owner may act as an editor.
- **A city keeps one owner at least** (`apiError.city.lastOwner`). Removing an admin from their last city deletes
  `admins/{uid}` (and, as M4's `admins.revoke` does, their inbox, push devices and settings).
- **Migration.** A document without `cities` (every admin before M5) gets `legacyCityRoles(role, every city id)` (done):
  the project owner owns every existing city, every other admin edits them all, as they did before M5. `admin.session`
  migrates the caller's own document before answering; `ops.tick`'s new step `memberships` migrates the others, so the
  rules never lock out an admin who has not signed in since. Until then the rules treat a document without `cities` as
  no membership (fail closed).
- **Invitations** (`invites/{sha}`) gain `cities` (`cityRolesSchema`): inviting the same address to a second city adds
  that city to the pending invitation; `admin.join` grants every city it names.

### 1.3 Access in the functions

`CallableAccess` gains three values, implemented in `requireAccess` and set in the registry in **one** change (a
registry value without its check would admit any signed-in admin):

| Access | Who passes | Checked |
| --- | --- | --- |
| `cityEditor` | an admin (claim and document) with any role in the request's `cityId` | after the request is validated, before the handler reads or writes anything: `apiError.city.notMember {cityId}` |
| `cityOwner` | an admin who owns the request's `cityId` | as above: `apiError.city.notMember` for a stranger, `apiError.city.notOwner {cityId}` for an editor |
| `projectOwner` | the admin whose `admins/{uid}.role` is `owner` | `apiError.city.notProjectOwner` |

`AdminDirectory` (`functions/src/ports/admin-directory.ts`) gains `roleIn(uid, cityId): Promise<CityRole | null>` and
`projectRole(uid)`; one read of `admins/{uid}` serves both checks of a call. The access of every callable:

| Access | Callables |
| --- | --- |
| `signedIn` | `admin.session`, `admin.claim`, `admin.join` (unchanged) |
| `admin` | `notify.*` (own devices), `setup.status`, `setup.selfTest`, `telemetry.listGroups` (project facts, read-only) |
| `cityEditor` | `imagery.*` but `imagery.resumeGuard`, `usgs.*`, `layers.*`, `photos.reprocess`, `publish.rebuildManifest`, `history.revert`, `assist.*`, `admins.list` |
| `cityOwner` | `admins.invite`, `admins.revoke`, `admins.setRole` (new), `setup.rotatePublicToken`, `export.start`, `export.download` |
| `projectOwner` | `cities.create`, `cities.setLimits`, `imagery.resumeGuard` (the project's budget guard), `setup.recordCloud`, `setup.createCity`, `setup.saveMapbox`, `setup.saveUsgs`, `setup.analyticsConfig` |

`admin.session`'s answer gains `cities` (`sessionCitiesSchema`, done: id, role and name of each of the caller's cities,
for the switcher) and `projectOwner` (a boolean). The admins callables take the M5 shapes (done:
`cityInviteRequestSchema`, `cityRevokeRequestSchema`, `citySetRoleRequestSchema`, `cityAdminsListRequestSchema` and
`cityAdminsListResponseSchema`); the registry rows switch to them with their handlers.

### 1.4 Rules: every city closed to the others

`firebase/firestore.rules` gains, beside `isAdmin()` (unchanged: a verified Google account, the claim, the document):

```text
function adminDoc()          get(/databases/$(database)/documents/admins/$(request.auth.uid)).data
function cityRole(city)      adminDoc().get('cities', {}).get(city, '')
function isCityMember(city)  isAdmin() && cityRole(city) in ['owner', 'editor']
function isCityOwner(city)   isAdmin() && cityRole(city) == 'owner'
function isProjectOwner()    isAdmin() && adminDoc().role == 'owner'
```

The `exists` and the `get` of the same document count as one read of a request. Matches:

- `cities/{city}` and every subcollection (photos, layers, POIs, categories, jobs and logs, layer versions, scenes,
  history, `usage`, `exports`): every `isAdmin()` becomes `isCityMember(city)`; the client write lists stay as they are,
  so `limits` (set by `cities.setLimits`), `usage/*` and `exports/*` have no client write rule at all.
- The history collection-group list: `isCityMember(resource.data.cityId)`, which the query's own
  `where('cityId', '==', <city>)` lets the rules prove (**UNVERIFIED** for a `get()`-backed condition until the rules
  tests run it on the emulator; the fallback is a per-city index `cities/{city}/recentHistory` written by the history
  trigger, a change request to multi-city).
- `manifests/{city}`: `isCityMember(city)`. `ops/harvest-{city}`: a member of that city, failing closed for any other
  `ops` id that is not a project document (`ops/guard`, `ops/dispatch`, `ops/assist`, `ops/crashes` stay `isAdmin()`:
  non-sensitive project state every city's screens show).
- `admins/{uid}`: read by its own account and by the project owner; `invites/*`: the project owner only.
- `setup/*`, `usage/*` (the project's counters), `assistGeocodes/*`: `isAdmin()` (project facts, no city's content).
- Storage: `ownUpload` also requires the uploader's membership of `{city}` (a `firestore.get` of the same admin
  document); the private catch-all read becomes one match per prefix whose city segment is known
  (`uploads/photos/{city}/**`, `uploads/rasters/{city}/**`, `originals/photos/{city}/**`, the `RASTER_PATHS` prefixes),
  each `isCityMember(city)`; `exports/**` and any object path with no city stay server-only (an export leaves only
  through its signed address, §5.5).
- Tests (`firebase/rules-tests/test/cities.test.ts`): a persona "editor of another city" joins the matrix; every row of
  the existing allow matrix runs once for a member (allowed) and once for that persona (denied); the rule-coverage gate
  keeps every new expression evaluated.

### 1.5 The city switcher (the shell)

- **Addresses.** `#/c/<city>/<route>[/<id>[/<id>]]` names a city; `#/<route>...` means the current one. The router
  (`packages/admin/src/routing/routes.ts`) parses the prefix into `AdminRoute.cityId`; `adminCityLink` (done) builds it
  and keeps the inbox's `ADMIN_LINK_PATTERN`. An admin of one city never sees the prefix and every M2–M4 address keeps
  working (S-A49-HAPPY-ONE-CITY); an admin of two cities or more gets the prefix written into the address bar
  (`history.replaceState`), so a copied address opens the same city. An empty address stays empty until the page it
  opens names a city: Setup (a project page) keeps it empty, so Setup's first readiness answer can still open the
  city's dashboard (S-A49-HAPPY-FIRST-SCREEN, S-A49-BAD-FIRST-SCREEN-INCOMPLETE; `docs/LESSONS.md` 257).
- **The current city**: the address's city when the admin belongs to it, else the city chosen last in this browser
  (`localStorage` `hcm:admin:city:<uid>`, a convenience that may be missing), else the first of `admin.session.cities`
  by name in the admin's language. An address naming a city the admin does not administer opens the current one with
  the snackbar `adminShell.city.notMember` and reads nothing of the other city. An admin with no city sees
  `adminShell.city.none` (the project owner sees New city instead).
- **Switching is a page load**: the shell writes `#/c/<new>/home` and reloads (`AdminWindow.location.reload()`), after
  the unsaved-changes guard of the editors. Every area module, listener and draft belongs to one city, and a reload is
  the one way that cannot leave a listener of the previous city behind (the e2e firewall records the Firestore listens).
- **Where**: the top bar from the medium window class (the current city's name as a menu button), the account menu on a
  compact window; shown only to an admin of two cities or more, or to the project owner (whose menu ends with New
  city). The menu lists each city with its role (`adminShell.city.role.*`) and asks `admin.session` again when it
  opens (at most once a minute), so a city an admin was just added to appears without a reload. Input budget
  `switchCity`: 2 (done).
- **Pages per scope.** City pages: Home, Photos, Places, Layers, Imagery, Jobs, Settings, Admins, History, the
  georeferencer. Project pages: Setup, Crash reports, the inbox (each item links its own city). `ADMIN_ROUTE_SPECS` gains
  `scope: 'city' | 'project'`.

### 1.6 New city: the guided flow (two inputs)

Route `#/cities/new` (a project page; the menu's New city), a lazy chunk `cities` with its budget. The M5 reviews' fixes
(`DECISIONS-for-review.md` §65) made it two inputs: once the name rests (`LOCATE_AFTER_MS`, 800 ms), `cities.locate`
(`projectOwner`, `fn-cities`, as `fn-admin@`; `citiesLocateRequestSchema` `{name}` →
`citiesLocateResponseSchema` `{bounds | null, place?}`) asks Nominatim's `/search` once, at the mirror beside
`HCM_NOMINATIM_URL`, and answers the place's box fitted to `CITY_SPAN_LIMITS` (`cityAreaAround`); nothing while the title
suggestions' cool-down holds, and a refusal starts it. The page draws that rectangle, flies the map to it and names the
place; a rectangle the admin drags or types is never replaced. A name nothing has leaves the drag below (three inputs,
the input budget `newCityDrawn`).

```text
New city
  the Romanian name (1 fill) ──► the id follows it (suggestCityId: cluj-napoca, iasi, ...; editable, never required;
                                 one no city may take is said at its field) and cities.locate draws the city's rectangle
                                 the English name: optional (it falls back to the Romanian)
  the map: or drag one rectangle over the city (1 drag) ──► cityBoundsProblem: under 0.01° or over 2° a side → the
                                 reason, Create off
  the seed colour: NEW_CITY_SEEDS[0] chosen (Settings changes it later with the live preview)
  Create the city (1 click) ──► cities.create {cityId, name, bounds, theme}
       └─ done screen: "<city> was created", not public yet, the first harvest under way;
          Add photos · Draw places · See the historical imagery; the public site's address (§1.10)
```

`cities.create` (`projectOwner`; `citiesCreateRequestSchema`, done; the theme's four schemes are computed in the browser
by `themeFromSeed` of `@hcm/ui/dynamic-color`, as Settings does):

1. Refuses a reserved or malformed id (`RESERVED_CITY_IDS`: the folders of a site and an export, the admin's words),
   bounds outside `CITY_SPAN_LIMITS`, the twenty-first city (`apiError.city.tooMany {max}`), and an id another city
   uses (`apiError.city.idTaken {cityId, suggestion}`, the suggestion from `suggestCityId(name, taken)`). An existing
   city whose owner is the caller answers `{created: false}` (a retried call) and writes nothing.
2. In one transaction: `cities/{cityId}` with the name, the bounds, `startViewForBounds` (done: centre, a zoom that fits
   the rectangle in 1024 × 768 px, `minZoom` three levels out, `maxZoom` 20), About and privacy texts made from the
   name (Romanian and English, the M1 starter kit's wording), the default basemap, the theme, `published: false`, the
   imagery defaults, `limits: DEFAULT_NEW_CITY_LIMITS` (done), `createdAt`; and `admins/{uid}.cities[cityId] = 'owner'`.
3. After the transaction, best effort: the viewer's Mapbox token minted as `setup.rotatePublicToken` does (when Mapbox
   is set up; else the Setup's Mapbox card mints one for every city without a token when the secret is saved), the
   project's GA4 ids copied from `setup/status`. A failure here leaves the city valid; Settings shows what is missing.
4. **The first harvest needs no call**: a city without `ops/harvest-{city}` is due, so the next `imagery.tick` (five
   minutes at most) searches its bounds; the done screen links the Imagery area, which shows the search under way.
5. **Legacy-free**: no legacy import, no photo; the Setup Assistant's legacy step stays the bundled city's.

Budget `newCity`: 3 inputs (done). The public site of a new city is a repository change (§1.10); the done screen shows
its address once it exists, else the note `adminContent.cities.created.siteLater`.

### 1.7 Per-city admins

- The Admins page lists the current city's admins and invitations (`admins.list {cityId}`), each with its role; an
  owner sees Invite (`inviteToCity`: Invite, the address, Invite; the role is `editor` unless changed; the link copied
  at once, as M2c §38c), Remove and the role menu (`setCityRole`, 3 inputs). An editor sees the list only.
- `admins.invite {cityId, email, role}`, `admins.revoke {cityId, kind, ...}`, `admins.setRole {cityId, uid, role}` and
  `admins.list {cityId}`: the shapes of §1.3. The project owner of a city they created is shown as such and keeps at
  least the owner role there unless another owner exists.
- The editors' conflict banner names who saved (M2c §42c) from `admins.list {cityId}`: only the city's admins.

### 1.8 Per-city budgets and the compute-unit guard

| Limit (`cityLimitsSchema`, done) | Counted | Refusal |
| --- | --- | --- |
| `computeUnitsPerMonth` | `cities/{city}/usage/{YYYY-MM}.computeUnits` and `reservations`, in the same transaction as the project's `usage/mapbox-YYYY-MM` | `apiError.city.budgetReached {estimate, available}`, with the M3 over-budget offers (defer, Studio, pay) |
| `rasterJobsPerDay` | the city's jobs created today (the M3 query, per city) | `apiError.imagery.dailyLimit {limit}` |
| `aiRequestsPerMonth` | `cities/{city}/usage/{month}.aiRequests` beside `usage/ai-YYYY-MM` | `apiError.assist.monthlyCap` |
| `geocodeCellsPerDay` | `geocodeDay`, `geocodeToday` of the city's usage document | `apiError.assist.dailyCap` |
| `exportsPerDay` | the city's exports created today | `apiError.export.dailyLimit {limit}` |

- A city without `limits` (Bucharest, created before M5) is held by the project's caps only; `cities.create` gives a new
  city `DEFAULT_NEW_CITY_LIMITS` (a quarter of the free compute units, three raster jobs a day, 100 AI drafts a month,
  100 title suggestions a day, three exports a day). The project's caps always hold too.
- `cityComputeUnitsAvailable(limits, usage, versionId)` (done) is the city's side of `guardVerdict`: `GuardInput` gains
  `cityAvailable` and the verdict `city-over`, mapped to `apiError.city.budgetReached`.
- Settings gains the section **The city's budget** (lazy chunk `city-budget`): the five limits with what is used this
  month; editable by the project owner only (`cities.setLimits`, `setCityLimits`: Save plus one input per field moved),
  read-only with `adminContent.budgets.ownerOnly` for everyone else.

### 1.9 Notifications per city

`notify.onEvent` fans an event with a `cityId` out to that city's members only (`admins` whose `cities` names it); an
event without one (`budget.paused`, `crash.spike`, `usgs.approved`) to every admin, as in M4. Producers build city links
with `adminCityLink`. `notify.registerDevice` and the push settings stay per admin.

### 1.10 Public sites and the GitHub Pages layout

- **A city's site** is a committed folder `sites/<city>/` (`site.json`, `config.js`, `site.css`, the M1 format) whose
  `config.js` names the city. `site.json` gains `pagesPath`: `""` for the site served at the root (Bucharest, so the
  2015–2022 links and the M1–M4 links keep working), `"<city>/"` by default. A site without a seed manifest has
  `publicManifest: true` and is built only when the build names the bucket (`HCM_PUBLIC_BUCKET`); without one the CLI
  skips it with a notice (the e2e build gives it a fixture manifest).
- **The build** (`npm run build:site`): every `sites/*/` with a `site.json` (sorted), then `starter-kit`, each into
  `dist/site/<folder>/` as today; then `--pages dist/pages` assembles the Pages tree: each site copied to its
  `pagesPath`, refusing two sites on one path and a city path that is a file or folder of the root site (the reserved
  ids make that impossible for a valid id). `starter-kit` is never in the Pages tree.
- **Adding a city's site** (a repository step, never the admin's: the admin holds no GitHub credential):
  `npm run site:add -- --city <id> --name-ro <name> --theme <#rrggbb>` writes `sites/<id>/` from the M1 files; the
  change is pushed like any other (ask first).
- **The deploy**: `ci.yml` uploads `dist/pages` instead of `dist/site/bucharest` (one line, a proposal: §11). Until a
  second site exists both trees are identical.
- One origin for every city (`https://ventura8.github.io`): each city's viewer token is restricted to it, as today.

## 2. Engine releases (release)

### 2.1 What is versioned

The engine's public surface (`ENGINE_API.md` → *Versioning and compatibility*): the `HistoricCityMap` global and the
module build's exports, `<hcm-map-viewer>` and its events, `config.js`, the URL hash v1, the City Manifest v1. **The
first release is v1.0.0**: everything `ENGINE_API.md` lists as the v1 baseline, the M4 compare additions included. A
later release is a patch (fixes), a minor (an optional field or a new API name, with `city.engine.minVersion` set by the
manifest builder), or a major (a manifest v2, a removed name; it documents the migration in its notes).

**Pre-releases (2026-11-12, `DECISIONS-for-review.md` §160):** a tag may also be `vX.Y.Z-beta.N` or `vX.Y.Z-rc.N`
(nothing else). It is a GitHub pre-release never marked latest, pinned on jsDelivr only at its full version (no `@1`
line in its notes, no purge), and published to npm under the dist-tag `beta` / `rc`, never `latest`. The first tag is the
pre-release **v1.0.0-beta.1**; v1.0.0 follows the betas.

### 2.2 One version everywhere

`vX.Y.Z` is in: the root `package.json`, every workspace's `package.json` (`create-historic-city` among them, so
`npm create historic-city@X.Y.Z` makes kits pinned to engine X.Y.Z), every dependency of a workspace on another
workspace (`"@hcm/shared": "X.Y.Z"`: npm resolves a workspace only at its exact version), `ENGINE_VERSION`,
`cdn/engine/release.json`'s `version`, and the pins of `templates/starter-kit/index.html`. The release workstream's
`scripts/release/bump.ts` rewrites them all and refreshes the lockfile offline in the pinned `node:24-bookworm-slim`
image (no download: every package is already in the lockfile); `scripts/ci/check_release.py` checks every one.

### 2.3 The engine in the tree: `cdn/engine/`

- jsDelivr's GitHub route serves the files of a tag, and `dist/` is ignored, so **the release commit holds the built
  engine in `cdn/engine/`**: every file of `packages/engine/dist` but the source maps (`engine.iife.js`, `engine.mjs`,
  its chunks `compare-<hash>.js` and `firebase-sdk-<hash>.js`, `engine.css`, `fonts/`, `i18n/` (the viewer's sixteen languages, fetched when shown: DECISIONS-for-review.md §218), `THIRD_PARTY_NOTICES.txt`), each
  file's last `//# sourceMappingURL=` line removed (the maps are attached to the GitHub Release instead). About 1 MB;
  `cdn/engine/` is replaced, never added to, so the tree holds one release at a time and each tag keeps its own.
- `cdn/engine/release.json` (`engineReleaseSchema`, done): `version`, `repository`, `base` (the pinned folder,
  `engineCdnBase`), `mapboxGl` (3.32.0 and the integrity of its script and stylesheet on api.mapbox.com, the digests
  `scripts/site/src/sri.ts` computes from the pinned npm release), and `files` (every path with its bytes and
  `sha384-` integrity; never `release.json` itself). Written by `scripts/release/cdn.ts`
  (`npm run release:cdn`) from a fresh `npm run build --workspace @hcm/engine`.
- The gates that keep it honest (the pre-approved kind: stricter; logged by release):
  - `kit-pins` (static): `release.json` is valid, its integrity values are the digests of the committed files, and
    `templates/starter-kit/index.html` names exactly `release.json`'s version, base and the integrity of
    `ENGINE_PAGE_FILES` and of Mapbox GL JS. Before the first release (no `cdn/engine/`) it checks the page's shape only.
  - `release-cdn` (release stage): the tag is `v<release.json.version>`, and `cdn/engine/` equals, byte for byte, a fresh
    build after the same map-line transform (**UNVERIFIED** that the Vite build is reproducible across machines until
    the stage runs in CI and on the NUC).
- Static gates and `cdn/engine/` (minified third-party code): the release workstream first measures which gates read
  the folder (Prettier, ESLint, the suppression scan, EditorConfig, markdownlint of `fonts/LICENSES.md`, gitleaks, the
  repository budget). Ignoring a generated folder in Prettier's or ESLint's own ignore file keeps a tool working (the
  pre-approved kind); an exclusion from the suppression scan, gitleaks or EditorConfig is a relaxation: a NOT APPLIED
  proposal for the user (§58 of the decisions log).

### 2.4 The jsDelivr addresses

| Use | Address | Integrity |
| --- | --- | --- |
| A pinned page (the kit, every city that copies it) | `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@v1.0.0/cdn/engine/engine.iife.js` and `engine.css` | yes: `release.json`'s values |
| The fonts, chunks and extras | the same folder (`engineBase` is the script's folder) | not needed on the page: the IIFE carried the chunks inline until 2026-11-12, and since loads them as its extras with the integrity the build wrote into it (`DECISIONS-for-review.md` §186); fonts are not scripts |
| A page that follows the 1.x line | `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@1/cdn/engine/engine.iife.js` (`engineMajorBase`) | never (the file changes under it) |

Helpers (done): `engineCdnBase`, `engineCdnUrl`, `engineMajorBase`, `releaseTag`, `versionOfTag`, `releaseIntegrity`.
Bucharest keeps serving the engine of its own commit from its own origin (unchanged).

### 2.5 The release stage and the workflow

- `PIPELINE_STAGE=release` (in `release.yml`'s read-only `build` job) runs `release-check` (extended: every version of
  §2.2, both notes files, the notes' SRI table equal to `release.json`), `release-cdn`, `kit-pins`, `vite-build`,
  `bundle-budget`, `notices`, and `npm pack` of `create-historic-city` into `reports/release/` (§4.6).
- **Proposals for the user** (workflow edits that publish more; ask first; exact diffs in §58): upload `cdn/engine/` and
  the CLI's `.tgz` with the release files, attach `engine-release.json` (a copy of `release.json`), the engine's source
  maps and `create-historic-city-X.Y.Z.tgz` to the GitHub Release; after it, purge the `@1` alias on jsDelivr
  (`https://purge.jsdelivr.net/gh/ventura8/historic-city-map-maker@1/cdn/engine/<file>` per file; the exact tag
  needs no purge, jsDelivr caches a tag's files for good). The SonarQube gate of the same commit (planned since M2) is
  the pre-approved kind when it reuses the SHA-pinned actions `ci.yml` already pins; else a proposal too.
- `docs/releases/vX.Y.Z_github_description.md` carries a table of the pinned addresses and their integrity, generated by
  `scripts/release/notes-sri.ts` from `release.json` and pasted into the file (the gate compares).

### 2.6 The first release, prepared and not tagged

At the end of M5, after every workstream landed and `all` is green (but for the four audit gates waiting for the user):

1. `scripts/release/bump.ts 1.0.0`; `npm run release:cdn`; the kit's pins rewritten from `release.json`
   (`scripts/release/pin-kit.ts`, through the kit page's `fillKitPage`, §3.2).
2. `docs/releases/v1.0.0.md` and `docs/releases/v1.0.0_github_description.md` (H1 `# Release v1.0.0 - <title>`), the
   releases index updated; no test counts.
3. `PIPELINE_STAGE=release` with `--tag v1.0.0` (`check_release.py --tag` checks before tagging), then `all`.
4. The commands for the user's yes, one at a time, printed in the release's report and in `M5-status.md`:
   `git push origin feat/engine-rewrite`, the merge to `master` (a pull request, ask first), then
   `git tag -a v1.0.0 -m "v1.0.0"` on the merged commit and `git push origin v1.0.0` (the pre-push hook requires the
   green `all` marker of that commit).

## 3. The starter kit (kit-cli)

### 3.1 Three files

`templates/starter-kit/` (a new top folder; kit-cli adds `templates/` to the agent-asset checker's `PATH_ROOTS`, a
stricter gate):

| File | Role |
| --- | --- |
| `index.html` | the page: CSP, Mapbox GL JS, the pinned engine, `<hcm-map-viewer manifest-url="city.json">` |
| `city.json` | a City Manifest v1 the owner edits (no `config.js`: the element's attributes are the configuration) |
| `README.md` | the steps in Romanian and English |

The M1 folder `starter-kit/` stays: it is the site build's same-origin variant (`config.js`, the engine copied beside
the page) that the M1 rows S-V17-* test; its README's first step points to the template.

### 3.2 `index.html`

- Committed and linted as it is (htmlhint, html-validate with `require-sri`, Prettier: the first committed `.html` file,
  as decisions §26 foresaw). No inline script or style. In order:
  1. `<meta http-equiv="Content-Security-Policy">` first: `default-src 'none'`; `script-src` api.mapbox.com's
     `/mapbox-gl-js/`, the pinned jsDelivr folder, `'wasm-unsafe-eval'` and the consent-gated analytics host;
     `style-src` the same two folders; `font-src` the jsDelivr folder; `connect-src` and `img-src` `'self'`, Mapbox's
     hosts and the analytics hosts; `worker-src` and `child-src` `blob:`; `base-uri`, `form-action`, `object-src`
     `'none'`. The one directive table is `packages/shared/src/kit/csp.ts` (kit-cli), which `scripts/site/src/csp.ts`
     then imports (CR-M5-6), so the sites and the kit never drift (decisions §15c).
  2. The referrer, viewport, description, colour-scheme and theme-colour metas, the title.
  3. Mapbox GL JS's stylesheet and script (`defer`) with `integrity` and `crossorigin="anonymous"`.
  4. Between `<!-- hcm:engine -->` and `<!-- /hcm:engine -->`: the engine's `engine.css` and `engine.iife.js` (`defer`,
     after Mapbox's, so `mapboxgl` exists when it runs) from the pinned folder, with `integrity` and `crossorigin`.
  5. `<body class="hcm-fullpage">`, one `main` with the visually hidden `h1`, then
     `<hcm-map-viewer manifest-url="city.json" lang="ro">` holding two paragraphs (`lang="ro"`, `lang="en"`, class
     `hcm-note`): "the map is loading; if this stays, the map engine could not load: check the version and integrity in
     index.html (README)". An undefined element shows its children; once the engine defines it, its shadow root (no
     slot) hides them, so the note stays only when the engine was blocked or never came. Then `<noscript>`.
- `engine.css` gains the page frame the kit cannot carry in a fourth file (kit-cli, CR-M5-5): `.hcm-fullpage` (no margin,
  the viewer filling the window in `dvh`) and `.hcm-note`; documented in `ENGINE_API.md` → *The three files of a city*.
- **`fillKitPage(template, values)`** (`packages/shared/src/kit/page.ts`, kit-cli; used by the CLI, the export and the
  release's pinning): replaces, and only replaces, the `lang` of `<html>`, the title, the description and theme-colour
  metas, the `h1`, the element's `manifest-url`, the CSP's `content` (from `kitContentSecurityPolicy`), and the engine
  block, given `{kind: 'cdn', release}` (pinned, with integrity) or `{kind: 'local'}` (`engine/engine.css`,
  `engine/engine.iife.js`, same origin); every text value escaped for HTML; a template missing a slot throws
  `KitPageError` (a test runs it over the committed template).

### 3.3 `city.json`

A valid City Manifest v1: `city.id` `orasul-meu`, the name "Orașul meu" / "My city", the M1 example's bounds and view,
About and privacy texts that say what to replace, the theme of `NEW_CITY_SEEDS[0]` with its four schemes generated by
`themeFromSeed` (a kit-cli test regenerates and compares them), the basemap `mapbox://styles/mapbox/standard`, and the
token `pk.replace-with-your-token` (valid by the schema; Mapbox refuses it, and the README's token step is the fix). One
POI category and two or three places (a point, a line, an area) with neutral texts; **no photos** (the M1 kit's
example photos are licensed for București dispărut only and may not travel in a public template) and no layers.

### 3.4 `README.md`

Romanian first, then English, as the M1 kit's: what the three files are; the Mapbox public token (`pk.`, the three
scopes, restricted to the site's address; the account and the token are the owner's own steps); editing `city.json`
(the city, places, photos in `photos/<id>/web.webp` and `thumb.webp`, layers); turning on GitHub Pages (Settings, Pages,
deploy from the main branch, root); checking (the page names the field to fix); updating the engine (the new version's
`release.json`, or `npx create-historic-city@<version> upgrade`); serving it locally (any static server, never
`file://`); the privacy note (no cookies without consent; Mapbox sees each visitor's address).

**Addendum 2026-11-12** (DECISIONS §157): the owner's rule of 2026-11-10 makes all project Markdown English only.
The kit's `README.md` (§3, §3.3, §3.4) and the static export's `README.md` and `RIGHTS.md` (§5) are now written in English
only; the Romanian half is gone. The in-app texts stay in every language.

### 3.5 The template repository (later, ask first)

Prepared commands for the user's yes, after v1.0.0 is tagged (the kit's pins must resolve; the repository's name is
the user's choice, `historic-city-map-starter` a suggestion): create it
(`gh repo create ventura8/historic-city-map-starter --public`), push the three files from a copy of
`templates/starter-kit/`, then mark it a template
(`gh api -X PATCH repos/ventura8/historic-city-map-starter -F is_template=true`). Every later release updates it with
the new pins (a step of the release skill). Nothing creates it before the user says yes.

### 3.6 The kit against the mock world

`e2e/specs/starter-kit/template.spec.ts` (behaviour V27): the e2e site server serves `templates/starter-kit/` as it
is at `/kit/`; the mock CDN answers the pinned jsDelivr folder from `cdn/engine/` when it exists, else from
`packages/engine/dist` (before the first release the spec regenerates the page's engine block with `fillKitPage` and
the digests of what it serves, and says so in an annotation); the firewall records api.mapbox.com, the jsDelivr host
and nothing else. The bad paths change one served byte (the browser's integrity refusal), answer 404 for `city.json`,
and let the mock Mapbox refuse the placeholder token.

## 4. `create-historic-city` (kit-cli)

### 4.1 The package

`packages/create-historic-city/` (a workspace, `"name": "create-historic-city"`, not private, the repository's
version): `src/` in TypeScript under the repository's rules, built by Vite into one ES module `dist/cli.mjs` for
`node >=24.12.0` with `bin` `create-historic-city`, the kit's three files copied into `dist/template/` and the self-host
bundle into `dist/self-host/` (§4.4), `THIRD_PARTY_NOTICES.txt` beside it (`thirdPartyNoticesPlugin`: it bundles `zod`,
`@material/material-color-utilities` and `@hcm/shared`, already pinned). **No runtime dependency** (`dependencies`
empty) and no new devDependency; the lockfile gains the workspace's link (`npm install --offline` in the pinned
`node:24-bookworm-slim` image of `docs/SETUP.md`, no download). `files`: `dist/`, `README.md`. The `notices` gate and the per-file coverage gate cover
it; the dependency-cruiser rule: `src/` imports node built-ins, `@hcm/shared` and `@hcm/ui/dynamic-color` only.

### 4.2 Commands

```text
npm create historic-city@1 [dir] [-- options]     the same as: npx create-historic-city@1 [dir]
create-historic-city [dir]                        scaffold the static kit (default)
    --name-ro <text> --name-en <text> --id <slug> --bbox <w,s,e,n> --seed <#rrggbb> --lang ro|en --yes
create-historic-city self-host [dir] --project <id>   the human steps for a Firebase project of the owner's own
create-historic-city deploy [dir]                 the functions, rules and Hosting deploy once billing is linked
create-historic-city upgrade [dir]                rewrite the kit's engine block with this CLI's release (pins only)
create-historic-city doctor [dir]                 Node's version, firebase and gcloud on PATH, city.json valid, pins match
--dry-run                                         print the files, commands and pages; write, run and open nothing
--help, --version
```

Exit status: 0 done (or stopped by the owner's own "no"), 1 a refusal or a failed step (with the reason and how to
resume), 2 usage. Output is plain text, Romanian or English by `--lang` or `LANG`; the texts are the CLI's own
catalogue (`src/i18n/{ro,en}.ts`, the i18n gate's folder rules).

### 4.3 The static scaffold (minimum input)

Asked only when not given by an option (`--yes` takes every default): the city's Romanian name (the id follows it,
`suggestCityId`), the rectangle (`--bbox`, or four numbers at the prompt; `cityBoundsProblem` refuses as the admin does),
the seed (default `NEW_CITY_SEEDS[0]`), the Mapbox **public** token (optional: Enter leaves the placeholder; an `sk.`
token is refused with the warning and never written or echoed). Writes `index.html` (`fillKitPage`: title, description,
`lang`), `city.json` (the template's with the name, bounds, `startViewForBounds`, the seed's theme by `themeFromSeed`)
and `README.md` into a new or empty folder; a non-empty folder is refused and nothing is written.

### 4.4 The self-host steps

Every step prints what it does, why and what it costs, asks `y/N` (`--yes` does not answer these: only
`--dry-run` skips them), and runs the **owner's own** CLI with the terminal inherited, so every Google sign-in, consent,
terms acceptance and billing entry happens in Google's own pages and the CLI never sees a credential (it reads only
`--json` outputs of listings, and its logger redacts any key containing `token`).

| # | Step | How | Human part |
| --- | --- | --- | --- |
| 1 | Tools | `firebase --version`, `gcloud --version` (optional) | none; without `firebase` the CLI prints `npm install -g firebase-tools@15.33.0` and stops |
| 2 | Sign in | `firebase login` (skipped when `firebase login:list --json` lists an account) | the Google sign-in in the browser |
| 3 | Project | `firebase projects:create <id> --display-name "<name>"` | Google's terms on first use (the CLI opens the console and waits) |
| 4 | Web app and Hosting | `firebase apps:create web "<name> admin" --project <id>`; `firebase hosting:sites:list --json` (create the default site when missing) | none |
| 5 | Google sign-in provider | opens `https://console.firebase.google.com/project/<id>/authentication/providers` and waits for Enter | enabling Google (a console click; nothing else needs it) |
| 6 | The admin, start-up mode | writes `.firebaserc`, `firebase.json` (the project's Hosting site and CSP), `admin/project.json`, `admin/runtime.json` (`startUp`), then `firebase deploy --only hosting --project <id>` with the bundled admin | none |
| 7 | Setup in the admin | opens `https://<id>.web.app/`: sign-in, the owner claim, billing and the 5 USD budget, Provision, all in the Setup Assistant (M2b) | billing, as the Setup Assistant guides it |
| 8 | The server | `create-historic-city deploy`: billing checked with `gcloud billing projects describe <id> --format=json` when gcloud exists (polled every 15 s, at most 20 minutes), else the owner confirms; then `firebase deploy --only functions,firestore,storage,hosting --project <id>` | none |
| 9 | The rest of Setup | opens the admin again: Mapbox, USGS, analytics, the first city (New city) | the Setup Assistant's cards |

The bundled self-host files (built at release by `npm run build:self-host`, kit-cli; since M14 its hosting folder is the start site's release tree, with Setup's install bundle and the city page, `M14-start-your-map.md` §6): the admin's Hosting build
without Bucharest's legacy bundle, `functions/dist` with its deploy lockfile, the rules and indexes, and the templates of
`firebase.json` and `project.json` (CR-M5-7: `project.json`'s `github` becomes optional for a project deployed from the
owner's own terminal, and the provisioner then skips the Workload Identity items).

### 4.5 Ports and tests

`src/ports.ts`: `Runner` (spawn with inherited or captured output), `Opener` (`xdg-open`, `open` or `start` by
platform), `Prompter` (the terminal), `Files` (the target folder only), `Clock`, `Env`. Vitest (`packages/create-
historic-city/test/`, a node project of `vitest.config.ts`, 90 % per file) drives every command over fakes; the e2e
spec `e2e/specs/starter-kit/create-city.spec.ts` (V29) runs the built `dist/cli.mjs` as a child process with fake
`firebase`, `gcloud` and `xdg-open` scripts first on `PATH` that record their arguments, then serves the scaffolded
folder and boots it. No test reaches a network: the CLI itself never fetches anything (the template and the self-host
bundle are in the package).

### 4.6 Publishing to npm (prepared, ask first)

The `release` stage packs `create-historic-city-X.Y.Z.tgz` (`npm pack --workspace create-historic-city`) into
`reports/release/`. Publishing is the user's step in their own terminal, after the tag: `npm view create-historic-city`
(whether the name is free, **UNVERIFIED**), `npm login` (the user's own account and 2FA), then
`npm publish reports/release/create-historic-city-X.Y.Z.tgz --access public`. Claude never types the password or the
one-time code.

## 5. The static export (export)

### 5.1 What the zip holds

```text
<city>-<YYYY-MM-DD>.zip
  index.html          the kit's page (fillKitPage: the city's name and language, engine {kind: 'local'}, city.json)
  city.json           the published manifest: photo images → photos/<id>/web.webp and thumb.webp; city.analytics removed;
                      the viewer token kept (README: replace it with your own for another address)
  README.md           the kit's README with an export preface (what is inside, how to serve it, the token, the scans)
  RIGHTS.md           every photo licensed for this map only (permission, permission-legacy): id, title, rights holder
  engine/             the deployed backend's engine: engine.iife.js, engine.css, fonts/, i18n/, THIRD_PARTY_NOTICES.txt
  photos/<id>/web.webp, thumb.webp
  rasters/<layer>.tif only when asked, only USGS layers (rasterExportable), the layer version's Cloud-Optimized GeoTIFF
```

Layout constants and helpers (done): `EXPORT_LAYOUT`, `exportPhotoPath`, `exportRasterPath`, `exportFileName`,
`rasterExportable`, `restrictedPhotoIds`.

The tab icon (2026-11-08; `M2-interfaces.md` → *The city's tab icon*): `index.html` carries the city's own 32 px icon
inlined as a `data:` address (`fillKitPage`'s optional `icon`, read from the public bucket's `cities/<city>/icon-32.png`),
or keeps the kit's default (the Layers panel's map glyph) when the city has none; the zip gains no file. The kit's
template inlines the default the same way, so `create-historic-city`, the release's pins and the export copy no image.

### 5.2 Rights

- USGS frames are in the public domain: their scans may travel. An uploaded GeoTIFF or a linked tileset says nothing of
  its rights, so it travels as its tile reference only (README says so).
- Photos licensed `permission` or `permission-legacy` are the owner's archive and go in the zip, named in `RIGHTS.md`
  and counted on the card ("licensed for this map only"); excluding them by default is the user's alternative
  (decisions §58).

### 5.3 The callables, the task and the record

| Name | Kind | Contract |
| --- | --- | --- |
| `export.start` | callable, `cityOwner`, App Check `enforce` | `exportStartRequestSchema` (done). Refuses a city with no published manifest (`apiError.export.noManifest`), an open export (`busy`), the city's daily exports used up (`dailyLimit {limit}`), a red budget guard (`apiError.guardPaused`). Creates `cities/{city}/exports/{exportId}` (`cityExportDocSchema`, done: `queued`, `requestedBy`, `rasters`, `engineVersion`) and enqueues the task named by the export id (`EXPORT_QUEUE` `export-build`) |
| `export.build` | task queue function | `exportTaskSchema` (done). `building`; reads the city's manifest from the public bucket; sums the sizes first (`apiError.export.tooLarge {size, max}` when over `EXPORT_LIMITS.maxBytes`, nothing written); streams the zip into `exports/<city>/<exportId>.zip` (`STORAGE_PATHS.cityExport`, done); `ready` with `bytes`, `sha256`, `counts`, `finishedAt`, `expiresAt`; any failure is `failed` with its code and the partial object deleted; a run past `EXPORT_LIMITS.buildMinutes` fails |
| `export.download` | callable, `cityOwner` | `exportDownloadRequestSchema` and response (done): `apiError.export.notReady`, `.expired`; else a V4 signed address of the object, `EXPORT_LIMITS.downloadUrlMinutes`, with `response-content-disposition: attachment; filename="<exportFileName>"` |

`ops.tick` marks a `ready` export past `expiresAt` `expired` (the bucket's lifecycle rule on `exports/` deletes the
object after `EXPORT_LIMITS.ttlDays`: a provisioner item, CR-M5-8). The kit files and the engine reach the function
through its build: `functions/build.mjs` copies `templates/starter-kit/{index.html,README.md}` and the engine's files
(no maps) into `functions/dist/export-kit/` and records `ENGINE_VERSION` (export, through CR-M5-9).

### 5.4 The zip

`functions/src/export/zip.ts` (export): a streaming writer over Node's `zlib` (no dependency): local headers with data
descriptors, CRC-32 by `zlib.crc32`, DEFLATE for text files and STORE for the already-compressed ones (`.webp`, `.tif`,
`.woff2`), entries sorted, fixed timestamps (the export's day), no ZIP64 (`maxBytes` stays under 2 GiB). The e2e reads
it with its own small reader over `zlib.inflateRawSync` (`e2e/support/unzip.ts`).

### 5.5 The download

`UrlSigner` (`functions/src/ports/url-signer.ts`, export) over Cloud Storage's V4 signing (`signBlob` of the runtime
account on itself: `roles/iam.serviceAccountTokenCreator` on itself, a provisioner IAM item, CR-M5-8; **UNVERIFIED**
until Provision runs). In the emulators the e2e stand-in signer answers the mocked public-storage host, which serves the
object from the Storage emulator, so the browser downloads exactly the object the task wrote.

### 5.6 The admin's card

Settings gains the section **Export the city** (lazy chunk `export-card`; its texts are `adminContent.export.*`,
done): the intro, Include the USGS scans (with their size) unticked, Export; then the record live (queued, building,
ready with size, counts, SHA-256 and the expiry; failed with its reason and Export again; expired), Download (the signed
address in a new download, never shown); the restricted photos' line. Editors see it read-only with
`adminContent.export.ownerOnly`; a city never published shows `adminContent.export.unpublished`. Budgets (done):
`exportCity` 2, `exportWithRasters` 3.

### 5.7 The viewer boots from the export

`e2e/specs/starter-kit/export.spec.ts` (V28) unpacks the zip S-A53-HAPPY downloaded, serves the folder from the e2e
static server and opens `index.html`: `hcm-ready` with the city's counts, the engine from the same origin, the photos
from `photos/`, and the firewall's record without Firestore, Firebase, googleapis or jsDelivr. The export's manifest has
no analytics ids, so Accept on the consent banner loads nothing. Opened from `file://`, the page shows
`error.manifest.network` with Retry (the README's first step says to serve the folder). No engine change is needed: the
static manifest mode of M1 is what the export uses.

## 6. Ownership

### 6.1 Who owns what

Each workstream writes only its own paths (tests mirror them); reading and importing anything is fine; anything else is
a change request.

| Workstream | Owns (writes) |
| --- | --- |
| multi-city | `packages/shared/src/schemas/cities.ts`, `api/cities.ts`, `i18n/admin-cities/**` and the shell's `adminShell.city.*` lines; the access values of `CallableAccess` and the M5 lines of the registry for the cities and admins callables; `functions/src/cities/**` (new feature folder: `cities.create`, `cities.setLimits`, the membership helpers), `functions/src/admin/**`, `functions/src/api/access.ts`, `AdminDirectory` and its adapter and fakes, the guard and caps lines of §1.8 in `functions/src/imagery/{limits,publish-guard}.ts` and `functions/src/assist/`, the fan-out filter of `functions/src/notify/` and the links of `functions/src/api/notification-event.ts`, `ops.tick`'s `memberships` step; `firebase/firestore.rules`, `firebase/storage.rules`, `firebase/firestore.indexes.json` and `firebase/rules-tests/**` (the export's `exports` match included, from export's CR); `packages/admin/src/{app,routing,cities,admins}/**`, `packages/ui/src/admin/{shell,cities,admins}/**`, the Settings budget section; `scripts/site/**` but `scripts/site/src/notices.ts`, `sites/**`, `infra/project.json`; `packages/test-support` fakes for members and a second city; `e2e/admin/specs/cities/**`, `e2e/specs/viewer/multi-city.spec.ts`, the e2e worlds' membership seeding and the second city's fixture site; the `cities` sections of `e2e/tour/states.ts` and `budgets.ts`; rows A49–A52, V26 |
| release | `packages/shared/src/schemas/engine-release.ts`; `scripts/release/**` (new: `bump.ts`, `cdn.ts`, `pin-kit.ts`, `notes-sri.ts`), `cdn/engine/**` (generated, at the end), `scripts/ci/check_release.py` and the new gates `kit-pins`, `release-cdn` in `scripts/ci/pipeline.py` with their tests, `.github/workflows/release.yml` (stricter checks only; the rest proposals), `docs/releases/**`, every `package.json` version and `ENGINE_VERSION` (the bump, last); as the integrator, after the three others: `README.md`, `docs/*.md` (ARCHITECTURE, ENGINE_API's release lines, TESTING, CI_PIPELINE, SETUP, the admin guides' chapters, LESSONS, MANUAL_TEST_PLAN), `.agent/**`, `.agents/**`, `.claude/**`, `docs/research/M0-handoff.md`, `docs/research/M5-status.md`, the root `package.json`'s version and the lockfile's refresh at the bump |
| kit-cli | `templates/starter-kit/**`, `starter-kit/README.md` (the pointer), `packages/shared/src/kit/**` (new: `page.ts`, `csp.ts`), `packages/create-historic-city/**` (new), its Vitest project in `vitest.config.ts` and its dependency-cruiser rule (stricter, logged), the engine.css frame (CR-M5-5), `ENGINE_API.md` → *The three files of a city* and a new *The starter kit* section, the agent-asset checker's `templates/` root, `e2e/specs/starter-kit/{template,create-city}.spec.ts`, the e2e site server's `/kit/` route and the mock CDN's jsDelivr folder, the fake CLIs; rows V27, V29 |
| export | `packages/shared/src/schemas/city-export.ts`, `api/city-export.ts`, `i18n/admin-export/**`; `functions/src/export/**` (new feature folder), `functions/src/ports/url-signer.ts` and its adapter, its export lines in `functions/src/index.ts`, `deps.ts`, `global-options.ts`, the export-kit copy in `functions/build.mjs` (CR-M5-9), the `exports` expiry in `ops.tick`; `packages/admin/src/export/**`, `packages/ui/src/admin/export/**`, the Settings section line (CR-M5-10); the provisioner's lifecycle and IAM items (CR-M5-8); `e2e/admin/specs/export/**`, `e2e/specs/starter-kit/export.spec.ts`, `e2e/support/unzip.ts`, the stand-in signer and the storage mock's export route; the `export` sections of `e2e/tour/states.ts` and `budgets.ts`; rows A53, V28 |
| contracts (done) | this file, the files of *Done by this contract* (§0) |

### 6.2 Shared files

| File | How a workstream appends |
| --- | --- |
| `e2e/scenarios.json` | each workstream flips its own rows to `exists` when the tagged test lands (the `notes` name the owner and the spec), a new row after its behaviour's last; then `python3 scripts/ci/check_e2e_matrix.py write` in the image |
| `e2e/tour/states.ts` | inside its own M5 section (`cities`, `export`), a spread from a file of its own; kit-cli adds the kit's states (`kit.loading-note`) with the journey that visits them |
| `packages/admin/src/content/budgets.ts` | inside its own section (`cities`, `export`) |
| `packages/shared/src/api/registry.ts`, `functions/src/index.ts`, `functions/src/deps.ts`, `functions/src/global-options.ts`, `functions/test/index.test.ts`, the admin's function counts (`packages/admin/test/{google/clients,provision/setup-cloud}.test.ts`) | one line per function at the end of its group (multi-city: `cities.create`, `cities.setLimits`, `admins.setRole`; export: `export.start`, `export.download`, `export.build`); `FUNCTION_OWNERS` gains `fn-cities` (multi-city) and `fn-export` (export) with their first function |
| `packages/shared/src/api/errors.ts` and the API catalogues | a new code is a change request here (the thirteen of §0 are done) |
| `packages/shared/src/schemas/paths.ts`, `firestore-ops.ts`, `client-writes.ts` | multi-city: `adminDocSchema.cities`, `inviteDocSchema.cities`, `cityDocSchema.limits`, `OPS_STEPS`' `memberships`; export: `ops.tick`'s export expiry; each in its own change with its test |
| `firebase/firestore.rules`, `storage.rules`, `firebase/rules-tests/**` | multi-city writes them; export asks for its `exports` match by CR-M5-11 |
| `scripts/ci/check_bundle_budget.py` | multi-city: `cities` and `city-budget` rows of `ADMIN_CHUNK_BUDGETS`; export: `export-card`; kit-cli: `ENGINE_BUDGETS` only if the frame CSS moves it; each logged in `DECISIONS-for-review.md` |
| `scripts/site/src/csp.ts` | multi-city switches it to `packages/shared/src/kit/csp.ts` once kit-cli lands it (CR-M5-6) |
| the root `package.json` scripts and `package-lock.json` | one line per script by its owner (multi-city `site:add`; kit-cli `build:self-host` and the CLI's build; release `release:cdn`); the lockfile refreshed offline by whoever adds a workspace or a version (kit-cli, then release at the bump) |
| `vitest.config.ts`, `.dependency-cruiser.cjs`, `knip.json`, `sonar-project.properties` | kit-cli: the CLI's project, rule, workspace and scope (stricter or keeping the tools working: pre-approved, logged); multi-city: the `functions-feature-folders-independent` rule gains `cities` and export's `export` (stricter, logged) |

### 6.3 Order of work

1. **In parallel from the start**: multi-city (access and rules first, with the e2e seeding of memberships in the same
   change, since every content spec's admin needs one; then the switcher, New city, the admins, the budgets, the site
   build), kit-cli (`packages/shared/src/kit/` first, which export and release use; then the template, the CLI, the
   self-host bundle), export (the zip writer and the task over the fakes, then the callables and the card; it starts
   from the contract's `fillKitPage` signature and a local template fixture until kit-cli lands), release (the bump,
   cdn and pinning scripts and the gates against a scratch build; the measurement of §2.3's gates).
2. Export's rules (CR-M5-11) and provisioner items (CR-M5-8) are applied by their owners when asked; the export spec
   runs once multi-city's membership seeding is in.
3. Each workstream runs `PIPELINE_STAGE=static` and `tests` for its own changes, `build` when it touches the engine,
   the admin, the functions' build or the CLI's.
4. **Release last**: when the three others reported, it integrates the docs and the agent assets, writes
   `M5-status.md`, prepares v1.0.0 (§2.6) and runs `all` split with the NUC.
5. **Only one agent at a time runs a split stage** (`PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh`, the NUC); the
   others run single tiers locally (`--project`), and nobody touches other containers or `~/fork-linux-ci` on the NUC.

### 6.4 Change requests

A workstream that needs a change outside its paths appends a row to [Change requests](#change-requests) (the next free
`CR-M5-<n>`, status `open`) and continues against the current contract; the target's owner applies it and sets `done`
with the date and what changed, or `rejected` with why. A deviation from this contract that a workstream applies inside
its own paths is a self-applied row (status `done`), so the reviewer sees every place the code and this file differ.

## 7. Scenarios, budgets and tour states

### 7.1 Rows (done: `e2e/scenarios.json`, `docs/E2E_SCENARIOS.md` regenerated)

Every M5 row is `planned`, and its `notes` name the section, the owner and the test file that will carry its tag.

- **A49** the city switcher (multi-city, e2e-admin): `S-A49-HAPPY`, `-HAPPY-REMEMBERED`, `-HAPPY-ONE-CITY`,
  `-BAD-NOT-MEMBER`, `-BAD-UNSAVED`; the fixer's `-HAPPY-FIRST-SCREEN`, `-BAD-FIRST-SCREEN-INCOMPLETE`.
- **A50** New city (multi-city): `S-A50-HAPPY`, `-BAD-ID-TAKEN`, `-BAD-AREA` (e2e-admin); `-HAPPY-HARVEST`,
  `-HAPPY-RETRY`, `-BAD-NOT-PROJECT-OWNER`, `-BAD-TOO-MANY`, `-BAD-RESERVED` (functions).
- **A51** per-city admins and isolation (multi-city): `S-A51-HAPPY`, `-HAPPY-ROLE`, `-BAD-EDITOR-INVITES` (e2e-admin);
  `-HAPPY-MIGRATION`, `-HAPPY-INBOX`, `-BAD-OTHER-CITY-CALLABLE`, `-BAD-LAST-OWNER` (functions);
  `-BAD-OTHER-CITY-RULES`, `-BAD-HISTORY-QUERY`, `-BAD-CLIENT-MEMBERSHIP` (rules).
- **A52** per-city budgets (multi-city): `S-A52-HAPPY` (e2e-admin); `-BAD-CITY-OVER`, `-BAD-DAILY-JOBS`,
  `-BAD-NOT-PROJECT-OWNER` (functions); `-BAD-CLIENT-LIMITS` (rules).
- **A53** the static export (export): `S-A53-HAPPY`, `-BAD-BUSY`, `-BAD-EXPIRED`, `-BAD-NEVER-PUBLISHED` (e2e-admin);
  `-HAPPY-RASTERS`, `-HAPPY-RIGHTS`, `-BAD-TOO-LARGE`, `-BAD-EDITOR`, `-BAD-DAILY-LIMIT` (functions);
  `-BAD-CLIENT-EXPORTS` (rules).
- **V26** many cities on one Pages site (multi-city, e2e-viewer): `S-V26-HAPPY`, `-HAPPY-ROOT-LINKS`,
  `-BAD-NOT-PUBLISHED`.
- **V27** the kit from jsDelivr with SRI (kit-cli, e2e-starter-kit): `S-V27-HAPPY`, `-BAD-INTEGRITY`,
  `-BAD-MISSING-CITY`, `-BAD-PLACEHOLDER-TOKEN`.
- **V28** the viewer boots from an export (export, e2e-starter-kit): `S-V28-HAPPY`, `-HAPPY-CONSENT-SENDS-NOTHING`,
  `-BAD-FILE-URL`.
- **V29** `create-historic-city` (kit-cli, e2e-starter-kit): `S-V29-HAPPY`, `-HAPPY-DRY-RUN`, `-HAPPY-SELF-HOST`,
  `-BAD-NOT-EMPTY`, `-BAD-SECRET-TOKEN`, `-BAD-NO-FIREBASE-CLI`, `-BAD-BILLING-NOT-LINKED`, `-BAD-DECLINED`.

- **A54** the cross-app journey (the integrator, e2e-admin; CR-M5-28): `S-A54-HAPPY`, `-BAD-UNPUBLISHED`,
  `-BAD-OTHER-CITY`.

The release's own checks (versions, notes, `cdn/engine/`, the pins) are gates with their pytest suites in
`scripts/ci/tests/`, not scenario rows; what a city owner sees of a release is V27.

### 7.2 Input budgets (done: `CONTENT_INPUT_BUDGETS`)

| Flow | Inputs | How |
| --- | --- | --- |
| `newCity` | 3 | the Romanian name (the id follows it), one drag of the rectangle, Create the city |
| `switchCity` | 2 | the city in the bar, the other city in its menu |
| `inviteToCity` | 3 | Invite, the address (editor unless changed), Invite in the dialog |
| `setCityRole` | 3 | the admin's row, the role, confirm |
| `setCityLimits` | 1 + 1 per field | the fields moved, Save |
| `exportCity` | 2 | Export, Download once ready |
| `exportWithRasters` | 3 | Include the USGS scans, Export, Download |
| `publishCity` | 2 | the switch The city is public, Save (CR-M5-26) |

Everything after Create the city (the start view, the theme, the limits, the token, the first harvest) and after Export
(the build, the expiry) takes no input.

### 7.3 Tour states

Every new screen and state joins `e2e/tour/states.ts` (the M5 sections are there, empty) and passes `expectStateSound`
at every tour viewport, light and dark; nothing joins a checker's allowlist: `cities.switcher-menu`,
`cities.not-member`, `cities.new`, `cities.new-drawing`, `cities.new-area-invalid`, `cities.new-id-taken`,
`cities.created`, `cities.admins`, `cities.admins-editor`, `cities.role-confirm`, `cities.budget`,
`cities.budget-readonly`, `cities.publish` (CR-M5-26), `export.card`, `export.building`, `export.ready`, `export.failed`, `export.expired`,
`export.readonly`; the kit's `kit.loading-note` (the engine blocked) with a journey of its own over the template page.

## 8. Fakes and the e2e world

- **A second city** (multi-city): the admin worlds seed `admins/{uid}.cities` for every test account (the content
  worlds' own cities `e2e-w{worker}-{test}` as owner), and a second public site (`e2e-second`) with a fixture manifest
  for V26.
- **jsDelivr** (kit-cli): the mock CDN host `cdn.jsdelivr.net` (already in `e2e/mock-apis/hosts.ts`) answers
  `/gh/ventura8/historic-city-map-maker@v<version>/cdn/engine/<file>` from `cdn/engine/` or the engine build, with a
  scenario that changes one byte; `@1` the same.
- **Fake command-line tools** (kit-cli): `firebase`, `gcloud` and `xdg-open` scripts written by the spec into a temporary
  folder first on `PATH`, recording their arguments and answering scripted `--json` outputs (billing `false` N times,
  then `true`); never a real CLI.
- **Storage** (export): the Storage emulator holds the zip; the stand-in signer's address is served by the storage mock
  from the emulator; `e2e/support/unzip.ts` unpacks it.
- **Firewall**: unchanged hosts; the export's page must ask none of Firestore, Firebase, googleapis or jsDelivr.

## 9. Cost and security summary

| Item | Cost | Guard |
| --- | --- | --- |
| A new city | Firestore documents; one USGS harvest a month; Mapbox map loads of its own visitors | the project's caps and the city's share (§1.8); at most 20 cities |
| jsDelivr | free | exact pins with SRI; `@1` without SRI only |
| GitHub Pages | free | one origin; per-city tokens restricted to it |
| An export | the task's CPU, the private bucket's storage for seven days, one download's egress (a few tens of MB without scans) | owners only, three a day per city by default, 2 GB at most, expiry and lifecycle |
| `create-historic-city` | nothing of ours: it runs the owner's own CLIs in the owner's own project | consent per step, `--dry-run` |

Isolation: the rules and every city callable close a city to the admins of the others; the switcher reads one city per
page load. Untrusted strings: city names and the exported texts are plain text, escaped by `fillKitPage` into the
export's page and rendered with Lit or `textContent` elsewhere. Secrets: none in the kit, the export or the CLI (the
Mapbox token in `city.json` is the public, URL-restricted one; an `sk.` token is refused everywhere).

## 10. UNVERIFIED, and how the first real run proves it

| Fact | Proof (ask first; local or the real project, never in CI) |
| --- | --- |
| jsDelivr serves files of this repository at a tag: the release skill records its limits as 150 MB a package and 20 MB a file, and the tree is about 84 MB (67 MB of it `seed/` since the 2023 additions, §12), the largest file under 5 MB | the user opens `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@legacy-2022/README.md` (an existing tag) once; if refused, the fallback is a small releases repository or the npm route, each a decision (§58) |
| jsDelivr's `@1` resolves the newest `v1.x.y` tag of a GitHub repository | the first release, opening the `@1` address |
| The engine build is byte-reproducible on CI and on the NUC | the `release-cdn` gate's first run in `release.yml` |
| A rules `get()` inside a collection-group list condition on `resource.data.cityId` | the rules tests on the emulator (S-A51-BAD-HISTORY-QUERY); the fallback is §1.4's per-city index |
| `firebase projects:create` and `hosting:sites:list` behave as §4.4 says for a new account; the default Hosting site exists | the first self-host run by a person, with consent |
| V4 signing with the runtime account's own `signBlob` | `export.download` after Provision |
| The name `create-historic-city` is free on npm | `npm view create-historic-city` by the user |

## 11. What waits for the user (prepared, ask first)

- Push the work branch; open the pull request to `master`; merge; tag `v1.0.0`; push the tag (§2.6).
- The workflow proposals of §2.5 and §1.10 (`release.yml`'s publishing additions, `ci.yml`'s `dist/pages`).
- Any static-gate exclusion `cdn/engine/` needs (§2.3).
- The template repository (§3.5), the npm publish (§4.6), the jsDelivr probe (§10).
- Deploys of the functions, rules, indexes and the admin with M5 in them, and Provision again (the export's lifecycle
  rule and signing permission).

## 12. The 2023 additions (the old site's later photos)

The legacy seed `seed/bucharest/` (45 photos) was taken from a copy of the old site, `ventura8/historic-city-map-maker`, that missed what the owner's account `bucurestiuldisparut` added to `bucurestiuldisparut/bucurestiuldisparut.github.io` after its fork (2022-12-27 to 2023-07-29; the owner confirmed the account and asked for the import on 2026-11-08). That account added 23 photo files; 11 of them were already in the copy (Ferdinand, Gara Obor, the three Realitatea Ilustrată pages, the three Obor pages of July 1936, Parcul Ferdinand, ut3, Căminului), so **12 photos with 12 viewpoints (24 features: a point and a cone each)** were missing. None of the 12 files is in `fostulbucuresti/fostulbucuresti.github.io`'s tree or history, by name or by content (checked against every blob of its history); nothing else of that repository is used.

- **The data** (`seed/bucharest-2023/`, the shape of `seed/bucharest/`): `photos.legacy.geojson` holds the 24 features exactly as the live `geojson/photos.json` has them, `photos/` the 12 originals as the repository serves them, except `mosilor_70.png`, re-encoded from 16-bit to 8-bit RGB, lossless otherwise (16.4 MB to 4.6 MB: the old photos' originals travel in `legacy.tgz`, whose budget, 60000 KB, the 16-bit file would have broken; the derivatives are 8-bit anyway). `derived/` and `manifest.static.json` come from `node scripts/seed/migrate-legacy.mjs --city-dir seed/bucharest-2023 --joins seed/bucharest`: the same rules as the 45 (titles in Romanian, years from the data, `permission-legacy` with `rightsReview: true`, links from the legacy HTML, bearing and field of view from the cones, `web.webp` 2048 px and `thumb.webp` 400 px without metadata), and ids that keep clear of the 45's (`--joins`: `migrateLegacyPhotos`' reserved ids; none collided). `seed/bucharest/` is unchanged; the static site joins the 12 after the 45 (`sites/bucharest/site.json` → `additions`, `scripts/site/src/additions.ts`: 57 photos, each served from its own folder's `derived/`, Parc Ferdinand corrected, the credits naming every author) and the live map gets them through the import.
- **The bundle** (`scripts/site/src/admin/legacy.ts`): `legacy/bucharest/photos.json` holds the 45, then the 12 (`SEED_ADDITIONS`), 56 originals; two folders may not bring two files of one name.
- **The import** (Setup step h, `packages/admin/src/import/legacy-import.ts`): idempotent by document id and `legacyId` as before, so a map with the 45 sees *The map does not have 12 of the old site's photos yet* and **Import the missing photos (12)**, one click, which creates, uploads and publishes only the 12 (S-A28-HAPPY-ADDITIONS). It never undoes the owner's work (S-A28-BAD-OWNER-EDITS-KEPT): an existing document is never written but to publish a photo whose own import stopped before its publish; a photo whose document is gone and whose `history` (the triggers keep it after a delete) has a delete stamped with a person's uid was deleted by a person and is not created again; a processed photo that is unpublished though an entry stamped with a person's uid has a published `previous` was unpublished by a person and stays so. Entries the server stamps (`system:<authType>`, or a service account's e-mail: a function's delete, the emulator's admin that the e2e world's reset uses) never count, so a photo the server removed is imported again. Both count as done, so the card then says all the photos are on the map although the owner removed some.
- **Doubtful, for the owner** (each photo is in the rights-review queue): no author on 11 of the 12 (only *Strada Gradinarilor*, Studiourile Buftea); no source link on any; *Piata Obor* 1956 twice from the same point; *La Leu* and *Monetaria de la Sosea* share one legacy id on the old site (both imported, as for Bateriilor and Ferdinand). The old site also moved the point of *Parc Ferdinand* (`parcul-ferdinand-1930`, about 10 m) and gave it a cone; that photo is one of the 45, so `seed/bucharest/` keeps it as migrated and a correction carries the old site's (*Directions from the old site* below).
- **Costs**: about 7.4 MB more of originals in `legacy.tgz` and in a publish before the import is complete (`SITE_PUBLISH_TRANSFER_MB` 52 to 60); 1.9 MB of derivatives in `seed/bucharest-2023/derived/`.

### Directions from the old site

The owner (2026-11-08): *import the direction of every photo from the old site; some of ours have none, for example
`parcul-ferdinand-1930`*. Every photo of the 57 was compared with the old site's live `geojson/photos.json`
(`node scripts/seed/legacy-corrections.mjs --later <that file>`, which migrates it with `migrateLegacyPhotos`, so bearing
and field of view are measured from its cones exactly as the first migration measured the others, and matches each of our
photos to the old site's point of the same original nearest to it):

- **Corrected (1)**: `parcul-ferdinand-1930`: the old site moved its point (26.139544, 44.448214 to 26.139431, 44.448183)
  and gave it a cone on 2022-12-27 (the owner's commit *added Obor photos*), after the copy `seed/bucharest/` came from:
  bearing 219.1°, field of view 50°.
- **Already had the old site's direction (46)**: the other 34 of the 45 with a cone and all 12 additions.
- **No cone on the old site (10)**: `intrarea-in-fabrica-luceafarul-nufarul`, `caminului-sistematizare-1960`, `ut3`,
  `gara-obor`, `realitatea-ilustrata-1934-6-1`, `realitatea-ilustrata-1935-11-1`, `realitatea-ilustrata-1935-11-2`,
  `obor-29-iulie-1936`, `obor-29-iulie-1936-2`, `obor-29-iulie-1936-3`: the old site has a point and no direction for them;
  the owner can aim them in the photo editor.

Why the first migration missed it: not its matching (every cone of `seed/bucharest/` found its point), but its source, a
copy taken before the old site gave Parc Ferdinand a cone; and the 2023 additions were chosen by file name, so a photo
already in the seed was never compared again. The matching was fragile all the same: a cone was linked to the point whose
`photo` URL was *identical*, and the old site wrote one photo's URL on two hosts, with spaces or `%20`, so a cone spelled
otherwise would have become a second photo without its point's direction. Cones now find their point by the decoded file
name in Unicode NFC (`legacyPhotoKey`, `legacy-photos.test.ts`), and the corrections are derived by comparing every photo,
not only the missing ones (`deriveLegacyCorrections`, `corrections.test.ts`).

- **The data**: `seed/bucharest-2023/corrections.json`, keyed by photo id: the old site's `location`, `bearing` and `fov`,
  the values the migration gave (`migrated`) and the old site's URL (`source`). `seed/bucharest/` is unchanged.
- **The bundle and the static site** apply a correction to a photo that still holds its migrated values
  (`correctedPhoto`): a new project imports Parc Ferdinand with its direction, and the static site shows it so. The bundle
  also ships `legacy/bucharest/corrections.json`, and its `city.json` credits name every author of the 57
  (`creditsNamingAuthors`: the migrated authors line, untouched, gains Studiourile Buftea).
- **The import** (Setup step h, `packages/admin/src/import/legacy-fixes.ts`) on a map that has the photos: the card says
  *Directions the old site adds to photos without one: 1* and the button reads **Add the old site's directions (1)**; one
  click writes them (S-A28-HAPPY-DIRECTIONS). A correction is applied only to a photo whose direction is still the
  migration's (none, or exactly the migrated one) and whose history has no person's change of `bearing` or `fov`; its point
  moves only while it is still the migrated one and no person moved it; the owner's direction and place are never
  overwritten (S-A28-BAD-OWNER-DIRECTION-KEPT). The same click adds the authors the city's credits do not name yet: the
  migrated authors line, while untouched, lists them all; an edited one stays and a line of the missing authors is added
  last. Applied once, a photo holds the old site's values and the credits name every author, so a rerun finds nothing to
  do; the step is done only when nothing is left.
- **Re-checked live (2026-11-12)**, after the owner's *only one photo near Gara Obor has a direction; import them all*:
  the old site's live `https://bucurestiuldisparut.github.io/geojson/photos.json` (Last-Modified 2023-07-29; 56 points,
  47 cones; its last data commit is the owner's *added Obor photos*, 2022-12-27) gives a cone to 47 of our 57 photos. Live `cities/bucharest/photos` has 57 photos, 47 with a bearing, each equal to the seed's or the
  correction's (0 differences); the public manifest has the same 47. `legacy-corrections.mjs` on that file rewrites
  `corrections.json` byte for byte: corrected 1 (already applied live), had 46, no cone 10. The photos near Gara Obor
  without a direction (`gara-obor`, `ut3`, the three Realitatea Ilustrată pages, the three Strand Obor pages of July 1936,
  `caminului-sistematizare-1960`) are 9 of those 10: the old site shows them as plain pins too; its two cones there are
  *Bulevardul Ferdinand* and *Parc Ferdinand*, both live. And the viewer shows only the photos near the timeline's year,
  so at the 1930s only Parc Ferdinand's cone is drawn there. Nothing is left to import: those 10 need the owner's aim in
  the photo editor.

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract; the
owner applies it. Ids are `CR-M5-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-M5-1 | contracts | contracts | The shared schemas and helpers (cities, city export, engine release), the API schemas, the M5 paths, the system writers `cities` and `export`, thirteen error codes in both languages, the `admin-cities` and `admin-export` catalogues and the shell's `adminShell.city.*`, the M5 input budgets, the tour sections, the 56 scenario rows and the regenerated scenario document, the decisions log | the four workstreams start from one contract | done (2026-10-25) |
| CR-M5-2 | contracts | multi-city (registry, `functions/src/api/access.ts`) | §1.3: `CallableAccess` gains `cityEditor`, `cityOwner`, `projectOwner` and every registry row its M5 access, in the same change as `requireAccess`; the M2–M4 tests and specs that resume the budget guard or save a Setup step (S-A43-*, the Setup steps) act as the project owner | a registry value without its check would admit any admin | done (2026-10-25, multi-city): every registry row has its M5 access and `requireCityRole` checks the request's city after validation (`functions/src/api/{access,callable}.ts`); `AdminDirectory.membership` (one read) replaces the two lookups (CR-M5-22); the M2–M4 tests act as the project's owner or a member where they must (`fakeAdmins` grants every city by default) |
| CR-M5-3 | contracts | multi-city (`firebase/*.rules`, `firebase/rules-tests/**`, the e2e worlds' seeding) | §1.4 and §8: the membership functions and matches, with every admin world's accounts seeded as members in the same change | otherwise every content spec loses its access at once | done (2026-10-25, multi-city): the rules and the allow/deny matrix of a member of one city against another (`DECISIONS-for-review.md` §62b); the personas and the content worlds seeded as members (`e2e/admin/support/{emulators,content}.ts`) |
| CR-M5-4 | contracts | multi-city (`packages/shared/src/schemas/{firestore-ops,firestore,client-writes}.ts`) | `adminDocSchema.cities`, `inviteDocSchema.cities`, `cityDocSchema.limits` (server-owned, out of `CLIENT_WRITES`), `OPS_STEPS`' `memberships` | the documents of §1.2 and §1.8 | done (2026-10-25, multi-city): the four fields with their tests; `cityDocSchema.limits` is structural in `firestore.ts` and the roles live in `schemas/city-roles.ts` (an ESM cycle otherwise) |
| CR-M5-5 | contracts | kit-cli (`packages/engine/src/engine.css`, `ENGINE_API.md`) | §3.2: `.hcm-fullpage` and `.hcm-note` in `engine.css`, documented | the kit has no fourth file for its frame | done (2026-10-25): `.hcm-fullpage` (no margin, the system colours, the viewer at `100dvh`) and `.hcm-note`; `ENGINE_API.md` → *The starter kit* |
| CR-M5-6 | contracts | multi-city (`scripts/site/src/csp.ts`) | import the directive table of `packages/shared/src/kit/csp.ts` (kit-cli) once it lands | one CSP table for the sites, the kit and the export (decisions §15c) | done (2026-10-25, multi-city): `scripts/site/src/csp.ts` re-exports the shared table; the site's policy is unchanged byte for byte |
| CR-M5-7 | contracts | multi-city (`packages/admin/src/provision/project-config.ts`, the provisioner) | `project.json`'s `github` optional; without it the provisioner skips the Workload Identity pool, provider and `gh-deployer` | a self-hosted project deployed from the owner's terminal has no GitHub Actions | done (2026-11-07, M14: `docs/research/M14-start-your-map.md`). Before it: accepted, not applied (2026-10-25, multi-city): it changes the Setup's repository variables and the provisioner's service accounts, bindings and the `workload-identity` item, and no M5 flow needs it yet (`DECISIONS-for-review.md` §62h); what it takes: `github` optional in `project-config.ts`, `gh-deployer` and its grants and `serviceAccountUser` bindings left out without it (`resources.ts`), the `workload-identity` item `ok` without it (`items-iam.ts`), the deploy variables of `setup/state.ts` shown only with it. The integrator (2026-10-25) kept it so: `create-historic-city self-host` writes exactly such a `project.json`, so the self-hosted admin's Provision waits for it, and the deploy card's texts and the admin's budget (0.1 KB left) need a reviewed change of its own (`DECISIONS-for-review.md` §63f) |
| CR-M5-8 | contracts | multi-city (the provisioner `packages/admin/src/provision/**`) | for export: the private bucket's lifecycle rule on `exports/` (`EXPORT_LIMITS.ttlDays`) and `roles/iam.serviceAccountTokenCreator` of the export's runtime account on itself. Export's note (2026-10-25): the lifecycle is one line, `{ prefix: 'exports/', days: EXPORT_LIMITS.ttlDays }` in `PRIVATE_BUCKET_LIFECYCLE` (`packages/shared/src/schemas/imagery-paths.ts`), which `items-storage.ts` applies as it is; the signing account is `fn-admin@` (`export.download` runs as it, `RUNTIME_ACCOUNTS`), so the binding is `roles/iam.serviceAccountTokenCreator` for `serviceAccount:fn-admin@<project>.iam.gserviceaccount.com` on the service account `fn-admin@` itself | §5.3, §5.5 | done (2026-10-25, multi-city): `PRIVATE_BUCKET_LIFECYCLE` gains `exports/` at `EXPORT_LIMITS.ttlDays` (a test holds them equal) and `fn-admin@`'s own policy gains `roles/iam.serviceAccountTokenCreator` for itself (`packages/admin/src/provision/resources.ts`), with their tests |
| CR-M5-9 | contracts | export (`functions/build.mjs`, owner M2's integrator) | copy the kit's page and README and the engine's files without maps into `functions/dist/export-kit/`, recording `ENGINE_VERSION` | §5.3 | done (2026-10-25, export): `functions/build.mjs` copies `templates/starter-kit/{index.html,README.md}`, `engine.iife.js`, `engine.css`, `THIRD_PARTY_NOTICES.txt` and `fonts/` of `packages/engine/dist`, and writes `kit.json` (`ENGINE_VERSION` read from `packages/engine/src/index.ts`, every file with its size); a missing engine build fails with the command that makes it. Read by `functions/src/adapters/export-kit.ts` |
| CR-M5-10 | contracts | export (Settings' section list in `packages/ui/src/admin/settings/` and the Settings area's wiring in `packages/admin/src/settings/`, owner M2c's layers-settings) | one section line and its lazy chunk's wiring for Export the city; multi-city adds the budget's the same way | §1.8, §5.6 | done (2026-10-25, export): `SettingsSectionPort` and `SETTINGS_SECTIONS` gain `export`; `SettingsViewState.export` and `SettingsIntentsPort` extend the export port (`packages/ui/src/admin/export/export-port.ts`); the settings store holds an `ExportSection` (`packages/admin/src/export/export-section.ts`) whose listeners follow the section's route; the page renders `lazyExportCard` (chunk `export-card`); `SectionContext.refresh` re-renders the page when a lazy section's chunk arrives; `sectionRowTexts` names the export row from `adminContent.export.*`; the UI settings fixture and its section-list test follow. Multi-city's budget section joins the same way |
| CR-M5-11 | contracts | multi-city (`firebase/firestore.rules`, `storage.rules`) | for export: `cities/{city}/exports/{id}` readable by the city's members, no client write; `exports/{city}/**` readable by none (the signed address is the only way out). Export's note (2026-10-25): the card's listener reads `cities/{city}/exports` ordered by `createdAt` descending, limit 1 (a single-field index), and `admins/{uid}` of the signed-in admin; `e2e/admin/specs/export/export.spec.ts` needs the match to pass, and row `S-A53-BAD-CLIENT-EXPORTS` (rules tier, `firebase/rules-tests/test/cities.test.ts`) stays `planned` until it lands | §5.3 | done (2026-10-25, multi-city): `cities/{city}/exports/{id}` readable by the city's members, written by none; the private `exports/` by none (`firebase/rules-tests/test/matrix.test.ts`) |
| CR-M5-12 | release | release (`scripts/release/**`, `scripts/ci/{check_release,check_kit_pins,release_pins,pipeline}.py`) | Self-applied, within §2: (1) the release transform also ends every text file with a newline (`engine.css` has none) and lists `release.json`'s files in code-point order; (2) the bump rewrites the lockfile's workspace entries itself (versions only, no `npm install`, no download) and also `functions/deploy-lock/package.json` and its lock, whose version `functions/build.mjs` compares; (3) `kit-pins` runs in `static` and `release` and also requires the CSP's `script-src`, `style-src` and `font-src` to name the pinned folder and nothing to load from jsDelivr outside the engine block; (4) `release-check` requires `cdn/engine/release.json` and the kit's page at the tag; (5) the CLI's `npm pack` is the gate `release-pack`, and `release-cdn --summary` writes the job summary's block; (6) the npm scripts `release:bump`, `release:cdn`, `release:pin-kit`, `release:notes` | the measurement of §2.3 (`DECISIONS-for-review.md` §59), and one place for each fact | done (2026-10-25) |
| CR-M5-13 | release | release, for M1's viewer spec (`e2e/specs/viewer/about.spec.ts`, no M5 owner) | S-V13-HAPPY reads the engine's version from the root `package.json` instead of the literal `'0.0.0'` | the bump to 1.0.0 would otherwise fail it | done (2026-10-25) |
| CR-M5-14 | release | the user (`.editorconfig`, a relaxation: ask first) | `[cdn/engine/*.{js,mjs}]` with `trim_trailing_whitespace = false` (`DECISIONS-for-review.md` §59c): lit-html's minified `[ \t\n\f\r]` template literal ends two lines of the engine with a space and a tab that belong to the string | without it the release commit's `editorconfig` gate fails | open: the user's answer (the integrator ran the bump only; `cdn/engine/`, the kit's pins and the notes' block wait for it, `DECISIONS-for-review.md` §63c, §63h) |
| CR-M5-15 | export | contracts (`e2e/tour/states.ts`, the tour inventory; no M5 owner but the sections) | Self-applied: `e2e/tour/states.ts` was at its 600-line test limit, so any section's spread failed `max-lines`; the M4 sections (orders, autogcp, notify) and the M5 ones (cities, export) moved with their markers into `e2e/tour/admin-sections.ts` (`ADMIN_SECTION_STATES`, one spread in `ADMIN_STATES`). Multi-city's `cities` section is there | §7.3 | done (2026-10-25) |
| CR-M5-16 | export | export (`functions/src/ports/**`, `functions/src/deps.ts`) | Self-applied, within §5.3–§5.5: beside `UrlSigner`, two ports of the export's own, `BlobWriter` (`functions/src/ports/blob-writer.ts`: a stream into a bucket, adapter `storage-writer.ts`) and `ExportKit` (`export-kit.ts`: the kit the build copies, adapter `export-kit.ts`), joined to `Ports` as `writer`, `signer`, `kit`; `TaskQueue`'s payloads gain `export-build`; the Functions emulator signs with the stand-in (`createStandInUrlSigner`, an unsigned V4-shaped address on `storage.googleapis.com` the e2e answers from the Storage emulator) | `BlobStore.write` takes the whole object, the zip may reach 2 GB | done (2026-10-25) |
| CR-M5-17 | export | export (`packages/shared/src/schemas/city-export.ts`, `firestore-ops.ts`; `functions/src/ops/`) | Self-applied, within §5.3: `cityExportDocSchema.errorParams` (the parameters of `error`'s message: `apiError.export.tooLarge`'s size and limit); the export id is `x-<YYYYMMDD>-<n>` (the day's `n`-th, so two owners racing get the same id and the second create is `apiError.export.busy`) and the task id `<city>--<export>` (Cloud Tasks ids are per queue, and two cities share export ids); `OPS_STEPS` gains `exports`, whose step (`functions/src/ops/exports.ts`, since `ops` may not import `export`) expires ready exports past `expiresAt` (deleting the zip) and fails an export still queued or building `buildMinutes` + 10 minutes after it was created (a crashed task), which `export.start` no longer counts as busy; `export.build` runs as `fn-events@` (it reads the public bucket and writes the private one), the callables as `fn-admin@` | §5.3 | done (2026-10-25) |
| CR-M5-18 | export | export (`e2e/specs/starter-kit/export.spec.ts`, `e2e/tsconfig.json`, `e2e/scenarios.json`) | Self-applied, within §5.7: V28 builds its own export of the fixture city with the export's planner and zip writer (`e2e/support/export-site.ts`) and unpacks it with the e2e's reader into `dist/e2e-exports/<test>/` (outside the e2e build's outputs, so a run never makes the next build look stale), served at the site's origin as a static folder, instead of reading S-A53-HAPPY's download: the starter-kit tier runs without the emulators, and on the other machine in a split run (S-A53-HAPPY unpacks its own download). `e2e/tsconfig.json` references `../functions` for it. A new row `S-A53-BAD-UNLICENSED` (functions): a photo the city may not redistribute is never in the published manifest, so never read nor zipped | the tiers stay independent | done (2026-10-25) |
| CR-M5-19 | kit-cli | contracts (`packages/shared/src/index.ts`, `packages/shared/test/fixtures/exports-m5.ts`) | Self-applied, to land §3.2: one export line each for `kit/csp.ts` and `kit/page.ts` in the shared index, and their names in `packages/shared/test/fixtures/exports-kit.ts`, spread into `M5_EXPORTS` | the kit's helpers are `@hcm/shared`'s public API (the CLI, the export and the release import them) | done (2026-10-25) |
| CR-M5-20 | kit-cli | release (the bump's lockfile refresh, CR-M5-12) and the quality image (`docker/Dockerfile.quality`, `manifests` stage) | §4.1's workspace link, not applied (`DECISIONS-for-review.md` §61d, with the exact lines): `package-lock.json` gains `node_modules/create-historic-city` (a link) and `packages/create-historic-city` (version, licence, `bin`, `devDependencies`, `engines`); the image copies `packages/create-historic-city/package.json`. Until then a fresh `npm ci` stops with `Missing: create-historic-city@0.0.0 from lock file`, so the bump, which rewrites the lockfile, adds them in the same change | a lockfile change rebuilds the image's npm layer (downloads) and reinstalls the shared `node_modules` under the other workstreams' checks | done (2026-10-25, the integrator): the two lockfile entries, generated offline; no `COPY` line: the image's `manifests` stage now writes the workspaces' versions as 0.0.0 and drops a workspace without registry dependencies, so neither this link nor the release's bump re-runs the npm layer (CR-M5-27, `DECISIONS-for-review.md` §63b) |
| CR-M5-21 | kit-cli | kit-cli (and, for the test harness, the e2e servers and tour files of §6.1) | Self-applied, within §3–§4 (`DECISIONS-for-review.md` §61c): (1) `fillKitPage`'s text values are optional, every slot still required once; its `lang` sets the element's `lang` too; `KitRelease` (`base` and the page files' integrity) is what `{kind: 'cdn', release}` needs, so `release.json` passes as is; `kitResult` and `isUnpinned` join the API; (2) the template pins `@v1.0.0` with `KIT_UNPINNED_INTEGRITY` until the release pins it, and the e2e then pins the served page to the digests of what the mock CDN serves (annotation `kit-pins`); (3) the CLI writes the deploy files to `<dir>/server/` (in `.gitignore`), takes `--bundle`, `--viewer-origin` and `--billing-wait`, opens the billing page and waits for Enter before polling, runs step 1 without a question, and moves the example places with the city; (4) the site server serves `/kit/` from `templates/starter-kit/` (`e2e/mock-apis/server.ts`), the mock Mapbox answers 401 for `pk.replace-with-your-token` (`router.ts`), the fake tools are files the spec writes; the kit's state is a section of `e2e/tour/states.ts` re-exporting `e2e/tour/kit-states.ts`, its journey a test of `e2e/tour/viewer.tour.ts` (which every tour project runs); (5) `scripts/ci/check_notices.py` and `e2e_build.py` gain the CLI's `dist`. `scripts/site/src/csp.ts` can now import the table (CR-M5-6): with the engine at `'self'` the shared policy is the site's, byte for byte | the contract left these open, or the harness needed them | done (2026-10-25) |
| CR-M5-22 | multi-city | multi-city | Self-applied, within §1 (`DECISIONS-for-review.md` §62e): (1) `AdminDirectory.membership(uid)` (`projectRole`, `roleIn(city)`) instead of two lookups; (2) `admin.session` accepts an invitation to more cities for an admin who already joined, and lists a member's city by its id while it has no document; (3) `cities.create` writes the new city's harvest state due at once (the contract's "a city without a harvest state is due" would undo CR-M3-44) and copies the analytics ids from another city, and the viewer's token is the flow's follow-up `setup.rotatePublicToken`; (4) a city's compute units count its publishes under way until the month ends; (5) the ops documents are read by name only, the USGS browse copies by any admin; (6) the New city map zooms out to 3 (`AdminMapOptions.minZoom`), its rectangle is a capture-phase gesture on the map's own element; (7) `adminShell.nav.cities` and the admins page's role texts (`adminShell.admins.role*`, `inviteAs`, `ownerOnly`, `projectOwner`), `adminContent.cities.new.{moveMap,drawArea,areaLimits}` and `adminContent.budgets.invalid` added in both languages; (8) `site.json`'s `manifest` and `media` optional for a city that reads the bucket only; (9) the e2e fixture cities live in `e2e/fixtures/sites/` | the contract left these open, or the tests showed them | done (2026-10-25) |
| CR-M5-23 | multi-city | the owners of the files named (no M5 owner) | Self-applied, the smallest change each needed: `packages/admin/src/history/history.ts` (`admins.list {cityId}`), `packages/admin/src/map/factory.ts` (`minZoom`), `packages/admin/src/layers/map-session.ts` (`CityFrame.minZoom`), `packages/ui/src/admin/imagery/{approval-card,imagery-port}.ts` and `functions/src/imagery/{studio,import,regeoref,on-raster-upload}.ts`, `functions/src/imagery/orders/watch.ts` (the `city-over` verdict and the city of each daily-jobs check), `functions/src/setup/create-city.ts` (its creator owns the city), `packages/ui/src/admin/settings/hcm-settings-page.ts` (the budget row before Export's), `e2e/support/budget.ts` (`InputFlow.drag`, one counted input), `e2e/scripts/build-site.ts` (the two fixture cities and the Pages tree), `e2e/tour/admin-sections.ts` (the cities section only), `e2e/admin/specs/pois/conflict.spec.ts` (the other admin joins the edited city: the banner names the city's admins only, §1.7), `e2e/admin/specs/notify/push.spec.ts` (a city's event links `#/c/<city>/jobs`, §1.9), and the tests that call the M5 shapes (`packages/ui/test/admin/{imagery/imagery-detail,shell/shell-layout,settings/settings-page}.test.ts`, `functions/test/{imagery/import,history/revert}.test.ts`) | the M5 shapes reach them | done (2026-10-25) |
| CR-M5-24 | multi-city | release (the integrator: `docs/LESSONS.md`, `docs/*.md`, `.agent/**`, `.agents/skills/**` and their mirrors) | The lessons of the multi-city tests, each with the row that pins it: (1) a synchronous store's first answer arrived inside `CityTheme`'s `watch` call, which started a second watch, forever: mark the watch started before calling it (`packages/admin/test/app/mount.test.ts`); (2) a modal `hcm-dialog`'s host has no box (the native dialog is in the top layer): assert the dialog with `getByRole('dialog')` (S-A51-HAPPY-ROLE); (3) after "Discard" for another city the navigation guard restored the old address before the page load, and `beforeunload` asked again: the app stops counting a discarded edit while another city opens (S-A49-BAD-UNSAVED); (4) Mapbox's zoom levels are 512 px tiles: a drag of N px at zoom z spans N·360/(512·2^z) degrees (S-A50-HAPPY); (5) an overlay over the admin map breaks the occlusion and focus-obscured checks, and an inline `style` attribute is refused by the admin's CSP: listen on the map's own element, in the capture phase (S-A50-HAPPY); (6) the bundled city has no document before Setup: the session lists a member's city by its id, else its owner could not invite (S-A02-HAPPY-INVITE-AND-CANCEL); (7) 40 px buttons need 8 px between them and 4 px inside a scrolling list's edges to keep their 48 px targets (`cities.switcher-menu`). The docs to sync: `docs/ARCHITECTURE.md` (memberships, the rules' isolation, the Pages tree), `docs/ADMIN*` guides (the switcher, New city, roles, the city's budget), `docs/SETUP.md` (`site:add`, `build:site`'s `dist/pages`), `docs/TESTING.md` (the fixture cities, `InputFlow.drag`), `docs/CI_PIPELINE.md` (§62g once applied), and the skills naming `admins.*`' shapes | the integrator owns those files | done (2026-10-25, the integrator): `docs/LESSONS.md` 220–226 (with the export's 227–230 and the integrator's 231–233), the guides' M5 chapter, ARCHITECTURE, SETUP, TESTING, CI_PIPELINE, MANUAL_TEST_PLAN, README, the skills and their mirrors |
| CR-M5-25 | multi-city | export (`e2e/admin/support/emulators.ts`, `storageKeptByReset`) | A locked test's reset deletes a content world's export zip: `exports/<city>/<id>.zip` names its city second, but `CITY_FIRST` lacks `exports`, so the reset reads the zip's name as the city; `S-A53-HAPPY` then downloads "No such object." when a locked spec resets during its build (seen in a whole admin-tier run at `admin-l1440-ro`, 2026-10-25). `exports` joins `CITY_FIRST` | the export spec is flaky beside the locked chain | done (2026-10-25, the integrator): `exports` joins `CITY_FIRST` (`e2e/admin/support/emulators.ts`; `docs/LESSONS.md` 230) |
| CR-M5-26 | the integrator | multi-city (`packages/admin/src/settings/city-sections.ts`, `packages/ui/src/admin/settings/`, `packages/shared/src/i18n/admin-settings/`, `budgets.ts`, the cities tour section) | Self-applied: Settings → **Publishing**, a city section over `published` (one switch and Save; budget `publishCity` 2; tour state `cities.publish`; five texts in both languages) | New city leaves a city unpublished (§1.6) and no screen published it: no manifest, no site, no export (`DECISIONS-for-review.md` §63a, `docs/LESSONS.md` 231) | done (2026-10-25) |
| CR-M5-27 | the integrator | the quality image (`docker/Dockerfile.quality`, `manifests` stage) | Self-applied (keeps a tool working): the stage writes every workspace's version and inter-workspace dependency as 0.0.0 and drops the lockfile entries of a workspace it does not copy; checked by building the stage alone and comparing its output byte for byte with the baked files, before and after the bump | CR-M5-20 and the bump without downloads (`DECISIONS-for-review.md` §63b) | done (2026-10-25) |
| CR-M5-28 | the integrator | the e2e (`e2e/admin/specs/cities/city-journey.spec.ts`, `journey-world.ts`, `e2e/support/city-site.ts`, `e2e/support/export-site.ts`, `firebase/rules-tests/test/cities.test.ts`, `e2e/scenarios.json`) | Self-applied: behaviour A54 (`S-A54-HAPPY`, `-BAD-UNPUBLISHED`, `-BAD-OTHER-CITY`): New city to the city's own public site and its export across the apps, and another city's admin refused on the emulators' REST; `unpackExport` beside `exportSite`; CR-M5-11's rules row `S-A53-BAD-CLIENT-EXPORTS` | the integrator's cross-app check (§6.3 step 4; `DECISIONS-for-review.md` §63d, §63e) | done (2026-10-25) |
| CR-M5-29 | the integrator | export (`packages/ui/src/admin/export/export-card.ts`, `packages/shared/src/i18n/admin-export/`), contracts (`packages/shared/src/i18n/api/`) | Self-applied, from the visual audit of the review screenshots: the ready export's summary puts its counts after labels ("photos: 1, layers: 0"; it said "1 photos"), Export is tonal beside a ready export's Download (two filled buttons before), and `apiError.imagery.dailyLimit`, `apiError.export.dailyLimit` and `apiError.city.budgetReached` put their number in brackets or after a label, since the per-city limits can be 1 ("deja 1 exporturi"); the guides' tables follow | a count of one read as a plural (`docs/LESSONS.md` 234, `DECISIONS-for-review.md` §63j) | done (2026-10-25) |
| CR-M5-30 | the integrator | M2c's spec (`e2e/admin/specs/ops/stream.spec.ts`, no M5 owner) | Self-applied: `S-A18-BAD-STREAM-DROP` takes the browser offline (`page.context().setOffline(true)`) besides its route until the page says it is reconnecting, then online with the route still cutting the listen channel | a route reaches only the requests that start after it; the long poll already open stayed open 45 s on the loaded NUC and the split `quality` failed (`docs/LESSONS.md` 236, `DECISIONS-for-review.md` §63j) | done (2026-10-25) |
