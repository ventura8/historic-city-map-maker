import { DEFAULT_LOCALE } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { ArchiveElement, archiveText, count, sizeText } from '../../../src/admin/archive/archive-element.js';
import type { ArchiveFeedPort, ArchiveHostPort, ArchiveViewPort } from '../../../src/admin/archive/archive-port.js';
import { cleanup, fixture } from '../../helpers.js';
import { updated } from '../shell/fake-app.js';

const EMPTY_VIEW: ArchiveViewPort = {
    status: 'ready',
    failure: null,
    connected: false,
    importUrl: '',
    archives: [],
    open: null,
    edits: {},
    progress: {},
    importing: false,
    result: null,
    refusal: null,
    local: { phase: 'idle', percent: 0, done: 0, total: 0, error: null },
};

class StubFeed implements ArchiveFeedPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: ArchiveViewPort) => void>();

    constructor(public state: ArchiveViewPort = EMPTY_VIEW) {}

    readonly intents = {
        open: (): void => undefined,
        setInclude: (): void => undefined,
        setTitle: (): void => undefined,
        setYear: (): void => undefined,
        confirmRights: (): void => undefined,
        import: (): Promise<boolean> => Promise.resolve(true),
        retry: (): void => undefined,
        importLocal: (): Promise<void> => Promise.resolve(),
        cancelLocal: (): Promise<void> => Promise.resolve(),
    };

    subscribe(listener: (state: ArchiveViewPort) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
            this.calls.push('unsubscribe');
        };
    }

    start(): void {
        this.calls.push('start');
    }

    stop(): void {
        this.calls.push('stop');
    }

    emit(next: ArchiveViewPort): void {
        this.state = next;
        for (const listener of this.#listeners) {
            listener(next);
        }
    }
}

class TestArchiveElement extends ArchiveElement {
    override render(): TemplateResult {
        return html`<p>${this.t('adminArchive.title')}</p>
            <span data-connected=${String(this.view?.connected ?? false)}></span>`;
    }
}

if (customElements.get('hcm-test-archive-element') === undefined) {
    customElements.define('hcm-test-archive-element', TestArchiveElement);
}

async function flush(element: TestArchiveElement): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await updated(element);
}

describe('archive-element helpers', () => {
    it('formats counts, sizes across all units, and archive text', () => {
        expect(archiveText('en', 'adminArchive.title')).toBeTruthy();
        expect(archiveText('ro', 'adminArchive.imported', { today: '2' })).toContain('2');
        expect(count('en', 12345.6)).toBe('12,346');
        expect(sizeText('en', 1_500_000_000)).toContain('1.5');
        expect(sizeText('en', 2_500_000)).toContain('2.5');
        expect(sizeText('en', 12_000)).toContain('12');
        expect(sizeText('en', 512)).toBe('512 byte');
    });
});

describe('ArchiveElement lifecycle', () => {
    afterEach(cleanup);

    it('attaches, receives updates, detaches, and reattaches on reconnect', async () => {
        const feed = new StubFeed();
        const host: ArchiveHostPort = {
            content: { imagery: { intents: { archive: () => Promise.resolve(feed) } } },
        };

        const element = await fixture<TestArchiveElement>(html`<hcm-test-archive-element .app=${host}></hcm-test-archive-element>`);
        await flush(element);

        expect(element.locale).toBe(DEFAULT_LOCALE);
        expect(element.view).toEqual(EMPTY_VIEW);
        expect(feed.calls).toEqual(['start']);

        const nextView: ArchiveViewPort = { ...EMPTY_VIEW, connected: true };
        feed.emit(nextView);
        await updated(element);
        expect(element.view).toEqual(nextView);

        element.locale = 'en';
        await updated(element);
        expect(feed.calls).toEqual(['start']);

        const parent = element.parentElement;
        element.remove();
        expect(feed.calls).toEqual(['start', 'unsubscribe', 'stop']);

        parent?.append(element);
        await flush(element);
        expect(feed.calls).toEqual(['start', 'unsubscribe', 'stop', 'start']);
    });

    it('handles null app, missing imagery, missing archive intent, and rejected archive loader', async () => {
        const noImagery: ArchiveHostPort = { content: { imagery: null } };
        const noArchive: ArchiveHostPort = { content: { imagery: { intents: {} } } };
        const rejected: ArchiveHostPort = {
            content: { imagery: { intents: { archive: () => Promise.reject(new Error('offline')) } } },
        };

        const el0 = await fixture<TestArchiveElement>(html`<hcm-test-archive-element .app=${null}></hcm-test-archive-element>`);
        const el1 = await fixture<TestArchiveElement>(html`<hcm-test-archive-element .app=${noImagery}></hcm-test-archive-element>`);
        const el2 = await fixture<TestArchiveElement>(html`<hcm-test-archive-element .app=${noArchive}></hcm-test-archive-element>`);
        const el3 = await fixture<TestArchiveElement>(html`<hcm-test-archive-element .app=${rejected}></hcm-test-archive-element>`);
        await Promise.all([flush(el0), flush(el1), flush(el2), flush(el3)]);

        expect(el0.view).toBeNull();
        expect(el1.view).toBeNull();
        expect(el2.view).toBeNull();
        expect(el3.view).toBeNull();
    });

    it('ignores a stale attach that resolves after detach', async () => {
        const pending: { resolve?: (feed: ArchiveFeedPort) => void } = {};
        const host: ArchiveHostPort = {
            content: {
                imagery: {
                    intents: {
                        archive: () =>
                            new Promise<ArchiveFeedPort>((resolve) => {
                                pending.resolve = resolve;
                            }),
                    },
                },
            },
        };

        const element = await fixture<TestArchiveElement>(html`<hcm-test-archive-element .app=${host}></hcm-test-archive-element>`);
        element.remove();

        const feed = new StubFeed();
        pending.resolve?.(feed);
        await flush(element);

        expect(feed.calls).toEqual([]);
        expect(element.view).toBeNull();
    });
});
