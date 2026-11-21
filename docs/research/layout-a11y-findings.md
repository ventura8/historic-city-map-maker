# Layout and accessibility findings

Recorded on 2026-10-17 by the invariants agent: the first run of the generic layout and accessibility checkers
(`docs/TESTING.md` → *The tour's checkers*) over the whole state inventory (`e2e/tour/states.ts`), answering the
user's request of 2026-10-12: "in the phone screens the menu button sometimes overlaps with other elements. we should
have tests for overlapping elements!!! also for accessibility!!". No product code was changed in this task: this file
lists what the next task fixes. It is a dated record; a later run appends an addendum instead of rewriting it.

## How it was run

- `PIPELINE_STAGE=e2e E2E_TIER=all bash scripts/ci/e2e-split.sh` on 2026-10-17: every tier at once (1,039 tests in
  19 minutes split between the laptop and the NUC), so the tour's 44 projects (11 viewports × light and dark ×
  Romanian and English), the admin's four projects (c360, m768 and l1440 in Romanian, l1440 in English) and the a11y
  specials. The verdict was `[FAILURE] stage 'e2e' failed` by design: every tour test and every admin spec with a
  state check failed on soft assertions only (no hard error, no timeout but the one fixed below); the harness, the
  smoke, the a11y specials (whose states now also run the layout checker), no-WebGL and the functional tier passed.
- Every violation is one line of `layout-a11y-violations.jsonl` in its test's output folder, with the state's outlined
  screenshot attached to the test in the merged HTML report (`reports/playwright/`; the NUC's part under
  `reports/split/nuc/`). The tables below group the 3,407 records by the component the first element belongs to (the
  innermost kit or app component on its path), then by check and by message with the names and numbers taken out (a
  box moves with the viewport, a name with the language). Each row shows one message as the checker wrote it, the
  viewports and states where it occurs, and how many records it covers.
- Viewports: `c320` 320 × 568, `c360` 360 × 800, `c412` 412 × 915, `c915l` 915 × 412 (a phone held sideways),
  `m768` 768 × 1024, `e1024` 1024 × 768, `l1280` 1280 × 800, `l1440` 1440 × 900, `x1920` 1920 × 1080, `x2560`
  2560 × 1440, `x3840` 3840 × 2160. A state marked *(text spacing)* or *(reflow 320)* is the WCAG 1.4.12 or 1.4.10
  variant of that state, reporting only what the variant adds.

## Summary

