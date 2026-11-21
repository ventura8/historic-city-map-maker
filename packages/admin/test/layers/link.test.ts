import { describe, expect, it } from 'vitest';

import { EMPTY_LINK_FORM, linkCheck, linkRequestOf, sourceOf, type LinkForm } from '../../src/layers/link.js';

const FORM: LinkForm = { ...EMPTY_LINK_FORM, address: 'e2e-user.plan-1911', labelRo: 'Planul 1911', year: '1911' };

describe('the Link form', () => {
    it('happyPath_aTilesetIdWithOrWithoutItsSchemeIsAMapboxSource', () => {
        expect(sourceOf('mapbox://e2e-user.plan-1911', 256)).toEqual({ type: 'mapbox', tilesetId: 'e2e-user.plan-1911' });
        expect(sourceOf(' e2e-user.plan-1911 ', 512)).toEqual({ type: 'mapbox', tilesetId: 'e2e-user.plan-1911' });
        expect(sourceOf('https://tiles.example.test/{z}/{x}/{y}.png', 512)).toEqual({
            type: 'xyz',
            tiles: ['https://tiles.example.test/{z}/{x}/{y}.png'],
            tileSize: 512,
        });
    });

    it('happyPath_theRequestTrimsTheTextsAndLeavesOutTheEmptyOnes', () => {
        expect(linkRequestOf('bucharest', { ...FORM, labelEn: ' 1911 plan ', attribution: ' Arhiva ' })).toEqual({
            cityId: 'bucharest',
            source: { type: 'mapbox', tilesetId: 'e2e-user.plan-1911' },
            label: { ro: 'Planul 1911', en: '1911 plan' },
            year: 1911,
            kind: 'map',
            attribution: 'Arhiva',
        });
        expect(linkRequestOf('bucharest', FORM)).not.toHaveProperty('attribution');
    });

    it('happyPath_theCitysTilesetPassesAndATileServerNamesItsOrigins', () => {
        expect(linkCheck('bucharest', FORM, 'e2e-user')).toMatchObject({ ok: true, origins: [] });
        const xyz = linkCheck('bucharest', { ...FORM, address: 'https://tiles.example.test/plan/{z}/{x}/{y}.png' }, null);
        expect(xyz).toMatchObject({ ok: true, origins: ['https://tiles.example.test'] });
    });

    it('badPath_anInvalidAddressYearOrNameIsNamedAtItsField', () => {
        const check = linkCheck('bucharest', { ...FORM, address: 'not a tileset', year: '19x', labelRo: '' }, 'e2e-user');

        expect(check.ok).toBe(false);
        expect(check.ok ? [] : check.issues.map((issue) => issue.path)).toEqual(expect.arrayContaining(['address', 'label.ro', 'year']));
    });

    it('badPath_anotherAccountsTilesetIsRefusedBeforeTheServerIsAsked', () => {
        const check = linkCheck('bucharest', { ...FORM, address: 'anotheraccount.plan' }, 'e2e-user');

        expect(check).toEqual({
            ok: false,
            issues: [{ path: 'address', code: 'validation.value' }],
            refusal: { code: 'apiError.layers.foreignTileset', params: { owner: 'anotheraccount' } },
        });
    });
});
