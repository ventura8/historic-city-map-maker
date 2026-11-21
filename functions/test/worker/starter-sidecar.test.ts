/**
 * The local AI in the POSIX starter (`docs/research/M10-local-ai.md`): `sh hcm-worker.sh matcher` over stand-ins of `curl`, `docker` and
 * `sleep`. The sidecar lives only while a frame wants it, beside a loop that keeps reading `/state`.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKER_OSES } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { starterFile as file } from '../support/starter-file.js';

const AI_IMAGE = `pytorch/pytorch:2.15.0@sha256:${'c'.repeat(64)}`;

interface MatcherWorld {
    /** The worker's `/state`, as it answers the sidecar's loop: one for each pass, the last again after that; empty, no answer at all. */
    readonly state: string | readonly string[];
    /** Whether the sidecar is still up when the loop looks. */
    readonly up?: boolean;
    /** How many passes the loop gets. */
    readonly passes?: number;
    /** `docker image rm` refuses. */
    readonly imageRmFails?: boolean;
    /** What the note of pulled images already holds. */
    readonly note?: string;
    /** The sidecar's process holds its `docker run` until the loop's last pass. */
    readonly sidecarBlocks?: boolean;
    /** `docker run` flags that make the sidecar's probe answer 0; none: no graphics card. */
    readonly gpu?: readonly ('--gpus' | '--device')[];
    /** What `docker info` lists. */
    readonly info?: string;
    /** The disk's free kilobytes. */
    readonly free?: number;
    /** A pull that fails. */
    readonly pullFails?: boolean;
    /** The sidecar's image is already on this computer. */
    readonly imageHere?: boolean;
    /** How the sidecar's process ends. */
    readonly sidecarExit?: number;
}

const NEW_AI_IMAGE = `pytorch/pytorch:2.16.0@sha256:${'d'.repeat(64)}`;

/** The worker's whole `/state` around its `ai` record: its own `image` and the starter's come after it, as the worker writes them. */
function stateWith(ai: string): string {
    const own = `"image": "sha256:${'e'.repeat(64)}", "starter": {"version": "aaaaaaaaaaaa", "wanted": "aaaaaaaaaaaa", "update": "current"}`;
    return `{"workerId": "w-1", "state": "busy", "ai": ${ai}, "machine": null, ${own}}`;
}

function wantedOf(image: string): string {
    return stateWith(`{"state": "preparing", "wanted": true, "image": "${image}", "files": true}`);
}

const WANTED = wantedOf(AI_IMAGE);
const IDLE = stateWith(`{"state": "ready", "wanted": false, "image": "${AI_IMAGE}", "files": true}`);