| Check | Records | What it found |
| --- | ---: | --- |
| axe | 2,554 | best practices on every viewer state: no `main` landmark and no level-one heading on the city page; content outside landmarks (the timeline, toasts, the open menu, the legal bar's copy, the photo list without WebGL); a photo sheet's `header` taken for a second banner under the lightbox; on the admin, the start-up banner and a snackbar outside landmarks, a second banner in the account menu, and two Setup headers under 24 px on a phone |
| gap | 380 | on phones the FAB ends on the timeline's top edge (0 px) and sits 2 px from the collapsed attribution; the timeline is 2 to 7 px from Mapbox's logo and attribution; on m768 the photos-near-the-year chip touches the timeline |
| focus-ring | 196 | the toast's Close ring at 1.62:1, the error card's Retry ring at 2.38:1 and the collapsed attribution's ring at 1.71:1 against what is around them; the USGS expiry field shows no ring of its own |
| edge | 112 | the docked photo list (expanded and up) cannot scroll: its pane hides the overflow, so the photos below the fold are out of reach; with text spacing the docked sheet's title and Close button leave the pane; the admin rail's last item leaves the m768 window with text spacing; the map's canvas wider than its box after a POI pane opened (x2560, x3840; possibly a resize not yet applied) |
| modal-escape | 52 | under the lightbox (phones and m768) the photo sheet stays usable: its image button, resize handle and Close are neither inert nor out of the Tab order |
| landmark | 44 | the lightbox's `nav` has no name |
| occlusion | 29 | the open FAB menu's host still takes the pointer over the timeline where no item is drawn (m768, e1024); the toasts' dock covers the vertical timeline's thumb on a phone held sideways; on the admin a link's 48 px touch target covers its neighbour, and with text spacing a POI link slides under the sheet's actions |
| focus-order | 20 | the admin's Setup page on l1440 (see *Checker notes*); the USGS date field counted several times |
| focus-obscured | 16 | on the admin at 360 px the focused Setup headers, links, Check again, the USGS date field and the e-mail switch end under the fixed navigation bar (no scroll padding); on m768 the timeline's thumb is under the open menu |
| clipped-text | 4 | the lightbox title cut with text spacing at 320 px |

The language switch also leaves Mapbox's own labels in the first language: an English page switched to Romanian keeps
"Map", "Mapbox homepage" and "Show or hide the map sources" (the i18n leak check of the `language` state, 22 English
projects; not a layout record, so not in the tables).

No overlap, legal, page-scroll, target-size, non-text contrast, live-region or keyboard-trap violation was found: once
the page has stopped moving, no two pieces of floating chrome overlap, the Mapbox logo and attribution are always one
each and uncovered, every target is at least 24 px (48 on phones), switches and sliders reach 3:1 in every scheme,
every expected announcement is made, and the focus never sticks. About, at its top and at its end, has no violation.

## What to fix first

1. **The FAB on phones** (the user's report): it touches the timeline (0 px) and almost touches the collapsed
   attribution (2 px) on c320, c360 and c412 in every state with the timeline; the open menu's host keeps taking the
   pointer over the timeline (m768, e1024). Give the dock 8 px of space and let only the menu's items take the pointer.
2. **The docked photo list cannot scroll** (expanded and wider): the trailing pane's `overflow: hidden` holds a body
   that grows with its list. Constrain the docked sheet's body to the pane and let it scroll.
3. **Modal stacking under the lightbox**: make the photo sheet inert while the lightbox is open; name the lightbox's
   `nav`; keep the sheet's `header` from reading as a page banner.
4. **Focus rings**: the toast's Close, the error card's Retry and the collapsed attribution's toggle need a ring of 3:1
   against their own surfaces.
5. **The admin on phones**: scroll padding for the fixed navigation bar (focus not obscured), the Setup headers' 24 px
   minimum, the touch targets of stacked links.
6. **Landmarks and headings** of the city page and the admin (a `main`, a level-one heading, the timeline, toasts and
   the legal bar inside landmarks).
7. **Text spacing**: the docked sheet's title and Close, the lightbox title at 320 px, the admin rail at 768 px.
8. **Mapbox's labels** after a language switch.

## Checker notes

- Two kinds of `focus-order` record came from the checker, not the product, and were refined after the run (the rows
  stay below as recorded): the fields of a native date input (the USGS expiry date) are now one stop, and a step from a
  list to the top of a detail pane beside it (the Setup page's two columns at 1440 px) is a new column, not a step back
  (`distinctRuns` and `orderViolations` in `e2e/support/a11y-rules.ts`). The date field's own ring needs a look by eye.
- The admin journey on m768 timed out at 300 s with the ten state checks under load; its timeout is now 600 s.

## Findings by component

### the page (html) (1608 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | landmark-one-main (moderate): html | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.consent, viewer.error-invalid, viewer.error-network, viewer.error-not-found, viewer.home, viewer.language and 15 more | 804 |
| axe | page-has-heading-one (moderate): html | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.consent, viewer.error-invalid, viewer.error-network, viewer.error-not-found, viewer.home, viewer.language and 15 more | 804 |

### hcm-map-viewer (608 violations, 6 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | region (moderate): hcm-map-viewer,#timeline,.thumb | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.home, viewer.layers, viewer.layers-opacity, viewer.near-year-photos, viewer.photo, viewer.photo-list and 4 more | 320 |
| axe | region (moderate): hcm-map-viewer,#timeline,.thumb \| hcm-map-viewer,hcm-snackbar,.message | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.language, viewer.locate-toast, viewer.share-toast, viewer.toast | 176 |
| axe | region (moderate): hcm-map-viewer,#timeline,.thumb \| hcm-map-viewer,hcm-fab-menu,#menu | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.menu-open | 44 |
| axe | region (moderate): hcm-map-viewer,.note > span | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.consent | 44 |
| axe | region (moderate): hcm-map-viewer,.fallback > hcm-photo-list,ul\[aria-label="Photo list"\] | c320, c360, c412, c915l, m768 | viewer.no-webgl | 20 |
| edge | text "Photos from around 1980" (hcm-map-viewer > h2.sheet-title) at 689,-28 275x66 is cut off by "Photos from around 1980 10 photos Arionoaiei Year 1980 Ec..." (hcm-map-viewer > div.pane.trailing) at 664,0 360x768, which hides its overflow and does not scroll | e1024 | viewer.timeline-step (text spacing) | 4 |

### hcm-timeline (288 violations, 6 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| focus-obscured | the focused "Cronologie" (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\] > div.thumb.touch-target) at 596,916 64x40 is hidden under other content (WCAG 2.4.11) | m768 | viewer.menu-open | 4 |
| gap | timeline (no name) (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\]) at 96,888 576x100 is 7.3 px from mapbox-logo "Pagina Mapbox" (hcm-map-viewer > a.mapboxgl-ctrl-logo) at 6,995 88x23 (at least 8) | c320, c360, c412, m768 | viewer.home, viewer.language, viewer.locate-toast, viewer.menu-open, viewer.share-toast, viewer.skip-link and 3 more | 144 |
| gap | timeline (no name) (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\]) at 16,664 328x100 is 2.0 px from attribution "USGS (e2e) \| © Mapbox © OpenStreetMap" (hcm-map-viewer > div.mapboxgl-ctrl.mapboxgl-ctrl-attrib) at 326,766 24x24 (at least 8) | c320, c360, c412 | viewer.home, viewer.language, viewer.locate-toast, viewer.menu-open, viewer.share-toast, viewer.skip-link and 3 more | 108 |
| gap | timeline (no name) (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\]) at 96,888 576x100 is 0.0 px from marked "Fotografii din jurul anului 1966" (hcm-map-viewer > hcm-button\[data-layout-check=near-year\]) at 96,848 259x40 (at least 8) | m768 | viewer.timeline-step, viewer.year | 8 |
| occlusion | "Cronologie" (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\] > div.thumb.touch-target) at 791,52 64x40 is covered: 2 of 5 sampled points (first at 804,60) hit "Linkul a fost copiat. Linkul a fost copiat." (hcm-map-viewer > div.dock.toast) at 24,24 867x48 | c915l | viewer.language, viewer.locate-toast, viewer.share-toast, viewer.toast | 16 |
| occlusion | "Cronologie" (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\] > div.thumb.touch-target) at 596,916 64x40 is covered: 5 of 5 sampled points (first at 628,936) hit "Straturi Lista fotografiilor Arată-mi locația Distribuie ..." (hcm-map-viewer > hcm-fab-menu\[data-layout-check=menu\]) at 537,568 207x420 | m768, e1024 | viewer.menu-open | 8 |

