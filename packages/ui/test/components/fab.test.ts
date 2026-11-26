import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page } from 'vitest/browser';

import { defineHcmFab, type HcmFab } from '../../src/components/fab.js';
import { cleanup, fixture, shadowPart } from '../helpers.js';

defineHcmFab();

describe('<hcm-fab>', () => {
    afterEach(cleanup);

    it('happyPath_anIconFabIsNamedByItsLabel', async () => {
        const fab = await fixture<HcmFab>(html`<hcm-fab icon="layers" label="Straturi"></hcm-fab>`);

        await expect.element(page.getByRole('button', { name: 'Straturi' })).toBeVisible();
        expect(shadowPart(fab, 'button').getBoundingClientRect().height).toBe(56);
        expect(await axeViolations(fab)).toEqual([]);
    });

    it('happyPath_anExtendedFabShowsItsLabel', async () => {
        const fab = await fixture<HcmFab>(html`<hcm-fab extended icon="share" label="Share" size="large"></hcm-fab>`);
        const button = shadowPart(fab, 'button');

        expect(button.hasAttribute('aria-label')).toBe(false);
        expect(button.textContent).toContain('Share');
        expect(button.getBoundingClientRect().height).toBe(96);
    });

    it('badPath_aSmallFabKeepsItsName', async () => {
        const fab = await fixture<HcmFab>(html`<hcm-fab icon="my_location" label="Locate" size="small"></hcm-fab>`);

        expect(shadowPart(fab, 'button').getBoundingClientRect().height).toBe(40);
        await expect.element(page.getByRole('button', { name: 'Locate' })).toBeVisible();
    });
});