/** `sh hcm-worker.sh matcher` over stand-ins of `curl`, `docker` and `sleep`, until its second pass. Every docker call goes to the log. */
async function matcherLoop(
    world: MatcherWorld,
): Promise<{ readonly output: string; readonly calls: readonly string[]; readonly note: string | undefined }> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-matcher-'));
    const bin = join(folder, 'bin');
    const log = join(folder, 'calls.log');
    const home = join(folder, '.local/share/hcm-worker');
    const released = join(folder, 'released');
    const passes = world.passes ?? 2;
    const states = typeof world.state === 'string' ? [world.state] : world.state;
    mkdirSync(bin);
    states.forEach((state, index) => {
        writeFileSync(join(folder, `state-${String(index)}`), state);
    });
    const lastState = states.length - 1;
    if (world.note !== undefined) {
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, 'ai-image'), world.note);
    }
    const gpu = (world.gpu ?? []).map((flag) => `case "$*" in *"run --rm ${flag} "*probe*) exit 0 ;; esac`).join('\n');
    const hold = `n=0; until [ -e "${released}" ] || [ "$n" -ge 200 ]; do /bin/sleep 0.05; n=$((n + 1)); done; echo sidecar-ended >>"${log}"; `;
    const holds = world.sidecarBlocks === true ? hold : '';
    const docker = [
        `echo "$*" >>"${log}"`,
        gpu,
        'case "$*" in',
        '*"probe gpu"*) exit 77 ;;',
        `*"--entrypoint df"*) printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\noverlay 90000000 100 ${String(world.free ?? 90_000_000)} 1%% /\\n'; exit 0 ;;`,
        `*"matcher.serve"*) ${holds}exit ${String(world.sidecarExit ?? 0)} ;;`,
        `*".State.Running"*) echo ${world.up === true ? 'true' : 'false'}; exit 0 ;;`,
        `"image rm "*) exit ${world.imageRmFails === true ? '1' : '0'} ;;`,
        `"image inspect "*) exit ${world.imageHere === true ? '0' : '1'} ;;`,
        `"pull "*) exit ${world.pullFails === true ? '1' : '0'} ;;`,
        `"inspect "*) echo worker-image; exit 0 ;;`,
        `"info"*) echo "${world.info ?? ''}"; exit 0 ;;`,
        'esac',
        'exit 0',
    ].join('\n');
    const tools: Readonly<Record<string, string>> = {
        curl: [
            `n=$(grep -c '^curl' "${log}" 2>/dev/null) || n=0`,
            'echo curl >>"' + log + '"',
            `[ "$n" -gt ${String(lastState)} ] && n=${String(lastState)}`,
            `state=$(cat "${folder}/state-$n")`,
            '[ -n "$state" ] || exit 7',
            `printf '%s' "$state"`,
        ].join('\n'),
        docker,
        sleep: `echo "sleep $1" >>"${log}"\n[ "$(grep -c '^sleep' "${log}")" -ge ${String(passes)} ] && { : >"${released}"; kill -9 "$PPID"; }\nexit 0`,
    };
    for (const [name, body] of Object.entries(tools)) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const script = join(folder, 'hcm-worker.sh');
    writeFileSync(script, (await file('linux', 'install')).body);
    const run = spawnSync('/bin/sh', [script, 'matcher'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder },
        timeout: 20_000,
    });
    const noted = join(home, 'ai-image');
    return {
        output: run.stdout,
        calls: readFileSync(log, 'utf8').trim().split('\n'),
        note: existsSync(noted) ? readFileSync(noted, 'utf8') : undefined,
    };
}

function sidecars(calls: readonly string[]): readonly string[] {
    return calls.filter((call) => call.includes('matcher.serve'));
}

