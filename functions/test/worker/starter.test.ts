/**
 * The starter files (finding 72 of 2026-11-02; finding 73 of 2026-11-03: served by `worker.starter`,
 * `functions/src/worker/starter.ts`, as a download): each template of `packages/admin/starter/` filled for each system and
 * action, checked for what it must and must not hold, the function's answers (the file with its name, a bad query, a
 * method other than GET or HEAD, a template that cannot be read), and finding 74's supervisor, which backs off when the
 * image the server names refuses its arguments. The POSIX file is parsed by `sh -n` (shellcheck lints the template
 * itself in the static stage) and run with stand-ins of `curl`, `docker` and `sleep`; the quality image has no
 * PowerShell, so the Windows one is checked for its structure: CRLF lines, one PowerShell marker after cmd's `exit /b`,
 * balanced brackets.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKER_OSES, WORKER_OUTDATED_EXIT } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { createDiskStarterTemplates } from '../../src/adapters/starter-templates.js';
import { handleStarterRequest, serveStarters, type StarterDeps } from '../../src/worker/starter.js';
import { recordingLogger } from '../support/fakes.js';
import { CITY, starterFile as file, TEMPLATES } from '../support/starter-file.js';

const DIGEST = 'e2'.repeat(32);

function deps(starters = createDiskStarterTemplates(TEMPLATES)) {
    const { log, recording } = recordingLogger();
    const world: StarterDeps = { log, starters, config: { projectId: 'demo-hcm' } as StarterDeps['config'] };
    return { deps: world, recording };
}

function count(text: string, character: string): number {
    return text.split(character).length - 1;
}

describe('worker.starter', () => {
    it.each(WORKER_OSES.flatMap((os) => (['install', 'uninstall'] as const).map((action) => [os, action] as const)))(
        'happyPath_the%sFileTo%sIsADownloadNamingTheCityAndTheInstalledImageAndHoldsNoSecret @S-A62-HAPPY-STARTER',
        async (os, action) => {
            const answer = await file(os, action);
            const text = answer.body;

            expect(answer.status).toBe(200);
            expect(answer.headers).toMatchObject({
                'content-type': 'application/octet-stream',
                'cache-control': 'no-store',
                'access-control-allow-origin': '*',
            });
            expect(answer.headers['content-disposition']).toMatch(/^attachment; filename="hcm-worker(-remove)?\.(sh|command|bat)"$/);
            expect(text).not.toContain('__HCM_');
            expect(text).toContain(os === 'windows' ? 'set "HCM_PROJECT=demo-hcm"' : "HCM_PROJECT='demo-hcm'");
            expect(text).toContain(os === 'windows' ? 'set "HCM_CITY=bucharest"' : "HCM_CITY='bucharest'");
            expect(text).toContain(os === 'windows' ? `set "HCM_ACTION=${action}"` : `HCM_ACTION='${action}'`);
            // The supervisor asks the server for the installed image, runs it on the loopback only and restarts it itself (Docker's
            // restart policy only brings it back after a reboot before the supervisor runs: RESILIENCE-AUDIT P1-1).
            expect(text).toContain('.cloudfunctions.net/worker-image');
            expect(text).toContain('--supervised');
            expect(text).toContain('127.0.0.1:');
            expect(text).toContain(String(WORKER_OUTDATED_EXIT));
            expect(text).not.toMatch(/--pair|--restart always|docker\.sock/);
        },
    );

    it('happyPath_eachSystemGetsItsOwnFileName', async () => {
        const names = await Promise.all(
            WORKER_OSES.flatMap((os) => (['install', 'uninstall'] as const).map(async (action) => (await file(os, action)).headers)),
        );

        expect(names.map((headers) => headers['content-disposition'])).toEqual([
            'attachment; filename="hcm-worker.sh"',
            'attachment; filename="hcm-worker-remove.sh"',
            'attachment; filename="hcm-worker.command"',
            'attachment; filename="hcm-worker-remove.command"',
            'attachment; filename="hcm-worker.bat"',
            'attachment; filename="hcm-worker-remove.bat"',
        ]);
    });

    it('happyPath_thePosixFileParsesAsAShellScript', async () => {
        for (const action of ['install', 'uninstall'] as const) {
            const parsed = spawnSync('/bin/sh', ['-n'], { input: (await file('linux', action)).body, encoding: 'utf8' });
            expect(parsed.status).toBe(0);
        }
        expect((await file('mac', 'install')).body).toBe((await file('linux', 'install')).body);
        expect((await file('linux', 'install')).body).not.toContain('\r');
    });

    it('happyPath_theWindowsFileIsCmdThenOnePowerShellPart', async () => {
        const text = (await file('windows', 'install')).body;
        const lines = text.split('\r\n');
        const marker = lines.indexOf('#PS-BEGIN');
        const powershell = lines.slice(marker + 1).join('\n');

        expect(text.replace(/\r\n/g, '')).not.toContain('\n');
        expect(lines.filter((line) => line === '#PS-BEGIN')).toHaveLength(1);
        expect(lines.slice(0, marker).at(-1)).toBe('exit /b');
        expect(lines[0]).toBe('@echo off');
        expect([count(powershell, '{'), count(powershell, '(')]).toEqual([count(powershell, '}'), count(powershell, ')')]);
        expect(powershell).toContain('Register-ScheduledTask');
        expect(powershell).toContain('Unregister-ScheduledTask');
        expect(powershell).toContain('$Usage = 2');
    });

    it.each([
        ['no city', { os: 'linux', action: 'install' }],
        ['a city that could break out of the file', { city: "x'$(id)'", os: 'linux', action: 'install' }],
        ['another system', { city: CITY, os: 'beos', action: 'install' }],
        ['another action', { city: CITY, os: 'linux', action: 'run' }],
        ['a field more', { city: CITY, os: 'linux', action: 'install', project: 'other' }],
    ])('badPath_aRequestFor_%s_IsRefusedWithoutAFile', async (_case, query) => {
        const answer = await handleStarterRequest(deps().deps, { method: 'GET', query });

        expect(answer.status).toBe(400);
        expect(answer.headers).not.toHaveProperty('content-disposition');
    });

    it('badPath_onlyGetAndHeadAreAnswered', async () => {
        const query = { city: CITY, os: 'linux', action: 'install' };

        await expect(handleStarterRequest(deps().deps, { method: 'POST', query })).resolves.toMatchObject({
            status: 405,
            headers: { allow: 'GET, HEAD' },
        });
        await expect(handleStarterRequest(deps().deps, { method: 'HEAD', query })).resolves.toMatchObject({ status: 200 });
    });

    it('badPath_aTemplateThatCannotBeReadGivesNoFileAndIsLogged @S-A62-BAD-STARTER-TEMPLATE', async () => {
        const world = deps(createDiskStarterTemplates(new URL('file:///nowhere/hcm-starter/')));

        const answer = await handleStarterRequest(world.deps, { method: 'GET', query: { city: CITY, os: 'linux', action: 'install' } });

        expect(answer.status).toBe(503);
        expect(answer.headers).not.toHaveProperty('content-disposition');
        expect(world.recording.records.map((record) => record.message)).toContain('starter template not readable');
    });

    it('happyPath_theExpressHandlerSendsTheAnswer', async () => {
        const sent: { status?: number; headers?: Readonly<Record<string, string>>; body?: string } = {};
        const response = {
            status(code: number) {
                sent.status = code;
                return this;
            },
            set(headers: Readonly<Record<string, string>>) {
                sent.headers = headers;
                return this;
            },
            send(body: string) {
                sent.body = body;
            },
        };

        await serveStarters(() => deps().deps)({ method: 'GET', query: { city: CITY, os: 'linux', action: 'install' } }, response);

        expect(sent.status).toBe(200);
        expect(sent.headers?.['content-disposition']).toBe('attachment; filename="hcm-worker.sh"');
        expect(sent.body).toContain("HCM_CITY='bucharest'");
    });

    it('happyPath_aTemplateIsReadOnceAndAFailedReadIsTriedAgain', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'hcm-starter-'));
        const templates = createDiskStarterTemplates(new URL(`file://${folder}/`));

        await expect(templates.read('hcm-worker.sh')).rejects.toThrow();
        writeFileSync(join(folder, 'hcm-worker.sh'), 'first\n');
        await expect(templates.read('hcm-worker.sh')).resolves.toBe('first\n');
        writeFileSync(join(folder, 'hcm-worker.sh'), 'second\n');
        await expect(templates.read('hcm-worker.sh')).resolves.toBe('first\n');
    });
});

/** The filled POSIX file run as its supervisor (`sh hcm-worker.sh run`) over stand-ins that exit the worker with `code`. */
async function supervise(
    code: number,
    environment: Readonly<Record<string, string>> = {},
    extra: Readonly<Record<string, string>> = {},
): Promise<{ readonly output: string; readonly log: readonly string[]; readonly runs: readonly string[]; readonly folder: string }> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-supervisor-'));
    const bin = join(folder, 'bin');
    const log = join(folder, 'calls.log');
    const runs = join(folder, 'runs.log');
    mkdirSync(bin);
    writeFileSync(runs, '');
    const tools: Readonly<Record<string, string>> = {
        curl: `printf '%s' '{"result":{"image":"us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${DIGEST}"}}'`,
        // Docker says it has 8 GB; each worker's `run` is kept with its arguments.
        docker: `[ "$1" = info ] && { echo 8000000000; exit 0; }\n[ "$1" = run ] && { echo run >>"${log}"; echo "$*" >>"${runs}"; exit ${String(code)}; }\nexit 0`,
        // The fourth wait ends the supervisor (its parent shell), as a stop of the service would; the sidecar's, the governor's and the
        // daily look's loops beside it wait apart.
        sleep: `case "$1" in 20 | 5 | 86400) exec /bin/sleep 0.05 ;; esac\necho "sleep $1" >>"${log}"\n[ "$(grep -c sleep "${log}")" -ge 4 ] && kill -9 "$PPID"\nexit 0`,
        ...extra,
    };
    for (const [name, body] of Object.entries(tools)) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const script = join(folder, 'hcm-worker.sh');
    writeFileSync(script, (await file('linux', 'install')).body);
    const run = spawnSync('/bin/sh', [script, 'run'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder, ...environment },
        timeout: 20_000,
    });
    const started = readFileSync(runs, 'utf8').trim().split('\n');
    return {
        output: run.stdout,
        log: readFileSync(log, 'utf8').trim().split('\n'),
        runs: started.filter((line) => line.includes(' worker ')),
        folder,
    };
}

