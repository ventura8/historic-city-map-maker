/**
 * M26's governor in the POSIX starter (`docs/research/M26-governor.md` §4, §5): `sh hcm-worker.sh governor` over stand-ins of
 * `curl`, `docker`, `nvidia-smi`, `xprintidle`, `loginctl`, `powershell.exe` and `sleep`. Every few seconds it writes the host's hints into the worker's volume
 * through the worker's own container, and sets the worker's CPU quota to the budget's threads only when they change.
 */
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { starterFile as file } from '../support/starter-file.js';

interface GovernorWorld {
    /** The budget's threads `/state` says, one per pass (null: no machine, an older worker). */
    readonly threads: readonly (number | null)[];
    /** What `docker info` lists. */
    readonly info?: string;
    /** Whether this computer has an NVIDIA card nvidia-smi answers for, or one whose driver is missing (`fails`: nvidia-smi prints its
     * failure on stdout and exits 9, as on the NUC). */
    readonly nvidia?: boolean | 'fails';
    /** The cards in /sys/class/drm, by PCI vendor id, each with its render node. */
    readonly drm?: readonly string[];
    /** Under WSL: each interop socket in /run/WSL and what powershell.exe prints through it ("<session> <seconds>"; null: Windows
     * refuses the socket); `interop: false` has no powershell.exe at all. logind then always says `IdleHint=no`. */
    readonly wsl?: { readonly sockets: Readonly<Record<string, string | null>>; readonly interop?: boolean };
}

const NVIDIA_FAILURE = "NVIDIA-SMI has failed because it couldn't communicate with the NVIDIA driver.";
const MODELS: Readonly<Record<string, string>> = {
    '0x8086': 'Arrow Lake-P [Arc Pro 130T/140T]',
    '0x10de': 'GA104M [GeForce RTX 3080 Mobile / Max-Q 8GB/16GB]',
};

function nvidiaSmi(world: GovernorWorld): string {
    if (world.nvidia === 'fails') {
        return `echo "${NVIDIA_FAILURE}"\nexit 9`;
    }
    return world.nvidia === true ? "echo 'NVIDIA GeForce RTX 3080 Laptop GPU, 8192, 6400, 83, 81'" : 'exit 127';
}

/** A fake /sys/class/drm and /dev: card<n>/device -> a PCI slot folder with its vendor; /dev/dri for the render nodes. */
function fakeDrm(folder: string, vendors: readonly string[]): { readonly drm: string; readonly dev: string } {
    const drm = join(folder, 'drm');
    const dev = join(folder, 'dev');
    mkdirSync(join(dev, 'dri'), { recursive: true });
    vendors.forEach((vendor, index) => {
        const slot = join(folder, 'pci', `0000:0${String(index)}:02.0`);
        mkdirSync(slot, { recursive: true });
        writeFileSync(join(slot, 'vendor'), `${vendor}\n`);
        mkdirSync(join(drm, `card${String(index)}`), { recursive: true });
        symlinkSync(slot, join(drm, `card${String(index)}`, 'device'));
    });
    return { drm, dev };
}

/** lspci -mm -s <slot>: the model of the slot's vendor. */
function lspci(folder: string): string {
    return [
        `vendor=$(cat "${folder}/pci/$3/vendor" 2>/dev/null) || exit 1`,
        'case "$vendor" in',
        ...Object.entries(MODELS).map(
            ([id, model]) => `${id}) echo '00:02.0 "VGA compatible controller" "Vendor" "${model}" -r03 "Sub" "Device"' ;;`,
        ),
        'esac',
    ].join('\n');
}

/** powershell.exe through $WSL_INTEROP: the socket's answer, or Windows' refusal. */
function powershell(folder: string, log: string): string {
    return [
        `echo "powershell $(basename "$WSL_INTEROP")" >>"${log}"`,
        `answer="${folder}/answers/$(basename "$WSL_INTEROP")"`,
        '[ -f "$answer" ] || { echo "powershell.exe: Invalid argument" >&2; exit 1; }',
        'printf \'%s\\r\\n\' "$(cat "$answer")"',
    ].join('\n');
}

