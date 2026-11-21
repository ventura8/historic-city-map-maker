# `@hcm/ui`: the Material 3 Expressive kit

The component kit shared by the viewer engine and the admin: Lit 3 custom elements without decorators, `hcm-` tags,
Material 3 with the M3 Expressive update, adaptive to the box it is given. The contract (tags, properties, events,
slots) is `docs/research/M1-interfaces.md` §5.1; the additions made while building it are change request CR-12 there.
The viewer's own elements live in `src/viewer/` (engine-ui workstream) and are not described here; the admin's live in
`src/admin/` behind their own entry, described in *The admin's elements* below.

## The admin's elements

`@hcm/ui/admin` (`src/admin/index.ts`, M2b): imported only by `@hcm/admin`, never by the engine, so the viewer's bundle
carries no admin element or text. `defineAdminElements()` registers them; `defineSetupElements()` the Setup pages.

- **Shell** (`src/admin/shell/`): `hcm-admin-shell` (layout per window class through `shellLayout`: a navigation bar on
  compact windows, a rail from medium, the expanded rail from large, a rail with the account button at its foot and no
  top bar on a landscape phone; an app shell as tall as the window where only the page scrolls, so nothing scrolls under
  the bars; the start-up banner, the page and the snackbar docked below it in `<main>`, as is every panel; the city's
  theme), `hcm-admin-nav` (bar, rail and expanded rail from one list; a rail taller than the window scrolls, a long
  label wraps inside it), `hcm-account-menu` (language, theme, analytics consent, sign out),
  `hcm-page-outlet` (the route's page, loaded lazily by the app; a list and detail page fills the page area).
- **Auth panels** (`src/admin/auth/`): `hcm-sign-in`, `hcm-claim-panel`, `hcm-join-panel`, `hcm-blocked-panel` and
  `hcm-consent-note` (the inline note before a Google popup: why, for at most an hour, Google's unverified-app screen).
- **Setup** (`src/admin/setup/`): `hcm-setup-page` (progress ring; one column below 840 px, list and detail from there;
  it follows only its width class and applies a change on the next animation frame), `hcm-setup-step` (one card: status
  chip, why and cost, deep links, the consent note while the card's next action opens a popup, the body slot, Check
  again; modes `inline`, `summary`, `detail`; the input counters as `data-*` attributes), one body per step
  (`hcm-setup-billing`, `-provision`, `-deploy`, `-mapbox`, `-usgs` with the countdown, `-analytics`, `-import`),
  `hcm-crash-groups` and `hcm-crashes-page`.
- **The editors** (M2c, [docs/research/M2c-interfaces.md](../../docs/research/M2c-interfaces.md)): the editing kit
  (`src/admin/editing/`: `hcm-list-detail`, `hcm-confirm-dialog`, `hcm-empty-state`, the `AreaPage` base that opens and
  closes its area's store), the admin map (`src/admin/map/`: `hcm-admin-map`, the map's box with mapbox-gl.css inside its
  shadow root, the 48 px zoom buttons, the keyboard's crosshair and the reason there is no map, collapsed to that note
  with `[no-map]`; `hcm-draw-toolbar`; `hcm-vertex-list`), and one folder per area with its page and its port:
  `src/admin/photos/` (`hcm-photos-page`, `hcm-admin-photo-list`, `hcm-admin-photo-editor`), `src/admin/pois/`,
  `src/admin/layers/`, `src/admin/settings/` (with `hcm-icon-picker`), `src/admin/admins/`, `src/admin/history/`,
  `src/admin/jobs/`, `src/admin/crashes/` and `src/admin/home/`; `src/admin/content-port.ts` gathers the areas' ports.
- **Ports**: the elements never import `@hcm/admin` (layering); they read structural ports, `src/admin/admin-port.ts` and
  `src/admin/setup/setup-port.ts`, which `packages/admin/test/app/admin-port.test.ts` checks against the real app.

## Elements

Every element has an idempotent `defineHcm<Name>(registry = customElements)` that also registers the elements it
renders; `defineUiKit(registry)` registers all of them. Every event is a bubbling, composed `CustomEvent`. Strings are
passed in already localized (the kit has no catalogue of its own).

| Tag | Role, keyboard and events |
| --- | --- |
| `hcm-icon` | Material Symbols Rounded ligature from the bundled subset; `filled` uses the FILL axis; a name outside the subset draws nothing. |
| `hcm-button` | M3 Expressive small button (40 px in a 48 px target): `filled`, `tonal`, `outlined`, `text`; the slot is the name. |
| `hcm-icon-button` | `label` is the name; `toggle` makes it `aria-pressed` and fires `hcm-change` `{selected}`; `variant` `standard`, `filled`, `tonal`, `outlined`. |
| `hcm-fab` | `small` 40, `medium` 56 (M3 FAB), `large` 96 px; `extended` shows the label. |
| `hcm-fab-menu` | FAB with `aria-haspopup="menu"`; arrows, Home, End, Esc; `hcm-select` `{value}`, `hcm-toggle` `{open}`. Custom properties: `--hcm-fab-menu-max-block-size` (beyond it the items wrap into a second column), `--hcm-fab-menu-align` (`flex-end` by default; `flex-start` for a menu docked on the leading edge, so the wider wrapped menu never moves the FAB). `--hcm-fab-menu-gap` (8 px by default) between the items and the FAB: an app whose FAB sits beside a taller control sets more, so the open menu clears it (the viewer at medium and up, beside the timeline). Only the FAB and the items take the pointer: the rest of the open menu's box lets taps through to what is beneath it. |
| `hcm-switch` | `role="switch"`; `hcm-change` `{checked}`; the selected handle shows a check mark. |
| `hcm-slider` | `role="slider"` with `aria-valuetext`; arrows ±step, PageUp/PageDown ±a tenth, Home/End; `hcm-input` per frame or key, `hcm-change` on release. |
| `hcm-chip` | Filter chip, `aria-pressed`; `hcm-change` `{selected}`. |
| `hcm-segmented-button` | Radio group with one Tab stop and wrapping arrows; `hcm-change` `{value}`. Segments are as wide as their labels, at least 48 px (so the 48 px touch target never reaches past the group), and wrap a long label in a narrow container; when they cannot fit side by side even so (single words, text spacing), they stack one 48 px row each (the reflected `stacked`) until the host is wide enough again. |
| `hcm-card`, `hcm-list`, `hcm-list-item` | Containers; an `interactive` list item is a button. |
| `hcm-sheet` | `bottom` (handle, a 48 × 48 button at the top edge: tap cycles peek, half, full; ArrowUp/ArrowDown; drag snaps or closes) or `side`; `modal` adds a scrim and a Tab trap; focus moves in on open and back on close; `hcm-close`, `hcm-detent-change`. The `actions` row takes no room while nothing is slotted there; the header row is a plain box (no `header`, which would read as a second page banner). |
| `hcm-dialog` | Native modal `<dialog>`; Tab wraps; Esc, close button and scrim close it with `returnValue` `cancel`, `close`, `scrim`; `close(value)` for actions; `fullscreen`. Its headline row is a plain box, not a `header` (a banner inside the admin's top bar). |
| `hcm-snackbar` | Always-present, visually hidden polite live region that gets the message alone `ANNOUNCE_DELAY_MS` after it shows (a region created with its text is not announced); timeout pauses on hover and focus; `hcm-action`, `hcm-dismiss` `{reason}`. Its controls' focus ring is inverse primary on the inverse surface (`--hcm-focus-ring-color`). |
| `hcm-progress`, `hcm-loading-indicator` | `role="progressbar"`; the Expressive loading indicator morphs, and only pulses under reduced motion. |
| `hcm-toolbar` | Floating toolbar, `role="toolbar"`, one Tab stop, arrows of its `orientation`, Home and End. |
| `hcm-consent-banner` | Non-modal region; Accept and Decline look the same; `hcm-consent` `{decision}`. |
| `hcm-overlay-list` | The live-transparency list of PLAN Addendum 3 (switch and 0–100 % slider per overlay, group headings, polite announcements). |

## Theme

- `applyTheme(target, tokens, mode, highContrast)` (`src/theme/apply.ts`) writes the scheme's `--md-sys-color-*` tokens
  plus every system token into one constructable stylesheet per target, through the CSSOM (no inline style, so the strict
  CSP holds and a token value cannot escape its declaration). `system` follows `prefers-color-scheme`; every mode follows
  `prefers-contrast: more`; `prefers-reduced-motion: reduce` turns the spatial springs off. `clearTheme` removes it.
- `src/theme/device-accent.ts`: **Device accent**, the default colours of the viewer and the admin (DECISIONS-for-review.md
  §222). `readDeviceAccent` reads the page's `--hcm-device-accent`, else CSS `AccentColor` where it is the device's own
  (Firefox, an installed Chromium app); `withAccent` turns a theme's schemes to the accent's OKLCH hue with every colour's
  WCAG luminance kept, so every contrast ratio stays the city's; `accentTokens(tokens, 'device' | 'map', document)`.
- `src/theme/system.ts`: the shape scale (with 20, 32 and 48 px), the type scale and its emphasized weights, the
  Expressive springs as Google's web cubic-bezier curves, elevation shadows and state-layer opacities, from
  `@material/web@2.5.0` `tokens/versions/latest` (design system 34.0.21).
- `src/theme/baseline.ts`: the precomputed theme of the default seed (the admin's, the start page's). The viewer applies
  `src/viewer/viewer-baseline.ts`, the same values cut to the 27 colour tokens the viewer, the kit and the map name,
  before a manifest arrives and under a city theme that sets only some tokens (the viewer never ships the colour
  library).
- `@hcm/ui/dynamic-color`: `themeFromSeed(seed, variant)` with `tonalSpot` (default), `expressive` or `vibrant`.

- The focus ring (`focusRing`) is 3 px of secondary, or of `--hcm-focus-ring-color` where a surface sets it: the ring
  needs 3:1 against what is around it, and secondary is too close to the snackbar's inverse surface (1.62:1) and to the
  viewer's error container (2.38:1). The viewer gives Mapbox's white attribution a ring that is dark in both schemes
  (`light-dark()` of primary and inverse primary).

## Fonts and icons

- `fonts/`: Roboto Flex (weight axis, `latin` and `latin-ext`) and a Material Symbols Rounded subset that holds only the
  ligatures of `ICONS` (`src/icons.ts`: the kit's icons plus `POI_ICONS`). Licences: `fonts/LICENSES.md`.
- Rebuild after changing `ICONS`, and verify, in the quality image:

  ```bash
  npm run fonts:build --workspace @hcm/ui   # HarfBuzz subset, wght 400 / GRAD 0 / opsz 24 pinned, FILL kept
  npm run fonts:check --workspace @hcm/ui   # byte-identical rebuild and every name shapes to one glyph
  ```

- `installFonts(document, baseUrl)` registers the faces with `document.fonts` (namespaced families `HCM Roboto Flex`
  and `HCM Material Symbols Rounded`): the kit's only global side effect, needed because `@font-face` inside a shadow
  root is ignored. `loadIconFont(document)` resolves when the icon font can be drawn (POI icons on the map).

## Layout

`WindowClassController` measures its host with a `ResizeObserver` (never the viewport, so an embedded map adapts to its
box), re-renders on a class change and reflects `window-class` and `height-class` attributes. Width classes are M3's
(`compact` < 600, `medium` < 840, `expanded` < 1200, `large` < 1600, `extra-large`); height classes `compact` < 480,
`medium` < 900, `expanded`. `atLeast()` and `onlyWindowClass()` give the same breakpoints to `@container` rules.

## Decisions

- **No `@m3e/web` or `@material/web` runtime.** Both were checked on npm on 2026-10-12 (`@m3e/web` 2.10.0, MIT, one
  maintainer, no `sideEffects` field, pulls `@floating-ui/dom`, `composed-offset-position` and `tslib`; `@material/web`
  2.5.0 is in maintenance mode and its Expressive components are "Labs", not for production). The contract needs
  behaviour neither documents (`aria-valuetext` and PageUp/PageDown on the slider, per-frame input coalescing, detents),
  and the engine is an embed with a gzip budget (`scripts/ci/check_bundle_budget.py`), so every element is written in Lit with Google's token values
  (the research's option b). The `hcm-*` API stays the seam if a library is adopted later.
- **Inline styles only through the CSSOM.** The city page's CSP has no `'unsafe-inline'` for styles, and Lit's
  `styleMap` writes a `style` attribute on its first render, which that CSP refuses (found by the viewer smoke in the
  M1 integration). Every element sets custom properties with the `cssProperties` directive
  (`src/components/css-properties.ts`), which uses `style.setProperty` and removes a property a later render drops.
- **Font tooling is npm, not Python**: `harfbuzzjs` (WASM) subsets and shapes, `wawoff2` decodes and encodes WOFF2;
  both run in the quality image with nothing added to it.

## Tests

Vitest browser mode (Chromium), one file per element under `test/components/`: roles and names through `page.getByRole`,
real key presses and clicks through `userEvent`, synthetic pointer events for drags, fake timers for the snackbar, and
`axeViolations` from `@hcm/test-support/axe` (WCAG 2.2 AA rules) on every element. `test/helpers.ts` renders into a host
themed with the baseline theme and the real fonts. The admin's elements are tested the same way under `test/admin/`,
over a fake app (`test/admin/shell/fake-app.ts`) and a recording Setup port (`test/admin/setup/fixtures.ts`, whose
`draftUsgs` also updates the state, as the controller does), in both languages; `test/admin/shell/shell-layout.test.ts`
pins the shell's layout (nothing under the bars, the focused control and the snackbar uncovered) and its landmarks with
`axeRuleViolations` (named rules, best practices among them, on the whole document).
