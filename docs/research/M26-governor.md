# M26: the hardware governor

The owner's principle (2026-11-12): **the product runs on modest hardware; nobody upgrades for us.** The local worker
(M7) and its matcher sidecar (M10) run on the owner's own computer, beside whatever the person at it is doing. Before
M26 the worker's share of that computer was a set of scattered knobs (GDAL's `ALL_CPUS`, a fixed 1 GB cache, half the
cores for the processor matcher, a sidecar capped at 6 GB). M26 replaces them with one governor that decides, every
few seconds, how much of this computer the worker may use, and says so on its `/state` and in the admin.

Package: `pipeline/src/hcm_pipeline/governor/`. Every function is within complexity 5, every file at 100 % lines and
branches. Its order is Probe → Signals → Policy → Budget → Actuators.

## 1. Probe (`probe.py`, `probe_linux.py`)

`Probe` is a protocol with one method, `read() -> Signals`; tests use fakes (`pipeline/tests/fakes/machines.py`).
`LinuxProbe` reads, from the container, over a root folder (`/`, or a test's fake tree):

| Signal | Source |
| --- | --- |
| cores | `os.cpu_count()` (the host's: `--cpus` is a quota, not fewer cores) |
| CPU quota | the cgroup's `cpu.max` (`<quota> <period>`, or `max`) |
| memory | `/proc/meminfo` MemTotal and MemAvailable; the cgroup's `memory.max` (limit) and `memory.current` (ours) |
| others' load | the host's `/proc/stat` between two ticks, minus our cgroup's `cpu.stat` `usage_usec` |
| power | `/sys/class/power_supply`: a battery that discharges, its capacity; a supply at all means mains |
| heat | `/sys/class/thermal/thermal_zone*`: the hottest processor zone (`x86_pkg_temp`, `cpu*`, `k10temp`, `acpitz`, …) |

On Linux the container's `/proc/stat` is the host's. Under Docker Desktop (Windows, macOS) it is only the VM's, which is
all Docker's own work, so others' load reads near zero there and the input hints carry the decision.

What a container cannot see comes from the starter as **host hints**: `host-hints.json` in the worker's volume,
written every `GOVERN_SECONDS` (5 s) through the worker's own container (`docker exec -i hcm-worker sh -c 'cat > …'`;
the starter never mounts the volume). Hints older than 60 s are ignored (a stopped starter says nothing).

| Hint | Linux | Windows | macOS |
| --- | --- | --- | --- |
| `idleS` (seconds since input) | GNOME's `org.gnome.Mutter.IdleMonitor`, else `xprintidle`, else logind's `IdleHint` / `IdleSinceHint`; under WSL only Windows' `GetLastInputInfo` through powershell.exe (below) | `GetLastInputInfo` | `ioreg` `HIDIdleTime` |
| `power` | (read in the container) | `Win32_Battery` | `pmset -g batt` |
| `gpus` | `nvidia-smi` (memory, use, heat; `via: cuda` when `docker info` names the NVIDIA runtime or CDI); `/sys/class/drm/card*/device/vendor` 0x8086 with `/dev/dri` (`via: openvino`), 0x1002 with `/dev/kfd` (`via: rocm`), 0x10de when nvidia-smi fails (`why: no-driver`); each card's model from `lspci -mm -s <slot>` | `nvidia-smi` (`via: cuda`: Docker Desktop's WSL2 passes it) | none |
| `npus` | `/dev/accel/accel0` (`via: openvino`) | none | none |