### hcm-map-attribution (236 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | region (moderate): hcm-map-viewer,hcm-map-attribution,.mapboxgl-ctrl-logo\[href$="mapbox.com/"\]\[aria-label="Pagina Mapbox"\] \| hcm-map-viewer,hcm-map-attribution,p\[data-layout-check="map-attribution"\] | c320, c360, c412, c915l, m768, x1920, x2560, x3840 | viewer.layers, viewer.layers-full, viewer.layers-opacity, viewer.layers-peek, viewer.lightbox, viewer.near-year-photos and 7 more | 224 |
| axe | region (moderate): hcm-map-viewer,hcm-map-attribution,.mapboxgl-ctrl-logo\[href$="mapbox.com/"\]\[aria-label="Pagina Mapbox"\] \| hcm-map-viewer,hcm-map-attribution,.attribution | e1024, l1280, l1440 | viewer.lightbox | 12 |

### hcm-fab-menu (120 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| gap | fab "Meniu" (hcm-map-viewer > hcm-fab-menu\[data-layout-check=menu\] > button.fab.interactive) at 288,608 56x56 is 0.0 px from timeline (no name) (hcm-map-viewer > hcm-timeline#timeline\[data-layout-check=timeline\]) at 16,664 328x100 (at least 8) | c320, c360, c412 | viewer.home, viewer.language, viewer.locate-toast, viewer.menu-open, viewer.share-toast, viewer.skip-link and 3 more | 108 |
| gap | fab "Menu" (hcm-map-viewer > hcm-fab-menu\[data-layout-check=menu\] > button.fab.interactive) at 340,823 56x56 is 2.0 px from attribution "© Mapbox © OpenStreetMap" (hcm-map-viewer > div.mapboxgl-ctrl.mapboxgl-ctrl-attrib) at 378,881 24x24 (at least 8) | c320, c360, c412 | viewer.consent | 12 |

### hcm-icon-button (114 violations, 4 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| edge | control "Close" (hcm-map-viewer > hcm-icon-button > button.interactive.touch-target) at 972,-15 40x40 is cut off by "Photos from around 1980 10 photos Arionoaiei Year 1980 Ec..." (hcm-map-viewer > div.pane.trailing) at 664,0 360x768, which hides its overflow and does not scroll | e1024 | viewer.timeline-step (text spacing) | 4 |
| focus-ring | the focus ring of "Închide" (hcm-map-viewer > hcm-snackbar\[data-layout-check=toast\] > hcm-icon-button > button.interactive.touch-target) at 770,28 40x40 has 1.62:1 against its surroundings (3:1) | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.language, viewer.locate-toast, viewer.share-toast, viewer.toast | 88 |
| modal-escape | "Închide" (hcm-map-viewer > hcm-photo-sheet > hcm-sheet > hcm-icon-button > button.interactive.touch-target) at 867,8 40x40 is outside the open modal "Fotografie mărită" (hcm-map-viewer > hcm-lightbox > div.lightbox) at 0,0 915x363 yet not inert, not aria-hidden and in the Tab order | c320, c360, c412, c915l, m768 | viewer.lightbox | 20 |
| occlusion | "Account and preferences" (hcm-admin-shell > hcm-account-menu > hcm-icon-button > button.interactive.touch-target) at 1396,0 40x18 is covered: 1 of 5 sampled points (first at 1428,14) hit (no name) (hcm-admin-shell > hcm-account-menu > hcm-icon-button) at 1396,0 40x18 | l1440 | admin.deploy-waiting | 2 |

### hcm-photo-list (104 violations, 5 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | region (moderate): hcm-map-viewer,hcm-photo-list,ul\[aria-label="Photo list"\] | e1024, l1280, l1440, x1920, x2560, x3840 | viewer.no-webgl | 24 |
| edge | control "Biserica Izvorul Tămăduirii An necunoscut" (hcm-map-viewer > hcm-photo-list > button) at 1545,1039 351x72 is cut off by "Lista fotografiilor 45 de fotografii Intersectie Fonterie..." (hcm-map-viewer > div.pane.trailing) at 1520,0 400x1080, which hides its overflow and does not scroll | e1024, l1280, l1440, x1920, x2560, x3840 | viewer.photo-list, viewer.photo-list (text spacing), viewer.timeline-step, viewer.timeline-step (text spacing) | 56 |
| edge | text "Uranus" (hcm-map-viewer > hcm-photo-list > span.title) at 3545,2140 255x24 is cut off by "Photo list 45 photos Intersectie Fonteriei cu Puțul cu ap..." (hcm-map-viewer > div.pane.trailing) at 3440,0 400x2160, which hides its overflow and does not scroll | e1024, l1280, x3840 | viewer.photo-list (text spacing), viewer.timeline-step, viewer.timeline-step (text spacing) | 12 |
| edge | text "An necunoscut" (hcm-map-viewer > hcm-photo-list > span.date) at 2265,1436 255x21 is cut off by "Lista fotografiilor 45 de fotografii Intersectie Fonterie..." (hcm-map-viewer > div.pane.trailing) at 2160,0 400x1440, which hides its overflow and does not scroll | e1024, l1280, x2560 | viewer.photo-list, viewer.photo-list (text spacing), viewer.timeline-step (text spacing) | 10 |
| edge | text "Ștrandul Operetă" (hcm-map-viewer > hcm-photo-list > span.title) at 769,767 215x24 is partly outside the 1024x768 viewport | e1024 | viewer.timeline-step | 2 |