describe('the supervisor (finding 74 of 2026-11-03)', () => {
    it('badPath_anImageThatRefusesTheSupervisorsArgumentsIsSaidOnceAndAskedForEveryFiveMinutes @S-A62-BAD-STARTER-OLD-IMAGE', async () => {
        const { output, log } = await supervise(2);

        expect(output.match(/does not support this computer's starter: update the map/g)).toHaveLength(1);
        expect(log).toEqual(['run', 'sleep 10', 'run', 'sleep 30', 'run', 'sleep 300', 'run', 'sleep 300']);
    });

    it('happyPath_theWorkerIsCappedAtSixtyPercentOfDockersMemoryAndLightAgainstOtherContainers @S-P31-HAPPY-WORKER-POLITE', async () => {
        const { runs } = await supervise(WORKER_OUTDATED_EXIT);

        // 60 % of the 8 GB Docker has, with no swap beyond it: an out-of-memory run ends the job, not the desktop.
        expect(runs[0]).toContain(
            '--restart unless-stopped --name hcm-worker --cpu-shares 256 --memory 4800000000 --memory-swap 4800000000 -p 127.0.0.1:8765:8765',
        );
        expect(runs[0]).not.toContain('GDAL_NUM_THREADS');
        expect(runs[0]).toContain(`worker --city ${CITY} --project demo-hcm --supervised --image sha256:${DIGEST}`);
    });

    it('badPath_theOwnersOwnLimitsWinAndNoneLeavesTheMemoryFree @S-P31-BAD-WORKER-POLITE-OVERRIDE', async () => {
        const own = await supervise(WORKER_OUTDATED_EXIT, { HCM_WORKER_MEMORY: '3g', HCM_WORKER_THREADS: '2' });
        const free = await supervise(WORKER_OUTDATED_EXIT, { HCM_WORKER_MEMORY: 'none' });

        expect(own.runs[0]).toContain('--cpu-shares 256 --memory 3g --memory-swap 3g -e GDAL_NUM_THREADS=2 -p 127.0.0.1');
        expect(free.runs[0]).toContain('--name hcm-worker --cpu-shares 256 -p 127.0.0.1');
        expect(free.runs[0]).not.toContain('--memory');
    });

    it('happyPath_theWorkerIsToldWhichSidecarThisComputerGetsByItsNvidiaCard @S-P07-HAPPY-CPU-IMAGE', async () => {
        const none = await supervise(WORKER_OUTDATED_EXIT, {}, { 'nvidia-smi': 'exit 127' });
        const card = await supervise(
            WORKER_OUTDATED_EXIT,
            {},
            { 'nvidia-smi': "echo 'GPU 0: NVIDIA GeForce RTX 3080 Laptop GPU (UUID: GPU-1)'" },
        );

        expect(none.runs[0]).toContain('-e HCM_AI_VARIANT=cpu ');
        expect(card.runs[0]).toContain('-e HCM_AI_VARIANT=gpu ');
    });

    it('badPath_theOwnersVariantWinsAndAnythingElseIsLeftToTheCard @S-P07-BAD-CPU-IMAGE', async () => {
        const forced = await supervise(WORKER_OUTDATED_EXIT, { HCM_AI_VARIANT: 'cpu' }, { 'nvidia-smi': "echo 'GPU 0: RTX'" });
        const odd = await supervise(WORKER_OUTDATED_EXIT, { HCM_AI_VARIANT: 'turbo' }, { 'nvidia-smi': "echo 'GPU 0: RTX'" });

        expect(forced.runs[0]).toContain('-e HCM_AI_VARIANT=cpu ');
        expect(odd.runs[0]).toContain('-e HCM_AI_VARIANT=gpu ');
    });

    it('happyPath_anOutdatedWorkerIsStartedAgainAtOnceAndNothingIsSaid', async () => {
        const { output, log } = await supervise(WORKER_OUTDATED_EXIT);

        expect(output).not.toContain('update the map');
        expect(log).toEqual(['run', 'sleep 0', 'run', 'sleep 0', 'run', 'sleep 0', 'run', 'sleep 0']);
    });
});

/** The cleanup brief of 2026-11-14 and RESILIENCE-AUDIT P1-1: what the supervisor does with Docker around each run of the worker. */
describe('the supervisor keeps Docker tidy and the worker restartable', () => {
    const PIPELINE = 'us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:';
    const PREVIOUS = `${PIPELINE}${'a1'.repeat(32)}`;
    const OLDER = `${PIPELINE}${'b2'.repeat(32)}`;
    const FOREIGN = `docker.io/library/postgres@sha256:${'c3'.repeat(32)}`;

    /** A Docker that lists `images` (newest first, as `docker images` does) and says every other call on the supervisor's output. */
    function docker(images: readonly string[]): Record<string, string> {
        const listed = images.map((image) => `'${image}'`).join(' ');
        const run = `[ "$1" = run ] && exit ${String(WORKER_OUTDATED_EXIT)}`;
        return {
            docker: `[ "$1" = info ] && { echo 8000000000; exit 0; }\n[ "$1" = images ] && { printf '%s\\n' ${listed}; exit 0; }\n${run}\necho "docker $*" >>"$HOME/docker.log"\nexit 0`,
        };
    }

    it('happyPath_onlyPipelineImagesOlderThanTheCurrentAndThePreviousOneGoAndTheContainerIsRemovedAfterItsRun @S-P04-HAPPY-OLD-IMAGES', async () => {
        const { folder } = await supervise(WORKER_OUTDATED_EXIT, {}, docker([`${PIPELINE}${DIGEST}`, PREVIOUS, OLDER, FOREIGN]));
        const output = readFileSync(join(folder, 'docker.log'), 'utf8');

        expect(output).toContain(`docker image rm ${OLDER}`);
        expect(output).not.toContain(`docker image rm ${PREVIOUS}`);
        expect(output).not.toContain(`docker image rm ${PIPELINE}${DIGEST}`);
        expect(output).not.toContain(FOREIGN);
        expect(output).toContain('docker image prune -f --filter label=org.historiccitymap.worker');
        expect(output.match(/docker rm -f hcm-worker/g)?.length).toBeGreaterThanOrEqual(2);
    });

    it('badPath_noOtherPipelineImageMeansNothingIsRemovedAndAnotherAppsImageIsNeverTouched @S-P04-BAD-OLD-IMAGES', async () => {
        const { folder } = await supervise(WORKER_OUTDATED_EXIT, {}, docker([`${PIPELINE}${DIGEST}`, FOREIGN]));
        const output = readFileSync(join(folder, 'docker.log'), 'utf8');

        expect(output).not.toContain('docker image rm');
        expect(output).not.toContain(FOREIGN);
    });
});