**Only a command's success is data** (2026-11-13). On the NUC, which has an Intel Arc and NVIDIA's tools but no NVIDIA driver,
`nvidia-smi` printed its failure on stdout and exited 9; the starter read that sentence as a card's name and the following empty
line as a second card, and the empty name made the admin read the whole `machine` as an older worker's. Now the starter keeps
nvidia-smi's rows only when it exits 0 and each row has a name and whole numbers for the memory (use and heat may read `[N/A]`: 0),
strips quotes and backslashes and cuts the name at 120 characters; Intel's and AMD's cards are named by `lspci` (the NUC: "Arrow
Lake-P [Arc Pro 130T/140T]", not "Intel graphics"); an NVIDIA card in `/sys/class/drm` that nvidia-smi cannot reach is listed as
`{vendor: nvidia, via: null, why: no-driver}`, and the admin's card says to install the driver, with a link to NVIDIA's page.
The worker drops any card whose name is empty, has a line break or is longer than 120 characters (`probe._named`), so an older
starter's text never reaches `/state`. The Windows file checks `$LASTEXITCODE` and the same shape. The roots are
`HCM_DRM_ROOT` and `HCM_DEV_ROOT` (tests only). Scenario `S-A141-BAD-NO-DRIVER`.

logind's `IdleHint` turns only after the desktop's own idle delay (GNOME: 5 minutes), so on a desktop without GNOME's
monitor or `xprintidle` the worker stays quiet longer after the person leaves; it is never less polite.

**Under WSL** (`/proc/version` names `microsoft`; the owner's PC, 2026-11-13) none of those sees the person: logind's `IdleHint`
is always `no` without a desktop session, so every hint said input and Automatic held Quiet forever. The starter then reads the
Windows user's `GetLastInputInfo` (the same C# as `hcm-worker.bat`'s `Get-IdleSeconds`) through `powershell.exe -EncodedCommand`,
at most every 30 s (`WSL_IDLE_SECONDS`; each call costs about half a second, 1.7 s with the sockets that fail) and cached in the
install folder's `windows-idle`. A systemd service has no `WSL_INTEROP` and Windows refuses `/run/WSL/1_interop`, so it tries
`/run/WSL/*_interop` (the one that last answered first); a process that sshd's `wsl.exe` started runs in session 0, whose
reading is the uptime, so only an answer from a session other than 0 counts. With no answer `idleS` is empty, never 0: the
governor never claims activity it cannot see. The reading reaches the governor up to 30 s late (it goes quiet within 35 s of
the owner's return, not 5). The roots `HCM_PROC_VERSION`, `HCM_WSL_INTEROP_ROOT` and `HCM_WINDOWS_POWERSHELL` are for tests.
Scenarios `S-A141-HAPPY-WSL-IDLE`, `S-A141-BAD-WSL-NO-INTEROP`.

## 2. Signals (`signals.py`)

Plain frozen dataclasses: `Cpu(cores, quota, temp_c)`, `Memory(total_mb, available_mb, limit_mb)`, `Power(source,
percent)`, `Gpu(vendor, name, vram_mb, others_mb, via, why, busy_pct, temp_c)`, `Npu(vendor, name, via, why)`,
`Usage(cpu_pct, others_cpu_pct, memory_mb)` and `idle_s`. A card that shares the computer's memory (integrated) has
`vram_mb` 0.

## 3. Policy (`policy.py`)

One pure function, `decide(signals, choice, before, now) -> PolicyState`, and `effective(state) -> (profile, why)`.

- The owner's choice (`auto`, `quiet`, `full`) wins over the person's activity: Quiet is always quiet, Full is full
  while someone types.
- Auto goes **quiet within one tick** (5 s) of: input on the host in the last 10 s (`user-active`), other processes
  using more than 40 % of the machine (`others-busy`), or a switch to battery (`battery`). It returns to **full only
  after 120 s** with none of those (a calm timer), so it never flaps (a hypothesis property test drives it with any
  sequence of activity).
- On battery under 30 % it **pauses**, unless the owner allowed work on battery (`batteryAllowed` in `POST /profile`).
- **The owner's pause** (2026-11-13, M7 → *Pause*): `paused` is a fourth choice, set only by Pause this computer (the admin's
  `imagery.pause`, mirrored from the claim's answer, or the computer's own page, `POST /pause`), never by `POST /profile`. It is also
  a claim block: the server answers a paused worker's claim with no job. Chosen paused, the profile is `paused` with `why: owner`,
  whatever the heat or the battery; `governor.json` keeps `until` (epoch seconds) and `resumeTo` (the profile it goes back to); a tick
  past `until` resumes by itself. A running step is not held at the gate: the run hands its job back at its next checkpoint.
- Heat steps **down one level** (full to quiet, quiet to paused) at 95 °C on the processor (90 until 2026-11-13: the
  laptop's package reads 90 with only a local model running, so every mobile processor at work stepped down) or 83 °C on a card, and
  back up only 5 °C below both (`why: thermal`; 10 until 2026-11-13: with a local model, pytest and Prettier holding the laptop at
  88 to 93 °C, a resume at 85 never came and the worker paused for hours); once hot it stays hot at least two minutes, `HOT_HOLD_S`: on battery at 90 to 95 °C the laptop paused and resumed
  about once a minute).
- **Before the limit** the budget already gives way (§4): from `WARM_C` (80 °C) the threads shrink in proportion to the degrees
  left to 95 (14 threads at 80, 9 at 85, 4 at 90, 1 at 93), so the worker's own load seldom takes the processor to the step-down,
  and a resume at 90 runs on the one or few threads the heat leaves, not on a full profile.
- A card the matcher must leave (§5) reads `why: gpu-busy` while the profile stays full for the processor.

## 4. Budget (`budget.py`) and actuators (`actuate.py`)

| Setting | Full | Quiet | Paused |
| --- | --- | --- | --- |
| Threads (reserve 1 core; 2 from 8 cores) | max(1, cores − reserve) | max(1, cores ÷ 4) | 0 |
| … within heat and others' load | × the heat's share (1 to 80 °C, then down to 0 at 95), at most cores − reserve − others' busy cores; 1 at least | the same | 0 |
| Memory (whole 256 MB steps) | 60 % of what is free to us | 35 % | 0 |
| GDAL cache, warp memory | `rasters.gdal_memory` of the budget: a sixteenth and an eighth (128 to 1,024 MB, 256 to 2,048 MB) | the same | unchanged |
| Tile processes | min(threads, memory ÷ 4 ÷ 256 MB) | the same | 0 |
| OpenCV's threads | the threads | the threads | unchanged |
| Matcher keypoints | 2048 | 2048 (1,024 lost a frame the card finds: §11) | — |
| Card's memory share (`gpuFraction`) | ≤ 0.7 | ≤ 0.4 | 0 |
| A running step | runs | runs | waits at its next checkpoint |

"Free to us" is MemAvailable plus what the worker holds already (else the budget would shrink as the worker grows),
within the container's limit. **Cores** are the host's, within the CPU quota the container **started** with (a shared
machine's slot, a `--cpus` the owner set): the governor's own `docker update` comes later and only lowers it, so the
first quota read is the cap, never one of ours.

The memory is counted in 256 MB steps (`MEMORY_STEP_MB`) and the log says a line only when the profile, its reason or the threads
change (`governor._said`): until 2026-11-13 every tick's few megabytes more or less changed the budget, and the worker logged
"this computer: quiet (user-active), 4 threads, 5880 MB" every 5 s (up to 720 lines an hour; the laptop's last hour of
2026-11-13: 173 lines, 56 under the new rule, each a real change between user-active, battery, thermal and others-busy). Within one profile a change of fewer than two threads is not made (`governor.steady`): the heat's share moved quiet's threads
1, 2, 3, 4 in turn on the laptop, a log line and a `docker update` each.

**Headroom and the claim** (2026-11-13: a city with three workers, the laptop, the NUC and the PC). `Governor.headroom()` is 0 to 1:
the lesser of the heat's share (above) and 1 − others' load (their share of the machine), 0 while paused. The worker's claim pace (`worker/pace.py`)
stretches every wait by 1 + 3 × (1 − headroom): a computer with room asks every `pollSeconds` (30 s), a half-busy one every 75 s,
a hot or paused one every 120 s (240 s when idle), so a queued job goes to the cooler or idler worker; a lone worker still takes
it, only later. Scenarios `S-P31-HAPPY-CLAIM-HEADROOM`, `S-P31-BAD-CLAIM-HEADROOM-RANGE`.

**The C heap** (`heap.py`, 2026-11-13). GDAL's threads allocate from glibc's per-thread malloc arenas, which keep freed pages for
later: two 12,000 px colour sheets laid out and mosaicked peaked at 636 MB on one thread and 870 MB on every core, against the
800 MB budget (about 115 MB of the layout's reads stayed resident). `python -m hcm_pipeline` (the worker and the Cloud Run job)
now starts with at most two arenas (`limit_arenas`, before any GDAL thread), and the windowed canvas gives the free pages back
before its first sheet and after each one (`give_back`, `malloc_trim(0)`, and tcmalloc's release in the worker's image): on glibc
588 MB on one thread and 653 MB on 16, the same pixels, no slower; under tcmalloc 650 to 690 MB either way (the NUC). The budget test runs on one thread and on `ALL_CPUS` (`S-P31-HAPPY-CANVAS-THREADS`). The budget was
not loosened.

Actuators:

- At the worker's start the command nices the process (`HCM_WORKER_NICE`, 10; stripfix's `yield_processor`) and
  `Worker.govern` adds `ionice -c 3` (`idle_io`, idle I/O): niced once, not twice. The person's programs always go first,
  whatever the budget. `lower_priority` does both, for the load test's process.
- `apply_budget` on every change: `GDAL_NUM_THREADS` (also the tile step's `num-threads` and the rim's compression), `GDAL_CACHEMAX`,
  `HCM_GOVERNED_WARP_MB` (`rasters.warp_memory_mb` takes the least of it and the machine's own share) and `cv2.setNumThreads`.
  The owner's `HCM_WORKER_THREADS` (the starter passes it as `GDAL_NUM_THREADS`) caps every profile's threads.
- `Gate`: paused, `RunFlags.check()` and `RunFlags.gdal_progress()` wait (a GDAL call blocks inside its own progress
  callback: memory kept, no processor time used); the time waited moves the step's time limit, and a cancel or a
  SIGTERM still ends the wait at once.
- Sharing scanned maps (M20 §22, 2026-11-14; `worker/sharing.py` `SharePacing`): the holder's sharing thread reads the profile in
  force (`profile_of(governor.budget)`): nothing while `paused` (the owner's pause, the battery, the heat; a copy under way waits at
  its next sheet), and an average upload of at most 1 MiB/s while `quiet` (about 8 Mbit/s of a home line, so the person at the computer
  keeps their connection) or 8 MiB/s at `full`, a sheet at a time; an unknown profile (before the first tick) counts as quiet. Its
  reads are in the idle I/O class with the rest of the worker.
- The matcher: each request (`matcher/box.py` `MatcherBudget`, an optional `budget` array in the request's `.npz`)
  carries the processor threads, keypoints, the card's share and whether the card must be left; the sidecar's child
  sets `torch.set_num_threads`, `torch.cuda.set_per_process_memory_fraction` and ALIKED's `max_num_keypoints`.
- The starter (`hcm-worker.sh` `run_governor`, `hcm-worker.bat` `Start-GovernorLoop`): `docker update --cpus <threads>
  hcm-worker` when the budget's threads change (never 0: a pause keeps the last quota and the gate holds the step).
  This works on Linux, WSL2 and Docker Desktop; the cgroup's `cpu.max`, which the probe reads back, is the proof it took.

## 5. Where the matcher runs (`backends.py`)

Order: CUDA, ROCm, OpenVINO on an Intel card, OpenVINO on the NPU (ALIKED's extractor only, at a fixed size: an NPU
needs static shapes; LightGlue stays on a card or the processor), then the processor, searching at half resolution.

- A runtime counts only when the release ships the sidecar image for it (`IMAGES`; today `cuda` and `cpu`, the
  `pytorch/pytorch` image of M10). A card with no image says `no-image`; one Docker cannot pass in says
  `no-passthrough` (Windows on ARM, macOS: DirectML and Core ML need a native helper Docker cannot host).
- **Yield**: when other processes leave less than the matcher's 2 GB of a card, or the budget's share of it is under
  2 GB, the next request runs on the processor with `fallback: gpu-busy` (said in the proposer's record, which the
  calibration schema now accepts), and the card says `gpu-busy`. The laptop's 3080 on 2026-11-12 (6.4 of 8 GB held by
  someone else's job) is the test's case.
- **The processor's sidecar (item i, 2026-11-13).** A computer where `nvidia-smi -L` names no GPU gets
  `HCM_AI_VARIANT=cpu` from the starter (`ai_variant`, `Get-AiVariant`; the owner's `HCM_AI_VARIANT` wins). The worker
  then fetches `matcher/pins-cpu.json` with the same `AiFiles` (the same weights and LightGlue; PyTorch 2.15.0 for the
  processor, torchvision 0.29.2, kornia, kornia_rs, Pillow, SymPy, mpmath and typing_extensions as cp314 wheels, hosts
  `download.pytorch.org` and `files.pythonhosted.org`) into `lib-cpu/`, a folder of its own so PyTorch's image never imports
  the processor's PyTorch, and names the image `worker`. The starter maps `worker` to the worker's own image, pulls
  nothing, and runs the sidecar from it on the processor (`/opt/venv/bin/python` on its `PATH`), under the same flags
  (`--network none`, `--cap-drop ALL`, `-u 10001`, 4 GB). Any other word is refused as before.
- **The processor's search (item h2).** On the processor `search` runs at half resolution (`CPU_DECIMATION`, tiles of
  768 px at 30 m, a window under two tiles a side as it is) with the budget's keypoints. Quiet keeps 2,048 keypoints:
  1,024 lost a frame (§9, lesson 613).

## 6. Contract

`GET /state` gains `machine` (`packages/shared/src/api/worker-machine.ts`, `workerMachineSchema`):

```text
{cpu:{cores}, memory:{totalMb, availableMb, limitMb?}, power:{source:'ac'|'battery'|'unknown', percent?},
 gpus:[{vendor, name, vramMb, via:'cuda'|'rocm'|'openvino'|null, why?: 'no-driver'|'no-passthrough'|…}], npus:[{vendor, name, via, why?}],
 backend:{matcher:'cuda'|'rocm'|'openvino-gpu'|'openvino-npu'|'cpu'|'off', why?},
 profile:{chosen:'auto'|'quiet'|'full'|'paused', active:'full'|'quiet'|'paused',
          why:'idle'|'user-active'|'others-busy'|'battery'|'thermal'|'gpu-busy'|'owner', until?},
 budget:{threads, memoryMb, gpuFraction}, usage:{cpuPct, othersCpuPct, memoryMb, gpuPct?, vramMb?, tempC?}}
```

`machine` is `null` before the governor's first tick. `others-busy` was added to the design's list of reasons: another
program's load is not the person's input.

`POST /profile {profile, batteryAllowed?}` answers under `/pair`'s rules (a Hosting origin, a JSON body; CORS and the
Private Network Access preflight for those origins only): 200 and the state, 400 for an unknown profile, 403 for
anything else. The choice is kept in the worker's volume (`governor.json`): it stays on that computer, never in Firestore.

The admin's card, "This computer" (`packages/ui/src/admin/worker/hcm-worker-machine.ts`, its view model
`packages/admin/src/worker/machine.ts`, strings `adminWorkerLocal.machine.*` in ro and en, in the lazy `worker-local`
chunk), shows under "This computer is connected": the cores and memory, Automatic / Quiet / Full, the profile in force
with its threads and GB and why, where the local AI runs, and a line when no card can be reached. A worker older than
M26 has no `machine`: the card asks to update it. Scenarios: A141 (`S-A141-HAPPY`, `S-A141-BAD-OLD-WORKER`,
`S-A141-BAD-NO-GPU`, `S-A141-BAD-BATTERY`); tour state `worker.local-machine`.

`HCM_GOVERNOR=off` leaves a worker ungoverned: only the tests' own process uses it (a governed test would renice pytest
and set GDAL's options for every later test).

### Disk (2026-11-14)

The governor's share caps the processor, the memory and the graphics card; the disk has its own floor beside it
(`worker/housekeeping.py`, `DISK_FLOOR_BYTES`, 15 GB free): each `worker.claim` says `disk` (`workBytes`, `freeBytes`,
`floorBytes`), the server gives no job under the floor (`lowDisk`, a hold-back after `paused`), and the worker sweeps finished
jobs' scratch at once until there is room. A run that fills the disk anyway hands its job back with its attempt (`diskFull`). The
admin's household card shows the use and the free space and offers **Free space now** (M7, *Disk: what the worker keeps*).

## 7. What this builds on

`track/stripfix` (another agent, 2026-11-12, merged into `feat/engine-rewrite` at `8c794234`) added GDAL memory sized to the
machine (`rasters.py` `gdal_memory`), a cap on tile processes (`pyramid.py` `tile_processes`), claim back-off
(`worker/pace.py`, 60 s idle), the starter's memory cap (60 %) with `--cpu-shares 256`, the worker niced by 10 and the
sidecar's 4 GB cap with `--cpu-shares 128`. M26 was built on its older head `0a74888c`; the merge of 2026-11-13 keeps every
one of those numbers and puts the governor inside them: the budget's cache and warp memory are `gdal_memory` of the
budget (never more than the 1,024 and 2,048 MB caps), the tile processes follow `GDAL_NUM_THREADS` (the budget's
threads) within `tile_processes`'s own caps, the processor matcher takes the budget's threads (else the cores but one) and
is niced by 10, and the starter's `docker update --cpus` sits beside the memory cap and the CPU weight.

## 8. Tests and what is proved

- Unit (pytest): fake machines for Linux with NVIDIA through CDI, AMD ROCm, Intel Arc with an NPU (the NUC's shape),
  2 cores and 4 GB with no card, WSL2 with NVIDIA (Intel unreachable), Windows on ARM with Qualcomm, macOS on Apple
  silicon; a battery at 20 %, a hot processor, the person active. Property tests: threads within 1 … cores − reserve,
  memory within its share, the card's share ≤ 0.7, no flapping.
- Vitest: the schema, the starter's loop (`functions/test/worker/starter-governor.test.ts`: the quota only on a change,
  the hints through the worker's container, no mount), the card in ro and en.
- The load test (`pipeline/tests/load/governor_load.py`, run on the NUC through `nuc-test.sh`): see §9.

| Machine | Can prove |
| --- | --- |
| NUC (16 threads, 30 GB, Arc 140T, Core Ultra NPU) | the load test; the processor path; Intel GPU and NPU detection by the starter |
| Laptop (16 threads, 30 GB, RTX 3080 8 GB) | the CUDA path and NVML-style yield (seen live: 6.4 GB held by another job) |
| None of them | AMD ROCm, DirectML, Qualcomm, Core ML / ANE: fake probes only, **unproved** |

## 9. Measured (2026-11-13)

**The load test** (`governor_load.py`, the NUC in an 8-CPU slot, so 8 cores to the governor): the person's input sent the
worker quiet in 0.03 s (one tick at most: 0.30 s in the first run); full ran 6 threads, about 4 cores, quiet 2 threads,
about 2.5 cores; the worker's process held 174 MB. The "user"'s timer was late at p99 0.50 ms governed against 4.40 ms
ungoverned, and kept 110 % of its alone rate against 93 % (first run: 86 % against 91 %, p99 1.6 against 2.8 ms). Runs
while another agent loaded the NUC to 34 read `paused` throughout (others over 40 % and a processor at 95 °C): the
governor's rule, but no measurement. The report no longer counts a paused pass's memory as over its budget of 0.

**Where the matcher runs**, one R1 request (F006 on Fetești, its true orientation; a 7,841 px film, 1,125 pairs):

| Backend | Machine | Time | Found |
| --- | --- | --- | --- |
| CUDA, PyTorch's image | laptop RTX 3080, beside a local model holding 6.4 of 8 GB at 80 to 88 % | 43.4 s, 1,086 MB of the card under a 0.2 share | 3 pairs, 46 points, as gate R1 (20.4 s alone) |
| Processor, before h2 | NUC, 8 threads, cp314 PyTorch 2.15.0+cpu | 553 s (529 s on a wrong orientation) | 2 pairs, 29 points, 36 m from the card's |
| Processor, half resolution, 2,048 keypoints (shipped) | the same, in the worker's image with `lib-cpu` as `AiFiles` fetched it | 64 s (62 to 71 s on the wrong ones) | 2 pairs, 40 points; second proposal 322 m from the card's |
| Processor, half resolution, 1,024 keypoints | the same | 38 s | **nothing** (rejected) |
| Processor, full resolution, 1,024 keypoints | the same | 206 s | **nothing** (rejected) |
| OpenVINO 2026.4.1 (CPU, GPU, NPU) | NUC, ALIKED exported to ONNX | — | the model does not load: no conversion rule for `DeformConv-19` |

The shipped processor search on F007 and F003 on Bucharest: 54 s and 68 s, 8 and 11 pairs, 23 m and 54 m from the
card's proposal; all six wrong orientations proposed nothing, as on the card. A frame of four orientations: about 4.3
minutes against 36 on the NUC (49.5 on the laptop in M10), never above 2.3 GB of memory.

**The processor's sidecar on disk:** `AiFiles` with `pins-cpu.json` fetched 276 MB from the real hosts in 19 s and
unpacked 830 MB into `lib-cpu/`, beside the 49 MB of weights; PyTorch's CUDA image it replaces is 9.68 GB on the laptop.

## 10. Not done (and why)

- **ONNX Runtime and OpenVINO sidecar images** (`matcher/ort_backend.py`, `matcher/export.py`, image `openvino`): not
  built. ALIKED exports to ONNX, but OpenVINO 2026.4.1 has no conversion rule for its `DeformConv-19` (measured on the
  NUC, 2026-11-13), so neither the Arc nor the NPU can run it as it is; a rewrite of the deformable convolution, and the
  M9 proof's parity marks (same verdict, scale within 0.5 %, rotation within 0.2°, ≥ 90 % of the reference's inliers),
  come first. ONNX Runtime's own providers (ROCm, DirectML, CoreML) were not run. Until then `IMAGES` is `{cuda, cpu}`,
  an Intel or AMD card reads `no-image`, and the starter still passes only `--gpus all` or CDI to the sidecar.
- **Unproved:** AMD ROCm, DirectML, Core ML, any NPU, the processor's sidecar on Windows (only the text of its PowerShell
  is tested) and on an arm computer (no cp314 arm wheels are pinned; arm stays `unavailable`, as before).
- The sidecar's memory (`--memory 4g`) and the worker's own memory cap stay the starter's fixed numbers (stripfix's 60 %).
- The ours/others split of a card's memory counts our own sidecar as "others" while a request runs (nvidia-smi on the
  host cannot tell the container's processes apart); the yield is decided before a request starts, when ours is 0.
