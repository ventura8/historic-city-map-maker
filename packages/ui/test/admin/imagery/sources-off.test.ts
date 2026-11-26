/**
 * M28 (`docs/research/M28-sources.md` §6): Imagery follows the map's sources. Find needs the USGS frames or Landsat; the local
 * import needs "Your scanned maps"; a part that is off says why and links Setup → Sources.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deep, deepAll } from '../shell/fake-app.js';
import { defineImagery, imageryPage, imageryState } from './fixtures.js';

describe('<hcm-imagery-page>: the sources', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_landsatAloneKeepsFind @S-A180-HAPPY-IMAGERY-GATED', async () => {
        const { element } = await imageryPage(imageryState({ sources: { usgs: false, landsat: true, archives: true } }));

        expect(deepAll(element, '[data-sources-off]')).toEqual([]);
        expect(deepAll(element, '.filters')).not.toEqual([]);
    });

    it('badPath_withoutUsgsAndLandsatFindSaysWhyAndLinksSources @S-A180-BAD-IMAGERY-OFF', async () => {
        const { element } = await imageryPage(imageryState({ sources: { usgs: false, landsat: false, archives: true } }));

        const off = deep(element, '[data-sources-off="find"]');
        expect(off.textContent).toContain('Turn one of them on in Setup → Sources.');
        expect(off.querySelector('a')?.getAttribute('href')).toBe('#/setup/sources');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_withoutScannedMapsTheLocalImportIsOff', async () => {
        const { element } = await imageryPage(imageryState({ tab: 'upload', sources: { usgs: true, landsat: true, archives: false } }), {
            params: ['upload'],
        });

        expect(deep(element, '[data-sources-off="archives"]').textContent).toContain('Setup → Sources');
        expect(deepAll(element, 'hcm-archive-panel')).toEqual([]);
    });
});