### Mapbox GL controls (67 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| edge | control "Map" (hcm-map-viewer > canvas.mapboxgl-canvas) at 360,0 2200x1440 is cut off by "Historical map: Lost Bucharest" (hcm-map-viewer > div.map.mapboxgl-map) at 360,0 1800x1440, which hides its overflow and does not scroll | x2560, x3840 | viewer.poi | 7 |
| focus-ring | the focus ring of "Arată sau ascunde sursele hărții" (hcm-map-viewer > button.mapboxgl-ctrl-attrib-button) at 326,766 24x24 has 1.71:1 against its surroundings (3:1) | c320, c360, c412 | viewer.consent, viewer.home, viewer.language, viewer.locate-toast, viewer.menu-open, viewer.share-toast and 4 more | 60 |

### hcm-photo-sheet (60 violations, 5 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | landmark-no-duplicate-banner (moderate): hcm-map-viewer,hcm-photo-sheet,hcm-sheet\[detent="full"\],header | c320, c360, c412 | viewer.lightbox | 12 |
| axe | landmark-unique (moderate): hcm-map-viewer,hcm-photo-sheet,hcm-sheet\[detent="full"\],header | c320, c360, c412 | viewer.lightbox | 12 |
| axe | landmark-no-duplicate-banner (moderate): hcm-map-viewer,hcm-photo-sheet,hcm-sheet\[open=""\],header | c915l, m768 | viewer.lightbox | 8 |
| axe | landmark-unique (moderate): hcm-map-viewer,hcm-photo-sheet,hcm-sheet\[open=""\],header | c915l, m768 | viewer.lightbox | 8 |
| modal-escape | "Deschide fotografia mărită" (hcm-map-viewer > hcm-photo-sheet > button.image) at 579,56 312x291 is outside the open modal "Fotografie mărită" (hcm-map-viewer > hcm-lightbox > div.lightbox) at 0,0 915x363 yet not inert, not aria-hidden and in the Tab order | c320, c360, c412, c915l, m768 | viewer.lightbox | 20 |

### hcm-lightbox (48 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| clipped-text | "Ștrandul Operetă" (hcm-map-viewer > hcm-lightbox > p.title) at 16,8 146x24 cuts its text | c320 | viewer.lightbox (text spacing) | 4 |
| landmark | the navigation landmark (no name) (hcm-map-viewer > hcm-lightbox > nav.nav) at 0,307 915x56 has no name | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.lightbox | 44 |

### hcm-button (45 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| focus-obscured | the focused "Verifică din nou" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > hcm-button > button.interactive.touch-target) at 174,748 154x40 is hidden under other content (WCAG 2.4.11) | c360 | admin.mapbox-open | 1 |
| focus-ring | the focus ring of "Retry" (hcm-map-viewer > hcm-error-card > hcm-button > button.interactive.touch-target) at 40,490 95x40 has 2.38:1 against its surroundings (3:1) | c320, c360, c412, c915l, m768, e1024, l1280, l1440, x1920, x2560, x3840 | viewer.error-network, viewer.error-not-found | 44 |

### hcm-setup-step (27 violations, 6 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | target-size (serious): hcm-admin-shell,hcm-page-outlet,hcm-setup-page,hcm-setup-step\[data-step="claim"\],.header\[aria-controls="body"\] \| hcm-admin-shell,hcm-page-outlet,hcm-setup-page,hcm-setup-step\[data-step="mapbox"\],.header\[aria-controls="body"\] | c360 | admin.billing-no-account | 1 |
| axe | target-size (serious): hcm-admin-shell,hcm-page-outlet,hcm-setup-page,hcm-setup-step\[data-step="usgs"\],.header\[aria-controls="body"\] | c360 | admin.provision-partial | 1 |
| focus-obscured | the focused "Mapbox De făcut" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > button.header.interactive) at 16,728 328x56 is hidden under other content (WCAG 2.4.11) | c360 | admin.billing-no-account, admin.deploy-waiting, admin.provision-partial, admin.unknown-route | 5 |
| focus-obscured | the focused "Creează un cont Mapbox (se deschide într-o filă nouă)" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > a) at 32,739 176x48 is hidden under other content (WCAG 2.4.11) | c360 | admin.mapbox-open, admin.mapbox-trial | 3 |
| focus-order | Tab goes back up from "The old Bucharest photos Optional To do" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > button.header.interactive) at 256,675 360x88 to "Google Cloud billing accounts (opens in a new tab)" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > a) at 656,295 204x48 inside hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step | l1440 | admin.analytics, admin.billing-no-account, admin.mapbox-open, admin.mapbox-trial, admin.setup-billing, admin.unknown-route and 2 more | 16 |
| occlusion | "Conturile de facturare Google Cloud (se deschide într-o f..." (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > a) at 32,0 240x4 is covered: 2 of 5 sampled points (first at 80,3) hit "Leagă facturarea în consola Firebase (se deschide într-o ..." (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-step > a) at 32,4 250x48 | c360 | admin.billing-no-account | 1 |

