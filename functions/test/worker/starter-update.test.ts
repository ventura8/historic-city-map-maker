/**
 * The starter updates itself (`docs/research/M7-local-worker.md`, *The starter updates itself*): `sh hcm-worker.sh update` and
 * the service's own start, over stand-ins of `curl`, `docker` and `sleep`. The newer file comes from the server's `worker.starter`
 * and is put in place only when its SHA-256, as a template, is the one the release's list on Hosting names; else the file stays
 * and the word the worker passes to the admin says why.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { WORKER_STARTER_VERSION } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { CITY, starterFile as file } from '../support/starter-file.js';

const NEWER = 'aaaaaaaaaaaa';
const MARKS = ['PROJECT', 'CITY', 'ACTION'] as const;

/** A small starter of the newer version, as a template: it says it ran, and with which word. */
function newerTemplate(): string {
    const marks = MARKS.map((name) => `HCM_${name}='__HCM_${name}__'`).join('\n');
    return `#!/bin/sh\nSTARTER_VERSION=${NEWER}\n${marks}\necho "NEWER STARTER RAN $1 $HCM_ACTION"\n`;
}

/** The template filled as `worker.starter` fills it. */
function served(template: string): string {
    return template.replace('__HCM_PROJECT__', 'demo-hcm').replace('__HCM_CITY__', CITY).replace('__HCM_ACTION__', 'install');
}

function sha256(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

interface UpdateWorld {
    /** The list Hosting answers (null: none, the site unreachable). */
    readonly list?: { readonly version: string; readonly sha256: { readonly posix: string; readonly windows: string } } | null;
    /** The file `worker.starter` answers (null: none). */
    readonly file?: string | null;
    /** Where the script runs from: the installed copy (default) or elsewhere. */
    readonly elsewhere?: boolean;
    /** The rename cannot happen: something already holds the new file's name. */
    readonly blocked?: boolean;
    /** What the service's supervisor finds on disk after its first wait (the daily look's newer file). */
    readonly laterOnDisk?: string;
}

interface UpdateRun {
    readonly output: string;
    readonly installed: string;
    readonly folder: string;
    readonly calls: readonly string[];
    readonly files: readonly string[];
}

function tools(folder: string, world: UpdateWorld, installed: string): Readonly<Record<string, string>> {
    const log = join(folder, 'calls.log');
    const later = world.laterOnDisk === undefined ? '' : `cp "${join(folder, 'later')}" "${installed}"`;
    return {
        curl: [
            "out=''",
            "url=''",
            'while [ $# -gt 0 ]; do case "$1" in -o) out=$2; shift ;; http*) url=$1 ;; esac; shift; done',
            `echo "curl $url" >>"${log}"`,
            'case "$url" in',
            `*starter.json) [ -f "${folder}/list" ] || exit 22; cat "${folder}/list" ;;`,
            `*worker-starter*) [ -f "${folder}/served" ] || exit 22; cat "${folder}/served" >"$out" ;;`,
            '*) exit 7 ;;',
            'esac',
        ].join('\n'),
        docker: `echo "docker $*" >>"${log}"\nexit 0`,
        sleep: [`echo "sleep $1" >>"${log}"`, `if [ "$1" = 10 ]; then ${later || ':'}; else exec /bin/sleep 1; fi`].join('\n'),
    };
}

async function updateRun(world: UpdateWorld, action: 'update' | 'run' = 'update'): Promise<UpdateRun> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-update-'));
    const bin = join(folder, 'bin');
    const home = join(folder, 'home');
    const share = join(home, '.local', 'share', 'hcm-worker');
    mkdirSync(bin);
    mkdirSync(share, { recursive: true });
    const installed = world.elsewhere === true ? join(folder, 'hcm-worker.sh') : join(share, 'hcm-worker.sh');
    const current = (await file('linux', 'install')).body.replace("HCM_ACTION='install'", "HCM_ACTION='run'");
    writeFileSync(installed, current);
    chmodSync(installed, 0o700);
    if (world.list !== null) {
        const list = world.list ?? { version: WORKER_STARTER_VERSION, sha256: { posix: '0'.repeat(64), windows: '0'.repeat(64) } };
        writeFileSync(join(folder, 'list'), JSON.stringify(list, null, 4));
    }
    if (world.file !== null && world.file !== undefined) {
        writeFileSync(join(folder, 'served'), world.file);
    }
    if (world.laterOnDisk !== undefined) {
        writeFileSync(join(folder, 'later'), world.laterOnDisk);
    }
    if (world.blocked === true) {
        mkdirSync(`${installed}.new`);
    }
    for (const [name, body] of Object.entries(tools(folder, world, installed))) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const run = spawnSync('/bin/sh', [installed, action], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: home },
        timeout: 30_000,
    });
    const log = join(folder, 'calls.log');
    return {
        output: run.stdout,
        installed: readFileSync(installed, 'utf8'),
        folder,
        calls: existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : [],
        files: readdirSync(join(installed, '..')),
    };
}

