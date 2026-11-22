// V77 (the owner, 2026-11-22): an aerial photo's viewed area, drawn while the photo is selected or hovered.
import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { mapIdle, renderedFeatureIds, screenPointOf } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { openViewer, serveManifest } from '../../support/viewer.js';

const LONE = 'strandul-opereta-1976';
const LONE_VIEW = '16/44.42955/26.09560';

/** A trapezoid north of the photo, corners in order. */
const AREA = [
    { lat: 44.4297, lng: 26.0953 },
    { lat: 44.4312, lng: 26.0945 },
    { lat: 44.4312, lng: 26.0967 },
    { lat: 44.4297, lng: 26.0959 },
];

function withAerialArea(): Json {
    const manifest = siteManifestData();
    const target = (manifest['photos'] as Json[]).find((candidate) => candidate['id'] === LONE) ?? {};
    Object.assign(target, { kind: 'aerial', viewedArea: AREA });
    return manifest;
}

function lonePlace(): readonly [number, number] {
    const manifest = siteManifestData();
    const target = (manifest['photos'] as Json[]).find((candidate) => candidate['id'] === LONE) ?? {};
    const location = target['location'] as { lat: number; lng: number };
    return [location.lng, location.lat];
}

test(
    'Selecting or hovering an aerial photo draws its viewed area',
    { tag: '@S-V77-HAPPY-HOVER' },
    async ({ page, lang }) => {
        await serveManifest(page, withAerialArea());
        await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
        await mapIdle(page);

        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-area-')).toEqual([LONE]);

        await openViewer(page, { lang, hash: LONE_VIEW });
        await mapIdle(page);
        expect(await renderedFeatureIds(page, 'hcm-photos-area-')).toEqual([]);
        const marker = await screenPointOf(page, lonePlace());
        await page.mouse.move(marker.x, marker.y);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-area-')).toEqual([LONE]);
        await page.mouse.move(5, 5);
        await expect.poll(() => renderedFeatureIds(page, 'hcm-photos-area-')).toEqual([]);
    },
);

test('A photo without a viewed area draws none', { tag: '@S-V77-BAD-NO-AREA' }, async ({ page, lang }) => {
    await openViewer(page, { lang, hash: `${LONE_VIEW}&photo=${LONE}` });
    await mapIdle(page);
    const marker = await screenPointOf(page, lonePlace());
    await page.mouse.move(marker.x, marker.y);
    await mapIdle(page);

    expect(await renderedFeatureIds(page, 'hcm-photos-area-')).toEqual([]);
});