### hcm-admin-shell (20 violations, 3 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | region (moderate): hcm-admin-shell,.banner | c360, m768, l1440 | admin.billing-no-account, admin.deploy-waiting, admin.provision-partial | 12 |
| axe | landmark-no-duplicate-banner (moderate): hcm-admin-shell,.top-bar | c360, m768, l1440 | admin.account-menu | 4 |
| axe | landmark-unique (moderate): hcm-admin-shell,.top-bar | c360, m768, l1440 | admin.account-menu | 4 |

### hcm-admin-nav (17 violations, 2 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| edge | text "Administratori" (hcm-admin-shell > hcm-admin-nav\[data-layout-check=nav\] > span.label) at -1,121 98x18 is partly outside the 768x1024 viewport | m768 | admin.account-menu (text spacing), admin.analytics (text spacing), admin.import-done (text spacing), admin.mapbox-open (text spacing), admin.mapbox-trial (text spacing), admin.setup-billing (text spacing) and 3 more | 9 |
| edge | control "Administratori" (hcm-admin-shell > hcm-admin-nav\[data-layout-check=nav\] > a.item) at -5,80 106x64 is partly outside the 768x1024 viewport | m768 | admin.analytics (text spacing), admin.import-done (text spacing), admin.mapbox-open (text spacing), admin.mapbox-trial (text spacing), admin.setup-billing (text spacing), admin.unknown-route (text spacing) and 2 more | 8 |

### admin page (12 violations, 1 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | landmark-one-main (moderate): html | c360, m768, l1440 | admin.blocked, admin.claim, admin.sign-in | 12 |

### hcm-sheet (12 violations, 1 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| modal-escape | "Resize the panel" (hcm-map-viewer > hcm-photo-sheet > hcm-sheet > button.handle.touch-target) at 182,76 48x24 is outside the open modal "Full-size photo" (hcm-map-viewer > hcm-lightbox > div.lightbox) at 0,0 412x866 yet not inert, not aria-hidden and in the Tab order | c320, c360, c412 | viewer.lightbox | 12 |

### hcm-setup-usgs (10 violations, 3 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| focus-obscured | the focused "Data expirării tokenului (opțional)" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-usgs > input#usgs-expires) at 32,752 296x48 is hidden under other content (WCAG 2.4.11) | c360 | admin.usgs-countdown, admin.usgs-pending | 2 |
| focus-order | Tab reaches "Token expiry date (optional)" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-usgs > input#usgs-expires) at 656,596 480x48 more than once in one round | l1440 | admin.usgs-countdown, admin.usgs-pending | 4 |
| focus-ring | "Token expiry date (optional)" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-usgs > input#usgs-expires) at 656,596 480x48 shows no focus indicator when Tab reaches it | l1440 | admin.usgs-countdown, admin.usgs-pending | 4 |

### hcm-account-menu (4 violations, 1 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | landmark-banner-is-top-level (moderate): hcm-admin-shell,hcm-account-menu,hcm-dialog,header | c360, m768, l1440 | admin.account-menu | 4 |

### hcm-snackbar (4 violations, 1 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| axe | region (moderate): hcm-admin-shell,hcm-snackbar,.message | c360, m768, l1440 | admin.unknown-route | 4 |

### hcm-poi-detail (2 violations, 1 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| occlusion | "Fișa locului" (hcm-map-viewer > hcm-photo-sheet > hcm-poi-detail > a) at 181,479 91x5 is covered: 2 of 5 sampled points (first at 199,482) hit (no name) (hcm-map-viewer > hcm-photo-sheet > hcm-sheet > div.actions) at 0,483 320x16 | c320 | viewer.poi (text spacing) | 2 |

### hcm-switch (1 violations, 1 distinct)

| Check | Example (names and numbers vary) | Viewports | States | Count |
| --- | --- | --- | --- | ---: |
| focus-obscured | the focused "Trimite-mi un e-mail la erori noi" (hcm-admin-shell > hcm-page-outlet > hcm-setup-page > hcm-setup-analytics > hcm-switch > button.touch-target) at 32,744 52x32 is hidden under other content (WCAG 2.4.11) | c360 | admin.analytics | 1 |

## Change requests

Kit changes one area needs from the other (the viewer agent owns `packages/ui/src/components/**`, the admin agent
`packages/ui/src/admin/**`). Status `open`, `done` or `rejected`.

