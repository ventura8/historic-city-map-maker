import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { HCM_ICON_TAG, HcmIcon, defineHcmIcon } from '../../src/components/icon.js';
import { ICON_FONT_FAMILY } from '../../src/fonts/font-files.js';
import { cleanup, fixture, shadowPart } from '../helpers.js';

defineHcmIcon();

describe('<hcm-icon>', () => {
    afterEach(cleanup);

    it('happyPath_drawsABundledLigatureInTheIconFont', async () => {
        const icon = await fixture<HcmIcon>(html`<hcm-icon name="layers"></hcm-icon>`);
        const glyph = shadowPart(icon, 'span');

        expect(glyph.textContent).toBe('layers');
        expect(glyph.getAttribute('aria-hidden')).toBe('true');
        expect(getComputedStyle(glyph).fontFamily).toContain(ICON_FONT_FAMILY);
        expect(getComputedStyle(glyph).fontVariationSettings).toBe('"FILL" 0');
        expect(icon.getBoundingClientRect().width).toBe(24);
    });

    it('happyPath_filledSwitchesTheFillAxis', async () => {
        const icon = await fixture<HcmIcon>(html`<hcm-icon name="photo_camera" filled></hcm-icon>`);

        expect(getComputedStyle(shadowPart(icon, 'span')).fontVariationSettings).toBe('"FILL" 1');
    });

    it('badPath_anUnbundledNameDrawsNothing', async () => {
        const icon = await fixture<HcmIcon>(html`<hcm-icon name="celebration"></hcm-icon>`);

        expect(shadowPart(icon, 'span').textContent).toBe('');
        expect(customElements.get(HCM_ICON_TAG)).toBe(HcmIcon);
    });
});
