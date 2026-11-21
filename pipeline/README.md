# Raster pipeline (`hcm_pipeline`)

The Python + GDAL pipeline that turns declassified USGS film scans (and uploaded GeoTIFFs) into georeferenced layer
versions awaiting approval, run as the Cloud Run Jobs `raster-pipeline` and `raster-pipeline-xl`. `python -m
hcm_pipeline run` walks a job's remaining steps; publishing to Mapbox is not the pipeline's (functions' `imagery.publish`
runs after approval, so the pipeline holds no Mapbox secret). Contract: `docs/research/M3-interfaces.md` (§4 the job
model, §5 the steps, §6 the georeferencing conventions); plan: `docs/research/PLAN.md` → *Raster pipeline*; skill:
`.agent/skills/pipeline/raster_pipeline_skill.md`.

## Steps

| Job type | Steps (`JOB_STEPS`, the pipeline's part) |
| --- | --- |
| `usgs-import` | `fetch` → `extract` → `stitch` → `locate` → `reference` → `georef` → `warp` → `export` → `register` |
| `geotiff-import` | `inspect` → `reference` → `georef` → `warp` → `export` → `register` (an upload with its own georeference skips `reference` and `georef`) |
| `regeoref` (new points, or a crop) | `georef` → `warp` → `export` → `register`, on the base version's scan |

- `fetch`: `download-options` (Landsat: Product Bundle by name), `download-request` labelled `hcm-{job}`,
  `download-retrieve`; the signed address streamed into a Cloud Storage resumable session in 64 MiB chunks (checkpoint
  `work/{city}/{job}/fetch.checkpoint.json`); a resume asks the session what it holds and sends `Range`; a 403 or 410
  retrieves a fresh address; a redirect is followed only through the address guard; the transfer size is the larger of
  `download-options` and Content-Length (a Landsat bundle whose announced `filesize` is band-scale is kept; a truncated
  body is refused); a connection dropped mid-body resumes with `Range` from the bytes held (five times per address,
  then `downloadIncomplete` with the session kept); SHA-256 read back in-region. Maintenance waits 30 minutes doubling to 12 hours; a rate limit waits
  its `Retry-After`; a preparing download waits 10 minutes.
- `extract` keeps the TIFF segments of the `.tgz` (streamed) or `.zip`; `stitch` places them (template matching, coarse
  to fine, exact within 1 px), cuts the film border and records the exposure's columns when a dark gap parts it from a
  fragment of the next one, on either side (`frame.json`).
- `locate` (`docs/research/M9-calibration.md`, `calibrate/`): the square-pixel assignments of the frame's corners to the scene's, a
  camera with a half angle through its panoramic model (`georef/panoramic.py`), on its exposure alone, a film shorter than a full
  sweep's swept less and off the nadir as its ends' widths say. Tiles of Sentinel-2 vote for where the frame lies (`calibrate/votes.py`,
  a counted budget of matches, a neighbouring frame of the pass first when the city has one); each proposal must prove itself on dense
  tiles with no landmark (`calibrate/dense.py`, `proof.py`), checked at cells set aside before RANSAC. **Proved:** only what the frame
  reaches of the city window is cropped, the tiles go to `calibration.json` for `georef` and the delivery is deleted. **Not proved:**
  no failure: `bounded_crop` holds the window with a 20 km margin under the orientations that reach it, cut to `MAX_SCAN_PIXELS`; the
  delivery stays, the matcher still runs at its unchanged bar, and with too few pairs the admin places the points, which then seed the
  same tiles. `apiError.imagery.cityNotFound` is left for a frame that reaches the window under no orientation. A local matcher plugs in
  behind `calibrate/ports.py` on the worker alone; today's is `NullProposalMatcher`.
- `reference`: Sentinel-2 L2A from the STAC API (`stac.py`, the `visual` COG through `/vsicurl/` after the address
  guard `urlguard.py`) and OpenStreetMap from Overpass (`osm.py`), cached under `reference/{city}/`; the
  georeferencer's `reference-s2.jpg` and `reference-osm.png`. **Never Mapbox Satellite**: `config.py` refuses a Mapbox
  host as a reference service and the guard refuses one as an asset.
- `georef`: automatic GCPs (`georef/matcher.py`: CLAHE, SIFT per cell within a search window, NCC fallback, RANSAC, three
  levels, at most two pairs per cell; `poly2` from 12 well-spread pairs, else `affine` from 6) or the fit of the admin's
  points (`georef/transforms.py`: affine, poly2, thin-plate spline, leave-one-out checkpoints, residuals in ground
  metres). Too few pairs make the job wait for points (`awaiting_gcps`, the version `needs_gcps`).
- `warp`: `gdalwarp` with the enabled GCPs in EPSG:3857 (or the upload's own georeference) at the resolution of the
  layer's `maxzoom` on the tile grid, an alpha band, `-cutline` for a crop; `export`: the 8-bit JPEG COG (alpha as a
  mask), the RGBA preview, the Studio GeoTIFF of at most 300 MB, the valid area; `register`: the version
  `awaiting_approval`, the job's scratch objects deleted.
- `locate` deletes the job's USGS delivery (`usgs-raw/`) once `scan.tif` and the version's `scan` are recorded, and
  logs it (M7: `docs/research/M7-local-worker.md` §5); a later run of the job passes `fetch` over while `locate`'s crop
  exists, and downloads again only when the crop is not there yet.

## Layout

| Path | What |
| --- | --- |
| `main.py`, `steps/run.py` | `python -m hcm_pipeline run` (or one step, `doctor`, `--list`): logging, configuration, exit codes |
| `config.py` | the job environment (below), validated; secrets are never part of it |
| `runner.py`, `lease.py`, `jobs.py` | the lease, the heartbeat, the step loop, SIGTERM, cancel, waits and failures; what a step gets and returns |
| `contract.py`, `paths.py`, `model.py`, `documents.py` | the constants, paths and documents shared with `@hcm/shared` (`tests/contracts/`) |
| `store.py`, `objects.py`, `tokens.py`, `secrets.py` | Firestore (precondition writes), Cloud Storage (JSON API over httpx: resumable sessions, create-only writes), tokens, Secret Manager |
| `m2m.py`, `usgs.py` | the USGS M2M client and its download calls |
| `stac.py`, `osm.py`, `urlguard.py` | the references and the guard for addresses from data |
| `georef/` | `transforms.py`, `corners.py`, `matcher.py` |
| `raster.py`, `rasters.py`, `images.py` | the one GDAL import, GDAL file helpers, OpenCV images |
| `services.py` | the composition root: the real adapters (the emulators under `FIRESTORE_EMULATOR_HOST` and `STORAGE_EMULATOR_HOST`) |
| `steps/` | one file per step, `common.py` for what they share, `doctor.py` |
| `worker/` | M7, the local worker (`python -m hcm_pipeline worker`): its arguments, the owner's session, the local page and its server, the callables' client, the stores over `worker.step` and signed URLs, the work folder, the USGS proxy, the loop |
| `typings/osgeo/` | mypy stubs for the GDAL API the code calls |

## Configuration

`JOB_ID`, `CITY_ID`, `GOOGLE_CLOUD_PROJECT`, `HCM_PRIVATE_BUCKET`, `HCM_PUBLIC_BUCKET`, `USGS_M2M_BASE_URL` (optional),
`HCM_STAC_URL` (default Earth Search), `HCM_OVERPASS_URL` (default overpass-api.de), `HCM_DEM_URL` (default the Copernicus
DEM GLO-30 tiles on AWS open data, M15 *Terrain*; not sealed under the emulators: a real address is refused there and the frame is
fitted flat), `CLOUD_RUN_EXECUTION` and
`CLOUD_RUN_TASK_ATTEMPT` (the lease owner). The e2e pipeline tier adds `FIRESTORE_EMULATOR_HOST` and
`STORAGE_EMULATOR_HOST` (loopback only) and `HCM_E2E_USGS_TOKEN` (a scenario test value); `GDAL_NUM_THREADS`, when
set, replaces the default `ALL_CPUS`. The USGS credentials (`usgs-username`, `usgs-app-token`) are read from Secret Manager at
run time.

## The local worker (M7)

`python -m hcm_pipeline worker --city <id> --project <id> [--pair <code>] [--port 8765] [--work /work] [--emulators]`
runs the city's jobs chosen for the owner's computer (`docs/research/M7-local-worker.md` and its addendum of
2026-11-02). In the pipeline image, the admin's one-line command: `docker rm -f hcm-worker 2>&1 | true; docker run
-d --name hcm-worker --restart unless-stopped -p 127.0.0.1:8765:8765 -v hcm-worker:/work <image@digest> worker --city
<city> --project <project> --pair <code>` (the named volume is initialised from the image's `/work`, owned by the
worker's user). `--pair` (`worker/pairing.py`) exchanges the one-time code through `worker.pair` for a custom token,
signs in at Identity Toolkit (the Hosting origin as `Referer`) and keeps the refresh token in
`/work/.hcm-session-<city>.json` (mode 600), so a restart resumes it; without a code, the page at
`http://localhost:8765/` offers a Google sign-in as a fallback (it gives up after 90 s). After `worker.hello` accepted
the token, the worker claims a job every `pollSeconds`, runs it with the normal runner (documents through
`worker.step`, the version's files through signed URLs, the delivery, the scratch and the reference cache in `/work`,
USGS through `worker.urls`) and reports `worker.end`. `apiError.worker.revoked` (Disconnect this computer) ends the
session and deletes the kept one; an `outdated` answer (the installed pipeline image changed) stops claiming and says to
run the admin's command again. Ctrl-C or SIGTERM requeues a running job and exits 0. Under `--emulators` every address
is this machine's: `FIREBASE_AUTH_EMULATOR_HOST`, `FUNCTIONS_EMULATOR_HOST`, `HCM_HOSTING_HOST` (serves
`/__/firebase/init.json`), `HCM_STAC_URL`, `HCM_OVERPASS_URL`.