| Id | From | Change | Status |
| --- | --- | --- | --- |
| LA-1 | viewer | `hcm-dialog`'s headline row is a `div.header`, no longer a `header`: inside the admin's top bar the account menu's dialog was a banner within a banner (`landmark-banner-is-top-level`). The same for `hcm-sheet` (a second banner under the lightbox). Selectors on `header` inside these components are gone. | done |
| LA-2 | viewer | `focusRing` takes `--hcm-focus-ring-color` (default secondary): a surface whose colour is close to secondary sets it for everything on it (the snackbar sets inverse primary, the viewer's error card on-error-container). The admin's fields and switches can use it the same way. | done |
| LA-3 | viewer | `hcm-sheet` hides its `actions` row while nothing is slotted there (its 16 px of padding sat over the end of the content). | done |
| LA-4 | viewer | `hcm-fab-menu`'s host takes no pointer: only the FAB and the items do (the open menu's box beside the FAB blocked what was under it). | done |
| LA-5 | viewer, for the admin | `static` fails on knip only: `axe-core` is an unlisted dependency of `packages/ui/test/admin/shell/shell-layout.test.ts` (the other kit tests import `@hcm/test-support/axe`). Done: the test uses the test kit's new `axeRuleViolations(context, rules)` (the named rules, best practices among them, on the whole document for the page-level ones). | done |
| LA-6 | admin | The kit's 48 × 48 touch targets are clipped: `stateLayer`'s `.interactive { overflow: hidden }` (specificity 0,1,0) beats `hcm-icon-button`'s `button { overflow: visible }` (0,0,1), so the `touchTarget` `::after` of `hcm-icon-button` and `hcm-button` (every `.interactive.touch-target`) is cut to the control's own box: measured in Chromium, a tap 2 px inside the corner of the 40 px round icon button's square hits the host, 2 px outside it hits what is behind, and 3 px below `hcm-button` misses it. The admin's account-button occlusion record at 1440 px was that corner (the top bar half scrolled away, now fixed by the app shell). Proposed: `overflow: visible` on `.interactive.touch-target` (the state layer's `::before` is round by `border-radius: inherit`), with a unit test that hit-tests the target's ring. The checker's `targetSizeOf` reads the pseudo-element's computed 48 px, so it should hit-test the ring too (the checker's owner). Done by the verify agent: `touchTarget` sets `overflow: visible` on `.interactive.touch-target` (`touch-target.test.ts`), and `targetSizeOf` hit-tests the ring (see *Addendum 2026-10-17: verify and visual audit*). | done |

## Addendum 2026-10-17: the viewer's fixes

The viewer agent fixed the viewer's findings in the product (layout, CSS, ARIA, focus), never in a check or the
allowlist (`SANCTIONED_STACKINGS` is unchanged: the open FAB menu stays the only one). Each fix has unit tests; the
lessons are `docs/LESSONS.md` #57 to #61.

| Finding | Fix | Pinned by |
| --- | --- | --- |
| The FAB on the timeline (0 px) and near the collapsed attribution (2 px) on phones; the timeline 2 to 7 px from Mapbox's logo and attribution; the chip on the timeline at 768 px | The viewer stacks its floating controls with named sizes and 8 px gaps: `--hcm-map-chrome` 42 px (the collapsed attribution, 24 px at 10 px from the edge, plus 8), `--hcm-timeline-block`, `--hcm-fab-size`, `--hcm-dock-gap`. The timeline is the 84 px its padding says: the browser's 1em margin of its `ol` had made it 100 px (more with a larger page font). | `kit-integration.test.ts` (phone, tablet, no timeline, the smallest phone's open menu), `hcm-timeline.test.ts` |
| The open menu's host over the timeline's thumb (768, 1024 px), and the thumb "hidden" under it | `hcm-fab-menu`'s host and the viewer's menu dock take no pointer; only the FAB and the items do (LA-4) | `fab-menu.test.ts`, `kit-integration.test.ts` |
| The toasts' dock over the vertical timeline (a phone held sideways) | The toast dock takes no pointer (the snackbar's surface does), and on a short phone the toast and consent docks end before the vertical timeline | `kit-integration.test.ts` |
| The docked photo list cannot scroll (1024 px and up), and with Tab the pane scrolled its title away (text spacing) | The photo list's wrapper is `display: contents`: the docked sheet fills the pane and its body scrolls | `hcm-map-viewer-layout.test.ts` |
| Under the lightbox the photo sheet stays usable, and its `header` is a second banner | The modal sheets are `inert` under the lightbox; the kit's sheet, dialog and the lightbox use a `div.header` (LA-1) | `hcm-map-viewer-layout.test.ts`, `sheet.test.ts`, `dialog.test.ts`, `hcm-lightbox.test.ts` |
| The lightbox's `nav` has no name; its title cut with text spacing at 320 px | `aria-label` `lightbox.navigation` (RO, EN); the title wraps | `hcm-lightbox.test.ts` |
| Focus rings: the toast's Close 1.62:1, Retry 2.38:1, the collapsed attribution 1.71:1 | `--hcm-focus-ring-color` (LA-2): inverse primary on the snackbar, on-error-container on the error card; Mapbox's attribution gets `light-dark()` of primary and inverse primary | `snackbar.test.ts`, `kit-integration.test.ts` |
| No `main`, no level-one heading on the city page; the timeline, toasts, menu, legal bar and the no-WebGL list outside landmarks | The city page's body is one `main` with a visually hidden `h1` (the site's title, `hcm-visually-hidden` of `engine.css`) around the mount point | `scripts/site/test/page.test.ts` |
| A POI link under the sheet's empty actions row (text spacing, 320 px) | `hcm-sheet` hides an empty actions row (LA-3) | `sheet.test.ts` |
| Mapbox's labels in the first language after a switch | `MapPort.setLocale` rewrites Mapbox's UI strings and the basemap's language (CR-22 of `docs/research/M1-interfaces.md`) | `S-V11-BAD-MAPBOX-LABELS`, `mapbox-adapter.test.ts`, `map-sync.test.ts` |
| The map's canvas wider than its box after a POI pane opened (2560, 3840 px; 1280 px on a busy machine) | The adapter resizes the map in the ResizeObserver's callback itself, not a frame later; the checker's `settleAnimations` waits two rendered frames after the animations stop (a checker fix: it probed before the browser had rendered the change) | `mapbox-adapter.test.ts` |

Verified on the laptop alone (no NUC), against a fresh `npm run build:site:e2e`: 17 of the 44 tour projects (all 11
viewports, both schemes and both languages among them) with the `smoke`, `a11y`, `nogl` and `fn` tiers, 717 passed and
6 failed. The 6 (`tour-x3840-dark-ro` timing out on "the map renders and becomes idle" at a load average of 75,
and the canvas on `tour-l1280-light-en`) passed in a rerun of the large viewports with the resize and frame fixes
(`tour-x3840-dark-ro`, `tour-x3840-light-en`, `tour-x2560-dark-en`, `tour-l1280-light-en`, `tour-e1024-light-en`: 56
passed). The admin's findings (the Setup page, the navigation, the admin's landmarks) are the admin agent's.

