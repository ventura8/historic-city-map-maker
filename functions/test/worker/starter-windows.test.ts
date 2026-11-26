/**
 * The Windows starter. The quality image has no PowerShell, so a small reader of its strings stands for the parser where it matters
 * (`[scriptblock]::Create` refuses the whole file at one bad string, install and removal alike), and what Windows PowerShell 5.1 does to
 * a native command's arguments is pinned by what the file may hold: it drops an empty argument and strips a quote inside one
 * (`docs/LESSONS.md`). The logic is the POSIX file's (`starter-sidecar.test.ts`); here, that the Windows one holds the same.
 */
import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import { starterFile as file } from '../support/starter-file.js';

async function powerShell(action: 'install' | 'uninstall' = 'install'): Promise<string> {
    return (await file('windows', action)).body.split('#PS-BEGIN\r\n')[1] ?? '';
}

/** Where a character may end a string: a word, a backslash or a quote straight after one means it ended too early. */
const AFTER_A_STRING = /[\w\\'"]/;

/** A double-quoted string from `start` (just past its quote): the index past its end, or why not. */
function doubleQuoted(text: string, start: number): { readonly end: number } | { readonly fault: string } {
    for (let at = start; at < text.length; at += 1) {
        const character = text[at];
        if (character === '`') {
            at += 1;
        } else if (character === '"' && text[at + 1] === '"') {
            at += 1;
        } else if (character === '"') {
            return AFTER_A_STRING.test(text[at + 1] ?? '') ? { fault: text.slice(start - 1, at + 8) } : { end: at + 1 };
        } else if (character === '\n') {
            return { fault: `a string runs past its line: ${text.slice(start - 1, at)}` };
        }
    }
    return { fault: 'a string never ends' };
}

function singleQuoted(text: string, start: number): number {
    let at = start;
    while (at < text.length && (text[at] !== "'" || text[at + 1] === "'")) {
        at += text[at] === "'" ? 2 : 1;
    }
    return at + 1;
}

function endOfLine(text: string, at: number): number {
    const end = text.indexOf('\n', at);
    return end === -1 ? text.length : end;
}

/** One token at `at`: where the next begins, and what is wrong with a string it holds. */
function readToken(text: string, at: number, faults: string[]): number {
    const character = text[at];
    if (character === '#') {
        return endOfLine(text, at);
    }
    if (character === "'") {
        return singleQuoted(text, at + 1);
    }
    if (character !== '"') {
        return at + 1;
    }
    const read = doubleQuoted(text, at + 1);
    if ('fault' in read) {
        faults.push(read.fault);
        return endOfLine(text, at);
    }
    return read.end;
}

/** What is wrong with the strings of a PowerShell text: nothing, for one that parses. */
function stringFaults(text: string): readonly string[] {
    const faults: string[] = [];
    let at = 0;
    while (at < text.length) {
        at = readToken(text, at, faults);
    }
    return faults;
}

describe('the Windows starter under Windows PowerShell 5.1', () => {
    it('badPath_theReaderOfStringsRefusesABackslashQuoteAsPowerShellDoes @S-P07-BAD-WINDOWS-STARTER', () => {
        expect(stringFaults(String.raw`$word = "printf '{\"state\":\"x\"}' > /ai/box/starter.json"`)).not.toEqual([]);
        expect(stringFaults('$a = "never ends\n$b = 1')).not.toEqual([]);
        expect(stringFaults('$a = \'it\'\'s\'; $b = "`"x`" ""y""" # a " in a comment')).toEqual([]);
    });

    it.each(['install', 'uninstall'] as const)(
        'happyPath_everyStringOfThe%sFileEndsWhereItShould @S-P07-HAPPY-WINDOWS-STARTER',
        async (action) => {
            expect(stringFaults((await powerShell(action)).replaceAll('\r\n', '\n'))).toEqual([]);
        },
    );

    it('badPath_noCallOfDockerHoldsAnEmptyArgumentOrAQuoteInsideOne @S-P07-BAD-WINDOWS-STARTER', async () => {
        const calls = (await powerShell()).split('\r\n').filter((line) => line.includes('& docker'));

        expect(calls.length).toBeGreaterThan(10);
        expect(calls.filter((call) => /\s(""|'')(\s|$)/.test(call))).toEqual([]);
        expect(calls.filter((call) => call.includes('\\"') || call.includes('`"'))).toEqual([]);
        expect(calls.find((call) => call.includes('matcher.child'))).toContain('probe gpu none *> $null');
    });

    it('happyPath_theRefusalReadsAsJsonWhatever51DoesToQuotes @S-P07-BAD-WINDOWS-STARTER', async () => {
        const line = (await powerShell()).split('\r\n').find((each) => each.includes('$word = '));
        const word = /\$word = "(.*)"$/.exec(line?.trim() ?? '')?.[1] ?? '';

        expect(word).not.toContain('"');
        const run = spawnSync('/bin/sh', ['-c', word.replace('$Why', 'disk').replace(' > /ai/box/starter.json', '')], { encoding: 'utf8' });
        expect(JSON.parse(run.stdout)).toEqual({ state: 'unavailable', why: 'disk' });
    });

    it('happyPath_theLoopIsTheSameAsThePosixOnesAndEndsWithItsSupervisor @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const text = await powerShell();

        // It looks at its supervisor, as `kill -0` does, and a new supervisor stops the loops an earlier one left.
        expect(text).toContain('while (Get-Process -Id $Supervisor -ErrorAction SilentlyContinue)');
        expect(text).toContain('Stop-Processes "*$Name.ps1*matcher*"');
        expect(text).toContain('"$Run matcher $PID"');
        expect(text).toContain('Start-MatcherLoop ([int]$args[1])');
        // The sidecar is detached, so the loop goes on; it goes when nobody wants it, or the worker has not answered twice.
        expect(text).toContain('& docker run -d --rm --name $Matcher');
        expect(text).toContain('if ($missed -ge 2) { Stop-Sidecar }');
        expect(text).toContain("return (& docker inspect --format '{{.State.Running}}' $Matcher 2> $null) -eq 'true'");
        expect(text).toContain('if ($script:SidecarImage -eq $Image -and (Test-SidecarUp)) { return }');
    });

    it('happyPath_theWorkerIsCappedAndLightAsUnderThePosixStarter @S-P31-HAPPY-WORKER-POLITE', async () => {
        const text = await powerShell();

        expect(text).toContain("$limits = @('--cpu-shares', '256')");
        expect(text).toContain("$said = & docker info --format '{{.MemTotal}}' 2> $null");
        expect(text).toContain('$memory = [string]([int64][math]::Floor($total / 100) * 60)');
        expect(text).toContain("if ($memory -and $memory -ne 'none') { $limits += @('--memory', $memory, '--memory-swap', $memory) }");
        expect(text).toContain('if ($env:HCM_WORKER_THREADS) { $limits += @(\'-e\', "GDAL_NUM_THREADS=$($env:HCM_WORKER_THREADS)") }');
        expect(text).toContain("$arguments = @('run', '--restart', 'unless-stopped', '--name', $Name) + (Get-WorkerLimits) + @('-p',");
        // The cleanup brief of 2026-11-14: older pipeline images go before each run, the current and the previous one kept.
        expect(text).toContain('Remove-OldPipelineImages $image');
        expect(text).toContain('& docker rm -f $Name *> $null');
    });

    it('happyPath_aComputerWithNoNvidiaCardGetsTheWorkersOwnImageAsUnderThePosixStarter @S-P07-HAPPY-CPU-IMAGE', async () => {
        const text = await powerShell();

        expect(text).toContain("if ((& nvidia-smi -L 2> $null) -match '^GPU') { return 'gpu' }");
        expect(text).toContain(`$arguments += @('-e', "HCM_AI_VARIANT=$(Get-AiVariant)", $image)`);
        expect(text).toContain("if ($wanted -ceq 'worker' -and $workerImage) { $wanted = $workerImage }");
        expect(text).toContain("$script:AiLib = 'lib-cpu'");
        expect(text).toContain('$path = "PYTHONPATH=/ai/files/code:/ai/files/$script:AiLib"');
    });

    it('badPath_onlyTheWorkersOwnImageOrPyTorchsByDigestIsRun @S-P07-BAD-CPU-IMAGE', async () => {
        const text = await powerShell();

        expect(text).toContain('if ($wanted -cnotmatch $AiImagePattern -and $wanted -ne $workerImage) {');
        expect(text).toContain("if ($env:HCM_AI_VARIANT -ceq 'gpu' -or $env:HCM_AI_VARIANT -ceq 'cpu') { return $env:HCM_AI_VARIANT }");
    });

    it('happyPath_theWorkerIsToldWhatDockerRunsOn @S-P07-BAD-ARM-HOST', async () => {
        const text = await powerShell();

        expect(text).toContain("$arch = & docker version --format '{{.Server.Arch}}' 2> $null");
        expect(text).toContain('"HCM_DOCKER_ARCH=$arch"');
    });

    it('happyPath_theNoteOfImagesKeepsEachAndTheNewPullLetsTheEarlierGo @S-P07-HAPPY-SIDECAR-WHILE-WANTED', async () => {
        const text = await powerShell();

        expect(text).toContain('Set-AiImageNote $Wanted');
        expect(text).toContain('& docker image rm $old *> $null');
        expect(text).toContain('Set-Content -LiteralPath $AiImageNote -Value ($kept + $Wanted) -Encoding Ascii');
    });
});

