/**
 * Where the scan pane opens (admin sweep 2026-11-14, bug 6): on the first place the pipeline expects the city on a whole frame's scan
 * (`calibration.expected`), else on the whole scan.
 */
import { layerVersionDocSchema } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { georefVersionOf } from '../../src/georef/state.js';
import { versionDoc } from '../imagery/world.js';

describe('georefVersionOf: the opening', () => {
    it('happyPath_aWholeStripOpensOnTheMostVotedExpectedPlace', () => {
        const calibration = {
            how: 'none',
            refusal: 'no-votes',
            expected: [
                { x: 1000, y: 100, width: 2000, height: 500 },
                { x: 11125, y: 100, width: 2000, height: 500 },
            ],
        };
        const doc = layerVersionDocSchema.parse(versionDoc({ calibration }));

        expect(georefVersionOf('v', doc).opening).toEqual({ x: 1000, y: 100, width: 2000, height: 500 });
    });

    it('badPath_noExpectedPlaceOpensTheWholeScan', () => {
        const doc = layerVersionDocSchema.parse(versionDoc());

        expect(georefVersionOf('v', doc).opening).toBeNull();
    });
});
