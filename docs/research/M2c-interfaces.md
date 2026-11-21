# M2c interfaces: the admin's editors the parallel agents build on

Written on 2026-10-17 by the M2c contracts agent, alone in the tree before the four editor workstreams (photos, pois,
layers-settings, ops-screens) start in parallel. Read it together with `PLAN.md` (Addendum 3: the admin edits
everything, POIs with drawn geometry, live transparency for every overlay, history with one-click revert),
`M2-interfaces.md` (the Firestore model, `CLIENT_WRITES`, the callables, the history triggers, the manifest build, what the
rules enforce beyond `CLIENT_WRITES`: Addendum A, CR-M2-28), `M2b-interfaces.md` (the admin's routes, shell, auth states,
the mount seam, the page registry, the e2e admin world), `M1-interfaces.md` (`MapPort`, the overlay model, the kit's
`hcm-overlay-list`), `docs/ENGINE_API.md` (the manifest the editors feed), `packages/ui/README.md` (the kit and the admin
elements as built), `design-review-security-cost.md` (§1.5 uploads, §1.7 XSS surfaces, §4.4 tileset clean-up),
`DECISIONS-for-review.md` §33f (the admin's app shell) and `layout-a11y-findings.md` (the layout and accessibility
mistakes already fixed once, which no new screen may repeat).

