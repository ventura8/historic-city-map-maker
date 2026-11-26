# M5 status: many cities, engine releases, the starter kit, self-hosting and the static export

Written on 2026-10-25 by the M5 integrator (the release workstream's last role, `M5-interfaces.md` §6.3 step 4), after
the four M5 workstreams (multi-city, release, kit-cli, export) reported. It records the state of branch
`feat/engine-rewrite` as the pipeline left it. Nothing in M5 was committed, pushed, tagged, published or deployed, and no
test called a real Google, Mapbox, USGS, STAC, Nominatim, Vertex AI, OpenStreetMap, npm or jsDelivr endpoint:
everything below that says "works" was proved against the Firebase emulators (project `demo-hcm`), the shared fakes of
`@hcm/test-support`, the e2e mock servers (jsDelivr among them) and fake command-line tools on `PATH`. The integrator's
first run was cut off by a tooling outage after one split run had started rebuilding the second machine's image with
downloads and was stopped (§4); the second run finished it, with the split `quality` built from cache on both machines.
The contract and every change request: [M5-interfaces.md](M5-interfaces.md); the decisions:
[DECISIONS-for-review.md](DECISIONS-for-review.md) §58–§65; the lessons: `docs/LESSONS.md` 219–258.

**Updated the same day by the fixer** after the two M5 reviews (security and supply chain: nine findings; minimum
input, UX and correctness: seventeen): every finding is applied with its tests and a lesson, or answered in
`DECISIONS-for-review.md` §65 with why not (§65i, §65m–§65o); §1 holds the fixer's `all` run, §2 and §3 what changed.

## 1. The verdicts

The fixer's run, 2026-10-25, after both reviews' fixes, on the final tree of `feat/engine-rewrite` (uncommitted, on
`90b31be`), every gate in the quality image, the split with the NUC, whose image built from cache with no download:

- `bash scripts/ci/e2e-split.sh` (stage `all`): `[SUCCESS] stage 'all' passed (reports/pipeline/green-all.json;
  Playwright split: 3/3 here, 1-2/3 on nuc, 5799 s)`, every gate green:
  - `static`: 52 gates, the four audits included (§64);
  - `tests`: 544 Vitest files (7657 tests), 789 pytest and 400 pipeline tests; `[SUCCESS] rules coverage: every
    expression of firebase/firestore.rules evaluated, every condition allowed and denied`; `[coverage] OK: 994 files
    measured at >= 90.00% per file (overall 99.36%, branches 98.38%)`;
  - `e2e`: 1435 Playwright tests, none failed (374 here, 1061 on the NUC); `tour-matrix`: 1401, none failed (467 here,
    934 on the NUC), the Setup journey at its three `-journey` projects among them;
  - `build`: the bundle budgets below, the self-host bundle and the sites; `sonar`: skipped as designed without
    `SONAR_TOKEN` (CI runs it).
- The bundle budgets (gzip, KB, of the budget): the engine 117.2/125 (IIFE), 97.7/100 (ESM), `compare` 4.6/5,
  `firebase-sdk` 13.3/16; the admin entry 343.0/450 and in all **579.9/620** (it was 622.6 before the `re2js` stand-in,
  §65k); the chunks nearest their budget: `cities` 5.8/6, `editor-shared` 12.8/13, `settings` 19.6/20, `georef`
  16.8/17, `imagery` 17.0/18, `export-card` 1.8/2, `order-card` 1.8/2.
- The first split `all` of the fixer failed only the Setup journey at its three `tour-matrix` projects: the newly
  claimed owner was given the content worlds' cities running beside it and, administering two cities, stayed on Setup
  after the reload. Two defects, both fixed with their tests: `admin.claim` wrote the owner's document without
  `cities`, so the session migrated it as one from before M5 (`docs/LESSONS.md` 258), and an empty address of an
  admin of two cities was rewritten to `#/setup` before Setup's readiness was known (`docs/LESSONS.md` 257,
  `S-A49-HAPPY-FIRST-SCREEN`, `S-A49-BAD-FIRST-SCREEN-INCOMPLETE`).
- The marker names `90b31be` with this uncommitted tree: the pre-push hook still needs `all` on the commit itself
  with a clean tree (§3, step 2).

