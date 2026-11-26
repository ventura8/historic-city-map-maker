# M7 contract: "Run on my computer" (the local worker) and the cheap cloud defaults

Written on 2026-11-02 from the user's decisions of 2026-11-01 ("make this as free as possible"), before any code. The
decisions log entry is `DECISIONS-for-review.md` §83. Read it with `M3-interfaces.md` (§2.3–§2.7 the job model and paths,
§4 the dispatcher, the lease and the tick, §5 the pipeline and its ports, §7 publishing and the compute-unit guard),
`M6-interfaces.md` (§1.4.2 the pipeline install, §1.9 the free tier) and its addenda of 2026-11-01 (the three Cloud Run
jobs since `DECISIONS-for-review.md` §82f).

The user's words, which every section serves:

- **A. Local worker.** Each imagery job can run on the admin's own computer instead of Cloud Run: the same pinned
  pipeline image in a `worker` mode, signed in through a local page with the owner's Google account, talking to the
  server through new admin-only callables and short-lived signed URLs; raw scans never leave the computer.
- **B. Cheap cloud defaults.** (1) Show this month's Cloud Run free-tier use and ask before a cloud run would cross it;
  (2) delete the raw USGS delivery once the city crop exists; (3) publish through Mapbox's Uploads API when the file fits
  its free allowance, MTS (behind the compute-unit guard) otherwise.

Nothing here calls a real Google, Mapbox or USGS endpoint, deploys or pushes. What only a real project can prove is
marked **UNVERIFIED**, each with how the first real run proves it (§11).

## 0. What this contract decides

