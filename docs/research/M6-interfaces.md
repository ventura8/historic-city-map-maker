# M6 interfaces: Setup with no terminal, the in-app installer and the public map on Firebase Hosting

Written on 2026-10-25 by the M6 contracts agent, alone in the tree before the four M6 workstreams (installer, hosting,
server-bugs, setup-ux) start in parallel. **The source of truth for this milestone is the user's live manual test of the
same day**, [manual-test-2026-10-25.md](manual-test-2026-10-25.md) (findings 1–24, with the user's requests and decision,
the live state after the test and the IAM grant applied by hand). Read it together with `PLAN.md` (*Addendum (2026-10-11):
every human step happens inside the app*), `M2-interfaces.md` (the callables, `setup/status`, the ports),
`M2b-interfaces.md` (the routes, the Google scopes, the bootstrap order, the step graph, the provisioner and its role
table, the input budget), `M3-interfaces.md` §4.3 and §5.7 (the raster pipeline's Cloud Run Jobs and image),
`M4-interfaces.md` §4.3–§4.4 and §10 (Vertex AI and its self-test check), `M5-interfaces.md` §1.10 and §4.4 (the Pages
tree, the self-host steps) with `M2-status.md` to `M5-status.md`, `../MANUAL_TEST_PLAN.md`, and the `setup-assistant`,
`firebase` and `e2e-scenarios` skills.

The user's requirements of 2026-10-25, which every section below serves:

1. "The admin should be able to deploy from step d — a button."
2. "Make sure the admin does not need Claude or the terminal in the rest of the setup."
3. The public map lives on Firebase Hosting at the same `https://bucurestiul-disparut.web.app/`: the viewer at the root,
   the admin under a path (`/admin/`), published from the admin.
4. Step f (USGS) can be skipped and done later.

Nothing here is built yet: every section is a contract the owning workstream implements exactly as written, and a
change to it goes through [Change requests](#change-requests), never by editing another workstream's files. Nothing in
M6 calls a real Google, Mapbox, USGS, STAC, Nominatim or Vertex AI endpoint, deploys, pushes or tags, and nothing is
downloaded: every test runs against the Firebase emulators (project `demo-hcm`), the shared fakes of `@hcm/test-support`
and the e2e mock servers. What only a real project can prove is marked **UNVERIFIED**, each with how the first real run
proves it (§9). Anything that would need a download goes as a NOT APPLIED proposal in `DECISIONS-for-review.md` §67
behind a port.

## 0. What this contract decides

1. **The installer runs in Google Cloud Build** (§1). The admin submits Cloud Build builds from the browser with the
   owner's Google consent (`cloud-platform`, the token Provision already asked for), as Provision calls Google's REST APIs
   today. Each build runs as a dedicated service account, `hcm-installer@`, that Provision creates and grants the least
   it needs (§1.2), and runs the pinned `firebase-tools`, Docker and small Node step scripts inside Cloud Build. Its
   inputs are a versioned **install bundle** that the site build makes from the same commit as the admin and Hosting
   serves next to it (§1.3). Three targets: the **server** (functions, Firestore rules and indexes, Storage rules), the
   **imagery pipeline** (its image in Artifact Registry and the two Cloud Run Jobs) and the **public site** (a Hosting
   release with the viewer at the root and the admin at `/admin/`). Known first-deploy races retry by themselves with
   backoff (§1.5). Each card shows its build's progress and, on a failure, the failing step and its log's last lines;
   **Update** appears when what is installed is older than the admin's own bundle (§1.7). GitHub Actions deploys become
   optional; the card shows the Cloud Build minutes each install uses against the free tier (§1.9).
2. **Provision adds** (§1.6, server-bugs): the installer's account and roles, the Artifact Registry repository `hcm`,
   `roles/run.invoker` for `fn-events@` and `fn-admin@` (the grant applied by hand on 2026-10-25, finding 17), the
   Eventarc and Pub/Sub service identities before the first install (finding 12), and a retry of `SERVICE_DISABLED` for
   an API it has just enabled (finding 4).
3. **The public map on Firebase Hosting** (§2, hosting): one site, `https://<project>.web.app/`: the viewer of the
   project's first city at `/`, every other city at `/<city>/` (a committed site, or a generic city page for a city made
   in the admin: no repository step), the admin at `/admin/` with its install bundle, Firebase's reserved `/__/` paths
   (the auth handler, `init.json`) unchanged on the same origin. A per-path Content Security Policy; old admin addresses
   (`/#/setup`) forwarded to `/admin/#/setup`; the viewer's Mapbox token re-minted for the new origin without an input;
   GitHub Pages optional, with a redirect page for the 2015–2022 links.
4. **Every finding has an owner and scenario rows** (§3): the server bugs analysed from the code (§3.2), the setup UX
   fixes, the USGS "Do it later" (finding 16), the free-trial reminder (finding 18).
5. **Setup with no terminal** (§4): the step graph gains Install the server (d, one click), the imagery pipeline (d3, no
   click: it starts with the server) and Publish the map (i, one click); USGS may be postponed. The whole assistant:
   **11 inputs and 4 Google consents** (9 and 4 with USGS postponed), with no command anywhere. The only steps outside
   the app stay the ones PLAN Addendum 1 named: the project's creation and the first deploy of the admin (D1).
6. **Ownership** (§5): four workstreams; installer is also the integrator (docs, the agent assets, `M6-status.md`) and
   works last; the shared files' marked sections; the order of work.

Done by this contract (CR-M6-1): this file; the findings record `manual-test-2026-10-25.md` (the user's notes kept as
written, with a header on the live state and the IAM grant applied by hand); the behaviours A55–A60 and V30 and the 69
planned scenario rows of §6.1 in `e2e/scenarios.json` and the regenerated `docs/E2E_SCENARIOS.md`; the decisions log
`DECISIONS-for-review.md` §67; the pointers and the live facts of §3.2 in `.agent/instructions.md`, the
`setup-assistant` skill (and its mirror), `web/admin_setup_assistant_skill.md` and `firebase/functions_skill.md`. No code, schema, text, function, rule, screen or workflow changed: each joins with its
implementation (§5).

## 1. The installer (installer; Provision's part: server-bugs)

### 1.1 Why Cloud Build, and what runs where

- The browser cannot run `firebase-tools`, Docker or `gcloud`, and the owner has no terminal. Cloud Build runs them in
  the owner's own project, billed to it (within its free tier, §1.9), under an account the owner's Provision made.
- The admin only **submits** builds and **reads** their state, with the owner's `cloud-platform` token, kept in the tab
  as today (memory only, at most an hour, never stored: `M2b-interfaces.md` §2.3). No token, key or secret goes into a
  build: the build authenticates as `hcm-installer@` through the metadata server (Application Default Credentials).
- The same release everywhere: the admin installs **its own bundle**, built from its own commit. The admin itself
  reaches Hosting through the first deploy (D1, the one out-of-app step left, PLAN Addendum 1), through a later CI
  deploy (optional), or through its own **Publish the map** / **Update the map**, which republish the bundle's Hosting
  tree (§1.4.3). A newer release reaching an owner without CI is a later feature (§10, proposal 67l).

```text
admin (browser, owner's token) ── POST builds ──► Cloud Build (as hcm-installer@)
      │  reads: builds, step states, log lines           │ fetch  https://<project>.web.app/admin/install/<slug>/…  (SHA-256 checked)
      │         Cloud Functions list, Run jobs,          │ server   npm ci firebase-tools → firebase deploy rules, indexes, functions (--force, retries)
      │         /release.json                            │ pipeline docker build pipeline/ → Artifact Registry hcm → Run Admin v2 jobs
      ▼                                                  │ site     npm ci firebase-tools → firebase deploy hosting (the bundle's tree)
Setup cards: d server · d3 pipeline · i site; Home: the update tile
```

### 1.2 The installer's account and its roles

`hcm-installer@<project>.iam.gserviceaccount.com` ("Cloud Build: the in-app installer"), created by Provision's
`service-accounts` item (`SERVICE_ACCOUNTS` gains `hcm-installer`). It is used only as the `serviceAccount` of the
builds the owner submits; nothing impersonates it otherwise (no key, no Workload Identity). It is separate from
`gh-deployer@` (GitHub Actions through Workload Identity Federation), so GitHub stays optional and CR-M5-7 can later drop
`gh-deployer@` without touching the installer.

| Role | On | Why (the narrowest that holds the permission) |
| --- | --- | --- |
| `roles/cloudfunctions.developer` | project | create and update the functions (gen 2) |
| `roles/iam.serviceAccountUser` | `fn-admin@`, `fn-events@`, `fn-crash@` (server), `job-raster@` (pipeline); never project-wide | deploy a function or job that runs as that account |
| `roles/iam.serviceAccountUser` | `<project>@appspot.gserviceaccount.com` (the App Engine default account), only when it exists; never project-wide | added 2026-10-31 (finding 28): `firebase-tools`' `checkServiceAccountIam` refuses any functions deploy without `iam.serviceAccounts.actAs` on it (`DECISIONS-for-review.md` §75a, the trade-off and §75b) |
| `roles/iam.serviceAccountUser` | `<number>-compute@developer.gserviceaccount.com` (the Compute Engine default account, the functions' build account), only when it exists; never project-wide | added 2026-10-31 (finding 33): Cloud Functions gen 2 builds every function as this account (`firebase-tools` names no build account), and the Cloud Functions API answers each create and update 403 "Caller is missing permission 'iam.serviceaccounts.actAs'" without it (`DECISIONS-for-review.md` §75g, the user's decision "Act-as + narrow its role") |
| `roles/firebaserules.admin` | project | release the Firestore and Storage rules |
| `roles/datastore.indexAdmin` | project | the Firestore indexes |
| `roles/cloudscheduler.admin` | project | the jobs of `ops.tick` and `imagery.tick` |
| `roles/cloudtasks.queueAdmin` | project | the task queues of the task functions |
| `roles/serviceusage.serviceUsageConsumer` | project | `firebase-tools` checks that the APIs are on (Provision enabled them) |
| `roles/firebase.viewer` | project | `firebase-tools` reads the project and its web app |
| `roles/firebasehosting.admin` | project | the Hosting release and the site's `maxVersions` |
| `roles/artifactregistry.writer` | repository `hcm` | push the pipeline image; bound by the `artifact-registry` item with the repository since 2026-10-31 (finding 31), so the `iam` item, which the server needs, never waits for the pipeline's repository |
| `roles/logging.logWriter` | project | a build with a user-specified account writes its log to Cloud Logging only |
| `projects/<project>/roles/hcmInstaller` (custom, made by the `iam` item) | project | added 2026-10-31 (finding 28, lesson 298): `cloudfunctions.functions.setIamPolicy` (`firebase-tools`' `checkHttpIam` before a new HTTPS function), `datastore.databases.getMetadata` and `storage.buckets.get` (its trigger-region lookups before every functions deploy); `run.services.get`, `run.services.getIamPolicy`, `run.services.setIamPolicy` (the public invoker of the callables and HTTPS functions), `run.jobs.create`, `run.jobs.get`, `run.jobs.update`, `run.operations.get` (the pipeline's two jobs), `resourcemanager.projects.getIamPolicy` (`firebase-tools` reads the service agents' bindings that Provision made), `artifactregistry.repositories.get`, `artifactregistry.repositories.update` (the cleanup policy `--force` sets on `gcf-artifacts`) |

- **Addendum (2026-10-31, the live test's finding 28)**: the table now holds what `firebase-tools` checks before it
  deploys, not only what the deploy's calls need; the full list against these roles is lesson 298 of `docs/LESSONS.md`.
  Which permission Service Usage's `generateServiceIdentity` (called by `firebase-tools` on every gen 2 deploy) checks
  stays UNVERIFIED; the e2e fakes enforce the actAs check (S-A55-BAD-NO-ACTAS).
- Why a custom role (as `hcmVertexDrafts`, `DECISIONS-for-review.md` §57g): `roles/run.admin` and `roles/run.developer`
  would also let the installer replace any Cloud Run service's code, `roles/resourcemanager.projectIamAdmin` would let it
  grant anything, and `roles/artifactregistry.repoAdmin` at the project would let it delete repositories.
- **UNVERIFIED as a complete set** (as `gh-deployer@`'s, `M2b-interfaces.md` §3.4.1): the first real install names the
  permission of every 403 in its log; the narrowest role holding it is added (a change of this table, logged in §67).
  `firebase-tools` would also try to grant the service agents' roles itself when Provision has not; with Provision's
  bindings in place it only reads them.
- **The functions' build account (2026-10-31, finding 33, `DECISIONS-for-review.md` §75g, the user's decision "Act-as +
  narrow its role")**: not the installer's, but the `iam` item keeps it, in this order, after the role table:

  | Role | On | Member | Why |
  | --- | --- | --- | --- |
  | `roles/iam.serviceAccountUser` | the Compute Engine default account's own policy | `hcm-installer@` | the Cloud Functions API's actAs check on the build account (the row above) |
  | `roles/cloudbuild.builds.builder` | project | the Compute Engine default account | the role Google documents for a user-specified build account of Cloud Functions gen 2 and Cloud Run source builds: it reads the uploaded source, pushes the image to the region's `gcf-artifacts` repository and writes the build's log, so neither `roles/logging.logWriter` nor `roles/artifactregistry.writer` is bound beside it |
  | `roles/editor` removed | project | the Compute Engine default account | only once the builder role is in place (a failed grant stops the item first); the same removal as the App Engine account's (§75b): one member of one unconditional binding, etag and 409 retry |

  All three only when the account exists (a GET; a 404 is nothing to do). Until 2026-10-31 the builder role was bound
  only when the organisation withheld the default grants (`M2b-interfaces.md` §3.4.2); it is now bound whenever the
  account exists. While these parts are all the item lacks, the doctor's reason is
  `adminSetup.provision.computeBuildAccount`; a stopped server build whose log names the 403 (anywhere in its
  `functions` step, not only the card's last lines) offers **Retry what failed in step c**, then Try again
  (S-A04-HAPPY-COMPUTE-BUILD-ACCOUNT, S-A04-BAD-COMPUTE-EDITOR-REFUSED, S-A55-BAD-NO-COMPUTE-ACTAS).
- **What step (d) waits for (2026-10-31, finding 31)**: Install the server, its card's looks and the deployment's watch
  wait for every Provision item the server needs (`serverPrepared`, `packages/admin/src/setup/state.ts`), not for step
  (c) as a whole: the `artifact-registry` item (the repository `hcm` and the installer's writer role on it) only the
  optional imagery pipeline needs, and the `iam` item no longer waits for it. The pipeline's card names the missing
  repository (`apiError.install.noRepository`) with a way back to step (c); Setup is done only with (c) done, as before
  (S-A55-HAPPY-PIPELINE-ITEM-FAILED, S-A55-BAD-SERVER-ITEM-FAILED).
- **What Provision changes on the project's own policy beyond the table (2026-10-31, `DECISIONS-for-review.md` §75b, the
  user's decision)**: the `iam` item removes `serviceAccount:<project>@appspot.gserviceaccount.com` from the project's
  unconditional `roles/editor` binding, last, after the role table: that member of that binding only (every other member
  and every other binding as read, a conditional binding never touched, a binding left with no member dropped), written
  with the etag read and read again on a 409 `ABORTED`, at most three writes (`removeBindings`,
  `packages/admin/src/google/iam-policy.ts`). Nothing to do when the account is absent or holds no such binding. While the
  Editor role is all the item lacks, the doctor's result carries the reason `adminSetup.provision.appEngineEditor`
  (shown on the row as the run reports it; a doctor's `missing` is not recorded, so the server's earlier state of the item
  comes back once the run is recorded, an older behaviour of every item), and Retry what failed (step c's, or the server card's **Retry what failed in step c**, which reruns `iam`) removes it; a refused write
  fails the row with the role it needs (S-A04-HAPPY-APPENGINE-NO-EDITOR, S-A04-BAD-APPENGINE-EDITOR-REFUSED). Why: since
  §75a the installer may act as that account, and nothing of ours runs as it. Since §75g the Compute Engine default
  account loses its Editor role the same way, after its builder role (above).

### 1.3 The install bundle: format, versioning, integrity

Built by `npm run build:install` (installer) after the Hosting tree (§2.1, hosting) and the functions' build, from the
same checkout, into the Hosting tree at `dist/hosting/admin/install/<slug>/`:

| File | What |
| --- | --- |
| `manifest.json` | `installManifestSchema` (§1.10): `format` (1), `release` (the admin's `runtime.json` release, `<version>+<short commit>`), `slug` (`installReleaseSlug(release)`: `1-0-0-abc1234`, safe in a path, a Cloud Build tag and a Cloud Run label), `projectId` (`infra/project.json`), `files` (each target's tarball: name, bytes, `sha256` hex), `functions` (the registry's deployed names, `deployedName`, sorted: the server's expected set), `tools` (`firebaseTools`: `15.33.0`; the step images by digest, §1.4), `estimates` (`INSTALL_ESTIMATES`, §1.9) |
| `server.tgz` | `functions/dist/` (the bundle, its `package.json`, its deploy lock, `.env.<project>` with `HCM_RELEASE`), a `firebase.json` of the server's parts only (functions, Firestore, Storage; no `predeploy`), `firebase/firestore.rules`, `firebase/firestore.indexes.json`, `firebase/storage.rules`, `.firebaserc` (the project only), `tools/package.json` and `tools/package-lock.json` (`firebase-tools` 15.33.0 and its tree, cut from the root lockfile's entries offline: no registry call; `tools/package.json` carries the root `overrides`, without which `npm ci` re-resolves an overridden package, and the vendored copies the tree links to, as `tools/vendor/npm/<name>/`: DECISIONS-for-review.md §74f), `steps/*.mjs` (§1.4) |
| `pipeline.tgz` | the pipeline's Docker context: `pipeline/Dockerfile`, `pyproject.toml`, `poetry.lock`, `src/`, `README.md` (no tests), and `steps/run-jobs.mjs` |
| `hosting.tgz` | the public Hosting tree (§2.1, the public variant) without `admin/install/**`, a `firebase.json` of Hosting only (its `public` the tree's folder), `tools/` and `steps/` as above |

- **Deterministic tarballs** (`scripts/site/src/install/tar.ts`, installer): ustar entries sorted by path, mode 0644 or
  0755, owner 0, the commit's time as every entry's time, gzip without a name or time, written with Node's `zlib` (no
  dependency). Two builds of one commit give the same bytes (a test builds twice and compares).
- **Versioning**: `format` changes only when the build definitions of §1.4 change in a way an older admin could not run;
  an admin refuses a manifest of another format (`apiError.install.bundleFormat`). The slug is in the path, so a browser
  or CDN cache can never mix two releases; the bundle's files are `public, max-age=31536000, immutable`, `manifest.json`
  `no-cache`.
- **Integrity**: when the owner clicks, the admin fetches `manifest.json` from its own origin, checks that its `release`
  equals its own `runtime.json` release and its `projectId` the web configuration's (else `apiError.install.mismatch`:
  "reload the admin"), computes its SHA-256 (`crypto.subtle`) and passes it with the target files' digests as the
  build's substitutions. The build's first step downloads the manifest and the target's files from the same origin and
  refuses to go on unless every SHA-256 matches. The origin is the admin's own `location.origin`, accepted only when it
  is one of the project's Hosting origins (`https://<project>.web.app`, `https://<project>.firebaseapp.com`): never a
  value from data. What this protects against: a stale or partial file, a cache serving another release, a corrupted
  transfer; the bundle has the same trust as the admin's own scripts (one Hosting release serves both).
- **Size budgets** (installer, the pre-approved kind: new rows of `scripts/ci/check_bundle_budget.py`, logged):
  `server.tgz` at most 8 MB, `pipeline.tgz` 1 MB, `hosting.tgz` 80 MB (the legacy originals are 46 MB of it).
- **The repository is public, so is the bundle**: nothing in it is secret (`functions/deploy-env.json`'s values are
  committed already). The repo-policy and gitleaks gates scan the bundle's sources as today.

### 1.4 The builds

Every build: `serviceAccount: projects/<project>/serviceAccounts/hcm-installer@<project>.iam.gserviceaccount.com`,
`options.logging: CLOUD_LOGGING_ONLY` (required with a user-specified account), the default pool and machine
(`e2-standard-2`, the free tier's), `tags: ['hcm-install', 'hcm-<target>', 'hcm-r-<slug>']`, `substitutions`
`_ORIGIN`, `_SLUG`, `_RELEASE`, `_MANIFEST_SHA256`, `_FILE_SHA256`, `queueTtl: 3600s`; submitted with
`POST https://cloudbuild.googleapis.com/v1/projects/<project>/locations/us-central1/builds` (a regional build, as every
resource of the project). Every step names its image by digest (the repository's rule, never a moving tag): `node:24-bookworm-slim`
at the digest of `docs/SETUP.md` for every Node step, and for the pipeline's Docker steps `gcr.io/cloud-builders/docker`
at a digest still to be read (§67e, NOT APPLIED: reading it is a network request; until then the pipeline target's
definition is complete and tested against the fakes, which never pull an image, and the live pipeline card says "not
available in this release" instead of submitting). The step scripts are small
Node modules of the bundle (`scripts/install/steps/`, installer, Vitest over fakes, 90 % per file), so no `gcloud` image
is needed: they call Google's REST APIs with the metadata server's token.

#### 1.4.1 The server (`hcm-server`, timeout 3600 s)

| Step id | Image | Does |
| --- | --- | --- |
| `fetch` | node | `fetch-bundle.mjs`: downloads `manifest.json` and `server.tgz` from `_ORIGIN/admin/install/_SLUG/` (each download up to four attempts, §1.5), checks both digests, extracts into `/workspace/server` |
| `tools` | node | `npm ci --ignore-scripts --no-audit --no-fund` in `server/tools` (the locked `firebase-tools`; npm checks each package's integrity) |
| `packages` | node | `npm ci --omit=dev --ignore-scripts --no-audit --no-fund` in `server/functions/dist` (the functions' deploy lock; added 2026-10-31, finding 30, below) |
| `rules` | node | `firebase deploy --only firestore,storage --project <project> --non-interactive` |
| `functions` | node | `deploy-with-retry.mjs`: `firebase deploy --only functions --force --project <project> --non-interactive`, retrying the known races (§1.5) |
| `verify` | node | `verify-server.mjs`: lists the functions (Cloud Functions v2), requires every name of the manifest's `functions` `ACTIVE` with `HCM_RELEASE` equal to `_RELEASE`, and prints one `HCM_INSTALL` line per missing or failed name |

- `--force` (finding 9): `firebase-tools` refuses, without it, to deploy a function with a failure policy (`notify.onEvent`
  has `retry: true`) and to set up the image cleanup policy non-interactively. It also deletes the functions that the
  source no longer has; the installer therefore never installs a bundle older than the installed server (§1.7,
  S-A55-BAD-DOWNGRADE). The CI job `deploy-firebase` needs the same flag (a workflow edit, §67j, ask first).
- `HCM_RELEASE` joins `.env.<project>` (`functions/build.mjs`, installer), so every function says which release it is.
- **Addendum 2026-10-31 (finding 30 of `manual-test-2026-10-25.md`): `packages`.** Before a functions deploy
  `firebase-tools` resolves `firebase-functions` from the source folder (`functions/dist`) and runs its binary, which
  loads `index.js` to discover the functions (`lib/deploy/functions/prepare.js` `loadCodebases`, `runtimes/node`). The
  tarball carries `functions/dist` without `node_modules`, so the live build printed "Couldn't find firebase-functions
  package in your source code", then "An unexpected error has occurred." at `functions`; on a laptop Node finds the
  packages in the repository's `node_modules` above `functions/dist`, which is why no deploy from a checkout ever showed
  it. The step installs the deploy lock there; no install script is needed to load the tree (sharp's native code is the
  prebuilt `@img/sharp-linux-x64` and `@img/sharp-libvips-linux-x64` the lock names for linux x64 glibc, and sharp is
  imported only on the first photo), `node_modules` is in `functions.ignore` so nothing more is uploaded, and Google's
  own build of each function installs the same lock again. About a minute; the server's estimate (§1.9) holds. The
  fake Cloud Build plays the discovery: a server definition without an `npm ci` in `server/functions/dist` before
  `functions` stops there with the tool's own lines (S-A55-BAD-NO-FUNCTIONS-PACKAGES). The same audit of every other
  step: the step scripts are one Vite bundle with `@hcm/shared` and zod inlined and only Node built-ins external (run
  from a folder without `node_modules` by `install-steps-bundle.test.ts`), the inline `fetch` uses Node built-ins and
  the image's `tar`, `firebase deploy --only firestore,storage` and `--only hosting` load no code of ours, and the
  pipeline's image builds from its own context (`pyproject.toml`, `poetry.lock`, `requirements-poetry.txt`, `src/`).

#### 1.4.2 The imagery pipeline (`hcm-pipeline`, timeout 5400 s)

| Step id | Image | Does |
| --- | --- | --- |
| `fetch` | node | as the server's, with `pipeline.tgz` |
| `build` | docker (§67e) | `docker build -f Dockerfile --target runtime -t us-central1-docker.pkg.dev/<project>/hcm/pipeline:_SLUG .` (the base images are pinned by digest in the Dockerfile) |
| `push` | docker | `docker push`, writing the pushed digest to `/workspace/digest` |
| `jobs` | node | `run-jobs.mjs`: creates or patches `raster-pipeline` (4 CPU, 16 GiB; 2 and 8 since 2026-11-12, `JOB_MACHINE_SIZES`) and `raster-pipeline-xl` (8 CPU, 32 GiB; 4 and 16 since) through Run Admin v2 (`jobs` create or patch, the operation polled): the image by digest, `job-raster@`, task timeout 6 h, no retries, one task, args `run`, env `GOOGLE_CLOUD_PROJECT`, `HCM_PRIVATE_BUCKET`, `HCM_PUBLIC_BUCKET`, label `hcm-release: _SLUG`: exactly what D5 of `MANUAL_TEST_PLAN.md` did with `gcloud` |

#### 1.4.3 The public site (`hcm-site`, timeout 1800 s)

| Step id | Image | Does |
| --- | --- | --- |
| `fetch` | node | downloads `manifest.json`, `hosting.tgz`, and again `server.tgz` and `pipeline.tgz`, checks every digest, extracts the tree and puts the four bundle files back under `admin/install/_SLUG/` (a Hosting release replaces every file, so the bundle must stay in it) |
| `tools` | node | as the server's |
| `hosting` | node | `firebase deploy --only hosting --project <project> --non-interactive` (Hosting uploads only the files it does not have) |
| `config` | node | `hosting-config.mjs`: the site's `maxVersions` to 10 (Firebase Hosting `sites/<site>/config`), so old releases do not pile up in storage |

- A Hosting release is atomic: a failed site build leaves the previous release serving (S-A57-BAD-FAILED).
- The site target publishes the **public variant** (§2.5): its admin's `runtime.json` has no `startUp`.

### 1.5 Retries

| Where | What is retried | How |
| --- | --- | --- |
| The admin, any Google call right after an API was enabled (Provision, the installer's submit) | `403 SERVICE_DISABLED` naming an API that this run enabled, or that Service Usage reports `ENABLED` | `API_PROPAGATION_RETRY`: after 10, 20, 40, 60 and 60 s (about 3 minutes) on the injected clock; while it waits the item says "Waiting for Google to switch on {api}…"; then `apiError.cloud.apiPropagation {api}` and Retry what failed (finding 4; server-bugs, the shared helper the installer imports) |
| Inside the server build, `deploy-with-retry.mjs` | only the known first-deploy races, recognised in `firebase-tools`' output (`TRANSIENT_DEPLOY_PATTERNS`, with fixtures of real outputs): Eventarc's service agent still propagating ("Permission denied while using the Eventarc Service Agent", finding 12), a 429 on the per-project mutation quota, a 409 operation already in progress, a 503 | at most four attempts, waiting 60, 120 and 240 s; each retry deploys only the functions `firebase-tools` named as failed (`--only functions:<id>,…`), else the whole target; each wait prints `HCM_INSTALL {"event":"retry",…}`; any other failure fails the step at once |
| The `fetch` step of every build (`fetch-script.ts`; 2026-11-12: one 10 s connect timeout to Hosting failed a whole Update the map) | a download of the bundle or of `project.json` that got no answer: a network error (the connect timeout), a 408, a 429 or a 5xx | at most four attempts, waiting 5, 15 and 30 s (`HCM_FETCH_WAITS`, the tests' 0); each wait prints `fetch: <file>: attempt N of 4 failed (<why>), trying again in S s`; the last failure stops the step with `fetch: <file>: no answer after 4 attempts (<why>)`; any other answer (a 404, a digest that differs) stops it at once |
| The admin, a build that Google ended | `INTERNAL_ERROR` or `EXPIRED` (Google's side, not the build's) | resubmitted once without a click; a `FAILURE` or `TIMEOUT` never is: it shows its step and log and offers Try again (one input) |

### 1.6 What Provision adds (server-bugs, through CR-M6-2)

- **APIs** (`REQUIRED_APIS`): `cloudbuild` and `artifactregistry` are already in the list; add `firebasehosting`,
  `firebaserules` and `firestore` (`firebase-tools` checks them; a new Firebase project has them on, **UNVERIFIED** for
  a self-hosted one).
- **The retry of `SERVICE_DISABLED`** after enabling (§1.5), so the 2026-10-25 run's "Service accounts" failure right
  after "Google services enabled" costs no click (finding 4, S-A04-HAPPY-API-PROPAGATION).
- **`service-accounts`**: `hcm-installer` joins.
- **A new item `artifact-registry`** (16 items; `PROVISION_ITEMS` and `PROVISION_ORDER` after `buckets`): the Docker
  repository `hcm` in `us-central1` (`artifactregistry.googleapis.com` v1 `repositories?repositoryId=hcm`, format
  `DOCKER`) with a cleanup policy keeping the two newest pipeline images; `missing` creates it.
- **`iam`**:
  1. the service identities first, as today for Firebase Storage and Cloud Storage: Service Usage `v1beta1`
     `generateServiceIdentity` for `eventarc.googleapis.com` and `pubsub.googleapis.com`, so their agents exist and
     their own roles have propagated by the time the server is installed (finding 12; Eventarc's agent is
     `service-<number>@gcp-sa-eventarc.iam.gserviceaccount.com` and receives `roles/eventarc.serviceAgent` from Google);
  2. `roles/run.invoker` for `fn-events@` and `fn-admin@` on the project (finding 17): Eventarc delivers the Firestore,
     Storage and Pub/Sub events with the function's own account (`fn-events@`, and `fn-admin@` for `ops.onBudget`),
     Cloud Scheduler calls `ops.tick` and `imagery.tick` with an OIDC token of theirs, and a task queue's tasks carry the
     enqueuer's account. Project-wide, as applied by hand on 2026-10-25 (both accounts only ever call this project's
     own functions; the per-service alternative is §67b);
  3. the custom role `hcmInstaller` and the installer's rows of §1.2.
- **`scheduler`** stays `pending` until the server is installed; with `runAs` fixed (§3.2) the install creates both jobs.
- A project provisioned before M6 runs Provision again (Re-check shows what is new; Retry what failed adds only that):
  the install card refuses to submit while the installer's account or the repository is missing
  (S-A55-BAD-NOT-PROVISIONED, S-A56-BAD-NO-REPOSITORY).

### 1.7 Progress, status and records

What each card observes, live, with the owner's token while Setup is open (every 10 s while a build runs and the tab
is visible, else every 60 s; the injected clock):

| Target | Installed release read from | Build state read from |
| --- | --- | --- |
| server | Cloud Functions v2 list: each registry function's `serviceConfig.environmentVariables.HCM_RELEASE` and state (step d already lists them) | Cloud Build `builds` filtered by `tags="hcm-server"`, newest first: `status`, each step's `id`, `status` and `timing`; the server's `functions` step adds the functions' count `{ready} of {total}` from the list |
| pipeline | Run Admin v2 `jobs.get` of both jobs: the label `hcm-release` and the image digest | builds tagged `hcm-pipeline` |
| site | `GET /release.json` of the admin's own origin (no token: `{release, variant}`) | builds tagged `hcm-site` |

The state of a target, `InstallState` (`packages/shared/src/schemas/install.ts`, installer):

| State | When | The card shows |
| --- | --- | --- |
| `notInstalled` | nothing installed, no build | the target's why and cost, its button |
| `queued`, `working` | a build of the target is `QUEUED` or `WORKING` | the steps in order, the current one named; the server's `{ready} of {total}` once (finding 7); once at work, the time it has run, on the browser's clock from the look that saw it start (`runningSince`; never Google's `createTime` against the browser's clock: DECISIONS-for-review.md §116d); recorded and not yet looked at: when it was last seen and Check again, "Checking the installation…" only while a look runs, and no Update the map beside it (§116a, §116b); a read that fails keeps it at work with the error, and settles none of Update the map's waits (§116e) |
| `retrying` | the build's last `HCM_INSTALL` line is a retry | "Google is still preparing {what}; trying again at {time}" (finding 12) |
| `installed` | installed release equals the bundle's | the release and when |
| `updateAvailable` | installed release older than the bundle's (`compareRelease`: the version first, then a different commit counts as older) | Update |
| `newerInstalled` | installed release newer than the bundle's | "The server is newer than this admin ({release}): reload the admin"; nothing offered (S-A55-BAD-DOWNGRADE) |
| `failed` | the newest build `FAILURE` or `TIMEOUT`, or `verify` printed missing functions | the failing step's name, the last 20 lines of its log as text, the link to the build in the Google Cloud console, Try again |
| `unavailable` | Cloud Build or a read answered 5xx or 429 | `apiError.unavailable`, polled again |

- **One build per target at a time**: a click while a build of that target is queued or working follows it instead of
  submitting another (S-A55-BAD-SECOND-BUILD).
- **The log summary**: Cloud Logging `entries:list` (`resource.type="build"`, `resource.labels.build_id`), the failing
  step's last 20 lines, each at most 200 characters, through `redactText` (no `ya29.`, `sk.`, `pk.` or bearer value can
  show), rendered with `textContent` only. The `HCM_INSTALL` lines are JSON read with `installLogEventSchema`; any other
  line is shown, never parsed.
- **Records** (no token, no address, no secret, no log line):
  - before the claim, in the bootstrap record (`sessionStorage`, `M2b-interfaces.md` §3.2): `install` with each
    target's `{state, release?, buildId?, checkedAt}`;
  - after it, `setup/status.install` (`setupInstallSchema`: `server`, `pipeline`, `site`, each `{state, release?,
    buildId?, checkedAt, detail?, params?}`), written by `setup.recordCloud` (its request gains `install`;
    `projectOwner`), so Home can show an update or a failure without a token;
  - the server's own release needs no record: `admin.session` and `setup.status` answer `serverRelease` (the functions'
    `HCM_RELEASE`).
- **Update**: Setup's three cards and a Home tile ("An update is ready: {release}", setup-ux) when any target is
  `updateAvailable`; **Update the map** submits, in one click, a build of every target that is behind (the server
  first, then the pipeline and the site once the server is installed; a server that stopped submits neither, and their
  cards keep offering the update). Budget `updateMap`: 1 input (plus one consent:
  in daily use there is no live token).

**Addendum 2026-11-12 (the update order).** The pipeline used to be submitted beside the server. On 2026-11-09 its build
finished first: the job `raster-pipeline` ran the new image, so `worker.image` handed it to the local worker, whose claims
the old server refused until its own build caught up. Update the map now holds the pipeline, like the site, until the
server it submitted has settled installed (`packages/admin/src/setup/install.ts`, `#afterServerTargets`); a stopped server
releases neither, and each card keeps Update the map. Installing a new map (Install the server) still submits both at
once: no worker is paired before the server exists. The order is kept by the admin tab that clicked: the pipeline and
the site are submitted from that tab once its look at the server's build sees it installed, with the live token. If the
tab is closed during the server's build, or the token has expired by the time it looks again, the server's update still
finishes on Google's side, the pipeline and the site are not submitted, and their cards offer Update the map again (the
local worker keeps the old image meanwhile: safe, but a second click). An update started outside the admin (GitHub
Actions) has no such guard; the server-side one is proposed in `DECISIONS-for-review.md` §187.
S-A56-HAPPY-UPDATE-AFTER-SERVER, S-A56-BAD-UPDATE-SERVER-STOPPED.

**Addendum 2026-11-14 (the live admin: the pipeline never updated).** The server went 62c7179 → bca1891 at 17:02 and the
pipeline stayed on 62c7179, its card silent, so every computer kept the old processing. Three gaps of the addendum above:
(1) a watch with no live token (the token's hour ran out, or the page was reloaded) stopped without a word, so the cards
froze on their last look until Check again; it now says so on the card (`adminSetup.install.followPaused`) and offers
Continue, whose consent restarts every card's watch (`InstallFlowDeps.paused`); (2) a server seen in while the page held
no live token dropped the pipeline's and the site's update with an info log line; they now stay held
(`#afterServerTargets`), their cards say why with Continue (`adminSetup.install.waitsForSignIn`), and the next token's
look at the server submits them (Continue on the pipeline's card looks at the server first); a server that stopped says
so on their cards (`adminSetup.install.serverStopped`, kept until the target builds again or is in place); (3) a refused
submit (`apiError.install.adminOutdated` when the admin was redeployed while the server built) was shown inside a card
whose chip said done, so the card stayed closed: a card with an error never wears the done chip (`chipOf`).
S-A56-BAD-UPDATE-TOKEN-RAN-OUT.

**Addendum 2026-11-01 (finding 39 of `manual-test-2026-10-25.md`, `DECISIONS-for-review.md` §78a): the release order.**
Every release of a version shares its semver (`1.0.0+<commit>`; build metadata has no precedence), so a release also
carries its **build time**: the build commit's time in whole seconds since 1970 (`SOURCE_DATE_EPOCH`, else
`git show -s --format=%ct`), as `releaseTime` in the admin's `runtime.json`, `/release.json` and the install manifest,
`HCM_RELEASE_TIME` in the functions' environment, the label `hcm-release-time` on both pipeline jobs, the builds'
substitution `_RELEASE_TIME` (checked by `fetch` against the manifest) and `releaseTime` in `setup/status.install.*`
(sent only once the server names a time of its own: an older server's strict schema refuses it). `compareRelease`
orders: a higher version is newer; within one version the same commit is the same release, else the later build time
is newer; an installed build without a time (before this addendum) is behind, never newer unless its version is
higher; a timed installed build is never replaced by an admin without a time. `updateAvailable` and `newerInstalled`
above follow that order, and the downgrade guard (S-A55-BAD-DOWNGRADE, S-A55-BAD-DOWNGRADE-SAME-VERSION) with them. A
recorded state names where the target stood against the admin that recorded it, so Setup's cards and Home's tile read
a recorded release in place again against this admin's own release and build time (`recordedState`) before any look
at Google (S-A55-HAPPY-UPDATE-SAME-VERSION, S-A55-HAPPY-SAME-BUILD).

**Addendum 2026-11-01 (finding 40, §78b): the consent note on an install card.** It shows only while the card offers a
button that asks Google for the token (Install, Publish, Try again, Install the pipeline, Update the map) or beside
Continue; an install card with nothing to do (installed, under way) shows none (a card newer than the admin offers the override of §1.7.1, which asks), its Check again
still asking Google when the token is gone (S-A55-BAD-NOTE-NOTHING-TO-DO).

#### 1.7.1 Release channels and the owner's override (the live finding of 2026-11-12, `DECISIONS-for-review.md` §169)

The release prep bumped every version to `1.0.0-beta.1`; the live server was `1.0.0+dcfb067`, an untagged build of
before the bump (no `v1.0.0` tag ever existed). By SemVer `1.0.0-beta.1` < `1.0.0`, so step d said "newer than this
admin" and offered no Update. The rule since:

- **The channel is in the release.** A build of a commit that carries the version's tag `v<version>` (CI's
  `GITHUB_REF=refs/tags/v<version>`, or `git tag --points-at`) names the version alone (`1.0.0`, `1.0.0-beta.1`): a
  `release` or a `prerelease`. Every other build names its commit after `+` (`1.0.0-beta.1+593d539`): a `dev` build
  (`adminRelease`, `scripts/site/src/admin/runtime.ts`; `releaseChannel` of `@hcm/shared`). So the functions'
  `HCM_RELEASE`, the jobs' label, `/release.json` and the records carry the channel with no new field, and a release
  from before the channels reads the same way: `1.0.0+dcfb067` is `dev`. `runtime.json` and the install manifest also
  write it out as `channel` (the manifest refuses one its release does not name). A build outside git names the
  version alone and counts as a release.
- **The order.** The core (`major.minor.patch`) first. Within one core two tagged releases follow SemVer (a tagged
  `1.0.0` stays newer than `1.0.0-beta.1`: the downgrade guard); a dev build against anything is placed by the build
  times, so a dev build is older than any build of its core made after it. An installed dev build without a time is
  behind; with a time missing otherwise, SemVer decides and a tie keeps what is installed (`compareRelease`).
- **The override.** A card newer than the admin still offers no Update, but **Install this admin's version anyway**
  (`<hcm-install-over>`) opens a confirmation that names both releases and says it replaces the newer one (a
  rollback); **Install <release>** submits the admin's build with the tag `hcm-over` (`OVER_TAG`), which Cloud
  Build's history keeps, and the admin's log says what it replaced. Not a History entry: a rollback installs an older
  server, whose strict schemas would refuse a record they do not know. Two inputs, the consent when the token is gone
  (S-A55-HAPPY-INSTALL-OVER, S-A55-BAD-INSTALL-OVER-KEPT; tour state `setup.install-over-dialog`).
- **Slugs of pre-releases.** `releaseOfSlug` reads `1-0-0-beta-1-593d539` back to `1.0.0-beta.1+593d539` (before, a
  pre-release's pipeline jobs named no release).

### 1.8 The cards (installer; the step frame's rules from setup-ux)

- **(d) Install the map's server**: why, what it creates, the cost line (§1.9), **Install the server** (one click; the
  consent popup only when the token from Prepare the project is gone). The click also starts the pipeline's build
  (§4.1). The consent note appears only on a card whose button opens Google's consent now (finding 7, the frame's rule,
  CR-M6-3); the functions' count appears once. The GitHub repository variables move under a collapsed **Optional:
  install from GitHub Actions instead** (CR-M5-7 unchanged).
- **(d3) The imagery pipeline**: its state and Try again; Imagery's "set up USGS first" and "the pipeline is not
  installed" states link to it.
- **(i) Publish the map**: the address it publishes to (`https://<project>.web.app/`), what visitors will see (the
  city's published map; a city whose Publishing switch is off shows "not found"), the cost line, **Publish the map**;
  off with the reason while there is nothing to show (no published manifest of the first city: Mapbox not set up, or
  the city not published; S-A57-BAD-NOTHING-TO-SHOW). After it: the address as a link, the release.

### 1.9 Cost and the free tier

`INSTALL_ESTIMATES` (`packages/shared/src/schemas/install.ts`; **UNVERIFIED** until the first real install, whose
measured minutes replace them in the same task):

| Target | Cloud Build minutes (e2-standard-2) | Other |
| --- | --- | --- |
| server | about 15 for the installer's build, plus about 1 per function for Google's own image builds of each function (69 functions), so about 85 | the functions' images in `gcf-artifacts`, kept 1 day by the cleanup policy |
| pipeline | about 20 (the GDAL image) | its image in `hcm`, about 1.5 GB (Artifact Registry: 0.5 GB free, then about 0.10 USD per GB a month) |
| site | about 5 | Hosting storage of 10 kept releases, within Hosting's free 10 GB; each publish downloads `hosting.tgz` and the manifest from the admin's own Hosting, about 60 MB of Hosting's free 360 MB a day (52 before the 2023 additions) (`SITE_PUBLISH_TRANSFER_MB`; most of it the old photos' originals under `/admin/legacy/`, `DECISIONS-for-review.md` §73k) |

Each install card has one cost line (the M6 review, finding 10: the frame leaves an available install step's cost to the
card): the step's own cost, then "Uses about {minutes} build minutes; Google Cloud gives {free} free each month"
(`CLOUD_BUILD_FREE_MINUTES`, 2,500, **UNVERIFIED** at the time of the first install), and on the site's card "Each
publish also moves about {megabytes} MB of Hosting's free daily transfer" (security-cost finding 4). A first full install
is about 110 minutes, an update of all three about the same, so a month of releases stays free; the 5 USD budget alarm
covers the rest as today. The bundle's tarballs are public files of the site, so anyone may download them; Hosting bills
transfer past its free tier and the budget alarm pauses the pipeline, never the site (§73k records how to shrink it).

### 1.10 Ports, adapters, schemas and fakes

- `packages/shared/src/schemas/install.ts` (installer): `INSTALL_FORMAT`, `INSTALL_TARGETS` (`server`, `pipeline`,
  `site`), `installManifestSchema`, `installReleaseSlug`, `compareRelease`, `InstallState`, `setupInstallSchema`,
  `installLogEventSchema`, `HCM_INSTALL_LOG_PREFIX`, `INSTALL_ESTIMATES`, `CLOUD_BUILD_FREE_MINUTES`,
  `INSTALLER_ACCOUNT` (`hcm-installer`), `PIPELINE_REPOSITORY` (`hcm`), `TRANSIENT_DEPLOY_PATTERNS`.
- `packages/admin/src/google/cloud-build.ts` (create, get, list by tag), `logging.ts` (a build's lines),
  `run-jobs.ts` (get a job's labels and image) and `artifact-registry.ts` (get, create; server-bugs uses it for the
  item): typed REST clients over `fetch` with `GoogleFailure`, as every client of `google/`.
- `packages/admin/src/install/` (installer): `InstallerPort` (`observe(target)`, `submit(target, access)`,
  `logTail(buildId, step)`), its Cloud Build adapter, `build-spec.ts` (the three build definitions as data, unit-tested
  against golden JSON), `install-flow.ts` (the state machine of §1.7 per target, polling, the one-shot resubmit, the
  records), and the `updateMap` flow.
- Fakes (`packages/test-support/src/fakes/`, installer): `google-cloudbuild.ts` (builds created, listed and read; per
  target scenarios `install.succeeds`, `install.retries`, `install.fails-at-<step>`, `install.internal-error`,
  `install.queued`; a server build that would succeed stops where `firebase-tools`' own preconditions would stop it:
  the installer's actAs on the App Engine default account (finding 28), then the functions' packages in their source
  folder (finding 30); a successful server build flips the Cloud Functions fake to `deployed` with `HCM_RELEASE` and creates
  the Scheduler jobs; a pipeline build makes the two jobs with their label in the Run fake; a site build sets the
  e2e Hosting's `release.json` and variant), `google-logging.ts` (the build's lines, the `HCM_INSTALL` ones included),
  `google-artifact-registry.ts`, the Run fake's jobs `get`/`create`/`patch` (beside M3's executions), and the
  `google-services.ts` scenario `propagation` (an enabled API answers `SERVICE_DISABLED` N times; server-bugs). The
  firewall's server-only hosts gain `cloudbuild.googleapis.com`, `logging.googleapis.com`,
  `artifactregistry.googleapis.com` (all forwarded to the fakes for the admin projects).

## 2. The public map on Firebase Hosting (hosting)

### 2.1 The layout

One Hosting site, the project's default (`bucurestiul-disparut`), built by `npm run build:hosting` into `dist/hosting/`
(hosting; `firebase.json`'s `hosting.public` becomes `dist/hosting`, its `predeploy` that script):

```text
https://<project>.web.app/
  /                         the viewer of the project's first city (infra/project.json cities[0]; Bucharest: sites/bucharest, pagesPath "")
  /index.html /config.js /site.css /engine/… /data/…   the root site's files (data/ only for a site built without the public bucket)
  /<city>/                  a committed city site (sites/<city>/, pagesPath "<city>/", M5 §1.10)
  /<id>/                    any other city id: the generic city page (§2.4), rewritten to /city/index.html
  /city/                    the generic city page itself (index.html, config.js)
  /admin/                   the admin: index.html, its chunks, fonts, runtime.json, firebase-messaging-sw.js, legacy/bucharest/…
  /admin/install/<slug>/    the install bundle (§1.3)
  /release.json             {release, variant: "public" or "start-up"}, no-cache: what the site's card reads back
  /404.html                 a bilingual "page not found" with links to the map and to the admin
  /__/auth/handler, /__/firebase/init.json   Firebase's reserved paths, unchanged (Hosting serves them before any rule)
```

M5's Pages tree builder (`assemblePages`, `scripts/site/src/pages.ts`) assembles the viewer sites at their `pagesPath`
as today; `--hosting dist/hosting` adds the generic city page, `/admin/` (the admin's build, base `/admin/`), the root's
`release.json`, `404.html` and `admin-redirect.js` (§2.7), and refuses a city path that is a folder of the root site,
`admin` (already a reserved city id) or `city` (which joins `RESERVED_CITY_IDS`, hosting).

### 2.2 Rewrites, redirects and headers per path

| Rule | Source | Effect |
| --- | --- | --- |
| redirect | `/admin` | 301 to `/admin/` |
| rewrite | `/admin/**` | `/admin/index.html` (the admin's hash routes need one page; files are served first) |
| rewrite | regex `^/[a-z0-9-]{2,32}/?$` (`CITY_ID_PATTERN`'s ids) | `/city/index.html` (a committed city's folder is a file match and wins) |
| none | anything else | `404.html` (no catch-all: an unknown path is a 404, never the viewer) |
| headers | `/admin/**` | the admin's policy (`scripts/site/src/admin/csp.ts`, unchanged), its `Content-Security-Policy-Report-Only` for Trusted Types, `Cross-Origin-Opener-Policy: same-origin-allow-popups` (the Google popup) |
| headers | `**` | `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` (`geolocation=(self)`): **no** Content-Security-Policy |
| none (meta) | the viewer's pages | their own `<meta http-equiv="Content-Security-Policy">` (`scripts/site/src/csp.ts`, the M1 and M5 policy, the public bucket's host added when the build names it), exactly as on Pages |
| headers | `/admin/install/**` | `Cache-Control: public, max-age=31536000, immutable`, `manifest.json` `no-cache` |
| headers | the HTML, script, style and JSON files (today's rule) | `Cache-Control: no-cache` (as today); `/admin/legacy/**` `public, max-age=86400`, its JSON `/admin/legacy/*/*.json` `no-cache` (DECISIONS-for-review.md §115a) |

- **No path gets two Content-Security-Policy headers** (Hosting may send every matching rule's headers): the viewer's
  policy is its page's meta tag, the admin's the header of `/admin/**` only. A unit test resolves `firebase.json` over
  probe paths (`/`, `/index.html`, `/engine/engine.iife.js`, `/iasi/`, `/city/index.html`, `/admin/`,
  `/admin/install/<slug>/manifest.json`, `/404.html`) and pins one policy per HTML page.
- `scripts/site/src/admin/hosting.ts` (the e2e admin server's reading of `firebase.json`) gains `regex` rewrites and
  `redirects`, so the e2e serves exactly what Hosting would.
- `trailingSlash` becomes `true` and `cleanUrls` stays: a city's page and the admin load their files relative to their
  folder, and with `false` Hosting would answer `/<city>/` with a redirect to `/<city>`, where those addresses break
  (**UNVERIFIED** Hosting's exact redirects; the e2e resolver implements the rule and a probe-path test pins
  `/iasi`, `/iasi/`, `/admin`, `/admin/`).
- The viewer pages ask no Firebase SDK for data and read only the public bucket's manifest and images (unchanged); the
  admin's App Check key and the browser API key already allow `https://<project>.web.app/*`.

### 2.3 The admin under `/admin/`

- The admin's build uses the base `/admin/` (`packages/admin/vite.config.ts` and the admin page's asset addresses);
  everything it fetches by absolute path stays valid: `/__/firebase/init.json`, the auth handler (same origin, same
  authorised domains: nothing to change in Firebase Auth).
- `runtime.json`, the legacy bundle (`/admin/legacy/bucharest/…`, read by the import) and the push service worker move
  with it. The service worker registers at `/admin/firebase-messaging-sw.js` with scope `/admin/`; the admin
  unregisters a registration of the old scope `/` (made by a pre-M6 admin) before registering its own, and a device
  whose push token changed registers again by itself (S-A58-BAD-OLD-SERVICE-WORKER).
- The functions' `adminUrl` becomes `https://<project>.web.app/admin/` (`functions/src/deps.ts`): invitations and the
  inbox's and push's links (`adminUrl + #/…`) open the admin directly. `adminOrigins` stay the two Hosting origins.
- Shared origin, so shared storage, and a trust boundary (the M6 security review, finding 1; `DECISIONS-for-review.md`
  §73a): IndexedDB, `localStorage` and cookies belong to the whole origin, so the admin keeps the owner's Firebase sign-in
  in its tab's `sessionStorage` (`browserSessionPersistence`; one sign-in per tab) and nothing a viewer page could read
  and use; its `hcm:admin:*` keys hold preferences only, each read through a fixed parser. The viewer's preferences are
  `hcm:<cityId>:<name>` and the admin's `hcm:admin:*`, and `admin` is a reserved city id, so they never collide (a test
  pins it); the admin's withdrawal of analytics must
  expire only its own GA4 cookies, never the viewer's (`packages/admin/src/app/telemetry.ts`; a test pins it).
- `telemetry.reportError` can no longer tell the viewer from the admin by origin: a report's `page` (origin and path,
  already sent) decides, `/admin/` the admin and anything else the viewer; a report whose page's origin is not its
  `Origin` header is refused (S-A24-HAPPY-SAME-ORIGIN, S-A24-BAD-PAGE-ORIGIN-MISMATCH).
- The e2e admin server serves the admin at `/admin/` and the viewer's tree at `/`; `adminPath` and the admin origin of
  `e2e/admin/support/` follow in one change, so every admin spec keeps its addresses.

### 2.4 Cities' paths and the generic city page

- A committed site keeps its folder (M5 §1.10); the root city is the project's first (Bucharest, `pagesPath` `""`).
- A city made in the admin needs no repository step any more: `/city/index.html` is the root site's page with a
  `config.js` (a static file, no inline script) that takes the city id from the address's first segment, checks it with
  `CITY_ID_PATTERN` and points `manifestUrl` at `https://storage.googleapis.com/<public bucket>/cities/<id>/manifest.json`;
  its assets are absolute (`/engine/…`). A city never published shows the viewer's "map not found" (V30's bad row).
  New city's done screen and Settings → Publishing show `https://<project>.web.app/<id>/` (multi-city's texts, setup-ux
  through the shared catalogue).
- The bucket's name comes from `infra/project.json` at build time (`<projectId>-public`), as the M5 build's
  `HCM_PUBLIC_BUCKET` does.

### 2.5 The start-up root and the public root

- The first deploy of a new map (D1, start-up mode, `HCM_ADMIN_START_UP=1`) publishes the **start-up variant**: the
  admin at `/admin/` with `runtime.json` `startUp: true`, and at `/` a small bilingual page "This map is being set up"
  with a link to the admin, `admin-redirect.js`, no engine and no Mapbox (S-V30-BAD-START-UP); `release.json` says
  `start-up`.
- **Publish the map** (§1.4.3) publishes the **public variant**: the viewer at `/`, the cities, the admin without
  `startUp`. The admin already leaves start-up mode by itself once the server answers (finding 14: observed live), so
  D4 is gone; `startUp` stays a hint for the first page loads before the server exists.
- Both variants come from one `build:hosting` run: the public tree first (its `hosting.tgz` goes into the bundle), then
  the start-up tree, which differs only in its root and the admin's `runtime.json`.

### 2.6 The viewer's Mapbox token for the new origin

- `infra/project.json` `viewerOrigins` and `functions/deploy-env.json`'s `HCM_VIEWER_ORIGINS` become
  `https://<project>.web.app` and `https://<project>.firebaseapp.com`; `https://ventura8.github.io` stays in both while
  the Pages site exists (the user's choice, §67d).
- The minted token's allowed addresses are recorded per city (`cities/{city}.mapbox.viewerAllowedUrls`, beside the
  token id). `ops.tick`'s `tokens` step (which already retires replaced tokens) gains a part of its own
  (`functions/src/ops/viewer-tokens.ts`, hosting) that compares them with the server's `viewerOrigins` and, when they
  differ, mints a new viewer token for the city as `setup.rotatePublicToken` does (the old one retired after
  `TOKEN_RETIRE_MINUTES`) and lets the manifest republish: the token follows the installed server's origins with no
  input (S-A06-HAPPY-VIEWER-ORIGIN). A refusal (a demo account, `apiError.mapbox.mintRefused`) keeps the old token and
  says why on Setup (e), where **Replace the visitors' token** stays (S-A06-BAD-REMINT-REFUSED).
- Same origin for the viewer and the admin: both public tokens now allow the same addresses. They stay two tokens (the
  usage of each is apart, and either can be replaced alone). Restricting a token to a path (`/admin/`) is possible only
  if Mapbox's URL restrictions accept paths (**UNVERIFIED**), a later refinement.

### 2.7 Old links

| Old address | Now |
| --- | --- |
| `https://<project>.web.app/#/<route>` (the admin before M6: bookmarks, notifications already on a device, an invitation link) | the root page's `admin-redirect.js` (in both variants, before the engine loads) sends an address whose hash starts with `#/` to `/admin/` with the same hash (`location.replace`); a viewer hash (`#15.5/44.4271/26.0853/90/!a3!p2`, `#photo=…`) is never touched (S-A58-HAPPY-OLD-LINK, S-A58-BAD-VIEWER-HASH) |
| `https://<project>.web.app/` opened by an invitee of before M6 (no hash) | the public map (the start-up variant links the admin); an invitation made since M6 names `/admin/` |
| `https://ventura8.github.io/…` (the 2015–2022 site and its links) | while Pages stays, unchanged; to retire it, `npm run build:site -- --pages-redirect dist/pages-redirect` builds a Pages tree whose every page sends the visitor to `https://<project>.web.app/` with the same hash (the viewer reads the legacy hash, V26), with a bilingual "the map moved" line for browsers without script; publishing it is a workflow line and a push to `master` (§67c, ask first) |

### 2.8 GitHub Pages and GitHub Actions become optional

- The public map's home is Hosting; Pages is no longer part of Setup. `ci.yml`'s `deploy-pages` keeps working for an
  owner who wants it; the redirect tree of §2.7 is its other use (a proposal, §67c).
- `deploy-firebase` and `deploy-pipeline-image` stay as the CI path behind `DEPLOY_ENABLED` (unset: nothing deploys from
  GitHub); `deploy-firebase` gains `--force` (§67j) and, to publish the same tree as the admin, `dist/hosting` (it reads
  `firebase.json`, so it follows by itself).
- `MANUAL_TEST_PLAN.md`'s D2–D5 and D7 become Setup's in-app steps (§4.4); D1 stays the one deploy from a terminal.

## 3. Every finding: owner and rows

### 3.1 The table

Rows are those of §6.1 (all `planned`). "Docs" means no behaviour of its own: the owner fixes the document named.

| # | Finding | Owner | What changes | Happy row | Bad row |
| --- | --- | --- | --- | --- | --- |
| 1 | The loading screen scrolls | setup-ux | the shell's loading state fits the viewport (`100dvh`, no extra margin); tour state `shell.loading` | S-A31-HAPPY-LOADING-FITS | S-A31-BAD-LOADING-SLOW |
| 2 | The start-up sign-in card is not centred | setup-ux | centred from the medium window class, top-aligned on compact height | S-A31-HAPPY-SIGN-IN-CENTRED | S-A31-BAD-SIGN-IN-REFUSAL |
| 3 | "Stuck at step b": no button to create a billing account, the wait is invisible, Link stays clickable | setup-ux | a primary **Create a billing account** (deep link `gcp.billingCreate`, `https://console.cloud.google.com/billing/create`, joining `links.json` once the weekly contract check verifies it, else the list page), the wait said in words with the last check's time, Link replaced by the waiting state | S-A04-HAPPY-CREATE-ACCOUNT | S-A04-BAD-WAITING-NO-LINK |
| 4 | Provision: `SERVICE_DISABLED` right after enabling | server-bugs | the propagation retry (§1.5) | S-A04-HAPPY-API-PROPAGATION | S-A04-BAD-API-STILL-DISABLED |
| 5 | The failure says "Run Prepare the project again" beside "Retry what failed" | setup-ux | the provisioner's own message names the button on the card; `apiError.cloud.apiDisabled` in the shared catalogue names the Setup step instead of a button | S-A04-HAPPY-RETRY-NAMES-BUTTON | S-A04-BAD-CHECK-NAMES-STEP |
| 6 | The loading indicator covers the step's chip | setup-ux | the indicator replaces the chip's icon, the label stays ("Working…"); the tour captures the busy state and the overlap checker sees an animated indicator (why it did not: a lesson; a stricter checker, the pre-approved kind) | S-A31-HAPPY-BUSY-CHIP | S-A31-BAD-BUSY-REDUCED-MOTION |
| 7 | The deploy card repeats step c's consent note and the count | setup-ux (the frame's rule) with installer (the card, CR-M6-3) | a consent note only on a card whose button asks a consent now; the count once | S-A03-HAPPY-CONSENT-NOTE-WHERE-ASKED | S-A03-BAD-ONE-COUNT |
| 8 | The plan says "51 din 51" | installer (integrator), docs | `MANUAL_TEST_PLAN.md` names no count: "every function installed" | (docs; the card's count comes from the registry: S-A26-HAPPY) | (docs) |
| 9 | D3 needs `--force` | installer | the server build passes `--force` (§1.4.1) and never downgrades; `ci.yml` proposal §67j; the plan's D3 fallback command | S-A55-HAPPY | S-A55-BAD-DOWNGRADE |
| 10 | Install the server from the app | installer | §1 | S-A55-HAPPY, S-A55-HAPPY-UPDATE | S-A55-BAD-BUILD-FAILED, S-A55-BAD-NOT-PROVISIONED, S-A55-BAD-SECOND-BUILD |
| 11 | The Scheduler jobs fail: `runAs` returns `fn-admin@` | server-bugs | `runAs` returns the full e-mail (§3.2) with a deploy-shape test | S-A55-HAPPY-SCHEDULER-ACCOUNT | S-A55-BAD-NO-PROJECT |
| 12 | First deploy: Eventarc's service agent still propagating | server-bugs (identities in Provision), installer (the retry in the build) | §1.5, §1.6 | S-A55-HAPPY-RETRIED, S-A04-HAPPY-INSTALLER-ACCOUNT | S-A55-BAD-RETRIES-EXHAUSTED, S-A04-BAD-IDENTITY-REFUSED |
| 13 | No terminal in the rest of Setup: (a) server, (b) leave start-up mode, (c) pipeline, (d) public site, (e) Vertex AI and FCM by Provision, (f) GitHub optional | installer (a, c, d, the plan), hosting (d), nobody (b, e: already in the app) | §1, §2, §4 | S-A30-HAPPY-NO-TERMINAL, S-A56-HAPPY, S-A57-HAPPY | S-A30-BAD-TOKEN-EXPIRED, S-A56-BAD-FAILED, S-A57-BAD-NOTHING-TO-SHOW |
| 14 | The public map on Hosting at the same address, the admin at `/admin/` | hosting (tree, admin path, CSP, token origin, old links), installer (the publish card) | §2 | S-V30-HAPPY, S-A58-HAPPY, S-A58-HAPPY-OLD-LINK, S-A06-HAPPY-VIEWER-ORIGIN, S-A57-HAPPY | S-V30-BAD-START-UP, S-V30-BAD-UNKNOWN-CITY, S-A58-BAD-VIEWER-HASH, S-A58-BAD-CSP-PER-PATH, S-A06-BAD-REMINT-REFUSED |
| 15 | The Mapbox console link's label carries a hint | setup-ux | each deep link's label says what its page does; "if Mapbox asks, choose Rotate token" becomes a hint line beside it | S-A05-HAPPY-LINK-LABELS | S-A05-BAD-HINT-APART |
| 16 | USGS: Do it later | setup-ux | behaviour A59 (§4.1) | S-A59-HAPPY, S-A59-HAPPY-APPROVAL-PENDING | S-A59-BAD-IMAGERY-WHILE-LATER, S-A59-BAD-REQUIRED-NOT-SKIPPABLE |
| 17 | Import stuck at 0/45: the event functions' account lacks `run.invoker`; stuck photos wait 10 minutes each | server-bugs | Provision's grant (§1.6), the self-test's `events` check (§3.2), the import re-triggers a photo stuck in `pending`, a lesson | S-A04-HAPPY-INSTALLER-ACCOUNT, S-A03-HAPPY-EVENTS-REACH, S-A28-HAPPY-STUCK-REPROCESSED | S-A03-BAD-EVENTS-REFUSED, S-A28-BAD-STUCK-AGAIN |
| 18 | A free-trial billing account ends in 90 days | setup-ux | behaviour A60: an account that appeared while the card waited is recorded as a likely trial (no Google API says so, §67f); Home reminds 14 days before day 90 | S-A60-HAPPY | S-A60-BAD-EXISTING-ACCOUNT |
| 19 | After the import, nothing says what finished | setup-ux | a snackbar "All 45 photos are on the map" (or what failed, with Open) | S-A28-HAPPY-DONE-SNACKBAR | S-A28-BAD-PARTIAL-SNACKBAR |
| 20 | The Vertex AI check: "Something went wrong", logged as `apiError.internal` | server-bugs (cause, logging, mapping), setup-ux (the optional check shown quietly) | §3.2 | S-A03-HAPPY-OPTIONAL-CHECK-QUIET (with the existing S-A45-HAPPY-SELF-TEST) | S-A45-BAD-MODEL-UNAVAILABLE, S-A45-BAD-UPSTREAM-LOGGED |
| 21 | F waits for USGS (correct); G needs Analytics enabled in the console (a human step by design) | nobody (no change) | the plan says so | S-A07-BAD-ROLE-PENDING (exists) | S-A22-BAD-ANALYTICS-NOT-ENABLED (exists) |
| 22 | A band of another background below the content | setup-ux | the shell's surface fills the viewport (the page's background is the surface's) | S-A31-HAPPY-SURFACE-FILLS | S-A31-BAD-OVERSCROLL-BAND |
| 23 | C passed: photos, map, editor, bulk rights | nobody | (a pass) | S-A10-* (exist) | S-A10-* (exist) |
| 24 | "Setup 8 of 9, not done" while USGS waits; the AI check alarms in the same card | setup-ux | Setup's header "Setup done — USGS approval pending" (or "USGS later"), Home opens (A59); an optional check fails quietly (finding 20) | S-A59-HAPPY-APPROVAL-PENDING, S-A03-HAPPY-OPTIONAL-CHECK-QUIET | S-A59-BAD-IMAGERY-WHILE-LATER |

### 3.2 The server bugs, from the code

- **Finding 11, `runAs`.** `functions/src/global-options.ts` returns `{ serviceAccount: 'fn-admin@' }`: firebase-tools'
  shorthand. The function itself takes it (Cloud Functions expands it), but firebase-tools 15.33.0 copies the value as it
  is into the Cloud Scheduler job's `oidcToken.serviceAccountEmail`, which Scheduler refuses with 400 `INVALID_ARGUMENT`;
  `GLOBAL_OPTIONS.serviceAccount` (`fn-events@`) has the same form. Fix (server-bugs): `runAs(name)` and the global
  default return `<account>@<project>.iam.gserviceaccount.com`, the project read from `GCLOUD_PROJECT` (firebase-tools
  sets it when it loads the code for discovery, in Cloud Build as on a terminal; the emulator sets `demo-hcm`), else
  `GOOGLE_CLOUD_PROJECT`; neither set throws naming both (never the shorthand). The deploy-shape test
  (`functions/test/deploy-shape.test.ts`) loads the built `functions/dist/index.js` with `GCLOUD_PROJECT=demo-hcm` and
  checks every exported endpoint's `serviceAccountEmail` (firebase-functions' `__endpoint`) against
  `^(fn-admin|fn-events|fn-crash)@demo-hcm\.iam\.gserviceaccount\.com$`, every `scheduleTrigger` endpoint among them, and
  that the account is `RUNTIME_ACCOUNTS`' for the name.
- **Finding 12, Eventarc's service agent.** Its roles are granted by Google when the agent is created, which the CLI
  did during the first deploy, minutes before the triggers needed them. Provision creates the agents (§1.6) and the
  build retries the race (§1.5).
- **Finding 17, `run.invoker`.** The event functions run as `fn-events@` and Eventarc delivers with that account, which
  had no `run.routes.invoke`; Cloud Scheduler's OIDC calls as `fn-admin@` and the task queues' calls as the enqueuer meet
  the same check. Emulators skip IAM, so no e2e or rules test could see it. Fixes: Provision's grant (§1.6); a self-test
  check **`events`** (`SELF_TEST_CHECKS` gains it after `task-queue`): `setup.selfTest` writes `ops/probe` `{nonce,
  requestedAt}` (`opsProbeDocSchema`, the system writer `ops`), and a new function **`ops.onProbe`** (`fn-events@`, a
  Firestore trigger on `ops/probe`, `retry: false`, `maxInstances: 1`; the registry's 69th function) writes `receivedAt`
  and `receivedNonce`; the check polls the document for at most `EVENTS_PROBE_WAIT_MS` (20 s) and is `ok` when its nonce
  came back, else `invalid` with `apiError.setup.eventsUnreached` naming `roles/run.invoker` and Prepare the project.
  Deployed, it is the real-data probe the finding asks for, run by the owner's Check again. The import: a photo whose
  upload finished but whose document is still `pending` after `STUCK_PHOTO_MS` (2 minutes, the injected clock) is sent
  to `photos.reprocess` once (a new upload event); still `pending` 2 minutes later, it is listed as "not processed: the
  server did not receive the upload" with a link to the server checks, and the import goes on with the others (the 10
  minutes per photo are gone). A lesson in `docs/LESSONS.md` names S-A03-BAD-EVENTS-REFUSED.
- **Finding 20, the Vertex AI check.** From the code: `runCheck` logs only `{check, code}`; `failureRecord` turns any
  error that is not an `ApiError` into `apiError.internal`; `viaCloud` maps a `forbidden` answer to
  `apiError.cloud.permission` or `apiError.cloud.apiDisabled` and only `rateLimited`, `maintenance` and `unavailable`
  otherwise. So `apiError.internal` for `ai` means the Vertex adapter threw an `UpstreamError` of kind `notFound` (HTTP
  404), `invalid` (400 or 422, or a 2xx without `totalTokens`), `unauthorized` (401) or `conflict` (409 or 412): Vertex
  answered, and the answer was dropped. Not the token (every other Google check used the same token provider and
  passed) and not the network (a fetch failure or timeout is `unavailable`). The leading hypothesis, **UNVERIFIED**: a
  404 `NOT_FOUND` for the publisher model `gemini-2.5-flash-lite` in `us-central1` (retired by Google's model lifecycle
  a year or so after its general availability, or not offered to this project), which Google answers before any model
  runs, so the model's traffic metrics stay empty; M4 §10 already listed "still served" as unverified. A free trial's
  access to Gemini is also **UNVERIFIED** (finding 20 c). Fixes (server-bugs): (1) `googleError` keeps Google's
  `error.status` and the first `ErrorInfo.reason` (both `[A-Z_]{1,64}` or dropped) on the `UpstreamError`, and
  `runCheck` logs `{check, code, service, failure, status, reason}` (never a body, an address or a token); (2) `checkAi`
  maps `notFound` to `apiError.assist.modelUnavailable {model}` and any other unmapped failure to
  `apiError.cloud.refused {api, reason}`, never `apiError.internal`; the drafts button says the same; (3) the `ai` check
  is optional: Setup lists it apart, quietly (setup-ux); (4) the probe is the owner's Check again after the server
  update, whose card and log then name the reason; a retired model is a reviewed change of `VERTEX_MODEL_ID` (the
  user's decision, §67g).
- **Finding 4, `SERVICE_DISABLED`.** `stateOfFailure` makes a `forbidden` with `api` the item's `missing`, and the
  dependants wait for a click. §1.5's retry wraps the clients for a run (`withApiPropagation`, server-bugs), so the
  provisioner's items and the installer's submit share it.

## 4. Setup with no terminal

### 4.1 The step graph

`SETUP_STEPS` (installer owns `packages/admin/src/setup/steps.ts` in M6; setup-ux's readiness reads it):

| Step | Letter | Mode | Detection | Action | Inputs, consents | Optional |
| --- | --- | --- | --- | --- | --- | --- |
| `signIn` | a | start-up | as M2b | Sign in with Google | 1, 1 | no |
| `billing` | b | start-up | as M2b; a new account while waiting marks a likely trial (A60) | Create a billing account (a deep link, not counted), then the app links it and makes the budget; Link only when an account exists | 1, 1 | no |
| `provision` | c | start-up | the doctor, 16 items | Prepare the project | 1, 1 | no |
| `deploy` | d | start-up | §1.7 (server) | **Install the server** (also starts d3) | 1, 0 (+1 consent once the token is gone) | no |
| `claim` | d2 | switch | as M2b | none | 0, 0 | no |
| `pipeline` | d3 | start-up or normal | §1.7 (pipeline) | none (started by d); Try again on a failure | 0, 0 | yes |
| `mapbox` | e | normal | as M2b; the viewer token for the Hosting origin (§2.6) | paste the secret token | 1, 0 | no |
| `usgs` | f | normal | as M2b; `postponed` | the three inputs, or **Do it later** (1 input) | 3, 0 (or 1, 0) | no, but postponable |
| `analytics` | g | normal | as M2b | as M2b | 1, 1 | yes |
| `legacyImport` | h | normal | as M2b | Import the 45 photos; a snackbar at the end (finding 19) | 1, 0 | yes |
| `site` | i | normal | §1.7 (site) | **Publish the map**, once the first city's manifest is published | 1, 0 (+1 consent once the token is gone) | no |

- **USGS later** (A59, setup-ux): **Do it later** on the card writes `setup/status.usgs.postponedAt` through
  `setup.recordCloud` (its request gains `postponed: {usgs: boolean}`; analytics and the import may use the same field
  later); the step's chip reads **Later**; Setup's progress counts it apart ("8 of 9 done, 1 later"); Home shows a tile
  "USGS is not set up yet: historical imagery search is off" with **Set up USGS** (`#/setup/usgs`) until the step is
  done; Imagery keeps its "set up USGS first" state (S-A11-BAD-USGS-NOT-SET-UP). A token already saved and waiting for
  M2M approval shows "waiting for USGS's approval since {date}". Only a required step that can wait offers it (USGS);
  billing, Provision, the server, Mapbox and the site never do.
- **Setup done** (`setupDone`, `packages/shared/src/api/setup.ts`, replacing `SETUP_REQUIRED_AREAS`' meaning; setup-ux):
  billing, provision and Mapbox `ok`; the server and the site installed (`install.server`, `install.site`); USGS `ok`,
  postponed, or pending with its token saved (`apiError.usgs.accessPending`). Then the header says "Setup done", or
  "Setup done — USGS approval pending" / "— USGS later", and an empty address opens Home (§34i). Optional steps and the
  optional checks never hold it back.
- **The order** (`nextSetupStep`): after Mapbox the page opens USGS, then the optional ones, then the site; the import
  before the site is a suggestion of the site card ("import the photos first"), not a rule.

### 4.2 The input budget (counted as M2b §3.5)

| Path | Inputs | Consents |
| --- | --- | --- |
| The whole assistant, happy path (`setupInputBudget()`) | 11: a 1, b 1, c 1, d 1, e 1, f 3, g 1, h 1, i 1 | 4: a, b, c, g |
| The required steps only, USGS postponed | 7: a, b, c, d, e, f (Do it later), i | 3: a, b, c |
| Allowances on a bad path | one input per Try again or Retry what failed; one consent when a click finds the token gone (d after an hour, i almost always: the steps between take longer than an hour) | |
| Daily use: Update the map (`updateMap`) | 1 | 1 |
| Skip USGS (`skipUsgs`), dismiss the trial reminder (`dismissTrial`) | 1 each | 0 |

Before M6 the assistant counted 9 inputs and 4 consents and left D2–D5 and D7 to a terminal; the two new buttons are
the user's request ("a button"), and the pipeline's install takes no input of its own. S-A30-HAPPY-NO-TERMINAL counts
the whole journey and S-A30-BAD-TOKEN-EXPIRED the allowance.

### 4.3 What stays human, and what stays outside the app

- Human, in Google's or the provider's pages: the billing account and its card, Google's consents, the Mapbox account,
  card and secret token, the USGS account, M2M request and token, enabling Google Analytics (its terms).
- Outside the app, once: the project's creation and the first deploy of the admin (D1, start-up variant), with the
  user's yes (PLAN Addendum 1); since M14 a new owner's first deploy comes from the start page instead
  (`docs/research/M14-start-your-map.md`), with a bundle that names no project. For a self-hosted owner, `create-historic-city self-host` step 6 is that deploy (its
  step 8, the server's deploy, becomes the admin's Install the server once M6 lands; kit-cli's README follows, through
  the integrator).

### 4.4 `MANUAL_TEST_PLAN.md` after M6 (the integrator)

B3 becomes Install the server (no count: "every function installed"), B-pipeline the imagery pipeline, B-site Publish
the map; D2–D5 and D7 leave the ask-first table except as the terminal fallback of an owner who prefers it; D4 is gone
(finding 14); D1 deploys the M6 start-up tree; the LIVE column for the viewer reads the Hosting address; Setup lists no
terminal command.

## 5. Ownership

### 5.1 Who owns what

Each workstream writes only its own paths (tests mirror them); reading and importing anything is fine; anything else
is a change request.

| Workstream | Owns (writes) |
| --- | --- |
| installer | `packages/shared/src/schemas/install.ts` (new), `packages/shared/src/i18n/admin-install/**` (new catalogue: the three cards, the update tile's texts, merged into the admin's Setup catalogue), the install codes `apiError.install.*` of the API catalogue (one line each); `packages/admin/src/google/{cloud-build,logging,run-jobs,artifact-registry}.ts` (new); `packages/admin/src/install/**` (new); `packages/admin/src/setup/{deploy,steps}.ts` and the site and pipeline flows of `packages/admin/src/setup/`; `packages/ui/src/admin/setup/{hcm-setup-deploy,hcm-setup-pipeline,hcm-setup-site,install-status}.ts`; `scripts/site/src/install/**` and `scripts/install/**` (new: the bundle, the tar writer, the step scripts and their tests), `npm run build:install`; `functions/build.mjs` (`HCM_RELEASE`); `setup.recordCloud`'s `install` field (`functions/src/setup/record-cloud.ts`, its marked section); the fakes of §1.10 but `google-services.ts`'s propagation; `e2e/admin/specs/install/**`, the `install` section of `e2e/tour/admin-sections.ts`, the `install` budgets; rows A55 (but the two `functions` rows), A56, A57, A30's; as the integrator, last: `README.md`, `docs/*.md` (ARCHITECTURE, SETUP, TESTING, CI_PIPELINE, the admin guides' chapter, LESSONS, MANUAL_TEST_PLAN, SELF_HOST), `.agent/**`, `.agents/**`, `.claude/**`, `docs/research/M0-handoff.md`, `docs/research/M6-status.md` |
| hosting | `firebase.json` (the `hosting` block), `infra/project.json` (`viewerOrigins`), `functions/deploy-env.json` (`HCM_VIEWER_ORIGINS`), `scripts/site/**` but `scripts/site/src/install/**` (the Hosting tree, the generic city page, the start-up root, `release.json`, `404.html`, `admin-redirect.js`, the Pages redirect tree, `hosting.ts`'s regex rewrites and redirects), `npm run build:hosting`, `packages/admin/vite.config.ts` (base `/admin/`), `packages/admin/src/firebase/messaging.ts` (the service worker's scope), `functions/src/deps.ts` (`adminUrl`), `functions/src/telemetry/report-error.ts`, the viewer-token part of `ops.tick`'s `tokens` step (`functions/src/ops/viewer-tokens.ts`, new) with `cities/{city}.mapbox.viewerAllowedUrls`, `RESERVED_CITY_IDS` (`city`); `e2e/mock-apis/{admin-server,server}.ts` (the admin at `/admin/`, the viewer's tree at `/`), the admin origin and `adminPath` of `e2e/admin/support/`, `e2e/specs/viewer/hosting.spec.ts` (new), `e2e/admin/specs/shell/admin-path.spec.ts` (new), the `site` states of `e2e/tour/states.ts`; rows V30, A58, the A06 and A24 rows; the `ci.yml` proposals of §67c and §67j |
| server-bugs | `functions/src/global-options.ts`, `functions/test/deploy-shape.test.ts` (new); `functions/src/setup/{self-test,self-test-checks,failures}.ts`, `functions/src/adapters/{vertex-ai,google-call}.ts`, `functions/src/ports/errors.ts` (`status`, `reason`); `functions/src/ops/probe.ts` (new, `ops.onProbe`) and its registry, index, deps and global-options lines; `SELF_TEST_CHECKS`' `events` and `opsProbeDocSchema`; the codes `apiError.cloud.apiPropagation`, `apiError.cloud.refused`, `apiError.setup.eventsUnreached`, `apiError.assist.modelUnavailable`; `packages/admin/src/provision/**` (§1.6 with CR-M6-2), `PROVISION_ITEMS` (`artifact-registry`), the propagation helper in `packages/admin/src/google/transport.ts`; `packages/admin/src/import/**` (stuck photos); `packages/test-support/src/fakes/{google-services,google-iam,vertex-ai}.ts`; rows A04's (4, 12, 17), A03's events, A28's stuck, A45's, A55's two `functions` rows; their lessons (to the integrator) |
| setup-ux | `packages/ui/src/admin/shell/**` (loading, surface), `packages/ui/src/admin/auth/**` (centring), `packages/ui/src/admin/setup/` but the installer's files (`hcm-setup-step`, `hcm-setup-billing`, `hcm-setup-usgs`, `hcm-setup-mapbox`, `hcm-setup-page`, `hcm-setup-import`, `self-test`, `setup-text`, `setup-styles`), `packages/ui/src/admin/home/**` (the USGS, trial and update tiles), `packages/admin/src/setup/{billing,usgs,legacy-import,links,links.json}` (but the stuck-photo part of the import), `packages/admin/src/app/setup-readiness.ts`, `packages/admin/src/home/**`, `setupDone` and the `postponed` and `trial` fields of `packages/shared/src/api/setup.ts` and `setup.recordCloud` (marked sections), `packages/shared/src/i18n/{admin-setup,admin-shell}/**` and the `apiError.cloud.apiDisabled` wording; the tour's checker change of finding 6 (`e2e/support/layout-*.ts`, stricter); `e2e/admin/steps/**` and `e2e/admin/specs/flows/**` additions; rows A31's, A04's (3, 5), A03's (7, the quiet check), A05's, A28's snackbars, A59, A60 |
| contracts (done) | this file and the files of CR-M6-1 (§0) |

### 5.2 Shared files

| File | How a workstream appends |
| --- | --- |
| `e2e/scenarios.json` | each flips its own rows to `exists` when the tagged test lands (the `notes` name the owner and the spec) and adds a row after its behaviour's last; then `python3 scripts/ci/check_e2e_matrix.py write` in the image |
| `e2e/tour/admin-sections.ts`, `e2e/tour/states.ts` | one section per workstream (`install`, `site`, `setupUx`), a spread from a file of its own |
| `packages/admin/src/setup/steps.ts` | installer; setup-ux's `optional`, `postponable` and readiness changes go through CR-M6-4 (accepted) |
| `packages/shared/src/api/setup.ts`, `functions/src/setup/record-cloud.ts`, `setupStatusDocSchema` | marked sections: installer `install`, setup-ux `postponed`, `trial` and `setupDone`, server-bugs `SELF_TEST_CHECKS`; each in its own change with its test |
| `packages/shared/src/schemas/firestore.ts`, `firestore-ops.ts`, `client-writes.ts` | hosting: `cityDocSchema`'s `mapbox.viewerAllowedUrls`; server-bugs: `opsProbeDocSchema` (the `ops` writer, no client write); each in its own change with its test |
| `packages/shared/src/api/errors.ts` and the API catalogues | one line per code at the end of its group, both languages |
| `packages/shared/src/api/registry.ts`, `functions/src/index.ts`, `deps.ts`, `global-options.ts`, `functions/test/index.test.ts`, the admin's function counts | server-bugs, one line each for `ops.onProbe` |
| `packages/admin/src/provision/resources.ts` | server-bugs (CR-M6-2 brings the installer's rows) |
| `packages/test-support/src/fakes/index.ts`, `e2e/mock-apis/{hosts,router}.ts` | one line per fake or host |
| `scripts/ci/check_bundle_budget.py` | installer: the bundle's rows; hosting: any viewer or admin chunk its base path moves; logged in `DECISIONS-for-review.md` |
| the root `package.json` | one script line each: `build:hosting` (hosting), `build:install` (installer) |
| `vitest.config.ts`, `.dependency-cruiser.cjs`, `knip.json`, `sonar-project.properties` | installer: `scripts/install` (a project or the site build's, its scope); stricter or keeping the tools working only, logged |

### 5.3 Order of work

1. **In parallel from the start**: server-bugs (`runAs` and its deploy-shape test first; then the provisioner's retry,
   identities, `run.invoker`, CR-M6-2; the `events` check; the Vertex mapping; the import), hosting (the tree and the
   admin's base path with the e2e harness in one change, since every admin spec's address moves; then the CSP rules, the
   old links, the token origin), setup-ux (the shell and sign-in layout, the billing card, the copy, A59 and A60, the
   checker), installer (the schemas, the bundle and its tar writer, the step scripts over fakes, the Cloud Build client
   and fakes, then the cards).
2. The installer's e2e of the site target starts once hosting's tree and admin path have landed; its Provision checks
   once CR-M6-2 has.
3. Each workstream runs `PIPELINE_STAGE=static` and `tests` for its changes and `build` when it touches a build (the
   admin, the sites, the functions, the bundle).
4. **The installer integrates last**: the docs and agent assets, `M6-status.md`, the cross-app journey (S-A30-HAPPY-NO-TERMINAL
   through to the public map at `/`), then `all` split with the NUC.
5. **Only one agent at a time runs a split stage** (`PIPELINE_STAGE=<stage> bash scripts/ci/e2e-split.sh`, the NUC); the
   others run single tiers locally (`--project`), and nobody touches other containers or `~/fork-linux-ci` on the NUC.

### 5.4 Change requests

As in M5 (§6.4 there): a workstream that needs a change outside its paths appends a row to
[Change requests](#change-requests) (the next free `CR-M6-<n>`, status `open`) and goes on against the current
contract; the target's owner applies it and sets `done` with the date and what changed, or `rejected` with why. A
deviation applied inside one's own paths is a self-applied row (`done`).

## 6. Scenarios, budgets and tour states

### 6.1 Rows (done: `e2e/scenarios.json`, `docs/E2E_SCENARIOS.md` regenerated)

Every M6 row is `planned`; its `notes` name this file's section, the owner and the test file that will carry its tag.
New behaviours (the next free ids): **A55** install and update the server, **A56** the imagery pipeline, **A57**
publish and update the public map, **A58** the admin at `/admin/`, **A59** USGS later, **A60** the free-trial reminder,
**V30** the public map on Firebase Hosting.

- **A55** (installer; e2e-admin): `S-A55-HAPPY`, `-HAPPY-RETRIED`, `-HAPPY-UPDATE`, `-BAD-BUILD-FAILED`,
  `-BAD-RETRIES-EXHAUSTED`, `-BAD-NOT-PROVISIONED`, `-BAD-DOWNGRADE`, `-BAD-SECOND-BUILD`; (server-bugs; functions)
  `-HAPPY-SCHEDULER-ACCOUNT`, `-BAD-NO-PROJECT`.
- **A56** (installer; e2e-admin): `S-A56-HAPPY`, `-HAPPY-UPDATE`, `-BAD-FAILED`, `-BAD-NO-REPOSITORY`.
- **A57** (installer; e2e-admin): `S-A57-HAPPY`, `-HAPPY-UPDATE`, `-BAD-NOTHING-TO-SHOW`, `-BAD-TOKEN-EXPIRED`,
  `-BAD-FAILED`.
- **A58** (hosting; e2e-admin): `S-A58-HAPPY`, `-HAPPY-OLD-LINK`, `-BAD-OLD-SERVICE-WORKER`, `-BAD-VIEWER-HASH`,
  `-BAD-CSP-PER-PATH`.
- **A59** (setup-ux; e2e-admin): `S-A59-HAPPY`, `-HAPPY-APPROVAL-PENDING`, `-BAD-IMAGERY-WHILE-LATER`,
  `-BAD-REQUIRED-NOT-SKIPPABLE`.
- **A60** (setup-ux; e2e-admin): `S-A60-HAPPY`, `-BAD-EXISTING-ACCOUNT`.
- **V30** (hosting; e2e-viewer): `S-V30-HAPPY`, `-HAPPY-OLD-PAGES-LINK`, `-BAD-START-UP`, `-BAD-UNKNOWN-CITY`.
- Rows joining existing behaviours: **A03** `S-A03-HAPPY-EVENTS-REACH` (server-bugs), `-BAD-EVENTS-REFUSED`
  (server-bugs, functions), `-HAPPY-CONSENT-NOTE-WHERE-ASKED`, `-BAD-ONE-COUNT`, `-HAPPY-OPTIONAL-CHECK-QUIET` (setup-ux);
  **A04** `S-A04-HAPPY-CREATE-ACCOUNT`, `-BAD-WAITING-NO-LINK`, `-HAPPY-RETRY-NAMES-BUTTON`, `-BAD-CHECK-NAMES-STEP`
  (setup-ux), `-HAPPY-API-PROPAGATION`, `-BAD-API-STILL-DISABLED`, `-HAPPY-INSTALLER-ACCOUNT`, `-BAD-IDENTITY-REFUSED`
  (server-bugs); **A05** `S-A05-HAPPY-LINK-LABELS`, `-BAD-HINT-APART` (setup-ux); **A06** `S-A06-HAPPY-VIEWER-ORIGIN`,
  `-BAD-REMINT-REFUSED` (hosting, functions); **A24** `S-A24-HAPPY-SAME-ORIGIN`, `-BAD-PAGE-ORIGIN-MISMATCH` (hosting,
  functions); **A28** `S-A28-HAPPY-STUCK-REPROCESSED`, `-BAD-STUCK-AGAIN` (server-bugs), `-HAPPY-DONE-SNACKBAR`,
  `-BAD-PARTIAL-SNACKBAR` (setup-ux); **A30** `S-A30-HAPPY-NO-TERMINAL`, `-BAD-TOKEN-EXPIRED` (installer); **A31**
  `S-A31-HAPPY-LOADING-FITS`, `-BAD-LOADING-SLOW`, `-HAPPY-SIGN-IN-CENTRED`, `-BAD-SIGN-IN-REFUSAL`, `-HAPPY-BUSY-CHIP`,
  `-BAD-BUSY-REDUCED-MOTION`, `-HAPPY-SURFACE-FILLS`, `-BAD-OVERSCROLL-BAND` (setup-ux); **A45**
  `S-A45-BAD-MODEL-UNAVAILABLE`, `-BAD-UPSTREAM-LOGGED` (server-bugs).

The deterministic tarball, the step scripts and the retry patterns are unit-tested (Vitest over recorded outputs), not
scenario rows; what the owner sees of them is A55–A57.

### 6.2 Input budgets

`SETUP_STEP_SPECS` (installer): `deploy` 1 input and 0 consents, `pipeline` 0 and 0, `site` 1 and 0, the others as
today; `setupInputBudget()` 11 and 4. `CONTENT_INPUT_BUDGETS` (`packages/admin/src/content/budgets.ts`): `updateMap` 1
(installer), `skipUsgs` 1 and `dismissTrial` 1 (setup-ux), each in its owner's section.

### 6.3 Tour states

Every new screen and state joins the tour's inventory and passes `expectStateSound` at every admin tour viewport (the
viewer's at every viewer viewport), light and dark; nothing joins a checker's allowlist:

- installer: `setup.install-ready`, `setup.install-working` (the steps and the count), `setup.install-retrying`,
  `setup.install-failed` (the log summary), `setup.install-update`, `setup.install-newer`, `setup.pipeline-working`,
  `setup.pipeline-failed`, `setup.site-blocked`, `setup.site-ready`, `setup.site-published`, `home.update-tile`;
- setup-ux: `shell.loading`, `auth.start-up-sign-in`, `auth.not-owner`, `setup.billing-waiting`,
  `setup.provision-busy` (the live indicator), `setup.usgs-later`, `setup.done-usgs-pending`, `setup.import-done`
  (the snackbar), `home.usgs-later`, `home.trial-reminder`, `setup.checks-optional-off`;
- hosting: `site.start-up` and `site.city-generic` (viewer), `site.not-found` (`404.html`).
- added 2026-11-01 (findings 39, 40): `setup.install-update-recorded` (an older build of the same version recorded
  installed, offered as an update with the consent note) and `setup.install-nothing-to-do` (the admin's own release
  installed: nothing offered, no consent note).

## 7. Fakes and the e2e world

- **Google** (installer, server-bugs): §1.10's fakes; every build "runs" in the fake by scenario (no step executes), and
  the e2e asserts the submitted definition: the account, the tags, the substitutions (the digests the page computed),
  the steps' ids, images by digest and arguments (`--force`, `--only`). The step scripts are tested apart (Vitest), each
  against fakes of `fetch` and of the commands' outputs.
- **Hosting** (hosting): the e2e site server serves `dist/e2e-hosting` (the e2e build's Hosting tree) with the rules of
  `firebase.json` read by `hosting.ts`; `release.json`'s variant follows the fake site build; the admin tier's origin
  serves `/admin/`.
- **Mapbox** (hosting): the fake records a viewer token's allowed addresses, so S-A06-HAPPY-VIEWER-ORIGIN reads the
  re-mint.
- **Firewall**: unchanged rules; the new Google hosts of §1.10 are forwarded for the admin projects; the viewer's pages
  still ask nothing of Firestore, Firebase or googleapis but the public bucket.

## 8. Cost and security summary

| Item | Cost | Guard |
| --- | --- | --- |
| An install or update | Cloud Build minutes (§1.9), within the free tier for a month of releases | one build per target at a time; the 5 USD budget; the estimate on the card |
| The pipeline image | Artifact Registry storage, about 0.10 USD a month | the cleanup policy keeps two images |
| The public map on Hosting | Hosting's transfer (free 360 MB a day, then paid on Blaze) and storage | `maxVersions` 10; the viewer reads the public bucket (unchanged) |
| The re-minted viewer token | none | the old token retired after 10 minutes |

Security: the owner's token never leaves the tab and never enters a build; builds run as `hcm-installer@` with the
roles of §1.2 only; the bundle is checked by SHA-256 against what the admin read; nothing from data reaches a build's
definition (the origin is the admin's own and must be a Hosting origin of the project; the release comes from the
admin's own `runtime.json`); log lines are redacted and shown as text; the viewer still never reads Firestore; the
admin's CSP is unchanged and the viewer's stays its own; no secret is in the bundle (the repository is public).

## 9. UNVERIFIED, and how the first real run proves it

| Fact | Proof (ask first; the real project, never in CI) |
| --- | --- |
| The installer's roles (§1.2) are enough, and `firebase-tools` only reads the service agents' bindings | the first in-app Install the server: any 403 in the log names its permission |
| Cloud Build accepts a build from the browser (CORS of `cloudbuild.googleapis.com` and `logging.googleapis.com` for a bearer token) | the first click; else the same calls through a callable of the owner's token is a change request |
| `GCLOUD_PROJECT` is set when firebase-tools loads the code for discovery | the deploy-shape test proves the built code with it; the first install's Scheduler jobs prove firebase-tools sets it |
| The free tier's 2,500 build minutes a month and the estimates of §1.9 | Google's pricing page at the time; the first install's measured minutes |
| Gen 2 functions build each function's image in its own Cloud Build build | the build list after the first install |
| The cause of finding 20 (a 404 for the model is the hypothesis) | Check again after the server update: the card and the log name it |
| A free-trial billing account cannot be told apart through the Cloud Billing API | Google's API reference at the time; §67f's heuristic stands until then |
| `gcr.io/cloud-builders/docker`'s digest | §67e, with the user's yes |
| Mapbox URL restrictions accept a path | Mapbox's documentation, or a token minted for `/admin/` once |
| Hosting sends every matching rule's headers (so two CSPs would both apply) | moot by §2.2's design; the e2e resolver behaves so |

## 10. What waits for the user (prepared, ask first)

- **D1 with the M6 tree**, once M6 is green: the start-up variant (or the public variant directly, since the live
  project already has its server and manifest) from the developer machine, the one terminal deploy left. After it the
  admin's address is `https://bucurestiul-disparut.web.app/admin/`, and an old `/#/…` address forwards there.
- Then, in the app: Prepare the project again (the 16th item, the installer's account and roles), Install the server
  (the M6 functions: the Scheduler jobs, the probe, the release), Publish the map, and Check again (the `events` and
  `ai` checks).
- The decisions of §67: the Pages site's future (§67c, §67d), the docker builder's digest (§67e), the `ci.yml` lines
  (§67c, §67j), a new Vertex model if the probe shows a 404 (§67g), the update channel for owners without CI (§67l).

## Change requests

A workstream that needs a change outside its paths appends a row here and continues against the current contract; the
owner applies it. Ids are `CR-M6-<n>`; status `open`, `accepted`, `done` or `rejected`.

| Id | From | Target (owner) | Change | Why | Status |
| --- | --- | --- | --- | --- | --- |
| CR-M6-1 | contracts | contracts | This file, the findings record with its header, the behaviours A55–A60 and V30 and the 69 planned rows, the regenerated scenario document, `DECISIONS-for-review.md` §67, the pointers in `.agent/instructions.md`, the `setup-assistant` skill (and mirror), `web/admin_setup_assistant_skill.md` and `firebase/functions_skill.md` | the four workstreams start from one contract | done (2026-10-25) |
| CR-M6-2 | installer | server-bugs (`packages/admin/src/provision/**`, `PROVISION_ITEMS`) | §1.2 and §1.6: `hcm-installer` in `SERVICE_ACCOUNTS`, its roles and the custom role `hcmInstaller` in the role table, the item `artifact-registry` (repository `hcm`), the APIs `firebasehosting`, `firebaserules`, `firestore` | the builds run as that account and push to that repository | done (2026-10-25, server-bugs: the account, the custom role `hcmInstaller` and the role table's rows, the item `artifact-registry` after `buckets` (16 items), the three APIs; S-A04-HAPPY-INSTALLER-ACCOUNT) |
| CR-M6-3 | setup-ux | installer (the install, pipeline and site cards) | the step frame's rules: a consent note only on a card whose button asks a consent now; a progress count once per card | finding 7 | accepted (2026-10-25) |
| CR-M6-4 | setup-ux | installer (`packages/admin/src/setup/steps.ts`) | `usgs` postponable, `setupDone`'s inputs, `nextSetupStep` treating a postponed step as done | finding 16, 24 | accepted (2026-10-25) |
| CR-M6-5 | hosting | installer (`scripts/site/src/install/**`) | the bundle's `hosting.tgz` is `build:hosting`'s public tree without `admin/install/**`; `build:install` runs after `build:hosting` | §1.3, §2.5 | done (2026-10-30, installer: `build:install` packs `dist/hosting-public/` without `admin/install/**` into `hosting.tgz` and writes the bundle into `dist/hosting/`; the build stage runs it after `hosting-build`) |
| CR-M6-6 | server-bugs | setup-ux (`packages/shared/src/i18n/admin-setup/**`, `packages/ui/src/admin/setup/{self-test,hcm-setup-import}.ts`) | the labels `adminSetup.selfTest.check.events`, `adminSetup.provision.item.artifact-registry` and `adminSetup.provision.apiWaiting` (both languages), the `events` check's fix step (`STEP_OF`: Prepare the project), and on the import card a photo `apiError.photo.notReceived` links Prepare the project (its fix link, styled as the server checks' one) | `SELF_TEST_CHECKS`' `events` and `PROVISION_ITEMS`' `artifact-registry` do not compile without their labels; finding 17's "link to the server checks" | done (2026-10-25, applied by server-bugs so the tree compiles; setup-ux kept the wording, and the `events` check stays among the required checks: only the drafts' `ai` check is optional, §3.1 finding 20) |
| CR-M6-7 | server-bugs | installer (`packages/admin/src/google/{artifact-registry,clients}.ts`, `packages/test-support/src/fakes/google-artifact-registry.ts`, `packages/admin/src/app/{setup-wiring,legacy-photos}.ts`) | `repositoryPolicy` on the Artifact Registry client and `artifactRegistry` in `GoogleClients`; the fake `google-artifact-registry.ts` (repositories get and create, their IAM policy; scenario `provisioned`) registered in `upstream.ts` and `UPSTREAM_SERVICES`; the import's `reprocess` (`legacyReprocess`, `photos.reprocess`) wired | the `artifact-registry` item and the installer's repository row need them; the fake did not exist yet; the stuck photos of finding 17 | done (2026-10-25, applied by server-bugs; the installer extends the fake for its builds) |
| CR-M6-8 | server-bugs | server-bugs (self-applied) | (1) `functions/test/deploy-shape.test.ts` loads `src/index.ts` as `index.test.ts` does, not `functions/dist/index.js` (the `tests` stage runs before any build; the bundle is the same code), and builds each scheduled function's job with firebase-tools' own `jobFromEndpoint`; (2) `Clock` gains an optional `sleep` (`systemClock` has it), which the `events` check polls with; (3) `assist.translateDraft` maps a 404 to `apiError.assist.modelUnavailable` too (`functions/src/assist/translate-draft.ts`); (4) a fifth code, `apiError.photo.notReceived` (the import's line needs no parameter); (5) the role table also binds what a first functions deploy wants of the service agents (the Pub/Sub agent's `roles/iam.serviceAccountTokenCreator`; the Compute Engine default account's `roles/run.invoker` and `roles/eventarc.eventReceiver` when the project has that account), as firebase-tools' `ensureServiceAgentRoles` would otherwise write the project's policy, which `hcm-installer@` may only read; (6) the tests of other families that pinned the shorthand accounts now pin the full addresses; (7) `UpstreamControl.snapshot` in `e2e/admin/support/upstream.ts` and `propagationAnswer` in the fakes' dispatch (`upstream.ts`) | §3.2, §1.2 as implemented | done (2026-10-25; `DECISIONS-for-review.md` §69) |
| CR-M6-11 | server-bugs | installer (as the integrator: `docs/*.md`, `.agent/**`, `.agents/**`, `.claude/**`) | the documents and agent assets of what server-bugs built: `.agent/skills/firebase/functions_skill.md` (the global options and `runAs` name the full `<account>@<project>.iam.gserviceaccount.com`, `GCLOUD_PROJECT` else `GOOGLE_CLOUD_PROJECT`; `ops.onProbe`, the 69th function; the self-test's `events` check; `Clock.sleep`; `UpstreamError.googleStatus`/`reason` and `MappedUpstreamError`; the deploy-shape test), `.agent/skills/web/admin_setup_assistant_skill.md` and the `setup-assistant` skill with its mirror (16 provisioning items with `artifact-registry`; `hcm-installer@` and `hcmInstaller`; `roles/run.invoker` for the function accounts; the service identities; the propagation wait `withApiPropagation`; the import's `STUCK_PHOTO_MS` and `photos.reprocess`), `.agent/skills/quality/testing_strategy_skill.md` / `e2e_scenario_matrix_skill.md` and `docs/TESTING.md` (the fake scenarios `service-usage.propagation`, `propagationSlow`, `identityRefused`, `vertex-ai.modelUnavailable`, `artifact-registry.provisioned`; `UpstreamControl.snapshot`; the e2e's ignored upload name), `docs/MANUAL_TEST_PLAN.md` and the admin guides (68 → 69 functions, 15 → 16 items), `docs/ARCHITECTURE.md` (the probe). `docs/LESSONS.md` 260–264 were written by server-bugs (the task asked for them) | §5.1: the agent assets and `docs/*.md` are the integrator's | done (2026-10-30, the integrator: `functions_skill.md` (M6 bullet), `admin_setup_assistant_skill.md` and the `setup-assistant` skill with its mirror, `testing_strategy_skill.md`, `docs/TESTING.md` (the scenarios, `UpstreamControl.snapshot`), `docs/MANUAL_TEST_PLAN.md` and the admin guides (no function count, 16 items), `docs/ARCHITECTURE.md` (the probe, the identities, the installer)) |
| CR-M6-12 | setup-ux | setup-ux (self-applied; files no M6 workstream owns, each needed by §3.1 and §4.1) | `packages/admin/src/setup/{state,context,records,bootstrap-record,controller,ports,module}.ts` (marked lines: the step's `postponed`; `later`, `doneNote` and `liveScopes`; `ready` from the areas and `usgsReadiness`; the settled steps for the next step to open; the billing slice's `trialSince` and `createUrl`, the USGS slice's `postponedAt` and `pendingSince`, the bootstrap record's `billing.trialSince` and its `trial` request; the `notify` port, the shell's snackbar), `packages/admin/src/state/state.ts` and `packages/ui/src/admin/notice-port.ts` (a snackbar action may be a Setup text), `packages/admin/test/setup/harness.ts` (`notify`), the UI fixtures `packages/ui/test/admin/{setup,ops}/fixtures.ts`; `functions/src/setup/record-cloud.ts` (one marked line: `record-later.ts`, new), `functions/src/setup/{usgs-check,save-usgs}.ts` (`usgs.pendingSince`); `packages/admin/src/content/budgets.ts` (its `setup-ux` section: `skipUsgs`, `dismissTrial`); new tests appended to `e2e/admin/steps/{billing,status,mapbox,provision}.spec.ts` and A28's snackbar asserted in two tests of `legacy.spec.ts` (their tags added) | the behaviours of §3.1 and §4.1 live in these files (`DECISIONS-for-review.md` §70) | done (2026-10-25) |
| CR-M6-13 | setup-ux | installer (the integrator; `packages/admin/src/setup/state.ts`'s install part, the install cards, `docs/*.md`, `.agent/**`, `.agents/**`, `.claude/**`) | (1) the admin state's `ready` adds `setupDone`'s install part (the server and the site installed, from the `InstallSlice`): the shared `setupDone` and `setup-readiness.ts` already read `setup/status.install`; (2) the frame's rules for the install cards (CR-M6-3): the pipeline card (d3) shows the consent note though it has no button that asks (its `scope` stays `cloudPlatform` in `CARD_POPUP_STEPS`), and a server card in normal mode reads the Cloud Functions list of an e2e world without `google.deployed` and logs Google's 403 (the steps specs set the scenario); (3) the documents and agent assets: `docs/TESTING.md` (the eleven `setupUx` states of the tour's table, `e2e/admin/specs/shell/setup-ux-states.ts`; the new `graphic-overlap` check in *The tour's checkers*; `skipUsgs` and `dismissTrial`), `docs/LESSONS.md` (finding 6: the occlusion check samples a text's centre and the overlap check floating chrome only, so an indicator spilling 10 px over a chip's label passed; a page helper of the checkers may reference only browser globals and the other helpers, a module constant is undefined in the page), the admin guides (Create a billing account and the wait; Do it later and Home's reminder; the likely free trial and It is a paid account; Setup done with USGS later or pending), `docs/MANUAL_TEST_PLAN.md` (B1: the create page, the page goes on by itself; F: Do it later), `.agent/skills/web/admin_setup_assistant_skill.md` and the `setup-assistant` skill with its mirror (`setupDone`, the frame's rules, USGS later, the trial, the root surface); (4) a second lesson in `docs/LESSONS.md` (2026-10-30): an element that renders its own links needs the kit's `focusRing` in its styles, else the browser's ring shows, which the tour's contrast check passes on a desktop and fails only on Android's orange ring at `admin-c360-ro` (the Setup page's server checks; `DECISIONS-for-review.md` §70k) | §5.1: the agent assets and `docs/*.md` are the integrator's | done (2026-10-30, the integrator: (1) and (2) hold as built (`setupDone` reads `install`; the pipeline card's note is the frame's rule for a card whose click may ask, its scope kept); (3) `docs/TESTING.md` (the `setupUx` and `install` sections, `graphic-overlap` as check (f)), the admin guides, `docs/MANUAL_TEST_PLAN.md` B1 and B6, the skills; (4) `docs/LESSONS.md` 271 (finding 6) and 272 (the focus ring)) |
| CR-M6-14 | setup-ux | server-bugs (`functions/src/setup/self-test.ts`, the code `apiError.cloud.apiPropagation`) | (1) `usgsAfter` passes `pendingSince` in `kept` (`...defined('pendingSince', current?.pendingSince)`), so a Check again keeps the date USGS's approval has been awaited since (`usgsRecord` takes it since CR-M6-12); (2) finding 5: the propagation message ends "Try again in a minute" beside the button Retry what failed; naming the button (as `adminSetup.provision.apiDisabled` does for a disabled service) needs the code's wording or a mapping on the provisioning card, which S-A04-BAD-API-STILL-DISABLED pins to the API text | §4.1 (S-A59-HAPPY-APPROVAL-PENDING), finding 5 | done (2026-10-30, server-bugs: (1) `usgsAfter` keeps `pendingSince`, with a test in `functions/test/setup/self-test.test.ts`; (2) the code's wording ends "Wait a minute, then retry what failed." ("Așteaptă un minut, apoi reia ce nu a reușit."), which names the provisioning card's button and still reads right where the installer's submit shows it) |
| CR-M6-15 | hosting | hosting (self-applied; files no M6 workstream owns, each needed by §2.3's base path or the shared origin) | `packages/admin/src/app/config.ts` (`runtime.json`, `project.json` at `import.meta.env.BASE_URL`), `packages/admin/src/app/telemetry.ts` and `packages/admin/src/firebase/analytics.ts` (GA4 `cookie_prefix` `hcm_admin`; §2.3 names `telemetry.ts`), `functions/src/ops/tick.ts` (one line: the viewer-token refresh in the `tokens` step), `functions/src/setup/mapbox-tokens.ts` (`tokenNote` moved to the new `functions/src/api/mapbox-token-note.ts` and re-exported: the feature folders reach each other only through `api/`, so `ops/viewer-tokens.ts` cannot import `setup/`), the doc comments of `functions/src/ports/runtime-config.ts` and `packages/shared/src/api/admin.ts`; the e2e harness: `e2e/playwright.config.ts` (the e2e Hosting server for every run), `e2e/projects.ts` (`viewer/hosting.spec.ts` among the one-project specs), `e2e/scripts/build-site.ts`, `e2e/mock-apis/main.ts`, `e2e/stack/{servers,check,main}.ts`, the admin specs' address helpers (`e2e/admin/support/{test,setup-page,content}.ts`, `e2e/admin/specs/{assists,cities}/world.ts`, `e2e/admin/setup/admin.setup.ts`, `e2e/admin/harness/world.spec.ts`, the pushed link of `e2e/admin/specs/notify/push.spec.ts`), `e2e/tour/viewer.tour.ts` (the `site.*` states' tests), `e2e/support/hosting.ts` (new); `scripts/ci/e2e_build.py` (its outputs), `scripts/ci/pipeline.py` and `scripts/ci/tests/{test_pipeline,test_pipeline_stages}.py` (the `hosting-build` gate, DECISIONS §68g); `create-historic-city`'s self-host bundle, whose admin had to move under `/admin/` with the Vite base (`packages/create-historic-city/src/self-host/{bundle,server-files,tools}.ts`: the bundle's and `server/`'s Hosting folder `hosting/` with the admin in `hosting/admin/`, the template's root redirected to `/admin/` until the map is published, the admin's address `https://<id>.web.app/admin/`; their tests and `e2e/specs/starter-kit/create-city.spec.ts`; `docs/SELF_HOST.md` step 7); their tests | every admin spec's address moves in one change (§2.3, §5.3) | done (2026-10-25) |
| CR-M6-16 | hosting | installer (`scripts/site/src/install/**`, the site card's e2e) | what CR-M6-5 builds on: `build:hosting` writes the public tree to `dist/hosting-public/` always (`DEFAULT_PUBLIC_TREE_DIR`, `scripts/site/src/hosting/cli.ts`) and the deployed variant to `dist/hosting/`, where `build:install` adds `admin/install/<slug>/`; the assembler never copies the admin build's `install/`. In the e2e: `dist/e2e-hosting` (public) and `dist/e2e-hosting-start-up`, the e2e Hosting server picking the start-up tree for a browser with the cookie `hcm-e2e-variant=start-up` (`E2E_VARIANT_COOKIE`, `useStartUpVariant` of `e2e/support/hosting.ts`), so the site card's spec can show either variant's `/release.json` | §1.3, §1.7, §2.5, §7 | done (2026-10-30, installer: `--public-tree dist/hosting-public` and `--out dist/hosting` are `build:install`'s defaults; the site card's spec answers `/release.json` from the fake Cloud Build's last site build) |
| CR-M6-17 | hosting | setup-ux (`hcm-setup-mapbox`, the multi-city texts of the shared catalogue) | Setup (e) shows `setup/status.mapbox.detail` while the area's state is `ok` (the viewer token's re-mint refused: `apiError.mapbox.mintRefused`, written by `functions/src/ops/viewer-tokens.ts`) beside **Replace the visitors' token**; New city's done screen and Settings → Publishing name `https://<project>.web.app/<id>/` (§2.4) | §2.4, §2.6 | done (2026-10-30: the first part by setup-ux; the second by the integrator: `packages/ui/src/admin/cities/public-address.ts` shows `https://<origin>/<id>/` from the admin's own origin (the same Hosting site; the generic city page answers every city id, the first city also at `/`) on New city's done screen and in Settings → Publishing (`SectionContext.cityId`), with `adminContent.cities.newTab`; the texts naming `npm run site:add` replaced; unit tests and S-A50-HAPPY's address) |
| CR-M6-18 | hosting | installer (the integrator: `docs/TESTING.md`, the admin guides, kit-cli) | the tour inventory's table in `docs/TESTING.md` gains the Hosting site's states (`site.start-up`, `site.city-generic`, `site.not-found`, `e2e/tour/site-states.ts`); the admin's address `https://<project>.web.app/admin/` in `docs/ADMIN_GUIDE.*.md` and `docs/SELF_HOST.md`, and the guides' Publishing paragraph (a published city is at `https://<project>.web.app/<id>/` with no repository step; GitHub Pages and `site:add` optional); kit-cli's README (the self-host admin's address is `https://<id>.web.app/admin/` since CR-M6-15) | §2.3, §6.3 | done (2026-10-30, the integrator: `docs/TESTING.md` (the `site.*` states), the admin guides (the admin's address, Publishing with no repository step), kit-cli's README checked: `docs/SELF_HOST.md` and the README already name `/admin/`) |
| CR-M6-19 | hosting | hosting (self-applied deviation) | §2.6's `cities/{city}.mapbox.viewerAllowedUrls` is the existing `cities/{city}.mapbox.allowedUrls` (written since M2 by `setup.saveMapbox` and `setup.rotatePublicToken`): no schema change; a token without recorded addresses is left alone; at most the retirement queue's room is re-minted per tick; a refusal records `setup/status.mapbox.detail` with the area's state unchanged (DECISIONS §68e) | the field already holds exactly that | done (2026-10-25) |
| CR-M6-20 | server-bugs | server-bugs (self-applied; `packages/admin/src/setup/provision.ts`, which no M6 workstream owns, and its test) | the Provision card stays busy until the run's `setup.recordCloud` is back: a Retry what failed clicked while the previous run's record was on its way could lose to it (the server applied the older run last: the items read 13 of 16 again, `service-accounts` missing without a reason), which made S-A04-BAD-API-STILL-DISABLED fail about one run in two | finding 4's bad row, a real race for a fast second click | done (2026-10-30; `DECISIONS-for-review.md` §69i) |
| CR-M6-21 | installer | installer (self-applied deviations; files of its own, with one marked line each in `packages/admin/src/content/budgets.ts`, `packages/admin/src/home/reminders.ts`, `packages/ui/src/admin/home/{home-port,reminders}.ts`, `packages/test-support/src/fakes/{upstream,index}.ts`, `scripts/ci/{pipeline,check_bundle_budget}.py` and their tests) | (1) the step scripts are `scripts/site/src/install/steps/` (the site build's TypeScript project, bundled into `steps/*.mjs` by `steps-bundle.ts`) instead of `scripts/install/`, so no new Vitest project, knip or dependency-cruiser scope is needed; (2) the install specs are `e2e/admin/steps/install/{server,pipeline,site,update}.spec.ts` (the steps' project, one window, English) and the tour's states `e2e/admin/specs/install/{states,states.spec}.ts` (the five admin projects); (3) Home's installation tile names no release (`adminSetup.install.tileUpdate`, `tileFailed`, `tileOpen`): Home holds no bundle to compare with; (4) `setup.status` does not answer `serverRelease` (§1.7): Home reads `setup/status.install`, Setup the functions' `HCM_RELEASE`; (5) the build stage gains `install-build` and `install-budget` (`DECISIONS-for-review.md` §71e); (6) the fake Cloud Build's `installerAccount` and `siteOlderRelease` scenarios and the preset `install.provisioned` | the contract's paths and fields, as implemented | done (2026-10-30; `DECISIONS-for-review.md` §71) |
| CR-M6-22 | installer (found running the `tests` stage) | hosting (`firebase.json`'s `hosting` block and the test that pins it, `firebase/rules-tests/test/firebase-config.test.ts`) | the `rules` project's `firebase-config.test.ts` still expects Hosting's `public` to be `packages/admin/dist` and the admin's security headers on the catch-all source; since §2.1–§2.2 `public` is `dist/hosting` and the admin's policy is a header of `/admin/**` only, so 7 tests fail (`deploy targets › happyPath_rulesIndexesAndFunctionsPointAtTheirSources` and six of `admin security headers`), and the `coverage` gate has no report. The test should read the `/admin/**` rule's headers and the new `public` | the `tests` stage is red on the M6 tree for a file no installer change touches | done (2026-10-30, the integrator: `firebase-config.test.ts` reads the admin's headers from `**` and `/admin/**`, pins `public: dist/hosting` and that no CSP is sent to every path) |

## Addendum (2026-11-01): the pipeline card when the bundle cannot install the pipeline

Finding 43 of `docs/research/manual-test-2026-10-25.md` (the live test of 2026-11-01; `DECISIONS-for-review.md` §79b).
Where it differs from §1.7, §1.8 and §4.1, this addendum is the contract.

- §1.7: `InstallerPort.localBlocker('pipeline')` reads the admin's own install manifest without a token and answers
  `apiError.install.notAvailable` while `tools.docker` is null (§67e); the install cards ask it once and keep the answer
  as the install slice's `pipelineOff`, apart from the records (which keep a state, not a blocker).
- §1.8, §4.1: with `pipelineOff` (or the same answer from a look) the pipeline card (d3) shows "Not available yet: …" and
  no button, so no consent note, and the server card (d) does not say its click also installs the pipeline; Install the
  server and Update the map never submit it. With a Docker builder in the bundle nothing changes.
- §6.1 gains S-A56-BAD-NOT-AVAILABLE; §6.3 the tour state `setup.pipeline-not-available`.

## Addendum 2026-11-01: the user's decisions §67e, §73j, §73k and §76f

- §1.3: `manifest.json`'s `tools.docker` is `gcr.io/cloud-builders/docker@sha256:6a6635024a23c8ed596c26fefc744bd3c5dbe269e8d8d541f2fda2beb0664ea5`
  (the tag `29`; `DOCKER_BUILDER_IMAGE` of `@hcm/shared`, the tag tracked by `scripts/ci/check_dependency_updates.py`), so
  the pipeline target is installable from the app (§67e). `files` gains an optional `legacy`, `legacy.tgz`: the public
  tree's `admin/legacy/<city>/originals/**`, which `hosting.tgz` no longer carries (§73k; 4.5 MB without them,
  `hosting.tgz` budget 12,000 KB, `legacy.tgz` 60,000 KB).
- §1.4.3: the site build's `fetch` downloads `legacy.tgz` too and unpacks it into the tree (`HCM_UNPACK=legacy`) only
  while step (h)'s import is not complete (`CloudBuildInstallerDeps.legacyImported`, read from the importer's `detect`;
  an unreadable state keeps them); the kept bundle under `admin/install/<slug>/` then lacks `legacy.tgz`, so a later
  import that needs the originals again comes after a publish made while it is incomplete (which fetches them).
- §1.9: `SITE_PUBLISH_TRANSFER_MB` (52) while the import is not complete, `SITE_PUBLISH_TRANSFER_TRIMMED_MB` (7) once it
  is; the site card's cost line follows step (h)'s progress.
- §4.2: the tab keeps one Google token per scope (`packages/admin/src/auth/google-access.ts`, §73j): the happy path asks
  at most 4 consents, Publish the map none after the analytics consent within the hour.
- §3.3 g (step g): Create the measurement reports (§76f), one click with the `analytics.edit` consent, through the lazy
  chunk `analytics-reports` (Analytics Admin `v1beta`: `accountSummaries`, `properties/*/dataStreams`,
  `customDimensions`, `customMetrics`); rows S-A22-HAPPY-MEASUREMENT-REPORTS, S-A22-HAPPY-REPORTS-AGAIN-NOTHING,
  S-A22-BAD-REPORTS-NO-PROPERTY, S-A22-BAD-REPORTS-PERMISSION; the tour state `setup.analytics-reports`.

## Addendum 2026-11-01: findings 47–50 (the pipeline's jobs, a blocked request, a failure's attempt, push devices)

Findings 47–50 of `docs/research/manual-test-2026-10-25.md` (the live test of 2026-11-01; `DECISIONS-for-review.md` §81).
Where it differs from §1.4.2, §1.5, §1.7, §1.8 and §1.10, this addendum is the contract.

- §1.4.2 `jobs`: every Google refusal a step prints carries Google's error essentials, redacted
  (`scripts/site/src/install/steps/google-error.ts`); `run-jobs` tries a request-rate refusal (429 or `RESOURCE_EXHAUSTED`,
  `ErrorInfo` `RATE_LIMIT_EXCEEDED` or no details) again four times, after 5, 10, 20 and 40 s with jitter or
  `Retry-After`, at most 60 s each, printing a `retry` event (reason `quota`) per wait, the jobs one after the other; a
  quota (`QuotaFailure`, any other reason) ends the step with a line naming it and the new event
  `HCM_INSTALL {"event":"quota","service","metric","limit"}` (`installLogEventSchema`). `StepDeps` gains `random`.
- §1.5, §1.7: the admin reads a working pipeline build's log as it reads the server's (its retries show as `retrying`); a
  stopped build's last `quota` event is the target view's `quota`, cleared by a new build.
- §1.8: the pipeline card (d3) shows a quota with the quota's name and limit, the free-trial note and **Open the Quotas
  page** (`gcp.quotas`: `https://console.cloud.google.com/iam-admin/quotas?project={projectId}&service={service}`), then the
  log and Try again.
- Every Setup card: an in-app input clears its card's last failure (`withCount`); a Google call of the admin's transport
  with no HTTP answer names its host (`adminShell.network.blocked`), a 5xx keeps `apiError.unavailable`.
- §1.10 fakes: the Cloud Run fake makes and replaces jobs (`cloud-run.jobs.create`, `cloud-run.jobs.patch`) with the
  scenarios `jobsRateLimited`, `jobsQuotaExceeded`, `jobsWritable` (fixture `cloud-run/jobs.create.quota-exceeded`); the
  Cloud Build fake's outcomes `retriesAtJobs` and `failsAtJobsQuota` (`cloud-build.pipelineRetriesAtJobs`,
  `cloud-build.pipelineFailsAtJobsQuota`).
- M4's push (§5.4 of `docs/research/M4-interfaces.md`), finding 50: a push device has a `kind` (`token` or `fid`; none:
  `fid`), `notify.registerDevice` takes it (default `token`), FCM is addressed as it says, and a dry run's `UNREGISTERED`
  of the registration just made is recorded with a warning; the browser registers an FCM registration token (`getToken`, the
  user's approved lint exception, §81d).
- §6.1 gains S-A56-HAPPY-JOBS-RATE-LIMITED, S-A56-BAD-JOBS-QUOTA, S-A22-BAD-REPORTS-BLOCKED-HOST,
  S-A22-BAD-REPORTS-NEW-FAILURE-ONLY, S-A22-HAPPY-REPORTS-UNBLOCKED, S-A47-HAPPY-TOKEN, S-A47-HAPPY-DRY-RUN-UNREGISTERED,
  S-A47-HAPPY-LEGACY-FID; §6.3 the tour states `setup.pipeline-retrying` and `setup.pipeline-quota`.

## Addendum 2026-11-01: finding 56 (the download on a small job)

Finding 56 of `docs/research/manual-test-2026-10-25.md` (`DECISIONS-for-review.md` §82f; the imagery side is
`docs/research/M3-interfaces.md` → *Addendum 2026-11-01: findings 51–58*). Where it differs from §1.4.2 and §1.7, this
addendum is the contract.

- §1.4.2 `jobs`: `run-jobs` makes or replaces three jobs, one after the other: `raster-fetch` (1 CPU, 4 GiB) first, then
  `raster-pipeline` (4 CPU, 16 GiB) and `raster-pipeline-xl` (8 CPU, 32 GiB), each as before (`job-raster@`, 6 h, no
  retries, one task, args `run`, the buckets in the environment, the release labels).
- §1.7: the pipeline card counts as installed when all three jobs run the release (`CLOUD_RUN_JOBS`); a project installed
  before reads as not installed until the pipeline is installed again. The card's cost line names the run costs.
- §1.10 fakes: the Cloud Run and Cloud Build fakes make, provision and label the three jobs.

## Addendum 2026-11-13: the admin on its own site (the owner's decision, `DECISIONS-for-review.md` §210)

Supersedes §2.3's shared origin for a project that has the site; §2.3 stays the fallback.

| Part | Now |
| --- | --- |
| Sites | the public map on the default site `<project>`; the admin on `<project>-admin` (`adminSiteId`, `@hcm/shared`), still under `/admin/` |
| Made by | Provision's `admin-site` item (the owner's token, Update the map's consent): `sites.create`, then the two host names in Firebase Auth's authorised domains; set version 5 also runs `app-check`, `api-key` and `bucket-cors` |
| Deployed by | the site build's `hosting` step, `steps/deploy-hosting.mjs`: the project's own site found → the tree split (`scripts/site/src/hosting/admin-site.ts`) and both sites released in one `firebase deploy --only hosting`; else the tree as before |
| `firebase.json` after the split | `hosting` a list: the public map's entry (no `/admin/**` rewrite or headers; `/admin` and `/admin/…` 301 to the admin site, but `/admin/starter.json`) and the admin's (`public-admin`, the `/admin/**` rewrite and headers, every folder's header rule in order, the pages' and scripts' `no-cache` among them, `/` to `/admin/`; without `no-cache` a reload ran a cached `admin.mjs` beside the new `runtime.json` and Update the map built an unstamped image: lesson 707) |
| `runtime.json` | the admin site's copy names `adminOrigin`; the admin keeps the sign-in in IndexedDB only on that origin, else `sessionStorage` (§73a) |
| `release.json` | copied to the admin site's root (Setup's release check reads its own origin) |
| Links | the functions' `adminUrl` on the admin site once `HCM_ADMIN_SITE` is set (a server build submitted from the admin site), else `/admin/` of the public map, which forwards with the hash route |
| Allow-lists | the functions' `adminOrigins`, the worker's CORS and Private Network Access, `hostingOrigins()`, the reCAPTCHA key's domains, the browser key's referrers, the private bucket's CORS: each gains the admin site's two origins |
| Fallback | a project without the site (self-hosted, starter kit, a site id another project holds): the admin under the public map's `/admin/` with the sign-in in the tab |
