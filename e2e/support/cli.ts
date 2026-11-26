import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { expect } from '@playwright/test';

/**
 * `create-historic-city` driven from outside (M5, behaviour V29; docs/research/M5-interfaces.md §4.5): the built
 * `packages/create-historic-city/dist/cli.mjs` (the e2e build makes it) as a child process, answered prompt by prompt,
 * with fake `firebase`, `gcloud` and `xdg-open` first on its `PATH` that record every call and answer from a script.
 * Nothing reaches a network or a real tool: the fakes are the only commands on `PATH`.
 */

const ROOT = resolve(import.meta.dirname, '../..');

/** The CLI as the e2e build leaves it. */
const CLI = resolve(ROOT, 'packages/create-historic-city/dist/cli.mjs');

/** A fake tool's answer to one command line: its exit status and what it prints. */
interface ToolAnswer {
    readonly code?: number;
    readonly stdout?: string;
}

/** Each command line's answers in order; the last one repeats, an unscripted line succeeds and prints nothing. */
export type ToolScript = Readonly<Record<string, readonly ToolAnswer[]>>;

export type FakeTool = 'firebase' | 'gcloud' | 'xdg-open';

/**
 * The source of one fake tool: a Node script (run by this Node, named in its first line) that appends its command line to
 * `calls.log` beside it and answers from `script.json`, counting the calls of each line in `state.json`.
 */
function fakeToolSource(): string {
    return [
        `#!${process.execPath}`,
        "const fs = require('node:fs');",
        "const path = require('node:path');",
        'const line = [path.basename(__filename), ...process.argv.slice(2)].join(" ");',
        "fs.appendFileSync(path.join(__dirname, 'calls.log'), line + '\\n');",
        "const script = JSON.parse(fs.readFileSync(path.join(__dirname, 'script.json'), 'utf8'));",
        "const statePath = path.join(__dirname, 'state.json');",
        "const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};",
        'const answers = script[line] || [];',
        'const index = Math.min(state[line] || 0, Math.max(answers.length - 1, 0));',
        'state[line] = (state[line] || 0) + 1;',
        'fs.writeFileSync(statePath, JSON.stringify(state));',
        'const answer = answers[index] || {};',
        "process.stdout.write(answer.stdout || '');",
        'process.exit(answer.code || 0);',
        '',
    ].join('\n');
}

/** A folder of fake tools (`tools` of them only), answering from `script`. */
export class FakeTools {
    readonly bin: string;

    constructor(bin: string, tools: readonly FakeTool[], script: ToolScript = {}) {
        this.bin = bin;
        mkdirSync(bin, { recursive: true });
        // The fakes are CommonJS scripts without an extension: the repository's own package.json says "module".
        writeFileSync(join(bin, 'package.json'), '{ "type": "commonjs" }\n');
        writeFileSync(join(bin, 'script.json'), JSON.stringify(script));
        for (const tool of tools) {
            writeFileSync(join(bin, tool), fakeToolSource());
            chmodSync(join(bin, tool), 0o755);
        }
    }

    /** Every command line the fakes ran, oldest first. */
    calls(): string[] {
        const log = join(this.bin, 'calls.log');
        return existsSync(log)
            ? readFileSync(log, 'utf8')
                  .split('\n')
                  .filter((line) => line !== '')
            : [];
    }
}

/** One run of the CLI, its output kept, its prompts answered one by one. */
export class CliRun {
    readonly #child: ChildProcessWithoutNullStreams;
    readonly #answered = new Map<string, number>();
    readonly exited: Promise<number>;
    #output = '';

    constructor(args: readonly string[], options: { readonly cwd: string; readonly tools: FakeTools }) {
        // Only the fakes on PATH: no real firebase, gcloud or browser opener can be reached.
        this.#child = spawn(process.execPath, [CLI, ...args], { cwd: options.cwd, env: { PATH: options.tools.bin }, stdio: 'pipe' });
        this.#child.stdout.setEncoding('utf8');
        this.#child.stderr.setEncoding('utf8');
        const keep = (chunk: string): void => {
            this.#output += chunk;
        };
        this.#child.stdout.on('data', keep);
        this.#child.stderr.on('data', keep);
        this.exited = new Promise((done) => {
            this.#child.once('close', (code) => {
                done(code ?? 1);
            });
        });
    }

    get output(): string {
        return this.#output;
    }

    /** Waits for `prompt` to be asked once more than it was answered, then types `line` (a timeout shows the output so far). */
    async answer(prompt: string, line: string): Promise<void> {
        const answered = this.#answered.get(prompt) ?? 0;
        await expect
            .poll(() => this.#output.split(prompt).length - 1, { message: `the CLI asks "${prompt}"; its output so far:\n${this.#output}` })
            .toBeGreaterThan(answered);
        this.#answered.set(prompt, answered + 1);
        this.#child.stdin.write(`${line}\n`);
    }

    /** Ends the input (the end of a terminal session) and resolves the exit status. */
    async end(): Promise<number> {
        this.#child.stdin.end();
        return this.exited;
    }
}

/** Runs the CLI with no input to give and resolves its exit status and output. */
export async function runCli(
    args: readonly string[],
    options: { readonly cwd: string; readonly tools: FakeTools },
): Promise<{ code: number; output: string }> {
    const run = new CliRun(args, options);
    const code = await run.end();
    return { code, output: run.output };
}
