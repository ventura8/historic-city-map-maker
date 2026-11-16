#!/usr/bin/env python3
"""Build-stage gate: the shipped bundles stay within their gzip budgets.

Every city page downloads the engine before it can show a map (the city pages load the ES module
build, a third-party embed may load the IIFE from jsDelivr), so their compressed size is a product
property, measured the way a CDN serves it (gzip, level 9). Mapbox GL is not part of it (it is
loaded from api.mapbox.com as the global `mapboxgl`, never bundled), which is exactly what a
sudden jump here would reveal.

The engine's ES module build has lazy chunks too (swipe compare, the consented Firebase SDK), and its IIFE build loads the
same code as extras beside it (`extra-<name>-<hash>.js`, DECISIONS-for-review.md §186): each has its own budget in
`ENGINE_CHUNK_BUDGETS`, and a chunk without one fails.

The admin is an ES module entry with lazy chunks (DECISIONS-for-review.md §34b): each editor area,
Terra Draw, the colour library and the analytics SDK are fetched when first needed. Its budget has
three parts:

- the entry: `admin.mjs` and every chunk it imports statically, which the browser loads before the
  admin shows anything (`ADMIN_ENTRY_KB`);
- every other chunk, by its name without the content hash, against its own budget
  (`ADMIN_CHUNK_BUDGETS`); a chunk without a budget fails, so a new chunk is a reviewed decision;
- everything together (`ADMIN_TOTAL_KB`), so many small chunks cannot grow unnoticed.

The in-app installer's bundle (M6, docs/research/M6-interfaces.md §1.3) is checked apart, with `--install`, once
`build:install` has written it into the Hosting tree (`dist/hosting/admin/install/<slug>/`): its four tarballs are gzip
already, so each is measured as it is served, against `INSTALL_BUDGETS` (KB).

`BUDGETS` holds the budget of each single-file bundle; `--budget FILE=KB` overrides or adds one for
a run. Raising a budget is a reviewed change to these tables, with the reason in the commit, never
a way to get a build green. A missing bundle is an error: the gate runs after `vite-build`.

Usage: check_bundle_budget.py [--root DIR] [--budget FILE=KB ...] [--install]. Exit status: 0 OK, 1 over
budget or missing, 2 usage.
"""

import argparse
import gzip
import re
import sys
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from cilog import get_logger
from cirepo import ROOT

LOG = get_logger("bundle-budget")

KB = 1000
GZIP_LEVEL = 9
# Bundle (repository-relative) -> gzip budget in KB: about 12 % above the M1 build (2026-10-12), so
# growth is a reviewed decision. Mapbox GL is external to both engine builds.
BUDGETS: Mapping[str, int] = {
    # Viewer engine, ES module: what the city pages load (Lit, the M3 kit, zod, the viewer), minified since
    # DECISIONS-for-review.md §17a (92.7 KB on 2026-10-12, 101.0 KB before). The Firebase SDK is its lazy
    # `firebase-sdk-<hash>.js` chunk, fetched only after consent.
    # 100 until 2026-11-12, raised to 120 by the owner for beta.1 (DECISIONS-for-review.md §168).
    "packages/engine/dist/engine.mjs": 120,
    # Viewer engine, IIFE: the same (no code splitting in IIFE builds, DECISIONS-for-review.md §13a; 112.0 KB in M1). It
    # inlined the lazy chunks (124.9 KB on 2026-11-12) until they became its extras (§186). 125 until 2026-11-12, raised to
    # 150 by the owner for beta.1 (§168).
    "packages/engine/dist/engine.iife.js": 150,
    # M14 (docs/research/M14-start-your-map.md): the start page, one module (Lit, zod, the `start.*` texts, the transport).
    # Apart from the admin's folder and its totals: 69.0 KB measured on 2026-11-07, a new row just above it; 60.4 KB since
    # 2026-11-12, when its city-id checks left the modules that import the Firestore schemas (docs/LESSONS.md 593).
    "dist/start-app/start.mjs": 72,
}

