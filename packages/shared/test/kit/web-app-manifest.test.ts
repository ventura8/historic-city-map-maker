/**
 * The installable app's web app manifest (`packages/shared/src/kit/web-app-manifest.ts`): a standalone app at its own
 * folder, a short name cut at a word, the three PNG icons beside it (one maskable), and what it refuses.
 */
import { describe, expect, it } from 'vitest';

import { APP_ICON_FILES, webAppManifest, webAppManifestText } from '../../src/kit/web-app-manifest.js';

const INPUT = { name: 'București dispărut', folder: './', lang: 'ro', themeColor: '#8B5E3C' };

describe('webAppManifest', () => {
    it('happyPath_aCityIsAStandaloneAppAtItsFolderWithItsIcons', () => {
        expect(webAppManifest(INPUT)).toEqual({
            id: './',
            name: 'București dispărut',
            short_name: 'București dispărut',
            lang: 'ro',
            start_url: './',
            scope: './',
            display: 'standalone',
            theme_color: '#8B5E3C',
            background_color: '#FFFFFF',
            icons: [
                { src: APP_ICON_FILES.small, sizes: '192x192', type: 'image/png' },
                { src: APP_ICON_FILES.large, sizes: '512x512', type: 'image/png' },
                { src: APP_ICON_FILES.maskable, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
            ],
        });
    });

    it.each([
        ['a title cut at a word', 'Bucureștiul de altădată și de azi, în imagini', 'Bucureștiul de altădată'],
        ['one long word cut where it must', 'Bucureștiuldealtădatășideazi', 'Bucureștiuldealtădatășid'],
    ])('happyPath_%s', (_name, name, short) => {
        expect(webAppManifest({ ...INPUT, name }).short_name).toBe(short);
    });

    it.each([
        ['an empty name', { name: '  ' }],
        ['no folder', { folder: '' }],
        ['a colour that is no hex', { themeColor: 'red' }],
    ])('badPath_%s_isRefused', (_name, change) => {
        expect(() => webAppManifest({ ...INPUT, ...change })).toThrow(RangeError);
    });

    it('happyPath_theFileIsIndentedJson', () => {
        expect(JSON.parse(webAppManifestText(INPUT))).toEqual(webAppManifest(INPUT));
        expect(webAppManifestText(INPUT).endsWith('}\n')).toBe(true);
    });
});
