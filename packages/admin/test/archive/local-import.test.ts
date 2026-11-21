/**
 * Batch 4: Import local files from the admin's own tab (`packages/admin/src/archive/local-import.ts`, `local-transport.ts`). The worker on
 * the loopback is the external boundary: a fake answers as `pipeline/src/hcm_pipeline/worker/server.py` does.
 */
import { describe, expect, it } from 'vitest';

import { LocalImport, SCAN_POLL_MS, type LocalImportRequest } from '../../src/archive/local-import.js';
import type { LocalAnswer, LocalImportState, LocalTransport, LocalUpload } from '../../src/archive/local-state.js';
import { createLocalImport } from '../../src/archive/local-run.js';
import { loopbackTransport, type XhrLike } from '../../src/archive/local-transport.js';
import { FakeClock } from '../app/fakes.js';

const ARCHIVE = 'ar-0123456789abcdef';

/** The worker as the fake answers it: each path's answers in turn (the last one repeats). */
class FakeWorker implements LocalTransport {
    readonly sent: string[] = [];
    readonly answers = new Map<string, LocalAnswer[]>([
        ['/import/session', [{ status: 201, body: { token: 't'.repeat(64) } }]],
        ['/import/new', [{ status: 201, body: { archiveId: ARCHIVE } }]],
        [`/import/${ARCHIVE}/zip`, [{ status: 200, body: { written: 2, refused: 0 } }]],
        [`/import/${ARCHIVE}/scan`, [{ status: 202, body: { state: 'scanning' } }]],
        [`/import/${ARCHIVE}/cancel`, [{ status: 200, body: { state: 'cancelled' } }]],
        [
            `/import/${ARCHIVE}`,
            [
                { status: 200, body: { state: 'scanning', read: 1, total: 4 } },
                { status: 200, body: { state: 'reported', series: 1 } },
            ],
        ],
    ]);
    uploadStatus = 201;
    unreachable = false;
    hold: Promise<void> | null = null;

    async json(path: string, body: unknown, headers: Readonly<Record<string, string>>, signal: AbortSignal): Promise<LocalAnswer> {
        this.sent.push(`${body === null ? 'GET' : 'POST'} ${path} ${headers['x-hcm-session'] === undefined ? '-' : 'session'}`);
        if (this.unreachable) {
            throw new Error('unreachable');
        }
        const queue = this.answers.get(path) ?? [{ status: 404, body: {} }];
        const answer = queue.length > 1 ? queue.shift() : queue[0];
        await Promise.resolve();
        if (signal.aborted) {
            throw new Error('aborted');
        }
        return answer ?? { status: 404, body: {} };
    }

    async upload({ path, file, headers, progress }: LocalUpload): Promise<number> {
        this.sent.push(`UPLOAD ${path} ${headers['x-hcm-path'] ?? ''}`);
        progress(file.size / 2);
        await this.hold;
        return this.uploadStatus;
    }
}

function request(more: Partial<LocalImportRequest> = {}): LocalImportRequest {
    return {
        city: 'bucharest',
        latitude: 44.43,
        name: 'Hărți',
        source: 'folder',
        files: [
            { path: 'Hărți/1911.jpg', file: new Blob(['abcd']) },
            { path: 'Hărți/1962.jpg', file: new Blob(['efgh']) },
        ],
        ...more,
    };
}

function importer(worker: FakeWorker = new FakeWorker()) {
    const clock = new FakeClock();
    const states: LocalImportState[] = [];
    const local = new LocalImport(worker, clock, (state) => states.push(state));
    return { local, clock, states, worker };
}

async function flush(): Promise<void> {
    for (let index = 0; index < 100; index += 1) {
        await Promise.resolve();
    }
}

