/** V92: the Licence and citation panel's rules (`licence.ts`) and the panel itself (`<hcm-licence-panel>`). */
import { translate, type Layer, type Photo } from '@hcm/shared';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { HCM_LICENCE_PANEL_TAG, defineHcmLicencePanel, type HcmLicencePanel } from '../../src/viewer/hcm-licence-panel.js';
import { accessDate, citation, isPublicDomainLayer, layerDownload, layerLink, licenceCounts } from '../../src/viewer/licence.js';
import { menuAction } from '../../src/viewer/viewer-actions.js';
import { menuItem } from '../../src/viewer/viewer-menu.js';
import { defineKitDoubles, mountElement, shadowQuery, shadowQueryAll, shadowText } from './doubles.js';
import { FakeStore, readyState } from './fake-store.js';
import { TEST_MANIFEST_URL, testManifest } from './fixtures.js';
import { fakeServices } from './viewer-harness.js';

const BASE = 'https://map.example.org/';
const MANIFEST = 'https://storage.example.org/cities/x/manifest.json';
const NOW = new Date(Date.UTC(2026, 10, 23, 12));
const HREF = 'https://map.example.org/#14/44.43/26.1&layers=kh4-1966&lang=en';

function layer(attribution: string, source: Layer['source']): Pick<Layer, 'attribution' | 'source'> {
    return { attribution, source };
}

describe('licence rules', () => {
    it('happyPath_ourUsgsLayersArePublicDomainAndOfferTheirArchive', () => {
        const ours = layer('USGS EROS, declassified imagery (public domain)', { type: 'pmtiles', url: 'tiles/kh9.pmtiles' });
        expect(isPublicDomainLayer(ours)).toBe(true);
        expect(layerDownload(ours, MANIFEST, BASE)).toEqual({
            kind: 'pmtiles',
            url: 'https://storage.example.org/cities/x/tiles/kh9.pmtiles',
        });
        const landsat = layer('Landsat imagery courtesy of NASA', { type: 'mapbox', tilesetId: 'owner.landsat' });
        expect(layerDownload(landsat, MANIFEST, BASE)).toEqual({ kind: 'planned' });
    });

    it('badInput_aThirdPartyScanNeverOffersADownload', () => {
        const scan = layer('David Rumsey Map Collection (CC BY-NC-SA)', { type: 'pmtiles', url: 'tiles/socec.pmtiles' });
        expect(isPublicDomainLayer(scan)).toBe(false);
        expect(layerDownload(scan, MANIFEST, BASE)).toEqual({ kind: 'none' });
        const unresolvable = layer('USGS', { type: 'pmtiles', url: 'tiles/a.pmtiles' });
        expect(layerDownload(unresolvable, 'https://[bad', 'not a url')).toEqual({ kind: 'planned' });
    });

    it('happyPath_countsPhotosPerLicenceMostCommonFirst', () => {
        const photos = [{ license: 'PD' }, { license: 'CC-BY-4.0' }, { license: 'PD' }, { license: 'CC0' }] as Photo[];
        expect(licenceCounts(photos)).toEqual([
            ['PD', 2],
            ['CC-BY-4.0', 1],
            ['CC0', 1],
        ]);
    });

    it('happyPath_aLayersLinkNamesItAlone', () => {
        expect(layerLink(HREF, 'kh9-1977')).toBe('https://map.example.org/#14/44.43/26.1&lang=en&layers=kh9-1977');
        expect(layerLink('https://map.example.org/', 'a')).toBe('https://map.example.org/#layers=a');
    });

    it('happyPath_theCitationNamesTitleMapAddressAndDay', () => {
        const date = accessDate(NOW, 'en');
        expect(date).toBe('November 23, 2026');
        expect(citation({ title: 'KH-9 (1977)', map: 'Bucharest', url: HREF, date }, 'en')).toBe(
            `KH-9 (1977). Bucharest. ${HREF} (accessed November 23, 2026).`,
        );
    });
});

