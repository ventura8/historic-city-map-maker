/** A static export has no backend (M13, `docs/research/M13-roles.md` §5): no Contribute link, no gallery of photos to place. */
import { describe, expect, it } from 'vitest';

import { planExport } from '../../src/export/plan.js';
import { KIT_PAGE, publishedManifest } from './world.js';

describe('planExport: M13', () => {
    it('badPath_anExportLeavesOutTheContributeLinkAndTheGallery @S-V41-BAD-NO-BACKEND', () => {
        const manifest = publishedManifest();
        const [photo] = manifest.photos;
        const plan = planExport({
            manifest: {
                ...manifest,
                contributeUrl: 'https://demo.web.app/admin/#/contribute/x',
                unplaced: photo === undefined ? [] : [{ ...photo, id: 'lost' }],
            },
            publicPrefix: 'https://storage.googleapis.com/demo-hcm-public/',
            rasters: [],
            archives: [],
            kitPage: KIT_PAGE,
            kitReadme: '# Kit',
            engine: [],
            madeAt: new Date('2026-11-07T00:00:00.000Z'),
        });
        const cityFile = plan.entries.find((entry) => entry.name === 'city.json');
        const text = cityFile?.source.kind === 'text' ? cityFile.source.text : '';
        const city = JSON.parse(text) as Readonly<Record<string, unknown>>;
        expect(Object.keys(city)).not.toContain('contributeUrl');
        expect(Object.keys(city)).not.toContain('unplaced');
    });
});