# The engine's build folder, its two entries (BUDGETS above) and its lazy chunks of the ES module build, each by its name
# without the content hash -> gzip budget in KB, the measurement plus about 20 %; a chunk without a budget fails, as the
# admin's do (a new chunk is a reviewed decision). The IIFE inlined them (DECISIONS-for-review.md §13a) until its extras (§186).
ENGINE_DIR = "packages/engine/dist"
ENGINE_ENTRIES = frozenset({"engine.mjs", "engine.iife.js"})
ENGINE_CHUNK_BUDGETS: Mapping[str, int] = {
    # Swipe compare (M4, docs/research/M4-interfaces.md §3.2): the second map's session and <hcm-compare>, 4.2 KB measured
    # on 2026-10-24, fetched the first time a visitor compares (the contract's ceiling: 12 KB; DECISIONS-for-review.md §55b).
    "compare": 5,
    # The gamepad (docs/research/viewer-input.md §3), fetched only once a pad connects: 1.6 KB on 2026-11-07.
    "gamepad": 2,
    # The side-loaded extras (the owner's "Load extras on demand", 2026-11-09; docs/ENGINE_API.md -> Side-loaded parts):
    # `engine.extras.js`, one IIFE beside both builds with its own integrity, added the first time a visitor opens a photo
    # full size, About or the map's menu; it reads Lit and the texts from the engine's kit. 5.3 KB on 2026-11-09; 7 until
    # 2026-11-12, raised to 12 by the owner for beta.1 (DECISIONS-for-review.md §168).
    "engine.extras.js": 12,
    # firebase/app and firebase/analytics, fetched only after the visitor's consent: 13.3 KB on 2026-10-24.
    "firebase-sdk": 16,
    # The field chunk (DECISIONS-for-review.md §76): Google's web-vitals (attribution build, 5.4 KB of it) and the event
    # guard of @hcm/shared, fetched with the Firebase SDK after the visitor's consent: 7.3 KB on 2026-10-31.
    "field-sdk": 9,
    # The IIFE's extras (DECISIONS-for-review.md §186), the same code as the four chunks above as classic scripts that the
    # IIFE loads with their integrity, each the measurement of 2026-11-12 plus about 20 %. Swipe compare carries its own copy
    # of the engine's map helpers it shares with the entry (6.4 KB); the field chunk takes the event guard from the IIFE
    # (5.5 KB); the gamepad 1.9 KB, the Firebase SDK 13.4 KB.
    "extra-compare": 8,
    "extra-gamepad": 3,
    "extra-firebase-sdk": 16,
    "extra-field-sdk": 7,
}