/** The text of the Windows file's function `name`, to its closing brace at the start of a line. */
function functionBody(text: string, name: string): string {
    const start = text.indexOf(`function ${name}`);
    return start === -1 ? '' : text.slice(start, text.indexOf('\r\n}\r\n', start) + 3);
}

describe('W5, household computers, on Windows (docs/research/M7-local-worker.md, Household computers)', () => {
    it('happyPath_withoutDockerDesktopItTurnsWslOnInstallsItsOwnLinuxAndDockerEngine @S-A143-HAPPY-WINDOWS-WSL', async () => {
        const text = await powerShell();
        const initialize = functionBody(text, 'Initialize-Docker');

        // Docker Desktop when it runs; else WSL (one permission prompt, a restart and a resume), the helper's own Ubuntu, Docker Engine.
        expect(initialize.indexOf('Test-Docker')).toBeLessThan(initialize.indexOf('Install-Wsl'));
        expect(initialize).toContain('Install-Distro');
        expect(initialize).toContain('Install-Engine');
        expect(functionBody(text, 'Install-Wsl')).toContain(
            "Start-Process -FilePath 'wsl.exe' -ArgumentList '--install', '--no-distribution' -Verb RunAs -Wait",
        );
        expect(functionBody(text, 'Install-Wsl')).toContain(
            'Set-ItemProperty -Path $ResumeKey -Name $Name -Value "powershell.exe $Run install"',
        );
        expect(text).toContain("$ResumeKey = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce'");
        expect(functionBody(text, 'Install-Distro')).toContain('& wsl.exe --install $DistroImage --name $Distro --no-launch');
        // Docker's own key checked by its fingerprint, the version pinned and held: never a script piped from the internet.
        const engine = functionBody(text, 'Install-Engine');
        expect(text).toContain("$DockerKey = '9DC858229FC7DD38854AE2D88D81803C0EBFCD88'");
        expect(text).toMatch(/\$DockerVersion = '\d+\.\d+\.\d+'/);
        expect(engine).toContain("grep -q '^fpr:*$($DockerKey):'");
        expect(engine).toContain('apt-get install -y -q "docker-ce=$v" "docker-ce-cli=$v" containerd.io');
        expect(engine).toContain('apt-mark hold docker-ce docker-ce-cli');
        expect(text).not.toMatch(/get\.docker\.com|Invoke-Expression|\biex\b/);
        // Only WSL's own switch asks for the administrator: nothing else elevates.
        expect(text.match(/-Verb RunAs/g)).toHaveLength(2);
    });

    it('badPath_noVirtualizationTooLittleDiskOrABlockedComputerIsSaidWithTheFix @S-A143-BAD-WINDOWS-WSL', async () => {
        const text = await powerShell();

        expect(functionBody(text, 'Install-Wsl')).toContain('Virtualization is off on this computer');
        expect(text).toContain("$VirtualizationHelp = 'https://aka.ms/enablevirtualization'");
        expect(functionBody(text, 'Test-Room')).toContain("Docker and the map's pipeline need $MinFreeGb GB free");
        expect(functionBody(text, 'Write-Blocked')).toContain("a work computer's administrator may block it");
        expect(functionBody(text, 'Install-Distro')).toContain('wsl --update');
        expect(functionBody(text, 'Install-Engine')).toContain('it goes on from where it stopped');
    });

    it('happyPath_theKeepAliveTheUninstallEntryAndTheHeadlessCode @S-A143-HAPPY-WINDOWS-KEEPALIVE', async () => {
        const text = await powerShell();

        expect(functionBody(text, 'Start-KeepAlive')).toContain(
            "-ArgumentList '-d', $Distro, '-e', 'sleep', 'infinity' -WindowStyle Hidden",
        );
        expect(functionBody(text, 'Start-Supervisor')).toContain('Start-KeepAlive');
        expect(text).toContain('$UninstallKey = "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\$Name"');
        expect(functionBody(text, 'Register-UninstallEntry')).toContain('uninstall"; NoModify = 1; NoRepair = 1');
        // The code comes from the environment, is cleared at once, and goes to the worker's own page with the project's origin.
        expect(functionBody(text, 'Read-PairCode')).toContain('Remove-Item Env:HCM_PAIR_CODE');
        expect(functionBody(text, 'Connect-WithCode')).toContain('-Uri "http://127.0.0.1:$Port/pair" -Headers $headers');
        expect(text).toContain('$Origin = "https://$Project.web.app"');
    });

    it('happyPath_removeThisComputerCleansUpThenTheWorkerSaysDone @S-A143-HAPPY-REMOVE', async () => {
        const text = await powerShell();
        const remove = functionBody(text, 'Remove-ByOrder');

        expect(text).toContain("$arguments += @('-e', 'HCM_REMOVABLE=1')");
        expect(text).toContain('if ($code -ge $RemoveExit -and $code -le $RemoveExit + 3) { Remove-ByOrder $code $image $digest }');
        expect(remove.indexOf('Remove-Ai')).toBeLessThan(remove.indexOf('HCM_REMOVAL=done'));
        expect(remove.indexOf('HCM_REMOVAL=done')).toBeLessThan(remove.indexOf('Remove-WorkerFiles'));
        expect(remove).toContain('if (($flags % 2) -eq 1 -and $ownLinux) { & wsl.exe --unregister $Distro *> $null }');
    });

    it('badPath_wslOrDockerTheOwnerHadIsNeverRemovedAndTheRemovalAsks @S-A143-BAD-REMOVE-DOCKER', async () => {
        const text = await powerShell('uninstall');
        const uninstall = functionBody(text, 'Uninstall-Worker');

        expect(uninstall).toContain('$ownLinux = Test-Path -LiteralPath $DistroNote');
        expect(uninstall).toContain('if ($ownLinux -and (Read-Host');
        expect(uninstall).toContain("if ($ownWsl -and (Read-Host 'This helper turned WSL on. Turn it off too");
        expect(functionBody(text, 'Remove-Service')).toContain('Remove-Item -Path $UninstallKey -Recurse -Force');
    });
});
