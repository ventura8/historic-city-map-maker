/** `<hcm-imagery-census>` (M29, `docs/research/M29-imagery-census.md`): waiting, searching, the counts and previews, a failure and Search again. */
import {
    CENSUS_DEBOUNCE_MS,
    defineHcmImageryCensus,
    HCM_IMAGERY_CENSUS_TAG,
    setupCensus,
    type HcmImageryCensus,
} from '../../src/census/hcm-imagery-census.js';
import { intlTag } from '@hcm/shared';
import { translateCensus, type CensusFetch, type CensusKey } from '@hcm/shared/census';
import { render } from 'lit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const BOX = [26.85, 46.53, 26.97, 46.6] as const;
const t = (key: CensusKey, params?: Readonly<Record<string, string>>): string => translateCensus('en', key, params);

const ok = (value: unknown): ReturnType<CensusFetch> => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(value) });

/** One page of `ids` ids per count; a scene in the 1990s only, its preview on the catalogue (or elsewhere: none). */
function catalogue(ids: number, href: string | null = 'https://planetarycomputer.microsoft.com/p.png'): CensusFetch {
    return (_url, init) => {
        const body = JSON.parse(init.body as string) as { fields?: unknown; datetime: string };
        if (body.fields !== undefined) {
            return ok({ features: Array.from({ length: ids }, (_, index) => ({ id: String(index) })) });
        }
        if (!body.datetime.startsWith('1990')) {
            return ok({ features: [] });
        }
        const assets = href === null ? {} : { rendered_preview: { href } };
        return ok({ features: [{ id: 'LT05_L2SP_1', properties: { datetime: '1994-07-01T00:00:00Z', 'eo:cloud_cover': 1 }, assets }] });
    };
}

async function census(fetcher: CensusFetch, usgsLink = ''): Promise<HcmImageryCensus> {
    defineHcmImageryCensus();
    const element = document.createElement(HCM_IMAGERY_CENSUS_TAG);
    element.locale = 'en';
    element.fetcher = fetcher;
    element.usgsLink = usgsLink;
    document.body.append(element);
    await element.updateComplete;
    return element;
}

const text = (element: HcmImageryCensus): string => element.shadowRoot?.textContent ?? '';

async function settle(element: HcmImageryCensus): Promise<void> {
    await vi.advanceTimersByTimeAsync(CENSUS_DEBOUNCE_MS);
    await vi.runAllTimersAsync();
    await element.updateComplete;
}

beforeEach(() => {
    vi.useFakeTimers();
});

afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
});

