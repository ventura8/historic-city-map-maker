/**
 * What the install builds' step scripts (`docs/research/M6-interfaces.md` §1.4) need from the world, so each is tested
 * over fakes: a command to run with its output (shown live and kept for the retry patterns), Google's REST APIs with
 * the build's own token (the metadata server's: the build runs as `hcm-installer@`, no key and no owner token ever
 * reach it), a file, a clock and the build log. `nodeStepDeps()` is the real world of a Cloud Build step.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { installLogLine, type InstallLogEvent } from '@hcm/shared';

import { readRefusal, type GoogleRefusal } from './google-error.js';

export interface CommandResult {
    readonly code: number;
    /** What the command printed (both streams, at most the last {@link MAX_OUTPUT} characters). */
    readonly output: string;
}

export interface StepDeps {
    /** Runs `command` with `args`, showing its output as it comes. */
    readonly run: (command: string, args: readonly string[]) => Promise<CommandResult>;
    readonly fetch: typeof fetch;
    /** The build's own access token (the metadata server's). */
    readonly token: () => Promise<string>;
    readonly readFile: (path: string) => string;
    readonly sleep: (ms: number) => Promise<void>;
    /** A number in [0, 1): the jitter of a retry's wait. */
    readonly random: () => number;
    /** Writes one line of the build log. */
    readonly log: (line: string) => void;
}

/** The most of a command's output a step keeps. */
export const MAX_OUTPUT = 1_000_000;

/** The metadata server's token of the account the build runs as. */
export const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';

/** Prints an `HCM_INSTALL` event the admin reads back from the build's log. */
export function logEvent(deps: Pick<StepDeps, 'log'>, event: InstallLogEvent): void {
    deps.log(installLogLine(event));
}

/** The token the metadata server gives the build (throws when it gives none). */
export async function metadataToken(fetcher: typeof fetch): Promise<string> {
    const response = await fetcher(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
    const body = response.ok ? ((await response.json()) as { access_token?: unknown }) : {};
    if (typeof body.access_token !== 'string' || body.access_token === '') {
        throw new Error(`the metadata server gave no token (HTTP ${String(response.status)})`);
    }
    return body.access_token;
}

/** Keeps the last `MAX_OUTPUT` characters of `text`. */
export function tail(text: string): string {
    return text.length > MAX_OUTPUT ? text.slice(-MAX_OUTPUT) : text;
}

/** Runs a command, its output both shown and kept. */
export function runCommand(command: string, args: readonly string[]): Promise<CommandResult> {
    return new Promise((resolve) => {
        let output = '';
        const child = spawn(command, [...args], { stdio: ['ignore', 'pipe', 'pipe'] });
        const keep = (chunk: Buffer): void => {
            process.stdout.write(chunk);
            output = tail(output + chunk.toString('utf8'));
        };
        child.stdout.on('data', keep);
        child.stderr.on('data', keep);
        child.on('error', (error) => {
            resolve({ code: 1, output: `${output}${String(error)}` });
        });
        child.on('close', (code) => {
            resolve({ code: code ?? 1, output });
        });
    });
}

/** The real world of a Cloud Build step. */
export function nodeStepDeps(): StepDeps {
    return {
        run: runCommand,
        fetch: globalThis.fetch.bind(globalThis),
        token: () => metadataToken(globalThis.fetch.bind(globalThis)),
        readFile: (path) => readFileSync(path, 'utf8'),
        sleep: (ms) =>
            new Promise((resolve) => {
                setTimeout(resolve, ms);
            }),
        random: Math.random,
        log: (line) => {
            process.stdout.write(`${line}\n`);
        },
    };
}

/** A refused call's body as JSON, or undefined when it is none. */
async function refusalBody(response: Response): Promise<unknown> {
    try {
        return JSON.parse(await response.text()) as unknown;
    } catch {
        return undefined;
    }
}

/** Whole seconds of a `Retry-After` header, or 0. */
function retryAfter(response: Response): number {
    const value = response.headers.get('retry-after') ?? '';
    return /^\d{1,5}$/.test(value) ? Number(value) : 0;
}

/**
 * A Google REST call with the build's token: the JSON answer, or an error naming the call, its status and what Google's
 * error body says (finding 47 of 2026-11-01).
 */
export async function googleJson(deps: Pick<StepDeps, 'fetch'>, token: string, url: string, init: RequestInit = {}): Promise<unknown> {
    const response = await deps.fetch(url, {
        ...init,
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            ...(init.headers as Record<string, string> | undefined),
        },
    });
    if (!response.ok) {
        const refusal = readRefusal(response.status, await refusalBody(response), new URL(url).host);
        throw new GoogleCallError(init.method ?? 'GET', url, response.status, { ...refusal, retryAfterSeconds: retryAfter(response) });
    }
    const text = await response.text();
    return text === '' ? {} : (JSON.parse(text) as unknown);
}

/** What a refused call's body and headers said. */
export interface CallRefusal extends GoogleRefusal {
    /** `Retry-After` in seconds, or 0. */
    readonly retryAfterSeconds: number;
}

/**
 * A refused Google call: its method, address (no query: it never holds the token), status and, when Google said why,
 * its redacted reason (`RESOURCE_EXHAUSTED: …; ErrorInfo RATE_LIMIT_EXCEEDED quota_metric=…`), which the build's log
 * then shows.
 */
export class GoogleCallError extends Error {
    readonly status: number;
    readonly refusal: CallRefusal;

    constructor(method: string, url: string, status: number, refusal: CallRefusal) {
        const reason = refusal.summary === '' ? '' : ` ${refusal.summary}`;
        super(`${method} ${new URL(url).origin}${new URL(url).pathname}: HTTP ${String(status)}${reason}`);
        this.name = 'GoogleCallError';
        this.status = status;
        this.refusal = refusal;
    }
}
