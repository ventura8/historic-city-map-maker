/**
 * The real ports (`ports.ts`) over Node's built-ins: child processes for the owner's own tools, the terminal through
 * one line reader that pauses while a tool owns the terminal, the files of one folder, timers. The entry (`../cli.ts`)
 * wires them to `process`.
 */
import { spawn, type SpawnOptions } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { createInterface, type Interface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';

import type { Captured, Clock, Env, Files, Opener, Ports, Runner, Terminal } from './ports.js';

/** Everything printed by a captured command is kept up to this many characters (listings are small). */
const MAX_CAPTURE = 1_000_000;

/** The line reader of the terminal: lines typed ahead wait in a queue; the end of the input answers null. */
export class LineTerminal implements Terminal {
    readonly #output: Writable;
    readonly #reader: Interface;
    readonly #lines: string[] = [];
    readonly #waiting: ((line: string | null) => void)[] = [];
    #ended = false;

    constructor(input: Readable, output: Writable) {
        this.#output = output;
        // terminal: false keeps the terminal in its own line mode, which the owner's tools find as they expect it.
        this.#reader = createInterface({ input, terminal: false });
        this.#reader.on('line', (line) => {
            const waiter = this.#waiting.shift();
            if (waiter === undefined) {
                this.#lines.push(line);
            } else {
                waiter(line);
            }
        });
        this.#reader.on('close', () => {
            this.#ended = true;
            for (const waiter of this.#waiting.splice(0)) {
                waiter(null);
            }
        });
    }

    say(line: string): void {
        this.#output.write(`${line}\n`);
    }

    ask(question: string): Promise<string | null> {
        this.#output.write(question);
        const queued = this.#lines.shift();
        if (queued !== undefined || this.#ended) {
            return Promise.resolve(queued === undefined ? null : queued.trim());
        }
        this.#reader.resume();
        return new Promise((done) => {
            this.#waiting.push((line) => {
                done(line === null ? null : line.trim());
            });
        });
    }

    /** Stops reading while a tool owns the terminal (its prompts read the same input). */
    pause(): void {
        this.#reader.pause();
    }

    close(): void {
        this.#reader.close();
    }
}

function exited(child: ReturnType<typeof spawn>): Promise<number | null> {
    return new Promise((done) => {
        child.once('error', (error: NodeJS.ErrnoException) => {
            done(error.code === 'ENOENT' ? null : 1);
        });
        child.once('close', (code) => {
            done(code ?? 1);
        });
    });
}

/** The owner's tools, run as themselves: no shell, the arguments as given. */
export class ProcessRunner implements Runner {
    readonly #terminal: LineTerminal | null;
    readonly #env: NodeJS.ProcessEnv;

    constructor(terminal: LineTerminal | null, env: NodeJS.ProcessEnv) {
        this.#terminal = terminal;
        this.#env = env;
    }

    async interactive(command: string, args: readonly string[], cwd?: string): Promise<number | null> {
        this.#terminal?.pause();
        return exited(spawn(command, [...args], this.#options('inherit', cwd)));
    }

    async capture(command: string, args: readonly string[], cwd?: string): Promise<Captured | null> {
        const child = spawn(command, [...args], this.#options(['ignore', 'pipe', 'inherit'], cwd));
        let stdout = '';
        child.stdout?.setEncoding('utf8');
        child.stdout?.on('data', (chunk: string) => {
            stdout = `${stdout}${chunk}`.slice(0, MAX_CAPTURE);
        });
        const code = await exited(child);
        return code === null ? null : { code, stdout };
    }

    #options(stdio: SpawnOptions['stdio'], cwd: string | undefined): SpawnOptions {
        return { stdio, env: this.#env, ...(cwd === undefined ? {} : { cwd }) };
    }
}

/** The command that opens a page on `platform`, and its arguments before the address. */
export function openCommand(platform: string): readonly [string, readonly string[]] {
    if (platform === 'darwin') {
        return ['open', []];
    }
    return platform === 'win32' ? ['cmd', ['/c', 'start', '""']] : ['xdg-open', []];
}

/** Opens pages through the platform's opener; a missing opener leaves the address printed for the owner. */
export class PlatformOpener implements Opener {
    readonly #runner: Runner;
    readonly #platform: string;

    constructor(runner: Runner, platform: string) {
        this.#runner = runner;
        this.#platform = platform;
    }

    async open(url: string): Promise<void> {
        const [command, args] = openCommand(this.#platform);
        await this.#runner.capture(command, [...args, url]);
    }
}

/** A path below the target folder: relative, without `..`. */
function inside(root: string, path: string): string {
    const target = normalize(join(root, path));
    if (isAbsolute(path) || (target !== root && !target.startsWith(`${root}${sep}`))) {
        throw new RangeError(`not a path inside ${root}: ${path}`);
    }
    return target;
}

/** The files of `root`, and the package's own files in `packageDir` (the `dist/` folder the CLI runs from). */
export class FolderFiles implements Files {
    readonly root: string;
    readonly #packageDir: string;

    constructor(root: string, packageDir: string) {
        this.root = root;
        this.#packageDir = packageDir;
    }

    exists(path: string): boolean {
        return existsSync(inside(this.root, path));
    }

    entries(): readonly string[] {
        return existsSync(this.root) ? readdirSync(this.root) : [];
    }

    read(path: string): string {
        return readFileSync(inside(this.root, path), 'utf8');
    }

    write(path: string, content: string): void {
        const target = inside(this.root, path);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
    }

    bundled(path: string): boolean {
        return existsSync(this.#packaged(path));
    }

    readBundled(path: string): string {
        return readFileSync(this.#packaged(path), 'utf8');
    }

    copyFolder(from: string, to: string): void {
        cpSync(this.#packaged(from), inside(this.root, to), { recursive: true });
    }

    /** A file the package carries, or an absolute path (`--bundle`). */
    #packaged(path: string): string {
        return isAbsolute(path) ? path : inside(this.#packageDir, path);
    }
}

export const realClock: Clock = {
    sleep: (ms) =>
        new Promise((done) => {
            setTimeout(done, ms);
        }),
};

/** What `nodePorts` needs of `process`. */
export interface NodeProcess {
    readonly stdin: Readable;
    readonly stdout: Writable;
    readonly env: NodeJS.ProcessEnv;
    readonly platform: string;
    readonly versions: { readonly node: string };
    cwd(): string;
}

/** The real ports of one run, and the terminal to close at its end. */
export function nodePorts(proc: NodeProcess, packageDir: string): { readonly ports: Ports; readonly terminal: LineTerminal } {
    const terminal = new LineTerminal(proc.stdin, proc.stdout);
    const runner = new ProcessRunner(terminal, proc.env);
    const env: Env = { platform: proc.platform, lang: proc.env['LANG'], cwd: proc.cwd(), nodeVersion: proc.versions.node };
    const ports: Ports = {
        runner,
        opener: new PlatformOpener(runner, proc.platform),
        terminal,
        files: (dir) => new FolderFiles(resolve(env.cwd, dir), packageDir),
        clock: realClock,
        env,
    };
    return { ports, terminal };
}