1. **Where a job runs** is a job field, `runOn: 'local' | 'cloud'`, decided by the dispatcher the first time it sees the
   job queued (§3): the job's own choice, else the city's remembered choice (`auto` by default), and `auto` means
   `local` when one of the city's workers was seen within `WORKER_FRESH_SECONDS` (180 s), else `cloud`. A `local` job is
   never sent to Cloud Run: it waits (`waitReason: 'worker'`) until a worker claims it. The admin changes a job's place
   (and with it the city's choice) with `imagery.runOn` while the job holds no run.
2. **The worker** is `python -m hcm_pipeline worker` in the same pipeline image (§1). It holds the owner's Firebase ID
   token and refresh token in memory only, polls `worker.claim`, and runs the claimed job's steps **unchanged**: only
   the two ports the steps use are swapped, `DocumentStore` for the `worker.step` API and `ObjectStore` for a routing
   store (the delivery and the scratch stay on the computer; the version's files go through signed URLs). The M2M calls
   the `fetch` step makes go through `worker.urls` (`kind: 'usgs'`), which the server makes with its own USGS key.
3. **Five admin-only callables** (`worker.hello`, `worker.claim`, `worker.step`, `worker.urls`, `worker.end`; access
   `cityEditor`, App Check `off`: §2.4 says why) and one more for the admin, `imagery.runOn` (App Check enforced).
4. **Cloud Run's free tier** (§4): every cloud run is counted, when it ends, into `usage/cloudrun-YYYY-MM` (seconds from
   its dispatch to its end × the machine's vCPUs and GiB); a cloud job whose estimate would cross the free tier waits
   (`waitReason: 'free-tier'`) until the admin says OK; one made by automation also leaves an inbox item
   (`job.needsOk`).
5. **The raw USGS delivery** is deleted by `locate` (M9: of a frame it proved; one nothing proved keeps it for the admin's points, `docs/research/M9-calibration.md` §6; a frame offered whole, §17, is cut around those points out of the segments, which **Locate again** makes again from this delivery) once the city crop (`scan.tif`) and the version's `scan` are recorded
   (§5); the bucket's lifecycle for `usgs-raw/` drops from 30 to 7 days as the backstop.
6. **Mapbox's Uploads API** publishes a version whose `studio.tif` is at most `UPLOADS_FREE_MAX_BYTES` (300 MB) while
   the month's Uploads API megabytes stay within `MAPBOX_FREE_UPLOAD_MB` (10,000) and the layer's tileset is not an MTS
   one (§6). Otherwise MTS behind the compute-unit guard, as today. The version records `mapbox.via`.
7. **The admin** (§7): one new lazy chunk, `worker` (the worker's panel, the run choice, the free-tier meter and the OK),
   loaded by the Jobs page, the pipeline card and the version page; its words in a catalogue of their own
   (`packages/shared/src/i18n/admin-worker/`) so the entry does not grow.

## 1. The worker

### 1.1 The command

```text
docker run --rm -p 127.0.0.1:8765:8765 -v "$HOME/hcm-worker:/work" \
  us-central1-docker.pkg.dev/<project>/hcm/pipeline@sha256:<digest> worker --city <city> --project <project>
```

- The admin shows it ready to copy (§7), with the digest of the image the pipeline install pushed (the build log's
  `image` event, recorded by `setup.recordInstall` as `setup/status.install.pipeline.image`). Without a recorded digest
  the panel says to update the imagery pipeline first.
- **Pulling the image** (least friction, the owner needs nothing beyond Docker): Provision's repository policy of
  Artifact Registry `hcm` adds `allUsers` → `roles/artifactregistry.reader` (the repository holds only the pipeline
  image: the open-source pipeline, no secret, no configuration). Cost: a pull is internet egress billed to the owner
  (about 0.6 GB at list price, cents); anyone who learns the project id could pull it too (§10.5). Where an
  organisation policy forbids `allUsers` (domain-restricted sharing), Provision records the refusal and goes on, and the
  panel's note gives the alternative: `gcloud auth configure-docker us-central1-docker.pkg.dev` once, then the same
  command.
- `-p 127.0.0.1:8765:8765` publishes the local page on the computer's loopback only; inside the container the server
  binds `0.0.0.0:8765` (Docker's port publishing needs it), so nothing outside the computer reaches it.
- `/work` is the work folder: the delivery, the scratch and the reference cache (§1.3). The container runs as the image's
  user `10001`; the folder must be writable by it (Docker Desktop maps it; on Linux `mkdir -m 777` once, the panel's
  note says so).
- `worker --city <id> --project <id>` (`WorkerArgs`): the project gives the Hosting origin
  (`https://<project>.web.app`), the callables' origin (`https://us-central1-<project>.cloudfunctions.net`) and the
  bucket names; nothing else is configured. Under the emulators (`--emulators`, loopback addresses from the same
  variables the e2e pipeline tier uses) the same code talks to the Auth, Functions and Storage emulators.

### 1.2 The loop

1. Serve the local page (§2) and wait for a session.
2. `worker.hello {cityId, workerId, version}` once (`workerId`: `w-` and 16 hex characters, kept in the work folder across restarts since finding 77 and forgotten with the session), which
   records `cities/{city}/workers/{workerId}` and answers the poll interval.
3. Every `WORKER_POLL_SECONDS` (30) while idle: `worker.claim {cityId, workerId}` (which also refreshes the worker's
   `lastSeenAt`). A claimed job runs at once; one job at a time. While it runs, each heartbeat (`lease.until` through
   `worker.step`) refreshes `lastSeenAt` too (2026-11-12: a long `locate` or `place` showed "No computer connected" and sent new
   jobs to the cloud), and each step has a wall-time limit (`STEP_LIMIT_SECONDS`: `locate` 45 min, `place`, `align`, `merge`
   4 h, others 3 h): past it the step fails at its next checkpoint with `apiError.imagery.stepTimeLimit {step, minutes}`.
   A refused write names its fields: `apiError.invalidRequest` carries the issues' paths and codes (never a value), and the
   worker's error repeats them.
4. A claimed job runs as `run` does on Cloud Run (`runner.py`: the lease is taken by the owner
   `worker:<workerId>`, which the claim already wrote, so the run proceeds; the heartbeat, the step loop, the waits, the
   failures, the cancel), with every step of the job's type (a worker job names no machine, `DECISIONS-for-review.md`
   §82f).
5. `worker.end {cityId, workerId, jobId, outcome}` after the run: `done` whatever state the run left the job in, or
   `failed` with the error when the run crashed outside a step (the server fails the job if the worker still holds it).
6. Ctrl-C or SIGTERM: the running step stops at its next checkpoint and the job goes back to `queued` (the runner's
   SIGTERM path, unchanged); the process exits 0.

### 1.3 The ports in worker mode (`hcm_pipeline/worker/`)

| Port | Cloud Run | Worker |
| --- | --- | --- |
| `DocumentStore` | Firestore | `ApiDocumentStore`: `get`, `update`, `create`, `list_ids` as `worker.step` operations; `transact` = `get` with its update time, then `update` with `ifUpdateTime` (the same compare-and-set the Firestore adapter does, five tries) |
| `ObjectStore` | GCS JSON API | `RoutedObjectStore`: `usgs-raw/`, `work/` and `reference/` → `LocalObjectStore` under `/work` (resumable sessions are local files); `rasters/` and `uploads/` → `SignedObjectStore` (stat from `worker.urls`' metadata, GET and PUT on the signed URLs; list, delete and resumable sessions refused: no step needs them there) |
| `m2m` | `M2MClient` with the USGS secrets | `ProxyM2MSession`: each `request(endpoint, payload)` is `worker.urls {kind: 'usgs', endpoint, payload}`; login and logout are the server's |
| `secrets` | Secret Manager | `NoSecrets` (asking for one is a bug: it raises) |
| `downloads`, `stac`, `overpass` | httpx behind the address guard | the same |

`raw scans never leave the worker`: the delivery (`usgs-raw/`), the segments and the frame (`work/`) are local files;
only the version's files (`scan.tif` the city crop, its preview, the two reference images, `cog.tif`, `preview.png`,
`studio.tif`) are uploaded, each to its signed URL.

## 2. Sign-in and the local page

### 2.1 The page

- `GET http://localhost:8765/` (the panel's link says `localhost`, which Firebase Auth authorizes by default;
  `127.0.0.1` is not, **UNVERIFIED** per project): a small page served by the worker (`worker/page.py`, no template
  engine; the only dynamic values are the project id, the city id and the CSRF token, each checked against its pattern
  before it is written into the page and the page's inline JSON) that loads the Firebase JS SDK 13.1.0 from
  `www.gstatic.com/firebasejs/13.1.0/` (the admin's version, a test keeps them equal) and the project's web config from
  `https://<project>.web.app/__/firebase/init.json` at run time (never committed, never stored).
- **Sign in with Google** (`signInWithPopup`), then the page posts `{idToken, refreshToken}` to `POST /session` with
  the page's CSRF token in `X-HCM-Worker` and shows the worker's state (signed in as, the city, idle or the job and its
  step, the last error). **Sign out** posts `DELETE /session`: the worker forgets the tokens and stops claiming.
- Headers: `Content-Security-Policy: default-src 'none'; script-src 'self' https://www.gstatic.com; connect-src 'self'
  https://<project>.web.app https://*.googleapis.com; frame-src https://<project>.firebaseapp.com; style-src 'self';
  base-uri 'none'; form-action 'none'; frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: no-referrer`, `Cache-Control: no-store`.

### 2.2 What the worker holds

- The ID token (an hour) and the refresh token, **in memory only** (never on disk, never logged: the logger redacts
  both shapes). It refreshes the ID token through `securetoken.googleapis.com/v1/token?key=<web API key>` five minutes
  before it expires; a refused refresh ends the session (the page says sign in again).
- No service-account key, no USGS token, no Mapbox token, no Google OAuth token: everything the server allows is what
  the signed-in account may do through the five callables (§2.4), for the city given on the command line.

### 2.3 The local server's guards

- `Host` must be `localhost:8765` or `127.0.0.1:8765` (a DNS-rebinding page gets 421).
- State-changing requests (`POST`, `DELETE`) need `Origin` equal to `http://localhost:8765` or `http://127.0.0.1:8765`,
  `Content-Type: application/json` and the CSRF token (32 random bytes, per process, in the page only); anything else is
  403. `GET /state` (the page's status poll) answers the same origin only (no CORS headers at all).
- The token must be a Firebase ID token of this project: the worker calls `worker.hello` with it before keeping it, so
  a token of another project or a non-admin is refused at once and the page shows why.

### 2.4 The callables (registry rows; access `cityEditor`, App Check `off`)

App Check cannot attest a process on the owner's computer (no reCAPTCHA, no device attestation), so the worker family
runs with `enforceAppCheck: false`, the first callables without App Check; the ID token of a city editor is the
credential, and each callable is narrowed to what one job needs (§10).

| Callable | Request | Does | Answers |
| --- | --- | --- | --- |
| `worker.hello` | `{cityId, workerId, version}` (`version`: the release the image was built from, `HCM_RELEASE` set by the installer's `--build-arg`; 0.0.0 for an unstamped image, lesson 704; the admin's site must revalidate `admin.mjs` or a stale admin builds an unstamped image, lesson 707) | sets `cities/{city}/workers/{workerId}` (`uid`, `version`, `startedAt` once, `lastSeenAt`, `state: 'idle'`) | `{pollSeconds, heartbeatSeconds}` |
| `worker.claim` | `{cityId, workerId, types?}` | refreshes `lastSeenAt`; in one transaction, the oldest `queued` job of the city with `runOn: 'local'`, due, not cancelled, a pipeline type (one of `types`, the job types the worker's image runs, when it names them: an older image leaves a newer type queued; 2026-11-09), attempts left → `starting`, `attempt + 1`, `dispatchAt`, `lease {owner: 'worker:<id>', until: now + LEASE_SECONDS}`, `worker {id, uid, claimedAt}`, `machine` removed, `waitReason` removed; the worker doc `busy` with `jobId` and `outdated: false` (the claim's image check passed; lesson 708) | `{job: {jobId} \| null}` |
| `worker.step` | `{cityId, workerId, jobId, op}` with `op` one of `get {path}`, `update {path, fields, ifUpdateTime?}`, `create {path, data}`, `list {collection}` | the document operation, on the allow-list of §2.5 only, while the caller's worker holds the job (`job.worker.id == workerId`, `job.worker.uid == uid`, and no other owner's live lease) | `get`: `{data, updateTime}`; `update`: `{ok}` (`ok: false` when `ifUpdateTime` no longer matches); `create`: `{created}`; `list`: `{ids}`, and for the city's versions also `skipped` (how many failed their schema and were left out; an older server sends none) |
| `worker.urls` | `{cityId, workerId, jobId, request}`: `{kind: 'objects', objects: [{path, method: 'GET' \| 'PUT', contentType?}]}` (at most 20) or `{kind: 'usgs', endpoint, payload}` | objects: each path on the allow-list of §2.5 → a V4 signed URL valid `WORKER_URL_SECONDS` (900 s), a PUT bound to its content type, with the object's metadata when it exists; usgs: the M2M call with the server's key, its payload checked (§2.5) | `{objects: [{path, url, method, headers, expiresAt, exists, size?, generation?, md5?}]}` or `{usgs: <M2M data>}` |
| `worker.end` | `{cityId, workerId, jobId, outcome: 'done' \| 'failed', error?: {code, message}}` | the worker doc `idle` with `lastJob`; `failed` on a job the worker still holds unfinished → the job and its version `failed` (`error.code` an `apiError.*` code, else `apiError.imagery.processingFailed`) | `{status}` |

Every callable refuses when `ops/guard` is red (`apiError.guardPaused`), except `worker.end` and `worker.step`'s writes
that end a job (a run in progress must be able to stop cleanly).

### 2.5 The allow-lists

Documents (`worker.step`), for the claimed job `J` of city `C` with its version `V`, layer `L` and parameters:

| Path | get | update | create | list |
| --- | --- | --- | --- | --- |
| `cities/C` | yes | | | |
| `cities/C/jobs/J` | yes | the pipeline's fields only (`WORKER_JOB_FIELDS`); `status` to `running`, `queued`, `waiting_usgs`, `awaiting_gcps`, `awaiting_approval`, `failed`, `cancelled` (the last only after `cancelRequested`); `lease` only its own owner or removed | | |
| `cities/C/jobs/J/logs/*` | | | yes (`jobLogDocSchema`) | yes |
| `cities/C/layerVersions/V` | yes | the pipeline's fields only (`WORKER_VERSION_FIELDS`); `state` to `processing`, `needs_gcps`, `awaiting_approval`, `failed`, `cancelled` | | |
| `cities/C/layerVersions/<params.basedOn>` (`regeoref`) | yes | | | |
| `cities/C/layerVersions/<params.parts[].versionId>` (`layer-join`, M8) | yes | | | |
| `cities/C/layers/L` | yes | | | |
| `cities/C/usgsScenes/<params.entityId>` (`usgs-import`) | yes | | | |
| `cities/C/imageryPasses/<mission>-<camera>-<date>` of `params.entityId` (`usgs-import`, M9: `docs/research/M9-calibration.md` §2) | yes | | | |
| `cities/C/layerVersions` and every `cities/C/layerVersions/<id>` (M15 *Joint solve*: the frames a proved frame is joined to, `steps/aligning.py`) | yes | | | yes (the collection's ids) |

The versions of the city are read-only to every job (target `held`, `functions/src/worker/allow-list.ts`): a run never writes a
version but its own, and nothing of another city (`S-A62-HAPPY-HELD-FRAMES`, `S-A62-BAD-HELD-FRAMES-WRITE`). They hold what the
owner's admin pages already show, to the owner's own computer; DECISIONS-for-review.md §107. The list holds only the versions that pass
`layerVersionDocSchema`, and a `get` of a version that fails it answers `{data: null, updateTime: null}`, logged as *worker skipped an
invalid version* with its path, fields (`(document)` for an issue of the whole document) and codes (never values): a stored version an
earlier writer left past the schema is no partner and never fails the run (lesson 493, `S-A62-BAD-HELD-UNREADABLE`). The list's
`skipped` counts the versions it left out, and the pipeline writes *N of the city's frames could not be read and were left out* to the
owner's job log (lesson 494); a pipeline before it ignores the field, and one after it reads none from an older server as 0. Every other target of the list still fails loudly on an invalid
document; the log lines' list is unchanged.

Each write is merged into the current document and the result validated with the shared schema before it is stored
(`jobDocSchema`, `layerVersionDocSchema`, `jobLogDocSchema`); `updatedBy` is `system:pipeline`, as the Cloud Run run
writes. A finished job (`succeeded`, `failed`, `cancelled`) takes no more writes but its log lines.

Objects (`worker.urls`): GET `rasters/C/L/V/*`, `rasters/C/L/<basedOn>/scan.tif` (`regeoref`), each
`rasters/C/<part.layerId>/<part.versionId>/scan.tif` (`layer-join`, M8), the job's `params.uploadPath` (`geotiff-import`), and
`rasters/C/<any layer>/<any version>/align.tif` (M15: each proved frame's image at 5 m, which a later frame's film ties are
measured on); PUT `rasters/C/L/V/<VERSION_FILES>` only. Nothing else: the delivery, the scratch
and the reference cache (since M15 *Terrain* also the city's Copernicus DEM surface, which the worker reads from the public tiles itself,
like Sentinel-2's) stay on the computer, so no signed URL ever names them.

USGS (`worker.urls`, `kind: 'usgs'`): `download-options` with `datasetName == params.dataset` and `entityIds ==
[params.entityId]`; `download-request` with one download of `params.entityId` and `label == 'hcm-<J>'`;
`download-retrieve` and `download-order-remove` with `label == 'hcm-<J>'`. Any other endpoint or payload →
`apiError.worker.refused`. The answer is M2M's `data` as USGS sent it (the delivery URLs in it are USGS's own short-lived
signed addresses).

## 3. Where a job runs (the dispatcher)

- `JOB_WAIT_REASONS` gains `worker` (a `local` job waits for a worker to claim it) and `free-tier` (a `cloud` job waits for
  the admin's OK, §4). `RUN_PLACES = ['local', 'cloud']`, `RUN_CHOICES = ['auto', 'local', 'cloud']`.
- `cities/{city}/workers/choice` (`runChoiceDocSchema`: `{choice}` + the stamp) is the city's remembered choice, written by
  `imagery.runOn` only; absent → `auto`.
- `dispatchJob` for a queued pipeline job, after the attempts check: `place = job.runOn ?? placeFor(city)`; a job without
  `runOn` gets it written. `local` → `waitReason: 'worker'`, nothing else. `cloud` → the free-tier check (§4.3), then
  the guard and the capacity as before. A local run takes no Cloud Run slot (`RUNNING_JOBS_MAX` counts executions).
- `imagery.runOn {cityId, jobId?, runOn, freeTierOk?}` (access `cityEditor`, App Check enforced): without `jobId`, the
  city's choice (`auto`, `local` or `cloud`); with `jobId`, the job's place (`local` or `cloud`) and the city's choice
  too, allowed while the job holds no run (`queued`, `waiting_usgs`, `awaiting_gcps`; else `apiError.imagery.versionState`):
  `runOn` written, `worker` and `waitReason` cleared, and `freeTierOk: {by, at}` when `freeTierOk` is true and the place
  is `cloud`; a `queued` job is then dispatched again by its trigger.
- `imagery.tick`'s lost-run step: a `running` (or `starting`) job with `runOn: 'local'` whose lease lapsed (no worker
  heartbeat for `LEASE_SECONDS`) goes back to `queued` (`waitReason: 'worker'`, `worker` removed) with a log line
  `apiError.imagery.workerLost`; its attempt stays counted (the dispatcher fails it past `JOB_MAX_ATTEMPTS`).
- `imagery.retry` of a failed local run (`runOn: 'local'`, `localOnly`, an `archive-series`) by the owner: allowed past
  `JOB_MAX_ATTEMPTS` (the dispatcher's `attemptsExhausted` included), with `attempt` back to 0 so `worker.claim` takes it
  again; the cap stops paid cloud work looping and a local run costs none. A publish keeps its cap (`retryPastCap` of
  `@hcm/shared`; `docs/research/M3-interfaces.md` §4.5; live report of 2026-11-12).

## 4. Cloud Run's free tier

### 4.1 The numbers

`CLOUD_RUN_FREE_TIER = {vcpuSeconds: 180_000, gibSeconds: 360_000}` a month (the user's figures; Cloud Run's
request-based free tier; jobs may be billed against the instance-based tier's 240,000 and 450,000 instead: **UNVERIFIED**,
the lower figures are the conservative ones). `JOB_MACHINE_SIZES`: `fetch` 1 vCPU / 4 GiB, `std` 2 / 8, `xl` 4 / 16
(`CLOUD_RUN_JOBS`; 4 / 16 and 8 / 32 until 2026-11-12, §4.6), the one source of the installer's three jobs (`PIPELINE_JOBS`). `CLOUD_RUN_ESTIMATE_SECONDS`: a download phase 1,800 s on `fetch`, a processing phase 2,700 s on `std`
and 3,600 s on `xl`.

### 4.2 Counting

`imagery.onJobWrite`, on a transition out of `starting` / `running` of a job with `runOn` not `local`, a `machine` and a
`dispatchAt`, in one transaction: unless `job.usageCountedAt` already equals `dispatchAt` (a redelivered event), adds
`(now − dispatchAt)` seconds × the machine's vCPUs and GiB to `usage/cloudrun-<usageMonth(now)>`
(`cloudRunUsageDocSchema`: `month`, `vcpuSeconds`, `gibSeconds`, `runs`, the stamp) and sets `usageCountedAt`. The
document is the project's (every city's runs); admins read it (`usage/*`).

### 4.3 The OK

`estimateCloudRun(job)`: the phases still to run (the download phase when `DOWNLOAD_STEPS` are pending, then the
processing phase on `xl` for a KH-9 panoramic frame or after an escalation, else `std`) × `CLOUD_RUN_ESTIMATE_SECONDS` ×
the sizes. Before a cloud dispatch that is not a hand-over (§82f), when `job.freeTierOk` is absent and this month's use
plus the estimate passes either figure, the job stays `queued` with `waitReason: 'free-tier'`; a job created by
automation (`createdBy` a `system:` writer) also raises the notification `job.needsOk` (warning, push) whose inbox item
opens the version. The admin's OK is `imagery.runOn {jobId, runOn: 'cloud', freeTierOk: true}`; "Run on my computer" is
`runOn: 'local'`.

### 4.5 The daily cap counts only cloud work (2026-11-12)

`JOBS_PER_DAY` (10 a day per project) and a city's own share bound the paid Cloud Run work, so a job that runs on the
owner's computer never counts toward them: `runOn: 'local'` or `localOnly` (`functions/src/imagery/limits.ts`). When the
city's remembered choice (`cities/{city}/workers/choice`) is `local`, a new import, upload, landsat or delivered-order
import and a join (its missing frames and the `layer-join`) start past the cap, after the budget guard only, and each new
job is recorded `runOn: 'local'` at its creation, so the decision stays on the job. `auto` and `cloud` keep the cap. A
counted job moved from the computer to the cloud (`imagery.runOn`, "Run in Google Cloud") is checked against the budget
guard and today's caps first (`apiError.imagery.dailyLimit`) and then counts on the day of the move (`countedAt`); its
cloud dispatch still waits for the free-tier OK (§4.3). `JOBS_PER_DAY` is unchanged. Scenarios: S-A12-HAPPY-LOCAL-PAST-DAILY-CAP,
S-A12-BAD-RUNON-CLOUD-PAST-CAP.

### 4.4 What the admin shows

On the Jobs page and the pipeline card: "Cloud Run this month (estimate): 12,345 of 180,000 vCPU-seconds · 45,678 of
360,000 GiB-seconds", a bar for the larger share, from `usage/cloudrun-<month>`; on a version waiting for the OK, the
estimate and the two buttons.

### 4.6 The cheap cloud defaults (2026-11-12, reports/resource-audit.md §4)

The owner's principle: the app runs on modest hardware and costs little in the cloud. Every setting below was checked against the
cheapest value that is still safe; `functions/test/cost-shape.test.ts` holds the functions' table (memory, timeouts, no
`minInstances`, no explicit CPU, at most 5 instances, no schedule more often than every 15 minutes), `packages/shared/test/api/worker.test.ts`
and `scripts/site/test/install-steps.test.ts` the jobs'. Prices are Google's list prices (Cloud Run jobs $0.000018 a vCPU-second and
$0.000002 a GiB-second past the free tier; functions $0.000024 and $0.0000025); durations not measured in the cloud are **UNVERIFIED**.

**Cloud Run jobs** (`JOB_MACHINE_SIZES`, the installer's `PIPELINE_JOBS`):

| Job | Today → proposed | Why |
| --- | --- | --- |
| `raster-fetch` | 1 vCPU / 4 GiB → keep | a download is network-bound (finding 56); the scratch folder is memory and holds the delivery |
| `raster-pipeline` (`std`) | 4 / 16 → **2 / 8** | GDAL's cache and a warp's memory follow the machine (`rasters.gdal_memory`, from `track/stripfix`, merged 2026-11-13: 512 and 1,024 MB on 8 GiB; a warp of a 1 GB scan 1.2 GB, measured) and an atlas is pasted part by part (3.8 to 1.7 GB, measured); a 2,700 s phase takes 5,400 vCPU-s and 21,600 GiB-s instead of 10,800 and 43,200: **16 free runs a month, not 8**; past the free tier $0.14 a run instead of $0.28 |
| `raster-pipeline-xl` (`xl`) | 8 / 32 → **4 / 16** | the escalation after an out-of-memory exit and a KH-9 panoramic frame; a frame is never joined in memory (finding 57); past the free tier $0.37 an hour instead of $0.75 |
| out-of-memory retry | keep | `fetch` → `std` → `xl`, then `apiError.imagery.outOfMemory`: the smaller defaults stay safe. Risk: a frame that needed more than 16 GiB now fails where 32 passed; **UNVERIFIED** until a real KH-9 frame runs (§11) |

A run on 2 vCPUs may take longer than on 4 (the CPU-bound warp: 2.6 times the wall time on 2 threads against 16, measured on the NUC);
`CLOUD_RUN_ESTIMATE_SECONDS` stays 2,700 s for the OK, and the meter counts what a run really took (§4.2).

**Functions** (firebase-functions gives every function 1 vCPU up to 2 GiB unless `cpu` is set; nothing sets it):

| Function(s) | Today → proposed | Why |
| --- | --- | --- |
| every function | `minInstances` none → keep | an idle project keeps no instance warm: nothing billed while idle |
| global options | us-central1, `maxInstances` 5, concurrency 80, 256 MiB, 60 s → keep | the smallest memory; concurrency 80 lets one instance serve a burst; `cpu: 'gcf_gen1'` (a sixth of a vCPU at 256 MiB) would force concurrency 1 and more instances, so it is not proposed |
| callables (about 50: `admin.*`, `setup.*`, `imagery.*`, `worker.*`, ...) | 256 MiB, 60 s (`imagery.search` 540 s; `imagery.markScene` **512 MiB**), `maxInstances` from the registry → keep | short reads and writes; billed only while a request runs; `markScene` rewrites the date plan (259 MiB used on 256 MiB, 2026-11-20) |
| `worker.starter`, `telemetry.reportError` (HTTPS) | 256 MiB, their registry caps → keep | |
| Firestore triggers (`history.*`, `publish.on*`, `imagery.onJobWrite`, `notify.onEvent`, `ops.onProbe`), `ops.onBudget` | 256 MiB, 60 s → keep | |
| `imagery.onJobWrite` | → also dispatches every city's queued jobs when a run leaves `starting` / `running` | so the tick can run every 15 minutes (S-A12-HAPPY-FREED-PLACE) |
| `photos.onUpload` | 2 GiB, concurrency 1, 300 s → **1 GiB** | the thumbnail comes from the 2,048 px web WebP, so the original is decoded once: 200 MP measured on the NUC (`sharp` 0.35.5) peaked at 321 MB (JPEG with EXIF orientation 6) and 255 MB (PNG); CPU 1.8 to 1.1 s (JPEG), 3.3 to 1.6 s (PNG): **half the GiB-seconds and about 40 % fewer vCPU-seconds a photo** (S-A08-HAPPY-THUMB-FROM-WEB) |
| `imagery.publish` | 1 GiB, 1,800 s, 1 instance → **512 MiB** | both upload paths (MTS multipart, the Uploads API's S3 `PUT`) stream the file from the bucket and never hold it; half the GiB-seconds of a publish |
| `imagery.onRasterUpload` | 512 MiB, concurrency 1, 120 s → **256 MiB** | it reads a file's first bytes and writes two documents |
| `imagery.tick` | every 5 min, 512 MiB, 540 s, 1 instance → **every 15 min** | 8,640 → 2,880 runs a month (−5,760); a queued job is dispatched by `imagery.onJobWrite` at once, and the waiting ones when a run ends; what remains for the tick (a lost run, a USGS wait over, a lost event, the noWorker offer after 15 minutes, own tiles one version a tick) tolerates 15 minutes. Memory kept: the harvest's answers and every city's jobs in one run |
| `ops.tick` | every 15 min, 540 s → keep | |
| `publish.buildManifest` | 512 MiB, 300 s, 1 at a time → keep | a city's manifest is built in memory |
| `export.build` | 1 GiB, 30 min, 2 → keep | the zip, under 2 GiB |
| `assist.geocode` | 256 MiB, 60 s, 1 → keep | Nominatim's one a second |

**Billed while idle, and storage**:

| Item | Today → proposed | Why |
| --- | --- | --- |
| Cloud Scheduler | 2 jobs (`ops.tick`, `imagery.tick`) → keep | three jobs a billing account are free |
| Instances | none warm → keep | |
| `worker.claim` polling | every 30 s for ever → done by `track/stripfix` (an idle worker asks less often: `worker/pace.py`) | about 78,000 calls a month a worker |
| Pipeline images (Artifact Registry `hcm`) | the two newest kept (about 1 GB each) → keep | about $0.10 a month; the second is the rollback while a run uses it |
| Functions' images (`gcf-artifacts`) | kept 1 day → keep | |
| Private bucket | STANDARD, soft delete off; lifecycle `tmp/` 1 day, `uploads/` 7, `work/` 14, `usgs-raw/` 7 (the delivery is deleted after the crop), `reference/` 90, `exports/` 7 → keep | Nearline would halve the price of originals but loses Cloud Storage's always-free 5 GB of STANDARD in us-central1 and bills each read |
| Public bucket (tiles, photos, manifest) | STANDARD; derivatives and own tiles `public, max-age=31536000, immutable`, the manifest 60 s → keep | Google's edge cache serves repeated reads, so egress is paid once per edge, not per visit |

**Estimated monthly saving.** A quiet month (no import) was already inside the free tier, and stays so with headroom: the tick's
5,760 fewer runs at about 2 s and 1 vCPU each (**UNVERIFIED**: one look at Cloud Monitoring) return about 11,500 vCPU-seconds and
5,800 GiB-seconds, a sixteenth of the free vCPU-seconds, and their Firestore reads (a query a part a city, about 40 a run with two
cities: about 230,000 reads). A busy month of 20 cloud imports (each 1,800 s on `fetch` and 2,700 s on `std`) cost, past the free
tier, about $2.90 (269,000 vCPU-seconds and 1,016,000 GiB-seconds) and now about $0.45 (150,000 and 579,000): **about $2.50 a month**,
and **twice the free processing runs (8 → 16)**; past that, each `std` run costs half ($0.28 → $0.14) and each `xl` hour half
($0.75 → $0.37). Photos and publishes save half their GiB-seconds (a few cents a month for a few hundred photos).

## 5. The raw USGS delivery

- `locate`, after `scan.tif` is uploaded and the version's `scan` written, deletes the job's delivery
  (`steps.fetch.gcsPath`, a `usgs-raw/` object) and logs it. A retry that needs it again finds `fetch`'s recorded
  output gone and downloads again (`M3-interfaces.md` §5.2's skip rule, unchanged). On the worker the same call deletes
  the local file.
- `PRIVATE_BUCKET_LIFECYCLE`'s `usgs-raw/` goes from 30 to 7 days: the backstop for a delivery whose job never reached
  `locate` (Provision applies it when the owner runs step c again).
- Another city's job of the same frame that is between `fetch` and `extract` at that moment fails `extract` and its
  retry downloads again (accepted: two cities importing the same frame within minutes is rare).

## 6. Mapbox's Uploads API

- What the research says (`platform-research.json`, the Mapbox area, verified 2026-10-11): the Uploads API takes an 8-bit
  GeoTIFF up to 10 GB; its processing is billed by the megabyte, 10,000 MB a month free, then $0.007/MB, and uses **no
  compute units**; it is "legacy" (no end date); it picks the zooms itself (no `maxzoom`); a tileset made by MTS cannot be
  replaced through it; Console uploads of at most 300 MB, 20 a month, are free and go through it.
- The publisher's `guard` step chooses the path: **uploads** when `output.studio` exists with `bytes <=
  UPLOADS_FREE_MAX_BYTES` (300 MB, `STUDIO_MAX_BYTES`), the month's `uploadsApiMb + bytes / 1e6 <=
  MAPBOX_FREE_UPLOAD_MB`, and the layer's `mapbox.origin` is absent, `uploads` or `studio`; otherwise **mts**, the guard of
  `M3-interfaces.md` §7.2 unchanged.
- **uploads** path: `upload` = `POST /uploads/v1/{user}/credentials` → the S3 `PUT` of `studio.tif` (SigV4 with the
  temporary credentials, streamed from the private bucket) → `POST /uploads/v1/{user}` `{tileset: tilesetIdFor(user,
  name), url, name}`; `tiles` polls `GET /uploads/v1/{user}/{upload}` (`complete`, `error`) then the TileJSON smoke test;
  `finalize` as for MTS with `mapbox.origin: 'uploads'`, `uploadsApiMb += bytes / 1e6`, `uploadsApiPublishes + 1`, no
  compute units. The token is the same `mapbox-sk-tiles`, which must also carry `uploads:read` and `uploads:write`
  (Setup's Mapbox step lists them); a 401 or 403 on the credentials call, or an upload that ends in `error`, falls back to
  the MTS path once (the log says why).
- The version records `mapbox.via`: `uploads`, `mts` or `studio`; the version page says which.

## 7. The admin

- One lazy chunk, `worker` (`packages/admin/src/worker/`, `packages/ui/src/admin/worker/`), budget row
  `"worker": 5` (KB gzip), loaded by the Jobs page, the pipeline card (`hcm-setup-pipeline`) and the version page only
  when they show it; its words in `packages/shared/src/i18n/admin-worker/{ro,en}.ts`, a catalogue the entry does not
  import (the `i18n` gate checks its parity like every folder's).
- `<hcm-worker-panel>` (Jobs page, pipeline card): the worker's state ("Your computer is connected" with when it was last
  seen and the job it works on, or "No computer connected"), the command with **Copy**, the notes (the work folder, the
  gcloud alternative), the city's choice (**Run on my computer when it is connected** / **Always on my computer** /
  **Always in Google Cloud**: `auto`, `local`, `cloud`), and the free-tier meter (§4.4).
- `<hcm-run-place>` (the version page of an unfinished version whose job holds no run): where it runs, **Run on my
  computer** / **Run in Google Cloud**; for `waitReason: 'free-tier'` the estimate, the month's use and **Run in Google
  Cloud anyway** (the OK) / **Run on my computer**; for `waitReason: 'worker'` "Waiting for your computer" and the
  command's link to the Jobs page.
- Every state joins the tour's inventory (`e2e/tour/states.ts`) and passes `expectStateSound`.

## 8. Data model changes (done with this contract: `packages/shared`)

| Where | Change |
| --- | --- |
| `JOB_WAIT_REASONS` | + `worker`, `free-tier` (and `pipeline/tests/contracts/enums.json`) |
| `jobDocSchema` | + `runOn`, `worker {id, uid, claimedAt}`, `freeTierOk {by, at}`, `usageCountedAt` |
| `LAYER_TILESET_ORIGINS` | + `uploads` |
| `layerVersionDocSchema.mapbox` | + `via` (`PUBLISH_PATHS`: `uploads`, `mts`, `studio`) |
| `usageDocSchema` (`usage/mapbox-*`) | + `uploadsApiMb`, `uploadsApiPublishes` |
| new | `workerDocSchema`, `runChoiceDocSchema`, `cloudRunUsageDocSchema`; `FIRESTORE_PATHS.workers`, `.worker`, `.runChoice`, `.cloudRunUsage` |
| `NOTIFICATION_KINDS` | + `job.needsOk` |
| `PRIVATE_BUCKET_LIFECYCLE` | `usgs-raw/` 30 → 7 days |
| `API_ERRORS` | + `apiError.worker.notHolder`, `apiError.worker.refused`, `apiError.imagery.workerLost` |
| `CALLABLES` | + the five `worker.*` rows (owner `fn-worker`) and `imagery.runOn` |
| `@hcm/shared` `api/worker.ts` | the constants of §1–§4 and the request and response schemas |

Rules: `cities/{city}/workers/{doc}` read for the city's members, never written by a client (rules tests: the
allow/deny pair). Indexes: `jobs` by `runOn`, `status` then `createdAt` (the claim's query).

## 9. Scenarios (behaviours A62–A64 and P04; registered with this contract as `planned`)

| Behaviour | Happy | Bad |
| --- | --- | --- |
| A62 Run on my computer (admin) | the panel shows the connected worker and the command; a job chosen for the computer is claimed and finishes | no worker: the job waits and says so; the choice cannot change while the job runs |
| A63 Cloud Run's free tier (admin, functions) | the meter shows the month's use; the OK starts the run | a run past the free tier waits for the OK, an automated one with an inbox item |
| A64 The free Uploads path (functions) | a small file publishes through the Uploads API without compute units, `via: 'uploads'` | too large, the month's allowance used, an MTS tileset or a token without the scope → MTS behind the guard |
| P04 The local worker (pipeline) | the worker claims a job and finishes it through `worker.step` and signed URLs; raw files never uploaded | another worker's job, a path off the allow-list, a forged origin or Host on the local page, a refused refresh |
| P01 (added rows) | the delivery is deleted after `locate` | a retry after the deletion downloads again |

The exact ids are in `e2e/scenarios.json`.

## 10. Security review

1. **Token scope.** The worker holds a Firebase ID token and refresh token of the signed-in Google account, in memory.
   What that token can do is what that account can already do in the admin (it is a city editor's token: the rules and
   every callable apply as in the browser); the worker family adds the job-scoped document and object operations of
   §2.5 and nothing project-wide. It holds no service-account key and no USGS or Mapbox secret, so a stolen worker
   process leaks no long-lived credential; the refresh token is the long-lived part, revoked by signing out of the
   Google account's sessions (Firebase revokes refresh tokens on a password change or `revokeRefreshTokens`), which the
   admin guide says.
2. **Signed URL scope and lifetime.** One object per URL, 15 minutes, PUT bound to its content type, only the claimed
   job's version files (PUT) and its inputs (GET), only while that worker holds the job. A leaked PUT URL can overwrite
   one file of one unfinished version for 15 minutes: the version is then wrong, not the public map (nothing reaches the
   map before approval; the georeferencer shows the files).
3. **A malicious local process.** A process of the same user on the computer can read the container's memory or the
   work folder anyway: it gets the token (the account's access) and the raw scans (public-domain imagery). The local page
   does not widen that: the tokens never travel back out of the worker (`/state` says only the account's e-mail and the
   job), and a process of another user cannot reach the container's memory. Out of scope: an attacker who already runs
   code as the owner.
4. **CSRF and DNS rebinding on 127.0.0.1.** Any web page the owner visits can send requests to `localhost:8765`: the
   `Host` check stops a rebinding name; the `Origin` check, the JSON content type (a cross-origin form cannot send it
   without a preflight the server does not answer) and the per-process CSRF token stop a cross-site `POST /session` that
   would plant an attacker's token (which would make the worker work for the attacker's project: harmless to the owner
   but refused anyway) or `DELETE /session`; `GET /state` sends no CORS headers, so another origin cannot read it.
   `frame-ancestors 'none'` stops clickjacking of the Sign in button.
5. **Public image.** `allUsers` may pull the pipeline image: it holds no secret (the gates' secret scans run on the
   tree it is built from); the cost of others' pulls is the owner's egress (§1.1). The alternative keeps the repository
   private (`gcloud auth configure-docker`).
6. **App Check off for `worker.*`.** The calls carry a verified ID token of a city editor; each is bound to a job the
   caller's worker claimed; the guard pauses them; `worker.urls` signs at most 20 objects a call and the instance cap is
   two. The admin's own callables keep App Check.
7. **USGS through the server.** The worker never sees the USGS application token or API key; the proxy accepts four
   endpoints with payloads bound to the claimed job's scene and label, so a worker cannot use the project's USGS account
   for anything else.

## 11. UNVERIFIED, and how the first real run proves it

- Firebase Auth's default authorized domains include `localhost` on this project: the first sign-in on the local page.
- V4 signed PUT URLs from the functions' runtime account (`signBlob` on itself, as the export's GET): the first local
  run's `scan.tif` upload.
- The Uploads API's billing (no compute units, 10,000 MB free) and its replacement of an Uploads-made tileset: the first
  publish through it, then the Mapbox account's statistics page.
- Cloud Run jobs' free tier (request-based 180,000 / 360,000 versus instance-based 240,000 / 450,000): the first month's
  billing report against `usage/cloudrun-<month>`.
- `allUsers` reader on the `hcm` repository in a project without an organisation: the first `docker pull`.

## 12. Ownership

One milestone, four workstreams in one tree: **shared** (this contract, `packages/shared`, the scenario rows; first),
**fn-worker** (`functions/src/worker/`, the signer's PUT, the USGS proxy, the tick's lost local run, the rules, the
install record's image), **fn-cost** (the dispatcher's place and free tier, the usage count, `imagery.runOn`, the
notification, the Uploads API path), **pipeline** (`hcm_pipeline/worker/`, the raw deletion, pytest), **admin** (the
`worker` chunk, Provision's repository binding, the tour states and the admin specs). The integrator (shared) runs the
gates and writes the docs.

## Addendum (2026-11-02, the integrator)

- §8's `CALLABLES` row as built: the registry is split by its consumers (`DECISIONS-for-review.md` §83b, `docs/LESSONS.md`
  337). `ADMIN_CALLABLES` (`packages/shared/src/api/registry.ts`) holds every callable but the worker's, `imagery.runOn`
  included; `WORKER_CALLABLES` and the five request and response schemas are in `worker-calls.ts`; `CALLABLES`
  (`callables.ts`) is both, for the functions, the tests and the e2e mock server. The admin imports `ADMIN_CALLABLES` and
  `CALLABLE_NAMES` only, so the worker's schemas never reach its bundle.
- §7's budget row is `"worker": 7` (5.5 KB measured); the admin's total budget went from 620 to 630 KB (§83b).
- §6 as built: the publish records the path as a job step of its own, `uploads` (§83f); the minted `mapbox-sk-tiles`
  token does not carry `uploads:read` and `uploads:write` yet, so a publish falls back to MTS once (§83i, PROPOSED).
- §1.2 step 6: the first SIGTERM or Ctrl-C after the worker ran a job was lost in three of five e2e runs; a second one
  stops it (§83j, OPEN).

## Addendum (2026-11-02, after the split `all` of `d7fe0c9`)

- §1.2 step 6 as fixed (`DECISIONS-for-review.md` §83j RESOLVED, `docs/LESSONS.md` 342): one SIGTERM or Ctrl-C stops the
  worker at any moment. The runner's handler tells the loop's, neither takes a lock, the loop's waits look at the signal's
  flag every 0.25 s, and a stop taken while a job is claimed requeues it at the run's first checkpoint, no step started.
  `pipeline/tests/integration/test_worker_stop.py` (S-P04-BAD-ONE-SIGNAL) pins it.
- §4.3's notification `job.needsOk` is one of the push kinds the rules allow (`firebase/firestore.rules`
  `validPushKinds`, §83k, `docs/LESSONS.md` 340); it was missing, and every save of the push settings was refused.

## Addendum (2026-11-02, the live test of the local worker: findings 65–69)

The owner's request: "make sure all of this is automagic for the admin!!!" (`docs/research/manual-test-2026-10-25.md`
findings 65–69, `DECISIONS-for-review.md` §85). What changes in this contract:

- **§1.1, the command (finding 66)**, one line with nothing to prepare, written for the owner's shell:

  ```text
  docker rm -f hcm-worker 2>&1 | true; docker run -d --name hcm-worker --restart unless-stopped \
    -p 127.0.0.1:8765:8765 -v hcm-worker:/work \
    us-central1-docker.pkg.dev/<project>/hcm/pipeline@sha256:<digest> worker --city <city> --project <project> --pair <code>
  ```

  (on Windows PowerShell `2>&1 | Out-Null` instead of `2>&1 | true`; one line in the panel). `/work` is the named volume
  `hcm-worker`, initialised from the image's `/work` (owned by the worker's user `10001`), so the `mkdir -m 777` note is
  gone; the worker runs detached and comes back after a reboot; the same line replaces an older worker. One worker per
  computer (the container's name and the port).
- **§1.4 (new), the image a worker runs (finding 67).** The command names the image by digest, and Docker's restart
  policy never pulls, so the worker cannot update itself. The pairing records the digest its command named;
  `worker.hello` answers the installed one (`image`) and `outdated`; `worker.claim` gives an outdated worker no job
  (`{job: null, outdated: true}`); the worker's page and log, and the admin's panel, say to run the command again (its
  new code replaces the pairing: one paste, no sign-in).
- **§2.1, the page (finding 69)** is for the worker's state; its Google sign-in is a fallback that gives up after 90
  seconds with a message pointing at the admin's command, and the page shows the state when the SDK cannot be loaded.
- **§2.6 (new), pairing (finding 67).** `worker.pairCode {cityId}` (admin, `cityEditor`) mints the command's one-time
  code (26 base32 characters, 130 bits, 10 minutes) into `cities/{c}/pairings/{sha256(code)[:40]}` `{uid, image?,
  expiresAt}`, renewed by the panel a minute before it ends; `worker.pair {cityId, code, replaces?}` (no sign-in, App
  Check off, 20 attempts per city per 10 minutes) exchanges it once for a custom token of that owner with the claims
  `worker: true`, `city`, `pair`; the worker signs in with it at Identity Toolkit (`accounts:signInWithCustomToken`,
  the web API key, the Hosting origin as `Referer`), keeps `{refreshToken, pairId, codeHash}` in
  `/work/.hcm-session-<city>.json` (mode 600), and resumes it at the next start; `worker.revoke {cityId, workerId}`
  (admin, Disconnect this computer) revokes the worker and its pairing. The worker's five callables admit a paired
  token for its city (`workerToken` in their rows) as well as a city editor's Google sign-in; each finds its pairing
  standing (`apiError.worker.revoked` otherwise). `cities/{city}/pairings/*` has no client rule.
- **§3.1 (new), a computer that does not come (finding 68).** `imagery.tick` marks a local job that waited
  `WORKER_WAIT_MINUTES` (15) with no worker seen (`workerOverdueAt`, once) and leaves the inbox item `job.noWorker`; its
  version page offers Run in Google Cloud instead; a claim or a move clears the mark. The Jobs panel follows the busy
  worker's job live (step and progress).
- **§2.2 as changed**: a paired session's refresh token is on disk, in the volume only (mode 600, the code never), so a
  restart needs no new pairing; a session from the page's Google sign-in stays in memory only.
- **Provision (finding 65)** is versioned: an update runs the items whose definition changed since the project was
  last prepared (`DECISIONS-for-review.md` §85a), so this contract's `artifact-registry` and `bucket-lifecycle` changes
  reach a project with Update the map.

### §10, the security review of pairing (added)

1. **Code entropy and lifetime (§10.8).** 26 base32 characters from `crypto.randomBytes`: 130 bits. Valid 10 minutes, one use
   (marked used in the transaction that reads it), stored only as the first 40 hex characters of its SHA-256 (160 bits:
   a read of the collection gives no usable code). Guessing is hopeless; the per-city attempt limit (20 in 10 minutes,
   counted before the code is read) bounds the cost of trying, and one answer covers unknown, used, expired and revoked.
   The code is in the command the owner copies (a terminal's history, the clipboard): it is spent at the first start,
   and an unused one lapses in 10 minutes.
2. **Token scope (§10.9).** The custom token is the owner's uid with `worker: true`, `city`, `pair`, `sign_in_provider:
   'custom'`. `requireAccess` admits it only for the worker's own callables (`workerToken` rows), only for its `city`,
   only while the owner still has a role there and the pairing stands. Every other callable and every security rule wants
   `sign_in_provider == 'google.com'`, so the token reads no Firestore and calls no admin callable. It can do what §10.1
   says a worker can, for one city.
3. **Persistence on disk (§10.10).** The refresh token is in the named volume (`.hcm-session-<city>.json`, mode 600, owned by the
    container's user), never the ID token, never the code (its SHA-256 only, to tell a new command). Anyone with root or
    the Docker group on the computer can read it, as they can read the container's memory (§10.3).
4. **Revocation (§10.11).** Disconnect this computer revokes the pairing and the worker document in one transaction: every call
    of that worker, and of a restart with the kept refresh token, is refused (`apiError.worker.revoked`) and the worker
    deletes its kept session. The refresh token itself stays valid at Google until the owner's sessions are revoked, but
    it opens nothing: the worker's callables check the pairing on every call, and nothing else admits the token. A new
    command revokes the pairing it replaces.
5. **`worker.pair` without App Check or sign-in (§10.12).** The only callable of its kind: it reads one document by a hash, writes
    two (the limit, the pairing), and mints a token only for a code an editor minted minutes before. The rate limit is
    per city, so a stranger can make the owner's pairing wait 10 minutes at worst, not take it.
6. **The Referer header (§10.13).** The worker names the project's Hosting origin as `Referer` to Identity Toolkit and the token
    service, because Provision restricts the browser key to the Hosting origins; that restriction guards the key in
    browsers, not against a client that sets headers, so this widens nothing.

**UNVERIFIED** (§11, added): fn-admin's `signBlob` for `createCustomToken` (the role Provision grants it since M5), the
custom-token sign-in with the Hosting origin as `Referer`, a reboot resuming the kept session, the image pull through
the new command; the first real pairing proves the first two, a reboot the third.

## Addendum (2026-11-02, the starter file and auto-pair: finding 72)

The owner's request after the live update: "I should not have to copy and paste. Fix."; the decision **Starter file +
auto-pair** (`docs/research/manual-test-2026-10-25.md` finding 72, `DECISIONS-for-review.md` §86). What changes in this
contract:

- **§1.5 (new), the starter file.** The worker's panel leads with **Use this computer**: the browser saves a file for the
  system it picks from the user agent (switchable): Linux `hcm-worker.sh`, macOS `hcm-worker.command` (the same POSIX
  template), Windows `hcm-worker.bat` (cmd, then a PowerShell part after its `exit /b`). The templates are
  `packages/admin/starter/hcm-worker.sh` and `hcm-worker.bat`; the admin's site build publishes them at
  `/admin/worker/` and the admin fills `__HCM_PROJECT__`, `__HCM_CITY__` and `__HCM_ACTION__` (`install` or `uninstall`),
  each value checked against its pattern first, CRLF line ends for Windows (`packages/admin/src/worker/local.ts`). The file
  holds no secret. Opened once (Linux: `sh ~/Downloads/hcm-worker.sh`; macOS: a double-click, or the same `sh` line when
  Gatekeeper refuses a downloaded script; Windows: a double-click, past SmartScreen's **More info** → **Run anyway**), it
  checks Docker (`docker info`; else it says so and opens Get Docker), copies itself to a folder of the user's
  (`~/.local/share/hcm-worker`, `~/Library/Application Support/hcm-worker`, `%LOCALAPPDATA%\hcm-worker`) and installs a
  per-user supervisor with no administrator rights:

  | System | Supervisor | Back after |
  | --- | --- | --- |
  | Linux | `~/.config/systemd/user/hcm-worker.service` (`Restart=always`, `WantedBy=default.target`, the install's `PATH` and `DOCKER_HOST`); without `systemd --user`, `~/.config/autostart/hcm-worker.desktop` and the supervisor started now | login (and a reboot's login) |
  | macOS | `~/Library/LaunchAgents/org.historiccitymap.worker.plist` (`RunAtLoad`, `KeepAlive`, a `PATH` with Docker Desktop's folders, a log in `~/Library/Logs`) | login |
  | Windows | the scheduled task `hcm-worker` at the user's logon running the installed `hcm-worker.ps1` hidden; without the Task Scheduler, a `.cmd` in the Startup folder | logon |

  The supervisor's loop: ask the server for the installed image (`worker.image`, no sign-in: `{image, digest, release}`
  of `setup/status.install.pipeline`; `apiError.notFound` while none), accept only
  `us-central1-docker.pkg.dev/<project>/hcm/pipeline@sha256:<64 hex>`, `docker pull` it, remove an older `hcm-worker`
  container, `docker run --rm --name hcm-worker -p 127.0.0.1:8765:8765 -v hcm-worker:/work <image> worker --city <c>
  --project <p> --supervised --image sha256:<digest>` in the foreground, with **no** restart policy (the supervisor
  restarts it). When the worker ends: at once after `75` (`WORKER_OUTDATED_EXIT`, `ExitCode.OUTDATED`: under
  `--supervised` a claim answered `outdated` ends the worker), after a wait that grows from 10 s to 5 minutes after any
  other end (small again after a run of over 10 minutes); then it reads the installed image again. So an update of the
  pipeline reaches the computer within minutes, with no paste and no Docker socket in the container. **Stop using this
  computer** gives the same file with `uninstall`: it removes the supervisor, the container, the volume `hcm-worker` and the
  copied folder. One worker per computer, as before.
- **Why `worker.image` and not a file of the site build**: the image's digest is known only once the pipeline's own build
  has pushed it (`setup.recordInstall` records it); the site's build cannot know it, and a pipeline updated without the site
  would leave a static file naming an older image, which the supervisor would pull and the server call outdated, again
  and again. The callable reads the record the moment it asks.
- **§1.4 as changed, the image a worker runs**: `worker.hello` takes `image` (the digest the supervisor named); the worker's
  document records it, and `worker.hello` and `worker.claim` compare it (else the pairing's, as before) with the installed
  one. A kept pairing outlives many images, so the pairing's own image no longer decides for a supervised worker.
- **§2.7 (new), auto-pair.** The worker's local server answers two requests of the project's Hosting origins
  (`https://<project>.web.app`, `https://<project>.firebaseapp.com`; under the emulators `http://<HCM_HOSTING_HOST>`):
  `GET /state` (now also `workerId` and `pairable`: no session, and not disconnected in the admin) with
  `Access-Control-Allow-Origin: <origin>` and `Vary: Origin`, and `POST /pair {code}` (a JSON body, so a preflight: `OPTIONS`
  answers 204 with the methods, `content-type`, `Access-Control-Max-Age: 600` and, when asked,
  `Access-Control-Allow-Private-Network: true`); 202 with the state, or 409 with why (`paired`, an invalid code). The code
  goes to the connector (`Connector.offer`), which pairs at the loop's next pass exactly as `--pair` does. Any other origin
  gets 403 and no CORS header. The admin (`LocalComputer`, the lazy `worker-local` chunk) looks every 5 s while the panel is
  shown, and while the admin is open (`packages/admin/src/app/local-watch.ts`), but only in a browser that set this
  computer up for the city (`localStorage` `hcm:admin:workerLocal`, written by **Use this computer**, removed by **Stop
  using this computer**): a worker of this city and project that is `pairable` gets a code from `worker.pairCode` posted to
  `/pair` (again after a minute at most); a signed-in one shows **This computer is connected**. The admin's CSP
  `connect-src` names `http://127.0.0.1:8765` and `http://localhost:8765`. The copyable command stays behind **Advanced**,
  its code minted when Advanced opens (no code is minted any more when the panel merely shows).
- **§7 as changed**: the `worker` chunk keeps the panel; the new lazy chunk `worker-local` (budget 5 KB, 4.3 KB measured; 10 KB since 2026-11-13 at 8.7 KB, DECISIONS-for-review.md §168e)
  holds the starter file, the auto-pair, Stop using this computer, the command and `<hcm-worker-local>`, with its texts in
  `packages/shared/src/i18n/admin-worker-local/`.

### §10, the security review of the starter file and auto-pair (added)

1. **A malicious site cannot pair the worker (§10.14).** The worker answers `/state` and `/pair` with CORS only for the
   project's Hosting origins; a page of any other origin gets 403 and no `Access-Control-Allow-Origin`, so it can neither
   read the state nor send the JSON `POST` (a JSON body needs a preflight, which the worker refuses for that origin; a
   `text/plain` or form body is refused by the server itself). A browser sets `Origin`, which a page cannot forge. A DNS
   rebinding name still meets the `Host` check (421). Even a code that reached the worker could only pair it to the account
   that minted the code, in this project and city: the server's `worker.pair` binds the code to its minter and city.
2. **No CSRF token on `/pair` (§10.15).** The admin's page cannot know the worker's per-process token; the guard is the
   origin allow-list above, the preflight, and the code itself (single use, ten minutes, minted by a signed-in city editor
   through App Check). Replaying a seen code fails (`apiError.worker.pairCode`); a worker already paired answers 409.
3. **A malicious local process (§10.16), as before §10.3.** A process of the same user can send any `Origin` to
   `127.0.0.1:8765`, but it can already run `docker` and read the volume, which hold more than a pairing could give it; a
   process of another user cannot reach Docker. Nothing changes there.
4. **Private Network Access, Local Network Access (§10.17).** A page on a public origin reaching `127.0.0.1` is what PNA and
   Chrome's Local Network Access permission guard: the worker answers PNA's preflight for the Hosting origins only, and the
   admin looks at the computer only in a browser that set it up (`hcm:admin:workerLocal`), so a visitor who never chose to
   use a computer is never asked. **UNVERIFIED**: the prompt Chrome shows the first time, and whether
   `upgrade-insecure-requests` leaves a loopback address alone in every browser (a potentially trustworthy URL: Chrome
   does).
5. **The starter file (§10.18).** It holds the project id and the city id, both public, and no secret; the values are checked
   against their patterns before they are written, so no quote or command reaches the script. It runs nothing but `docker`
   and `curl`/`Invoke-RestMethod` against the project's `cloudfunctions.net` address, and runs only an image of the
   project's own repository named by digest (the supervisor rejects any other answer). The container gets no Docker socket.
6. **`worker.image` without a sign-in (§10.19).** It reads one document and answers the image the repository already makes
   public (`allUsers` reader, §1.1), with the release; two instances at most, App Check off like `worker.pair`.

**UNVERIFIED** (§11, added): each system's first double-click (macOS Gatekeeper on a downloaded `.command`, Windows
SmartScreen, a Linux file manager that opens `.sh` in an editor: hence the `sh` line), `Register-ScheduledTask` at logon
without administrator rights, `launchctl bootstrap` from a double-clicked script, Chrome's Local Network Access prompt for
the admin's look at the loopback, Safari's and Firefox's handling of it, and the supervisor's update after a real Update the
map. A `.desktop` launcher for Linux was not made: GNOME's Files no longer launches an untrusted downloaded launcher.

## Addendum (2026-11-03, the installed image from the job, and the starter file as a download: findings 73–74)

The live test of 2026-11-03 after Update the map to `1.0.0+bf74d17` (`docs/research/manual-test-2026-10-25.md` findings
73–74, `DECISIONS-for-review.md` §87). What changes in this contract:

- **§1.5 as changed, which image is installed (finding 74).** The installed pipeline image is the one the Cloud Run job
  `raster-pipeline` runs (Run Admin v2 `jobs.get`, `template.template.containers[0].image`, `…/hcm/pipeline@sha256:<64
  hex>`), which the pipeline build's `jobs` step sets in the build that pushed it, with the release its `hcm-release`
  label names (`releaseOfSlug`). `worker.image`, `worker.hello`, `worker.claim` and `worker.pairCode` read it through one
  resolver (`functions/src/worker/installed-image.ts`), each instance keeping it a minute; the record
  `setup/status.install.pipeline.image` answers only while the job cannot be read (no job yet, a refusal: logged), and its
  `release` only for the digest it names: a release is never paired with another digest. `fn-admin@` reads the job with
  `roles/run.viewer` (Provision's `iam`, item set version 3: an update applies it in the same consent; until then the
  record answers). The admin reads the same job image on every look of the pipeline card (`InstalledInfo.image`), before
  the build log's `image` event (which Cloud Logging may not have yet when the build has just ended), and records the
  pipeline again when the image changes, not only its state. `worker.image` answers `{image, digest, release?}` as before.
  Since 2026-11-14 (lesson 721) the resolver also brings the record up to the job: when the job runs another digest than
  `setup/status.install.pipeline.image` names and its label names a release, the record becomes `installed` with the job's
  release, `hcm-release-time` and digest (its build id kept; written as `system:setup`, logged `pipeline record follows the
  job`). The supervisors ask `worker.image` every few minutes, so a record an admin tab left `working` (it reloaded after a
  deploy with no Google token, lesson 718) is corrected without anyone opening Setup; a build still at work (the job on the
  recorded digest) or a job without a release label leaves the record alone.
- **The supervisor and an image older than it (finding 74).** A worker that ends with its usage error (`2`, argparse: an
  image from before `--supervised --image`) three times in a row makes the supervisor say once, in its log (the journal,
  `~/Library/Logs/hcm-worker.log`, the task's output), "The server named an image that does not support this computer's
  starter: update the map." and ask again every 5 minutes until the image changes; an outdated worker (`75`) is still
  started again at once.
- **§1.5 as changed, the starter file is a download the server answers (finding 73).** Live, Chrome saved nothing of the
  file the admin made in the page (a Blob URL behind a synthetic click after an `await`; cause **UNVERIFIED**: a `.sh` is a
  type Chrome lets through only for a download the user starts). **Use this computer** and **Stop using this computer** are
  now links (`<a href download>`) to the public HTTPS function `worker.starter` (`worker-starter`, `fn-admin@`, two
  instances, App Check off, no sign-in): `GET ?city=<city>&os=<linux|mac|windows>&action=<install|uninstall>`
  (`workerStarterQuerySchema`) answers the template of the system filled with this project, the city and the action, CRLF
  for Windows, with `Content-Type: application/octet-stream`, `Content-Disposition: attachment; filename="<name>"`
  (`WORKER_STARTER_FILE_NAMES`), `Cache-Control: no-store` and `Access-Control-Allow-Origin: *`; a bad query 400, another
  method 405, an unreadable template 503 (logged). `HEAD` answers the same headers: the panel makes one `HEAD` when it first
  shows, and a server that does not make the file (one from before this release) gets no link but "The map's server does
  not give the file yet: update the map (Setup, Update the map), then come back." The templates stay in
  `packages/admin/starter/`; `functions/build.mjs` copies them into `functions/dist/starter/` (the install bundle's
  `server.tgz` allows exactly those two files), and the admin's site build no longer publishes `/admin/worker/`.
- **§7 as changed, after the click.** The region says "Your browser may ask whether to keep the file: choose Keep. It is
  saved in your Downloads folder.", then how to open it: on Linux (a double-click opens a `.sh` as text) the exact line
  `sh ~/Downloads/hcm-worker.sh` with **Copy the line**; macOS and Windows as before. When the worker comes up and takes a
  code the panel turns to **Connecting this computer…** by itself, then **This computer is connected**.

### §10, the security review of `worker.starter` (added)

1. **A public file endpoint (§10.20).** It answers the same file anyone can derive from the open templates: the project id
   (in its own address) and a city id the query names, checked against `cityIdSchema`, so no quote or command reaches the
   script; nothing is read from Firestore, nothing is written. The action and the system are enums. `Cache-Control:
   no-store`, `nosniff`; two instances at most.
2. **CORS `*` (§10.21).** Only for the panel's `HEAD`; no credentials are sent or accepted, and the answer is public.
3. **`roles/run.viewer` for `fn-admin@` (§10.22).** Read-only: Cloud Run services', jobs' and executions' definitions and
   states of this project (the jobs' environment names the buckets, no secret). `fn-events@` already holds it.

**UNVERIFIED** (§11, added): what Chrome does with the server's attachment on each system (the keep prompt is expected for
`.bat` and possibly `.sh` and `.command`), and the cause of finding 73 itself.

## Addendum of 2026-11-03: the first import on the owner's computer

Findings 75 to 80 of `manual-test-2026-10-25.md` (`DECISIONS-for-review.md` §88e–§88h). The panel gains **Already set up? Look
for it** (`LocalIntents.find`, phase `looking`, the mark with no file); the worker's id is kept in
`<work>/.hcm-worker-<city>.id` and forgotten with the session (§1.2's "new per process" no longer holds); a Retry
(`imagery.retry`) keeps only the first finished of `locate`, `inspect`, `extract`, `fetch` and what came before it, so a
pipeline updated since the failure redoes the rest, on the computer or in Cloud Run alike.

## Addendum of 2026-11-06: the work folder

The worker's idle pass sweeps its work folder (`LocalObjectStore.sweep`, `worker/local_store.py`): a job's scratch and a scene's delivery
go whole once nothing in them was written for 14 and 7 days, never the scratch of the job just claimed. A new download session is refused
when the disk could not hold the delivery and its unpacked segments, before its first byte (`_require_room`, 2.6 times the delivery); a
retry after the delivery's week with its segments left downloads nothing (`runner.py` `_consumed`). **Known limit, decided for now:** a
dismissal or a rejection deletes only the bucket's `work/` (`functions/src/imagery/work-files.ts`); a job run here keeps its segments, about
13 GB, until the sweep's 14 days, as the server cannot reach this folder and tells the worker of no ended job. After a reload the panel
starts `looking` for the computer it remembers, not `downloaded`: nothing says the file was just saved, and the first answer says the rest.
An id file that holds no valid id is not read: the worker takes a new one at its next start.

## Addendum of 2026-11-06: a join on the worker (M8)

A `layer-join` runs here as any pipeline job (`docs/research/M8-join-interfaces.md`). `worker/allow-list.ts` reads `inputVersionsOf(job)`: a re-georeference's base or a join's frames, each read-only, and `inputsOf` adds each frame's `scan.tif`; the worker writes only the join's own version files, and `WORKER_VERSION_FIELDS` gains `join`. A worker cannot write `joined`: `WORKER_VERSION_STATES` does not hold it, as the finalize does that. `worker.claim` refuses a job waiting on `parts`, and `run-on.ts` keeps that reason when the city's choice moves the job. A scan is staged for its preview, its seams, its re-warp and its `merge`, so up to four downloads per frame with at most two scans on disk; `S-P05-HAPPY-WORKER` runs the job under the Python fake's copy of these lists and the callable's own lists have their tests in `functions/test/worker/`. **UNVERIFIED** on real frames: the time and the disk, measured by decision D3 of the M8 contract, where the worker may be the only practical runner.

## Addendum of 2026-11-07: the local AI beside the worker (M10)

`docs/research/M10-local-ai.md`. What changes here:

- **The starter file** (`HCM_STARTER` on the worker's `docker run`, `2` then, the content's version since 2026-11-13 (*The starter updates itself*), and the volumes `hcm-ai-files`, `hcm-ai-box`) starts a second loop, `run_matcher`, which polls `/state`. Once `ai.wanted` is true it reads the free space inside a container, pulls `pytorch/pytorch` by digest (any other image is refused), and when `ai.files` is true runs the sidecar beside the loop: `--gpus all`, then CDI, then the processor, probing again at every start. The sidecar goes as soon as no frame wants it, or the worker has not answered twice running. **The worker still gets no Docker socket.** The sidecar has no network and never mounts the volume holding the refresh token.
- **`GET /state`** gains `ai: {state, device?, deviceName?, why?, wanted, image, files}`. The starter reads it with no `Origin`, as any local read; the CORS rules are unchanged.
- **`worker.hello`** gains an optional `ai`, said again whenever it changes; `cities/{city}/workers/{workerId}.ai` is what `<hcm-worker-panel>` shows. A worker whose `HCM_STARTER` is not its release's `STARTER_VERSION` says `unavailable`, `old-starter`, and the panel asks for the new file: an old image refuses unknown arguments, not variables, so the variable is safe in both directions.
- **`uninstall`** removes both volumes, `hcm-matcher` and only the image this file noted having pulled.
- **Cloud Run** keeps `NullProposalMatcher`: only `worker/runtime.py` injects `LocalMatcher`, and its image gains a few KB of unimported Python and two empty folders.

Security review of the additions: the box is a volume shared with a process that has no network, so what it says is untrusted. An answer is parsed as JSON, finite, at most three similarities of a scale 0.85 to 1.15, and only a proposal for the proof; a request is read with `allow_pickle=False`; weights load with `weights_only=True` after their hash. `/state` tells a local reader only the pinned image's name. The starter accepts that name only as `pytorch/pytorch` by a whole digest, with no character a shell could act on.

## Addendum of 2026-11-12: memory and processor budgets (`reports/resource-audit.md`)

The worker needed about 16 GB: a warp took 4.5 GB and a 60-sheet colour atlas 3.8 GB, whatever the machine. Three settings and one function, each with a budget test (`pipeline/tests/integration/test_memory_budgets.py`, a process of its own through `pipeline/tests/budget_probe.py`; S-P31-*):

| What | Before | Now |
| --- | --- | --- |
| `GDAL_CACHEMAX`, `warpMemoryLimit` (`rasters.gdal_memory`, `warp_memory_mb`; `steps/warp.py`, `join/warping.py`) | 1,024 and 2,048 MB, fixed | a sixteenth and an eighth of what the process may use (the least of the cgroup's limit and `MemAvailable`), between 128 and 1,024 MB and between 256 and 2,048 MB: 256 and 512 MB on 4 GB, the old values from 16 GB. `HCM_GDAL_CACHE_MB` and `HCM_WARP_MEMORY_MB` override. |
| Atlas and pieces canvas (`placing/assemble.compose_canvas`) | every part warped onto a whole canvas, the owners resized to it as int32 | each part warped into its own box, the owners read on their coarse grid as `cv2.resize` would pick them: the same pixels |
| `locate`'s city crop (`locate.write_crop`, also `steps/recrop.py`) and a scan's preview (`common.scan_preview`; `inspect`) | the crop as one array, written, then resized; an upload read whole, band by band, for a 4,096 px preview | the crop copied out of the segments 1,024 rows at a time; the preview read by GDAL averaged down to its size |
| Tile processes (`steps/pyramid.tile_processes`) | one a CPU (`ALL_CPUS`), about 170 MB each | the cores but one, at most what a quarter of the memory holds at 256 MB each, at most `GDAL_NUM_THREADS` when it is a number |

Measured on the NUC (16 threads, 31 GB) with the audit's method and sizes, in the quality image:

| What (NUC, `tests/budget_probe.py`) | Before | After |
| --- | --- | --- |
| `compose_canvas`, 60 colour sheets of 2222 by 1600 | 3,741 MB, 105 CPU-s | 1,659 MB, 16 CPU-s |
| Same, 36 sheets of 1600 by 1152 (the budget test's size) | 1,161 MB, 20 CPU-s | 554 MB, 5 CPU-s |
| Warp, 70,000 by 15,000 scan, thin plate over 289 points, all threads | 4,520 MB (cache 1,024, warp 2,048) | 1,239 MB with a 4 GB machine's settings (256, 512), 2,329 MB with an 8 GB machine's; no slower (11 s against 36 s of wall time) |
| COG of it (JPEG 85, 512 blocks, overviews) | 1,994 MB on 16 threads | 1,246 MB on 16 threads, 671 MB on two (4 GB settings); 1,431 MB with 8 GB settings on 15 |
| Tiles z10 to z16 | 16 processes of up to 143 MB beside a 190 MB parent: about 2.5 GB together (summed, not measured) | in a 12 GB container 12 processes: about 1.9 GB (11 measured at 155 MB each), the same 48 s; a 4 GB machine gets 4, which GDAL runs as threads of one process: 1,243 MB, 119 s |

| City crop of DS1103-1058DF027 (35,664 by 8,172) out of two segments, and its preview; 4 GB settings | 574 MB: one array, written, resized | 460 MB: copied 1,024 rows at a time, the preview read averaged down (GDAL's 256 MB cache is most of what is left) |
| Preview of a 20,000 px colour upload (`inspect`) | 2,720 MB: every band read whole, stacked, resized | 479 MB |
| Atlas of 60 colour sheets of 2,222 by 1,600 from disk, as `placing/maps.py` makes it | 1,698 MB: every page held in colour beside the canvas | 1,301 MB: pages held grey, each read again in colour only to paste it; the canvas written once and kept as the stitched picture by a hard link |
| The local AI's sidecar (`hcm-worker.sh`, `.bat`; `matcher/torch_backend.py`) | 6 GB cap, Docker's default CPU weight, half the threads on the processor | 4 GB cap (2.4 GB measured in M10), `--cpu-shares 128`, the threads but one, niced by 10 on the processor |

The export's memory follows the threads as well as the cache, and four tile threads in one process hold more than four processes would: both stay inside a 4 GB machine, neither is as small as the audit's two-thread figures.

### The worker beside its owner's work, and an idle worker's claims (2026-11-12)

- **Limits** (`packages/admin/starter/hcm-worker.sh`, `hcm-worker.bat`): the worker's container runs with `--memory` and `--memory-swap` at 60 % of the memory Docker has (`docker info`'s `MemTotal`; on Docker Desktop, of its virtual machine) and `--cpu-shares 256`. An out-of-memory run now ends the job, not the desktop. `HCM_WORKER_MEMORY` (a Docker size, or `none`) and `HCM_WORKER_THREADS` in the service's environment override. The one-line command behind **Advanced** is unchanged: it has no limit of its own.
- **Priority and threads** (`worker/command.py`): the process is niced by 10 (`HCM_WORKER_NICE`; 0: not at all) and GDAL takes the cores but one unless `GDAL_NUM_THREADS` is set. Cloud Run's jobs are not niced and keep every core.
- **Claims** (`worker/pace.py`, `worker.hello`'s `idlePollSeconds`): awake, a claim every `pollSeconds` (30 s): for ten minutes after the worker's start, a job it ran, or the admin's page looking at it (`GET /state` from a Hosting origin). Then each idle pass waits up to `WORKER_IDLE_POLL_SECONDS` (60 s), a tenth more or less: a new job starts within about a minute, and a month idle is about 43,200 claims, not 86,400. A first version went to 300 s with the presence window at 570 s; the owner refused the five-minute wait (2026-11-13). A listener was not possible: the worker reaches the project only through its callables (no Firestore SDK, no rule lets it read jobs), and a long-poll callable would hold a function instance through every idle minute, more GiB-seconds than the claims it saves. `WORKER_FRESH_SECONDS` stays 180 s. A server older than this image names no `idlePollSeconds` and is asked every 30 s as before. **Several workers in one city** (2026-11-13): every wait is stretched by 1 + 3 × (1 − the governor's headroom), so a hot, busy or paused computer asks up to four times later and a cooler or idler one takes the queued job (`docs/research/M26-governor.md` §4, *Headroom and the claim*).
- A starter already installed keeps running without the limits until the owner downloads it again; the priority, the threads and the claims come with the image.

### The minimum machine (2026-11-12)

Target: **4 GB of memory and 2 cores**, slower, never refused. What is measured (the table above, each step in a process of its own with a 4 GB machine's settings): warp 1.2 GB, COG 0.7 GB on two threads, tiles 1.2 GB on four, a 60-sheet colour atlas 1.7 GB, a 40,000 by 8,000 city crop under 0.45 GB. The budget test S-P31-HAPPY-SMALL-MACHINE holds a 60-sheet colour atlas at its real size (1.3 GB) and DF027's city crop (0.46 GB) under 60 % of 4 GB, the worker's cap there, each in a process of its own. **Not yet proved:** a whole import under a real 4 GB cgroup (the NUC's queue runs every container at 12 GB; the test reads each process's peak, not a cgroup's), and `georef`'s matcher, which still reads `scan.tif` whole before it shrinks it (a city crop: up to 0.5 GB). The local AI on the processor is outside this target (its sidecar's cap is 6 GB, a frame took 49.5 min on 8 threads).

## Addendum of 2026-11-12: the governor (M26)

The worker's share of the computer is the governor's (`docs/research/M26-governor.md`), inside the budgets of the
addendum above: the command nices the process (`HCM_WORKER_NICE`), `Worker.govern` adds the idle I/O class and ticks
every 5 s, sizing GDAL's threads, cache and warp memory and OpenCV's threads to the profile, never above the measured caps; `GET /state` carries `machine`; `POST /profile` (under `/pair`'s rules)
takes the owner's Automatic, Quiet or Full, kept in the volume's `governor.json`. The starter (§1.5) runs a third loop
beside the supervisor and the sidecar's, `run_governor` (`sh hcm-worker.sh governor` alone; Windows: `Start-GovernorLoop`
in its own hidden process): every 5 s it writes the host's hints (input idle time, the battery a VM cannot see, the
cards and NPUs Docker could pass) into the volume through `docker exec` into the worker's container, and runs
`docker update --cpus <threads> hcm-worker` when the budget's threads change. A paused worker holds its step at the next
checkpoint (its time limit moved by the wait). Behaviour A141.

## Addendum of 2026-11-13: the starter picks the sidecar by the computer's card (M26 item i)

`hcm-worker.sh` (`ai_variant`) and `hcm-worker.bat` (`Get-AiVariant`) start the worker with `-e HCM_AI_VARIANT=gpu` when
`nvidia-smi -L` names a GPU, else `cpu`; the owner's own `HCM_AI_VARIANT` (`gpu` or `cpu`, exactly) wins. With `cpu` the
worker's `/state` names the AI's image `worker`: the starter runs the sidecar from the worker's own image (no pull, no
probe of a card) with `PYTHONPATH=/ai/files/code:/ai/files/lib-cpu`; PyTorch's image keeps `lib`. A starter downloaded
before this passes no variant, so its worker keeps PyTorch's image as before. Scenarios `S-P07-HAPPY-CPU-IMAGE`,
`S-P07-BAD-CPU-IMAGE`; details in `docs/research/M26-governor.md` §5.

## Addendum of 2026-11-13: the starter updates itself

The owner's laptop ran the starter installed on 2026-11-08 for days after the hardware governor changed the file (memory cap,
`HCM_AI_VARIANT`, the host hints): its worker ran with no memory cap and the admin's "This computer" said there was no graphics
card on a laptop with an RTX 3080. Nothing said the starter was old, because both files still passed `HCM_STARTER=2` and the
pipeline's `STARTER_VERSION` was `"2"`: a version written by hand was never bumped (`docs/LESSONS.md` 614). Every installed
starter of every city owner was stuck the same way.

**The version is the content's.** `scripts/site/src/admin/starter.ts` (`starterVersionOf`): the first 12 hex digits of the SHA-256
of `hcm-worker.sh` and `hcm-worker.bat` (LF line ends), each with its own version line emptied. The same value is written in four
places: `STARTER_VERSION=` of the POSIX file, `$StarterVersion = '…'` of the Windows file, `WORKER_STARTER_VERSION` of
`@hcm/shared` (the admin) and `STARTER_VERSION` of `hcm_pipeline/worker/ai_state.py` (the worker).
`scripts/site/test/starter-version.test.ts` fails, and the admin's build stops, when a template changes and the four are not
the new value (the error names it).

**The release's list.** The admin's build writes `starter.json` beside `runtime.json` (`/admin/starter.json` on Hosting):
`{version, sha256: {posix, windows}}`, each the SHA-256 of a template as committed (LF, the marks unfilled). Hosting and the server
that serves the files (`worker.starter`) are deployed by the same Update the map, so the list and the file come from one release
by two ways.

**The look.** The installed copy (`~/.local/share/hcm-worker/hcm-worker.sh`, `~/Library/Application Support/hcm-worker/…`,
`%LOCALAPPDATA%\hcm-worker\hcm-worker.ps1`) looks when the service starts, whenever the worker ends (a new release's image makes
it end at once: exit 75), and once a day beside the worker (`run_updater`; on Windows inside the governor's loop). It reads
`https://<project>.web.app/admin/starter.json`; when the version is not its own it fetches
`worker-starter?city=<city>&os=<linux|mac|windows>&action=install`, puts the three values back as the marks and compares the
SHA-256 with the list's and the version line with the list's version; only then it writes the file with `HCM_ACTION='run'` (the
Windows header) beside the old one and renames it over the old one. The service's process then becomes the new file
(`exec /bin/sh "$0" run` once the loops beside it are stopped; on Windows a new hidden supervisor and this one ends). A newer file the
daily look wrote waits until the worker's `/state` is not `busy`, then `docker stop hcm-worker` ends the run and the supervisor
starts the file. Only the installed copy updates itself; a file opened by hand never rewrites itself.

**What the admin sees.** The worker passes on `HCM_STARTER` and `HCM_STARTER_UPDATE` (the last look's word: `unchecked`,
`current`, `updated`, `not-installed`, `no-list`, `no-file`, `bad-sum`, `read-only`). Its `GET /state` gains `image` (the
`--image` digest) and `starter` `{version, wanted, update}` (words outside `[a-z0-9-]{1,40}` are dropped). "This computer" shows
`<hcm-worker-versions>`: the worker's image (`sha256:` and 12 hex digits) and the helper file's version, each "It matches the
installed release" or not (the image by `outdated`, the helper by `WORKER_STARTER_VERSION`, since the admin is the installed
release). An out-of-date helper is an alert in plain words: "Your computer's helper is out of date. It updates itself; if it can't,
run this once:", the why of its last look (a starter older than this addendum passes no word: "it was set up before helpers could
update themselves"), and the command for the chosen system with Copy: `curl -fsSL '<worker.starter url>' -o ~/hcm-worker.sh && sh
~/hcm-worker.sh` (macOS: `~/hcm-worker.command`; Windows: `Invoke-WebRequest … -OutFile "$env:TEMP\hcm-worker.bat"; & …`), which
sets the service up again with the release's file. A worker started by a command has no helper and says so with no command.

**Security.** Nothing new is trusted: the list and the file come from the city's own Hosting and functions over HTTPS, the same
origin the owner downloaded the first file from; a file whose hash or version is not the list's is refused and the old file stays.
The file still holds no secret, and the update never runs a downloaded file before it is checked.

Scenarios `S-A142-HAPPY-VERSIONS`, `S-A142-BAD-OLD-STARTER`, `S-A142-HAPPY-SELF-UPDATE`, `S-A142-BAD-SELF-UPDATE`.

### Addendum of 2026-11-13: Versions compares digests while the worker is busy

The card's "It matches the installed release" for the pipeline image must not wait on the worker's `outdated` flag: a busy
worker only learns that flag at its next `worker.claim`, so Versions said "matches" while the digest on `/state` was already
behind. `versionsOf` (`packages/admin/src/worker/machine.ts`) compares the worker's `image` with
`setup/status.install.pipeline.image` (the digest `WorkerFeed` already reads through `setup.status` and passes into
`LocalComputer`); it falls back to `outdated` only when that installed digest is unknown. Unit tests in
`packages/admin/test/worker/machine.test.ts` pin same digest → current, different digest with `outdated: false` → not
current, unknown installed → flag. Lesson 696.

## Addendum of 2026-11-13: several workers and a local archive (M20 §20)

Every worker claims every job type again; an archive series' sheets, which exist on the computer that imported them, reach another
worker as a copy through the private bucket (`tmp/archive-copies/{city}/{job}/`, deleted after a day). Two contract changes:
`worker.claim` takes `archives` (the archives this computer holds whole) and may answer `copy` (a series to send before any job), and
`worker.end` takes `outcome: 'returned'` (no sheets and no copy: the job goes back queued, its attempt given back, waiting
`archive-copy`). The new callable `worker.archiveCopy` signs the copy's files for the holder and marks the copy done. A job waiting
`archive-copy` is claimed by nobody until its copy is done. `RoutedObjectStore` reads `tmp/archive-copies/` through `worker.urls`,
whose allow-list adds the job's own copy folder (`isOwnArchiveCopy`).

**2026-11-14, sharing while busy (M20 §22, DECISIONS-for-review.md §229).** The holder no longer waits for its claim: a thread of its own
(`worker/sharing.py`) asks `worker.archiveCopy {kind: 'wanted', archives}` (no `jobId`) and sends the named series under the governor's
budget, also while the loop runs a job; `progress` keeps the worker's `sharing` (the Computers card). Its claims say `shares: true` and
are never answered `copy`. A series waiting `archive-copy` is now claimable by a worker whose claim names its archive (the holder runs it
itself when it cannot share it), and by nobody else.

## Addendum of 2026-11-13: Pause (a job, every job, a computer)

The owner, 2026-11-13: "I want the user to be able to pause jobs, and to pause using a machine". DECISIONS-for-review.md §216.

**A job.** On the Jobs page's open job and on a version's page (`<hcm-job-pause>`, the lazy `worker` chunk), a pipeline job that is
queued, starting or running has **Pause**, and a paused one **Resume**; the Jobs list has **Pause all** and **Resume all**, and a
paused job's row reads Paused. All of them call `imagery.pause {cityId, action: 'pause' | 'resume', jobId?}` (a city editor; no
`jobId`: every job of the city still queued, starting or running, at most 500). The job gets `paused: {by, at, inRun?}`:

| The job was | Pause does | Resume does |
| --- | --- | --- |
| queued (any wait) | nobody claims it (`worker.claim`'s rules) and the dispatcher does not send it (`dispatch.ts` `held`); `imagery.tick` never marks it overdue | drops the mark; its trigger dispatches it, or the next claim takes it, where it left off |
| starting or running | `inRun: true`; the run stops at its **next step boundary** (`runner.py` `_refresh` raises `PausedRunError`): the step it is in finishes, then `status: queued`, lease and `retryAt` removed, no step changed (Cloud Run and the computer alike); on the computer `worker.end` says `done` | drops the mark; once the run stopped (`queued`) it gives back the attempt that run counted |
| finished, or waiting for USGS, points or the approval | `apiError.imagery.notPausable` (what it waits for, nothing changed) | — |

A paused job can still be cancelled (the rules' cancel is unchanged). The screen says who paused it and when, that it waits in the
queue, and that Resume puts it back to go on from the step where it stopped; a running one says it stops after the step it is on.
`imagery_pause` is measured as an `admin_action` (its outcome or refusal code); the functions log `job paused`, `every job paused`,
`computer paused` with the uid, city, job or worker.

**A computer.** The computers card (`<hcm-worker-panel>`, "Your computer": the city's most recently seen worker; the household list
of track/household will put the same controls on each row) has **Pause this computer:** Until I resume, For 1 hour, Until tomorrow
(08:00 tomorrow on the admin's clock), and on a paused computer who paused it (you, another admin, or the computer itself), until
when, "It takes no new work and gave its job back to the queue; nothing is lost", and **Resume**. `imagery.pause {workerId, until?}`
sets the worker's `paused: {by, at, until?}` (an `until` in the past or more than `PAUSE_UNTIL_MAX_HOURS`, 48, ahead:
`apiError.imagery.pauseUntil`) and, when the worker runs a job, asks it back (`releaseRequested: true`). Resume drops both.

On the computer: the heartbeat reads `releaseRequested` and the run stops at its **next checkpoint** (`ReleasedRunError`; the governor's
gate lets go at once), the running step goes back to `pending` (its start kept), and `worker.end {outcome: 'released'}` queues the job
again with the attempt its claim counted given back (`pause-state.ts` `releasedJob`; only while the computer is paused or the job was
asked back, else the attempt stays counted). A paused worker's `worker.claim` is answered `{job: null, paused: true, pause: {by, at, until?}}`; a
pause past its `until` is dropped by the next claim. The worker mirrors the answer into its governor (the owner's `paused` choice,
M26 §3): no processor threads, no memory budget, no card share, headroom 0; it stays connected and claims every `pollSeconds`, so a
Resume is seen within about 30 seconds.

**The computer's own page** (`http://localhost:8765`) has the same three buttons and Resume (ro and en). `POST /pause {action, until?}`
(the page's own origin with its token, or a Hosting origin, like `POST /profile`; 400 for a bad body, 403 otherwise) pauses at once
and sends the command with the next `worker.claim` (or `worker.end`, when a run was handed back): `pause: {action: 'pause', until?}`
or `{action: 'resume'}`, recorded as `paused.by: 'computer'`. `GET /state` gains `paused: {by: 'computer' | 'admin', until?} | null`.

**With the computers' list (W5, household).** Its Pause and Resume (`worker.manage`) go through the same pause (`pause-state.ts`):
the worker's `paused` and `pausedAt` are set and dropped together, and the running job is asked back. A paused worker's claim answers
W5's `paused: true` and, beside it, `pause: {by, at, until?}`, which the worker mirrors (a bare `paused: true` reads as paused from the
admin, with no end). The list's rows pause until Resume; the timed choices are on the card above it and on the computer's own page.

The hand-back reuses the shape of M20's (archivehost, §204: `worker.end` `returned`, the attempt given back) with its own outcome,
because a paused computer's job waits for no copy. Tests: `functions/test/imagery/pause.test.ts`, `functions/test/worker/pause.test.ts`,
`packages/admin/test/worker/pause.test.ts`, `packages/ui/test/admin/worker/pause.test.ts`, `pipeline/tests/unit/test_runner_pause.py`,
`test_worker_pausing.py`, the rules' `jobs.test.ts`, `e2e/admin/specs/imagery/pause.spec.ts`; scenarios A170, A171, P32; tour states
`worker.job-paused`, `worker.jobs-pause-all`, `worker.computer-paused`.

## Addendum of 2026-11-13: household computers (W5)

The owner (beta.1, W5 of `reports/OPEN-ISSUES-beta1.md`): "Make it easy for users to use not only their own computer but also the
other computers in their household, with minimum input from them. What we did here today for us must be available to our users."
What was done by hand that day, and what replaces it: on the NUC (Linux, no screen) the starter copied over SSH, `loginctl
enable-linger` typed, and the pairing made by stopping the laptop's worker and tunnelling the NUC's `127.0.0.1:8765` to the laptop,
so the admin's auto-pair could reach it; on the Windows PC the same inside WSL, plus a Startup-folder VBS that keeps WSL alive.
`DECISIONS-for-review.md` §216. Scenarios `S-A143-*` (behaviour A143).

**The list of the city's computers** (`<hcm-worker-household>`, the lazy `worker-household` chunk, `packages/admin/src/worker/household.ts`):
every `cities/{city}/workers/*` document, live, with the owner's name (`name`, `worker.manage` `rename`) else the computer's own
(`host`: the starter passes `HCM_HOST_NAME` from `uname -n` or `%COMPUTERNAME%`, since a container's host name is its id), on or off
(`WORKER_FRESH_SECONDS`), what it does, its share (`share`, below), its system (`os`, `HCM_HOST_OS`) and its helper's version
(`starter`, `HCM_STARTER`) beside the release's. `worker.hello` takes `host {name?, os?, starter?}`, each only of its shape. Pause
(`worker.manage` `pause`, `pausedAt`) makes `worker.claim` answer `{job: null, paused: true}` until Resume. A computer disconnected
more than a day ago leaves the list.

**Add another computer, with a screen**: the admin's own address (`…/admin/#/jobs`) with Copy; on that computer the owner signs in
with Google and presses Use this computer, and the auto-pair of §2.7 does the rest (the browser there reaches its own loopback).
Nothing new is trusted.

**Add another computer, without a screen** (the tunnel retired): the wizard mints a code with `worker.pairCode {household: true}`
(`WORKER_HOUSEHOLD_PAIR_SECONDS`, 45 minutes: the computer may first install Docker and pull the pipeline; still one use, bound to the
owner and the city) and shows one line:

```text
curl -fsSL '<worker.starter, linux, install>' -o ~/hcm-worker.sh && echo <code> | sh ~/hcm-worker.sh
```

The starter reads the code from `HCM_PAIR_CODE` or one line of standard input (checked: 26 base32 characters, else ignored), clears
the variable at once, installs as before, enables linger where there is no graphical session (`loginctl enable-linger`, else with
sudo, else the exact command to type), then waits up to 45 minutes for the worker's `GET /state` to say `pairable` and posts the code
to `POST /pair` itself, with the project's Hosting origin and the JSON body from standard input (`curl --data-binary @-`), exactly as
the admin's auto-pair does from a browser. It says "This computer is connected. The admin lists it as <name>.", or why not and the fix
(the code refused: a new line skips the download; no start in 45 minutes: is Docker running, is there room).

**Docker installed when it is missing (Linux)**: the system's own packages, which its distribution signs (`apt-get install docker.io`,
`dnf install moby-engine`, `zypper install docker`, `pacman -S docker`), with one sudo; never a downloaded script. Before it: 10 GB
free on `/var`, else how much there is and what to free. Each step says what it does, how long and how much disk ("Step 1 of 3 …").
A refused password or a blocked work computer says who to ask and Docker's install page; an unknown package manager gives the link.
Then `systemctl enable --now docker` and `usermod -aG docker`; the new group only counts at a new login, so the service runs under
`sg docker -c` until then. The note `installed-docker` (the package manager's name) in the helper's folder records that the helper
installed Docker. Re-running keeps what is there.

**Remove this computer: clean up first, disconnect second, no command** (the owner's order of 2026-11-13). `worker.manage {action:
'remove', docker, keep}` records `removal {step: 'asked', askedAt, docker, keep}`; the worker's next claim is answered `{job: null,
remove: {docker, keep}}` (a computer that is off gets it when it next claims). A worker under a starter that cleans up
(`HCM_REMOVABLE=1`) says `accepted` (a claim with `removal`, taken whatever the guard says) and exits `76 + docker + 2·keep`
(`ExitCode.REMOVE` … `REMOVE_KEEP_DOCKER`); its supervisor stops the loops beside it, removes the sidecar, its volumes and the images it
pulled, then runs the worker once more with `HCM_REMOVAL=done` (the kept session in the volume signs it in; it says `done`, and the
server revokes the worker and its pairing in one transaction), then removes the worker's container, its volume (or, keeping the
scanned maps, only the `.hcm-session-*` sign-in in it), the pipeline's images, the helper's folder and last the service. Docker goes
only when asked and the note says the helper installed it, through `sudo -n`; with no password to give there it stays, and the done
says `dockerLeft` (the admin says so and how). A worker with no such starter (a command, an older starter, Windows until its
increment) says `failed` `no-starter` and keeps working. The admin shows each step in plain words; **Disconnect now anyway**
(`worker.revoke`) is offered only for a removal that waits on a computer that is off or failed, and only after it the line or file
that cleans the computer up by hand (`worker.starter` `uninstall` for the computer's `os`). On the computer itself, its page (`http://localhost:8765/`) has **Stop using this computer**
(`POST /remove` with the page's own token, after a confirm): the loop ends with `ExitCode.REMOVE` and the same cleanup follows
(the server takes the last `done` with no order asked); without a cleaning starter it answers 409 `no-starter`. By hand (`sh hcm-worker.sh uninstall`)
the same cleanup runs and asks, on a terminal, before removing a Docker the helper installed.

**The governor across computers**: each claim carries `share {profile, why, cores, threads, memoryMb}` from the governor's record
(`hcm_pipeline/worker/household.py`); `worker.claim` records it and, when the claimer is held back for its person (`profile` not
`full` and `why` one of `user-active`, `others-busy`, `battery`, `thermal`, `gpu-busy`), answers `{job: null, yielded: true}` while
another computer of the city is on, idle, not paused or removed and at `full` (`functions/src/worker/household.ts`). With no calm
computer it takes the job at its quiet pace: nothing waits for a computer that is not there. The owner's own Quiet (`why: owner`) is
no pressure.

**Increments**: one (the list, headless pairing, Docker on Linux, the remote removal by the POSIX starter, the governor); two, Windows
(below); three, macOS: without Docker the POSIX file (as `hcm-worker.command`) installs **Colima** with Homebrew (`brew install colima docker`:
Homebrew checks each bottle's SHA-256; Homebrew's current versions, not pinned by us), notes `colima` in `installed-docker`, starts it
sized for the pipeline (`--cpu 4 --memory 6 --disk 40`; on Apple silicon `--vm-type vz --vz-rosetta`, so the amd64 pipeline image
runs through Rosetta) and keeps it at each login with `brew services start colima` (Homebrew's own launchd agent). Without Homebrew it
installs nothing (Homebrew's installer is a script from the internet that asks for the administrator's password): it says why, opens
brew.sh and names Docker Desktop. The removal takes Colima (`brew services stop`, `colima delete -f`, `brew uninstall colima docker`)
only by the note, with no password. **UNVERIFIED** until a real Mac: Colima with Rosetta for the pipeline image, Colima's docker
context in the LaunchAgent's environment.

**Windows without Docker Desktop (increment 2).** `hcm-worker.bat` uses Docker Desktop when it runs. Otherwise, each step said with its
time and size: 20 GB free on the system drive (else how much and what to free); virtualization on in the firmware (`Win32_Processor.
VirtualizationFirmwareEnabled`, or a hypervisor already present; else how to turn it on, `https://aka.ms/enablevirtualization`);
**WSL** turned on with one Windows permission prompt (`wsl --install --no-distribution`, `-Verb RunAs`, the only elevation of the
file besides turning WSL off again), a RunOnce entry of the user that resumes the setup after the restart, and the note
`installed-wsl`; then **the helper's own Linux**, `wsl --install Ubuntu-24.04 --name hcm-worker --no-launch` (after `wsl --update`
when that fails), systemd on, the note `installed-distro`; then **Docker Engine** in it from Docker's apt repository, its key checked
against Docker's fingerprint `9DC8 5822 9FC7 DD38 854A E2D8 8D81 803C 0EBF CD88`, `docker-ce`/`docker-ce-cli` pinned
(`$DockerVersion`) and held. Every `docker` of the file then runs there (`wsl -d hcm-worker -u root -- docker`), the worker's port
reaches Windows' `127.0.0.1:8765` through WSL's localhost forwarding, so the admin's auto-pair works unchanged. **The keep-alive**:
WSL stops when no Windows program uses it (the owner's PC, 2026-11-13, even with `vmIdleTimeout=-1`), so the supervisor (the task at
logon, no administrator) starts one hidden `wsl -d hcm-worker -e sleep infinity`. Settings > Apps lists **Historic City Map Maker
helper** (`HKCU\...\Uninstall\hcm-worker`), whose Uninstall runs the removal; the removal asks before unregistering the helper's
Linux (and with it its Docker) and before turning WSL off, each only by its note. A headless Windows computer takes
`HCM_PAIR_CODE` from the environment, clears it and posts it to its worker as the POSIX file does. The remote removal is the POSIX
file's: `HCM_REMOVABLE=1`, exit 76-79, `Remove-ByOrder` (the helper's own Linux unregistered when Docker is to go: it held only
the helper's Docker). Tests: the file's structure (`functions/test/worker/starter-windows.test.ts`; the quality image has no
PowerShell). **UNVERIFIED** until a real Windows computer runs it: `wsl --install --name` (WSL 2.4.4 or later), the RunOnce resume,
the localhost forwarding of a port Docker publishes on WSL's loopback, the keep-alive under the task at logon.

### §10, the security review of household computers (added)

1. **The code of the headless line (§10.23).** Same entropy and storage as §10.8 (130 bits, stored as its SHA-256 prefix, one use);
   45 minutes instead of 10, because the computer may install Docker and pull about 3 GB first. It never is an argument of a program
   (`echo` is the shell's built-in; the starter reads standard input; `curl` reads the JSON body from standard input), so `ps` on a
   shared computer never shows it; it is never written to a file by us (the shell's own history may keep the pasted line: spent at the
   first start, useless after 45 minutes). `HCM_PAIR_CODE` is cleared as soon as it is read, so the service and every process the
   starter starts never inherit it. A stolen line pairs a computer to the owner's account for this city only, with the worker's
   scope of §10.9, and the list shows it by name: Remove disconnects it.
2. **Why not the reverse (the computer shows a code the owner types).** A device-code flow keeps the secret on the computer, but it
   asks the owner to read a code on the other computer and type it back (two transfers instead of one paste), and it opens the known
   device-code phishing path (someone gets the owner to type their code into the admin). The minted line is simpler and binds the
   code to the owner who minted it in a signed-in admin with App Check.
3. **The starter posts to its own worker's page (§10.24).** `POST /pair` with the Hosting origin from a local process is what §10.16
   already allows a process of the same user; nothing is widened. The tunnel is gone: no port of one computer is exposed to another.
4. **Installing Docker (§10.25).** Only the distribution's own signed packages through its package manager, which verifies them; no
   script is downloaded and piped to a shell. sudo asks on the terminal; the starter holds no password. The docker group gives the
   account root-equivalent power over Docker, as Docker's own post-install steps do; the owner is told in the line's description.
5. **Remote removal (§10.26).** Only the city's editors can ask it (`worker.manage`, `cityEditor`, App Check); the order reaches only
   that worker through its own claim; it only deletes what the helper made (by name and by the repository's prefix) and Docker only by
   the helper's note, never with a password typed by anyone. The last `done` is the worker's own sign-in, which can only revoke itself.
6. **The share and the names (§10.27).** Written only by the functions from the worker's own calls; read by the city's members, as the
   worker documents already were. A host name is limited to `[A-Za-z0-9._-]` and rendered as text.

**UNVERIFIED** (§11, added): `loginctl enable-linger` without sudo over SSH on each distribution (polkit's `set-self-linger`), `sg`
in a user service on each distribution, `apt-get install docker.io` on Debian and Ubuntu releases older than 22.04, and the remote
removal's last run on a computer whose Docker was just removed. The first headless computer of a real owner proves the line.

## Addendum of 2026-11-14: crashes, power cuts and the worker's disk

Sources: `RESILIENCE-AUDIT.md` (a household computer without a UPS: a hard power cut mid-step, an unclean Docker shutdown, a full
disk) and the owner's cleanup brief ("workers must not leave behind temp or unnecessary data": on the laptop the `hcm-worker` volume
held 113 GB, `work/` 81 GB of 100 jobs mostly published, `usgs-raw/` 24 GB, and 46 old pipeline images 156 GB of Docker's disk).

### Crashes and power cuts

1. **A lost run does not use an attempt (P0-1).** A local run whose worker stopped without `worker.end` (lease lapsed, or its
   heartbeat late by `HEARTBEAT_LATE_BEATS` beats, as for Cloud Run) is queued again by `imagery.tick` with its attempt given back
   (`functions/src/imagery/lost-run.ts`), and the job's log says the computer stopped and the try was not counted
   (`apiError.imagery.workerLostRefunded`). `lostRuns` counts these refunds; past `LOST_RUN_REFUNDS` (5) the attempt counts again
   (`apiError.imagery.workerLost`), so a job that brings its computer down every time still ends.
   Finding of 2026-11-14 (1923 plan-ghid): the job records the computer that lost it (`lostOn`); that computer's claim leaves it to the
   owner's other computers for `LOST_HAND_OVER_MS` (15 minutes), and a second loss on it logs `apiError.imagery.workerLostAgain`.
2. **The same computer frees its own job at once (P1-3).** A worker claims only when it runs nothing (`loop.py` `run_once`), so a
   claim from a worker whose document still says `busy` with a job that is `starting` or `running` under its id means that run died
   with the computer: the job is queued again in the claim's transaction, with the same refund, before the claim looks for work.
3. **Durable writes (P0-2, `pipeline/src/hcm_pipeline/durable.py`).** Every file the worker keeps (the session and worker id, the
   governor's choice, the fetch checkpoint, the store's objects, the AI files and their `ready.json`) goes to a hidden
   `.<name>.<hex>.tmp`, is `fsync`ed, renamed over the target, and the folder is `fsync`ed. Each chunk of a local delivery session
   is `fsync`ed before the next is asked for, and the finished session is renamed the same way. The matcher's request box is not:
   its files mean nothing after a restart, which clears them.
4. **A resume checks what it passes over (P0-3, `intact.py`).** On a worker, a step recorded `done` is passed over only when its
   local output (`work/`, `usgs-raw/`, `reference/`) has the size the step recorded, is not empty, and starts as its kind does (a
   TIFF's byte order and magic, `PMTiles`, a JSON document that parses). A damaged output is said in the job's log and its step runs
   again in the same run, without an attempt. Objects in Cloud Storage are whole or absent and keep the generation check.
5. **Uploads restart clean (P0-4).** A signed PUT a cut stops leaves no object; the step was not recorded, so it runs again. An
   upload whose `x-goog-hash` names another MD5 than the file's is sent once more, then fails: a damaged object is never recorded.
   Resumable signed sessions are not built: the version files are a few hundred MB and the clean restart costs one upload.
6. **A full disk hands the job back (P1-6).** An `ENOSPC` anywhere in a step on a worker (an `OSError`, or GDAL's "No space left
   on device") puts the step back to `pending`, says in the job's log what happened and where to free space, and ends the run
   `released` with `diskFull`: the server gives the attempt back (`worker.end`), and the worker claims nothing while its disk is
   under its floor (`lowDisk`, below).
7. **Restart after a reboot (P1-1).** The worker's container runs with `--restart unless-stopped` (not `--rm`), so Docker brings it
   back after a reboot even when the supervisor needs a logon first (Windows, macOS). The supervisor stays in charge while it runs:
   it removes the container after each run (`docker rm -f`) and decides what follows, as before. `docker stop` (stop, uninstall)
   is not restarted by Docker.
8. **Leftovers.** On start, and on each pass, `*.tmp` and `*.part` files not written for an hour (a resumable session's own
   `.sessions/*.part` excepted) are deleted: a live write touches its file every few seconds.

### Disk: what the worker keeps

1. **Job scratch (`worker/sweep.py`, `worker/housekeeping.py`).** Once an hour each claim names the jobs whose scratch is on the
   computer (`held`, at most 200, longest unwritten first); the answer's `jobStates` gives each one's status or `gone`. A folder
   goes when its job is `succeeded`, `failed`, `cancelled` or `gone` and nothing in it was written for 48 hours; a job the server
   lists in any other state (queued for points, awaiting approval: its stitched film is there) is never deleted, however old; a
   folder the server said nothing about ages out after 14 days as before; the claimed job's folder is never touched.
2. **Raw deliveries.** `locate` deletes the job's `usgs-raw/` delivery only after a proved full-resolution crop, and `recrop` once
   rough points are cut at full resolution; a frame nothing proved (a bounded guess or a whole frame shrunk) keeps it, on a worker
   too (live 2026-11-14, DS1111: lesson 710); an unreferenced delivery still goes after 7 days. Deleting an object
   removes the folders it leaves empty.
3. **The disk floor and Free space now.** Each claim says `disk` (`workBytes`, measured every 10 minutes; `freeBytes`;
   `floorBytes`, 15 GB): under the floor the server answers `lowDisk` and gives no job, and the worker sweeps finished jobs without
   their grace. The admin's computer card shows the use and the free space, a warning under the floor, and **Free space now**
   (`worker.manage` `freeSpace`): the next claim's `freeSpace` makes the worker sweep finished jobs at once and report `freed`
   (bytes, time), which the card shows. Both deletions without grace use job states no older than 10 minutes, asking again first:
   a failed job the owner retried since must keep its scratch.
4. **Old images.** Before each run the supervisor keeps the pipeline image it runs and the previous one (the rollback) and removes
   older `…/hcm/pipeline@sha256:` images, then prunes dangling images labelled `org.historiccitymap.worker` (the Windows starter:
   `Remove-OldPipelineImages`); no other image is touched. The AI sidecar's old image goes at once after a new pin, as before.
5. **Not done.** The `import/` copy of an archive is the owner's source on the computer that imported it and stays (M20);
   a startup check of a Docker volume damaged by a power cut (P1-7), the browser-only session after a reboot (P1-2, pairing is the
   starter's path), clock and network waits at boot (P1-5) and a Windows task that runs without a logon (P2-3) are open.

Tests: `pipeline/tests/unit/test_durable.py`, `test_runner_resilience.py`, `test_worker_cleanup.py`, `test_worker_objects.py`;
`functions/test/imagery/tick-local.test.ts`, `functions/test/worker/{claim,cleanup,pause,starter}.test.ts`; scenarios S-P04 and S-A62.
