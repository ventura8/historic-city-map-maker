import { decodeHash } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { adoptQueryLink, locationOf } from '../../src/core/page-sources.js';
import { initialState, withManifest } from '../../src/core/state.js';
import { applyDecodedHash, hashLimits, unknownToast } from '../../src/core/url-sync.js';
import { manifest } from './fixtures.js';

/** Deep links (the owner, 2026-11-22: `?layer=…#15/…` opened on today). */
describe('deep links', () => {
    const city = manifest();
    const loaded = withManifest(initialState('ro', 'system', 'unknown'), city);

    it('happyPath_aQueryLayerMovesIntoTheHashAndOpensOnItsYear', () => {
        const adopted = adoptQueryLink('?layer=kh9-1980', '#15/44.4275/26.0875');
        expect(adopted).toEqual({ search: '', hash: '#15/44.4275/26.0875&layers=kh9-1980' });
        const { state } = applyDecodedHash(loaded, decodeHash(adopted?.hash ?? '', hashLimits(city)));
        expect(state.year).toBe(1980);
        expect(state.overlays.find((overlay) => overlay.id === 'kh9-1980')?.visible).toBe(true);
    });

    it('happyPath_everyHashParameterInTheQueryInAnyOrder_theHashWins_othersStay', () => {
        expect(
            adoptQueryLink('?utm=x&photo=p1&layers=a,b&story=s&cmp=a&sw=30&labels=streets&near=5&pv=improved&op=a:40', '#15/1/2&photo=p2'),
        ).toEqual({
            search: '?utm=x',
            hash: '#15/1/2&photo=p2&layers=a,b&story=s&cmp=a&sw=30&labels=streets&near=5&pv=improved&op=a%3A40',
        });
    });

    it('badPath_aQueryWithoutHashParametersIsLeftAlone', () => {
        expect(adoptQueryLink('?lang=en', '#15/1/2')).toBeNull();
        expect(adoptQueryLink('', '')).toBeNull();
    });

    it('badPath_anUnknownOrUnpublishedLayerOpensWithoutItAndSaysSo', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#15/44.43/26.1&layers=not-published', hashLimits(city)));
        expect(applied.unknownLayer).toBe('not-published');
        expect(unknownToast(applied)).toBe('error.unknownLayer');
        expect(applied.state.overlays.some((overlay) => overlay.id === 'not-published')).toBe(false);
    });

    it('happyPath_aKnownLayerAsksForNoToast', () => {
        const applied = applyDecodedHash(loaded, decodeHash('#15/44.43/26.1&layers=kh4-1966', hashLimits(city)));
        expect(applied.unknownLayer).toBeUndefined();
        expect(unknownToast(applied)).toBeNull();
        expect(applied.state.year).toBe(1966);
    });

    it('happyPath_thePageAddressAdoptsItsQueryLinkOnceAtMount', () => {
        const page = {
            location: { pathname: '/', search: '?layer=kh9-1980', hash: '#15/1/2' },
            history: {
                state: null,
                replaceState: (_state: unknown, _title: string, url: string) => {
                    const [path = '', hash = ''] = url.split('#');
                    const [, search = ''] = path.split('?');
                    page.location.search = search === '' ? '' : `?${search}`;
                    page.location.hash = `#${hash}`;
                },
            },
        };

        const location = locationOf(page as unknown as Window);

        expect(page.location.search).toBe('');
        expect(location.hash).toBe('#15/1/2&layers=kh9-1980');
    });
});