/** /proc/version, the interop sockets and their answers, and the powershell.exe the starter falls back to. */
function fakeWsl(folder: string, log: string, wsl: GovernorWorld['wsl']): Record<string, string> {
    const proc = join(folder, 'version');
    writeFileSync(proc, wsl === undefined ? 'Linux version 6.8.0-generic\n' : 'Linux version 6.6.87.2-microsoft-standard-WSL2\n');
    const root = join(folder, 'wsl');
    mkdirSync(join(folder, 'answers'), { recursive: true });
    mkdirSync(root);
    const exe = join(folder, 'powershell.exe');
    writeFileSync(exe, `#!/bin/sh\n${powershell(folder, log)}\n`);
    chmodSync(exe, 0o755);
    for (const [socket, answer] of Object.entries(wsl?.sockets ?? {})) {
        writeFileSync(join(root, socket), '');
        if (answer !== null) {
            writeFileSync(join(folder, 'answers', socket), answer);
        }
    }
    const interop = wsl?.interop ?? true;
    return { HCM_PROC_VERSION: proc, HCM_WSL_INTEROP_ROOT: root, HCM_WINDOWS_POWERSHELL: interop ? exe : join(folder, 'none.exe') };
}

function stateOf(threads: number | null): string {
    const machine =
        threads === null ? '' : `, "machine": {"budget": {"threads": ${String(threads)}, "memoryMb": 2048, "gpuFraction": 0.4}}`;
    return `{"signedIn": true${machine}}`;
}

async function governorLoop(
    world: GovernorWorld,
): Promise<{ readonly calls: readonly string[]; readonly hints: unknown; readonly output: string }> {
    const folder = mkdtempSync(join(tmpdir(), 'hcm-governor-'));
    const bin = join(folder, 'bin');
    const log = join(folder, 'calls.log');
    const hints = join(folder, 'hints.json');
    mkdirSync(bin);
    world.threads.forEach((threads, index) => {
        writeFileSync(join(folder, `state-${String(index)}`), stateOf(threads));
    });
    const last = world.threads.length - 1;
    const tools: Readonly<Record<string, string>> = {
        curl: [
            `n=$(grep -c '^curl' "${log}" 2>/dev/null) || n=0`,
            `echo curl >>"${log}"`,
            `[ "$n" -gt ${String(last)} ] && n=${String(last)}`,
            `cat "${folder}/state-$n"`,
        ].join('\n'),
        docker: [
            `echo "$*" >>"${log}"`,
            'case "$1" in',
            `exec) cat >"${hints}" ;;`,
            `info) echo "${world.info ?? ''}" ;;`,
            'esac',
            'exit 0',
        ].join('\n'),
        'nvidia-smi': nvidiaSmi(world),
        lspci: lspci(folder),
        xprintidle: world.wsl === undefined ? 'echo 42000' : 'exit 1',
        loginctl: 'case "$*" in list-sessions*) echo "3 1000 wvnc - -" ;; *IdleHint*) echo no ;; esac',
        sleep: `echo "sleep $1" >>"${log}"\n[ "$(grep -c '^sleep' "${log}")" -ge ${String(world.threads.length)} ] && kill -9 "$PPID"\nexit 0`,
    };
    for (const [name, body] of Object.entries(tools)) {
        writeFileSync(join(bin, name), `#!/bin/sh\n${body}\n`);
        chmodSync(join(bin, name), 0o755);
    }
    const script = join(folder, 'hcm-worker.sh');
    writeFileSync(script, (await file('linux', 'install')).body);
    const roots = fakeDrm(folder, world.drm ?? []);
    const wsl = fakeWsl(folder, log, world.wsl);
    const run = spawnSync('/bin/sh', [script, 'governor'], {
        encoding: 'utf8',
        env: { PATH: `${bin}:/usr/bin:/bin`, HOME: folder, HCM_DRM_ROOT: roots.drm, HCM_DEV_ROOT: roots.dev, ...wsl },
        timeout: 20_000,
    });
    return {
        calls: readFileSync(log, 'utf8').trim().split('\n'),
        hints: existsSync(hints) ? JSON.parse(readFileSync(hints, 'utf8')) : null,
        output: run.stdout,
    };
}

function updates(calls: readonly string[]): readonly string[] {
    return calls.filter((call) => call.startsWith('update '));
}