# The admin's build folder and its entry (packages/admin/vite.config.ts).
ADMIN_DIR = "packages/admin/dist"
ADMIN_ENTRY = "admin.mjs"
# The entry and its static imports (the shell, Setup, the Firebase SDK, Lit, the kit, the texts): the budget the IIFE
# had (450 KB), now for what loads before the admin shows (353.9 KB on 2026-10-18).
ADMIN_ENTRY_KB = 450
# Each lazy chunk by name -> gzip budget in KB: the measurement of 2026-10-18 plus about 20 % headroom, rounded up
# (DECISIONS-for-review.md §34b lists the measurement).
ADMIN_CHUNK_BUDGETS: Mapping[str, int] = {
    # The editor areas (packages/admin/src/pages/<area>.ts: the page's elements and the store's module).
    "photos": 25,
    "pois": 25,
    # 21 since 2026-11-13 (§222, under the owner's §215 raise): 20.2 KB after the 25 languages' merge.
    "settings": 22,  # §215 (the owner confirmed, 2026-11-14)
    "layers": 10,
    "history": 8,
    "admins": 6,
    "home": 5,
    # Home's Monthly costs (the owner, 2026-11-16; DECISIONS-for-review.md §237): `<hcm-home-costs>` and its
    # four live counters, fetched when Home opens; a new chunk, so Home kept its budget: 2.8 KB measured plus headroom.
    "costs": 4,
    # Home's Visitors card (§238): `<hcm-home-visitors>` only, its numbers the Statistics page's last read; a new chunk.
    "visitors": 3,
    # Home's Visitors card's two reports (§238), read with the Statistics view's numbers; a new chunk, so `analytics-data` kept its budget.
    "analytics-summary": 2,
    "jobs": 5,
    # 6 since 2026-11-14 (§215b, M28): 5.0 KB after the merge, the setup page's elements it shares now beside it.
    "crashes": 6,
    # M3 (docs/research/M3-interfaces.md §10.1, DECISIONS-for-review.md §47): the Imagery area (15.2 KB measured on
    # 2026-10-23), the georeferencer (14.0 KB) and the layer editor's Crop (`layer-geometry`, 1.9 KB), each the measurement
    # plus about 20 %, under the contract's ceilings of 30, 30 and 8 KB.
    # 20 since 2026-11-13 (§215, the owner's raise for beta.1): 18.0 KB measured.
    "imagery": 20,
    # The georeferencer: 17 until 2026-11-08, 18 until 2026-11-10, 19 since, the owner's decisions (DECISIONS-for-review.md §110 and
    # §141): M15's terrain map and the merge of the accuracy track into M16 measured 17,160 bytes gzip; the zoom buttons, Undo, the
    # placing guide and the map's pair numbers (2026-11-10) took it to about 18,030, with Snap my points and the published maps
    # already in the lazy `georef-extras` chunk.
    "georef": 19,
    # Shared badge painters + map canvas overlay (DECISIONS-for-review.md §146): 1.9 KB measured, out of `georef` (stays 19); with the
    # pairs' leaf helpers and full screen's cover moved in for the linked views (§156), 2.7 KB measured on 2026-11-12. No row rose.
    "georef-badges": 3,
    # The georeferencer's panes and the beta.1 requests beside them (2026-11-12; DECISIONS-for-review.md §172, §173): the panes'
    # template with The map shows and Delete pair N, the scan pane's gestures and its tiles' holder, removing a pair with Undo and the
    # published layers the map pane shows (`GEOREF_PANE_MODULES` of `packages/admin/vite.config.ts`). It loads with the page, like
    # `georef-badges`: `georef` was at 19.9 KB with them (budget 19) and stays 19.
    # 4.2 KB measured on 2026-11-12 with the turning and the scan pane's drawing (out of `georef-badges`), plus about 20 %, rounded up.
    "georef-panes": 6,
    "layer-geometry": 3,
    # M20 §19.11: the tile-import wizard's route `#/help/<versionId>/tiles` (`packages/admin/src/tiles/`), its own lazy chunk:
    # 11.6 KB measured on 2026-11-13 when track/tilewizard merged, plus about 15 %, rounded up (DECISIONS-for-review.md §183).
    "help": 14,
    # M4's order card (`packages/ui/src/admin/imagery/orders/lazy-card.ts`), fetched the first time a scene that must be
    # bought opens, so the Imagery area stays within its budget with the buy flow: 1.7 KB measured on 2026-10-24 plus about
    # 20 % (DECISIONS-for-review.md §56b).
    "order-card": 2,
    # A scene's page's own parts (`packages/ui/src/admin/imagery/scene-unusable.ts`; the owner's report of 2026-11-13,
    # DECISIONS-for-review.md §201g): its preview, what USGS says of it, why Import is not offered, Not useful and the cloudy
    # warning, fetched when a scene's page opens. Imagery was at 18.03 KB on origin and 18.38 KB with Not useful; with these
    # out it measured 17.94 KB, and this chunk 1.61 KB, on 2026-11-13; the chunk imports no module of the Imagery chunk,
    # which would put that module in `editor-shared` (12.98 KB, as on origin).
    "scene-unusable": 2,
    # What two or more areas share and the entry does not (the codeSplitting group `editor-shared`).
    "editor-shared": 13,
    # The editors' words for a field and its problem (the group `editor-texts`: `field-names.ts`, `issue-text.ts`), out of
    # `editor-shared` when the required fields' own words took it to 13.3 KB: 1.0 KB measured on 2026-11-01 plus about
    # 20 %, rounded up (DECISIONS-for-review.md §77e).
    "editor-texts": 2,
    # The starter place categories (the group `starter-categories`: their data, the writes and Settings' Add the starter
    # categories), which the place editor and the settings share since finding 41; out of `editor-shared` (13.3 KB with
    # them) and the settings chunk (20.0 KB): 1.1 KB measured on 2026-11-01 plus about 20 %, rounded up
    # (DECISIONS-for-review.md §78d).
    "starter-categories": 2,
    # The admin map's box and the content it draws (the group `admin-map`): 7.4 KB measured on 2026-10-18, when the
    # settings page's map made the places' and photos' map modules shared (DECISIONS-for-review.md §42a).
    "admin-map": 9,
    # Terra Draw and its Mapbox GL adapter (the group `terra-draw`), on the first drawing tools: 47.4 KB with 1.37.0 on
    # 2026-10-18, 47.7 KB with 1.38.0 on 2026-10-24 (DECISIONS-for-review.md §53a), so the budget stays; 35.7 KB on
    # 2026-11-08 with only the modes the admin builds (§100b).
    "terra-draw": 58,
    # @material/material-color-utilities (`@hcm/ui/dynamic-color`), for the city's theme.
    "dynamic-color": 24,
    # Firebase Analytics, only after consent.
    "analytics-sdk": 8,
    # The field chunk (DECISIONS-for-review.md §76): web-vitals and the admin's event guard, with Analytics after
    # consent: 7.6 KB on 2026-10-31.
    "field-sdk": 9,
    # M4 (docs/research/M4-interfaces.md §5.4, §5.5; DECISIONS-for-review.md §54b), each the measurement of 2026-10-24 plus
    # about 20 %: the inbox (3.4 KB), Firebase Messaging, fetched when an admin turns notifications on for a browser
    # (5.6 KB), and the Firebase Installations SDK that it and Analytics share (2.9 KB, the codeSplitting group
    # `firebase-installations`).
    "inbox": 5,
    "messaging-sdk": 7,
    "firebase-installations": 4,
    # The editors' assists (the group `assist`: the title suggestions and translation drafts the photo, place and layer
    # editors share, 2.2 KB), and the admin's web push service worker, which the admin page build writes beside the
    # chunks (`scripts/site/src/admin/service-worker.ts`, 0.7 KB).
    "assist": 3,
    "firebase-messaging-sw.js": 1,
    # M5's Export the city card (`packages/ui/src/admin/export/export-card.ts`), fetched the first time its Settings section
    # opens: 1.7 KB measured on 2026-10-25 plus about 20 % (docs/research/M5-interfaces.md §5.6; DECISIONS-for-review.md §60e).
    "export-card": 2,
    # M5's New city page (`packages/admin/src/pages/cities.ts`: the flow's store, its map and `<hcm-new-city-page>`, 4.6 KB)
    # and the city's budget card in Settings (`packages/ui/src/admin/cities/city-budget.ts`, 1.0 KB, fetched the first time
    # its section opens), measured on 2026-10-25 plus about 20 % (docs/research/M5-interfaces.md §1.6, §1.8;
    # DECISIONS-for-review.md §62c).
    "cities": 6,
    # M13 (docs/research/M13-roles.md §8): the review queue and the Contribute page: 4.1 and 3.4 KB measured on 2026-11-07 plus
    # about 20 %, rounded up; the total stays under ADMIN_TOTAL_KB.
    "review": 5,
    "contribute": 5,
    # The value fields both of those share (M13 §4; the group `proposal-fields`), out of `editor-shared` (13.2 KB with them), which no
    # editor needs them from: 0.5 KB measured on 2026-11-07, rounded up (DECISIONS-for-review.md §97h).
    "proposal-fields": 1,
    "city-budget": 2,
    # Settings -> Browser tab icon (track/favicon, DECISIONS-for-review.md §165l): the card and the browser's checks of a
    # chosen file, fetched the first time its section opens, so the settings chunk stays within its 20 KB (19.8 KB with the
    # card's state): 1.3 KB measured on 2026-11-08 plus about 20 %, rounded up.
    "icon-section": 2,
    # Step (g)'s Create the measurement reports (`packages/admin/src/google/analytics-reports.ts`: the GA4 property found
    # from the measurement id and the field measurements' custom definitions), fetched on its button's click only: 0.8 KB
    # measured on 2026-11-01 plus about 20 %, rounded up (DECISIONS-for-review.md §76f).
    "analytics-reports": 1,
    # The Statistics view's numbers (`packages/admin/src/google/analytics-data.ts`: the GA4 Data API's three batches and
    # their reading), fetched on Show the numbers here only (DECISIONS-for-review.md §203): about 1.2 KB, rounded up.
    "analytics-data": 2,
    # The Statistics view's live sections (`packages/ui/src/admin/crashes/statistics-live.ts`: the numbers, the apps, the funnels
    # and the period's error groups), fetched the first time the view shows, so the crashes chunk stays within its 5 KB
    # (DECISIONS-for-review.md §203): 3.2 KB measured on 2026-11-13 plus about 20 %, rounded up.
    # 6 since 2026-11-13 (§215, the owner's raise): the Material 3 cards and charts took it to 4.6 KB; plus about 20 %.
    "statistics-live": 6,
    # M7's `worker` chunk (docs/research/M7-local-worker.md §7: `packages/admin/src/worker/worker.ts`, its one dynamic entry,
    # which the Jobs store imports): the local worker's feed, `<hcm-worker-panel>`, `<hcm-run-place>` and their texts
    # (`@hcm/shared/admin-worker`), 5.5 KB measured on 2026-11-02 plus about 20 %, rounded up; 5.7 KB since finding 72
    # moved the command into `worker-local`.
    # 8 since 2026-11-13 (§215, the owner's raise): 7.3 KB with W5's computers list.
    # 9 since 2026-11-13 (§222, under §215): 8.7 KB after the merge of the stitched films' wait (§217).
    "worker": 10,  # §215 (the owner confirmed, 2026-11-14)
    # Finding 72 of 2026-11-02 ("Use this computer": `packages/admin/src/worker/worker-local.ts`, the feed's one dynamic
    # import): the starter file, the auto-pair, Stop using this computer, the command behind Advanced, `<hcm-worker-local>`
    # and its texts (`@hcm/shared/admin-worker-local`), fetched when the worker's panel first shows the computer's part:
    # 4.3 KB measured on 2026-11-02 plus about 20 %, rounded up (DECISIONS-for-review.md §86). 10 since 2026-11-13 (§168e, the
    # owner's "raise the limits" for beta.1): the machine's profile and the starter's self-update card (`hcm-worker-versions`)
    # took it to 8.7 KB, of which the two languages' texts are 3.9 KB; every part is shown with the computer's panel, so
    # nothing was left to split: the measurement plus about 15 %, rounded up.
    "worker-local": 10,
    # W5, household computers (`packages/admin/src/worker/worker-household.ts`, the feed's other dynamic import, DECISIONS-for-review.md
    # §216): the city's computers, Add another computer and Remove this computer, `<hcm-worker-household>` and its texts
    # (`@hcm/shared/admin-worker-household`), fetched with the computer's part; a new chunk, so nothing else grew: 7.4 KB measured
    # on 2026-11-13 (the two languages' texts about 2.5 KB) plus about 20 %, rounded up.
    "worker-household": 9,
    # M8 (docs/research/M8-join-interfaces.md §6): the join's screens (`packages/ui/src/admin/imagery/join/join-card.ts`), fetched
    # when the city has a plan of its dates or a join opens, 2.4 KB measured on 2026-11-06 plus about 20 %, rounded up; and the
    # Upload view (`packages/ui/src/admin/imagery/upload-panel.ts`), out of the Imagery chunk to make room for the plan's feed
    # and Join frames, fetched when its tab first opens, 1.2 KB measured then. The total did not rise: the line breaks left in
    # the `css` and `html` templates went (6.4 KB, `scripts/site/src/css-literals.ts`). 4 since 2026-11-13 (the owner's "raise the
    # limits you need to raise" for beta.1): the join card reached 3.0 KB with the cloud estimate and the plain messages.
    "join-card": 4,
    "upload-panel": 2,
    # M28 (docs/research/M28-sources.md §5, §10-§11; DECISIONS-for-review.md §215b): Setup's Platform and Sources cards with
    # their catalogue (`@hcm/shared/admin-sources`: the sources, the collections, free translation and the country finder in
    # two languages), fetched as the setup page is defined, so the entry stays within ADMIN_ENTRY_KB. Set from the first
    # measurement plus about 20 %, rounded up: 34.7 KB measured on 2026-11-14.
    "sources-cards": 42,
    # M12 (docs/research/M12-own-tiles.md, DECISIONS-for-review.md §96): a version's whole page, out of the Imagery chunk, which was at
    # 18.0 of 18 and is at 16.2 with the own tiles' map and Work's pictures in it: 3.5 KB measured on 2026-11-07 plus about 20 %, rounded
    # up. Mapbox's compute units, Studio steps and choices (`mapbox-choices.ts`), which a city on its own bucket, the default, never
    # fetches: 1.3 KB measured then. The total stays within its 650 KB and no row rose.
    # 6 since 2026-11-13 (§222, under §215): just over 5.0 KB after the merge of origin's changes.
    "approval-map": 6,
    # M17 (docs/research/M17-stories.md §6): the stories area (`packages/admin/src/pages/stories.ts`: the store, `<hcm-stories-page>`),
    # fetched when its route first opens; its texts are the admin's catalogues in the entry. 4.3 KB measured on 2026-11-08 plus about 20 %,
    # rounded up; the total stays within its 650 KB (DECISIONS-for-review.md §102a).
    "stories": 5,
    "mapbox-choices": 2,
    # M16 (docs/research/M16-recalibrate.md §7): a version's Calibrate again block and a recalibration's figures, fetched only on a page
    # that offers or shows them: 0.8 KB measured on 2026-11-08 plus about 20 %, rounded up. No row rose.
    "recalibrate-card": 2,
    # The georeferencer's lazy chunk (`packages/admin/src/georef/georef-extras.ts`, fetched by `extras.ts`): the map a camera's lattice
    # or a frame over terrain publishes (M15) and Snap my points (M16), out of the `georef` chunk (18 KB since §110): 1.0 KB measured
    # on 2026-11-08 plus about 20 %, rounded up (DECISIONS-for-review.md §110); with the linked views' arithmetic (§156) 1.5 KB.
    "georef-extras": 2,
    # The georeferencer's context menu (2026-11-12; DECISIONS-for-review.md §152): `<hcm-georef-menu>` and the gestures that open it
    # (`packages/ui/src/admin/georef/georef-menu.ts` with `georef-menu-host.ts`), fetched at the page's first render, out of the `georef`
    # chunk (19 KB): 2.4 KB measured on 2026-11-12 plus about 20 %, rounded up.
    "georef-menu": 3,
    # The georeferencer's warped preview (2026-11-12; DECISIONS-for-review.md, *The georeferencer's ghost and sharper scan*): the mesh
    # and triangles (`packages/admin/src/georef/georef-warp.ts` over `warp.ts`, with `@hcm/shared`'s `previewMesh`, `scanBounds` and
    # `triangleTransform`), fetched when a version opens, out of the `georef` chunk (19 KB, which the ghost and the sharper scan had
    # taken to 19.5 KB; 18.2 KB after): 0.9 KB measured on 2026-11-12 plus about 20 %, rounded up.
    "georef-warp": 2,
    # The sharper scan's tiles (2026-11-12; DECISIONS-for-review.md §172): the reader of `scan-tiles.bin`, the tiles in view and the cache
    # of decoded ones (`packages/ui/src/admin/georef/scan-tiles.ts`), fetched when a version's sharper scan first arrives (the pane zoomed
    # past the preview), out of the `georef` chunk: 1.2 KB measured on 2026-11-12 plus about 20 %, rounded up.
    "scan-tiles": 2,
    # The tolerant reads of an older release's records (`packages/shared/src/schemas/legacy-reads.ts`), which Home, the Imagery lists
    # and a version's page share: out of `editor-shared` (13.05 KB with them, budget 13): 0.5 KB measured on 2026-11-12, a row of
    # 1 KB, the smallest whole budget (DECISIONS-for-review.md §155).
    "legacy-reads": 1,
    # M20 (docs/research/M20-import-local.md §8): Import local files (`packages/admin/src/archive/archive.ts`, its one dynamic entry,
    # which the Imagery store imports): the archive's feed, `<hcm-archive-panel>`, `<hcm-archive-report>` and their texts
    # (`@hcm/shared/admin-archive`), fetched when the Upload view or an archive's report first shows: 8.6 KB measured on 2026-11-09
    # plus about 16 % (DECISIONS-for-review.md §136d).
    "archive": 10,
    # Batch 4 (the owner, 2026-11-09: Import local files from the admin's own tab): the client that streams the picked files to the
    # worker on the computer's loopback (`packages/admin/src/archive/local-run.ts`, the archive feed's one dynamic import), fetched on
    # the first pick: about 1.2 KB, out of the `archive` chunk so that its 10 KB stays (DECISIONS-for-review.md §138d).
    "local-run": 2,
    # The wizard funnels (the owner, 2026-11-13; DECISIONS-for-review.md §200): each wizard page's snapshot and the shared
    # `trackFunnel`, out of `archive`, `imagery`, `worker` and `editor-shared`, which each went 0.1 KB over with them: about
    # 1.5 KB, a row of 2 KB.
    # 3 since 2026-11-13 (§215, the owner's raise): 2.8 KB measured.
    "funnels": 3,
}
# The entry and every chunk together. 620 until M7 (2026-11-02), 630 since: the total counts every lazy chunk, also those
# loaded only on use, and M7's `worker` chunk (5.5 KB, loaded only by the Jobs page, the pipeline card and a version page)
# with the entry's share of M7 (the job's place and wait, the install's image record, Provision's public pull) took it to
# 627.8 KB; with the worker's five callables' schemas out of the admin (`ADMIN_CALLABLES`, 0.6 KB) it is 627.2 KB. The
# entry stays well under its own 450 KB (DECISIONS-for-review.md §83). Finding 72 (2026-11-02) added `worker-local`
# within it, by two savings instead of a raise: zod's JSON Schema conversion out of the admin (a stand-in, 5.7 KB) and the
# source maps' comment lines (1.1 KB): 626.6 KB (§86). 650 since 2026-11-07, the owner's decision (§94): the total had become a
# hunt for bytes while the entry, what an admin waits for, stayed far under its own budget.
# 700 since 2026-11-08, the owner's decision (§105): the merge of stories, recalibration and the improvements reached
# 653.8 KB with no saving left that was worth its risk, and the 16 languages come next; the entry's 450 KB still caps what
# an admin waits for.
# 750 since 2026-11-12, the owner's decision (§168d): the georeferencer's panes and its sharper scan's tiles (`georef-panes`,
# `scan-tiles`) took the total to 701.8 KB; both load only with the georeferencer, and the entry's 450 KB is unchanged.
# 770 since 2026-11-13 (§222, under the owner's §215 raise): 764.6 KB with the device accent (about 1.5 KB) and the merge.
# 820 since 2026-11-14 (§215b, M28): 805.7 KB with the Platform and Sources cards, free translation and the country finder
# (their own `sources-cards` chunk, 34.7 KB, most of it the catalogue's texts in two languages) and the merge of origin.
ADMIN_TOTAL_KB = 820

