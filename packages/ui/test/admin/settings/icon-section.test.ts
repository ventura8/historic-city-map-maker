/**
 * Settings → Browser tab icon (`packages/ui/src/admin/settings/icon-section.ts`; S-A101-*): the current icon and
 * whether it is the default or an upload, Upload an image (the picker's file goes to `setIcon` as base64, or its refusal to `refuseIcon`), Use the default for an
 * upload, the busy state and a refusal, in both languages, and nothing that writes for a revoked admin.
 */
import { timestampFromDate, type CityDoc } from '@hcm/shared';
import { DEFAULT_FAVICON_DATA_URL } from '@hcm/shared/tab-icon';
import { axeViolations } from '@hcm/test-support/axe';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { iconPreviewUrl } from '../../../src/admin/settings/icon-section.js';
import { ICON_CARD_CHUNK, lazyIconCard, type IconCardChunk } from '../../../src/admin/settings/lazy-icon.js';
import { chunkLoader } from '../../../src/admin/imagery/orders/lazy-card.js';
import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cityDoc, page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, defineAll, updated } from '../shell/fake-app.js';

const CUSTOM: NonNullable<CityDoc['icon']> = {
    source: 'custom',
    url: 'https://storage.googleapis.com/demo-hcm-public/cities/bucharest/icon-180.png',
    sha256: 'abcdef12'.repeat(8),
    updatedBy: 'u-editor',
    updatedAt: timestampFromDate(new Date('2026-11-08T08:00:00.000Z')),
};

function iconState(icon: CityDoc['icon'], patch: Partial<SettingsViewState> = {}): SettingsViewState {
    const base = settingsState();
    const data = icon === undefined ? cityDoc() : cityDoc({ icon });
    const doc = base.city.doc === null ? null : { ...base.city.doc, data };
    return { ...base, section: 'icon', city: { ...base.city, doc }, ...patch };
}

function area(state: SettingsViewState): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, {
        setIcon: Promise.resolve(true),
    });
}

function buttons(element: HTMLElement): HTMLElement[] {
    return deepAll(element, '[data-section="icon"] hcm-button');
}

describe('iconPreviewUrl', () => {
    it('happyPath_theUploadIsVersionedByItsHashAndTheDefaultIsInlined', () => {
        expect(iconPreviewUrl(CUSTOM)).toBe(`${CUSTOM.url}?v=abcdef12`);
        expect(iconPreviewUrl(undefined)).toBe(DEFAULT_FAVICON_DATA_URL);
    });
});

