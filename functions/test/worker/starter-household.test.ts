/**
 * W5, household computers, in the POSIX starter (`packages/admin/starter/hcm-worker.sh`; `docs/research/M7-local-worker.md`
 * *Household computers*): the one line of "Add another computer" for a computer without a screen (the one-time code on standard
 * input, handed to the worker's own page, never in argv or a file), Docker installed from the system's signed packages when it is
 * missing (one sudo, the disk checked first, re-running safe), linger for a computer with no screen, and Remove this computer:
 * the worker's exit 76-79 makes the supervisor clean up, let the worker say done, then remove the rest, Docker only when asked and
 * installed by the helper. Every program is a stand-in that writes what it was asked into a log.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { starterFile as file } from '../support/starter-file.js';

const CODE = 'abcdefghijklmnopqrstuvwxyz';
/** The only real programs a run may reach: no Docker, package manager or sudo of the machine that runs the tests. */
const SYSTEM_TOOLS = [
    'sh',
    'sed',
    'awk',
    'cat',
    'tr',
    'cut',
    'mkdir',
    'chmod',
    'dirname',
    'basename',
    'id',
    'grep',
    'rm',
    'head',
    'tail',
    'date',
    'env',
    'mv',
    'readlink',
    'wc',
    'sort',
    'ls',
    'kill',
    'nohup',
    'mktemp',
    'touch',
    'true',
    'false',
];
const DIGEST = 'e2'.repeat(32);

interface Run {
    readonly status: number | null;
    readonly output: string;
    readonly calls: readonly string[];
    readonly folder: string;
    readonly posted: string;
}

/** The stand-ins every run has; `tools` replaces or adds some. */
function standIns(log: string, folder: string): Record<string, string> {
    return {
        docker: `echo "docker $*" >>"${log}"\ncase "$1" in info) echo 8000000000 ;; esac\nexit 0`,
        systemctl: `echo "systemctl $*" >>"${log}"\nexit 0`,
        loginctl: `echo "loginctl $*" >>"${log}"\n[ "$1" = show-user ] && echo no\nexit 0`,
        sleep: `echo "sleep $1" >>"${log}"\nexec /bin/sleep 0.05`,
        uname: `[ "$1" = -s ] && { echo Linux; exit 0; }\necho nuc`,
        pkill: `echo "pkill $*" >>"${log}"\nexit 0`,
        sudo: `echo "sudo $*" >>"${log}"\n[ "$1" = -n ] && exit 1\n"$@"`,
        // The worker's page: pairable until a code was posted, then signed in (the body is kept to check where the code went).
        curl: [
            `echo "curl $*" >>"${log}"`,
            'case "$*" in',
            `*-X\\ POST*) cat >"${folder}/posted"; exit 0 ;;`,
            `*/state*) [ -s "${folder}/posted" ] && echo '{"signedIn": true}' || echo '{"signedIn": false, "pairable": true}' ;;`,
            'esac',
        ].join('\n'),
    };
}

