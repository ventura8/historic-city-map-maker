/** The real ports over Node (src/node-ports.ts): the terminal, the owner's tools as child processes, the files, time. */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { PassThrough } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { FolderFiles, LineTerminal, nodePorts, openCommand, PlatformOpener, ProcessRunner, realClock } from '../src/node-ports.js';
import { cleanUp, FakeRunner, read, temporaryFolder } from './support.js';

const folders: string[] = [];

function folder(): string {
    const dir = temporaryFolder();
    folders.push(dir);
    return dir;
}

afterEach(() => {
    cleanUp(...folders.splice(0));
});

function terminal(): {
    readonly input: PassThrough;
    readonly output: PassThrough;
    readonly lines: LineTerminal;
    readonly text: () => string;
} {
    const input = new PassThrough();
    const output = new PassThrough();
    let written = '';
    output.on('data', (chunk: Buffer) => {
        written += chunk.toString('utf8');
    });
    return { input, output, lines: new LineTerminal(input, output), text: () => written };
}

describe('LineTerminal', () => {
    it('happyPath_answersTypedAheadOrAfterTheQuestionAreReadInOrder', async () => {
        const { input, lines, text } = terminal();
        input.write('  first  \nsecond\n');
        await new Promise((done) => setImmediate(done));

        expect(await lines.ask('One? ')).toBe('first');
        expect(await lines.ask('Two? ')).toBe('second');
        const third = lines.ask('Three? ');
        input.write('third\n');
        expect(await third).toBe('third');
        lines.say('done');
        expect(text()).toBe('One? Two? Three? done\n');
        lines.close();
    });

    it('badPath_theEndOfTheInputAnswersNull', async () => {
        const { input, lines } = terminal();
        const waiting = lines.ask('Name? ');
        input.end();

        expect(await waiting).toBeNull();
        expect(await lines.ask('Again? ')).toBeNull();
    });

    it('happyPath_aToolOwnsTheTerminalWhileItRuns', async () => {
        const { input, lines } = terminal();
        lines.pause();
        const answer = lines.ask('Resumed? ');
        input.write('yes\n');

        expect(await answer).toBe('yes');
        lines.close();
    });
});

describe('ProcessRunner', () => {
    const runner = new ProcessRunner(null, process.env);

    it('happyPath_aCapturedCommandsOutputAndStatus', async () => {
        const dir = folder();

        expect(await runner.capture(process.execPath, ['-e', 'process.stdout.write(process.cwd())'], dir)).toEqual({
            code: 0,
            stdout: dir,
        });
        expect(await runner.capture(process.execPath, ['-e', 'process.exit(3)'])).toEqual({ code: 3, stdout: '' });
    });

    it('happyPath_anInteractiveCommandsStatus', async () => {
        const { lines } = terminal();
        const withTerminal = new ProcessRunner(lines, process.env);

        expect(await withTerminal.interactive(process.execPath, ['-e', 'process.exit(0)'])).toBe(0);
        expect(await withTerminal.interactive(process.execPath, ['-e', 'process.exit(4)'], folder())).toBe(4);
        lines.close();
    });

    it('badPath_aCommandEndedByASignalFailed', async () => {
        expect(await runner.capture(process.execPath, ['-e', "process.kill(process.pid, 'SIGTERM')"])).toEqual({ code: 1, stdout: '' });
    });

    it('badPath_aCommandThatIsNotInstalledIsNull', async () => {
        expect(await runner.capture('hcm-no-such-tool-e2e', ['--version'])).toBeNull();
        expect(await runner.interactive('hcm-no-such-tool-e2e', [])).toBeNull();
    });

    it('badPath_aCommandThatCannotStartIsAFailure', async () => {
        const dir = folder();
        writeFileSync(join(dir, 'not-executable'), 'x');

        expect(await runner.capture(join(dir, 'not-executable'), [])).toEqual({ code: 1, stdout: '' });
    });
});

describe('PlatformOpener', () => {
    it('happyPath_eachPlatformsOpener', async () => {
        expect(openCommand('linux')).toEqual(['xdg-open', []]);
        expect(openCommand('darwin')).toEqual(['open', []]);
        expect(openCommand('win32')).toEqual(['cmd', ['/c', 'start', '""']]);
        const runner = new FakeRunner();
        await new PlatformOpener(runner, 'win32').open('https://example.org/');

        expect(runner.lines()).toEqual(['cmd /c start "" https://example.org/']);
    });
});

describe('FolderFiles', () => {
    it('happyPath_theTargetFolderAndThePackagesFiles', () => {
        const root = join(folder(), 'city');
        const packageDir = folder();
        mkdirSync(join(packageDir, 'bundle/admin'), { recursive: true });
        writeFileSync(join(packageDir, 'bundle/admin/index.html'), 'admin');
        const files = new FolderFiles(root, packageDir);

        expect(files.entries()).toEqual([]);
        files.write('server/a.txt', 'a');
        expect(files.exists('server/a.txt')).toBe(true);
        expect(files.read('server/a.txt')).toBe('a');
        expect(files.entries()).toEqual(['server']);
        expect(files.bundled('bundle/admin/index.html')).toBe(true);
        expect(files.readBundled('bundle/admin/index.html')).toBe('admin');
        files.copyFolder('bundle', 'copy');
        files.copyFolder(join(packageDir, 'bundle'), 'absolute');
        expect(read(join(root, 'copy/admin/index.html'))).toBe('admin');
        expect(read(join(root, 'absolute/admin/index.html'))).toBe('admin');
    });

    it('badPath_nothingOutsideTheFolder', () => {
        const files = new FolderFiles(folder(), folder());

        expect(() => {
            files.write('../escape.txt', 'x');
        }).toThrow(RangeError);
        expect(() => files.read('/etc/hostname')).toThrow(RangeError);
        expect(() => files.readBundled('../package.json')).toThrow(RangeError);
    });
});

describe('nodePorts', () => {
    it('happyPath_theRealPortsOfOneRun', async () => {
        const input = new PassThrough();
        const output = new PassThrough();
        const cwd = folder();
        const { ports, terminal: lines } = nodePorts(
            {
                stdin: input,
                stdout: output,
                env: { LANG: 'en_GB.UTF-8' },
                platform: 'linux',
                versions: { node: '24.21.0' },
                cwd: () => cwd,
            },
            folder(),
        );

        expect(ports.env).toEqual({ platform: 'linux', lang: 'en_GB.UTF-8', cwd, nodeVersion: '24.21.0' });
        ports.files('city').write('x.txt', 'x');
        expect(existsSync(join(cwd, 'city/x.txt'))).toBe(true);
        await realClock.sleep(1);
        lines.close();
    });
});
