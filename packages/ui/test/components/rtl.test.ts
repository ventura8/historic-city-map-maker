/** The kit right to left (an Arabic page): Left and Right follow the screen, the slider fills from the right, chevrons mirror. */
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmIcon, type HcmIcon } from '../../src/components/icon.js';
import { logicalKey } from '../../src/components/internal.js';
import { defineHcmSegmentedButton, type HcmSegmentedButton } from '../../src/components/segmented-button.js';
import { defineHcmSlider, type HcmSlider } from '../../src/components/slider.js';
import { defineHcmToolbar, type HcmToolbar } from '../../src/components/toolbar.js';
import { cleanup, fixture, press, recordEvents, shadowPart } from '../helpers.js';

/** The element a fixture rendered (a missing one fails the test here). */
function required<T>(element: T | null | undefined): T {
    if (element === null || element === undefined) {
        throw new Error('the fixture did not render it');
    }
    return element;
}

defineHcmIcon();
defineHcmSegmentedButton();
defineHcmSlider();
defineHcmToolbar();

describe('logicalKey', () => {
    it('happyPath_rightToLeftSwapsLeftAndRight', async () => {
        const rtl = await fixture<HTMLElement>(html`<div dir="rtl"><span></span></div>`);
        const inner = rtl.querySelector('span') ?? rtl;

        expect(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'Home'].map((key) => logicalKey(key, inner))).toEqual([
            'ArrowRight',
            'ArrowLeft',
            'ArrowUp',
            'Home',
        ]);
    });

    it('badPath_leftToRightKeepsEveryKey', async () => {
        const ltr = await fixture<HTMLElement>(html`<div dir="ltr"></div>`);

        expect(['ArrowLeft', 'ArrowRight'].map((key) => logicalKey(key, ltr))).toEqual(['ArrowLeft', 'ArrowRight']);
    });
});

describe('the kit right to left', () => {
    afterEach(cleanup);

    it('happyPath_theSliderFillsFromTheRightAndItsArrowsFollowTheScreen', async () => {
        const holder = await fixture<HTMLElement>(
            html`<div dir="rtl"><hcm-slider label="Opacity" value="50" style="width: 216px"></hcm-slider></div>`,
        );
        const element = required(holder.querySelector<HcmSlider>('hcm-slider'));
        await element.updateComplete;
        const handle = shadowPart(element, '[role="slider"]');
        const track = shadowPart(element, '.track').getBoundingClientRect();

        press(handle, 'ArrowLeft');
        expect(element.value).toBeGreaterThan(50);
        shadowPart(element, '.track').dispatchEvent(
            new PointerEvent('pointerdown', { clientX: track.left + 8 + 0.2 * 200, button: 0, bubbles: true, composed: true }),
        );
        expect(element.value).toBe(80);
    });

    it('happyPath_theSegmentsArrowsFollowTheScreenAndALabelKeepsItsLanguage', async () => {
        const holder = await fixture<HTMLElement>(
            html`<div dir="rtl"><hcm-segmented-button label="Language"></hcm-segmented-button></div>`,
        );
        const element = required(holder.querySelector<HcmSegmentedButton>('hcm-segmented-button'));
        element.options = [
            { value: 'ar', label: 'العربية', lang: 'ar' },
            { value: 'de', label: 'Deutsch', lang: 'de' },
        ];
        element.value = 'ar';
        await element.updateComplete;
        const changes = recordEvents(element, 'hcm-change');

        press(shadowPart(element, '[role="radiogroup"]'), 'ArrowLeft');

        expect(changes).toEqual([{ value: 'de' }]);
        expect(Array.from(element.shadowRoot?.querySelectorAll('[role="radio"]') ?? []).map((radio) => radio.getAttribute('lang'))).toEqual(
            ['ar', 'de'],
        );
    });

    it('happyPath_theToolbarsArrowsFollowTheScreen', async () => {
        const holder = await fixture<HTMLElement>(
            html`<div dir="rtl">
                <hcm-toolbar label="Tools"><button>One</button><button>Two</button></hcm-toolbar>
            </div>`,
        );
        const element = required(holder.querySelector<HcmToolbar>('hcm-toolbar'));
        await element.updateComplete;

        press(shadowPart(element, '[role="toolbar"]'), 'ArrowLeft');

        expect(document.activeElement?.textContent).toBe('Two');
    });

    it('happyPath_chevronsMirrorAndOtherIconsDoNot', async () => {
        const holder = await fixture<HTMLElement>(
            html`<div dir="rtl"><hcm-icon name="chevron_left"></hcm-icon><hcm-icon name="share"></hcm-icon></div>`,
        );
        const [chevron, share] = Array.from(holder.querySelectorAll<HcmIcon>('hcm-icon'));

        expect(getComputedStyle(required(chevron)).transform).toBe('matrix(-1, 0, 0, 1, 0, 0)');
        expect(getComputedStyle(required(share)).transform).toBe('none');
    });

    it('badPath_leftToRightNothingMirrors', async () => {
        const icon = await fixture<HcmIcon>(html`<hcm-icon name="chevron_left"></hcm-icon>`);

        expect(getComputedStyle(icon).transform).toBe('none');
    });
});