function newerList(template: string): NonNullable<UpdateWorld['list']> {
    return { version: NEWER, sha256: { posix: sha256(template), windows: '1'.repeat(64) } };
}

describe('the starter updates itself', () => {
    it('happyPath_aNewerFileOfTheReleaseReplacesTheInstalledOneAtomically @S-A142-HAPPY-SELF-UPDATE', async () => {
        const template = newerTemplate();
        const { output, installed, calls, files } = await updateRun({ list: newerList(template), file: served(template) });

        expect(output).toContain('starter: the look for a newer starter said updated');
        expect(output.trim().split('\n').at(-1)).toBe('updated');
        expect(installed).toContain(`STARTER_VERSION=${NEWER}`);
        expect(installed).toContain("HCM_ACTION='run'");
        expect(installed).toContain(`HCM_CITY='${CITY}'`);
        expect(files).toEqual(['hcm-worker.sh']);
        expect(calls).toEqual([
            'curl https://demo-hcm.web.app/admin/starter.json',
            `curl https://us-central1-demo-hcm.cloudfunctions.net/worker-starter?city=${CITY}&os=linux&action=install`,
        ]);
    });

    it('happyPath_theServiceStartsTheNewerFileInItsOwnProcess @S-A142-HAPPY-SELF-UPDATE', async () => {
        const template = newerTemplate();
        const { output } = await updateRun({ list: newerList(template), file: served(template) }, 'run');

        expect(output).toContain('NEWER STARTER RAN run run');
    });

    it('happyPath_aNewerFileTheDailyLookWroteIsStartedOnceTheWorkerEnds @S-A142-HAPPY-SELF-UPDATE', async () => {
        const later = served(newerTemplate()).replace("HCM_ACTION='install'", "HCM_ACTION='run'");
        const { output, calls } = await updateRun({ laterOnDisk: later }, 'run');

        expect(output).toContain('starter: starting the updated file');
        expect(output).toContain('NEWER STARTER RAN run run');
        expect(calls).toContain('sleep 10');
    });

    it('happyPath_theReleasesOwnVersionIsCurrentAndNothingIsFetched @S-A142-HAPPY-SELF-UPDATE', async () => {
        const { output, installed, calls } = await updateRun({});

        expect(output.trim()).toBe('current');
        expect(installed).toContain(`STARTER_VERSION=${WORKER_STARTER_VERSION}`);
        expect(calls).toEqual(['curl https://demo-hcm.web.app/admin/starter.json']);
    });

    it.each([
        ['no-list', { list: null }],
        ['no-list', { list: { version: 'not hex', sha256: { posix: 'x', windows: 'y' } } }],
        ['no-file', { list: newerList(newerTemplate()), file: null }],
        [
            'bad-sum',
            { list: { version: NEWER, sha256: { posix: '2'.repeat(64), windows: '1'.repeat(64) } }, file: served(newerTemplate()) },
        ],
        ['bad-sum', { list: newerList(newerTemplate()), file: served(newerTemplate().replace(NEWER, 'bbbbbbbbbbbb')) }],
        ['read-only', { list: newerList(newerTemplate()), file: served(newerTemplate()), blocked: true }],
        ['not-installed', { list: newerList(newerTemplate()), file: served(newerTemplate()), elsewhere: true }],
    ] as const)('badPath_theFileStaysAndTheWordSaysWhy_%s @S-A142-BAD-SELF-UPDATE', async (word, world) => {
        const { output, installed, files } = await updateRun(world);

        expect(output.trim().split('\n').at(-1)).toBe(word);
        expect(installed).toContain(`STARTER_VERSION=${WORKER_STARTER_VERSION}`);
        expect(files.filter((name) => name.endsWith('.part'))).toEqual([]);
    });

    it('happyPath_theWorkerGetsTheVersionAndTheLastLooksWord', async () => {
        const text = (await file('linux', 'install')).body;

        expect(text).toContain('-e HCM_STARTER="$STARTER_VERSION" -e HCM_STARTER_UPDATE="$update_said"');
        expect(text).not.toContain('__HCM_');
    });

    it('happyPath_theWindowsFileLooksTheSameWay', async () => {
        const text = (await file('windows', 'install')).body;

        expect(text).toContain(`$StarterVersion = '${WORKER_STARTER_VERSION}'`);
        expect(text).toContain('$StarterList = "https://$Project.web.app/admin/starter.json"');
        expect(text).toContain('"HCM_STARTER=$StarterVersion"');
        expect(text).toContain('"HCM_STARTER_UPDATE=$($script:UpdateSaid)"');
        expect(text).toContain('if (Update-Starter) { Restart-Starter }');
        expect(text).toContain('if ((Get-StarterOnDisk) -ne $StarterVersion -or (Update-Starter)) { Restart-Starter }');
        expect(text).toContain('Invoke-DailyLook');
        expect(text).toContain('Move-Item -LiteralPath "$Installed.new" -Destination $Installed -Force');
        expect(text).not.toContain('__HCM_');
    });
});
