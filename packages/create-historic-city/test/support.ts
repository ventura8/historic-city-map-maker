/**
 * Fakes of the CLI's ports (src/ports.ts) for the unit tests: a scripted terminal, the owner's tools as scripted
 * answers recording every call, an opener recording pages, a clock that records its sleeps; files are real, in a temporary
 * folder, with the package's own files (`template/`, a small `self-host/` bundle) in another.
 */
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { FolderFiles } from '../src/node-ports.js';
import type { Captured, Clock, Env, Opener, Ports, Runner, Terminal } from '../src/ports.js';

export const REPOSITORY = resolve(import.meta.dirname, '../../..');
const TEMPLATE = join(REPOSITORY, 'templates/starter-kit');

class FakeTerminal implements Terminal {
    readonly lines: string[] = [];
    readonly questions: string[] = [];
    readonly #answers: (string | null)[];

    constructor(answers: readonly (string | null)[] = []) {
        this.#answers = [...answers];
    }

    say(line: string): void {
        this.lines.push(line);
    }

    ask(question: string): Promise<string | null> {
        this.questions.push(question);
        return Promise.resolve(this.#answers.length > 0 ? (this.#answers.shift() ?? null) : null);
    }

    get output(): string {
        return this.lines.join('\n');
    }
}

export interface Call {
    readonly mode: 'interactive' | 'capture';
    readonly line: string;
    readonly cwd: string | undefined;
}

/** A tool's scripted answer to one command line: an exit status and what it prints; null: not installed. */
export type Answer = Captured | null;

/** The owner's tools, scripted by command line (`firebase projects:list --json`); every call recorded in order. */
export class FakeRunner implements Runner {
    readonly calls: Call[] = [];
    /** What every captured listing printed, in order (what the CLI read). */
    readonly outputs: string[] = [];
    readonly #script: Map<string, Answer[]>;
    readonly #missing: Set<string>;

    /** `script`: each command line's answers in order (the last one repeats). */
    constructor(script: Readonly<Record<string, readonly Answer[]>> = {}, missing: readonly string[] = []) {
        this.#script = new Map(Object.entries(script).map(([line, answers]): [string, Answer[]] => [line, [...answers]]));
        this.#missing = new Set(missing);
    }

    #answer(command: string, args: readonly string[]): Answer {
        if (this.#missing.has(command)) {
            return null;
        }
        const answers = this.#script.get([command, ...args].join(' ')) ?? [];
        // The last scripted answer repeats; an unscripted line succeeds and prints nothing.
        const [first] = answers;
        if (answers.length > 1) {
            answers.shift();
        }
        return first === undefined ? { code: 0, stdout: '' } : first;
    }

    interactive(command: string, args: readonly string[], cwd?: string): Promise<number | null> {
        this.calls.push({ mode: 'interactive', line: [command, ...args].join(' '), cwd });
        const answer = this.#answer(command, args);
        return Promise.resolve(answer === null ? null : answer.code);
    }

    capture(command: string, args: readonly string[], cwd?: string): Promise<Captured | null> {
        this.calls.push({ mode: 'capture', line: [command, ...args].join(' '), cwd });
        const answer = this.#answer(command, args);
        this.outputs.push(answer?.stdout ?? '');
        return Promise.resolve(answer);
    }

    lines(mode?: Call['mode']): string[] {
        return this.calls.filter((call) => mode === undefined || call.mode === mode).map((call) => call.line);
    }
}

class FakeOpener implements Opener {
    readonly opened: string[] = [];

    open(url: string): Promise<void> {
        this.opened.push(url);
        return Promise.resolve();
    }
}

class FakeClock implements Clock {
    readonly sleeps: number[] = [];

    sleep(ms: number): Promise<void> {
        this.sleeps.push(ms);
        return Promise.resolve();
    }
}

/** A temporary folder, removed by `cleanUp`. */
export function temporaryFolder(): string {
    return mkdtempSync(join(tmpdir(), 'hcm-cli-'));
}

/** The package's own files as the build lays them out: `template/` from templates/starter-kit, a small self-host bundle. */
export function packageFolder(options: { readonly bundle?: boolean } = {}): string {
    const dir = temporaryFolder();
    cpSync(TEMPLATE, join(dir, 'template'), { recursive: true });
    if (options.bundle ?? true) {
        writeBundle(join(dir, 'self-host'));
    }
    return dir;
}

/** A self-host bundle with one file per folder (`build:self-host` writes the real one). */
export function writeBundle(dir: string): void {
    for (const [path, content] of Object.entries({
        'hosting/admin/index.html': '<!doctype html>\n',
        'hosting/admin/install/1-0-0-abc1234/manifest.json': '{ "projectId": "any-project" }\n',
        'hosting/city/index.html': 'connect-src https://us-central1-__HCM_PROJECT_ID__.cloudfunctions.net\n',
        'hosting/city/config.js': '__HCM_PROJECT_ID__-public\n',
        'functions/index.js': 'export {};\n',
        'rules/firestore.rules': "rules_version = '2';\n",
        'firebase.template.json': '{ "hosting": { "site": "__PROJECT_ID__", "public": "hosting" } }\n',
        'bundle.json': '{ "release": "1.0.0+abc1234", "templates": ["city/index.html", "city/config.js"] }\n',
    })) {
        mkdirSync(join(dir, path, '..'), { recursive: true });
        writeFileSync(join(dir, path), content);
    }
}

export interface Fakes {
    readonly ports: Ports;
    readonly terminal: FakeTerminal;
    readonly runner: FakeRunner;
    readonly opener: FakeOpener;
    readonly clock: FakeClock;
    /** The folder the CLI runs in. */
    readonly cwd: string;
}

export interface FakeOptions {
    readonly answers?: readonly (string | null)[];
    readonly runner?: FakeRunner;
    readonly packageDir?: string;
    readonly env?: Partial<Env>;
    /** The folder the CLI runs in (a new temporary folder by default). */
    readonly cwd?: string;
}

export function fakes(options: FakeOptions = {}): Fakes {
    const cwd = options.cwd ?? temporaryFolder();
    const packageDir = options.packageDir ?? packageFolder();
    const terminal = new FakeTerminal(options.answers);
    const runner = options.runner ?? new FakeRunner();
    const opener = new FakeOpener();
    const clock = new FakeClock();
    const env: Env = { platform: 'linux', lang: undefined, cwd, nodeVersion: '24.21.0', ...options.env };
    const ports: Ports = { runner, opener, terminal, files: (dir) => new FolderFiles(resolve(cwd, dir), packageDir), clock, env };
    return { ports, terminal, runner, opener, clock, cwd };
}

export function read(path: string): string {
    return readFileSync(path, 'utf8');
}

export function list(dir: string): string[] {
    return readdirSync(dir, { recursive: true, encoding: 'utf8' }).sort((a, b) => a.localeCompare(b));
}

export function cleanUp(...dirs: readonly string[]): void {
    for (const dir of dirs) {
        rmSync(dir, { recursive: true, force: true });
    }
}
