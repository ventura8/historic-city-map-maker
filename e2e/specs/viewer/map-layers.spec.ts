import { creditLine } from '@hcm/shared';

import { siteManifestData, type Json } from '../../fixtures/manifest.js';
import { BASEMAP_BACKGROUND } from '../../fixtures/world.js';
import { expectColourAt, mapFraction } from '../../support/map.js';
import { expect, test } from '../../support/test.js';
import { openLayers, openViewer, serveManifest, t, viewer, visibilitySwitch } from '../../support/viewer.js';

/**
 * M20 (docs/research/M20-import-local.md §7, §9; behaviour V53): a scanned map imported from a local archive is a layer of kind
 * `map` at 0.85 whose `attribution` is the credit line built from its rights. The viewer needs no byte of its own for it: the
 * layer is listed in Layers with its credit, draws its tiles and puts its credit on the map's legal line while it shows.
 */

const EMPTY_VIEW = '15/44.37000/25.97000';
const LABEL = 'Planul IGA 1911 (e2e)';
const CREDIT = creditLine(
    {
        licence: 'PD',
        state: 'clear',
        author: 'IGA',
        year: '1911',
        sourceLabel: 'Idei Urbane – DocuBucurești',
        watermark: 'romaniaforum',
    },
    LABEL,
);

/** The fixture with its 1966 layer as an archive's drawn map: kind map, 0.85, the credit line. */
function withMapLayer(): Json {
    const manifest = siteManifestData();
    const [layer] = manifest['layers'] as [Json, ...Json[]];
    Object.assign(layer, { kind: 'map', label: { ro: LABEL, en: LABEL }, attribution: CREDIT, opacity: 0.85 });
    delete layer['sensor'];
    return manifest;
}

test(
    'A drawn map from an archive is listed in Layers with its credit and credits the legal line while it shows',
    { tag: '@S-V53-HAPPY' },
    async ({ page, lang }) => {
        await serveManifest(page, withMapLayer());
        await openViewer(page, { lang, hash: EMPTY_VIEW });
        const attribution = viewer(page).locator('.mapboxgl-ctrl-attrib-inner');

        await openLayers(page, lang);
        const toggle = visibilitySwitch(page, lang, LABEL);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(page.getByText(t(lang, 'layers.attribution', { attribution: CREDIT }))).toBeVisible();
        await expect(attribution).toContainText('Idei Urbane – DocuBucurești');
        await expect(attribution).toContainText('PD');
    },
);

test(
    'A drawn map that is not shown draws nothing and leaves the legal line without its credit',
    { tag: '@S-V53-BAD-HIDDEN' },
    async ({ page, lang }) => {
        await serveManifest(page, withMapLayer());
        await openViewer(page, { lang, hash: EMPTY_VIEW });

        await expectColourAt(page, await mapFraction(page, 0.5, 0.3), BASEMAP_BACKGROUND, 'the hidden map draws nothing');
        await expect(viewer(page).locator('.mapboxgl-ctrl-attrib-inner')).not.toContainText('Idei Urbane');
        await openLayers(page, lang);
        await expect(visibilitySwitch(page, lang, LABEL)).toHaveAttribute('aria-checked', 'false');
    },
);