The integrator's second run, earlier the same day, before the reviews: `static`, `tests`, `build` and the split
`quality` passed (1406 Playwright tests; the admin then 620.0 of its 620 KB); `all` was not run.

## 2. What works end to end on the emulators

Each line is proved by tests that drive the built admin, the built viewer, the starter kit's page or the built CLI from
outside (Playwright with the network firewall, the console and placeholder guards, every new state through the generic
layout and accessibility checkers), by the functions' handler tests over the ports' fakes, by the rules tests and by
the release gates' pytest and Vitest suites. `e2e/scenarios.json` names the test of every row: 578 rows, of which the
two M2 rows `S-A19-BAD-LOW-CONTRAST-SEED` and `S-A20-BAD-NO-APP-CHECK` are still planned; every M5 row exists.

- **A city from New city to its own public site and its export, across the apps** (A54, the integrator's journey,
  `e2e/admin/specs/cities/city-journey.spec.ts`): the project's owner makes a city with **New city** (its name, its id,
  its rectangle, **Create the city**), publishes it with Settings → **Publishing** (two inputs); the Functions emulator
  builds its manifest with its photo; the repository's own `site:add` writer and `build:site` builder make the city's
  site with the public bucket named, and that site boots the city with one map from the manifest the server built; the
  owner's **Export** and **Download** give a zip that, unpacked on a plain static server, boots the same city with the
  zip's own engine and no Firebase, Google or jsDelivr request. Switched off and saved, the manifest leaves the bucket
  and the site says the map could not be found. Another city's owner, with their own ID token on the emulators' REST,
  gets 403 on the city's documents, its export's zip and an upload into it, and `apiError.city.notMember` from
  `export.start`, `export.download` and `admins.invite`. 16 of 16 at the five admin projects.
- **Many cities, each closed to the others** (A49–A52): `admins/{uid}.cities` names each admin's cities and roles,
  written by the functions only (admins from before M5 migrated at their first session and by `ops.tick`); the rules
  close every city path, Storage prefix, usage and export to the other cities' admins (the allow/deny matrix of a member
  of one city against another, the rule coverage complete); every city callable checks the role in the request's city.
  The admin's city menu (top bar from the medium window class, the account menu on a phone; switching is a page load;
  an unsaved edit asked about first; a link to a city the admin does not administer opens their own, saying why; a
  phone's top bar and the tab's title name the open city; an empty address opens the city's dashboard once Setup is
  complete, as for an admin of one city), New city in two inputs (the name finds the city on
  OpenStreetMap through `cities.locate` and draws its rectangle; a name it does not know leaves a drag, three inputs; an
  id no city may take said at its field, a taken id refused with a free one, an area out of bounds keeps Create off,
  edges typed in part kept), the city's admins and roles (its owners invite with a role, change roles after a question;
  each change one transaction, so two owners at once still leave the city an owner, and the project's owner stays an
  owner of every city), the city's budget (five limits with what was used, the project's owner only; a city without
  limits says the project's caps hold it, and the one limit typed is the only one set), notifications per city;
  pending invitations from before M5 get the cities of their day; the project's new owner starts with no city but
  the bundled one Setup creates (`admin.claim` writes `cities: {}`); `layers.link` refuses another city's pipeline
  tileset.
- **Publishing a city** (A54, `DECISIONS-for-review.md` §63a): Settings → **Publishing**, one switch and Save, which New
  city's done screen points to; before it no screen made a city public, so a city made in the admin had no manifest,
  no site and no export (`docs/LESSONS.md` 231).
- **Many cities on one GitHub Pages site** (V26): `npm run build:site` assembles `dist/pages/`: Bucharest at the root
  (its 2015–2022 links still open the same view and photo), every other city at `/<city>/` with its own manifest and one
  map; a city whose manifest is not in the public bucket yet says so.
- **The static export** (A53, V28): `export.start`, the `export.build` task (a streaming zip over Node's `zlib`, into
  the private bucket), `export.download` (a 15-minute signed address); the zip holds the kit's page with the engine
  beside it, `city.json` without the analytics ids, the photos, README and `RIGHTS.md` naming the photos licensed for
  this map only, and, when asked, the USGS scans; busy, expired, too large, never published and an editor each show
  what they allow; `ops.tick` expires old zips; a download is signed at most ten times a day and never while the
  budget guard is red; the page's policy names only origins of CSP's grammar and no telemetry host. The rules row
  `S-A53-BAD-CLIENT-EXPORTS`: members read, nobody writes, another city's admin reads nothing.