describe('the local AI in the starter (docs/research/M10-local-ai.md)', () => {
    it('happyPath_theGraphicsCardComesFirstAndTheSidecarHasNoNetwork @S-P07-HAPPY-GPU', async () => {
        const { output, calls } = await matcherLoop({ state: WANTED, gpu: ['--gpus'] });
        const [sidecar] = sidecars(calls);

        expect(output).toContain('local AI: graphics card found');
        expect(calls).toContain(`pull ${AI_IMAGE}`);
        expect(sidecar).toContain('--name hcm-matcher --gpus all --network none --cap-drop ALL --security-opt no-new-privileges');
        // 4 GB (it held 2.4 GB in M10) and a light weight against the worker and the owner's programs (reports/resource-audit.md).
        expect(sidecar).toContain('--memory 4g --memory-swap 4g --cpu-shares 128 --shm-size 1g --pids-limit 512');
        expect(sidecar).toContain('-u 10001:10001');
        expect(sidecar).toContain('-e HCM_AI_DEVICE=gpu');
        expect(sidecar).toContain('-v hcm-ai-files:/ai/files:ro -v hcm-ai-box:/ai/box');
        // The refresh token lives in the worker's volume: the sidecar never mounts it, nor the Docker socket.
        expect(sidecar).not.toMatch(/hcm-worker:|docker\.sock|--privileged/);
        // The volumes' owner comes from one run of the worker's image, before the sidecar's first.
        const volumes = calls.findIndex((call) => call.includes('--entrypoint true worker-image'));
        expect(volumes).toBeGreaterThan(-1);
        expect(volumes).toBeLessThan(calls.indexOf(sidecar ?? ''));
    });

    it('happyPath_CdiIsTriedWhenTheFirstWayFails @S-P07-HAPPY-GPU', async () => {
        const { output, calls } = await matcherLoop({ state: WANTED, gpu: ['--device'], info: ' Discovered Devices: nvidia.com/gpu=all' });

        expect(output).toContain('local AI: graphics card found');
        expect(sidecars(calls)[0]).toContain('--device nvidia.com/gpu=all');
        expect(sidecars(calls)[0]).toContain('-e HCM_AI_DEVICE=gpu');
    });

    it('happyPath_noGraphicsCardIsSaidInPlainWordsAndOnlyThenTheProcessor @S-P07-HAPPY-CPU-FALLBACK', async () => {
        const { output, calls } = await matcherLoop({ state: WANTED });

        expect(output).toContain('local AI: no usable graphics card; using the processor (slower)');
        expect(calls.findIndex((call) => call.includes('probe gpu'))).toBeLessThan(calls.indexOf(sidecars(calls)[0] ?? ''));
        expect(sidecars(calls)[0]).toContain('-e HCM_AI_DEVICE=cpu -e HCM_AI_WHY=no-gpu');
        expect(sidecars(calls)[0]).not.toContain('--gpus');
    });

    it('happyPath_aSidecarEndingWith77IsProbedAgainSoALaterDriverIsFound @S-P07-HAPPY-CPU-FALLBACK', async () => {
        const { calls } = await matcherLoop({ state: WANTED, gpu: ['--gpus'], sidecarExit: 77 });

        expect(calls.filter((call) => call.includes('probe gpu'))).toHaveLength(2);
        expect(sidecars(calls)).toHaveLength(2);
        expect(calls.filter((call) => call === `pull ${AI_IMAGE}`)).toHaveLength(1);
    });

    it.each([
        ['another repository', `evil/pytorch@sha256:${'c'.repeat(64)}`],
        ['a tag with no digest', 'pytorch/pytorch:latest'],
        ['a short digest', 'pytorch/pytorch@sha256:abc'],
        ['a name that breaks out of the shell', `pytorch/pytorch:$(id)@sha256:${'c'.repeat(64)}`],
    ])('badPath_%s_isRefusedWithoutAPull @S-P07-BAD-TAMPERED-FILE', async (_case, image) => {
        const { output, calls } = await matcherLoop({ state: `{"ai": {"wanted": true, "image": "${image}", "files": true}}` });

        expect(output).toContain('local AI: refused an unexpected program image');
        expect(calls.filter((call) => /^(pull|run) /.test(call))).toEqual([]);
    });

    it('badPath_aDiskTooFullSaysSoInTheBoxAndPullsNothing @S-A68-BAD-AI-UNAVAILABLE', async () => {
        const { calls } = await matcherLoop({ state: WANTED, gpu: ['--gpus'], free: 1000 });

        expect(calls.filter((call) => call.startsWith('pull '))).toEqual([]);
        expect(sidecars(calls)).toEqual([]);
        expect(calls.some((call) => call.includes('hcm-ai-box:/ai/box') && call.includes('"why":"disk"'))).toBe(true);
    });

    it('badPath_aPullThatFailsSaysSoInTheBox @S-A68-BAD-AI-UNAVAILABLE', async () => {
        const { calls } = await matcherLoop({ state: WANTED, pullFails: true });

        expect(sidecars(calls)).toEqual([]);
        expect(calls.some((call) => call.includes('"why":"pull"'))).toBe(true);
    });

    it('happyPath_anImageAlreadyHereIsUsedWithNoPullEvenOffline @S-P07-HAPPY-GPU', async () => {
        const { output, calls } = await matcherLoop({ state: WANTED, imageHere: true, pullFails: true, gpu: ['--gpus'], free: 1 });

        expect(calls.filter((call) => call.startsWith('pull '))).toEqual([]);
        expect(calls.some((call) => call.includes('"why"'))).toBe(false);
        expect(output).not.toContain('first use');
        expect(calls.some((call) => call.includes('--entrypoint true worker-image'))).toBe(true);
        expect(sidecars(calls).length).toBeGreaterThan(0);
    });

    it('happyPath_nothingIsPulledUntilAFrameWantsIt @S-P07-HAPPY-GPU', async () => {
        const { calls } = await matcherLoop({ state: '{"ai": {"state": "idle", "wanted": false, "image": null, "files": false}}' });

        expect(calls.filter((call) => call !== 'curl' && !call.startsWith('sleep'))).toEqual([`rm -f hcm-matcher`]);
    });

    it('happyPath_theSidecarWaitsForItsFiles @S-P07-HAPPY-GPU', async () => {
        const { calls } = await matcherLoop({ state: `{"ai": {"wanted": true, "image": "${AI_IMAGE}", "files": false}}`, gpu: ['--gpus'] });

        expect(calls).toContain(`pull ${AI_IMAGE}`);
        expect(sidecars(calls)).toEqual([]);
    });

    it('happyPath_theWorkerGetsBothVolumesAndTheStartersVersionAndNoDockerSocket @S-P07-HAPPY-GPU', async () => {
        for (const os of WORKER_OSES) {
            const text = (await file(os, 'install')).body;
            expect(text).toContain('HCM_STARTER=');
            expect(text).toContain('hcm-ai-files');
            expect(text).toContain('hcm-ai-box');
            expect(text).toContain('--network');
            expect(text).toContain('--cap-drop');
            expect(text).toContain('no usable graphics card');
            expect(text).not.toContain('docker.sock');
        }
    });

    it('happyPath_theWindowsLoopHoldsTheSameOrderAndLimits @S-P07-HAPPY-CPU-FALLBACK', async () => {
        const text = (await file('windows', 'install')).body;

        expect(text).toContain('Start-MatcherLoop');
        expect(text.indexOf("Test-AiGpu $Image @('--gpus', 'all')")).toBeLessThan(
            text.indexOf("Test-AiGpu $Image @('--device', 'nvidia.com/gpu=all')"),
        );
        expect(text.indexOf("'nvidia.com/gpu=all')))")).toBeLessThan(text.lastIndexOf("Start-Sidecar $Image 'cpu' 'no-gpu'"));
        expect(text).toContain("'--memory', '4g', '--memory-swap', '4g', '--cpu-shares', '128', '--shm-size', '1g', '--pids-limit', '512'");
        expect(text).toContain("$AiImagePattern = '^pytorch/pytorch(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$'");
    });

    it('happyPath_theRemovalTakesTheVolumesAndOnlyTheImageItPulled', async () => {
        const text = (await file('linux', 'uninstall')).body;

        expect(text).toContain('docker volume rm "$AI_FILES" "$AI_BOX"');
        expect(text).toContain('docker volume rm "$NAME"');
        expect(text).toContain('done <"$(home_dir)/ai-image"');
        const windows = (await file('windows', 'uninstall')).body;
        expect(windows).toContain('& docker volume rm $AiFiles $AiBox *> $null');
        expect(windows).toContain('& docker volume rm $Name *> $null');
        expect(windows).toContain('foreach ($each in Get-Content -LiteralPath $AiImageNote)');
    });
});