describe('<hcm-settings-page> browser tab icon', () => {
    beforeAll(async () => {
        defineAll();
        // The card is a chunk of its own: in before the page renders, as a second visit finds it.
        await ICON_CARD_CHUNK.load();
    });
    afterEach(cleanup);

    it('happyPath_theDefaultIsShownAndAnUploadGoesToTheStore @S-A101-HAPPY-UPLOAD', async () => {
        const settings = area(iconState(undefined));
        const { element } = await page('settings', settings, { params: ['icon'] });

        expect(deep(element, '[data-detail-heading]').textContent).toBe('Browser tab icon');
        expect(deep(element, 'img[data-icon-preview]').getAttribute('src')).toBe(DEFAULT_FAVICON_DATA_URL);
        expect(deep(element, '[data-icon-source]').textContent).toBe('Default');
        expect(buttons(element).map((button) => button.textContent.trim())).toEqual(['Upload an image']);

        const input = deep(element, 'input[type="file"]') as HTMLInputElement;
        let opened = false;
        input.addEventListener('click', (event) => {
            opened = true;
            event.preventDefault();
        });
        buttons(element)[0]?.click();
        const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], 'icon.png', { type: 'image/png' });
        const files = new DataTransfer();
        files.items.add(file);
        input.files = files.files;
        input.dispatchEvent(new Event('change'));

        expect(opened).toBe(true);
        await expect.poll(() => settings.named('setIcon')).toEqual(['setIcon {"kind":"upload","image":"iVBORw0KGgo="}']);
        expect(input.value).toBe('');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_anUploadIsTaggedCustomInRomanianAndOffersTheDefault @S-A101-HAPPY-RESET', async () => {
        const settings = area(iconState(CUSTOM));
        const { element } = await page('settings', settings, { params: ['icon'], locale: 'ro' });

        expect(deep(element, '[data-icon-source]').textContent).toBe('Personalizată');
        expect(deep(element, 'img[data-icon-preview]').getAttribute('src')).toBe(`${CUSTOM.url}?v=abcdef12`);
        buttons(element)[1]?.click();

        expect(settings.named('setIcon')).toEqual(['setIcon {"kind":"reset"}']);
    });

    it('badPath_aRefusalShowsBesideTheButtons @S-A101-BAD-SVG', async () => {
        const settings = area(iconState(undefined, { icon: { busy: false, error: { key: 'apiError.cityIcon.badType' } } }));
        const { element } = await page('settings', settings, { params: ['icon'] });

        expect(deep(element, '[data-icon-error]').textContent.trim()).toBe(
            'The icon must be a PNG or WebP image (SVG, JPEG or PDF are not accepted).',
        );
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_whileBusyOrRevokedNothingCanBeSent', async () => {
        const busy = await page('settings', area(iconState(CUSTOM, { icon: { busy: true, error: null } })), { params: ['icon'] });
        const revoked = await page('settings', area(iconState(CUSTOM)), { params: ['icon'], revoked: true });

        expect(buttons(busy.element).map((button) => button.hasAttribute('disabled'))).toEqual([true, true]);
        expect(deep(busy.element, '[data-section="icon"] [role="status"]').textContent.trim()).toBe('Saving the icon…');
        expect(buttons(revoked.element).map((button) => button.hasAttribute('disabled'))).toEqual([true, true]);
    });

    it('badPath_anSvgChosenIsRefusedInTheBrowser @S-A101-BAD-SVG', async () => {
        const settings = area(iconState(undefined));
        const { element } = await page('settings', settings, { params: ['icon'] });
        const input = deep(element, 'input[type="file"]') as HTMLInputElement;
        const files = new DataTransfer();
        files.items.add(new File(['<svg xmlns="http://www.w3.org/2000/svg"/>'], 'icon.png', { type: 'image/png' }));
        input.files = files.files;

        input.dispatchEvent(new Event('change'));

        await expect.poll(() => settings.named('refuseIcon')).toEqual(['refuseIcon {"key":"apiError.cityIcon.badType"}']);
        expect(settings.named('setIcon')).toEqual([]);
    });

    it('badPath_aCancelledPickerSendsNothing', async () => {
        const settings = area(iconState(undefined));
        const { element } = await page('settings', settings, { params: ['icon'] });

        deep(element, 'input[type="file"]').dispatchEvent(new Event('change'));

        expect(settings.named('setIcon')).toEqual([]);
    });
});

describe('the browser tab icon card’s chunk', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    function context(refresh: () => void) {
        const view = iconState(undefined);
        return {
            ...{ locale: 'en' as const, view, intents: null, href: () => '', go: () => undefined, announce: () => undefined },
            ...{ readOnly: false, who: { self: null, people: {} }, refresh },
        };
    }

    it('happyPath_loadingUntilTheChunkIsIn_thenTheCard', async () => {
        let refreshes = 0;
        const chunk = chunkLoader<IconCardChunk>(async () => import('../../../src/admin/settings/icon-section.js'));
        const root = document.createElement('div');
        document.body.append(root);

        render(
            lazyIconCard(
                context(() => (refreshes += 1)),
                chunk,
            ),
            root,
        );
        expect(deepAll(root, 'hcm-loading-indicator')).toHaveLength(1);
        await chunk.load();
        render(
            lazyIconCard(
                context(() => (refreshes += 1)),
                chunk,
            ),
            root,
        );

        expect(refreshes).toBe(1);
        expect(deepAll(root, '[data-section="icon"] img[data-icon-preview]')).toHaveLength(1);
    });

    it('badPath_aFailedFetchSaysSoWithTryAgain', async () => {
        let fetches = 0;
        let refreshes = 0;
        const chunk = chunkLoader<IconCardChunk>(() => {
            fetches += 1;
            return Promise.reject(new Error('offline'));
        });
        const root = document.createElement('div');
        document.body.append(root);

        render(
            lazyIconCard(
                context(() => (refreshes += 1)),
                chunk,
            ),
            root,
        );
        await chunk.load().catch(() => undefined);
        render(
            lazyIconCard(
                context(() => (refreshes += 1)),
                chunk,
            ),
            root,
        );
        expect(deepAll(root, '[role="alert"]')).toHaveLength(1);
        const retry = deep(root, 'hcm-button');
        await updated(retry);
        deep(retry, 'button').click();

        expect(fetches).toBe(2);
        expect(refreshes).toBeGreaterThanOrEqual(2);
    });
});
