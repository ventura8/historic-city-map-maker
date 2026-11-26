import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Manifest, Photo } from '@hcm/shared';

import { defineHcmSearch, type HcmSearch } from '../../src/viewer/hcm-search.js';
import type { SearchResult } from '../../src/viewer/viewer-search.js';
import { defineKitDoubles, shadowQuery } from './doubles.js';
import { testManifest } from './fixtures.js';

beforeAll(() => {
    defineKitDoubles();
    defineHcmSearch();
});

function firstPhoto(manifest: Manifest): Photo {
    const photo = manifest.photos[0];
    if (photo === undefined) {
        throw new Error('Expected test manifest to contain at least one photo');
    }
    return photo;
}

async function mountSearch(manifest: Manifest | null = testManifest(), locale: 'ro' | 'en' = 'ro'): Promise<HcmSearch> {
    const el = document.createElement('hcm-search') as HcmSearch;
    el.manifest = manifest;
    el.locale = locale;
    document.body.append(el);
    await el.updateComplete;
    return el;
}

async function typeQuery(el: HcmSearch, value: string): Promise<HTMLInputElement> {
    const input = shadowQuery(el, 'input') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await el.updateComplete;
    return input;
}

describe('<hcm-search>', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_typingShowsResultsAndClickingSelectsOne', async () => {
        const manifest = testManifest();
        const el = await mountSearch(manifest, 'ro');
        const picked: SearchResult[] = [];
        el.addEventListener('hcm-search-select', (event) => {
            picked.push((event as CustomEvent<{ result: SearchResult }>).detail.result);
        });

        const samplePhoto = firstPhoto(manifest);
        await typeQuery(el, samplePhoto.title.ro.slice(0, 4));
        const button = shadowQuery(el, 'button.result');
        button.click();
        await el.updateComplete;

        expect(picked).toHaveLength(1);
        expect(picked[0]?.id).toBe(samplePhoto.id);
        expect(el.renderRoot.querySelector('.results')).toBeNull();
    });

    it('happyPath_keyboardNavigationSelectsAndEscapeCloses', async () => {
        const manifest = testManifest();
        const el = await mountSearch(manifest, 'en');
        const picked: SearchResult[] = [];
        el.addEventListener('hcm-search-select', (event) => {
            picked.push((event as CustomEvent<{ result: SearchResult }>).detail.result);
        });

        const input = await typeQuery(el, firstPhoto(manifest).title.ro.slice(0, 3));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        await el.updateComplete;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        await el.updateComplete;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await el.updateComplete;
        expect(picked).toHaveLength(1);

        input.dispatchEvent(new Event('focus'));
        await el.updateComplete;
        expect(el.renderRoot.querySelector('.results')).not.toBeNull();

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await el.updateComplete;
        expect(el.renderRoot.querySelector('.results')).toBeNull();
    });

    it('badPath_unmatchedQueryShowsEmptyMessageAndClearResets', async () => {
        const el = await mountSearch(testManifest(), 'en');
        await typeQuery(el, 'zzzz-unknown-place');
        expect(shadowQuery(el, '.empty').textContent).toContain('No matches found');

        const clear = shadowQuery(el, 'button.clear');
        clear.click();
        await el.updateComplete;
        expect(el.query).toBe('');
        expect(el.renderRoot.querySelector('.results')).toBeNull();
    });

    it('badPath_nullManifestProducesNoResults', async () => {
        const el = await mountSearch(null, 'ro');
        await typeQuery(el, 'piata');
        expect(shadowQuery(el, '.empty').textContent).toContain('Nu am găsit');
    });
});