describe('the admin tab’s import of local files', () => {
    it('happyPath_aFolderIsSentWithItsProgressScannedAndFollowedToItsReport @S-A121-HAPPY-LOCAL-TAB', async () => {
        const { local, clock, states, worker } = importer();

        const run = local.run(request());
        await flush();
        clock.advance(SCAN_POLL_MS);
        await run;

        expect(worker.sent).toEqual([
            'POST /import/session -',
            'POST /import/new session',
            `UPLOAD /import/${ARCHIVE}/file H%C4%83r%C8%9Bi%2F1911.jpg`,
            `UPLOAD /import/${ARCHIVE}/file H%C4%83r%C8%9Bi%2F1962.jpg`,
            `POST /import/${ARCHIVE}/scan session`,
            `GET /import/${ARCHIVE} -`,
            `GET /import/${ARCHIVE} -`,
        ]);
        expect(states.filter((state) => state.phase === 'upload').map((state) => state.percent)).toEqual([0, 25, 50, 75, 100]);
        expect(states).toContainEqual({ phase: 'scan', percent: 25, done: 1, total: 4, error: null });
        expect(states.at(-1)).toEqual({ phase: 'done', percent: 100, done: 0, total: 0, error: null });
    });

    it('happyPath_aZipIsReadInPlaceAndAScanWithoutALatitudeLeavesItOut', async () => {
        const { local, clock, worker, states } = importer();
        const run = local.run(request({ source: 'zip', latitude: null, files: [{ path: 'harti.zip', file: new Blob(['z']) }] }));
        await flush();
        clock.advance(SCAN_POLL_MS);
        await run;

        expect(worker.sent).toContain(`POST /import/${ARCHIVE}/zip session`);
        expect(states.at(-1)?.phase).toBe('done');
    });

    it.each([
        [
            'a worker not paired for the city',
            (worker: FakeWorker) => worker.answers.set('/import/session', [{ status: 409, body: { error: 'notPaired' } }]),
            'notPaired',
        ],
        ['no worker on the loopback', (worker: FakeWorker) => (worker.unreachable = true), 'unreachable'],
        ['a file the worker refuses', (worker: FakeWorker) => (worker.uploadStatus = 400), 'refused'],
        ['an answer with no reason', (worker: FakeWorker) => worker.answers.set('/import/new', [{ status: 500, body: {} }]), 'refused'],
    ])('badPath_%s_stopsTheImportAndSaysWhy @S-A121-BAD-LOCAL-TAB', async (_name, arrange, error) => {
        const { local, states, worker } = importer();
        arrange(worker);

        await local.run(request());

        expect(states.at(-1)).toEqual({ phase: 'failed', percent: 0, done: 0, total: 0, error });
    });

    it('badPath_aScanThatFailedOrWasCancelledOnTheComputerEndsSo', async () => {
        const failed = importer();
        failed.worker.answers.set(`/import/${ARCHIVE}`, [{ status: 200, body: { state: 'failed', error: 'apiError.internal' } }]);
        await failed.local.run(request());
        const cancelled = importer();
        cancelled.worker.answers.set(`/import/${ARCHIVE}`, [{ status: 200, body: { state: 'cancelled' } }]);
        await cancelled.local.run(request());

        expect(failed.states.at(-1)).toMatchObject({ phase: 'failed', error: 'apiError.internal' });
        expect(cancelled.states.at(-1)).toMatchObject({ phase: 'cancelled', error: null });
    });

    it('badPath_cancelWhileScanningAbortsAndAsksTheWorkerToDropTheArchive @S-A121-BAD-LOCAL-TAB', async () => {
        const { local, states, worker } = importer();
        worker.answers.set(`/import/${ARCHIVE}`, [{ status: 200, body: { state: 'scanning', read: 1, total: 4 } }]);
        const run = local.run(request());
        await flush();

        await local.cancel();
        await run;
        await local.cancel();

        expect(worker.sent.at(-1)).toBe(`POST /import/${ARCHIVE}/cancel session`);
        expect(states.at(-1)?.phase).toBe('cancelled');
        expect(states.filter((state) => state.phase === 'cancelled')).toHaveLength(1);
    });

    it('badPath_cancelBeforeAnArchiveExistsAsksNothingOfTheWorker', async () => {
        const worker = new FakeWorker();
        const { local, states } = importer(worker);
        const run = local.run(request());

        await local.cancel();
        await run;

        expect(worker.sent).toEqual(['POST /import/session -']);
        expect(states.at(-1)?.phase).toBe('cancelled');
    });
});