describe('the sidecar lives only while a frame wants it', () => {
    it('happyPath_theLoopKeepsReadingStateWhileTheSidecarRuns @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const { calls } = await matcherLoop({ state: WANTED, gpu: ['--gpus'], up: true, passes: 3, sidecarBlocks: true });

        // The sidecar's process has not ended, and the loop has read `/state` again, and looked at the sidecar.
        const ended = calls.indexOf('sidecar-ended');
        expect(calls.filter((call) => call === 'curl')).toHaveLength(3);
        expect(calls.lastIndexOf('curl')).toBeLessThan(ended === -1 ? calls.length : ended);
        expect(calls.some((call) => call.includes('.State.Running'))).toBe(true);
        // One running sidecar is left alone: no second look at the card, no second container.
        expect(calls.filter((call) => call.includes('probe gpu'))).toHaveLength(1);
        expect(sidecars(calls)).toHaveLength(1);
    });

    it('happyPath_noFrameWantingTheAiAnyMoreRemovesTheSidecar @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const { calls } = await matcherLoop({ state: [WANTED, IDLE], gpu: ['--gpus'], up: true });

        expect(calls.lastIndexOf('rm -f hcm-matcher')).toBeGreaterThan(calls.indexOf(sidecars(calls)[0] ?? ''));
    });

    it('happyPath_theNextFrameProbesTheCardAgainSoACardBackFromASuspendIsFound @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const { calls } = await matcherLoop({ state: [WANTED, IDLE, WANTED], gpu: ['--gpus'], up: true, passes: 3 });

        expect(calls.filter((call) => call.includes('probe gpu'))).toHaveLength(2);
        expect(sidecars(calls)).toHaveLength(2);
    });

    it('happyPath_aNewImageIsPulledAndReplacesTheSidecarOfTheOldOneAndTheOldImageGoes @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const { calls, note } = await matcherLoop({ state: [WANTED, wantedOf(NEW_AI_IMAGE)], gpu: ['--gpus'], up: true });

        expect(calls).toContain(`pull ${NEW_AI_IMAGE}`);
        expect(sidecars(calls)[0]).toContain(AI_IMAGE);
        expect(sidecars(calls)[1]).toContain(NEW_AI_IMAGE);
        expect(calls.indexOf('rm -f hcm-matcher', calls.indexOf(sidecars(calls)[0] ?? ''))).toBeLessThan(
            calls.indexOf(`image rm ${AI_IMAGE}`),
        );
        expect(note).toBe(`${NEW_AI_IMAGE}\n`);
    });

    it('badPath_anImageDockerWillNotRemoveYetStaysNotedForTheRemoval @S-P07-BAD-TAMPERED-FILE', async () => {
        const { note } = await matcherLoop({ state: WANTED, gpu: ['--gpus'], imageRmFails: true, note: 'pytorch/pytorch@sha256:old\n' });

        expect(note).toBe(`pytorch/pytorch@sha256:old\n${AI_IMAGE}\n`);
    });

    it('happyPath_theOwnersOwnImageIsNotNotedWhenItWasAlreadyHere @S-P07-HAPPY-GPU', async () => {
        const { calls, note } = await matcherLoop({ state: WANTED, imageHere: true, gpu: ['--gpus'] });

        expect(note).toBeUndefined();
        expect(calls.some((call) => call.startsWith('image rm'))).toBe(false);
    });

    it('badPath_aWorkerThatStopsAnsweringLosesItsSidecarAtTheSecondMiss @S-P07-BAD-SIDECAR-HUNG', async () => {
        const once = await matcherLoop({ state: [WANTED, ''], gpu: ['--gpus'], up: true });
        const twice = await matcherLoop({ state: [WANTED, ''], gpu: ['--gpus'], up: true, passes: 3 });
        const last = (calls: readonly string[]) => calls.lastIndexOf('rm -f hcm-matcher');

        expect(last(once.calls)).toBeLessThan(once.calls.indexOf(sidecars(once.calls)[0] ?? ''));
        expect(last(twice.calls)).toBeGreaterThan(twice.calls.indexOf(sidecars(twice.calls)[0] ?? ''));
    });

    it('badPath_whatTheLookAtTheCardEndedWithIsSaidSoAHiccupIsNotAComputerWithNoCard @S-P07-HAPPY-CPU-FALLBACK', async () => {
        const { output } = await matcherLoop({ state: WANTED });

        expect(output).toContain('local AI: no graphics card seen');
        expect(output).toContain('no usable graphics card');
    });

    it('happyPath_theProbeGivesAWordForItsReasonOnEverySystem @S-P07-HAPPY-GPU', async () => {
        const { calls } = await matcherLoop({ state: WANTED, gpu: ['--gpus'] });

        expect(calls.find((call) => call.includes('matcher.child'))).toMatch(/matcher\.child probe gpu none$/);
    });

    it('happyPath_theRemovalTakesEveryImageItNotedAndNoOther', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'hcm-remove-'));
        const bin = join(folder, 'bin');
        const log = join(folder, 'calls.log');
        const home = join(folder, '.local/share/hcm-worker');
        mkdirSync(bin);
        mkdirSync(home, { recursive: true });
        writeFileSync(join(home, 'ai-image'), 'one@sha256:a\ntwo@sha256:b\n');
        writeFileSync(join(bin, 'docker'), `#!/bin/sh\necho "$*" >>"${log}"\nexit 0\n`);
        chmodSync(join(bin, 'docker'), 0o755);
        // A stand-in: the real `pkill -f` matches by command line, so it also killed the supervisor another test file ran beside this one.
        writeFileSync(join(bin, 'pkill'), `#!/bin/sh\necho "pkill $*" >>"${log}"\nexit 0\n`);
        chmodSync(join(bin, 'pkill'), 0o755);
        const script = join(folder, 'hcm-worker-remove.sh');
        writeFileSync(script, (await file('linux', 'uninstall')).body);

        spawnSync('/bin/sh', [script], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder }, timeout: 20_000 });

        const calls = readFileSync(log, 'utf8').trim().split('\n');
        const removed = calls.filter((call) => call.startsWith('image rm '));
        expect(removed).toEqual(['image rm one@sha256:a', 'image rm two@sha256:b']);
        expect(calls).toContain('pkill -f hcm-worker.sh run');
        expect(existsSync(home)).toBe(false);
    });

    it.each([
        ['arm64', 'arm64'],
        ['amd64', 'amd64'],
    ])('badPath_theWorkerIsToldWhatDockerRunsOn_%s_whateverItsImageReads @S-P07-BAD-ARM-HOST', async (arch, said) => {
        const folder = mkdtempSync(join(tmpdir(), 'hcm-arch-'));
        const bin = join(folder, 'bin');
        const log = join(folder, 'calls.log');
        mkdirSync(bin);
        const pipeline = `us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${'e2'.repeat(32)}`;
        const tools: Readonly<Record<string, string>> = {
            curl: `printf '%s' '{"result":{"image":"${pipeline}"},"ai":{"wanted":false}}'`,
            docker: `case "$1" in\nversion) echo ${arch} ;;\nrun) echo "$*" >>"${log}" ;;\nesac\nexit 0`,
            sleep: `[ "$1" = 20 ] && exec /bin/sleep 0.05\nkill -9 "$PPID"\nexit 0`,
        };
        for (const [name, body] of Object.entries(tools)) {
            writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
            chmodSync(join(bin, name), 0o755);
        }
        const script = join(folder, 'hcm-worker.sh');
        writeFileSync(script, (await file('linux', 'install')).body);

        spawnSync('/bin/sh', [script, 'run'], { encoding: 'utf8', env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder }, timeout: 20_000 });

        expect(readFileSync(log, 'utf8')).toMatch(
            new RegExp(
                `-e HCM_DOCKER_ARCH=${said} -e HCM_AI_VARIANT=(cpu|gpu) -e HCM_HOST_NAME=\\S* -e HCM_HOST_OS=linux -e HCM_REMOVABLE=1 ${pipeline.replaceAll('.', '\\.')} worker`,
            ),
        );
    });
});