async function starter(
    args: readonly string[],
    options: {
        readonly input?: string;
        readonly tools?: Readonly<Record<string, string | null>>;
        readonly env?: Readonly<Record<string, string>>;
    } = {},
): Promise<Run> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-household-'));
    const bin = join(folder, 'bin');
    const log = join(folder, 'calls.log');
    mkdirSync(bin);
    writeFileSync(log, '');
    for (const [name, body] of Object.entries({ ...standIns(log, folder), ...options.tools })) {
        if (body === null) {
            continue;
        }
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const system = join(folder, 'system');
    mkdirSync(system);
    for (const tool of SYSTEM_TOOLS) {
        const found = spawnSync('/bin/sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
        if (found.startsWith('/') && !existsSync(join(bin, tool))) {
            symlinkSync(found, join(system, tool));
        }
    }
    const script = join(folder, 'hcm-worker.sh');
    writeFileSync(script, (await file('linux', 'install')).body);
    const run = spawnSync('/bin/sh', [script, ...args], {
        encoding: 'utf8',
        input: options.input ?? '',
        env: { PATH: `${bin}:${system}`, HOME: folder, ...options.env },
        timeout: 20_000,
    });
    const posted = existsSync(join(folder, 'posted')) ? readFileSync(join(folder, 'posted'), 'utf8') : '';
    return { status: run.status, output: run.stdout, calls: readFileSync(log, 'utf8').trim().split('\n'), folder, posted };
}

/** Every file the run left under the home folder (not the symlinked system tools), read whole. */
function filesUnder(folder: string): string {
    const texts: string[] = [];
    const walk = (path: string): void => {
        for (const entry of readdirSync(path, { withFileTypes: true })) {
            const full = join(path, entry.name);
            if (entry.isDirectory() && entry.name !== 'system') {
                walk(full);
            } else if (entry.isFile() && entry.name !== 'posted') {
                texts.push(readFileSync(full, 'utf8'));
            }
        }
    };
    walk(folder);
    return texts.join('\n');
}

describe('a computer without a screen joins with one line', () => {
    it('happyPath_theCodeOnStandardInputReachesTheWorkerAndNothingElse @S-A143-HAPPY-HEADLESS-PAIR', async () => {
        const run = await starter([], { input: `${CODE}\n` });

        expect(run.output).toContain('This computer is connected. The admin lists it as nuc.');
        expect(JSON.parse(run.posted)).toEqual({ code: CODE });
        const post = run.calls.find((call) => call.includes('-X POST')) ?? '';
        expect(post).toContain('-H Origin: https://demo-hcm.web.app');
        expect(post).toContain('--data-binary @- http://127.0.0.1:8765/pair');
        // Never an argument of a program, never in a file the run left (the stand-ins' log of every argv included).
        expect(filesUnder(run.folder)).not.toContain(CODE);
        // No screen here: the service keeps running while nobody is logged in.
        expect(run.calls.some((call) => call.startsWith('loginctl enable-linger'))).toBe(true);
    });

    it('badPath_aCodeTheMapRefusesIsSaidWithTheFix @S-A143-BAD-HEADLESS-EXPIRED', async () => {
        const refused = `echo "curl $*" >>/dev/null\ncase "$*" in *-X\\ POST*) cat >/dev/null ;; */state*) echo '{"signedIn": false, "pairable": true, "lastError": "apiError.worker.pairCode"}' ;; esac`;
        const run = await starter([], { input: `${CODE}\n`, tools: { curl: refused } });

        expect(run.status).toBe(1);
        expect(run.output).toContain('The map refused the code: it was used already or ran out.');
    });

    it('badPath_aLineThatIsNotACodeIsIgnoredAndNothingIsPosted', async () => {
        const run = await starter([], { input: 'rm -rf /\n' });

        expect(run.output).toContain('That is not a code from the admin');
        expect(run.posted).toBe('');
        expect(run.output).toContain('Go back to the admin: it connects this computer by itself.');
    });

    it('happyPath_aComputerWithAScreenKeepsItsSessionRulesAndNoLinger', async () => {
        const run = await starter([], { env: { DISPLAY: ':0' } });

        expect(run.calls.some((call) => call.includes('enable-linger'))).toBe(false);
    });
});

describe('Docker installed when it is missing', () => {
    /** apt-get installs Docker: afterwards `docker` answers (a stand-in written into the same folder). */
    function apt(log: string): string {
        return `echo "apt-get $*" >>"${log}"\ncase "$*" in *install*) printf '#!/bin/sh\\necho "docker $*" >>"${log}"\\nexit 0\\n' >"$(dirname "$0")/docker"; chmod 755 "$(dirname "$0")/docker" ;; esac\nexit 0`;
    }

    it('happyPath_fromTheSystemsSignedPackagesWithOneSudoAndANote @S-A143-HAPPY-INSTALL-DOCKER', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'hcm-apt-'));
        const log = join(folder, 'apt.log');
        writeFileSync(log, '');
        const run = await starter([], {
            tools: { docker: null, 'apt-get': apt(log), df: "echo h; echo '/dev/x 100 1 52428800 1% /var'", usermod: 'exit 0' },
        });
        const calls = readFileSync(log, 'utf8');

        expect(run.output).toContain("Step 1 of 3: installing Docker from your system's own signed packages");
        expect(calls).toContain('apt-get install -y -q docker.io');
        expect(run.calls).toContain('sudo systemctl enable --now docker');
        expect(readFileSync(join(run.folder, '.local/share/hcm-worker/installed-docker'), 'utf8')).toBe('apt-get\n');
        expect(run.calls.some((call) => call.startsWith('curl') && call.includes('get.docker'))).toBe(false);
    });

    it('happyPath_anNvidiaCardGetsNvidiasContainerToolkitAndItsCdiFile @S-A143-HAPPY-INSTALL-DOCKER', async () => {
        const run = await starter([], {
            tools: {
                docker: 'echo "docker $*" >/dev/null; [ "$1" = info ] && exit 1; exit 0',
                'nvidia-smi': "echo 'GPU 0: NVIDIA GeForce RTX 5090 (UUID: GPU-1)'",
                'apt-get': `case "$*" in *nvidia-container-toolkit*) printf '#!/bin/sh\\nexit 0\\n' >"$(dirname "$0")/nvidia-ctk"; chmod 755 "$(dirname "$0")/nvidia-ctk" ;; esac`,
                gpg: 'cat >/dev/null; exit 0',
                tee: 'cat >/dev/null; exit 0',
                usermod: 'exit 0',
                sg: 'exit 1',
            },
        });

        expect(run.calls).toContain('sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml');
        expect(run.calls).toContain('sudo nvidia-ctk runtime configure --runtime=docker');
    });

    it('badPath_tooLittleDiskIsSaidBeforeAnythingIsInstalled @S-A143-BAD-INSTALL-DOCKER', async () => {
        const run = await starter([], {
            tools: { docker: null, 'apt-get': 'echo apt >&2; exit 0', df: "echo h; echo '/dev/x 100 1 1048576 1% /var'" },
        });

        expect(run.status).toBe(1);
        expect(run.output).toContain('need 10 GB free on this computer; it has 1 GB');
        expect(run.calls.some((call) => call.startsWith('sudo'))).toBe(false);
    });

    it('badPath_aRefusedPasswordOrABlockedComputerSaysWhoToAsk', async () => {
        const run = await starter([], {
            tools: { docker: null, 'apt-get': 'exit 100', df: "echo h; echo '/dev/x 100 1 52428800 1% /var'" },
        });

        expect(run.status).toBe(1);
        expect(run.output).toContain("a work computer's administrator may block it");
        expect(run.output).toContain('https://docs.docker.com/engine/install/');
    });

    it('badPath_aLinuxWithNoKnownPackageManagerGetsTheLink', async () => {
        const run = await starter([], { tools: { docker: null } });

        expect(run.status).toBe(1);
        expect(run.output).toContain('none of the package managers this helper knows');
    });
});