# M6: the install bundle's folder in the deployed Hosting tree, and each tarball's budget in KB as served (it is gzip
# already): the contract's ceilings (docs/research/M6-interfaces.md §1.3; DECISIONS-for-review.md §71). Since §73k
# (2026-11-01) the legacy originals (45 MB) travel in `legacy.tgz`, so `hosting.tgz` (4.5 MB measured then) went from
# 80000 to 12000 and `legacy.tgz` has its own row: the stricter, pre-approved kind.
INSTALL_DIR = "dist/hosting/admin/install"
INSTALL_BUDGETS: Mapping[str, int] = {
    "server.tgz": 8000,
    "pipeline.tgz": 1000,
    "hosting.tgz": 12000,
    "legacy.tgz": 60000,
}

# A chunk's file name: its name, a dash and the content hash (Rolldown's `[name]-[hash].js`).
CHUNK_NAME = re.compile(r"^(?P<name>.+)-[\w-]{8}\.js$")
# A static import or re-export of a sibling chunk (`import{…}from"./x.js"`, `import"./x.js"`); `import("…")` is lazy.
STATIC_IMPORT = re.compile(r"""(?:\bfrom|\bimport)\s*["']\./(?P<file>[\w.-]+\.m?js)["']""")


def gzip_size(data: bytes) -> int:
    """Bytes after gzip at the CDN's level; `mtime=0` keeps the figure reproducible."""
    return len(gzip.compress(data, compresslevel=GZIP_LEVEL, mtime=0))