describe("the governor's loop in the starter (M26)", () => {
    it('happyPath_theQuotaFollowsTheBudgetOnlyWhenItChangesAndTheHintsReachTheVolume @S-A141-HAPPY', async () => {
        const { calls, hints, output } = await governorLoop({ threads: [14, 14, 4], info: 'Runtimes: runc nvidia', nvidia: true });

        expect(updates(calls)).toEqual(['update --cpus 14 hcm-worker', 'update --cpus 4 hcm-worker']);
        expect(output).toContain('governor: the worker may use 4 cores');
        expect(calls).toContain(
            'exec -i hcm-worker sh -c cat > /work/host-hints.json.part && mv /work/host-hints.json.part /work/host-hints.json',
        );
        expect(calls.filter((call) => call.startsWith('run ') || call.includes('docker.sock'))).toEqual([]);
        expect(hints).toMatchObject({
            idleS: 42,
            gpus: [
                {
                    vendor: 'nvidia',
                    name: 'NVIDIA GeForce RTX 3080 Laptop GPU',
                    vramMb: 8192,
                    othersMb: 6400,
                    busyPct: 83,
                    tempC: 81,
                    via: 'cuda',
                },
            ],
            npus: [],
        });
        expect(typeof (hints as { at?: unknown }).at).toBe('number');
    });

    it('badPath_anOlderWorkerOrAPauseLeavesTheQuotaAndACardDockerCannotReachHasNoRuntime @S-A141-BAD-NO-GPU', async () => {
        const { calls, hints } = await governorLoop({ threads: [null, 0, 6], nvidia: true });

        expect(updates(calls)).toEqual(['update --cpus 6 hcm-worker']);
        expect(hints).toMatchObject({ gpus: [{ vendor: 'nvidia', via: null }] });
    });

    it('badPath_noCardNoHintsOfOne @S-A141-BAD-NO-GPU', async () => {
        const { hints } = await governorLoop({ threads: [2] });

        expect(hints).toMatchObject({ gpus: [], npus: [] });
    });

    it('badPath_aFailingNvidiaSmiIsNeverACardAndAnNvidiaCardWithoutItsDriverSaysSo @S-A141-BAD-NO-DRIVER', async () => {
        const nuc = await governorLoop({ threads: [4], nvidia: 'fails', drm: ['0x8086'] });

        expect(nuc.hints).toMatchObject({
            gpus: [{ vendor: 'intel', name: 'Arrow Lake-P [Arc Pro 130T/140T]', vramMb: 0, via: 'openvino' }],
        });
        expect(JSON.stringify(nuc.hints)).not.toContain('NVIDIA-SMI');
        const noDriver = await governorLoop({ threads: [4], nvidia: 'fails', drm: ['0x10de'] });

        expect(noDriver.hints).toMatchObject({
            gpus: [{ vendor: 'nvidia', name: 'GA104M [GeForce RTX 3080 Mobile / Max-Q 8GB/16GB]', via: null, why: 'no-driver' }],
        });
    });

    it('happyPath_aWorkingNvidiaCardIsListedOnceAndAnAmdCardRocmCannotReachIsNot', async () => {
        const { hints } = await governorLoop({ threads: [4], nvidia: true, drm: ['0x10de', '0x1002'] });

        expect(hints).toMatchObject({ gpus: [{ vendor: 'nvidia', name: 'NVIDIA GeForce RTX 3080 Laptop GPU', vramMb: 8192 }] });
        expect((hints as { readonly gpus: readonly unknown[] }).gpus).toHaveLength(1);
    });

    it('happyPath_underWslTheIdleSecondsAreTheWindowsUsersReadOncePer30SecondsFromTheirOwnSession @S-A141-HAPPY-WSL-IDLE', async () => {
        const { calls, hints } = await governorLoop({
            threads: [4, 4, 4],
            wsl: { sockets: { '1_interop': null, '200714_interop': '0 82209', '4597_interop': '1 1614' } },
        });

        expect(hints).toMatchObject({ idleS: 1614 });
        const reads = calls.filter((call) => call.startsWith('powershell '));
        expect(reads).toContain('powershell 4597_interop');
        expect(reads.length).toBeLessThanOrEqual(3);
        expect(new Set(reads).size).toBe(reads.length);
        expect(calls.filter((call) => call.startsWith('exec '))).toHaveLength(3);
    });

    it('badPath_underWslWithoutInteropTheIdleSecondsAreEmptyNeverLoginds0 @S-A141-BAD-WSL-NO-INTEROP', async () => {
        const none = await governorLoop({ threads: [4, 4], wsl: { sockets: { '4597_interop': '1 1614' }, interop: false } });

        expect(none.hints).toMatchObject({ idleS: null });
        expect(none.calls.filter((call) => call.startsWith('powershell '))).toEqual([]);
        const sessionZero = await governorLoop({ threads: [4], wsl: { sockets: { '1_interop': null, '200714_interop': '0 82209' } } });

        expect(sessionZero.hints).toMatchObject({ idleS: null });
    });

    it('happyPath_theWindowsFileHasTheSameLoop', async () => {
        const text = (await file('windows', 'install')).body;

        expect(text).toContain('GetLastInputInfo');
        expect(text).toContain('Win32_Battery');
        expect(text).toContain('Start-Process -FilePath \'powershell.exe\' -ArgumentList "$Run governor $PID" -WindowStyle Hidden');
        expect(text).toContain('& docker update --cpus $threads $Name');
        expect(text).toContain("'governor' { Start-GovernorLoop ([int]$args[1]) }");
        expect(text).toContain('if ($LASTEXITCODE -ne 0) { $rows = @() }');
    });
});
