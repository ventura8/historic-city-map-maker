import { describe, expect, it } from 'vitest';

import { layerFieldPatch } from '../../src/layers/fields.js';
import { layerDoc } from './fixtures.js';

/** A drawn map's licence and author edited after the import (behaviour A197; the owner, 2026-11-22). */
const CREDIT = 'Ion Ionescu, Plan, 1911 · permission · scan: Biblioteca Națională';
const DRAWN = layerDoc({
    kind: 'map',
    attribution: CREDIT,
    rights: { licence: 'permission', author: 'Ion Ionescu', source: { label: 'Biblioteca Națională' } },
});

describe('layerFieldPatch rights', () => {
    it('happyPath_aNewLicenceSwapsTheAttributionsLicencePart', () => {
        expect(layerFieldPatch(DRAWN, 'rights.licence', 'PD')).toEqual({
            rights: { licence: 'PD', author: 'Ion Ionescu', source: { label: 'Biblioteca Națională' } },
            attribution: 'Ion Ionescu, Plan, 1911 · PD · scan: Biblioteca Națională',
        });
    });

    it('happyPath_notSetRemovesTheRightsAndTheLicencePart', () => {
        expect(layerFieldPatch(DRAWN, 'rights.licence', '')).toEqual({
            rights: undefined,
            attribution: 'Ion Ionescu, Plan, 1911 · scan: Biblioteca Națională',
        });
    });

    it('happyPath_aFirstLicenceLeavesAHandWrittenAttributionAlone', () => {
        const linked = layerDoc({ attribution: 'Arhiva' });
        expect(layerFieldPatch(linked, 'rights.licence', 'CC0')).toEqual({ rights: { licence: 'CC0' }, attribution: 'Arhiva' });
        expect(layerFieldPatch(layerDoc(), 'rights.licence', 'CC0')).toEqual({ rights: { licence: 'CC0' }, attribution: undefined });
    });

    it('happyPath_theAuthorIsTrimmedAndAnEmptyOneRemoved', () => {
        expect(layerFieldPatch(DRAWN, 'rights.author', '  IGA ')).toEqual({
            rights: { licence: 'permission', author: 'IGA', source: { label: 'Biblioteca Națională' } },
        });
        expect(layerFieldPatch(layerDoc({ rights: { licence: 'PD', author: 'IGA' } }), 'rights.author', ' ')).toEqual({
            rights: { licence: 'PD' },
        });
    });

    it('badPath_aLicenceOutsideTheListMeansNoRights', () => {
        expect(layerFieldPatch(DRAWN, 'rights.licence', 'unknown').rights).toBeUndefined();
    });

    it('badPath_anAuthorWithoutRightsChangesNothing', () => {
        expect(layerFieldPatch(layerDoc(), 'rights.author', 'IGA')).toEqual({});
    });
});