describe('macOS: Colima with Homebrew when Docker is missing', () => {
    /** brew installs Colima and docker: afterwards both answer (stand-ins written into the same folder). */
    function brew(log: string): string {
        const docker = `printf '#!/bin/sh\\necho "docker $*" >>"${log}"\\nexit 0\\n' >"$(dirname "$0")/docker"`;
        const colima = `printf '#!/bin/sh\\necho "colima $*" >>"${log}"\\nexit 0\\n' >"$(dirname "$0")/colima"`;
        return [
            `echo "brew $*" >>"${log}"`,
            `case "$*" in install*) ${docker}; ${colima}; chmod 755 "$(dirname "$0")/docker" "$(dirname "$0")/colima" ;; esac`,
            'exit 0',
        ].join('\n');
    }

    const mac = {
        uname: '[ "$1" = -s ] && { echo Darwin; exit 0; }\n[ "$1" = -m ] && { echo arm64; exit 0; }\necho studio',
        launchctl: 'exit 0',
        open: 'exit 0',
        df: "echo h; echo '/dev/x 100 1 52428800 1% /'",
        docker: null,
    };

    it('happyPath_homebrewInstallsColimaWithRosettaAndANote @S-A143-HAPPY-MAC-COLIMA', async () => {
        const folder = mkdtempSync(join(tmpdir(), 'hcm-brew-'));
        const log = join(folder, 'brew.log');
        writeFileSync(log, '');
        const run = await starter([], { tools: { ...mac, brew: brew(log) } });
        const calls = readFileSync(log, 'utf8');

        expect(run.output).toContain('Step 1 of 2: installing Colima and the docker command with Homebrew');
        expect(calls).toContain('brew install colima docker');
        expect(calls).toContain('colima start --vm-type vz --vz-rosetta --cpu 4 --memory 6 --disk 40');
        expect(calls).toContain('brew services start colima');
        expect(readFileSync(join(run.folder, 'Library/Application Support/hcm-worker/installed-docker'), 'utf8')).toBe('colima\n');
    });

    it('badPath_withoutHomebrewItSaysWhyAndWhereToGetIt @S-A143-BAD-MAC-COLIMA', async () => {
        const run = await starter([], { tools: mac });

        expect(run.status).toBe(1);
        expect(run.output).toContain('which this Mac does not have');
        expect(run.output).toContain('https://brew.sh');
        expect(run.output).toContain('https://docs.docker.com/desktop/setup/install/mac-install/');
    });
});