## Exit codes

`0` done, waiting (USGS, the admin's points, approval), cancelled, requeued after SIGTERM, or not this execution's job
(a live lease elsewhere); `1` the job failed (an invalid job included; retries are the dispatcher's); `2` bad command
line; `3` incomplete or invalid environment.

## Tests

- `tests/integration/`: whole jobs against the loopback world (`tests/fakes/world.py`: the fake M2M server, one fake
  HTTP host for the USGS delivery, the STAC API with its Sentinel-2 COG and Overpass, the fake Cloud Storage JSON API,
  an in-memory Firestore); they carry the `S-P01-*` and `S-P02-*` scenarios in their docstrings.
- `tests/unit/`: each module, the golden contracts (`tests/contracts/`, owned by the contract: both languages must pass
  a change) and hypothesis properties of the transforms.
- `tests/synthetic/scenes.py`: a seeded world, its Sentinel-2-like GeoTIFF and Overpass answer, a film frame made by
  inverse warp through a known transform (projective, panoramic term, rotation and mirror), split into segments and
  packed as a `.tgz`, with offset metadata corners. For the e2e mock servers:

  ```bash
  PYTHONPATH=pipeline/src python pipeline/tests/synthetic/scenes.py --out reports/e2e-fixtures/imagery --seed 7
  ```

- Every test runs behind the loopback firewall; GDAL and OpenCV run on one thread with fixed seeds.

## Toolchain

- `osgeo.gdal` comes from `ghcr.io/osgeo/gdal:ubuntu-small-3.13.3` (by digest, Python 3.14); it is never
  pip-installed. The venv is created with `--system-site-packages` and without pip.
- Poetry 2.5.1 (`requirements-poetry.txt`, every transitive dependency pinned) locks `poetry.lock`. Regenerate the lock
  inside the quality image, never on the host:

  ```bash
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp/hcm-home -v "$PWD:$PWD" -w "$PWD" hcm-quality:local \
    bash -c 'mkdir -p $HOME && /opt/hcm/poetry/bin/poetry --directory pipeline lock'
  ```

- Every pipeline command runs from the repository root: `pyproject.toml` holds the pytest, coverage and mypy settings
  with repository-relative paths, so the reports land in `reports/coverage/pipeline.xml` and `reports/junit/pipeline.xml`.

## Quality gates

The quality image (`docker/Dockerfile.quality`) carries Poetry in `/opt/hcm/poetry` and the locked dependencies in
`/opt/hcm/pipeline-venv`, so the gates run there like every other gate (`python3 scripts/ci/pipeline.py --list`):

| Gate | Stage | Checks |
| --- | --- | --- |
| `ruff-check`, `ruff-format` | static | the repository-wide `ruff.toml` (complexity 5) |
| `pipeline-lock` | static | `poetry check --lock --strict`: the lock matches `pyproject.toml` |
| `pipeline-mypy` | static | mypy strict over `src` and `tests`, against the pipeline venv |
| `pipeline-radon` | static | radon grade A (complexity and maintainability) for `src` and `tests` |
| `pipeline-bandit` | static | bandit, every severity, for `src` |
| `pipeline-pip-audit` | static | the pipeline venv and the Poetry pins |
| `pipeline-pytest` | tests | the suite with branch coverage; `coverage` then holds every file to 90 % |

## Images

`Dockerfile` (build context `pipeline/`) has the stages `base` → `deps` → `test` | `runtime`:

```bash
docker build -f pipeline/Dockerfile --target runtime -t hcm-pipeline:local pipeline && docker run --rm hcm-pipeline:local
docker build -f pipeline/Dockerfile --target test -t hcm-pipeline:test pipeline && docker run --rm hcm-pipeline:test
```

`runtime` runs as uid 10001 with the venv and the package only (no pip, no test tools, no secret); its entry point is
`/opt/venv/bin/python -m hcm_pipeline` with the default command `doctor`; the Cloud Run executions pass `run`.
Configuration arrives in environment variables, the USGS credentials from Secret Manager at run time.