describe('hcm-imagery-census', () => {
    it('waits for a rectangle, then says it is searching, then shows the counts, the estimate and the previews', async () => {
        const element = await census(catalogue(7), '#/setup/usgs');
        expect(text(element)).toContain(t('census.waiting'));
        element.box = BOX;
        await element.updateComplete;
        expect(element.shadowRoot?.querySelector('[data-census-loading]')?.textContent).toBe(t('census.loading'));
        expect(element.shadowRoot?.querySelector('section')?.getAttribute('aria-busy')).toBe('true');
        await settle(element);
        expect(text(element)).toContain(t('census.landsat', { count: '14' }));
        expect(text(element)).toContain(t('census.declassified'));
        const usd = (value: number): string =>
            new Intl.NumberFormat(intlTag('en'), { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(value);
        expect(text(element)).toContain(`${usd(30)} a frame plus ${usd(5)} an order`);
        expect(element.shadowRoot?.querySelector('a')?.getAttribute('href')).toBe('#/setup/usgs');
        expect(element.shadowRoot?.querySelector('img')?.getAttribute('src')).toBe('https://planetarycomputer.microsoft.com/p.png');
        expect(text(element)).toContain(t('census.preview', { decade: '1990', mission: '5', date: '1994-07-01', cloud: '1' }));
    });

    it('searches once for a burst of edits, and the same rectangle again does not search', async () => {
        const fetcher = vi.fn(catalogue(1));
        const element = await census(fetcher);
        element.box = [1, 2, 3, 4];
        await element.updateComplete;
        element.box = BOX;
        await element.updateComplete;
        await settle(element);
        const calls = fetcher.mock.calls.length;
        expect(calls).toBe(8);
        element.box = [...BOX];
        await settle(element);
        expect(fetcher.mock.calls).toHaveLength(calls);
        element.box = null;
        await element.updateComplete;
        expect(text(element)).toContain(t('census.waiting'));
    });

    it('says when the catalogue has no scene, or no preview, and over the counted pages', async () => {
        const none = await census(() => ok({ features: [] }));
        none.box = BOX;
        await settle(none);
        expect(none.shadowRoot?.querySelector('[data-census-none]')?.textContent).toBe(t('census.none'));
        const bare = await census(catalogue(1, null));
        bare.box = BOX;
        await settle(bare);
        expect(text(bare)).toContain(t('census.noPreview'));
        expect(bare.shadowRoot?.querySelector('a')).toBeNull();
        const more = await census((_url, init) => {
            const body = JSON.parse(init.body as string) as { fields?: unknown };
            return body.fields === undefined ? ok({ features: [] }) : ok({ features: [{ id: 'a' }], links: [{ rel: 'next', body }] });
        });
        more.box = BOX;
        await settle(more);
        expect(text(more)).toContain(t('census.landsatMore', { count: '16' }));
    });

    it('says why the search failed and what to do, and Search again searches', async () => {
        let refuse = true;
        const element = await census((url, init) =>
            refuse ? Promise.resolve({ ok: false, status: 503, json: () => ok({}) }) : catalogue(2)(url, init),
        );
        element.box = BOX;
        await settle(element);
        const alert = element.shadowRoot?.querySelector('[role="alert"]');
        expect(alert?.getAttribute('data-census-failed')).toBe('refused');
        expect(alert?.textContent).toContain(t('census.failed.refused'));
        expect(alert?.textContent).toContain(t('census.failed.help'));
        refuse = false;
        element.shadowRoot?.querySelector('button')?.click();
        await settle(element);
        expect(text(element)).toContain(t('census.landsat', { count: '4' }));
    });

    it('reads an unknown failure as an answer it cannot read, and offline as offline', async () => {
        const odd = await census(() =>
            Promise.resolve({
                get ok(): boolean {
                    throw new Error('odd');
                },
                status: 200,
                json: () => Promise.resolve({}),
            }),
        );
        odd.box = BOX;
        await settle(odd);
        expect(odd.shadowRoot?.querySelector('[data-census-failed]')?.getAttribute('data-census-failed')).toBe('unreadable');
        const offline = await census(() => Promise.reject(new TypeError('Failed to fetch')));
        offline.box = BOX;
        await settle(offline);
        expect(text(offline)).toContain(t('census.failed.offline'));
    });

    it('drops a search the rectangle outdated, and a search cut short by leaving', async () => {
        const element = await census(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => {
                        reject(new DOMException('aborted', 'AbortError'));
                    });
                }),
        );
        element.box = BOX;
        await element.updateComplete;
        await vi.advanceTimersByTimeAsync(CENSUS_DEBOUNCE_MS);
        element.remove();
        await vi.runAllTimersAsync();
        expect(element.state.kind).toBe('loading');
    });

    it('renders in Setup only with a rectangle', () => {
        const host = document.createElement('div');
        render(setupCensus({ ready: false, cityBBox: null }, 'en'), host);
        render(setupCensus({ ready: true, cityBBox: BOX }, 'en'), host);
        expect(host.querySelector('hcm-imagery-census')).toBeNull();
        render(setupCensus({ ready: false }, 'en'), host);
        expect(host.querySelector('hcm-imagery-census')).toBeNull();
        render(setupCensus({ ready: false, cityBBox: BOX }, 'ro'), host);
        expect(host.querySelector('hcm-imagery-census')?.getAttribute('usgs-link')).toBe('#/setup/usgs');
    });
});