def budget_arg(text: str) -> tuple[str, int]:
    """An argparse type: `FILE=KB` with a positive whole number of KB."""
    name, separator, value = text.rpartition("=")
    if not separator or not name or not value.isdigit() or int(value) == 0:
        raise argparse.ArgumentTypeError(f"expected FILE=KB with a positive whole number of KB, got {text!r}")
    return name, int(value)


def report_line(name: str, size: int, budget: int) -> str:
    return f"{name}: {size / KB:.1f} KB gzip (budget {budget} KB)"


def check(root: Path, budgets: Mapping[str, int]) -> tuple[list[str], list[str]]:
    """(problems, one report line per bundle)."""
    problems: list[str] = []
    lines: list[str] = []
    for name, budget in sorted(budgets.items()):
        path = root / name
        if not path.is_file():
            problems.append(f"{name}: missing (run the build stage first)")
            continue
        size = gzip_size(path.read_bytes())
        line = report_line(name, size, budget)
        lines.append(line)
        if size > budget * KB:
            problems.append(line)
    return problems, lines


def chunk_name(file: str) -> str:
    """`photos-Ab3_x9Yz.js` -> `photos`; a file without a hash keeps its own name."""
    match = CHUNK_NAME.match(file)
    return match.group("name") if match else file


def entry_files(folder: Path, entry: str) -> list[str]:
    """The entry and every chunk it imports statically, transitively, in the order found."""
    found = [entry]
    for file in found:
        path = folder / file
        text = path.read_text(encoding="utf-8", errors="replace") if path.is_file() else ""
        found.extend(match["file"] for match in STATIC_IMPORT.finditer(text) if match["file"] not in found)
    return found


