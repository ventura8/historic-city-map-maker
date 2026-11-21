/**
 * The city file of `scripts/seed/` (`docs/research/M8-join-interfaces.md` §5): it holds the years a new Bucharest setup
 * starts with, in the shape the city document takes, and only under `imagery`: the viewer's manifest never holds them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { cityImagerySchema } from '../../src/schemas/imagery-settings.js';
import { citySchema } from '../../src/schemas/manifest.js';

const SEED = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../../../scripts/seed/bucharest.city.json'), 'utf8')) as Record<string, unknown>;

describe('scripts/seed/bucharest.city.json', () => {
    it('happyPath_holdsTheTargetYears', () => {
        expect(cityImagerySchema.parse(SEED['imagery'])).toEqual({ targetYears: [1966, 1972, 1976, 1977, 1978, 1979, 1980, 1982, 1983, 1984] });
    });

    it('badPath_theViewersCitySchemaRefusesThem', () => {
        expect(Object.keys(citySchema.shape)).not.toContain('imagery');
    });
});
