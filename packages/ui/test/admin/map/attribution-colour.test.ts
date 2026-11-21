import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmAdminMap } from '../../../src/admin/map/hcm-admin-map.js';
import { cleanup, defineAll, mount } from '../shell/fake-app.js';

/**
 * A layer's own credit in Mapbox's attribution (CR-M3-47; `docs/LESSONS.md` 182): Mapbox draws its attribution on a
 * half-white box in every scheme and colours only its links (`mapbox-gl.css`), so a layer's plain-text credit inherited
 * the page's text colour, light in the dark scheme, and read white on white (axe color-contrast at `admin-l1440-dark`).
 */

/** The two rules of `mapbox-gl.css` 3.34.1 that colour the attribution (the stylesheet itself is not loaded here). */
const MAPBOX_RULES = '.mapboxgl-ctrl.mapboxgl-ctrl-attrib{background-color:#ffffff80}.mapboxgl-ctrl-attrib a{color:#000000bf}';

/** Mapbox's attribution control as it fills it: the layer's credit as text, then Mapbox's own link. */
function attribution(map: HcmAdminMap): { readonly credit: HTMLElement; readonly link: HTMLElement } {
    const style = document.createElement('style');
    style.textContent = MAPBOX_RULES;
    map.renderRoot.append(style);
    const control = document.createElement('div');
    control.className = 'mapboxgl-ctrl mapboxgl-ctrl-attrib';
    const credit = document.createElement('div');
    credit.className = 'mapboxgl-ctrl-attrib-inner';
    credit.append('USGS EROS | ');
    const link = document.createElement('a');
    link.href = 'https://www.mapbox.com/about/maps/';
    link.textContent = '© Mapbox';
    credit.append(link);
    control.append(credit);
    map.container?.append(control);
    return { credit, link };
}

describe('<hcm-admin-map>: a layer credit in the attribution', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_aPlainTextCreditReadsInTheLinksColourUnderTheDarkSchemesLightText', async () => {
        const map = await mount<HcmAdminMap>(html`<hcm-admin-map css-url=""></hcm-admin-map>`, 600);
        // The dark scheme's on-surface, which the page's text inherits.
        map.style.color = 'rgb(230, 224, 233)';
        const { credit, link } = attribution(map);

        expect(getComputedStyle(credit).color).toBe(getComputedStyle(link).color);
        expect(getComputedStyle(link).color).toBe('rgba(0, 0, 0, 0.75)');
    });
});