@dataclass(frozen=True)
class AdminBudgets:
    entry_kb: int
    chunks: Mapping[str, int]
    total_kb: int


ADMIN_BUDGETS = AdminBudgets(ADMIN_ENTRY_KB, ADMIN_CHUNK_BUDGETS, ADMIN_TOTAL_KB)


def within(line: str, size: int, budget: int) -> list[str]:
    """[line] when `size` is over `budget` KB, else []."""
    return [line] if size > budget * KB else []


@dataclass(frozen=True)
class ChunkTable:
    """Where a build's lazy chunks are and the table that budgets them (its name for the message)."""

    folder: str
    name: str
    budgets: Mapping[str, int]


def chunk_report(file: str, size: int, table: ChunkTable) -> tuple[list[str], str]:
    """(problems, the report line) of one lazy chunk."""
    name = chunk_name(file)
    budget = table.budgets.get(name)
    if budget is None:
        line = f"{table.folder}/{file}: {size / KB:.1f} KB gzip, a chunk without a budget (add `{name}` to {table.name})"
        return [line], line
    line = report_line(f"{table.folder}/{file}", size, budget)
    return within(line, size, budget), line


def check_engine_chunks(root: Path, budgets: Mapping[str, int] = ENGINE_CHUNK_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of every lazy chunk of the engine's ES module build (its entries are in BUDGETS)."""
    table = ChunkTable(ENGINE_DIR, "ENGINE_CHUNK_BUDGETS", budgets)
    problems: list[str] = []
    lines: list[str] = []
    for path in sorted((root / ENGINE_DIR).glob("*.js")):
        if path.name not in ENGINE_ENTRIES:
            chunk_problems, line = chunk_report(path.name, gzip_size(path.read_bytes()), table)
            problems += chunk_problems
            lines.append(line)
    return problems, lines


def admin_sizes(folder: Path) -> dict[str, int]:
    """The gzip size of every script of the admin's build, by file name."""
    return {path.name: gzip_size(path.read_bytes()) for path in sorted([*folder.glob("*.js"), *folder.glob("*.mjs")])}


def entry_report(entry: Sequence[str], sizes: Mapping[str, int], budget: int) -> tuple[list[str], list[str]]:
    """(problems, [the report line]) of the entry and the chunks it imports statically."""
    size = sum(sizes[file] for file in entry)
    line = report_line(f"{ADMIN_DIR}/{ADMIN_ENTRY} with {len(entry) - 1} static chunk(s)", size, budget)
    return within(line, size, budget), [line]


def check_admin(root: Path, budgets: AdminBudgets = ADMIN_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of the admin's entry, each lazy chunk and the whole."""
    folder = root / ADMIN_DIR
    if not (folder / ADMIN_ENTRY).is_file():
        return [f"{ADMIN_DIR}/{ADMIN_ENTRY}: missing (run the build stage first)"], []
    sizes = admin_sizes(folder)
    entry = [file for file in entry_files(folder, ADMIN_ENTRY) if file in sizes]
    problems, lines = entry_report(entry, sizes, budgets.entry_kb)
    table = ChunkTable(ADMIN_DIR, "ADMIN_CHUNK_BUDGETS", budgets.chunks)
    for file in sorted(set(sizes) - set(entry)):
        chunk_problems, line = chunk_report(file, sizes[file], table)
        problems += chunk_problems
        lines.append(line)
    total = sum(sizes.values())
    lines.append(report_line(f"{ADMIN_DIR} in all", total, budgets.total_kb))
    return problems + within(lines[-1], total, budgets.total_kb), lines


def install_report(folder: Path, budgets: Mapping[str, int]) -> tuple[list[str], list[str]]:
    """(problems, report lines) of one release's install bundle folder."""
    problems: list[str] = []
    lines: list[str] = []
    for name, budget in sorted(budgets.items()):
        path = folder / name
        label = f"{INSTALL_DIR}/{folder.name}/{name}"
        if not path.is_file():
            problems.append(f"{label}: missing (run build:install first)")
            continue
        size = path.stat().st_size
        line = f"{label}: {size / KB:.1f} KB as served (budget {budget} KB)"
        lines.append(line)
        problems += within(line, size, budget)
    return problems, lines


def check_install(root: Path, budgets: Mapping[str, int] = INSTALL_BUDGETS) -> tuple[list[str], list[str]]:
    """(problems, report lines) of every release folder of the install bundle (none is a problem)."""
    folders = sorted(path for path in (root / INSTALL_DIR).glob("*") if path.is_dir())
    if not folders:
        return [f"{INSTALL_DIR}: no install bundle (run build:install first)"], []
    problems: list[str] = []
    lines: list[str] = []
    for folder in folders:
        more_problems, more_lines = install_report(folder, budgets)
        problems += more_problems
        lines += more_lines
    return problems, lines


def report(problems: list[str], lines: list[str]) -> int:
    """Logs the verdict: 1 with the problems, else 0 with every line."""
    if problems:
        LOG.error("[bundle-budget] FAILED:\n%s", "\n".join(f"  - {problem}" for problem in problems))
        return 1
    LOG.info("[bundle-budget] OK:\n%s", "\n".join(f"  {line}" for line in lines))
    return 0


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check the gzip size of the shipped bundles against their budgets.")
    parser.add_argument("--root", type=Path, default=ROOT, help="repository root (default: this checkout)")
    parser.add_argument("--budget", action="append", type=budget_arg, default=[], metavar="FILE=KB", help="override or add a budget")
    parser.add_argument("--install", action="store_true", help="check only the in-app installer's bundle (after build:install)")
    args = parser.parse_args(argv)
    if args.install:
        return report(*check_install(args.root))
    problems, lines = check(args.root, {**BUDGETS, **dict(args.budget)})
    for more_problems, more_lines in (check_engine_chunks(args.root), check_admin(args.root)):
        problems += more_problems
        lines += more_lines
    return report(problems, lines)


if __name__ == "__main__":
    sys.exit(main())
