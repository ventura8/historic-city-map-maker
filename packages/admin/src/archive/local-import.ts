/**
 * Batch 4 (the owner, 2026-11-09: "no new tab"; `docs/research/M20-import-local.md` §2.1, §16): Import local files from the admin's own
 * Imagery tab. The owner picks a folder or a zip there and the admin streams it to the city's worker on this computer's loopback
 * (`http://127.0.0.1:8765`, which the admin's Content-Security-Policy lists; the worker answers CORS and Private Network Access for the
 * project's Hosting origins only). It first asks the worker for a session token (`POST /import/session`, given only while the worker is
 * paired and signed in for this city), then creates the archive, sends each file with its relative path, has a zip read in place,
 * starts the scan and follows it until the worker reported it to the server, whose archive the card then opens. Progress is a share
 * of the bytes sent, then of the files the scan read; Cancel aborts what is in flight and asks the worker to drop the archive.
 */
import { WORKER_PORT } from '@hcm/shared';

import type { Clock } from '../app/ports.js';
import { LOCAL_IDLE, type LocalAnswer, type LocalFile, type LocalImportState, type LocalTransport } from './local-state.js';

export const LOCAL_WORKER = `http://127.0.0.1:${String(WORKER_PORT)}`;
/** How often the scan's state is asked for. */
export const SCAN_POLL_MS = 1000;
const CREATED = 201;
const ACCEPTED = 202;
const OK = 200;

/** What an import needs of the city and the card. */
export interface LocalImportRequest {
    readonly city: string;
    readonly latitude: number | null;
    readonly name: string;
    readonly source: 'folder' | 'zip';
    readonly files: readonly LocalFile[];
}

class Stopped extends Error {
    constructor(readonly code: string) {
        super(code);
    }
}

function textOf(body: Readonly<Record<string, unknown>>, key: string): string {
    const value = body[key];
    return typeof value === 'string' ? value : '';
}

function countOf(body: Readonly<Record<string, unknown>>, key: string): number {
    const value = body[key];
    return typeof value === 'number' ? value : 0;
}

function percentOf(done: number, total: number): number {
    return total > 0 ? Math.min(100, Math.floor((done / total) * 100)) : 0;
}

/** One import at a time; `changed` hears every step. */
export class LocalImport {
    readonly #transport: LocalTransport;
    readonly #clock: Clock;
    readonly #changed: (state: LocalImportState) => void;
    #abort: AbortController | null = null;
    #archiveId: string | null = null;
    #headers: Readonly<Record<string, string>> = {};

    constructor(transport: LocalTransport, clock: Clock, changed: (state: LocalImportState) => void) {
        this.#transport = transport;
        this.#clock = clock;
        this.#changed = changed;
    }

    /** Sends, scans and follows; resolves when it is done, failed or cancelled. */
    async run(request: LocalImportRequest): Promise<void> {
        const abort = new AbortController();
        this.#abort = abort;
        this.#archiveId = null;
        try {
            await this.#steps(request, abort.signal);
        } catch (error) {
            this.#ended(abort, error);
        }
    }

    /** Stops what is in flight; the worker drops the archive. */
    async cancel(): Promise<void> {
        const abort = this.#abort;
        if (abort === null) {
            return;
        }
        this.#abort = null;
        abort.abort();
        this.#changed({ ...LOCAL_IDLE, phase: 'cancelled' });
        const archiveId = this.#archiveId;
        if (archiveId !== null) {
            const signal = new AbortController().signal;
            await this.#transport.json(`/import/${archiveId}/cancel`, {}, this.#headers, signal).catch(() => undefined);
        }
    }

    #ended(abort: AbortController, error: unknown): void {
        if (abort.signal.aborted) {
            return;
        }
        this.#abort = null;
        this.#changed({ ...LOCAL_IDLE, phase: 'failed', error: error instanceof Stopped ? error.code : 'unreachable' });
    }

    async #steps(request: LocalImportRequest, signal: AbortSignal): Promise<void> {
        await this.#session(request.city, signal);
        const archiveId = await this.#create(signal);
        await this.#send(archiveId, request.files, signal);
        if (request.source === 'zip') {
            await this.#post(`/import/${archiveId}/zip`, { path: request.files[0]?.path ?? '' }, OK, signal);
        }
        const scan = { name: request.name, source: request.source, ...(request.latitude === null ? {} : { latitude: request.latitude }) };
        await this.#post(`/import/${archiveId}/scan`, scan, ACCEPTED, signal);
        await this.#follow(archiveId, signal);
    }

    async #post(path: string, body: unknown, expected: number, signal: AbortSignal): Promise<LocalAnswer> {
        const answer = await this.#transport.json(path, body, this.#headers, signal);
        if (answer.status !== expected) {
            throw new Stopped(textOf(answer.body, 'error') || 'refused');
        }
        return answer;
    }

    async #session(city: string, signal: AbortSignal): Promise<void> {
        this.#changed({ ...LOCAL_IDLE, phase: 'upload' });
        this.#headers = {};
        const answer = await this.#post('/import/session', { city }, CREATED, signal);
        this.#headers = { 'x-hcm-session': textOf(answer.body, 'token') };
    }

    async #create(signal: AbortSignal): Promise<string> {
        const answer = await this.#post('/import/new', {}, CREATED, signal);
        const archiveId = textOf(answer.body, 'archiveId');
        this.#archiveId = archiveId;
        return archiveId;
    }

    async #send(archiveId: string, files: readonly LocalFile[], signal: AbortSignal): Promise<void> {
        const total = files.reduce((sum, each) => sum + each.file.size, 0);
        let sent = 0;
        for (const [index, each] of files.entries()) {
            const progress = (loaded: number): void => {
                this.#changed({
                    ...LOCAL_IDLE,
                    phase: 'upload',
                    percent: percentOf(sent + loaded, total),
                    done: index,
                    total: files.length,
                });
            };
            const headers = { ...this.#headers, 'x-hcm-path': encodeURIComponent(each.path) };
            const status = await this.#transport.upload({ path: `/import/${archiveId}/file`, file: each.file, headers, signal, progress });
            if (status !== CREATED) {
                throw new Stopped('refused');
            }
            sent += each.file.size;
            progress(0);
        }
    }

    /** The scan's state, asked every `SCAN_POLL_MS` until it reported, failed or was cancelled. */
    async #follow(archiveId: string, signal: AbortSignal): Promise<void> {
        for (;;) {
            const answer = await this.#transport.json(`/import/${archiveId}`, null, {}, signal);
            const state = textOf(answer.body, 'state');
            if (state !== 'scanning') {
                this.#finished(state, answer.body);
                return;
            }
            const [done, total] = [countOf(answer.body, 'read'), countOf(answer.body, 'total')];
            this.#changed({ ...LOCAL_IDLE, phase: 'scan', percent: percentOf(done, total), done, total });
            await this.#wait(signal);
        }
    }

    #finished(state: string, body: Readonly<Record<string, unknown>>): void {
        this.#abort = null;
        if (state === 'reported') {
            this.#changed({ ...LOCAL_IDLE, phase: 'done', percent: 100 });
            return;
        }
        this.#changed({ ...LOCAL_IDLE, phase: state === 'cancelled' ? 'cancelled' : 'failed', error: textOf(body, 'error') || null });
    }

    #wait(signal: AbortSignal): Promise<void> {
        return new Promise((resolve, reject) => {
            const timer = this.#clock.setTimeout(resolve, SCAN_POLL_MS);
            signal.addEventListener('abort', () => {
                this.#clock.clearTimeout(timer);
                reject(new Stopped('cancelled'));
            });
        });
    }
}