describe("the processor's sidecar in the worker's own image (docs/research/M26-governor.md §5)", () => {
    it('happyPath_aComputerWithNoNvidiaCardRunsTheWorkersOwnImageOnTheProcessorAndPullsNothing @S-P07-HAPPY-CPU-IMAGE', async () => {
        const { output, calls } = await matcherLoop({ state: wantedOf('worker') });
        const [sidecar] = sidecars(calls);

        expect(output).toContain("local AI: on the processor, in the worker's own image");
        expect(calls.filter((call) => call.startsWith('pull ') || call.includes('probe gpu'))).toEqual([]);
        expect(sidecar).toContain('-e HCM_AI_DEVICE=cpu -e HCM_AI_WHY=no-gpu');
        expect(sidecar).toContain('PYTHONPATH=/ai/files/code:/ai/files/lib-cpu');
        expect(sidecar).toContain('--entrypoint python worker-image -m matcher.serve');
        expect(sidecar).toContain('--network none --cap-drop ALL');
        // PyTorch's own image keeps its own folder: the processor's PyTorch never shadows the card's.
        const card = sidecars((await matcherLoop({ state: WANTED, gpu: ['--gpus'] })).calls)[0];
        expect(card).toContain('PYTHONPATH=/ai/files/code:/ai/files/lib ');
    });

    it.each([
        ['a word that is not worker', 'workers'],
        ['a word that breaks out of the shell', 'worker$(id)'],
    ])('badPath_%s_isRefused @S-P07-BAD-CPU-IMAGE', async (_case, image) => {
        const { output, calls } = await matcherLoop({ state: wantedOf(image) });

        expect(output).toContain('local AI: refused an unexpected program image');
        expect(sidecars(calls)).toEqual([]);
    });
});