Everything marked **done** exists and is tested; everything else is a contract the owning workstream implements exactly
as written. A change to anything here goes through [Change requests](#13-change-requests), never by editing another
workstream's files. Nothing in M2c touches a real Google, Mapbox or USGS endpoint, creates a cloud resource or deploys:
the admin runs against the Firebase emulators (project `demo-hcm`), the fake upstreams of `@hcm/test-support` and the
mock APIs. Facts that could not be checked without installing a package or a real project are marked **UNVERIFIED**,
each with how the first run proves it.

## 0. What this contract decides

1. **One canonical layout for every editor** (§1): list and detail side by side from 840 px (expanded and up), one pane
   with a back button on medium windows, one pane with a **full-screen editor** on compact windows and landscape phones.
   Every new screen lives inside the app shell's page area (`DECISIONS-for-review.md` §33f); only the panes scroll.
2. **Per-area stores behind one seam** (§2): each area is a DOM-free module of `packages/admin/src/<area>/` with its own
   state, subscription and intents, created when its page first opens; the Lit pages read them through
   `AdminAppPort.content` (structural ports in `packages/ui/src/admin/`). The shell asks every open area before leaving
   an unsaved edit.
3. **The admin map is the viewer's map** (§3): `MapPort`, the Mapbox adapter and their helpers move from
   `packages/engine/src/map/` to `packages/ui/src/map/` (the `@hcm/ui/map` entry), which both apps may import
   (CR-M2c-1). One map per page visit; the style is always `mapbox://styles/mapbox/standard`: **Mapbox Satellite is never
   loaded in the admin**, so it can never become an alignment reference (the GCP editor of M3 uses OSM and Sentinel-2).
4. **`MapDrawPort` on Terra Draw** (§4): `terra-draw` **1.37.0** with `terra-draw-mapbox-gl-adapter` **1.5.0** (MIT,
   no runtime dependencies, the adapter declares `mapbox-gl ^3.9.2`, which 3.32.0 satisfies), bundled into the admin
   only, behind our own port; Mapbox GL Draw 1.5.2 was evaluated and not chosen (§4.1). Every drawing has a keyboard
   and single-pointer alternative (the vertex list, WCAG 2.1.1 and 2.5.7).
5. **Drafts and live preview** (§5): an edit is a draft applied to the admin map at once and written by nothing; Save
   is one Firestore transaction that refuses a document another admin changed meanwhile (a conflict the admin resolves,
   never a silent overwrite); the history trigger keeps the previous version; **publish on save** is the default.
6. **Layer image adjustments** (§8.3): the four sliders map to `raster-brightness-min`, `raster-brightness-max`,
   `raster-contrast` and `raster-saturation` through `rasterAdjustmentPaint` and `LAYER_ADJUSTMENT_RANGES` of
   `@hcm/shared` (**done** in M1); M2c adds the slider model `adjustmentSliders` and `normalizeAdjustments` beside them.
7. **Photo replace** (§6.4): a new upload into the photo's folder; the published image stays until the new derivatives
   exist and swaps in one write; a refused replacement keeps the current image published (CR-M2c-4).
8. **Delete with confirmation and Undo** (§9.5, behaviour A33): photos, POIs and categories are deleted by the client and
   restored from History; a layer is deleted by a new callable `layers.delete`, which queues a `layer-delete` job that
   deletes the Mapbox tileset and source after a seven-day grace (M3 executes it, CR-M2c-3, CR-M2c-13).
9. **Bulk GeoJSON import and export of POIs** (§7.4): parsed and validated in the browser, previewed on the map, written
   in batches; markup stays text.
10. **City settings** (§8.5): area (bounds drawn as a rectangle), texts (name, About, privacy, credits in RO and EN with
    the Markdown subset previewed as DOM), theme (seed colour with a live M3 preview of the whole admin), POI categories
    (CRUD, icon picker over `POI_ICONS`, colour, default opacity), overlay defaults (every overlay's default opacity,
    the photos overlay's included, previewed live).
11. **Operations screens** (§9): admins (list, invite, revoke), history (recent changes, a document's versions, revert,
    restore deleted), jobs (live list and detail, cancel), crash reports (groups by period, detail).
12. **Ownership and shared files** (§11): four workstreams; the shared files (the `admin-content` catalogue, the scenario
    registry, the tour's state inventory, the page registry) have one marked section per area.
13. **Scenario rows** (§12): A02, A08–A10, A14, A16, A18–A23 and A29–A31 refined; new behaviours **A32–A39** (the M2c
    brief's POI, adjustments, default opacity, replace, delete and drafting behaviours took the next free ids).
14. **Every new screen and state joins the tour** (§12.2): `e2e/tour/states.ts`, through `expectStateSound` at every tour
    viewport, light and dark; nothing is ever added to a checker's allowlist to pass.

## 1. Screens per window class

### 1.1 Routes

The routes of `M2b-interfaces.md` §1.1 stay (`packages/admin/src/routing/routes.ts`, **done**: at most two segments
of `^[A-Za-z0-9_-]{1,64}$`). M2c gives them these addresses:

| Address | Shows | Owner |
| --- | --- | --- |
| `#/photos` | photo list (filters, bulk selection, the upload drop zone), with the overview map from expanded | photos |
| `#/photos/<photoId>` | the photo editor | photos |
| `#/pois` | place list (category chips, search), with the overview map from expanded | pois |
| `#/pois/<poiId>` | the place editor; an id with no document and no draft says "not found" with a link to History | pois |
| `#/layers` | historical layers (order, status, published), with the selected layer on the map | layers-settings |
| `#/layers/<layerId>` | the layer editor (texts, defaults, image adjustments) | layers-settings |
| `#/settings`, `#/settings/<section>` | the section list; `area`, `texts`, `theme`, `categories`, `overlays` | layers-settings |
| `#/settings/categories/<categoryId>` | a POI category's editor | layers-settings |
| `#/admins`, `#/admins/<uid>`, `#/admins/invite/<inviteId>` | admins and invitations, an admin's or an invitation's detail | ops-screens |
| `#/history`, `#/history/<entity>/<id>` | the city's recent changes (filters, the Deleted filter); one document's versions | ops-screens |
| `#/jobs`, `#/jobs/<jobId>` | the live job list; a job's steps and logs | ops-screens |
| `#/crashes` | crash groups by period; the selected group's detail in the page (Error Reporting's group ids are not checked against the segment pattern, **UNVERIFIED**, so they are never routed) | ops-screens |

- A new POI gets its id when Add place is chosen (`ContentStore.newId()`, an `ID_PATTERN` id) and opens at
  `#/pois/<id>` as a draft; the document is created on the first Save. A reload of a new place's address without its
  draft shows "not found".
- History joins the navigation once its page exists (`navigationDestinations` excluded it in M2b because it was reached
  only from an item; CR-M2c-8). On compact windows it sits under More with Jobs, Settings, Admins and Crash reports.
- The selection inside a page that is not routed (an entry of a history, a crash group) is page state and survives a
  language switch, not a reload.

### 1.2 Canonical list and detail layout

M3's list-detail canonical layout, measured on the page (`WindowClassController`, never the viewport):

| Window class | Panes | Map-centric editors (photo, place, layer, area) | Other editors (texts, theme, categories, admins, history, jobs, crashes) |
| --- | --- | --- | --- |
| compact (below 600) | one: the list fills the page; an item opens the **full-screen editor** | the map fills the editor, the form is a non-modal bottom sheet (`hcm-sheet` `bottom`: peek shows the title and Save state, half, full); the map's padding follows the sheet so the edited item stays visible | the form fills the editor and scrolls |
| compact height (below 480: a landscape phone) | one, full-screen editor | the map on the leading 60 %, the form in a side pane that scrolls | the form fills the editor |
| medium (600–839) | one: the detail replaces the list inside the page, a back button leads its top row; the rail stays | the map on top (45 % of the pane), the form below in its own scroller | the form fills the pane |
| expanded (840–1199) | list (360 px) and detail side by side | map on top (50 %), the form below | the form, at most 840 px wide |
| large and extra-large (from 1200) | list (360 px; 412 px from 1600) and detail | the map beside the form (form 400 px; 480 px from 1600) | the form, at most 840 px wide, centred in the detail pane |

- Without a selection, the detail pane on expanded and up shows the overview: for photos and places the map with every
  item (a click on a marker or shape selects it), for the other areas an empty state with the page's primary action.
- On compact windows the photo and place lists offer **List | Map** (`hcm-segmented-button`); the map view shows every
  item, a tap opens its editor. The map is the page's one map in both states (§3.5).
- Focus: opening an editor moves the focus to its heading; closing it (Close, Back, Esc on a non-map control) returns it
  to the list item that opened it; Esc never closes an editor that holds unsaved changes without the unsaved guard (§2.4).
- Browser Back on compact and medium: from an editor to its list (the editor is a route), never out of the admin
  (`S-A29-BAD-DEEP-LINK-COMPACT`).

### 1.3 The page area, the editor's bars and the compact full-screen editor

- **Fill mode** (CR-M2c-8): a list and detail page asks the shell for the page area's full height
  (`hcm-page-outlet` honours a page whose class declares `static readonly fillsPage = true`): the page area itself then
  never scrolls, each pane has its own scroller, and nothing scrolls under the top app bar, the rail or the bar
  (`DECISIONS-for-review.md` §33f stays true).
- **The editor frame** (`hcm-editor-frame`, the editing kit, §9.5): a top row with Close (compact) or Back (medium) at
  the leading edge, the item's title (a heading), the save state ("Saved", "Unsaved changes", "Saving…"), **Save**
  (a filled button) and an overflow menu (`more_vert`: History, Delete, and the area's own actions); on expanded and up
  it is the detail pane's own top row. Save is disabled while the draft is clean or invalid; its accessible
  description names the first issue.
- **Compact full-screen editor**: the page asks for `chrome: 'editor'` and the shell hides the navigation bar while the
  editor shows (the frame's Close replaces it); the snackbar stays docked below the page. A landscape phone keeps the
  rail hidden the same way.
- Every floating control on a map (zoom, the drawing toolbar, List | Map, the crosshair button) carries
  `data-layout-check` and keeps 8 px from every other target on compact and medium windows; none may cover Mapbox's
  logo or attribution (the legal check, `docs/TESTING.md` → *The tour's checkers* (d)).

### 1.4 States every screen has

Each is a state of the tour inventory (§12.2), with its own text in both languages:

- **loading** (an `hcm-loading-indicator` and the page's skeleton rows, announced once);
- **empty** (what the list will hold, the primary action; the layers page in M2c says historical layers arrive with the
  USGS processing of M3);
- **error** (a listener or a call failed: the reason as text, Try again; an `apiError.*` through `translateApiError`);
- **offline** (the Firestore listener lost the server: "Reconnecting…" in a polite live region; drafts are kept);
- **not found** (a routed id with no document: a link to History when the document has a history);
- **unavailable map** (no `adminToken` in `setup/status`: the map area explains it with a link to `#/setup/mapbox`;
  every field and the vertex list still work).

### 1.5 Bulk actions

- A list item has a check box from the first selection on (long press or the check box at its leading edge on touch;
  Space on the focused item); a contextual top bar (`hcm-bulk-bar`) replaces the list's top row with the count, Select
  all, Clear and the area's actions (photos: Publish, Unpublish, Set author, source and licence, Confirm rights, Delete;
  places: Publish, Unpublish, Move to category, Delete).
- A bulk action writes in Firestore batches of at most 500 writes, validated document by document first; the documents
  it cannot change are listed with their reason and left alone (`S-A10-BAD-NOT-PUBLISHABLE`), never a partial silent
  failure. One snackbar reports the outcome ("12 published, 2 skipped: see why").

### 1.6 Messages

- Every save, delete, bulk action and refusal ends in one snackbar (the shell's, docked below the page): saves say the
  public map updates within about a minute; deletes offer **Undo** for ten seconds (§9.5).
- A field's problem is shown at the field (`aria-invalid`, `aria-describedby` to the message) with the validation key's
  text (`translate(locale, issue.code)` of the viewer catalogue, the issue path mapped to the field); the frame's Save
  names the first one.
- Live preview changes are announced like the viewer's overlay slider (`hcm-overlay-list` `changedText`): once a slider
  settles, never per frame.

## 2. The content seam

The admin stays DOM-free logic in `packages/admin` and Lit elements in `packages/ui/src/admin` (`M2b-interfaces.md`
§1.7); M2c adds one module per area beside the Setup Assistant's.

### 2.1 Areas and their stores

```ts
// packages/admin/src/content/areas.ts (ops-screens; one marked section per area)
export const CONTENT_AREAS = ['photos', 'pois', 'layers', 'settings', 'admins', 'history', 'jobs', 'crashes'] as const;
export type ContentArea = (typeof CONTENT_AREAS)[number];

/** One area's store: created when its page first opens, kept until sign-out. */
export interface AreaStore<State, Intents> {
    readonly state: State;
    subscribe(listener: (state: State) => void): Unsubscribe;
    readonly intents: Intents;
    /** The page shows (the route's params select the item): attach the Firestore listeners. */
    open(params: readonly string[]): void;
    /** The page is gone: detach every listener (a draft is never left behind: the unsaved guard ran first). */
    close(): void;
    /** Whether leaving now would lose an edit. */
    hasUnsavedChanges(): boolean;
    destroy(): void;
}

export interface AreaModule<State, Intents> {
    readonly area: ContentArea;
    create(services: ContentServices): AreaStore<State, Intents>;
}
```

- `AdminDeps` gains `content: ContentModules` (one optional member per area, in marked sections); `mount` creates a store
  on the first `open` of its page and destroys every store on sign-out. Area state never enters `AdminState`: an area
  re-renders its own page only.
- `AdminApp.intents.navigate` and the hash listener ask `hasUnsavedChanges()` of the open area first (§2.4).

### 2.2 Services

```ts
// packages/admin/src/content/services.ts (ops-screens)
export interface ContentServices {
    /** `project.cities[0]`; the e2e build may override it with `?city=` (CR-M2c-7). */
    readonly cityId: string;
    readonly store: ContentStore;
    /** Resumable uploads to the private bucket (photos' adapter, `packages/admin/src/firebase/uploads.ts`). */
    readonly uploads: UploadPort;
    /** The shell's guarded callables (session expiry and revocation handled as in M2b §1.5). */
    readonly callables: CallablePort;
    /** One map per page visit (pois, §3). */
    readonly maps: AdminMapFactory;
    /** `themeFromSeed` of `@hcm/ui/dynamic-color`, injected by the entry: the admin's Node tests cannot load it. */
    readonly theme: (seed: string) => ThemeTokenSet;
    readonly clock: Clock;
    /** `localStorage`: the sticky photo fields and the last pin (§6.2). */
    readonly local: KeyValueStore;
    readonly log: Logger;
    readonly user: () => { readonly uid: string; readonly name: string | null };
    readonly locale: () => Locale;
    /** The shell's snackbar. */
    readonly notify: (notice: AdminNoticeInput & { readonly action?: { readonly key: AdminContentKey; run(): void } }) => void;
}

/** Firestore for the editors, over the SDK (adapter `packages/admin/src/firebase/content.ts`, ops-screens). */
export interface ContentStore {
    watchDoc<T>(path: string, schema: ZodType<T>, listener: (doc: Stored<T> | null) => void, failed: (failure: StoreFailure) => void): Unsubscribe;
    watchQuery<T>(collection: string, schema: ZodType<T>, query: ContentQuery, listener: (page: StoredPage<T>) => void, failed: (failure: StoreFailure) => void): Unsubscribe;
    /** One transaction: refuses when the document's `updatedAt` is not `expected` (conflict) or it is gone; stamps the write. */
    update(path: string, fields: Readonly<Record<string, unknown>>, expected: string): Promise<WriteOutcome>;
    /** Creates the document (refused when it exists), stamped, with `createdAt` (and `createdBy` where the schema has it). */
    create(path: string, data: Readonly<Record<string, unknown>>): Promise<WriteOutcome>;
    remove(path: string, expected: string | null): Promise<WriteOutcome>;
    /** At most 500 writes, all or none; the caller splits larger jobs and reports per document. */
    batch(writes: readonly BatchWrite[]): Promise<WriteOutcome>;
    newId(): string;
}

/** A document as read: `version` is its `updatedAt` (ISO), `pending` a local write not yet acknowledged. */
export interface Stored<T> {
    readonly id: string;
    readonly data: T;
    readonly version: string;
    readonly pending: boolean;
}

export type WriteOutcome =
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: 'conflict' | 'gone' | 'denied' | 'offline' | 'invalid'; readonly issues?: readonly ValidationIssue[] };
```

- Paths come from `FIRESTORE_PATHS` only. Every write is validated with the entity's shared schema **merged with the
  document as read** before it leaves (`M2-interfaces.md` Addendum A, CR-M2-28 a: the rules let a blank optional text
  through, the server's read refuses it); `invalid` comes back with the issues and nothing is sent.
- Stamps: `updatedBy` = the signed-in uid, `updatedAt` = `serverTimestamp()` on every write (the rules check both);
  `createdAt` and `createdBy` on creates where `CLIENT_WRITES[entity].create` lists them.
- `denied` (a `permission-denied`) makes the shell ask `admin.session` again (M2b §1.5): a revoked admin keeps the draft
  on screen and writes nothing (`S-A20-BAD-REVOKED-WHILE-EDITING`).
- Queries use the composite indexes of `firebase/firestore.indexes.json` (`M2-interfaces.md` Addendum A (g)); a list is
  ordered by `updatedAt` descending unless the area says otherwise (layers by `order`, categories by `order`, jobs by
  `createdAt` descending); a page is 50 documents, More loads the next.

### 2.3 The elements' port

```ts
// packages/ui/src/admin/content-port.ts (ops-screens; one marked section per area)
export interface AreaPort<State, Intents> {
    readonly state: State;
    subscribe(listener: (state: State) => void): () => void;
    readonly intents: Intents;
    open(params: readonly string[]): void;
    close(): void;
}

export interface ContentPort {
    // [section photos]
    readonly photos: AreaPort<PhotosViewState, PhotosIntentsPort> | null;
    // [end photos] ... one member per area, each in its own section
}
```

- `AdminAppPort` gains `readonly content: ContentPort` (CR-M2c-8). Each area's view types live in
  `packages/ui/src/admin/<area>/<area>-port.ts`; `packages/admin/test/app/admin-port.test.ts` gains one compile-time
  check per area (in its marked section) that the real store satisfies the port.
- A page element calls `open(route.params)` when it connects or its route params change, and `close()` when it
  disconnects; it subscribes to its area alone.

### 2.4 The unsaved guard

- Before any route change (a navigation item, a link, Back, a hash typed by hand), closing an editor, switching the
  city's theme preview off, or signing out, the shell asks the open area `hasUnsavedChanges()`. When true it shows the
  kit's confirm dialog: "Discard your changes?" with **Keep editing** (default focus) and **Discard**. A hash change
  cannot be cancelled, so the shell puts the editor's address back (`replaceState`) and asks; Discard then navigates.
- `beforeunload` is armed only while an area holds unsaved changes (the browser's own prompt on reload or close).
- A language switch is not a navigation: the draft, the map preview and the selection stay (`S-A21-HAPPY`).

## 3. The admin map

### 3.1 Where `MapPort` lives (CR-M2c-1)

`dependency-cruiser` forbids the admin to import the engine (`engine-and-admin-independent`), so the admin cannot reuse
`packages/engine/src/map/` where it is. The pois workstream moves, unchanged in behaviour, `map-port.ts`,
`mapbox-adapter.ts`, `mapbox-types.ts` and their helpers (`basemap.ts`, `env.ts`, `icons.ts`, `lifecycle.ts`,
`overlay-registry.ts`, `photos.ts`, `pointer.ts`, `pois.ts`, `rasters.ts`, `compare.ts`) and their tests to
`packages/ui/src/map/` and `packages/ui/test/map/`, exported as the new entry `@hcm/ui/map`
(`packages/ui/package.json` `exports["./map"]`). The engine imports them from there; `@hcm/test-support`'s `FakeMap`
follows. Still true afterwards: no module imports `mapbox-gl` (the adapter takes the global through the structural
`MapboxGl` type), the engine bundles no admin code, and the viewer's e2e (S-V16-HAPPY, the V rows) is unchanged. The
dependency-cruiser edits are `DECISIONS-for-review.md` §34a (stricter or equal; pre-approved category, logged when the
move lands).

### 3.2 Additions to `MapPort` (CR-M2c-2)

Additive, with `FakeMap` support (`clickMap(position)`, recorded calls):

```ts
/** A click (or tap) on the map that hit no photo marker or POI, as a position; the admin's selection and picks. */
onMapClick(handler: (position: LngLat) => void): Unsubscribe;
/** Fits the camera to a box (the city, an edited geometry); animated unless reduced motion or `animate: false`. */
fitBounds(bounds: BBox, options?: { readonly padding?: number; readonly animate?: boolean }): void;
/** The map's padding in CSS px (the compact editor's bottom sheet), so `flyTo` and `fitBounds` centre above it. */
setPadding(padding: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number }): void;
```

### 3.3 The element and the factory

- `hcm-admin-map` (pois, `packages/ui/src/admin/map/`): the map's container, the kit's zoom buttons (48 px, never
  Mapbox's 29 px navigation control), a **crosshair** at the centre shown while the map has the keyboard focus (the
  keyboard's placement point, §4.6), Mapbox's logo and attribution always visible (`docs/TESTING.md` → *The tour's
  checkers* (d)); the map canvas takes the focus with a visible, uncut ring (`layout-a11y-findings.md`: the canvas's
  ring was once cut away whole).
- `AdminMapFactory` (pois, `packages/admin/src/map/`):

```ts
export interface AdminMapFactory {
    /** Mounts the page's map into `container`: Standard style, the admin's token, the city's bounds and view. */
    create(container: HTMLElement, options: { readonly bounds: BBox; readonly view: MapView; readonly locale: Locale }): Promise<AdminMapResult>;
}

export type AdminMapResult = { readonly ok: true; readonly map: AdminMapHandle } | { readonly ok: false; readonly reason: 'no-token' | 'no-webgl' | 'failed' };

export interface AdminMapHandle {
    readonly port: MapPort;
    readonly preview: MapPreview; // §5.2
    /** The drawing tools, loaded on first use (§4). */
    draw(): Promise<MapDrawPort>;
    destroy(): void;
}
```

### 3.4 Token, style and loading

- The token is `setup/status.mapbox.adminToken` (minted by `setup.saveMapbox` for the admin's origins, admin-readable);
  none: `reason: 'no-token'` and the unavailable-map state of §1.4.
- The style is always `mapbox://styles/mapbox/standard` with `show3dObjects: false`, whatever the city's basemap: the
  admin never requests a Satellite style or tileset. A unit test pins the options, and the e2e admin firewall fails a
  request to any `mapbox.satellite` or `satellite-` style or tileset address.
- Mapbox GL JS 3.32.0 is loaded on the first map of the session, by a `<script src>` added to the page (the admin's CSP
  already allows `api.mapbox.com` for scripts, styles and connections: `scripts/site/src/admin/csp.ts`), and its CSS is
  linked inside the element's shadow root, as the viewer does; never bundled. The e2e admin tier serves both from the
  mock CDN (CR-M2c-7).
- `performanceMetricsCollection: false`, `testMode` only in tests, as the viewer's adapter.

### 3.5 One map per page visit

A page renders its map host once and moves it between its states with CSS (the compact list's Map view, the editor, the
overview pane); the map is created when the host is first shown and destroyed when the route leaves the page. Every map
load is billed, so `mapLoadCount` is asserted by the e2e (one per page visit, none on a page that never showed its map).

## 4. `MapDrawPort`

### 4.1 Evaluation (2026-10-17, npm registry metadata read in the pinned Node image)

| | Mapbox GL Draw (`@mapbox/mapbox-gl-draw` 1.5.2, 2026-09-14) | Terra Draw (`terra-draw` 1.37.0 and `terra-draw-mapbox-gl-adapter` 1.5.0, both 2026-10-06) |
| --- | --- | --- |
| Licence | ISC | MIT (both) |
| Runtime dependencies | six (`@mapbox/geojson-area`, `@mapbox/geojson-normalize`, `@mapbox/point-geometry`, `@turf/projection`, `fast-deep-equal`, `nanoid`) | none (both) |
| Mapbox GL JS v3 | no peer dependency declared; developed against `mapbox-gl ^3.4.0` (devDependency); the changelog of 1.5.0–1.5.2 says nothing of v3, the Standard style or slots | the adapter declares the peer `mapbox-gl ^3.9.2` (3.32.0 satisfies it) and `terra-draw ^1.0.0`; adapters per map library since Terra Draw 1.0 |
| UI | its own control (buttons sized for Mapbox's controls, under 48 px) and a stylesheet; we would hide it and drive modes ourselves | none: modes are set from code, so our own M3 toolbar (48 px, RO and EN, one Tab stop) drives them |
| Stylesheet and CSP | a CSS file to load (its control icons are images inside it) | none; it draws with map layers only (sources `td-point`, `td-linestring`, `td-polygon` and their layers, prefix configurable), `renderBelowLayerId` optional |
| Editing | modes `draw_point`, `draw_line_string`, `draw_polygon`, `simple_select`, `direct_select` (vertex drag, midpoint insert, trash) | point, linestring, polygon, rectangle (and more) modes; a select mode with per-mode flags for dragging features and coordinates, midpoints and deletable coordinates |
| Validation | none built in | a `validation` hook per mode, with self-intersection and size validators shipped (**UNVERIFIED** names; read from the installed type declarations) |
| Keyboard | mode shortcuts and Delete or Backspace for the selection | per-mode key events (cancel, finish, delete); neither offers vertex-by-vertex keyboard editing, so §4.6 is ours either way |
| How the adapter reaches Mapbox | `map.addControl` | `new TerraDrawMapboxGLAdapter({ map })`: its source imports only types from `mapbox-gl` (read on GitHub on 2026-10-17); the admin build keeps `mapbox-gl` external anyway (`packages/admin/vite.config.ts` maps it to the global) |

**Decision: Terra Draw.** It is the only one of the two that states v3 support, it has no runtime dependencies and no
UI or stylesheet of its own to hide, override or allow in the CSP, and its validation hook carries our rules (§4.5).
Mapbox GL Draw would bring a control and a stylesheet that fail the 48 px targets and an unstated v3 support.

### 4.2 Pins, loading and boundaries

- `terra-draw@1.37.0` and `terra-draw-mapbox-gl-adapter@1.5.0`, exact, as **dependencies of `@hcm/ui`** (the adapter
  lives in `packages/ui/src/map/draw/`), installed in the digest-pinned Node container (`docs/SETUP.md` → *npm in a
  container*); `npm audit --audit-level=low` stays clean. The adapter's peer `mapbox-gl` is satisfied by the workspace's
  exact `mapbox-gl@3.32.0` devDependency and stays external at run time.
- Bundled (MIT: the licence text joins the admin's third-party notices) into the admin only: the engine never imports
  `packages/ui/src/map/draw/` or `terra-draw` (dependency-cruiser rule, `DECISIONS-for-review.md` §34a), and only
  `packages/ui/src/map/draw/terra-draw-adapter.ts` imports them.
- Loaded with a dynamic `import()` on the first `AdminMapHandle.draw()`. The admin's IIFE build inlines dynamic
  imports, so until the admin page loads its ES module build (`DECISIONS-for-review.md` §34b) Terra Draw is part of
  `admin.iife.js` and counts against its bundle budget. **UNVERIFIED** size: the build stage measures it.
- **UNVERIFIED** until installed: that the published `terra-draw-mapbox-gl-adapter` JavaScript has no `mapbox-gl` import
  left (its TypeScript source imports types only). The pois workstream checks `node_modules` once and records it in
  `docs/LESSONS.md` if it is not so; the build's `external` keeps the bundle free of Mapbox GL either way.

### 4.3 The port

```ts
// packages/ui/src/map/draw/draw-port.ts (pois)
import type { BBox, Geometry, LngLat } from '@hcm/shared';
import type { MapPort, Unsubscribe } from '../map-port.js';

export type DrawShape = 'point' | 'linestring' | 'polygon' | 'rectangle';
/** `static`: shows the features, no editing; `select`: move features and vertices; `draw-*`: add one shape. */
export type DrawMode = 'static' | 'select' | `draw-${DrawShape}`;

export interface DrawnFeature {
    /** Ours, not Terra Draw's: the POI id, `photo-location`, `photo-target`, `bounds`. */
    readonly id: string;
    /** `[lng, lat]` positions only (the manifest's `geometrySchema`); a rectangle is a closed Polygon ring. */
    readonly geometry: Geometry;
}

export type DrawRefusal =
    | { readonly kind: 'outside'; readonly bounds: BBox }
    | { readonly kind: 'self-intersection' }
    | { readonly kind: 'too-many-vertices'; readonly max: number }
    | { readonly kind: 'too-many-rings'; readonly max: number }
    | { readonly kind: 'zero-area' };

export interface DrawChange {
    readonly features: readonly DrawnFeature[];
    /** False while a drag moves (per animation frame), true once it ends or a vertex is added or removed. */
    readonly final: boolean;
}

export interface DrawOptions {
    /** Positions must lie inside (the city's bounds plus `PHOTO_LOCATION_SLACK_DEG`, as the manifest rules check). */
    readonly limits: BBox;
    readonly color: string;
    readonly maxVertices: number; // MAX_GEOMETRY_VERTICES
    readonly maxRings: number; // MAX_POLYGON_RINGS
}

export interface MapDrawPort {
    /** Starts on `map`'s native map (reached through `nativeMap`); drawing layers sit above every overlay. */
    attach(map: MapPort, options: DrawOptions): void;
    readonly mode: DrawMode;
    setMode(mode: DrawMode): void;
    /** Replaces what is drawn; refuses (and reports) a feature that breaks the limits. */
    load(features: readonly DrawnFeature[]): void;
    snapshot(): readonly DrawnFeature[];
    select(id: string | null): void;
    /** Deletes the selected vertex, or the selected feature when no vertex is selected. */
    deleteSelected(): void;
    /** The next map click's position (Esc, `cancelPick` or a mode change resolve null): a camera's target. */
    pick(): Promise<LngLat | null>;
    cancelPick(): void;
    setColor(color: string): void;
    on(event: 'change', handler: (change: DrawChange) => void): Unsubscribe;
    on(event: 'select', handler: (id: string | null) => void): Unsubscribe;
    on(event: 'refused', handler: (refusal: DrawRefusal) => void): Unsubscribe;
    detach(): void;
}

// packages/ui/src/map/draw/terra-draw-adapter.ts (pois): the only importer of terra-draw
export function createTerraDrawPort(load: () => Promise<TerraDrawModules>): MapDrawPort;
```

- Geometry crosses the port as the manifest's `Geometry` (`[lng, lat]`, rings closed); the editors convert with
  `geometryToDoc` / `geometryFromDoc` (`@hcm/shared`, **done**) at the Firestore boundary only.
- Coordinates are rounded to 7 decimals (about 1 cm) before they reach a draft, so a round trip through the port never
  shows a change that is not one.
- Terra Draw's own feature ids, styles and events never leave the adapter.

### 4.4 What each editor draws

| Editor | Mode and features | Owner |
| --- | --- | --- |
| Place | `draw-point`, `draw-linestring` or `draw-polygon` once (Enter or a click on the first vertex finishes; Esc cancels the last vertex, then the shape), then `select`: drag the feature, drag a vertex, drag a midpoint to insert one, Delete removes the selected vertex | pois |
| Photo | `select` on `photo-location` (drag the pin); **Set direction**: `pick()`, then `bearing = bearingBetween(location, target)` and the view cone is redrawn live through `setPhotosData` | photos |
| Settings, area | `draw-rectangle` (two corners), then `select` (drag a corner or the whole box); the four number fields stay in step | layers-settings |
| Layer crop (M3) | `draw-polygon` over the layer, sent to the pipeline as the cutline (`S-A16-HAPPY-CROP`) | M3 |

### 4.5 Validation while drawing

- Every position inside `limits` (the city's bounds plus 0.5°): a click outside adds nothing, a drag outside snaps back;
  `refused` fires and the editor announces the limit (`S-A32-BAD-OUTSIDE-CITY`, `S-A09-BAD-PIN-OUTSIDE-CITY`).
- At most `MAX_GEOMETRY_VERTICES` (500) positions and `MAX_POLYGON_RINGS` (20) rings (`S-A32-BAD-TOO-MANY-VERTICES`).
- A polygon whose edges cross is refused (`S-A32-BAD-SELF-INTERSECTION`); the manifest accepts it, but it draws as a
  broken fill in the viewer.
- A rectangle without width or height is refused (`S-A19-BAD-ZERO-AREA-BOUNDS`).
- The draft validates again with `poiDocSchema` and the manifest rules (`validation.outsideCity`, `validation.ringClosed`)
  before Save (§5.3).

### 4.6 Keyboard and single-pointer alternative

Drawing with a pointer is a path-based gesture, so every geometry has an equivalent without one (WCAG 2.1.1, 2.5.7):

- **The vertex list** (`hcm-vertex-list`, pois; also used by the photo editor for its one point): each position as two
  number fields (latitude, longitude, 7 decimals), Move up, Move down, Remove, and **Add at map centre** after the
  selected one; it edits the same draft, so the map follows.
- **The crosshair**: with the map focused, the arrow keys pan (Mapbox's keyboard handler), `+` and `-` zoom, and
  **Add at map centre** (or Enter on the crosshair button) adds a vertex where the crosshair points; the photo editor's
  **Point at map centre** sets the camera's target there.
- Every tool of the drawing toolbar (`hcm-toolbar`: Point, Line, Area, Select, Delete vertex, Undo last vertex) is one
  48 px button with a name; the toolbar is one Tab stop with arrow keys.
- `S-A32-HAPPY-KEYBOARD` and `S-A09-HAPPY-KEYBOARD` prove a place and a photo can be placed without a pointer event.

### 4.7 Fakes and tests

- `FakeMapDraw` (pois, `packages/test-support/src/fake-map-draw.ts`): records calls, `emitChange(features, final)`,
  `emitRefused(refusal)`, `resolvePick(position)`; the area modules' Node tests use it.
- The adapter is tested in the `ui` Vitest project (Chromium) against a structural fake of the native map plus the real
  Terra Draw: modes, the limits, the refusal events, the id mapping, rounding, detach.
- The e2e drives the real map: it clicks pixels computed from known positions with the Web Mercator formulas of the
  fixed view the spec opens (`e2e/admin/support/map.ts`, pois), and reads results from Firestore and the screen.

## 5. Drafts, live preview, save and history

### 5.1 The draft

```ts
// packages/admin/src/content/draft.ts (ops-screens)
export interface Draft<T> {
    readonly id: string;
    /** No document yet (a new place); Save creates it. */
    readonly isNew: boolean;
    readonly base: Stored<T> | null;
    readonly value: T;
    /** Top-level fields that differ from `base` (only the entity's `CLIENT_WRITES` update fields can be edited). */
    readonly dirty: readonly string[];
    readonly issues: readonly ValidationIssue[];
    readonly saving: boolean;
    /** Another admin saved fields this draft also changed. */
    readonly conflict: { readonly by: string; readonly at: string; readonly fields: readonly string[] } | null;
    /** The document was deleted elsewhere while open (Save is off; Restore and Close are offered). */
    readonly gone: boolean;
}

export class DraftEditor<T> {
    constructor(spec: DraftSpec<T>, deps: { readonly store: ContentStore; readonly clock: Clock });
    edit(patch: Partial<T>): void;
    discard(): void;
    /** A new snapshot arrived: fields this draft does not change merge in; overlapping ones raise `conflict`. */
    rebase(remote: Stored<T> | null): void;
    keepMine(): void;
    takeTheirs(): void;
    save(): Promise<WriteOutcome>;
}
```

`DraftSpec` names the entity (`HISTORY_ENTITIES` or `job`), its document schema, its editable fields
(`CLIENT_WRITES[entity].update`), and an optional cross-document check (a photo or place inside the city, a category id
free in the overlay namespace, bounds that keep every photo and place inside).

### 5.2 Live preview

```ts
// packages/admin/src/map/preview.ts (pois)
export interface MapPreview {
    /** The saved content of the page's map: the selected layer, the photos, one vector overlay per category. */
    show(content: MapContent): void;
    /** A draft overrides its own entity until it is saved or discarded; coalesced to one paint per animation frame. */
    preview(change: PreviewChange): void;
    /** Back to the saved state of that entity (Discard, a page change). */
    restore(target: PreviewTarget): void;
}

export type PreviewChange =
    | { readonly kind: 'layer'; readonly id: string; readonly opacity?: number; readonly visible?: boolean; readonly adjustments?: LayerAdjustments }
    | { readonly kind: 'photos-overlay'; readonly opacity: number }
    | { readonly kind: 'poi-category'; readonly id: string; readonly opacity?: number; readonly color?: string; readonly icon?: string }
    | { readonly kind: 'photo'; readonly id: string; readonly location: LngLat; readonly bearing?: number; readonly fov?: number }
    | { readonly kind: 'poi'; readonly id: string; readonly category: string };
```

| Draft | Map calls (never a write) |
| --- | --- |
| a layer's opacity, visibility, adjustments | `setOverlayOpacity(id, opacity)`, `setOverlayVisibility(id, visible)`, `setLayerPaint(id, rasterAdjustmentPaint(adjustments))` |
| the photos overlay's default | `setOverlayOpacity(PHOTOS_OVERLAY_ID, opacity)` |
| a category's opacity, colour, icon | `setOverlayOpacity(id, opacity)`; colour and icon re-add its `addVectorOverlay` spec |
| a photo's place, direction, field of view | `setPhotosData` with the draft's point and `conePolygon` |
| a place's geometry | the draw layer shows it; its category overlay leaves it out meanwhile |
| the city's bounds | the draw layer's rectangle; `fitBounds` once on open |

Paint property names come only from `overlayOpacityPaint` and `rasterAdjustmentPaint` (`M1-interfaces.md` §4, adapter
rules). A slider's `hcm-input` (per frame) previews; its `hcm-change` (release) only marks the draft. The viewer and the
admin compute the same paint from the same values, so what the admin previews is what the viewer shows
(`S-A35-HAPPY`, `S-A36-HAPPY` compare pixel probes).

### 5.3 Save

1. Validate the whole document (`DraftSpec`'s schema over `base` merged with `value`, then its cross-document check):
   issues go to their fields and nothing is sent (`S-A38-BAD-INVALID`).
2. `ContentStore.update(path, dirtyFields + stamp, base.version)` in one transaction (create for a new document): a
   different `updatedAt` on the server is a `conflict` (`S-A38-BAD-CONFLICT`; the photo draft decides it with that
   version in hand: a change of other fields merges and the Save goes again, `docs/LESSONS.md` 118), a missing document `gone`
   (`S-A38-BAD-DELETED-WHILE-EDITING`), the network `offline` (`S-A38-BAD-OFFLINE`, the draft kept).
3. The history trigger writes the previous version (`M2-interfaces.md` §2.2, **done**); the publish trigger queues a
   manifest build when the document is published and a manifest field changed (§3.5 there, **done**).
4. The snackbar says it is saved and that the public map follows within about a minute (`MANIFEST_DEBOUNCE_SECONDS`).

### 5.4 Publish on save and the public map's status

- New photos (once processed with a known licence) and new places save **published** by default (the Published switch
  starts on; Save publishes in the same write). Unpublishing is always one switch or one bulk action.
- `hcm-publish-status` (the editing kit) sits in every content page's top row and reads `manifests/{city}`
  (admin-readable): "Public map up to date (14:02)", "Updating the public map…" (`queued`, `building`), or the failure
  (`error` as `translateApiError`). Its **Not on the public map** list names every document the last build skipped
  (`manifests/{city}.skipped`: entity, id, first issue) with a link to its editor (`S-A38-BAD-SKIPPED-SHOWN`).

### 5.5 History from the editors

- Every editor's overflow menu has **History** (`#/history/<entity>/<id>`); the document's newest versions are listed
  there with who, when and which fields (§9.2).
- A revert (from History or the delete snackbar's Undo) reaches an open editor as a new snapshot: a clean draft follows
  it, a dirty one gets the conflict choice.

### 5.6 Minimum admin input

Budgets as code (`CONTENT_INPUT_BUDGETS`, `packages/admin/src/content/budgets.ts`, ops-screens, one marked section per
area; exported to the e2e tier like `SETUP_STEP_SPECS`, CR-M2c-11); `inputBudget.flow` counts clicks, fills, file
choices and key presses that commit (`S-A30-HAPPY-CONTENT`):

| Flow | Inputs | How |
| --- | --- | --- |
| a batch of photos with EXIF, the sticky author, source and licence | 3 | drop (or choose) the files, Select all, Publish |
| a photo without EXIF | 4 | the batch's 3, plus one drag of the pin (or Confirm place at the last pin) |
| a photo's direction | 3 | Set direction, a click on what the camera looked at, Save |
| a point place in the last used category | 6 | Add place, Point, a click, the Romanian title, the year (every place names one since 2026-11-12), Save |
| a polygon place of n vertices | n + 5 | Add place, Area, n clicks (the last on the first vertex), the title, the year, Save |
| a category | 4 | Add category, the Romanian label, an icon, Save (colour, opacity and English have defaults) |
| a layer's adjustments | moves + 1 | the sliders, Save |
| a delete and its Undo | 3 | Delete, confirm, Undo |
| a GeoJSON import | 3 | choose the file, one category for the uncategorised features, Import |

Sticky and remembered values, per admin in `localStorage` (keys beside `hcm:admin:lang` and `hcm:admin:theme`; no secret,
no address): `hcm:admin:photoSticky` (author, source label and URL, licence, rights holder), `hcm:admin:lastPin`,
`hcm:admin:lastCategory` (`S-A30-BAD-STICKY-FIELDS`).

## 6. Photos (photos)

### 6.1 The list

- Filters (`hcm-chip`, one query each over the existing indexes): All, Unpublished, Processing, Failed, Rights review;
  a text search filters the loaded page by title. Each item: the thumbnail (or a placeholder while processing), the title
  in the admin's language, the year, chips for unpublished, failed (the reason), rights review, "Check the place".
- From expanded: the overview map beside the list (§1.2); selecting an item flies the map to it.

### 6.2 Upload (A08)

1. The admin drops files on the list (or uses **Add photos**: a file input with `accept` of JPEG, PNG, WebP, TIFF; HEIC
   is accepted so the server's message explains it). A file over `PHOTO_LIMITS.maxUploadBytes` (60 MiB, the Storage
   rules' limit) is refused in the page before anything is created (`S-A08-BAD-OVER-SIZE`).
2. Per file: create `cities/{city}/photos/{id}` (`processing: 'pending'`, `published: false`, `title.ro` = the file
   name without its extension until a suggestion replaces it, the sticky fields, `location` = the last pin or else the
   city's centre, stamped), then a resumable upload to `STORAGE_PATHS.photoUpload(city, uid, id, '<nonce>.<ext>')` with
   `customMetadata.originalName` (`M2-interfaces.md` §3.6). Three files upload at a time; each item shows its progress;
   an interrupted upload resumes, and Retry restarts it into the same document (`S-A08-BAD-UPLOAD-INTERRUPTED`).
3. `photos.onUpload` (**done**) writes `image`, `exif`, `suggested`, `processing: 'done'` (or `failed` with the reason).
4. **EXIF auto-fill**: for a photo created in this session whose pin and fields the admin has not touched, the module
   applies `suggested.location` (only inside the city's bounds plus 0.5°: `S-A08-BAD-EXIF-OUTSIDE-CITY`), `year`,
   `bearing` and `title` in one stamped update. After a reload, unapplied suggestions show as chips with **Apply**.
   EXIF strings are shown as text only (`design-review-security-cost.md` §1.7).
5. A photo left at the fallback pin is marked **Check the place** and bulk Publish skips it until its pin is dragged or
   **Confirm place** is chosen (`S-A08-BAD-NO-EXIF`).
6. A refused file shows its `processingError` (`apiError.photo.*`) on its item; a duplicate links to the photo it repeats
   (`duplicateOf`) and offers Delete (`S-A08-BAD-DUPLICATE`).

### 6.3 The editor (A09)

- Fields: title and description (RO, EN optional with the fallback note), date text, year and end year, author, licence
  (`FIRESTORE_LICENSES`; `unknown` cannot be published), rights holder, source URL and label, permission note, links (at
  most 5, https only), rights review, Published.
- Map: the pin (drag), **Set direction** (a pick, §4.4), the field of view (an `hcm-slider` from `MIN_FOV` to `MAX_FOV`,
  default `DEFAULT_FOV` 60°), the cone live; the vertex list's single row for latitude and longitude, and **Point at map
  centre** for the direction (§4.6).
- Save writes the dirty fields (§5.3); the location is validated against the city before it leaves (the rules check it
  too: `M2-interfaces.md` Addendum A (c)).
- Suggestions from Nominatim and AI translations are M4 (`S-A09-BAD-NOMINATIM-429`, `S-A09-BAD-AI-UNAVAILABLE` stay
  planned there).

### 6.4 Replacing the image (A37)

1. **Replace image** (overflow menu) chooses one file; the size check of §6.2 applies; the document is not touched
   (no `processing: 'pending'`: the manifest would drop a published photo).
2. The upload goes to the photo's own upload folder; the editor shows "Processing the new image…" (session state) and
   watches the document. **Cancel** aborts the upload; nothing changes (`S-A37-BAD-CANCEL-UPLOAD`).
3. `photos.onUpload` writes the new `image` (new `sha256`, new content-hashed derivatives) in one transaction: the swap
   is atomic for the manifest and the viewer; the old derivatives are swept once no manifest names them
   (`M2-interfaces.md` Addendum A, CR-M2-32 a). The same file again changes nothing (`S-A37-BAD-SAME-FILE`).
4. A refused replacement keeps the current image published: when the photo already has an `image`, `photos.onUpload`
   keeps `processing: 'done'` and records the refusal in a new server-owned field `replacement: {error, at}` instead of
   failing the photo (CR-M2c-4; today it would set `processing: 'failed'`, which takes a published photo off the public
   map: `S-A37-BAD-REFUSED`, `S-A37-BAD-REFUSED-KEEPS-IMAGE`). A later successful processing removes `replacement`.
5. A history revert never restores an image (server-owned fields stay, `M2-interfaces.md` §3.2); the previous original
   stays in the private bucket.

### 6.5 Publish, unpublish and rights review (A10)

- Publish needs `processing: 'done'`, an `image` and a licence other than `unknown` (the rules' publish gate,
  `M2-interfaces.md` Addendum A (d)); the switch and the bulk action say why a photo cannot be published. An English
  title is optional (CR-1 of `M1-interfaces.md`): the M2 row `S-A10-BAD-MISSING-EN-TITLE` is replaced by
  `S-A10-BAD-NOT-PUBLISHABLE`.
- **Confirm rights** (bulk, on the Rights review filter) sets `rightsReview: false`; the viewer's rights note goes with
  the next manifest (`S-A10-HAPPY-RIGHTS-REVIEW`).

### 6.6 Delete

Client delete (allowed by the rules), with the confirmation and Undo of §9.5. A photo restored after the nightly sweep
removed its public files is processed again from its kept original by `history.revert` (CR-M2c-5,
`S-A23-BAD-RESTORE-AFTER-SWEEP`).

## 7. Points of interest (pois)

### 7.1 The list

Category chips (from `poiCategories`, with their icons and colours), Unpublished, a text search by title; each item:
the category's icon on its colour, the title, the years, the shape (point, line, area). A place stored before every place
needed a year (the owner's request of 2026-11-12) shows **Year missing** under its row instead of the years. From expanded, the overview map
draws every place in its category's overlay; a click on a shape selects it (`onPoiClick`).

### 7.2 The editor

- Category (a select over the city's categories; the last used one for a new place), title and description (RO, EN
  optional; the description in the Markdown subset with the DOM preview of `hcm-markdown-field`), start and end year
  (at least one: a single year, an open start or end, a span from and to, or only `yearSeen` for a street traced on a
  plan of that year, the end never before the start, each from 1800 to next year; `placeYearIssues` of `@hcm/shared`, the
  owner's request of 2026-11-12), links (at most 5), photos (`hcm-photo-picker`, a dialog listing the city's photos by title with
  thumbnails: at most `MAX_POI_PHOTOS`, 20), Published.
- Geometry: drawn and edited on the map (§4.4) or in the vertex list (§4.6); the type is chosen when the place is added
  (Point, Line, Area) and changes only by redrawing ("Redraw as…" clears the geometry after the unsaved guard's
  question).
- Save: `geometryToDoc(geometry)`, validated with `poiDocSchema`, the manifest's place rules (inside the city,
  closed rings) and `placeYearIssues` (no year: `validation.required` at the start year, "Write a year, or the years from
  and to", shown as the place opens; a year after next year by the admin's clock: `validation.tooBig`, "The year cannot be after next year" in the editor's
  own words (`issue-text.ts`, an admin text, so the viewer's catalogue does not carry it), once the field is left), then §5.3. The stored schemas keep both years optional, so a place saved before the rule still loads in the
  admin and still shows on the public map; its Save asks for a year. The Firestore rules ask the same (`dated`): every
  create names a year, and an update without one only publishes, unpublishes or moves the place to another category
  (the list's bulk actions); no year may be after next year by the server's clock (`request.time`). The GeoJSON import
  checks both, by the admin's clock, as Save does. `review.decide` refuses to approve a place without one
  (`apiError.review.placeYear`), and `history.revert` does not restore a version without a year over a place that names
  one (`apiError.history.placeYear`); an Undo of a delete and a place that never had a year restore as before.

### 7.3 Delete

Client delete with §9.5; bulk delete of a selection; places come back from History's Deleted filter
(`S-A33-HAPPY-BULK`, `S-A23-HAPPY-RESTORE-DELETED`).

### 7.4 GeoJSON import and export (A34)

- **Export** (list's overflow menu: every place, or the selection): a `FeatureCollection` file
  (`<city>-places-<YYYY-MM-DD>.geojson`, `application/geo+json`, made in the browser as a `Blob` and saved through a
  download link), each feature `{type: 'Feature', id, geometry, properties: {category, title: {ro, en?}, description?,
  yearStart?, yearEnd?, yearSeen?, links, photoIds?, published, sourceLayer?}}` and a foreign member
  `hcm: {version: 1, city, categories: [...]}` naming the categories it uses.
- **Import** (overflow menu, then a file): read as text (at most 5 MB, else refused before parsing: `S-A34-BAD-NOT-GEOJSON`),
  `JSON.parse` in a `try`, a `FeatureCollection` or a single `Feature`; each feature mapped field by field into a new
  object (never spread from the file) and validated with `geometrySchema`, `poiDocSchema` and the manifest's place
  rules, and `placeYearIssues` without the clock (a feature naming no year and no `yearSeen` is refused as invalid at
  `yearStart`). The
  preview dialog counts **new**, **updated** (an `id` that names an existing place), **unchanged** and
  **refused** (each with its reason: an unsupported type such as `MultiPolygon`, a position with altitude, an open ring,
  a position outside the city, an unknown category, more than 500 positions; `S-A34-BAD-INVALID-FEATURES`), and draws the
  valid ones on the page's map. Features without a known category take the one category the admin chooses in the
  dialog.
- **Write**: batches of at most 500 (`ContentStore.batch`), new ids from `newId()`, every write stamped; the total after
  the import may not pass `MAX_POIS` (5000), checked before the first write (`S-A34-BAD-TOO-MANY`). The history trigger
  records each document; the publish trigger's debounce makes one manifest build of the whole import.
- Imported text is text: titles and descriptions are stored as typed, a description is Markdown subset and HTML stays
  characters (`S-A34-BAD-MARKUP-IS-TEXT`). An export imported again changes nothing (`S-A34-HAPPY-ROUND-TRIP`).

## 8. Layers and settings (layers-settings)

### 8.1 The layers page

- Layers are created by the raster pipeline (M3: client creates are refused, `CLIENT_WRITES.layer.create` is empty);
  until then the page's empty state says so, and the e2e seeds a ready `xyz` layer served by the mock APIs as solid
  colours.
- The list in `order` (highest on top, as the viewer draws them): label, year, `LAYER_STATUSES` chip, Published switch,
  a drag handle and **Move up** / **Move down** (the keyboard's way); a reorder rewrites the `order` of the layers it
  moved in one batch.
- From expanded the selected layer shows on the map above the Standard basemap at its draft opacity and adjustments.

### 8.2 The layer editor

Label and description (RO, EN optional), attribution (plain text, always shown with the layer), year and date, **Shown
at start** (`defaultVisible`), **Default opacity** (`opacity`, an `hcm-slider` 0–100 %), the four image adjustments with
**Reset**, Published. Every slider previews live on the map (§5.2); Save writes the dirty fields; the manifest and then
the viewer apply them (`S-A35-HAPPY`, `S-A36-HAPPY`). Replace image, Crop and Re-georeference are M3 (`S-A14-HAPPY-REPLACE-SOURCE`,
`S-A16-HAPPY-CROP`): the M2c editor does not show them.

### 8.3 Image adjustments

The mapping to Mapbox paint is `@hcm/shared` (**done**: `LAYER_ADJUSTMENT_RANGES`, `layerAdjustmentsSchema`,
`rasterAdjustmentPaint`, which clamps and keeps the minimum at or below the maximum). M2c adds the slider model beside
it (layers-settings, `packages/shared/src/overlays/adjustments.ts`, exported from `@hcm/shared`):

```ts
export interface AdjustmentSlider {
    readonly name: LayerAdjustmentName;
    /** Slider units: percent; brightness 0 to 100, contrast and saturation -100 to 100; step 1. */
    readonly min: number;
    readonly max: number;
    readonly neutral: number;
}

export const ADJUSTMENT_SLIDERS: readonly AdjustmentSlider[]; // brightnessMin, brightnessMax, contrast, saturation

/** Slider value (percent) to the stored value and back; exact for every whole percent. */
export function adjustmentFromSlider(name: LayerAdjustmentName, percent: number): number;
export function sliderFromAdjustment(name: LayerAdjustmentName, value: number | undefined): number;

/** The stored form: neutral values dropped, undefined when every value is neutral; min never above max. */
export function normalizeAdjustments(adjustments: LayerAdjustments): LayerAdjustments | undefined;
```

- Mapbox has no gamma property: the brightness minimum and maximum are the levels control (`docs/ENGINE_API.md`).
- Moving the minimum past the maximum stops it at the maximum (and the reverse), live and in the stored value
  (`S-A35-BAD-CROSSED-BRIGHTNESS`); the `aria-valuetext` is the signed percentage ("+20 %").

### 8.4 Deleting a layer (CR-M2c-3, CR-M2c-13)

- A layer cannot be deleted by a client (the rules allow read and update only, and should stay so: the tileset must be
  cleaned up, `design-review-security-cost.md` §4.4). **`layers.delete`** (admin, App Check consume,
  `{cityId, layerId}` → `{jobId, runsAt}`; errors `notFound`, `apiError.layers.busy` while a job of the layer runs) in
  one transaction deletes the layer document (the history trigger keeps it whole) and creates
  `cities/{city}/jobs/{id}` `{type: 'layer-delete', status: 'queued', params: {layerId, tilesetId?, sourceSha?},
  dispatchAt: now + LAYER_DELETE_GRACE_DAYS}` with `LAYER_DELETE_GRACE_DAYS` = 7.
- M3's dispatcher runs it after `dispatchAt`: if the layer document exists again (restored), the job ends `cancelled`;
  otherwise it deletes the Mapbox tileset and its source with tombstone retries, and the layer's files in our buckets.
  M2c's Jobs page shows it waiting with its date and "runs with the raster pipeline" (`S-A18-HAPPY-WAITING-JOB`).
- A revert of the delete within the grace restores the layer and sets the waiting job `cancelled`; after the job
  succeeded, `history.revert` answers `apiError.history.layerGone` (CR-M2c-5, `S-A23-BAD-LAYER-GONE`).

### 8.5 Settings

Sections (`#/settings/<section>`; a list of sections on compact and medium, list and detail from expanded); each section
is its own draft with its own Save:

| Section | Edits | Notes |
| --- | --- | --- |
| `area` | the bounds (a rectangle on the map or four number fields), the centre and zoom (**Use this view**: the map's current centre and zoom), the minimum and maximum zoom | a rectangle without area is refused (`S-A19-BAD-ZERO-AREA-BOUNDS`); bounds that would leave a photo or a place beyond the bounds plus 0.5° are refused with the list (`S-A19-BAD-BOUNDS-EXCLUDE-CONTENT`): the manifest would drop them |
| `texts` | the name (RO, EN), About and privacy (RO, EN; Markdown subset, 10,000 characters, a DOM preview beside or under the field), credits (at most 50: label RO and EN, an optional https link; reorder) | the preview walks `parseMarkdown(...).paragraphs` into DOM nodes exactly as the viewer's About (`packages/ui/src/viewer/markdown.ts`, reused, never copied); `rejectedLinks` (a link that is not https) refuse the save with the line (`S-A19-BAD-MARKDOWN-LINK`); typed HTML shows as text |
| `theme` | the seed colour (a hex field, a native colour input and eight presets), the basemap choice (Standard or Standard Satellite for the viewer, as text: the admin's own map stays Standard, §3.4) | each change runs `services.theme(seed)` and `intents.previewTheme(tokens)` (M2b, **done**): the whole admin recolours live in light, dark and high contrast; Discard or leaving restores the city's colours (`S-A19-BAD-THEME-DISCARDED`); a seed whose tokens fail `contrastIssues` is moved to the nearest passing tone with a warning (`S-A19-BAD-LOW-CONTRAST-SEED`); Save writes `theme {seedColor, tokens}` precomputed for the manifest |
| `categories` | POI categories (A39): add, edit, reorder, delete; `#/settings/categories/<id>`: label (RO, EN), icon, colour, default opacity | the icon picker is a radio group (`role="radiogroup"`, arrow keys) of the 30 `POI_ICONS`, each with its label in both languages (`adminContent.settings.icon.<name>`); an icon outside the set is kept and shown as drawn with the pin (`S-A39-BAD-UNBUNDLED-ICON`); the colour needs 3:1 against the white glyph (`contrastRatio`, kit theme) or the nearest passing tone is proposed (`S-A39-BAD-LOW-CONTRAST-COLOUR`); a new category's id is `slugify(label.ro)`, suffixed when it is `photos`, a layer id or another category's (`S-A39-BAD-ID-CLASH`); at most `MAX_POI_CATEGORIES` (`S-A39-BAD-LIMIT`); the default opacity previews live on the map |
| `overlays` | the default of every overlay: each layer's Shown at start and opacity, the photos overlay's opacity (`cities/{city}.photosOverlay.defaultOpacity`), each category's opacity | `hcm-overlay-list` (the kit's, shared with the viewer's Layers panel, `M1-interfaces.md` §5.1) over the city's overlays with the map beside it; the switch exists only for layers (CR-M2c-10: a per-item `toggleable`); one Save writes every changed document in one batch (`S-A36-HAPPY`) |

The city document is published from creation (`DECISIONS-for-review.md` §25a); taking the public map offline is not
offered in M2c.

**Addendum 2026-11-01 (finding 41 of `manual-test-2026-10-25.md`, `DECISIONS-for-review.md` §78c): Add the starter
categories.** The `categories` list has **Add the starter categories** beside Add a category: one batch writes the
starters of `STARTER_POI_CATEGORIES` the city lacks (`missingStarterCategories` of `@hcm/shared`: a category's RO or EN
label equal to a starter's after NFD, combining marks removed, lower case and spaces collapsed), as many as fit under
`MAX_POI_CATEGORIES` (`startersFor`, `packages/admin/src/pois/starter.ts`), the ids clear of the layers (read once at the
click) and the categories, the orders after the city's own; the snackbar names the count (`adminContent.settings.startersAdded`);
with none missing the button is off with `adminContent.settings.startersPresent` (state `startersMissing`,
`addingStarters`; intent `addStarterCategories`; S-A39-HAPPY-ADD-MISSING-STARTERS, S-A39-BAD-STARTERS-PRESENT).

## 9. Operations screens (ops-screens)

### 9.1 Admins (A02)

The M2b page (`hcm-admins-page`, `#/admins`) moves to `packages/ui/src/admin/admins/` and takes the canonical layout: the
list (admins with role and since, then the pending invitations with their expiry), the detail (an admin: role, invited
by, since, **Remove access** unless owner or self; an invitation: expiry, the link with Copy, **Cancel invitation**),
**Invite** (a dialog with the Google account address, `inviteRequestSchema` in the page first). Removing access and
cancelling an invitation each ask first (`adminContent.admins.revokeConfirm`; `S-A02-BAD-REVOKE-CANCELLED`). The
callables are M2's (`admins.list`, `admins.invite`, `admins.revoke`, **done**); their texts stay in `adminShell.admins.*`.

### 9.2 History (A23)

- `#/history`: the city's changes newest first, from a collection-group query on `history` asking `cityId ==` the city
  (every entry names its city, CR-M2c-14) ordered by `updatedAt` descending (CR-M2c-6: the rules allow admins a
  collection-group read; the composite indexes at `COLLECTION_GROUP` scope start with `cityId`); filters by entity and
  by action (changed, created, deleted, reverted); the **Deleted** filter lists deleted documents with who and when,
  each with **Restore**. Other cities' entries never reach the page, so they neither take its rows nor make it offer
  Show more (`S-A23-BAD-OTHER-CITY`); an entry written before `cityId` (none outside the emulators) shows only among its
  document's versions.
- `#/history/<entity>/<id>`: the document's entries; the selected entry shows each changed field before and after, as
  text (a geometry as its type and position count, adjustments as percentages, a theme as its seed colour).
- **Revert** (and **Restore**) asks first, then calls `history.revert` (**done**); a refusal shows its code as an alert
  (`apiError.history.invalidSnapshot` with the count, `nothingToRestore`, the new `layerGone`, `placeYear` for a place's
  version without a year over a dated place, §7.2) and changes nothing
  (`S-A23-BAD-REFUSED-SHOWN`). A creation entry offers no Revert.

### 9.3 Jobs (A18)

- `#/jobs`: a live query (`onSnapshot`) of the city's jobs by `createdAt` descending, status chips as filters; each item:
  type, status, progress (an `hcm-progress`), created by and when, the wait for a job with `dispatchAt`.
- `#/jobs/<jobId>`: steps with their states, the error (text), the log lines (`jobs/{id}/logs` by `seq`, live, as text),
  **Cancel** while the job is not finished (`cancelRequested: true`, stamped; the rules refuse it on a finished job:
  `S-A18-BAD-CANCEL-FINISHED`). Retry and the pipeline's own steps arrive in M3.
- A listener that fails shows "Reconnecting…" and resumes from where it was, each log line once
  (`S-A18-BAD-STREAM-DROP`).

### 9.4 Crash reports (A22)

`#/crashes` takes the canonical layout around the existing panel's data (`telemetry.listGroups`, **done**): a period
choice (24 hours, 7 days, 30 days), the groups (message as text, count, affected releases), **More** for the next page;
the detail shows the count, first and last seen, the representative redacted message and stack as text, and **Open in
Error Reporting** (the console's group page: **UNVERIFIED** address, added to `links.json` only after the weekly contract
probe, CR-M2c-15). A disabled API answers `apiError.cloud.apiDisabled` with its enable link
(`S-A22-BAD-CRASHES-API-DISABLED`). The Setup card's `hcm-crash-groups` stays where setup-ui built it.

### 9.5 The editing kit (ops-screens' foundation)

Elements in `packages/ui/src/admin/editing/` (every one with its tests in both languages and through axe), logic in
`packages/admin/src/content/`:

| Piece | What it is |
| --- | --- |
| `hcm-list-detail` | the canonical layout of §1.2 (panes, back row, fill mode, focus return) |
| `hcm-editor-frame` | the editor's top row, save state, Save, overflow menu, the conflict and gone banners |
| `hcm-confirm-dialog` | `hcm-dialog` with a headline, the consequence, Cancel (default focus) and a confirm action in the error colour for destructive ones |
| `hcm-bulk-bar` | the contextual selection bar of §1.5 |
| `hcm-publish-status` | the public map's state and the Not on the public map list (§5.4) |
| `hcm-empty-state` | an icon, a sentence and the primary action |
| fields | `adminFields` styles for native inputs (outlined, 48 px, label, supporting and error text, `:focus-visible, :focus-within` rings as the USGS card's fix), `hcm-localized-field` (RO and EN with the fallback note), `hcm-markdown-field` (a text area and the DOM preview), `hcm-links-field` (at most 5 https links), `hcm-years-field` |
| `DraftEditor`, `UnsavedGuard`, `CONTENT_INPUT_BUDGETS` | §5.1, §2.4, §5.6 |
| `ContentStore` adapter and its fake | `packages/admin/src/firebase/content.ts` (the only module of the editors that imports the Firebase SDK, rule `admin-firebase-sdk-only-in-adapters`); `packages/test-support/src/fake-content-store.ts` |

**Delete with confirmation and Undo** (behaviour A33): the dialog names the item (or the count) and says what follows
(it leaves the public map within about a minute; it can be restored from History; for a layer, that its Mapbox tileset
is deleted after seven days unless it is restored). After the delete the snackbar offers **Undo** for ten seconds for a
single item: it waits for the delete's history entry (the trigger writes it within seconds; at most ten) and calls
`history.revert` on it. A bulk delete points to History's Deleted filter instead. A category in use asks where its
places go first (one choice) and then moves them and deletes it in batches, the category last
(`S-A33-BAD-CATEGORY-IN-USE`).

## 10. Texts, icons and security

### 10.1 The `admin-content` catalogue (done: the skeleton)

`packages/shared/src/i18n/admin-content/` (`ro.ts`, `en.ts`, `index.ts`: `translateAdminContent`, `AdminContentKey`),
exported from `@hcm/shared`, kept out of the viewer bundle like the other admin catalogues. Romanian is the key source,
English is typed against it, the `i18n` gate checks both, `packages/shared/test/i18n-admin.test.ts` checks the parity,
the comma-below diacritics and that every key sits in its own area's section.

| Section (marked `// [section <name>]` … `// [end <name>]`) | Key prefix | Owner |
| --- | --- | --- |
| common | `adminContent.common.` | ops-screens (the editing kit) |
| map | `adminContent.map.` | pois (the admin map, the drawing toolbar, the vertex list) |
| photos | `adminContent.photos.` | photos |
| pois | `adminContent.pois.` | pois |
| layers | `adminContent.layers.` | layers-settings |
| settings | `adminContent.settings.` | layers-settings |
| admins | `adminContent.admins.` | ops-screens |
| history | `adminContent.history.` | ops-screens |
| jobs | `adminContent.jobs.` | ops-screens |
| crashes | `adminContent.crashes.` | ops-screens |

- Validation messages are the viewer catalogue's `validation.*` (`translate`), callable errors the API catalogue's
  (`translateApiError`); a new API code joins `packages/shared/src/i18n/api/{ro,en}.ts` with the change request that
  adds it (§13).
- `AdminNoticeKey` (`packages/ui/src/admin/admin-port.ts`) gains `AdminContentKey` (CR-M2c-8).

### 10.2 Icons (CR-M2c-9)

Added to `UI_ICONS` (`packages/ui/src/icons.ts`) and the font subset in ops-screens' first change, all at once
(`fonts:check` shapes each name, so a name the font lacks fails there): `add_photo_alternate`, `arrow_downward`,
`arrow_upward`, `cancel`, `center_focus_strong`, `crop_free`, `crop_square`, `delete`, `deselect`, `download`,
`drag_indicator`, `edit`, `explore`, `filter_list`, `palette`, `pentagon`, `person_add`, `person_remove`, `polyline`,
`publish`, `restore`, `select_all`, `undo`, `unpublished`, `wifi_off`. Another icon is a change request to ops-screens.
The POI category icons are `POI_ICONS` (already in the subset).

### 10.3 No HTML from data, uploads and imports

- Everything shown comes through Lit templates or `textContent`: EXIF values, file names, imported GeoJSON properties,
  job logs, crash messages, history snapshots, other admins' names. Markdown is walked from `parseMarkdown` into DOM
  nodes; links get `rel="noopener noreferrer nofollow ugc"` and open in a new tab.
- Uploads are checked in the page for size only; the type is decided by the server's sniffing (`photos.onUpload`), never
  by the extension or the browser's `type` (`design-review-security-cost.md` §1.5).
- A GeoJSON file never reaches the server: it is parsed in the page, mapped field by field into new objects (no spread,
  so no prototype keys travel) and validated with the shared schemas before any write.
- Ids from a file or an address are looked up in a `Map` and validated with `ID_PATTERN`, never used in a selector.

## 11. Ownership and shared files

### 11.1 Who owns what

Each workstream writes only its own paths (tests mirror them under `packages/<pkg>/test/**`); reading and importing
anything is fine; anything else is a change request.

| Workstream | Owns (writes) |
| --- | --- |
| photos | `packages/admin/src/photos/**`, `packages/ui/src/admin/photos/**`, `packages/admin/src/firebase/uploads.ts`; `functions/src/photos/upload.ts` and the `replacement` field of `photoDocSchema` (CR-M2c-4); `packages/test-support/src/images.ts` (the EXIF test images, moved from `functions/test/photos/images.ts`); `e2e/admin/specs/photos/**`, `e2e/admin/support/photos.ts`, `e2e/tour/admin-photos.tour.ts` |
| pois | `packages/admin/src/pois/**`, `packages/ui/src/admin/pois/**`, `packages/admin/src/map/**` (the factory, `MapPreview`), `packages/ui/src/admin/map/**` (`hcm-admin-map`, the drawing toolbar, `hcm-vertex-list`), `packages/ui/src/map/**` after the move of CR-M2c-1 (the map adapter and `draw/`), `packages/engine/src/map/**` until it is moved, `packages/test-support/src/fake-map.ts` and `fake-map-draw.ts`; `e2e/admin/specs/pois/**`, `e2e/admin/support/map.ts`, `e2e/tour/admin-places.tour.ts`, `e2e/tour/admin-drawing.tour.ts`, the admin tier's Mapbox mocks in `e2e/mock-apis/` (CR-M2c-7) |
| layers-settings | `packages/admin/src/{layers,settings}/**`, `packages/ui/src/admin/{layers,settings}/**`, `packages/shared/src/overlays/adjustments.ts`, `packages/ui/src/components/overlay-list.ts` (CR-M2c-10); `functions/src/layers/**` with its registry rows in `packages/shared/src/api/` and `JOB_TYPES`'s `layer-delete` (CR-M2c-3); `e2e/admin/specs/{layers,settings}/**`, `e2e/tour/admin-layers.tour.ts` |
| ops-screens | `packages/admin/src/content/**`, `packages/ui/src/admin/editing/**`, `packages/ui/src/admin/content-port.ts`, `packages/admin/src/firebase/content.ts`, `packages/admin/src/{admins,history,jobs,crashes}/**`, `packages/ui/src/admin/{admins,history,jobs,crashes}/**`, the shell's M2c changes (`packages/ui/src/admin/shell/**`, `packages/admin/src/{app,routing,state}/**`: fill mode, the compact editor, the unsaved guard, `content`, History in the navigation; CR-M2c-8), `packages/ui/src/icons.ts` and the font subset (CR-M2c-9), `packages/test-support/src/fake-content-store.ts`, `functions/src/history/**` (CR-M2c-5), `firebase/firestore.rules`, `firebase/firestore.indexes.json` and `firebase/rules-tests/**` (CR-M2c-6, for every workstream's rule change); `e2e/admin/world.ts`, `e2e/projects.ts` and the content world (CR-M2c-7), `e2e/admin/specs/ops/**`, `e2e/tour/admin-jobs.tour.ts` and `e2e/tour/admin-history.tour.ts` |
| integrator (after the four) | `docs/*.md` (the admin guides' chapters per area, `docs/TESTING.md`, `docs/ARCHITECTURE.md`, `docs/LESSONS.md`), `.agent/**`, `.agents/**`, `.claude/**`, `docs/research/M0-handoff.md`, `docs/research/DECISIONS-for-review.md`, `functions/src/index.ts` and `functions/src/global-options.ts` beyond the marked lines, `firebase.json`, the root `package.json`, the lockfile when two workstreams meet |

### 11.2 Shared files: one marked section per area

These files are edited by several workstreams at once. Each has one section per area, opened by a line
`// [section <area>] …` (in JSON, by the rows of the area's behaviours) and closed by `// [end <area>]`; a workstream
appends **inside its own section only**, never reorders, reformats or deletes another's lines, and never moves the
markers. Sections are created empty before the parallel start (the contracts agent did that for the files that exist).

| File | Sections | How an area appends |
| --- | --- | --- |
| `packages/shared/src/i18n/admin-content/ro.ts` and `en.ts` (**done**) | §10.1's ten sections, the same order in both | one entry per line, the section's key prefix only (pinned by the test) |
| `e2e/scenarios.json` | each area owns the rows of its behaviours: photos A08, A09, A10, A37; pois A32, A34; layers-settings A19, A35, A36, A39 (and the M3 rows of A14, A16); ops-screens A02, A18, A20, A21, A22, A23, A29, A30, A31, A33, A38 | flip `planned` to `exists` in place when the tagged test lands; a new row goes right after its behaviour's last row; then `python3 scripts/ci/check_e2e_matrix.py write` (the generated `docs/E2E_SCENARIOS.md` is never edited by hand: whoever regenerates last wins, and it is derived) |
| `e2e/tour/states.ts` (**done**: the markers in `ADMIN_STATES`) | common, photos, pois, layers, settings, ops (common and ops: ops-screens) | one entry per state, id `<area>.<state>` (§12.2) |
| `packages/admin/src/index.ts` (**done**: the markers around the page registrations) | photos, pois, layers, settings, ops | the area's `PAGES.register(...)` (and its `content` module) lines |
| `packages/admin/src/content/areas.ts`, `packages/ui/src/admin/content-port.ts`, `packages/admin/test/app/admin-port.test.ts`, `packages/admin/src/content/budgets.ts` | one per area (created by ops-screens with every section in its first change) | the area's member, port check or budget |
| `packages/shared/src/index.ts`, `packages/shared/src/api/registry.ts`, `packages/shared/src/i18n/api/{ro,en}.ts` | no markers: one line or entry per addition at the end of the matching group, alphabetical within it | the change request that adds it (§13) names the exact line |
| `packages/ui/src/admin/define.ts`, `packages/ui/src/admin/index.ts` | one per area (ops-screens adds the markers with its first change) | the area's `define…Elements` and exports |

### 11.3 Order of work

1. **Foundations first, in parallel**: ops-screens lands the seam (§2), the editing kit (§9.5), the icons and the
   shell's changes; pois lands the move of the map (CR-M2c-1), `MapPort`'s additions, `MapDrawPort`, `FakeMapDraw`,
   `hcm-admin-map` and the admin tier's Mapbox mocks. Each publishes its interfaces and fakes before its elements.
2. Photos and layers-settings start with their DOM-free modules against the fakes (`FakeContentStore`, `FakeMap`,
   `FakeMapDraw`) and switch to the real kit as it lands.
3. Backend change requests land with the rows that need them (each workstream runs `tests` for its function and rules
   changes).
4. Only one agent at a time runs a split stage (`PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh`); the admin
   tier's long journeys go to the NUC (`E2E_ADMIN_PART`).

## 12. Scenarios and the tour

### 12.1 Rows registered (planned)

All `e2e-admin` and `planned` unless named otherwise; the generated `docs/E2E_SCENARIOS.md` lists them.

- **A02** admins: `S-A02-BAD-REVOKE` refined (the confirmation); new `S-A02-HAPPY-INVITE-AND-CANCEL`,
  `S-A02-BAD-REVOKE-CANCELLED`.
- **A08** upload: `S-A08-HAPPY`, `S-A08-BAD-NO-EXIF`, `-DUPLICATE`, `-UNSUPPORTED-TYPE`, `-OVER-SIZE` refined; new
  `S-A08-BAD-EXIF-OUTSIDE-CITY`, `S-A08-BAD-UPLOAD-INTERRUPTED`.
- **A09** photo edit: `S-A09-HAPPY` refined (no assists: those stay M4); new `S-A09-HAPPY-KEYBOARD`,
  `S-A09-BAD-PIN-OUTSIDE-CITY`.
- **A10** publish: `S-A10-HAPPY`, `S-A10-BAD-UNPUBLISH` refined; `S-A10-BAD-MISSING-EN-TITLE` replaced by
  `S-A10-BAD-NOT-PUBLISHABLE`; new `S-A10-HAPPY-PUBLISH-ON-SAVE`, `S-A10-HAPPY-RIGHTS-REVIEW`.
- **A14**, **A16** (M3, Addendum 3's layer geometry edits): `S-A14-HAPPY-REPLACE-SOURCE`, `S-A14-BAD-REPLACE-OVER-GUARD`,
  `S-A16-HAPPY-CROP`, `S-A16-BAD-CROP-OUTSIDE-LAYER`. A15 and A17 stay M3 as they are.
- **A18** jobs: `S-A18-HAPPY`, `S-A18-BAD-STREAM-DROP` refined (M2c: list, detail, cancel); new
  `S-A18-HAPPY-WAITING-JOB`, `S-A18-BAD-CANCEL-FINISHED`.
- **A19** settings: `S-A19-HAPPY`, `-ZERO-AREA-BOUNDS`, `-LOW-CONTRAST-SEED` refined; new
  `S-A19-BAD-BOUNDS-EXCLUDE-CONTENT`, `S-A19-BAD-MARKDOWN-LINK`, `S-A19-BAD-THEME-DISCARDED`.
- **A20** session: `S-A20-HAPPY` refined (a long edit saves after the silent refresh); new
  `S-A20-BAD-REVOKED-WHILE-EDITING`.
- **A21** i18n: both rows refined for every M2c screen.
- **A22** crash reports: new `S-A22-HAPPY-CRASH-DETAIL`, `S-A22-BAD-CRASHES-API-DISABLED`.
- **A23** history: `S-A23-HAPPY` refined; new `S-A23-HAPPY-RESTORE-DELETED`, `S-A23-BAD-REFUSED-SHOWN`, and on the
  `functions` tier `S-A23-BAD-LAYER-GONE`, `S-A23-BAD-RESTORE-AFTER-SWEEP`.
- **A29** layout: new `S-A29-HAPPY-LIST-DETAIL`, `S-A29-BAD-DEEP-LINK-COMPACT`.
- **A30** input: new `S-A30-HAPPY-CONTENT`, `S-A30-BAD-STICKY-FIELDS`.
- **A31** layout and accessibility: new `S-A31-HAPPY-EDITORS`, `S-A31-BAD-MAP-EDITOR-FOCUS`.
- **A32** (new) POI drawing and editing: `S-A32-HAPPY`, `-HAPPY-VERTEX-EDIT`, `-HAPPY-LINE-AND-POINT`,
  `-HAPPY-KEYBOARD`, `-BAD-OUTSIDE-CITY`, `-BAD-SELF-INTERSECTION`, `-BAD-TOO-MANY-VERTICES`, `-BAD-NO-MAP-TOKEN`.
- **A33** (new) delete with confirmation and Undo: `S-A33-HAPPY`, `-HAPPY-BULK`, `-HAPPY-LAYER`, `-BAD-CANCEL`,
  `-BAD-CATEGORY-IN-USE`, and on the `rules` tier `S-A33-BAD-CLIENT-LAYER-DELETE`.
- **A34** (new) POI GeoJSON import and export: `S-A34-HAPPY`, `-HAPPY-ROUND-TRIP`, `-BAD-NOT-GEOJSON`,
  `-BAD-INVALID-FEATURES`, `-BAD-MARKUP-IS-TEXT`, `-BAD-TOO-MANY`.
- **A35** (new) layer image adjustments: `S-A35-HAPPY`, `-HAPPY-RESET`, `-BAD-CROSSED-BRIGHTNESS`, `-BAD-DISCARD`,
  `-BAD-KEYBOARD-LIMITS`.
- **A36** (new) overlay default opacity: `S-A36-HAPPY`, `-HAPPY-SHOWN-AT-START`, `-BAD-DISCARD`, `-BAD-LINK-STILL-WINS`.
- **A37** (new) photo replace: `S-A37-HAPPY`, `-BAD-REFUSED`, `-BAD-CANCEL-UPLOAD`, `-BAD-SAME-FILE`, and on the
  `functions` tier `S-A37-BAD-REFUSED-KEEPS-IMAGE`.
- **A38** (new) editor drafts and saving: `S-A38-HAPPY`, `-BAD-UNSAVED-GUARD`, `-BAD-CONFLICT`, `-BAD-INVALID`,
  `-BAD-OFFLINE`, `-BAD-DELETED-WHILE-EDITING`, `-BAD-SKIPPED-SHOWN`.
- **A39** (new) POI categories: `S-A39-HAPPY`, `-HAPPY-REORDER`, `-BAD-LOW-CONTRAST-COLOUR`, `-BAD-ID-CLASH`,
  `-BAD-UNBUNDLED-ICON`, `-BAD-LIMIT`.

The brief's behaviours took the next free ids (`e2e_scenario_matrix_skill.md` rule 4): POI draw and edit A32, delete
A33, import and export A34, adjustments A35, default opacity A36, photo replace A37, the drafting behaviour every editor
shares A38, and the categories A39 (part of "city settings" in the brief, a behaviour of its own here because it has its
own editor and limits).

### 12.2 The tour's inventory

- Every new screen and state is an entry of `ADMIN_STATES` (`e2e/tour/states.ts`), in its area's section, id
  `<area>.<state>`, title = what the admin sees, `visit` = the tour file and journey that reaches it. Each is checked by
  `expectStateSound` (`docs/TESTING.md` → *The tour's checkers*: occlusion, overlap with 8 px between floating targets on
  compact and medium, edges and sideways scroll, the Mapbox legal line, text, axe WCAG 2.2 AA with best practices,
  hit-tested 48 px targets on compact and medium, the Tab round with visible, uncut 3:1 rings, focus not obscured,
  landmarks, reflow, text spacing, non-text contrast, modal inertness) **at every tour viewport, light and dark**: each
  area's journeys run in `e2e/tour/admin-<area>.tour.ts` at the tour projects (the per-push `tour` tier and the
  `tour-matrix` stage, as the viewer's; the runtime decision is `DECISIONS-for-review.md` §34c), and its functional specs
  call `expectStateSound` too at the admin projects. A state that does not exist at a size (the compact editor's sheet
  detents) is passed over by `exists`, never skipped; nothing joins a checker's allowlist (`SANCTIONED_STACKINGS`
  included) to pass.
- The states each area brings (the minimum; more as built):

| Area | States |
| --- | --- |
| common (ops-screens) | `common.unsaved-guard` (dialog), `common.conflict` (banner), `common.offline`, `common.publish-status` (Not on the public map open), `common.map-no-token` |
| photos | `photos.empty`, `photos.loading`, `photos.list`, `photos.list-map` (compact Map view), `photos.uploading`, `photos.upload-refused`, `photos.bulk`, `photos.editor` (compact: sheet at peek, half, full), `photos.direction-pick`, `photos.editor-invalid`, `photos.replace-processing`, `photos.replace-refused`, `photos.delete-confirm`, `photos.deleted-undo` (snackbar) |
| pois | `pois.empty`, `pois.list`, `pois.add-shape` (menu), `pois.drawing`, `pois.vertex-edit`, `pois.vertex-list`, `pois.draw-refused`, `pois.editor`, `pois.photo-picker` (dialog), `pois.import-preview`, `pois.import-refused`, `pois.bulk`, `pois.delete-confirm`, `pois.not-found` |
| layers | `layers.empty`, `layers.list`, `layers.editor`, `layers.adjusting` (announced), `layers.delete-confirm` |
| settings | `settings.sections`, `settings.area`, `settings.area-refused`, `settings.texts` (preview), `settings.texts-link-refused`, `settings.theme`, `settings.theme-adjusted`, `settings.categories`, `settings.category-editor` (icon picker), `settings.category-delete-move` (dialog), `settings.overlays` |
| ops | `admins.list`, `admins.detail`, `admins.invite` (dialog), `admins.invite-link`, `admins.revoke-confirm`, `admins.revoke-refused`, `history.recent`, `history.deleted`, `history.document`, `history.revert-confirm`, `history.revert-refused`, `history.empty`, `jobs.empty`, `jobs.list`, `jobs.detail`, `jobs.cancel-confirm`, `jobs.reconnecting`, `crashes.list`, `crashes.detail`, `crashes.empty`, `crashes.error` |

### 12.3 The e2e content world (CR-M2c-7)

- **One city per test**: in the `e2e` build only, `?city=<id>` (`CITY_ID_PATTERN`) overrides `project.cities[0]` for the
  content areas (`E2E_KIT`, never in the production bundle); the world seeds `cities/<id>` (bounds, the admin token in
  `setup/status`, categories, photos with derivatives from `@hcm/test-support`'s generated images, a ready `xyz` layer on
  the mock tiles) through the emulators' admin access. Content specs then run in parallel workers without the admin
  tier's lock; specs that touch `admins/*`, `invites/*` or `setup/*` keep the lock.
- **The admin map in the e2e**: the admin page loads Mapbox GL JS 3.32.0 and its CSS from the mock CDN, the mock Standard
  basemap (`e2e-plain`, as the viewer's tier) and the solid-colour tiles; the firewall fails anything else, Satellite
  included. The map-instance counter asserts one map per page visit.
- **Admin to viewer**: a spec that saves and then checks the viewer reads the built manifest from the Storage
  emulator's public bucket and serves it to the viewer page (`serveManifest`), then asserts what the visitor sees
  (markers, shapes, slider values, pixel probes).
- **Images**: generated at test time (no committed binaries), with EXIF through sharp's `withExif` as
  `functions/test/photos/images.ts` does today (moved to `@hcm/test-support`, photos).

## 13. Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract; the
owner (or the integrator) applies it. Ids are `CR-M2c-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-M2c-1 | contracts | pois (engine-core's files of `M1-interfaces.md` §1) | Move `packages/engine/src/map/**` and `packages/engine/test/map/**` to `packages/ui/src/map/**` and `packages/ui/test/map/**`, export `@hcm/ui/map`; the engine and `FakeMap` import from there; the dependency-cruiser paths of `DECISIONS-for-review.md` §34a in the same change | the admin may not import the engine; the admin map must be the viewer's map | done (pois, 2026-10-17) |
| CR-M2c-2 | contracts | pois | `MapPort.onMapClick`, `fitBounds`, `setPadding` (§3.2) and `FakeMap.clickMap` | picks, the overview's selection, the compact editor's sheet | done (pois, 2026-10-17) |
| CR-M2c-3 | contracts | layers-settings (`packages/shared/src/api/` registry and schemas, `JOB_TYPES`, `functions/src/layers/**`, the `layers` export line in `functions/src/index.ts` and its account in `global-options.ts`), ops-screens (the rules) | Callable `layers.delete` (§8.4: admin, App Check consume, `fn-admin@`; `{cityId, layerId}` → `{jobId, runsAt}`; `apiError.layers.busy`, `notFound`); `JOB_TYPES` gains `layer-delete` with its params schema; `LAYER_DELETE_GRACE_DAYS` = 7; the rules keep refusing a client's layer delete and refuse a client's `layer-delete` job (only `usgs-import`, `geotiff-import`, `regeoref`, `republish` are client-creatable); `functions/test/index.test.ts` follows the registry | a deleted layer must clean up its Mapbox tileset and source (security review §4.4) and stay restorable during a grace | done (layers-settings, 2026-10-18: `functions/src/layers/delete.ts` refuses while a job of the layer runs or waits for approval and writes the delete and the `layer-delete` job in one transaction, `dispatchAt` seven days later; `layerDeleteRequestSchema`, `layerDeleteParamsSchema`, `CLIENT_JOB_TYPES` in `packages/shared`; `functions/test/layers/delete.test.ts`; the rules' part: ops-screens, CR-M2c-6) |
| CR-M2c-4 | contracts | photos (`functions/src/photos/upload.ts`, `photoDocSchema`), ops-screens (the rules' server-owned list) | When the photo already has an `image`, a refused upload keeps `processing: 'done'` and the image and writes the server-owned `replacement: {error: ApiErrorCode, at}`; a successful one removes it | today a refused replacement sets `processing: 'failed'` and the manifest drops a published photo | done (photos: `functions/src/photos/upload.ts`, `photoDocSchema.replacement`, `functions/test/photos/replacement.test.ts`; the rules already refuse `replacement` from a client: it is outside the photo's allowed keys) |
| CR-M2c-5 | contracts | ops-screens (`functions/src/history/**`, `packages/shared/src/i18n/api/`) | `history.revert` of a layer's delete entry: when a `layer-delete` job of that layer succeeded, `apiError.history.layerGone`; while it waits, the restore sets it `cancelled`. Of a photo's delete entry whose public derivatives are gone: restore it with `processing: 'pending'` and process it again from its original (`photos.reprocess`'s path) | a restored layer or photo must never point at deleted files | done (ops-screens, 2026-10-18: `functions/src/history/restore.ts` with `revert.ts`; `apiError.history.layerGone` in `packages/shared/src/api/errors.ts` and the `api` catalogues; `functions/test/history/restore.test.ts` holds S-A23-BAD-LAYER-GONE and S-A23-BAD-RESTORE-AFTER-SWEEP) |
| CR-M2c-6 | contracts | ops-screens (`firebase/firestore.rules`, `firebase/firestore.indexes.json`, `firebase/rules-tests/**`) | Admin collection-group read of `history` (`match /{path=**}/history/{entry}`); a `COLLECTION_GROUP` field override for `history.updatedAt` (descending) and an index on `action, updatedAt desc` at collection-group scope; the job type restriction of CR-M2c-3; `replacement` server-owned (CR-M2c-4); rules tests import the changed `CLIENT_WRITES` and schemas as today | History's recent changes and Deleted filter; every rule change in one owner's hands | done (ops-screens, 2026-10-18: the collection-group `match` in `firebase/firestore.rules`; three `COLLECTION_GROUP` composites and the `history.updatedAt` field override in `firebase/firestore.indexes.json`; `firebase/rules-tests/test/{history,indexes,jobs,photos}.test.ts`, S-A33-BAD-CLIENT-LAYER-DELETE among them. The rules already allowed a client only the four job types and refused a client's `replacement`) |
| CR-M2c-7 | contracts | ops-screens (`e2e/admin/world.ts`, `e2e/projects.ts`, the `?city=` override in `packages/admin/src/app/`), pois (`e2e/mock-apis/` Mapbox for the admin tier) | The content world of §12.3: the per-test city, the seeds, the admin map's mocks, the tour projects running the admin journeys (`DECISIONS-for-review.md` §34c) | parallel content specs and the admin map in the e2e without touching Mapbox | done (E2E agent, 2026-10-18: the per-test city and Google account `e2e/admin/support/content.ts`, `content-ids.ts`, `content-test.ts`, lock-free beside the locked admin tests (`EmulatorWorld.reset` keeps content worlds); the admin map's token seam `?mapToken=` (`e2eMapToken`); the admin map in e2e on the mock Mapbox CDN, style and tiles (`e2e/admin/support/map.ts`); the editors' journeys in the tour, `e2e/tour/admin-*.tour.ts` (`DECISIONS-for-review.md` §37b); the addendum below) |
| CR-M2c-8 | contracts | ops-screens (the shell, `packages/ui/src/admin/admin-port.ts`, `packages/admin/src/{app,routing,state}/**`) | Fill mode for list and detail pages; `chrome: 'editor'` hides the compact navigation bar; the unsaved guard on navigation, sign-out and `beforeunload`; `AdminAppPort.content` and `AdminDeps.content`; `AdminNoticeKey` with `AdminContentKey`; History in `navigationDestinations` | §1.3, §2 | done (ops-screens, 2026-10-18: `hcm-page-outlet` fill mode, `hcm-chrome` per route in `hcm-admin-shell`, the unsaved guard in `packages/admin/src/app/navigation.ts`, `mount.ts` (sign-out) and `guardUnload` in `packages/admin/src/index.ts`; `AdminAppPort.content`, `AdminDeps.content`, `AdminNoticeKey` with `AdminContentKey`, History in the navigation) |
| CR-M2c-9 | contracts | ops-screens (`packages/ui/src/icons.ts`, the font subset) | The icons of §10.2, all in one change, `fonts:check` green | an unbundled icon draws nothing | done (ops-screens, 2026-10-18: `packages/ui/src/icons.ts` and the rebuilt subset, `fonts:check` up to date with 115 icons) |
| CR-M2c-10 | contracts | layers-settings (`packages/ui/src/components/overlay-list.ts`) | `hcm-overlay-list` items gain an optional `toggleable` (default true): without it the row has no switch; the viewer's rows are unchanged | the photos overlay and the categories have no "shown at start" | done (layers-settings, 2026-10-18: `packages/ui/src/components/overlay-list.ts`, tests in `packages/ui/test/components/overlay-list.test.ts`) |
| CR-M2c-11 | contracts | ops-screens (`packages/admin/package.json` `exports`) | `./content/budgets` exported like `./setup/steps` (CR-M2b-10), so the e2e tier reads `CONTENT_INPUT_BUDGETS` | the budgets of §5.6 are code | done (ops-screens, 2026-10-18) |
| CR-M2c-12 | each workstream | integrator (docs, skills and mirrors, `docs/LESSONS.md`, the admin guides) | What each workstream built and learned, reported as a row here at its end | docs follow the code | done (integrator, 2026-10-18: the four reports, CR-M2c-19, -23, -26 and -30, are in the admin guides (today `docs/ADMIN_GUIDE.en.md` alone, DECISIONS §157) (daily work, troubleshooting), `docs/ARCHITECTURE.md`, `docs/TESTING.md`, `docs/LESSONS.md` 71–80, the skills and `DECISIONS-for-review.md` §35) |
| CR-M2c-13 | contracts | M3 (the dispatcher and the raster pipeline) | Run `layer-delete` jobs after `dispatchAt`: skip (`cancelled`) when the layer exists again; else delete the Mapbox tileset and source with tombstone retries, then the layer's objects in our buckets | §8.4 | open |
| CR-M2c-14 | contracts | M5 (multi-city) | `cityId` on history entries, so the recent changes need no path filter | §9.2 keeps to one city's path in the page meanwhile | done (2026-10-23, brought forward from M5: the page-side filter let other tests' cities decide which of the city's entries made the page of 50 and removed a row during the tour's Tab round, `docs/LESSONS.md` 149. `historyEntryDocSchema` gains an optional `cityId`, which the history triggers (`functions/src/history/record.ts`) and `history.revert` (`revert.ts`) write; `recentQuery(cityId, filter)` asks `cityId ==` first and the page-side `inCity` went; the collection-group indexes start with `cityId` and the `updatedAt` override's collection-group order went (`firebase/firestore.indexes.json`); the rules are unchanged (admins list the collection group) and `firebase/rules-tests/test/history.test.ts` checks that only the city's entries answer; no migration: no history trigger was ever deployed, so the live project holds no entry; `S-A23-BAD-OTHER-CITY`; `DECISIONS-for-review.md` §45) |
| CR-M2c-15 | ops-screens | integrator (weekly `contract.yml`, ask first for the probe) | Verify Error Reporting's group page address and add it to `packages/admin/src/setup/links.json` | the crash detail's deep link must be a verified one | done (follow-ups, 2026-10-18: `gcp.errorGroup` = `https://console.cloud.google.com/errors/detail/{groupId}?project={projectId}` in `links.json` and `links.ts`, which the weekly contract run probes (not dispatched: ask first); the crash detail links the group through `errorGroupUrl` of `@hcm/ui/admin`, which `packages/admin/test/setup/links.test.ts` keeps equal to it) |
| CR-M2c-16 | photos | ops-screens (`ContentStore` in `packages/admin/src/content/services.ts`, `packages/admin/src/firebase/content.ts`) | In `update` and a batch's `update`, a field whose value is `undefined` is removed (`deleteField()`); today the SDK refuses an `undefined` value | the photo editor clears an optional field (the author, a year, every link, the direction) by sending it `undefined` (`PhotoDraft.save`, `packages/admin/src/photos/draft.ts`); the fake store already merges it so | done (ops-screens, 2026-10-18: `cleared()` in `packages/admin/src/firebase/content.ts` sends `deleteField()` for an `undefined` field in `update` and a batch's `update`; `FakeContentStore` removes such a field likewise; `packages/admin/test/firebase/content.test.ts`) |
| CR-M2c-17 | photos | ops-screens (the kit's `packages/ui/src/components/snackbar.ts`) | The action button takes the kit's `touch-target` ring and keeps its label whole (`flex: none`) | the photos spec measured the Undo of a delete at 68 × 40 px with its label cut on `admin-c360-ro` and 85 × 40 px on `admin-m768-ro`; `photos.deleted-undo` joins the tour inventory with the fix (`e2e/tour/admin-photos.tour.ts` checks the delete and its Undo meanwhile) | done (ops-screens, 2026-10-18: `packages/ui/src/components/snackbar.ts`; the photos spec may now add `photos.deleted-undo` to the tour) |
| CR-M2c-18 | photos | pois | The photos page draws its markers and cones itself (`MapPort.setPhotosData`, the open photo from its draft: place, direction and field of view live) and uses `MapDrawPort` for the pin (`select` on `photo-location`, `pick` for Set direction); it does not use `MapPreview`'s `photo` change. `PhotosServices.maps` is the structural `PhotoMapFactory` (`packages/admin/src/photos/ports.ts`), which `AdminMapFactory` satisfies | one writer of the photos overlay on the photos page | accepted (integrator, 2026-10-18: the photos page keeps its own writer of the photos overlay; `docs/ARCHITECTURE.md` says so) |
| CR-M2c-19 | photos | integrator | What photos built: the area `packages/admin/src/photos/**` (list, batch upload with EXIF auto-fill, sticky fields and the last pin, editor draft with conflicts, replace, bulk actions, delete and Undo, the map session), `packages/admin/src/firebase/uploads.ts`, the page `packages/ui/src/admin/photos/**` (`hcm-photos-page`, `hcm-admin-photo-list`, `hcm-admin-photo-editor`), the photos sections of the shared files, `e2e/tour/admin-photos.tour.ts` with `e2e/admin/support/photos.ts` (nine states of the tour inventory, green at the five admin projects). Not yet: the compact window's bottom-sheet editor and List \| Map (the map sits above the form), the map-dependent states (`photos.direction-pick`, `photos.list-map`) and S-A08/A09/A37 journeys until the admin map's mocks (CR-M2c-7), the EXIF images' move to `packages/test-support/src/images.ts` (needed by the upload journeys) | CR-M2c-12: the photos workstream's report for the docs, the skills and `docs/LESSONS.md`. Lessons: a touched draft must take another admin's values of the fields it did not change, or the next Save reverts them (`packages/admin/test/photos/draft.test.ts` caught it); a recording `Proxy` passed to a Lit property binding answers Lit's `_$litDirective$` probe and breaks the render (the photos fixtures answer only intent names); the viewer already owns `hcm-photo-list`, so the admin's elements are `hcm-admin-photo-*`; `void sources;` left `packages/admin/src/app/content-wiring.ts` once the photos section used `sources` | done (integrator, 2026-10-18: CR-M2c-12) |
| CR-M2c-20 | pois | integrator (`packages/ui/package.json`, the lockfile), after the user's yes to `DECISIONS-for-review.md` §34g | Install `terra-draw@1.37.0` and `terra-draw-mapbox-gl-adapter@1.5.0` (exact, dependencies of `@hcm/ui`) in the pinned Node container; add the loader (a dynamic `import()` of both, returned as `TerraDrawModules`, `satisfies` checked) and pass it as `terraDraw` in the pois section of `packages/admin/src/app/content-wiring.ts` (today `null`: the click-only tools); a browser test drives the real Terra Draw through `createTerraDrawPort` | an npm install downloads files, which `AGENTS.md` puts under ask first; the adapter is written and unit-tested against the structural `TerraDrawModules` (`packages/ui/src/map/draw/terra-draw-types.ts`, **UNVERIFIED** names until installed) | open |
| CR-M2c-21 | pois | ops-screens (`packages/ui/test/admin/editing/fake-area.ts`) | `FakeArea`'s intents answer only intent names: `undefined` for `_$`-prefixed names and `then` (as `PhotosArea` and `PoisArea` of the photos and pois fixtures do) | Lit probes a value bound to a property for `_$litDirective$`; the recording `Proxy` answers it with a function and the render throws `nextDirectiveConstructor is not a constructor` once a page hands its intents to a child element | done (ops-screens, 2026-10-18: `packages/ui/test/admin/editing/fake-area.ts`, with a test in `kit.test.ts`) |
| CR-M2c-22 | pois | photos (`packages/ui/src/admin/photos/**`) | Show the photos page's map in `hcm-admin-map` (`packages/ui/src/admin/map/hcm-admin-map.ts`): it links `mapbox-gl.css` inside its shadow root (the page's copy cannot reach Mapbox's logo, attribution and canvas there), rings the canvas inside its box, offers the kit's 48 px zoom buttons and the keyboard crosshair, says why there is no map, and hands its host over with `hcm-map-host` | one map box for every editor page; the legal line's styles | done (integrator, 2026-10-18: `hcm-photos-page` shows its map in `hcm-admin-map`, which gained the `unavailable` state (`adminContent.map.unavailable`); the photos area gained `zoomBy` for the box's zoom buttons; the photos page's own map notes and their six keys are gone; `packages/ui/test/admin/photos/photos-page.test.ts`, `packages/admin/test/photos/{map,store}.test.ts`) |
| CR-M2c-23 | pois | integrator | What pois built (CR-M2c-12): CR-M2c-1 and -2 (the map in `packages/ui/src/map/`, the `@hcm/ui/map` entry; `onMapClick`, `fitBounds`, `setPadding`, kept across mounts), `@hcm/ui/map/draw` (`MapDrawPort`, the DOM-free `rules.ts`, the Terra Draw adapter on structural types, and `createClickDrawPort`: click-only drawing on `MapPort`, the admin's tools until Terra Draw is installed), `loadMapboxGl`, `FakeMapDraw`; the admin map `packages/admin/src/map/` (`createAdminMapFactory`, `createMapPreview`, `adminMapFactoryOf`: the token from `setup/status`), `hcm-admin-map`, `hcm-draw-toolbar`, `hcm-vertex-list`; the places area `packages/admin/src/pois/**` and its page `packages/ui/src/admin/pois/**`. Contract changes, all additive or narrowing: `setMode(mode, drawId?)` names the finished shape; `load` takes read-only positions (`DrawnFeatureInput`); `DrawnFeature.shape`; `deleteSelected` deletes the selected feature (vertices go through the draft and `load`); `createTerraDrawPort(modules)` takes the loaded constructors (the lazy load is `AdminMapHandle.draw()`'s); `VectorOverlaySpec.clickable: false` lets clicks through to `onMapClick`; `ContentServices.maps` is optional; Add at centre uses the city's starting view without a map, so the keyboard path works without a token. E2E: `e2e/tour/admin-places.tour.ts` (helpers `places.ts`) proves `S-A32-BAD-NO-MAP-TOKEN`, `S-A34-HAPPY-ROUND-TRIP`, `S-A34-BAD-NOT-GEOJSON` and `S-A34-BAD-INVALID-FEATURES` (rows `exists`), green at the five admin projects; eight states (`pois.empty`, `pois.add-shape`, `pois.new-place`, `pois.editor`, `pois.delete-confirm`, `pois.list`, `pois.import-refused`, `pois.import-preview`) live in `e2e/admin/specs/pois/states.ts`, which the pois section of `ADMIN_STATES` spreads (`...POIS_STATES`, plus one import line above the sections: the file had reached its 600-line limit). The checkers' fixes in the area: the drawing tools are a named group of separate Tab stops (the kit's one-stop `hcm-toolbar` sets `tabindex=-1` on its hosts, which hides their shadow buttons from Tab, and the Tab round reports them as never reached), 8 px apart so their 48 px rings do not cover each other; Import GeoJSON is a kit button opening a `hidden` file input (a visually hidden input inside a label failed non-text contrast and focus-obscured); the row check boxes are M3 check boxes with a 2 px border and a `touch-target` ring (a native check box reaches 1:1); the filter chips' rows keep 16 px apart; the detail pane starts 8 px below the list-detail's Back/Close. For the kit owners: `hcm-dialog`'s `.actions` has no top padding, so an action's 48 px ring covers the bottom 4 px of a control at the scrolling content's edge (the import preview's category select at 360 px with text spacing; the area now lists the refusals after the select); `a.external` has no `min-inline-size: 48px` (a short History link is 43 px wide on a touch window; the area adds it); the Tab round does not know the roving toolbar pattern. Not yet: the journeys that draw on the map (`S-A32-HAPPY*`, `S-A32-BAD-OUTSIDE-CITY`, `-SELF-INTERSECTION`, `-TOO-MANY-VERTICES`, `S-A34-HAPPY`, `-MARKUP-IS-TEXT`, `-TOO-MANY`, `S-A33-HAPPY-BULK`, `S-A31-BAD-MAP-EDITOR-FOCUS`) and their states (`pois.drawing`, `pois.vertex-edit`, `pois.draw-refused`, `pois.photo-picker`, `pois.bulk`, `pois.not-found`) until the admin tier's Mapbox mocks and `e2e/admin/support/map.ts` (CR-M2c-7), the compact bottom-sheet editor. Lessons: Lit's `_$litDirective$` probe on a recording `Proxy` (CR-M2c-21); a symmetric bowtie has no area, so a self-crossing test polygon needs uneven lobes or the zero-area rule answers first; an overlay the admin draws in must let clicks through, or a click on the drawn line selects a POI instead of adding a vertex | CR-M2c-12: the pois workstream's report for the docs, the skills and `docs/LESSONS.md` | done (integrator, 2026-10-18: CR-M2c-12) |
| CR-M2c-24 | ops-screens | integrator (`docs/ARCHITECTURE.md`, the admin guide, `M2b-interfaces.md` §1.1's route list) | The dashboard `#/home` (route `home`, icon `home`, behaviour A40): counts as Firestore aggregations, one chip per Setup area from `setup/status`, the public map from `manifests/{city}`; first in `ADMIN_ROUTES`, under More on the compact bar. Whether it becomes the first screen is `DECISIONS-for-review.md` §34i | the M2c brief's "dashboard home" had no route in this contract | done (ops-screens, 2026-10-18; the docs: integrator, 2026-10-18, `docs/ARCHITECTURE.md` and the admin guides' Home) |
| CR-M2c-25 | ops-screens | contracts or integrator (`packages/shared/src/i18n/admin-content/`, `scripts/ci/check_i18n.py` if it reads the files) | Split the `admin-content` catalogue into one file per area (`admin-content/<area>/{ro,en}.ts`, merged in `index.ts`), each owned by its area | `ro.ts` and `en.ts` hold about 800 lines with every area's section, past ESLint's `max-lines` (400), so the `eslint` gate of the `static` stage fails on them; no area may restructure the shared file alone | done (integrator, 2026-10-18: `packages/shared/src/i18n/admin-{content,photos,pois,layers,settings,ops}/`, merged by `admin-content/index.ts`; `DECISIONS-for-review.md` §35a) |
| CR-M2c-26 | ops-screens | integrator | What ops-screens built (CR-M2c-12): the content seam `packages/admin/src/content/**` (`ContentServices` and the `ContentStore` port, `ContentModules` derived from the elements' `ContentPort`, the lazy `ContentRegistry` destroyed on sign-out, `LiveListener` with growing reconnect delays, `LiveList`, `LiveDoc`, `CONTENT_INPUT_BUDGETS`), the Firestore adapter `packages/admin/src/firebase/content{,-sdk}.ts` (transactions whose version is `updatedAt`, `fromCache` shown as Reconnecting, collection-group queries, counts, `deleteField()`), `app/content-services.ts`, `app/content-wiring.ts`, `app/color.ts` (the colour library loaded lazily), the base ports `packages/ui/src/admin/{area-port,notice-port,content-port}.ts`, the editing kit `packages/ui/src/admin/editing/**` (`hcm-list-detail`, `hcm-confirm-dialog`, `hcm-empty-state`, `AreaPage`, the states and styles), the shell's fill mode, editor chrome and unsaved guard (CR-M2c-8), the icons (CR-M2c-9), `FakeContentStore` (`@hcm/test-support/fake-content-store`), the rules, indexes and rules tests (CR-M2c-6, the rules' part of CR-M2c-3), `functions/src/history/restore.ts` (CR-M2c-5), the five operations areas and pages (admins, history, jobs, crashes, home) and `e2e/admin/specs/ops/ops.spec.ts` with `e2e/admin/support/ops.ts` (19 states in the ops section of the tour inventory, green at the five admin projects). Not built: `hcm-editor-frame`, `hcm-bulk-bar`, `hcm-publish-status`, the shared fields and a generic `DraftEditor` of §9.5 (the areas built their own); the per-test city of CR-M2c-7; `history.empty` left the inventory (the shared emulator still holds the previous test's entries until the per-test city exists); after Discard, an area's `close()` should forget its drafts (today the store's destroy does). For the integrator: `layers.link` (`functions/src/layers/link.ts`, `packages/admin/src/layers/link{,er}.ts`, `link-dialog.ts`, `packages/shared/src/api/layers.ts`) cites CR-M2c-16, which is the `deleteField()` row, and `e2e/tour/admin-photos.tour.ts` cites CR-M2c-16 for the snackbar (CR-M2c-17) | CR-M2c-12: the ops-screens workstream's report for the docs, the skills and `docs/LESSONS.md`. Lessons: dependency-cruiser's `no-circular` counts type-only imports, so a port that the umbrella port imports takes its shared types from a base file (`area-port.ts`), never from the umbrella; content slotted into a kit element is not a DOM descendant of the shadow element that shows it (the native `<dialog>` of `hcm-dialog`, the named panes of `hcm-list-detail`), so a Playwright locator scoped to that dialog or region finds nothing: a test scopes to `hcm-dialog[open]` or to the page; a dialog's X named like its Cancel made two buttons of one name (`closeLabel`); a layout change inside a `ResizeObserver` callback loops (apply it on the next frame); a heading that renders after the item opens needs a wait before it takes the focus; wrapped rows of 32 px chips need 16 px between them for their 48 px targets; on a one-pane layout a journey goes Back (Close on a phone) to the list before the next item; a callable's refusal is an HTTP 400 that Chromium logs, so the spec claims it; a collection-group query cannot filter on the path, so the recent changes keep the city's entries in the page (CR-M2c-14); a feature folder of `functions/src` may not import another (`functions-feature-folders-independent`), so restoring a swept photo writes `photos.reprocess`'s steps in `history/` | done (integrator, 2026-10-18: CR-M2c-12) |
| CR-M2c-27 | layers-settings | contracts (§8.1, the A15 rows of `e2e/scenarios.json`), integrator (`docs/ENGINE_API.md`, the admin guide) | The callable `layers.link` (`fn-content`, admin, `fn-admin@`): `{cityId, source: {type: 'mapbox', tilesetId} \| {type: 'xyz', tiles, tileSize}, label, year, kind, attribution?, minzoom?, maxzoom?, bounds?}` → `{layerId}`; it creates a `ready`, unpublished layer on top (`published: false`, opacity 1, hidden at start, the id `freeOverlayId` clear of the layers', the categories' and `photos`); refusals `apiError.layers.foreignTileset` (a tileset of another Mapbox account than `cities/{city}.mapbox.user`, `mapbox.*` and `fostulbucuresti` included), `secretInAddress` (a key or token in the address), `alreadyLinked`; the dialog runs the same `layerSourceRefusal` (`packages/shared/src/api/layers.ts`) before any call and names the origins an XYZ server adds to the viewer's and admin's CSP. Done in layers-settings' paths: `functions/src/layers/link.ts`, `packages/shared/src/api/{layers,registry,errors}.ts`, `packages/admin/src/layers/link{,er}.ts`, `packages/ui/src/admin/layers/link-dialog.ts`, tests in `functions/test/layers/link.test.ts`. Asked: the A15 rows (planned, M3) gain an M2c refinement (the foreign tileset and the key refused in the dialog and by the callable; the live preview of the linked tiles waits for the admin map's mocks, CR-M2c-7); the CSP of an XYZ host stays a manual step (the note says so) | the brief's "link existing tileset/XYZ (validated)" had no callable in this contract; a client may not create a layer (the rules) | done (follow-ups, 2026-10-18: `S-A15-BAD-FOREIGN-PRIVATE-TILESET` refined and `exists` (the dialog in `e2e/tour/admin-layers.tour.ts`, the callable in `functions/test/layers/link.test.ts`), new `S-A15-HAPPY-LINKED` and `S-A15-BAD-SECRET-IN-ADDRESS` on the functions tier, `S-A15-HAPPY` and `-BAD-INVALID-URL` refined and still planned for the M3 preview; `docs/ENGINE_API.md` and the admin guides already said it) |
| CR-M2c-28 | layers-settings | ops-screens (`ContentServices` in `packages/admin/src/content/services.ts`, the shell's theme in `packages/admin/src/app/`) | `ContentServices.previewTheme(tokens: ThemeTokens \| null)`: the shell wears the previewed schemes until `null` (Save, Discard, leaving Settings or signing out) | the settings store computes the tokens of a seed (`seedTheme`, `packages/admin/src/settings/theme.ts`) but reaches no shell API; meanwhile `hcm-settings-page` wears them itself (`applyTheme` on its host, `clearTheme` on leaving) and says "The Settings page now shows the new theme"; with the service, the store calls it and the page drops its own `applyTheme` | done (follow-ups, 2026-10-18: `ContentServices.previewTheme` sets the shell's `theme.preview`, which `hcm-admin-shell` already wore; `CitySections` calls it whenever its preview changes, so Save, Discard, leaving Settings and signing out end it; the page's own theme is gone and it says "The whole admin now shows the new theme") |
| CR-M2c-29 | layers-settings | ops-screens (`packages/ui/src/admin/shell/admin-styles.ts`, `packages/ui/src/components/dialog.ts`), the checkers' owner (`e2e/support/layout-probe.ts`) | (a) The admin base `:focus-visible` uses `--hcm-focus-ring-color` like the kit's `focusRing`: today it is always secondary, so a link on the kit's `.alert` (error container) rings at 2.38:1 (the area adds `.alert :focus-visible { outline-color: var(--hcm-focus-ring-color, …) }` in `layers-styles.ts`). (b) `hcm-dialog`'s `.actions` gets a top padding of 4 px (pois' finding in CR-M2c-23; the area gives its slotted actions `margin-block-start: 4px`). (c) The occlusion check treats a control cut by a scroller to a sliver of 1–5 px as reached: Chromium hit-tests the last fraction of a pixel at the clip edge as the next element (a 4 px sliver of `#link-attribution` at the bottom of the link dialog's scrolling content was "covered" by `div.actions`, `hits` at 707 px: input, 707.5 px: actions, the clip at 708 px) | the area works around (a) and (b) in its styles and (c) by showing the link refusal above the fields; every scrolling dialog of another area meets (c) by chance | done (follow-ups, 2026-10-18: (a) `adminBase` rings with `--hcm-focus-ring-color`, `packages/ui/test/admin/shell/admin-styles.test.ts`; (b) `hcm-dialog`'s actions have 4 px above them, `dialog.test.ts`; (c) `scrolledToASliver` in `e2e/support/layout-rules.ts`, and the state checker's scroll sweep checks the control whole at another position; the layers area's two style workarounds are gone) |
| CR-M2c-30 | layers-settings | integrator | What layers-settings built (CR-M2c-12): CR-M2c-3 and -10 (done) and CR-M2c-27; `packages/shared/src/overlays/adjustments.ts` (the sliders' whole percentages to the stored values and back, the levels never crossing, the stored form without neutral values: what the admin previews is what is saved) and `packages/shared/src/api/layers.ts`; the layers area `packages/admin/src/layers/**` (`LayersStore`: the live list top first, drag and Move up/down writing only the changed `order`s, the editor's own `EditDraft` with live validation and conflicts, the image adjustments and the default opacity previewed on the page's map through `MapPreview` (`AreaMap`: one map per visit on `AdminMapFactory`, the open layer drawn as saved), the link form, the delete) and its page `packages/ui/src/admin/layers/**` (`hcm-layers-page`, the reorder rows, the link dialog, the slider rows); the settings area `packages/admin/src/settings/**` (`SettingsStore`: one draft per section of the city document with its own Save, the area's number fields and the bounds that would leave photos or places out refused with links, About and privacy in RO and EN with the non-https lines named and the formatted preview, the credits, the seed colour with presets, the contrast check and the nearest passing tone, the basemap choice, the POI categories (add, edit, icon, colour with the proposed readable tone, default opacity, reorder, delete moving the places in batches, the limit), the default opacities) and its page `packages/ui/src/admin/settings/**` (`hcm-settings-page`, `hcm-icon-picker`); `e2e/tour/admin-layers.tour.ts`, `e2e/admin/specs/settings/{settings.spec.ts,world.ts}`: 20 states in the layers and settings sections of the tour inventory, green at the five admin projects (26 passed); S-A35-BAD-KEYBOARD-LIMITS, S-A19-BAD-ZERO-AREA-BOUNDS (typed), S-A19-BAD-BOUNDS-EXCLUDE-CONTENT, S-A39-BAD-UNBUNDLED-ICON, S-A39-BAD-LOW-CONTRAST-COLOUR, S-A39-BAD-LIMIT and S-A33-BAD-CATEGORY-IN-USE now `exists`. Outside the area: the function counts of `packages/admin/test/google/clients.test.ts` and `packages/admin/test/provision/setup-cloud.test.ts` (33 to 35 with `layers.delete` and `layers.link`); Prettier reflowed the long entries of the photos and ops sections of `e2e/tour/states.ts` (formatting only). Not yet: the settings page's map (the area drawn as a rectangle, Use this view, the overlays' and categories' live preview: the store's `attachPreview` and `useView` intents wait for the admin tier's map mocks, CR-M2c-7), the whole admin wearing a previewed theme (CR-M2c-28), the journeys that need a drawn map or the published viewer (S-A35-HAPPY's pixel probe, S-A35-HAPPY-RESET, -CROSSED-BRIGHTNESS, -DISCARD, S-A19-HAPPY, S-A33-HAPPY-LAYER, S-A39-HAPPY, -REORDER, -ID-CLASH), re-georeference, crop and replace (notes until M3) | CR-M2c-12: the layers-settings workstream's report for the docs, the skills and `docs/LESSONS.md`. Lessons: `hcm-slider` moves itself on a key, so a store that clamps the value back to what Lit last rendered leaves the slider at the refused position unless the binding is `live()` (the black level stopped at the white one; a unit test and the keyboard spec caught it), and the announcement says the kept value, not the pressed one; a native radio has no computed border, so the non-text contrast check reads 1:1: draw it (`appearance: none`, a 2 px ring) and give it the class `touch-target`, the only element whose `::after` the target-size check counts; PageUp on a -100 to 100 slider moves 20, a tenth of the range; `getByLabel` of the Romanian "An" (year) also finds "Anulează": `exact`; the text of a kit button is the host's (the inner `button` holds only a slot); on the one-pane layouts (c360, m768) the sections' links are gone once a section is open, so a journey goes by address; a category's delete stays off until its places have somewhere to go (a confirm that silently did nothing was the first version) | done (integrator, 2026-10-18: CR-M2c-12) |
| CR-M2c-31 | integrator | the user (`DECISIONS-for-review.md` §35b, §35e, §35f, §34b, §34c, §34g), ops-screens or the next shell task (CR-M2c-7, -22, -28, -29) | What the integration left open: the Bucharest site names `bucuresti` while the project names `bucharest` (§35b); a revoked admin's draft is lost with the page (§35e, `S-A20-BAD-REVOKED-WHILE-EDITING`); the admin bundle at 448.1 of 450 KB (§35f); the admin map's Mapbox mocks and the per-test city (CR-M2c-7), without which no journey draws on a map; CR-M2c-22 was done in the integration (the photos page's map box is `hcm-admin-map`, so Mapbox's logo and attribution get `mapbox-gl.css` inside its shadow root once a token exists) | the integrator's report (CR-M2c-12) | open (follow-ups, 2026-10-18: §35b, §35e and §35f done, CR-M2c-28 and -29 done; CR-M2c-7 (the admin map's mocks, the per-test city) and §34b, §34g wait) |

## 14. Decisions for review

`DECISIONS-for-review.md` §34 (2026-10-17) holds what this contract needs from files the agents may not change on their
own: 34a the dependency-cruiser rules for the moved map and the draw library (stricter or equal: the pre-approved
category, logged when applied), 34b loading the admin's ES module build so the draw library and each area load lazily
(it changes what the bundle budget measures: for the user), 34c the admin journeys at the tour projects (CI time: for
the user), and three decisions recorded for the user to see (Terra Draw over Mapbox GL Draw, the seven-day grace of a
layer delete, the replaced `S-A10-BAD-MISSING-EN-TITLE`).

## Addendum 2026-10-18: the integration (integrator)

- **Wired**: every area's page and module is registered in `packages/admin/src/index.ts` (photos, pois, layers, settings, home,
  admins, history, jobs, crashes) and shown in the shell's page area; the navigation holds Home, Setup, Photos, Places,
  Layers, Jobs, Settings, Admins, History and Crashes. `packages/admin/test/app/admin-port.test.ts` now checks every area's
  store against its page's port, photos included; `packages/admin/test/app/content-wiring.test.ts` covers the areas'
  services as the entry builds them.
- **Cross-app journeys (behaviour A41, `e2e/admin/specs/flows/`)**: the manifest the Functions emulator builds after an
  editor's Save is read from the Storage emulator's public bucket and served to the built viewer. Proven at the five admin
  projects: a photo published, renamed, reverted from History and unpublished (`S-A41-HAPPY-PHOTO`, `-HAPPY-REVERT`,
  `-BAD-UNPUBLISHED`); a place added from its list of positions (`S-A41-HAPPY-PLACE`); a layer's default opacity, shown at
  start and saturation, the last by a pixel probe (`S-A41-HAPPY-LAYER`, `S-A36-HAPPY-SHOWN-AT-START`); the owner removing
  an editing admin in a second browser (`S-A02-BAD-REVOKE`, its asserts reworded to what the product does, §35e).
- **CR-M2c-22 done**: the photos page's map is `hcm-admin-map` (mapbox-gl.css inside the shadow root, the kit's zoom buttons, the keyboard's crosshair, one place for every "no map" note).
- **What the journeys found**: the site's and the project's city ids differ (§35b, `docs/LESSONS.md` 76); the place
  editor's texts committed on `change` only, so a click on Save straight after typing did nothing (§35d, lesson 75); a
  revoked admin's draft is lost (§35e, lesson 79).
- **What the pipeline found**: the editors' catalogue past `max-lines` (CR-M2c-25, done: one folder per area); the
  collection-group history rule open outside `cities/` (§35c, lesson 77); the rules tests' photo fixture without
  `replacement` (lesson 78); the forbidden account's name in the layers' code and tests (now "another account" and "the old
  site's account"); an always-true assertion in `admin-port.test.ts`; `content-wiring.ts` below 90 %.
- **The tour's inventory**: `photos.deleted-undo` joins it (CR-M2c-17 done); every admin state passes `expectStateSound` at
  the five admin projects; the four review sizes in light and dark are screenshots (§35g).
- **The review screenshots** (`reports/screenshots/m2c/`, 57 states × 4 sizes × 2 schemes, sheets in `sheets/`): four
  defects the checkers passed, fixed with a test each (`DECISIONS-for-review.md` §35h, `docs/LESSONS.md` 81–84).

## Addendum 2026-10-18: the follow-ups (follow-ups agent)

- **Orchestrator decisions applied** (`DECISIONS-for-review.md` §34a, §34h, §35b, §35d, §35e, §35f, logged in §36): the Bucharest
  site names `bucharest` (`site.json` → `legacyCityId` renames the seed's `bucuresti` in the served manifest) and the
  journeys serve the built site as it is; the admin's page names the digest of the pinned `mapbox-gl.js` and the loader
  sets `integrity` and `crossOrigin`; numbers commit on every key and say their problem once left (`LeftFields`,
  `numberValue` of the editing kit); a revoked admin's page stays read-only under a banner until sign-out
  (`S-A20-BAD-REVOKED-WHILE-EDITING`, `exists`); the empty `engine-browser` Vitest project is gone; the admin's CSS
  literals are minified and `admin.mjs` like the engine's.
- **Change requests closed**: CR-M2c-15, -27, -28, -29 (the table above). Left: CR-M2c-7 (the admin map's Mapbox mocks and
  the per-test city: the E2E agent's), CR-M2c-13 (M3), CR-M2c-14 (M5; done on 2026-10-23, see its row), CR-M2c-20
  (waits for §34g), CR-M2c-31 (what waits for the user).
- **The state checker sees the whole state** (lesson 84): every scroller is scrolled through its content and the
  position-dependent checks run at each position (`e2e/support/scroll-sweep.ts`, `docs/TESTING.md` → *The tour's
  checkers*).
- **Hardening and live polish**: rotating a phone with the account menu open gives the focus to the account button
  (`S-A29-BAD-ROTATE-MENU-OPEN`); a start-up deploy's `runtime.json` keeps the admin from probing the missing server
  (no CORS error, `S-A25-HAPPY`, `S-A25-BAD-NO-START-UP-DEPLOY`); the boot log and crash reports name the release
  `<version>+<short commit>` that the admin's site build writes.

## Addendum 2026-10-18: the e2e (E2E agent)

- **The content world (§12.3, CR-M2c-7) is built**: a test's city `w-<10 hex>` and Google account `editor-<hash>@content.e2e.test`, an admin of the map (its `admins` document and claim); the address names the city and the admin map's token (`?city=`, `?mapToken=pk.e2e-fake-token|none`, `e2e` build only); no lock. The singleton screens (Setup, Admins, Crash reports, Home, sign-in, claim, invitations) keep `ADMIN_LOCK`.
- **Every M2c journey with a map runs**: drawing (four clicks, a line and a point, the keyboard, outside the city, crossing edges, 501 positions), the photo editor's pin, direction and field of view, uploads with EXIF (generated JPEGs, `e2e/admin/support/images.ts`), replace, publish, the layers' adjustments, the settings' publishing, drafts, remembered fields and the shell. Where the click tools stand in for Terra Draw (§34g), a pin or a vertex moves with a click in Select mode; drags stay planned (`S-A32-HAPPY-VERTEX-EDIT`).
- **The tour (§12.2)**: the editors' states run at every tour project (`e2e/tour/admin-{photos,places,drawing,layers,settings,jobs,history}.tour.ts`); the list and detail never split at a compact height (`splitsAt`), which the first run at 915 × 412 required (lesson 107).
- **Not built, rows still planned** (`DECISIONS-for-review.md` §37e): the settings page's map (`S-A19-HAPPY`, `S-A36-HAPPY`, `-BAD-DISCARD`), the conflict banner's name and time (`S-A38-BAD-CONFLICT`), Home's list of skipped documents (`S-A38-BAD-SKIPPED-SHOWN`).

## Addendum 2026-10-18: minimum input (adversarial reviewer)

- **§5.6's budgets, lowered**: `category` 3 (a new category's icon follows its label until one is picked,
  `guessCategoryIcon`; `S-A39-BAD-ICON-NOT-GUESSED`), `inviteAdmin` 3 (the new invitation's link is copied at once; Copy
  stays). `inviteAdmin`, `revertChange` and `revokeAdmin` are now counted by their e2e flows. What would cut more and
  waits for the user: `DECISIONS-for-review.md` §38d.

## Addendum 2026-10-18: the user's decisions §34b, §34g, §34i and the review polish

`DECISIONS-for-review.md` §41 has the details and the measurements.

- **§4.2, loading**: the admin page loads the ES module `admin.mjs` (no IIFE); each area is a lazy chunk
  (`packages/admin/src/pages/<area>.ts`: its elements from `@hcm/ui/admin/areas/<area>`, its store module), loaded by
  `routing/area-pages.ts` when its route first opens; Terra Draw is the `terra-draw` chunk, imported by `loadTerraDraw`
  on the first drawing tools. §11.2's marked sections of `packages/admin/src/index.ts` and `define.ts` are gone with the
  eager registration; an area adds its chunk file and its line in `AREA_CHUNKS`. A chunk that does not load shows Try
  again (`S-A29-BAD-CHUNK-LOAD`).
- **§4.3–§4.4, Terra Draw installed** (CR-M2c-20 done): a new shape is still drawn by clicks (`click-growth.ts`, both
  ports), so §5.6's budgets hold and Enter or a click on the first vertex finishes nothing (§4.4's "drawn once ... Enter
  or a click on the first vertex finishes" is replaced by the click tools' rule: the shape exists from its second or
  third click and grows until another tool is chosen); Terra Draw shows the shapes and its select mode drags the selected
  feature, a vertex, or a midpoint (inserting one); `setMode('select', id)` selects `id`; a click moves a selected point;
  the select mode leaves the keys to the editor's tools (no Delete key: the list removes a vertex, a right click on the
  map too). §4.7's browser test with the real Terra Draw: `packages/ui/test/map/draw/terra-draw-real.test.ts`.
- **§1.2, large and extra-large**: on an extra-large page (from 1600 px, the page's own class) the map-centric editors
  put the map beside the form (photos and places: form 480 px; the layer editor: groups 560 px, the map kept in view);
  from 1200 px to 1599 px the map stays above the form (the detail pane is under 1,000 px there). The other editors keep
  the 840 px form.
- **Dates** are typed in the admin's language (`zz.ll.aaaa`, `dd/mm/yyyy`), never in a native date input
  (`S-A21-HAPPY-DATES-IN-LANGUAGE`, `S-A21-BAD-DATE-UNREAD`).
- **CR-M2c-24's open question (§34i)**: once Setup is complete an empty address opens `#/home`, and Home takes Setup's
  place on the compact bar (`S-A40-HAPPY-FIRST-SCREEN`, `S-A40-BAD-SETUP-INCOMPLETE`).

## Addendum 2026-10-23: handed over to M3 (contracts)

Added by the M3 contracts agent. CR-M2c-13 (run `layer-delete` jobs after their grace) is `imagery.tick`'s step 5 in
`M3-interfaces.md` §4.6, owned by fn-imagery (`S-A33-HAPPY-TILESET-DELETED`). The layer editor's Replace image,
Re-georeference and Crop (§8.2's M3 placeholders) are `M3-interfaces.md` §10.5 (CR-M3-7, admin-imagery, through the lazy
`layer-geometry` chunk); the Jobs page learns the raster steps and `awaiting_gcps` (CR-M3-5; the status and its text are
done); the tour inventory gained an `imagery` section in `e2e/tour/states.ts`.

## Addendum 2026-11-01: the live test's editor findings (findings 35–38)

The user's live walk of 2026-11-01 (`docs/research/manual-test-2026-10-25.md`, findings 35–38;
`DECISIONS-for-review.md` §77). What it adds to this contract:

- **§7.2 the place editor, Category**: a city whose categories are listed and none (`categoriesKnown`, the page passes
  it) shows a no-categories field instead of the select: why a place needs one, **Add the starter categories** (the
  intent `addStarterCategories`, one batch of `STARTER_POI_CATEGORIES`, the open place then takes the first) and **Add a
  category** (`#/settings/categories/_new`). A new city starts with those five from the server (`cities.create`,
  `setup.createCity`). Tour state `pois.no-categories`.
- **§5.1 and §10.1, problems at the field and Save's note**: a required field's problem is the action it asks for
  (`adminContent.common.issue.*`, the editing kit's `issue-text.ts`), every other problem the validation words; Save's
  note names every field it waits for (`adminContent.common.cannotSave`), in the places, photos, layers and settings
  editors alike.
- **§9.2 History**: a creation is named by the version it made (the next entry's `previous`, else the document now,
  read once), never by its id while the document has a name.
- **The map (§4.4)**: a category's overlay has seven map layers, the white `casing` under its lines and outlines.

## Addendum of 2026-11-06: reads of the whole city (§7.4, §7.3, §8.5, §9.5)

`readOnce` (`packages/admin/src/content/read-once.ts`) takes only the server's answer: a listener's first answer may be the cache's,
which holds what other listeners brought, and taken for the whole collection it exported 50 places of 900. It gives up after
`READ_WAIT_MS` (30 s) and says why (`denied` or `offline`), and no caller may read that as an empty collection: Export all and an import's
plan say so and write nothing, smaller bounds are refused (S-A19-BAD-BOUNDS-UNREAD), a category in use survives with its places
(S-A33-BAD-CATEGORY-UNREAD), Mark all as read marks nothing; a refusal also makes the shell ask who this is again. **§7.4**: an import
plans against every place of the city, read once per chosen file, so a file naming a place past the list's page updates it; a place whose
document fails its schema is left out of Export all aloud (`adminContent.pois.exportPartial`) and a feature naming it is refused
(`unreadable-place`), never a second place; a file chosen or a dialog closed during that read ends the earlier file's turn
(S-A34-BAD-FILE-CHANGED-WHILE-READING). The place's photo picker pages through the photos, and a linked photo is named past its page.

## Addendum 2026-11-07: a photo's precise date and its source

The editor of §6.3 gains Month and Day after Year and its own Source section (address, name), out of Author and rights: `docs/research/photo-date-source.md`.