## Addendum 2026-10-17: the admin's fixes

The admin agent fixed the admin's findings in the product (`packages/ui/src/admin/`, `packages/admin/src/`), never in
a check or the allowlist. Each fix has unit tests; the lessons are `docs/LESSONS.md` #62 and #63; the layout change is
`DECISIONS-for-review.md` §33f.

| Finding | Fix | Pinned by |
| --- | --- | --- |
| At 360 px the focused Setup headers, links, Check again, the USGS date field and the e-mail switch under the fixed navigation bar; two Setup headers half under it (axe `target-size`); at 1440 px the account button half scrolled away with the top bar (`occlusion`) | An app shell: the frame is as tall as the window, the bar, the rail and the top app bar keep their own grid rows and only the page scrolls (`.scroller` in `<main>`), so nothing scrolls under them | `shell-layout.test.ts` (the last control of a tall page focused at 360 px lies above the bar and is hit at its centre; the top bar and the rail stay put at 700 px) |
| (found on the way) The unknown address's snackbar over the focused Setup header at 360 px, and the bar's More sheet covering only the bar | The snackbar is docked below the page in `<main>` (no room while empty, `::part(snackbar)` margins); the frame, not the bar, is the More sheet's positioned container | `shell-layout.test.ts` |
| No `main` on the sign-in, claim and blocked screens; the start-up banner and the snackbar outside landmarks | Every screen's content is in `<main>`: the panels, the loading indicator, the banner, the page and the snackbar | `shell-layout.test.ts` (axe `region`, `landmark-*` on the whole document, every screen) |
| The account menu's dialog a second banner inside the top bar | The kit's dialog row is a `div.header` (LA-1, the viewer agent) | `shell-layout.test.ts` (the open account menu) |
| "Administratori" leaving the 96 px rail at 768 px with text spacing | Rail labels wrap inside their item (`overflow-wrap: anywhere`, `max-inline-size: 100%`); a rail taller than the window scrolls, and a rail item's ring is drawn inside it | `shell-layout.test.ts` |
| The USGS expiry field without a ring on one of its Tab stops | On its calendar button the input matches only `:focus-within`: the fields' ring is `:focus-visible, :focus-within` | `hcm-setup-usgs.test.ts` |
| The Setup page's two columns at 1440 px "going back up"; the date field counted several times | Checker refinements of the first run (`orderViolations`, `distinctRuns`), confirmed: no record at 1440 px | the admin tier |
| The billing links' 4 px strip at the top edge at 360 px (`occlusion`, one record) | Not reproduced since the app shell (the strip was at the window's edge under a scrolled page) | the admin tier |

Also found and fixed: the Setup page sat with every card closed until the legacy import's detection (it reads every
photo) ended, then opened billing in the middle of a check; the controller now opens the step to resume at as soon as
`setup.status` answers (the detection decides only when the import is that step). The owner's smoke checks a settled
state: it waits for the open card and an enabled Check again, points at the snackbar to hold its 8 s timer, and locates
its message apart from the live region. Proposed to the kit: LA-6 (the touch targets of `.interactive` controls are
clipped to the control).

