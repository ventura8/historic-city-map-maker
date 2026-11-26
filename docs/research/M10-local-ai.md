# M10: the local matcher (contracts)

The owner, 2026-11-06: if calibration uses AI, it runs locally on the admin's computer, GPU first, CPU fallback only, never a cloud service.

**Built on 2026-11-07, behind gate R1 below; what differs from this design and what ran for real: [As built](#as-built-2026-11-07).** Whether one strong rescue justifies about 10 GB on the admin's machine stays the owner's decision (*Should it land?*).

## Decision

**ALIKED + LightGlue at 15 m a pixel**, on the worker only, behind a landing gate. No RoMa or MINIMA now.

| Candidate | Why |
| --- | --- |
| ALIKED + LightGlue | Weights explicitly licensed; 1.15 GB VRAM, 2.5 GB RAM, about 30 s on the GPU; the only usable CPU path (17 to 19 min, measured) |
| MINIMA-RoMa, RoMa | Better on hard windows (Test C 9/9 against 6/9), but 6.46 GB VRAM, 1.66 GB more files, weights only implied. **Owner's decision**; the port takes them later |

**It has not yet earned its place.** Test A adds nothing: votes already prove those frames (M9 §14). What votes refuse (Fetești on F006 and F007, Slobozia on F006) was never given to a matcher, and no votes control ran on Test C's starts.

**Gate R1, before any merge:** the product's `find_frame`, votes alone against votes + ALIKED, on those three, Test C's nine windows and `m9-false.py`'s wrong proposals, judged by `calibrate/proof.py` (stricter than the measured judge: it adds share, spread, covered, gross). It lands only if at least one frame moves from `none` to proved, checked by checkerboard, with zero false accepts. Otherwise `NullProposalMatcher` stays. A 1 km rural window stays with the admin's points.

## Two chain gaps, whichever matcher

1. **A small window cannot prove.** M9 §14: 6 x 4.8 km reaches 35 tiles against `PROOF_MIN_INLIERS` 60; Test B: 10 of 86 pass from the truth itself. A perfect proposal would be refused. Fix: matcher proposals are proved over a reference of at least `MATCHER_PROOF_SIDE_GROUND_M = 30000` (what Test C used), the **same gates, none softened**. `FrameSearch` gets a lazy `wide()` through `sentinel2(ctx, wider)`. The crop stays the city's. If `calibrate/pairs.py` finds too few pairs inside it, the version goes to `needs_gcps` with the proved corners.
2. **The port lacks what was measured.** `ProposalRequest` holds a 30 m preview, and ALIKED at 30 m failed F040 0/3. Add `starts` (each orientation's matrix, best votes first), `read: FilmReader` and `tick`. `_from_matcher` stops at `run.left` proofs and stops writing `support` into `Found.votes`: AI counts go to `proposer.support`, display only.

## Delivery: a sidecar container, not a bigger image

`pipeline/Dockerfile`'s `runtime` target gains no torch, because:

- The matcher's stack is Python 3.12 (`kornia_rs...cpython-312`), the pipeline's 3.14.
- `--network none` makes "no cloud inference" a fact of the container.
- The worker's volume holds the refresh token (`.hcm-session-<city>.json`); the sidecar never mounts it.

| Piece | Where | Size |
| --- | --- | --- |
| Measured image by digest from Docker Hub, `pytorch/pytorch:2.15.0-cuda13.2-cudnn9-runtime@sha256:924707fa...`; never re-hosted (Artifact Registry storage and egress; CUDA library terms unread) | Docker's store | 9.68 GB |
| `aliked_lightglue.pth` (`d975e965...`), `aliked-n16.pth` (`5be87048...`), LightGlue tarball (`d46a0782...`), kornia and kornia_rs wheels (PyPI's sha256), a copy of our matcher code | volume `hcm-ai-files` (worker writes, sidecar `:ro`) | about 0.3 GB |
| Requests and answers | volume `hcm-ai-box` | under 200 MB, deleted after each answer |

New code: `pipeline/src/hcm_pipeline/matcher/` (`serve.py`, `search.py` from `reports/calib/ai/search.py`, `torch_backend.py`, `pins.json`), importing no `hcm_pipeline` module, plus `worker/ai_files.py`, `worker/local_matcher.py`. Cloud Run's image gains a few KB of unimported Python and two empty folders (`/ai/files`, `/ai/box`, owner 10001).

**Nothing downloads until a frame needs it.** On first need the worker's `/state` reports `ai.wanted` and the image from `pins.json`; `ai_files.py` fetches each file behind `check_data_url` and a host allow-list, hashes while streaming, renames on match. Wheels are unzipped, never run through pip. Upstream publishes no weight digests, so those pins are trust on first use. `locate` waits at most 30 minutes, logging "first use: about 10 GB".

## The starter file enables the GPU

`packages/admin/starter/hcm-worker.sh` and `.bat` gain a background loop, `run_matcher`; the worker stays without a Docker socket. It polls `127.0.0.1:8765/state`; when wanted:

1. Accepts only `pytorch/pytorch` + `@sha256:<64 hex>`; requires 30 GB free, read by `df` inside a container (true under Docker Desktop too); `docker pull`.
2. Initialises the volumes with one run of the worker's image, so their owner is 10001.
3. Probes `torch.cuda.is_available()` in order: `--gpus all` (the measured path), then `--device nvidia.com/gpu=all` when `docker info` lists it (**UNVERIFIED**), then none.
4. Runs, re-probing at every start, **and only while a frame wants it** (*As built*), so a driver installed later is found by the next frame:

```text
docker run --rm --name hcm-matcher <gpu flags> --network none --cap-drop ALL \
  --security-opt no-new-privileges --memory 4g --memory-swap 4g --cpu-shares 128 --shm-size 1g --pids-limit 512 \
  --tmpfs /tmp -u 10001:10001 -e HOME=/tmp -e HCM_AI_DEVICE=gpu|cpu -e HCM_AI_WHY=<reason> \
  -v hcm-ai-files:/ai/files:ro -v hcm-ai-box:/ai/box --entrypoint python <image> /ai/files/code/serve.py
```

Log lines: `local AI: graphics card found` or `local AI: no usable graphics card; using the processor (slower)`. With `HCM_AI_DEVICE=gpu`, a process that finds no GPU exits 77 and the loop probes again: **a silent CPU run is impossible**. The worker's `docker run` gains both volumes and `-e HCM_STARTER=<version>` (`2` then; the content's version since 2026-11-13: `docs/research/M7-local-worker.md`, *The starter updates itself*) (an old image refuses unknown arguments, not variables). Without it the worker reports `old-starter` and the panel asks for the new starter once. `uninstall` removes both volumes and the image. macOS: Docker gives no GPU; arm64 is unsupported.

## Cloud Run

`services.py` keeps the default `NullProposalMatcher`; only `worker/runtime.py` injects `LocalMatcher`. A cloud `locate` refuses as today (`how: 'none'`, `no-votes`), keeps the delivery and goes to the admin's points, logging "no local AI in Google Cloud".

## Memory and budgets

- 4 GB cap against 2.5 GB measured (6 GB until 2026-11-12, `reports/resource-audit.md`), a low CPU weight (`--cpu-shares 128`); 2,048 keypoints; pair gate 12 inliers, as Tests A and C; one run at a time.
- Under `MATCHER_MIN_VRAM_GB = 2`, the CPU.
- Each request runs in a child process that imports torch and exits, so an idle sidecar holds no VRAM.
- CPU: the logical threads but one, niced by 10 (half of them until 2026-11-12); the first 2 orientations by votes (GPU: all), each at every scale of the sensor. Timeout per request: 10 min GPU, 45 min CPU (adapter only, injected clock).

## Failure modes

Each ends at the admin's points with a log line, never a failed job; none softens a gate.

| Failure | Result |
| --- | --- |
| Pull fails, disk short, arm64, old starter | `Null` for this run; panel says why |
| File hash mismatch | Deleted, refetched once, then `Null`; weights re-hashed at load, `weights_only=True` |
| GPU out of memory | That request reruns once on the CPU, `fallback: 'out-of-memory'` |
| Sidecar crash, timeout, garbage answer | `Null`; answers validated (finite, at most 3, `allow_pickle=False`, scale 0.85 to 1.15) |
| Wrong proposal | The proof refuses (`m9-false.py`: at most 18 tiles, gate 60) |
| Job cancelled | `tick` stops the wait; a cancel file goes into the box |

## What the admin sees

- `calibrationSchema` (`schemas/imagery-calibration.ts`, twin `documents.py`, golden `written-documents.json`) gains `proposer: {name, device: 'gpu'|'cpu', deviceName?, seconds, support, fallback?: 'no-gpu'|'out-of-memory'}`.
- `calibration-card.ts` stops mapping `local-ai` to `how.votes`. New key `how.localAi`: "Proposed by the AI on your computer ({device}), proved by the map's own check"; ro "Propusă de AI pe calculatorul tău ({device}), dovedită de verificarea hărții".
- `workerDocSchema` gains `ai: {state, device?, deviceName?}` through `worker.hello`; `<hcm-worker-panel>` shows "Local AI: graphics card NVIDIA RTX 3080", "processor only", "comes when a frame needs it" or "unavailable: why", in `admin-worker/{ro,en}.ts`.
- Job log: `local AI (aliked-lightglue, gpu, NVIDIA RTX 3080): 2 proposals in 31 s`, then the proof's own line.

## Tests: no GPU, no weights in any gate

- **Fake proposer:** `tests/unit/calibrate_scene.py` already takes `matcher=`. Right: proved, `local-ai`. Wrong, even with huge support: refused. None: `no-votes`. Small window: proved only over `wide()`.
- **`search.py`:** real consensus in the pipeline venv with a fake backend of synthetic keypoints; a mirrored reference proposes nothing.
- **`torch_backend.py`:** a fake `torch` module, stubs in `pipeline/typings/torch/`: device order, exit 77, out-of-memory rerun, `weights_only=True`. Per-file 90 % holds, no exclusion.
- **`local_matcher.py`, `ai_files.py`:** a fake answering the box: tampered file, timeout, garbage.
- **Starter:** `functions/test/worker/starter-sidecar.test.ts` runs the `sh` template with fake `docker` and `curl` on `PATH`: each probe outcome, the refused image, the sidecar's life. PowerShell: `starter-windows.test.ts`, a reader of its strings and text assertions (the quality image has no PowerShell).
- **e2e:** `S-P04-HAPPY-WORKER-RUN`'s tier with the fake box. R1 is a manual rehearsal, recorded in M9 §14.

**Rows:** P07: `S-P07-HAPPY-GPU`, `S-P07-HAPPY-CPU-FALLBACK`, `S-P07-HAPPY-SMALL-WINDOW`, `S-P07-BAD-FALSE-PROPOSAL`, `S-P07-BAD-TAMPERED-FILE`, `S-P07-BAD-OUT-OF-MEMORY`, `S-P07-BAD-NO-ANSWER`, `S-P07-BAD-CLOUD-NO-AI`. A68: `S-A68-HAPPY-DEVICE-SHOWN`, `S-A68-BAD-AI-UNAVAILABLE`; states join `e2e/tour/states.ts`.

## Licence notice

- **New catch:** LightGlue's `lightglue/superpoint.py` is headed "Magic Leap, Inc. ... CONFIDENTIAL", and its `__init__.py` imports it. The measurements imported that file, though never its weights. **Extract only `aliked.py`, `lightglue.py`, `utils.py` and `LICENSE`**, with our own `__init__.py`; a test asserts `superpoint` is absent.
- As read: LightGlue Apache-2.0, its README licensing the weights; `aliked.py` headed BSD-3-Clause; kornia Apache-2.0 by metadata. Read ALIKED's own licence file and the wheels' before merge.
- The owner's computer fetches everything from upstream; we redistribute only our code. New `matcher/NOTICE.md` (`check_notices.py` covers only bundles), linked from `ADMIN_GUIDE.{en,ro}.md`.

## UNVERIFIED and open

`--gpus all` on Docker Desktop for Windows (under `--cap-drop ALL` on Linux it ran, below); CDI; the PowerShell loop; KH-4 and KH-7 (the pair gate's 4 degrees assumes the panoramic model); any other city. Open for the owner: RoMa escalation; depending on Docker Hub keeping that digest.

## Gate R1: the record (2026-11-07)

**Four windows moved from `none` to proved inside the product's `find_frame`, with zero false accepts.** Only one of the four is a real, useful rescue that no other route I tried reproduces: Fetești on F006.

### Setup

- `pipeline/src` at 17481a0, synced to the NUC.
- ALIKED + LightGlue at 15 m a pixel on the RTX 3080, using `dk.sh`'s pinned image with `--network none`.
- Proposals were replayed through the `ProposalMatcher` port.
- Every verdict comes from `calibrate/proof.py`, with no gate softened. Matcher settings are those of Tests A and C, not tuned.

## What moved from refused to proved

| Window | Votes alone | Votes + AI | Votes with `0.94,1.0` | Votes, Bucharest prior | Votes, 720 tiles a warp | Share of window on film | Tiles agreed | 5-fold (checks) | Checkpoint | Blocked | Rival, sigmas | In place / 300 m off |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **F006, Fetești** | none | **proved** | none | none | none | 78.6 % | 1,192/1,388 | 18.9 m (152) | 19.9 m | 13.4 m | 0.074, 4.7 | 0.299 / 0.005 |
| A015, Bucharest | none | proved | **proved** | not run | not run | 79.0 % | 1,115/1,409 | 16.0 m (169) | 18.0 m | 14.0 m | 0.067, 3.8 | 0.172 / -0.011 |
| A038, Pitești | none | proved | none | none | none | 12.8 % | 200/202 | 6.8 m (23) | 7.8 m | 9.4 m | did not run | 0.249 / -0.018 |
| F003, Pitești | none | proved | none | none | none | 7.8 % | 104/104 | 5.1 m (14) | 11.1 m | 20.9 m | did not run | 0.270 / -0.009 |

**How far each one counts:**

- **Fetești on F006 is the real gain.**
  - It repeated from three deliberately shifted starts, at both 15 m and 10 m.
  - All 10 proofs were accepted, and the maps agree within 4.0 m.
  - The first proposal is thin (3 pairs, 46 points), but the proof does not depend on that.
- **A015 is not the AI's win.** `0.94,1.0` proves it, and so does its plain first guess sent straight into the proof, within 0.5 m of the same map.
- **A038 and F003 on Pitești are real but small.**
  - Their film covers too little of the window for the last look (`rival.py`) to run.
  - The same frame's Bucharest model, sent directly into the proof, reaches the same map within 1.8 m. Votes with that model as a prior still refuse.

**Checkerboards, by eye:**

- **Fetești:** the railway, the river and the roads run on across the squares, including in a full-resolution crop.
- **A015:** no visible jump at reduced scale.
- **A038 and F003 on Pitești:** only a thin strip of film along the bottom edge. No visible jump, but a weak check.

No landmark checked any of these.

## False accepts: none

- **AI proposals sent straight to the proof:** 51, of which 43 were accepted, all at the true place.
  - 29 have a proved map to compare against: median at most 1.4 m, largest 6.2 m.
  - Of the other 14, Fetești accounts for 10. A038 and F003 on Pitești agree with the model-start proof. F006 on Pitești and A038 on Fetești were also proved by votes, and I did not compare those two maps numerically.
  - The 8 refused were 6 small windows at their true place and 1 wrong-orientation proposal (refused twice, once on the window and once on the whole reference), plus the same window's proof at its true place counted among the 6.
- **Mirrored reference (4 frames):** 0 pairs and 0 proposals.
- **Windows the model puts off the film or nearly so:** 0 proposals on all of them (F006 Slatina, F007 Pitești, F049 Slatina, and 9 more I added). F022 Fetești and A015 Slobozia stop at `cityNotFound` before any search.
- **`m9-false.py`'s wrong proposals, 11 frames and windows:** 44 first guesses.
  - 42 were refused, with at most 19 tiles against the gate of 60.
  - 2 were accepted, A001 and A015 under their true orientation. Both are true, within 0.9 and 0.5 m of the proved map.

A015's reference map comes from the forced scales, so it is not a product proof.

## What the AI did not do

- **Slobozia on F006 is a miss, not a correct refusal.**
  - It gave 0 pairs, and votes refuse it too.
  - A scan of 289 proofs with no AI proved it once: 115/175 tiles, 5-fold 24.9 m, 23 % of the window on film.
  - That map lies 170 to 392 m (median) from smooth fits over F006's Pitești, Bucharest and Fetești maps.
  - By eye the checkerboard is inconclusive, so this rests on the numbers.
- **Fetești on F007 is unsettled.** The models put 12.5 to 17.7 % of the window on film, but nothing proved it, including a scan of 289 proofs.
- **Test C's nine small windows do not move under the shipped proof.**
  - Even the frame's own proved polynomial is refused, at best 49 of 51 tiles against the gate of 60. The window is too small for any proposal.
  - Over the whole reference (the decision's wide proof, not in the product), proposals prove 6 of 9 from the product's start. From Test C's start it is 8 of 9 at 15 m and 5 of 9 at 10 m. All are within 1.4 m of the proved map.
  - **That is not credited to the AI:** votes alone already prove these three frames over the same reference.
  - Votes also find 5 of the 9 places on the small window, then the proof refuses them; the AI proposes for 3 they miss.

## Should it land?

The gate's letter is met. On this evidence I would land it only behind a scale fix:

1. **Add `0.94,1.0` first.** It rescues A015 with no AI, and the four-frame rehearsal showed it costs little.
2. **The AI then has one substantial rescue on record.** That is a thin base: KH-9 only, one region, no far city and no Corona.
3. **Its record so far is clean, and it cost little.**
   - From the product's start it proposed the true orientation on all 8 Bucharest frames, ranked first.
   - GPU use peaked at 1.07 GB VRAM and 2.39 GB RAM, with no CPU fallback.
   - A refused window costs about 1 to 2.3 minutes for its four orientations.

**Owner's decision:** whether one strong rescue plus two small ones justifies about 10 GB on the admin's machine.

## Corrections for M9 §14 (docs not edited)

- Fetești on F006 is not a clean refusal, and Slobozia is not off the strip. Both were misses by the votes.
- The Bucharest model is 18.3 km (ground) off at Fetești and 6.9 km off at Pitești, mostly along the film. A model from a far city does not fit `PRIOR_MARGIN_GROUND_M` of 12 km.
- Across the film the model's error was only 0.1 to 4.2 km (Mercator), so its on-film shares are usable. A share of 0 % or 0.5 % is a correct refusal, and F007 on Pitești (2.3 %) is treated the same. They come from a model, not a proof.

## Not run, and harness slips

- **Not run:**
  - `georef`, `warp` and `export`
  - the live `sentinel2()` fetch
  - any CPU path
  - the integration, as you asked
- **Slips, all fixed before the figures above:**
  - Votes on Test C's start first ran on the wrong start; I reran them.
  - One scan was stopped because its ±8 km could not reach Fetești's 18 km error.
  - A bad Fetești model was replaced before it was used.

## Files

Everything is under `reports/calib/`, gitignored. Git and product code are untouched, and the `hcm-worker` container and its volume were not touched. In `/home/sergiu-alexandrescu/Projects/bucurestiuldisparut.github.io/reports/calib/ai/r1/`:

- `r1_nuc.py`
- `r1_match.py`
- `slo_check.py`
- `batch1.sh` to `batch6.sh`
- `out/results.jsonl`
- `out/props/`
- `out/check/` (the five checkerboards above)

On the NUC, `~/hcm-calib/out/r1/` holds the same results plus every checkerboard and the warped inputs, 4.0 GB. I deleted the local 3.3 GB copy of those inputs.

## As built (2026-11-07)

### What differs from the design above

| Design | As built | Why |
| --- | --- | --- |
| `python /ai/files/code/serve.py` | `python -m matcher.serve`, with `PYTHONPATH=/ai/files/code:/ai/files/lib` | The modules name each other relatively, so the same folder is `hcm_pipeline.matcher` under the tests and `matcher` in the sidecar, and nothing in it imports `hcm_pipeline`. |
| Files: weights, LightGlue, kornia and kornia_rs wheels | Also the OpenCV wheel, `opencv_python_headless-5.0.0.93` (61 MB, the one measured) | `search.py` and LightGlue's `utils.py` import `cv2`, and the image has none. The other three folders of the measured `py/` (einops, loguru, tqdm) are not needed: the pinned image imports all of it without them. |
| One start an orientation, the sensor's scale nearest 1 | One start **per orientation and scale**, the model's own scale first (`ProposalRequest.starts_each`); KH-9-pan: 8 requests | With `SearchRange` `(1.0, 0.94)` that one start became 1.0, where F006 on Fetești matches nothing (`docs/LESSONS.md` 380). A shear of KH-7 is not a start: **UNVERIFIED**, no KH-7 frame went through the matcher. |
| One request a frame | One request **per start**, `<id>.request.npz` | Each child loads the network (22.4 s a request against the measured search's 20.4 s), and in return the box holds one warped film at a time (18 MB compressed on F006), the timeout is per orientation as designed, and a cancel or a crash loses one. |
| A file in the box says the starter's refusal | Yes, `starter.json`, written by a run of the worker's image | A disk too full or a failed pull ends the worker's wait at once. The file's words are the starter's own constants. |
| *(not designed)* | `sidecar.json` beats every second, also while a child works | A crashed sidecar is given up within 2 minutes, not at the 10- or 45-minute timeout. Beats are compared, never timestamps, so no clock crosses a container. |
| `torch.cuda.is_available()` probe | `matcher.child probe`, in the sidecar's image and flags: exit 77 no card, 76 under `MATCHER_MIN_VRAM_GB`, and it writes `sidecar.json` | The same check at the probe and at every request; both 77 and 76 mean "no card" to the starter, so a card under 2 GB goes to the processor. |
| The state through `worker.hello` | Also said again on each change (`PageActions.announce_ai`), since `worker.hello` runs only at sign-in | A refused call changes nothing in the run: the panel only lags. |
| Too few pairs inside the crop: `needs_gcps` with the proved corners | **`georef`'s matcher tries first**, the existing path of a proved frame whose tiles give no fit: `how: matcher`, the proposer kept. Only if it finds too few pairs is the version `needs_gcps` | It does better with no gate moved, and `approval.ts` does not publish `how: matcher` by itself. The small synthetic city (S-P07-HAPPY-SMALL-WINDOW) takes this path. |
| `docker pull` at each start of the loop | Only when `docker image inspect` does not find it | A computer offline, or Docker Hub refusing, must not cost a working sidecar (`docs/LESSONS.md` 381). |
| `uninstall` removes the image | Only the images this file pulled, by the names it noted (`ai-image`, one a line); a new pin's pull removes the earlier ones at once, and one Docker will not remove yet stays noted | The owner's other PyTorch images stay, and an earlier pin's 10 GB does not. |
| The sidecar stays up once started | **Only while `/state` says `wanted`.** The run's end, a stand-aside, a cancel or a worker that has not answered twice running take it down; the loop keeps polling beside it (a background client on POSIX, `docker run -d` on Windows) | A foreground sidecar blocked the loop: a new image went unseen until a reboot, a processor sidecar was never re-probed, and a hung one was never removed. Every frame now probes again, at about 3 s. Two frames less than a poll apart keep the sidecar and its device |
| Machine check inside the worker | Also Docker's own architecture, `HCM_DOCKER_ARCH` | An amd64 image under Rosetta or QEMU reads `x86_64` from inside, so the refusal never fired on the machines it exists for. **UNVERIFIED** on a real arm computer |
| One wait of 30 minutes for each run | `Patience`: once a sidecar gave no answer, later runs of this worker wait 5 minutes until one beats again | Each run has its own `LocalMatcher`; ten frames on a hung driver would have cost 5 hours. A `docker run` of a probe hung in the driver still blocks the starter's loop itself: nothing kills it, only this shorter wait bounds its cost |
| One failure ends the run | `garbage` (a child's crash) loses that request and the next start is asked; any other word stops asking. Whatever was proposed by then goes to the proof; with nothing proposed the loss is the run's reason | The row above promised "a crash loses one", and a list comprehension threw every answer away |
| Request id `r001` | `r<run>-001`, the run's random id in it; the sidecar stops a child whose request file is gone and writes no answer for it | A worker killed hard leaves a child running: its late answer was read as a new run's. The proof would likely have refused it, at the cost of the right answer |
| *(not designed)* | Each run hashes the placed weights before asking, and places them again from `dl/` (fetching what no longer matches) | The stamp says only that they were verified once: an altered file failed every frame until the volume was removed by hand. A child's own `tampered` is no longer overwritten by its exit code, so the panel says "a file was altered", and no further request is asked |
| *(not designed)* | `measuredPct` of a proof over a wider box is measured over the city's window (`Found.window_spread`) | The share over the box said 85 for tiles in one corner of a town, past the 70 of `approval.ts`. The proof's gates did not change |
| `how: matcher` keeps the proof's figures | The record drops `tiles` and `crossValidatedM` with `measuredPct`, so the card shows neither; the job's log keeps the proof's line | They describe another map, over more ground than the city. The fit's own error is on the approval card. Dropped in the record, not hidden in the card: the admin's bundle has no bytes for it, and a version written earlier still shows them until it is run again |
| The sidecar's PID 1 has no signal handler | It leaves at SIGTERM | The kernel ignores SIGTERM for a PID 1 with no handler: a stopped service waited out systemd's 90 s and left the container (reproduced with a real user unit) |

**A consequence of the wide proof, by the same gates:** `PROOF_MIN_COVERED` (5 %) is a share of the box. A film covering under 5 % of a 30 km box, about 45 km², is refused `small` however true the proposal (a synthetic 10 km film: 117 of 117 tiles agree, refused). No real frame measured is that small; the test pins it.

**A proposal needs a proof left:** `_from_matcher` asks only while `run.left` is above 0, so a frame whose votes spent all three proofs on refusals never reaches the AI. That is the design's letter (*Two chain gaps*), and no real frame in gate R1 hit it; not measured. The job's log says so (`local AI not asked: ...`, on Cloud Run "no local AI in Google Cloud"); the panel does not.

**Windows PowerShell 5.1, read and not run:** `\"` is no escape in PowerShell, so one such string made `[scriptblock]::Create` refuse the whole file, install and removal alike; 5.1 also drops an empty argument to a native command and strips a quote inside one. So the probe passes the word `none` as its reason, and the refusal writes its quotes in octal. Parsed and run by hand with `pwsh` 7.6 only, with `$PSNativeCommandArgumentPassing = 'Legacy'` standing in for 5.1 (*Not run*).

### What ran on real hardware

The real `serve.py`, `child.py`, `search.py`, `torch_backend.py` and `box.py`, in the pinned image with the design's flags (`--gpus all --network none --cap-drop ALL --security-opt no-new-privileges -u 10001:10001`, 6 GB, 512 pids), the weights and wheels copied from `reports/calib/ai/`, not downloaded; RTX 3080 Laptop. Requests were built from gate R1's prepared F006 on Fetești, not by `warp_start`.

| Check | Result |
| --- | --- |
| Probe under `--gpus all --cap-drop ALL` | exit 0, 3.1 s, "NVIDIA GeForce RTX 3080 Laptop GPU" |
| F006 on Fetești, its true orientation | 3 pairs, 46 points, as gate R1 measured; the map within 2.7 to 3.1 m of gate R1's proposal; 22.4 s (R1's search: 20.4 s) |
| The next orientation | no proposal, as gate R1 measured; 22.8 s |
| Between requests | the container at 90.7 MiB, the card back at 13 MiB: an idle sidecar holds no VRAM |
| During a request (one sample each) | 1,407 MiB on the card, 1.5 GiB in the container |
| `HCM_AI_DEVICE=gpu` with no `--gpus` | child and `serve` both exit 77, saying so |
| `HCM_AI_DEVICE=cpu` with no reason | `serve` refuses, exit 78 |
| Processor, `--cpus=4`, a 1,000 x 1,000 film against an 800 x 800 reference | answered in 16.8 s, `fallback: no-gpu`, no proposal (a piece cut for the time, not a measurement of quality) |
| Cancel during a processor run of a whole request | the child killed within seconds, "cancelled", the container back at 26.5 MiB |

**That rehearsal found a real bug no test had:** ruff's target of Python 3.14 had rewritten `except (OSError, ValueError):` to `except OSError, ValueError:`, a syntax error under the sidecar's 3.12 (`docs/LESSONS.md` 379). The same would have gone for an unquoted annotation naming its own class. `test_matcher_box.py` now parses the folder for 3.12 and checks annotations in definition order.

### The whole chain on a real frame (2026-11-07)

The real `packages/admin/starter/hcm-worker.sh matcher` loop (only its names changed by `sed`, so it stayed off the live worker: port 18765, container and volumes `hcm-ai-rehearsal-*`), beside an image built from this tree running the real `WorkerState`, `/state` server, `AiFiles`, `LocalMatcher`, `warp_start` and `find_frame`. Film: F006's real segments (`im-mw5489s9-D3C1203-300415F006`, 13 GB, the live volume's sub-folder mounted read-only). Reference: `ref-fetesti.tif`. Laptop: RTX 3080 Laptop, 16 logical CPUs. Votes refused first (`[0, 0]`, about 1.5 min) in every run. The live worker, untouched, ran its own imports on the same computer meanwhile, so the processor's times are not of an idle machine. The GPU was hidden by a stand-in of `docker` that drops `--gpus` and `--device`, so both probes really ran in the image and really exited 77.

| Run | Starter's line | Requests | AI's time | Proof | Peak |
| --- | --- | --- | --- | --- | --- |
| **Before the fix**, GPU | `local AI: graphics card through --gpus all` | 4, none proposed | 190 s | **not found** | 1,417 MiB, 1.5 GiB |
| GPU | the same | 8, 1 proposed (scale 0.94, true orientation: 3 pairs, 46 points) | 217 s and 239 s (21 to 27 s a request, plus up to 20 s for the starter's poll) | `local-ai`, 1,190 of 1,391 tiles, 18.8 m at 152 places, rival 0.074, 4.7 sigmas; twice the same | 1,417 MiB, 1.5 GiB |
| GPU hidden | `local AI: NO GRAPHICS CARD (tried --gpus all, CDI); falling back to the processor` | 4 (2 orientations, 2 scales), 2 proposed | 2,968 s (49.5 min; 650 to 866 s a request, 8 threads) | `local-ai`, 1,174 of 1,379 tiles, 19.6 m at 152 places, rival 0.076, 4.8 sigmas; `fallback: no-gpu` | 0 MiB (the card stayed at 13), 1.7 GiB |

The three maps agree with gate R1's over the film: GPU median 0.4 m, largest 4.2 m; CPU median 0.6 m, largest 1.9 m. The processor's first proposal was at scale 1.0, where the card found none: the two devices do not count alike, and only the proof decides. The worker's process peaked at 1.32 GB.

**Log, all as written:** the job's `local AI (aliked-lightglue, gpu, NVIDIA GeForce RTX 3080 Laptop GPU): 1 proposals in 217 s`, `local AI (aliked-lightglue, cpu): 2 proposals in 2968 s`; the sidecar's `local AI: graphics card NVIDIA GeForce RTX 3080 Laptop GPU`, `local AI: NO GRAPHICS CARD (no-gpu): falling back to the processor`, `local AI: running on the processor, on 8 threads`. Nothing started before `/state` said wanted; the box held only `sidecar.json` afterwards. The processor's run reused a box whose `sidecar.json` said `gpu`: it was read as stale, and the worker went by the new device.

**The admin's bundle:** the panel's reasons were shortened and its words reworked to fit: 629,964 bytes of gzip against the budget of 630,000, which was not raised. The next string in the admin needs room found first.

**Costs that changed:** a window nothing proves now takes 8 requests on the card, about 3.5 min, against gate R1's 1 to 2.3. On the processor a frame takes about 50 minutes on this machine whether or not it is found, since every start is asked before any proof.

### Not run

- **Any download:** `AiFiles` against the real hosts; no owner's yes was at hand for it. Files came from `reports/calib/ai/`: the weights and the LightGlue tarball through `AiFiles` itself (hashes checked, placed, `superpoint.py` left behind), the three wheels as the folders unpacked earlier, since no `.whl` was kept, so `unpack_wheel` on a real wheel and the wheels' hashes did not run. So the first use's time is **not measured**. `HEAD` requests only: every URL answers 200, each redirect lands on an allow-listed host, and the weights' lengths match. 124.9 MB to fetch (47.6, 2.7, about 6.1, 1.9, 5.3, 61.2) beside the 9.68 GB image already in Docker's store.
- **`docker pull` of a missing image, and `uninstall`.** The pull ran in the runs before its fix, as a no-op (the digest was here). The 30 GB check ran then on `df` inside a container and passed (106 GB free).
- **The wide proof through the live `sentinel2()`:** the window is 24 km on the ground, so the product asks for 30 km; the rehearsal answered "none to be had", which the product treats as "prove over the window". A real run would prove over a larger box.
- **A job's documents:** no emulators, no `LocateStep`, `georef`, `warp` or `export` on this frame; those ran on synthetic scenes with a fake network. No panel was looked at.
- **A real out-of-memory:** the rerun is exercised with faked exit codes only.
- **The PowerShell loop on Windows, Docker Desktop, macOS, an arm computer:** text assertions and a reader of strings in the gates; by hand, on Linux, the real parser and the loop under `pwsh` 7.6 in `Legacy` argument passing, with a stand-in of `docker`, not on Windows PowerShell 5.1 and not on Windows. CDI's branch ran only as a probe with the card hidden, never with the card.
- **Any other frame or sensor.** One frame, one window, KH-9.
- **Playwright beyond the targeted run:** `calibration.spec.ts`, `worker.spec.ts` and `worker-run.spec.ts` passed at `admin-c360-ro` and `admin-l1440-ro` (2026-11-07), the new states through `expectStateSound` there; the full `e2e` and `tour-matrix` stages (dark, English, the other viewports) did not run.

### Licences, read

ALIKED's own `LICENSE` at the pinned commit is BSD-3-Clause; kornia, kornia_rs and OpenCV are Apache-2.0 by their wheels' metadata (`matcher/NOTICE.md`). OpenCV's wheel bundles FFmpeg's libraries under LGPL-2.1, listed in its `LICENSE-3RD-PARTY.txt`, which is unpacked with it. **Still unread:** the CUDA library terms in the PyTorch image, which is why it stays on Docker Hub and is never re-hosted.

## Addendum of 2026-11-12: the governor's budget per request (M26)

Each request carries a `MatcherBudget` (`matcher/box.py`; an optional `budget` array in the `.npz`, a request without
one reads as the old defaults): processor threads (in place of half the cores), keypoints (2048 full, 1024 quiet), the
card's memory share (`torch.cuda.set_per_process_memory_fraction`, ≤ 0.7 full, ≤ 0.4 quiet) and `yield_gpu`: when other
programs leave the card less than the matcher's 2 GB, the child runs that request on the processor and says
`fallback: gpu-busy` (never a silent processor run: the reason is in the answer and in the proposer's record).
`docs/research/M26-governor.md` §4–§5.

## Addendum of 2026-11-13: the processor's sidecar and its lighter search (M26 h2, i)

A computer with no NVIDIA card no longer pulls PyTorch's CUDA image (9.68 GB): the starter passes `HCM_AI_VARIANT=cpu`,
the worker fetches `matcher/pins-cpu.json` into `lib-cpu/` (276 MB fetched, 830 MB unpacked) and the sidecar runs from
the worker's own image, under the same flags. On the processor the search runs at half resolution with the full
keypoints: 64 s a request on the NUC against 553 s, the same verdict on ten requests of three frames. Numbers, the
rejected settings and what is unproved: `docs/research/M26-governor.md` §5, §9, §10.