describe('Remove this computer, on the computer', () => {
    async function removal(code: number, marker: string | null): Promise<Run> {
        const tools: Record<string, string> = {
            curl: `case "$*" in *worker-image*) printf '%s' '{"result":{"image":"us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${DIGEST}"}}' ;; *) exit 1 ;; esac`,
            docker: '',
        };
        const folder = mkdtempSync(join(tmpdir(), 'hcm-remove-'));
        const log = join(folder, 'docker.log');
        writeFileSync(log, '');
        tools['docker'] = [
            `echo "docker $*" >>"${log}"`,
            'case "$*" in',
            '*HCM_REMOVAL=done*) exit 0 ;;',
            `run*worker\\ --city*) exit ${String(code)} ;;`,
            `images*) echo "us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${DIGEST}" ;;`,
            'esac',
            'exit 0',
        ].join('\n');
        const env = marker === null ? {} : { XDG_DATA_HOME: folder };
        if (marker !== null) {
            mkdirSync(join(folder, 'hcm-worker'), { recursive: true });
            writeFileSync(join(folder, 'hcm-worker/installed-docker'), `${marker}\n`);
        }
        const run = await starter(['run'], { tools, env });
        return { ...run, calls: readFileSync(log, 'utf8').trim().split('\n') };
    }

    it('happyPath_theWorkersOrderCleansUpThenItSaysDoneThenTheRestGoes @S-A143-HAPPY-REMOVE', async () => {
        const run = await removal(76, null);
        const said = run.calls.findIndex((call) => call.includes('HCM_REMOVAL=done'));

        expect(run.output).toContain('The admin asked to remove this computer: cleaning up.');
        expect(said).toBeGreaterThan(run.calls.indexOf('docker volume rm hcm-ai-files hcm-ai-box'));
        expect(run.calls.indexOf('docker volume rm hcm-worker')).toBeGreaterThan(said);
        expect(run.calls).toContain(`docker image rm us-central1-docker.pkg.dev/demo-hcm/hcm/pipeline@sha256:${DIGEST}`);
        expect(run.output).toContain('This computer no longer works for the map.');
    });

    it('happyPath_keepingTheScannedMapsKeepsTheVolumeButNotTheSignIn', async () => {
        const run = await removal(78, null);

        expect(run.calls).not.toContain('docker volume rm hcm-worker');
        expect(run.calls.some((call) => call.includes('rm -f /work/.hcm-session-*'))).toBe(true);
    });

    it('badPath_dockerTheHelperInstalledStaysWithoutAPasswordAndIsSaid @S-A143-BAD-REMOVE-DOCKER', async () => {
        const run = await removal(77, 'apt-get');

        expect(run.calls.some((call) => call.includes('HCM_REMOVAL_DOCKER_LEFT=true'))).toBe(true);
    });

    it('badPath_dockerTheOwnerHadIsNeverTouched', async () => {
        const run = await removal(77, null);

        expect(run.calls.some((call) => call.includes('HCM_REMOVAL_DOCKER_LEFT=false'))).toBe(true);
    });
});