- **The starter kit** (V27, `templates/starter-kit/`): three files; its page loads Mapbox GL JS and the engine from the
  mock jsDelivr with Subresource Integrity; a changed byte, a missing `city.json` and the placeholder token each fail
  visibly; the bilingual note says only "loading" for 4 s, then names the README's check, and stays when the engine is
  blocked (tour state `kit.loading-note`).
- **`create-historic-city`** (V29, `packages/create-historic-city/`): one bundled file without runtime dependencies;
  the scaffold with minimum input, `--dry-run`, `self-host` (one `y/N` per step, the owner's own `firebase` and
  `gcloud`, never a credential: the sign-in is probed as text, never `login:list --json`), `deploy`, `upgrade` (it keeps
  the page's own policy sources), `theme` (the colours from one colour), `doctor`, all against fake tools; a non-empty
  folder, an `sk.` token, no Firebase CLI, billing not linked, a taken project id (another one named) and a declined
  step each stop with the reason. Since CR-M5-7 (M14) they need no flag, and the bundle holds what Setup's Install and
  Publish the map read (`M14-start-your-map.md` §6); every
  command the CLI and the guides print names its exact release (`npx create-historic-city@1.0.0`).
- **The review screenshots** (`DECISIONS-for-review.md` §63j): every new admin state (the city menu, New city's form,
  drawing, area refused, id taken and done, a city's admins as owner and editor, the role question, the city's budget
  and its read-only view, Publishing, and Export the city empty, building, ready, failed, expired and read-only) at
  360 × 800, 768 × 1024, 1440 × 900 and 2560 × 1440, light and dark in Romanian and light in English, and the kit's
  note, in `reports/screenshots/m5/` (235 files) with one contact sheet per state in `reports/screenshots/m5/sheets/`
  (the commands: `docs/TESTING.md` → *Review screenshots*). Their audit fixed the ready export's "1 photos", its two
  filled buttons and the per-city limits' "1 exports" (CR-M5-29, `docs/LESSONS.md` 234).
- **The local stack and the manual walk** (`DECISIONS-for-review.md` §66): `npm run dev:stack` also seeds a second
  city, Iași (the server's own `cities.create`, with Mapbox connected through `setup.saveMapbox` and the fake's token so
  a city made there gets its viewer token), serves every city's page at `127.0.0.1:4310/<city>/`, and keeps the export's
  download on the machine; its check passes. `docs/MANUAL_TEST_PLAN.md` walks M5 as T (cities), X (export) and K (kit
  and CLI), LOCAL now and LIVE after the steps of §3, which its ask-first table lists as D1–D8 and R1–R9.
- **Engine releases** (§2): `npm run release:bump` (the guides' CLI pins too), `release:cdn`, `release:pin-kit` and
  `release:notes`; the gates `kit-pins` (static and release), `release-check` (the guides' pins too), `release-cdn`,
  `self-host-bundle` (the CLI's bundle from the production build, never the e2e one) and `release-pack` (release
  stage); `release.yml`
  shows the pinned addresses in its summary. The release preparation was run end to end on a scratch copy (both
  checkers accept it); in the tree every version is 1.0.0 (§3, step 1, finishes it).

## 3. What waits for you (prepared, ask first, one at a time)

Each step is yours or needs your yes. Claude prepares the commands and opens the exact pages; nothing is done without
you. Run builds in the quality image (`docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w
"$PWD" hcm-quality:local bash -c 'mkdir -p $HOME && <command>'`).

1. **The committed engine's EditorConfig exception** (CR-M5-14, `DECISIONS-for-review.md` §59c: a relaxation, so yours).
   Append to `.editorconfig`:

   ```ini
   # The released engine (cdn/engine/, docs/research/M5-interfaces.md §2.3): minified third-party code committed byte for
   # byte as jsDelivr serves it, where a template literal of lit-html holds a space and a tab before a line break.
   [cdn/engine/*.{js,mjs}]
   trim_trailing_whitespace = false
   ```

   Then, in the image, the release's last local steps (no download, no network):

   ```bash
   npm run build --workspace @hcm/engine && npm run release:cdn
   npm run release:pin-kit
   npm run release:notes -- --write docs/releases/v1.0.0_github_description.md
   python3 scripts/ci/check_release.py --tag v1.0.0   # all but the tag itself, which exists only after step 6
   ```

2. **`all` before the push** (no longer a download: §64's approved run rebuilt the NUC's image, and the second run's
   split `quality` built there with every layer `CACHED`, §63j): after step 1 and the commit, `bash
   scripts/ci/e2e-split.sh` (the stage `all` split with the NUC, about 100 minutes with its tour matrix). The commit's
   `all` must be green before a push (the pre-push hook checks `reports/pipeline/green-all.json`). If the NUC's build
   log shows an apt, venv or npm layer running instead of `CACHED`, its cache was evicted again: stop it and ask, or
   run `bash scripts/ci/run-all-checks.sh` on this machine only.
3. **The Pages tree** (§62g, §58b; a workflow edit): in `.github/workflows/ci.yml`, step "Upload the GitHub Pages
   artifact", `path: dist/site/bucharest` becomes `path: dist/pages`. With only Bucharest's site both trees serve the
   same files.
4. **The jsDelivr probe** (§58g): open
   `https://cdn.jsdelivr.net/gh/ventura8/historic-city-map-maker@legacy-2022/README.md` once in your browser; if
   jsDelivr refuses the repository, the release needs one of §58g's alternatives before the tag.

   **The npm name, also before the merge** (§65e, `docs/LESSONS.md` 238): the merge makes public every guide that says
   `npx create-historic-city@1.0.0`, and whoever owns the name then runs code on its readers. In your own terminal,
   `npm view create-historic-city` (a 404 means it is free); then either publish 1.0.0 now (step 8's commands, from the
   package packed in the image with `npm run build && node --import ./scripts/site/register-ts.mjs
   packages/create-historic-city/build-self-host.ts && npm pack --workspace create-historic-city --pack-destination
   reports/release`, what the `release` stage's `self-host-bundle` and `release-pack` gates run) or reserve the name with
   a placeholder of your own, or tell Claude to move the guides to a scope you own (`@ventura8/create-historic-city`)
   before the merge.
5. **The push, the pull request and the merge: the overwrite of `master` and the Pages go-live** (the repository
   variables first, `docs/MANUAL_TEST_PLAN.md` → D7):

   ```bash
   git add -A && git commit    # Conventional Commit with the Co-Authored-By trailer
   git push origin feat/engine-rewrite
   gh pr create --base master --head feat/engine-rewrite --title "feat: M5 multi-city and engine v1.0.0"
   # then its review (the Copilot review once, at Balanced effort), CI green, and the merge into master
   ```

   The push to `master` runs CI; `deploy-pages` publishes the site (with step 3, every city's), which replaces the
   legacy site.
6. **The first tag**, on the merged `master` commit once `all` is green there:

   ```bash
   git tag -a v1.0.0 -m "v1.0.0"
   git push origin v1.0.0
   ```

   CI's `release.yml` checks the tag, every version, `cdn/engine/` (rebuilt byte for byte), the kit's pins and both
   notes, then creates the GitHub Release. §59j's lines (attach `engine-release.json` and the CLI's package, purge
   jsDelivr's `@1`) are a workflow edit, yours, before or after this tag.
7. **The starter kit's template repository** (§58e), after the tag:

   ```bash
   gh repo create ventura8/historic-city-map-starter --public
   # push a copy of templates/starter-kit/ (index.html, city.json, README.md) as its first commit, then:
   gh api -X PATCH repos/ventura8/historic-city-map-starter -F is_template=true
   ```

8. **`create-historic-city` on npm** (§58f, §61e; step 4 says when), after you choose its licence (today
   `UNLICENSED`, like the rest of the repository), in your own terminal:

   ```bash
   npm view create-historic-city          # is the name free
   npm login                              # your account and its two-factor code
   npm publish reports/release/create-historic-city-1.0.0.tgz --access public   # the package release-pack wrote
   ```

   The tarball comes from `PIPELINE_STAGE=release` (its `self-host-bundle` gate puts the production self-host bundle
   in it, then `release-pack` packs it). Proposed instead (§65e, a workflow edit, yours): `release.yml` publishes that
   very tarball with `npm publish --provenance` from a job with `id-token: write` and an `NPM_TOKEN` secret you set.

9. **The deploys** with M5 in them (`docs/MANUAL_TEST_PLAN.md` → D2–D4, each with its own yes, your own
   `npx -y firebase-tools@15.33.0 login` first):

   ```bash
   npx -y firebase-tools@15.33.0 deploy --only firestore,storage --project bucurestiul-disparut   # the per-city rules and indexes
   # functions: npm run build --workspace @hcm/functions in the image, the temporary firebase.deploy.json, then
   npx -y firebase-tools@15.33.0 deploy --only functions --project bucurestiul-disparut --config firebase.deploy.json
   # the admin: npm run build:admin in the image, then
   npx -y firebase-tools@15.33.0 deploy --only hosting --project bucurestiul-disparut --config firebase.deploy.json
   ```

   Setup (d) then shows **68 din 68 funcții instalate**. Then **Provision again** (Setup → Prepare the project): the
   private bucket's lifecycle rule on `exports/` and `fn-admin@`'s signing binding on itself (CR-M5-8), which
   `export.download` needs (UNVERIFIED until then, `M5-interfaces.md` §10).
10. **Your decisions**: whether only a city's owners may publish it (today any member may, §63i); the admin's
    `re2js` stand-in (§65k: the Firestore SDK's Pipelines regular expressions, which the admin never runs; 43 KB
    less, so no budget raise is needed now; one line to revert, which brings §63i's raise back); the photos licensed for
    this map only in an export (§58h, §65i: the review suggests an opt-in switch); the CLI's licence (§61e); CR-M5-7,
    the admin and its provisioner without GitHub settings, which a self-hosted admin's Setup needs (§62h, §63f), and
    with it `create-historic-city self-host` without `--experimental`; §65m–§65o (a phone's default drawing mode, the
    located rectangle's size, no question before a city's first limits).

## 4. Open items

- The four audit gates (`npm-audit`, `deploy-lock-audit`, `pip-audit`, `pipeline-pip-audit`) pass since the security
  bumps of §64 (approved and pushed on 2026-10-25); every gate of every stage passes (§1).
- **Downloads on the NUC** (§63g): the integrator's first split `quality` run found the NUC's BuildKit cache evicted;
  before it was stopped it had pulled the pinned base images, Ubuntu's packages for the image, the CI tools' venv from
  PyPI and the npm packages, and had started fetching the browsers' system libraries. The Playwright browsers and the
  Firebase emulator JARs (Google's storage) were not reached, and nothing reached the tree. §64's approved run then
  rebuilt the NUC's image, and the second run's split built from that cache with no download (§63j).
- **CR-M5-7** done in M14 (`docs/research/M14-start-your-map.md`): `project.json`'s `github` is optional, Provision then leaves out `gh-deployer`, its grants and bindings and the Workload Identity pool, the `workload-identity` item is `ok`, the install card shows no GitHub variables, and `self-host` and `deploy` need no `--experimental`.
- **v1.0.0's last local steps** wait for step 1 above: the kit's engine block keeps placeholder digests until
  `release:pin-kit`, so no page can load the pinned jsDelivr addresses before the tag.
- UNVERIFIED until a real run (`M5-interfaces.md` §10, `DECISIONS-for-review.md` §61f): jsDelivr serving this
  repository at a tag and `@1` resolving to it, the engine build being byte-reproducible on CI, V4 signing with the
  runtime account's own `signBlob`, the Firebase CLI's JSON listings and its `Logged in as` line that `self-host`
  reads, Nominatim's `/search` answer for a city (`cities.locate`; the fake follows its documented `jsonv2` shape), and
  the npm name being free.
- The admin's bundle in all is at 579.9 KB of its 620 (§65k; before it the review's fixes had taken it to 622.6 KB);
  three chunks are close to their own budgets: `settings` 19.6 of 20 KB, `cities` 5.8 of 6 KB and `editor-shared`
  12.8 of 13 KB.
- **The reviews' leftovers for the user** (§65): the npm publish's provenance (a workflow edit, 65e), the export's
  photos licensed for this map only (65i), and 65m–65o.