Verified in an isolated copy of the tree (another agent's builds rewrote `packages/admin/dist` under two earlier runs):
`E2E_TIER=admin` with `admin-c360-ro`, `admin-m768-ro`, `admin-l1440-ro`, `admin-l1440-en` and `admin-harness`, 22
passed in 5.1 min, every admin state of the inventory without a violation; `vitest --project ui` (646 passed) and
`--project admin` (608 passed) with every changed file at 100 % (the USGS card's branches 96.55 %).

## Addendum 2026-10-17: verify and visual audit

The verify agent resolved the last change request (LA-6), ran every tier with the full tour split between the laptop and
the NUC, and then looked at every state as a person would: each state the checkers visit, saved by
`HCM_STATE_SCREENSHOTS` (`e2e/support/state-shots.ts`) at 360 × 800, 412 × 915, 915 × 412, 768 × 1024, 1440 × 900 and
3840 × 2160 in light and dark (the viewer from its tour projects at those sizes in Romanian, the admin resized in place
at its l1440 project), in `reports/screenshots/layout-final/` with one contact sheet per state built by ImageMagick's
`montage` in `reports/screenshots/layout-final/sheets/`. Each defect the checkers had missed got a fix and a check that
now catches it; no check was relaxed and nothing was added to an allowlist.

| Found | By | Fix | The check that catches it now |
| --- | --- | --- | --- |
| Every kit button's 48 px touch target cut to the button (LA-6) | the admin agent's measurement | `touchTarget` sets `overflow: visible` on `.interactive.touch-target` | `targetSizeOf` hit-tests each side of the ring (`touch-target.test.ts`, `layout-probe.test.ts`) |
| The bottom sheet's 24 px drag handle: its ring rose past the sheet and was cut to 36 px (every phone) | the hit-tested target size | the handle is a 48 × 48 button at the sheet's top edge | target size, as above (`sheet.test.ts`) |
| A two-letter segment ("Nu") 46 px wide: its ring stuck out of a narrow container | `segmented-button.test.ts` once rings were visible | segments are at least 48 px wide | the unit test |
| The open menu's last item on the timeline's thumb at 768 px | the contact sheet of the open menu | at medium and up the items end 8 px above the timeline (`--hcm-fab-menu-gap`) | the open menu's sanction narrowed to the map's content and the two top docks (`SANCTIONED_STACKINGS`) |
| The theme choice past the account menu's edge at 360 px, and past About's at 320 px (54 px with text spacing): the dialogs scrolled sideways | the contact sheet of the account menu | `hcm-segmented-button` stacks its segments, one 48 px row each, while they do not fit | `sideways-scroll`: no box scrolls sideways inside the page |
| The drag handle's ring cut by the sheet's top edge; then the map canvas's ring cut away whole by Mapbox's box, and the full attribution's links' rings at its lower edge | the contact sheet of the full sheets, then the new check on every project | the handle's ring is round inside its box, the canvas's inset, the attribution's links take an offset-free ring in 3 px of padding | the Tab round reports a ring cut off by an ancestor that hides its overflow |
| The admin never checked in the dark scheme | the audit's coverage list | the project `admin-l1440-dark` | every admin state check, in dark |

Also fixed on the way: the admin smoke's ambiguous heading (in list and detail the billing step's name is two headings,
a race since the Setup controller opens the step at once; it now checks the list row's).

Looked at and left as they are: the error, loading and sign-in screens in the baseline purple (no city theme is known
before the manifest or the admin's settings load); the lightbox's photo at its natural size on a 3840 px screen (never
upscaled); a POI near a modal side sheet's edge at 768 and 915 px (the tour's fixed map view, not a layout); Mapbox's
logo, white with a grey outline, on the light legal bar (Mapbox's asset).

Verified with `PIPELINE_STAGE=all bash scripts/ci/e2e-split.sh` (the NUC took parts 1-2 of 3 of each Playwright run and
four of the six admin projects): `[SUCCESS] stage 'all' passed (reports/pipeline/green-all.json; Playwright split: 3/3
here, 1-2/3 on nuc, 1006 s)`, 1,049 tests passed, none failed (the `e2e` stage 662: the per-push tiers with the six
admin projects; `tour-matrix` 387: the other 35 tour projects), and no `layout-a11y-violations.jsonl` written: zero
layout or accessibility violations at all 44 tour projects and the six admin projects, against 3,407 records in the
first run above and 0 in the verify agent's baseline run before the stricter checks (the hit-tested targets then found
197 records on 41 tests, and the newer checks 183 lines on samples of about ten projects: 176 cut rings, 5 sideways
scrolls, 2 stacked rows' targets; all fixed as listed).

## Addendum 2026-10-18: the scroll sweep (follow-ups agent)

The checkers measured what is scrolled into view (lesson 84 of `docs/LESSONS.md`). Since 2026-10-18 `expectStateSound`
ends with the scroll sweep (`e2e/support/scroll-sweep.ts`): every box a visitor scrolls is scrolled through its content
three quarters of its height at a time, and the layout checker, the target sizes, the non-text contrast (page scheme and
high contrast) and axe's `color-contrast` run again at each position; only new violations are reported, and the test's
`scroll sweep` annotations name what each state swept. With it, a sliver of at most 5 px of a control at the edge of
what scrolls no longer counts as occluded (CR-M2c-29 c), as the sweep checks the control whole elsewhere.

What it found in its first runs (2026-10-18, laptop and NUC split): nothing new. The `e2e` stage (the per-push tiers and
the admin's states at its five projects) and the `tour-matrix` stage (the viewer's states at the other 35 viewports,
1044 swept positions: About's dialog content, the photo, place and layers sheets at every height, the photo list, the
error cards' status box) both passed. The two failures of the first `e2e` run were no sweep findings: a toast left from
the previous state that timed out mid-check (lesson 89) and the snackbar of the new revoked state (now held open, as the
skill says). The admin's states at every tour viewport (§34c of `DECISIONS-for-review.md`) will be swept by the same
call once the E2E agent adds them.