describe('<hcm-licence-panel> @S-V92-HAPPY-PANEL', () => {
    beforeAll(() => {
        defineKitDoubles();
        defineHcmLicencePanel();
    });

    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    async function mount(): Promise<HcmLicencePanel> {
        const manifest = testManifest((raw) => {
            const layers = raw['layers'] as Record<string, unknown>[];
            layers.push({
                ...layers[0],
                id: 'scan-1900',
                year: 1900,
                attribution: 'Archive X',
                label: { ro: 'Plan 1900', en: 'Plan 1900' },
            });
            if (layers[0] !== undefined) {
                layers[0]['source'] = { type: 'pmtiles', url: 'tiles/kh9.pmtiles' };
            }
        });
        return mountElement<HcmLicencePanel>(HCM_LICENCE_PANEL_TAG, {
            manifest,
            manifestUrl: TEST_MANIFEST_URL,
            locale: 'en',
            href: HREF,
            now: NOW,
        });
    }

    it('happyPath_statesEachLayersRightsAndItsDownload', async () => {
        const panel = await mount();
        expect(shadowQueryAll(panel, 'li[data-layer]').map((row) => row.dataset['layer'])).toEqual(['scan-1900', 'kh4-1966', 'kh9-1977']);
        expect(shadowQuery(panel, 'li[data-layer="kh9-1977"] a[data-download="pmtiles"]').getAttribute('href')).toMatch(
            /tiles\/kh9\.pmtiles$/,
        );
        expect(shadowQuery(panel, 'li[data-layer="kh4-1966"] [data-download]').dataset['download']).toBe('planned');
        expect(shadowQuery(panel, 'li[data-layer="scan-1900"] [data-download]').dataset['download']).toBe('none');
        expect(shadowText(panel)).toContain(translate('en', 'licence.layerSource'));
        expect(shadowQuery(panel, 'textarea').getAttribute('data-cite-text')).toBe('view');
        expect((shadowQuery(panel, 'textarea') as HTMLTextAreaElement).value).toContain(`${HREF} (accessed November 23, 2026)`);
        expect(shadowQueryAll(panel, 'li[data-licence]').length).toBeGreaterThan(0);
    });

    it('happyPath_copiesACitation', async () => {
        const writeText = vi.fn(() => Promise.resolve());
        vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
        const panel = await mount();
        shadowQuery(panel, '[data-cite="kh9-1977"]').click();
        await vi.waitFor(() => {
            expect(shadowQuery(panel, '[data-cite-status="copied"]')).toBeTruthy();
        });
        expect(writeText).toHaveBeenCalledWith(expect.stringContaining('#14/44.43/26.1&lang=en&layers=kh9-1977'));
    });

    it('badInput_aRefusedClipboardShowsTheCitationToCopyByHand @S-V92-BAD-CLIPBOARD', async () => {
        const writeText = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
        vi.spyOn(navigator, 'clipboard', 'get').mockReturnValue({ writeText } as unknown as Clipboard);
        const panel = await mount();
        shadowQuery(panel, '[data-cite="view"]').click();
        await vi.waitFor(() => {
            expect(shadowQuery(panel, '[data-cite-status="failed"]').textContent).toBe(translate('en', 'cite.copyFailed'));
        });
        expect(shadowQuery(panel, '[data-cite-fallback]').textContent).toContain(HREF);
    });

    it('badInput_withoutAManifestShowsNothingAndReadsThePageAddress', async () => {
        const panel = await mountElement<HcmLicencePanel>(HCM_LICENCE_PANEL_TAG, {});
        expect(shadowText(panel)).toBe('');
        panel.manifest = testManifest((raw) => {
            raw['photos'] = [];
            raw['pois'] = [];
            raw['unplaced'] = [];
        });
        await panel.updateComplete;
        expect((shadowQuery(panel, 'textarea') as HTMLTextAreaElement).value).toContain(location.href);
        expect(shadowQueryAll(panel, 'li[data-licence]')).toHaveLength(0);
    });

    it('happyPath_theMenuOpensIt', () => {
        expect(menuItem('licence', 'en')).toEqual({ value: 'licence', icon: 'copyright', label: translate('en', 'licence.title') });
        const store = new FakeStore(readyState());
        menuAction(store, fakeServices(), 'licence');
        expect(store.getState().sheet).toBe('licence');
    });
});