/** An `XMLHttpRequest` that answers at once, or fails. */
class FakeXhr implements XhrLike {
    static readonly world: { last: FakeXhr | null; outcome: 'load' | 'error' | 'abort' } = { last: null, outcome: 'load' };
    status = 0;
    responseText = '';
    #progress: ((event: { readonly loaded: number }) => void) | null = null;
    readonly upload: XhrLike['upload'] = {
        addEventListener: (_type, listener) => {
            this.#progress = listener;
        },
    };
    readonly #on = new Map<string, () => void>();
    opened = '';
    readonly headers: Record<string, string> = {};
    body: Blob | string | null = null;
    aborted = false;

    constructor(readonly reply: { status: number; text: string }) {
        FakeXhr.world.last = this;
    }

    addEventListener(type: 'load' | 'error' | 'abort', listener: () => void): void {
        this.#on.set(type, listener);
    }

    open(method: string, url: string): void {
        this.opened = `${method} ${url}`;
    }

    setRequestHeader(name: string, value: string): void {
        this.headers[name] = value;
    }

    send(body: Blob | string | null): void {
        this.body = body;
        this.#progress?.({ loaded: 3 });
        if (FakeXhr.world.outcome === 'load') {
            this.status = this.reply.status;
            this.responseText = this.reply.text;
            this.#on.get('load')?.();
        } else if (FakeXhr.world.outcome === 'error') {
            this.#on.get('error')?.();
        }
    }

    abort(): void {
        this.aborted = true;
        this.#on.get('abort')?.();
    }
}

describe('the loopback transport', () => {
    it('happyPath_jsonAndAnUploadGoToTheWorkerWithTheirHeadersAndProgress', async () => {
        FakeXhr.world.outcome = 'load';
        const transport = loopbackTransport(() => new FakeXhr({ status: 201, text: '{"archiveId":"ar-1"}' }), 'http://127.0.0.1:8765');
        const signal = new AbortController().signal;

        const posted = await transport.json('/import/new', {}, { 'x-hcm-session': 's' }, signal);
        const post = FakeXhr.world.last;
        const got = await transport.json('/import/ar-1', null, {}, signal);
        const seen: number[] = [];
        const progress = (loaded: number): void => {
            seen.push(loaded);
        };
        const status = await transport.upload({
            path: '/import/ar-1/file',
            file: new Blob(['abc']),
            headers: { 'x-hcm-path': 'a.jpg' },
            signal,
            progress,
        });

        expect(posted).toEqual({ status: 201, body: { archiveId: 'ar-1' } });
        expect([post?.opened, post?.headers['content-type'], post?.body]).toEqual([
            'POST http://127.0.0.1:8765/import/new',
            'application/json',
            '{}',
        ]);
        expect(got.status).toBe(201);
        expect([status, seen, FakeXhr.world.last?.headers['content-type']]).toEqual([201, [3], 'application/octet-stream']);
    });

    it('badPath_anAnswerThatIsNotAnObjectReadsAsEmpty_andAFailureOrAnAbortRejects', async () => {
        FakeXhr.world.outcome = 'load';
        const signal = new AbortController().signal;
        const text = await loopbackTransport(() => new FakeXhr({ status: 200, text: 'not json' })).json('/x', null, {}, signal);
        const list = await loopbackTransport(() => new FakeXhr({ status: 200, text: '[1]' })).json('/x', null, {}, signal);
        expect([text.body, list.body]).toEqual([{}, {}]);
        FakeXhr.world.outcome = 'error';
        await expect(loopbackTransport(() => new FakeXhr({ status: 0, text: '' })).json('/x', null, {}, signal)).rejects.toThrow(
            'unreachable',
        );
        FakeXhr.world.outcome = 'abort';
        const abort = new AbortController();
        const aborted = loopbackTransport(() => new FakeXhr({ status: 0, text: '' })).json('/x', null, {}, abort.signal);
        abort.abort();
        await expect(aborted).rejects.toThrow('aborted');
        expect(FakeXhr.world.last?.aborted).toBe(true);
    });
});

describe('the local-run chunk', () => {
    it('happyPath_itMakesAnImportOverTheGivenTransportOrTheBrowsersLoopback', () => {
        const clock = new FakeClock();
        const changed = (): void => undefined;

        expect(createLocalImport(new FakeWorker(), clock, changed)).toBeInstanceOf(LocalImport);
        expect(createLocalImport(undefined, clock, changed)).toBeInstanceOf(LocalImport);
    });
});
