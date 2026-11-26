/** A photo's improved and colorized versions travel with the export (the owner 2026-11-09), each beside the image. */
import type { Manifest, Photo } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { exportSources } from '../../src/export/page.js';
import { planExport } from '../../src/export/plan.js';
import { KIT_PAGE, publishedManifest } from './world.js';

const PREFIX = 'https://storage.googleapis.com/demo-hcm-public/';

function withVersions(manifest: Manifest, versions: Photo['versions']): Manifest {
    const [first, ...rest] = manifest.photos;
    return first === undefined ? manifest : { ...manifest, photos: [{ ...first, versions }, ...rest] };
}

function plan(manifest: Manifest) {
    return planExport({
        manifest,
        publicPrefix: PREFIX,
        rasters: [],
        archives: [],
        kitPage: KIT_PAGE,
        kitReadme: '# Kit',
        engine: [],
        madeAt: new Date('2026-11-09T00:00:00.000Z'),
    });
}

describe('planExport: photo versions', () => {
    it('happyPath_aBucketVersionIsCopiedBesideTheImage', () => {
        const colorized = { web: `${PREFIX}photos/x/c/web.webp`, thumb: `${PREFIX}photos/x/c/thumb.webp`, w: 4, h: 3, credit: 'Ana' };
        const exported = plan(withVersions(publishedManifest(), { colorized }));
        const cityFile = exported.entries.find((entry) => entry.name === 'city.json');
        const city = JSON.parse(cityFile?.source.kind === 'text' ? cityFile.source.text : '{}') as Manifest;
        const [first] = city.photos;

        expect(first?.versions).toEqual({
            colorized: {
                web: `photos/${first?.id ?? ''}/colorized-web.webp`,
                thumb: `photos/${first?.id ?? ''}/colorized-thumb.webp`,
                w: 4,
                h: 3,
                credit: 'Ana',
            },
        });
        expect(exported.entries.map((entry) => entry.name)).toContain(`photos/${first?.id ?? ''}/colorized-web.webp`);
    });

    it('badPath_aVersionOutsideTheBucketStaysWhereItIsAndThePageAllowsIt', () => {
        const improved = { web: 'https://elsewhere.example.test/w.webp', thumb: 'https://elsewhere.example.test/t.webp', w: 4, h: 3 };
        const manifest = withVersions(publishedManifest(), { improved });

        const exported = plan(manifest);

        expect(exported.entries.map((entry) => entry.name).filter((name) => name.includes('improved'))).toEqual([]);
        expect(exportSources(manifest).images).toContain('https://elsewhere.example.test');
    });
});
