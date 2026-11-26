import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { defineHcmSegmentedButton, type HcmSegmentedButton, type SegmentOption } from '../../src/components/segmented-button.js';
import { cleanup, fixture, part, press, recordEvents } from '../helpers.js';

defineHcmSegmentedButton();

const THEMES: readonly SegmentOption[] = [
    { value: 'system', label: 'Sistem', icon: 'brightness_auto' },
    { value: 'light', label: 'Luminos', icon: 'light_mode' },
    { value: 'dark', label: 'Întunecat' },
];

function group(value: string): Promise<HcmSegmentedButton> {
    return fixture<HcmSegmentedButton>(html`<hcm-segmented-button .options=${THEMES} value=${value} label="Temă"></hcm-segmented-button>`);
}

function radios(element: HcmSegmentedButton): HTMLElement[] {
    return [...(element.shadowRoot?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])];
}

describe('<hcm-segmented-button>', () => {
    afterEach(cleanup);

    it('happyPath_aRadioGroupWithOneTabStopOnTheSelection', async () => {
        const element = await group('light');

        await expect.element(page.getByRole('radiogroup', { name: 'Temă' })).toBeVisible();
        await expect.element(page.getByRole('radio', { name: 'Luminos' })).toBeChecked();
        expect(radios(element).map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
        expect(radios(element)[1]?.querySelector('hcm-icon')?.getAttribute('name')).toBe('check');
        expect(radios(element)[2]?.querySelector('hcm-icon')).toBeNull();
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aClickSelectsAndReports', async () => {
        const element = await group('system');
        const changes = recordEvents(element, 'hcm-change');

        await userEvent.click(page.getByRole('radio', { name: 'Întunecat' }));
        await userEvent.click(page.getByRole('radio', { name: 'Întunecat' }));

        expect(changes).toEqual([{ value: 'dark' }]);
    });

    it('happyPath_arrowsWrapAndHomeEndJump', async () => {
        const element = await group('system');
        const changes = recordEvents<{ value: string }>(element, 'hcm-change');
        const radioGroup = element.shadowRoot?.querySelector('[role="radiogroup"]') ?? element;

        for (const key of ['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', 'End', 'Home']) {
            press(radioGroup, key);
        }
        await element.updateComplete;
        await element.updateComplete;

        expect(changes.map((detail) => detail.value)).toEqual(['dark', 'system', 'light', 'system', 'dark', 'system']);
        expect(element.shadowRoot?.activeElement?.getAttribute('data-value')).toBe('system');
    });

    it('badPath_withoutASelectionTheFirstSegmentIsTheTabStop', async () => {
        const element = await group('none');
        const changes = recordEvents(element, 'hcm-change');
        const radioGroup = element.shadowRoot?.querySelector('[role="radiogroup"]') ?? element;

        expect(radios(element).map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
        const unhandled = press(radioGroup, 'Enter');
        press(radioGroup, 'ArrowRight');

        expect(unhandled.defaultPrevented).toBe(false);
        expect(changes).toEqual([{ value: 'light' }]);
    });

    it('happyPath_aWideContainerKeepsEveryLabelOnOneLine', async () => {
        const options: readonly SegmentOption[] = [
            { value: 'system', label: 'Ca sistemul', icon: 'brightness_auto' },
            { value: 'light', label: 'Luminoasă', icon: 'light_mode' },
            { value: 'dark', label: 'Întunecată', icon: 'dark_mode' },
        ];
        const element = await fixture<HcmSegmentedButton>(
            html`<hcm-segmented-button .options=${options} value="system" label="Temă"></hcm-segmented-button>`,
        );
        await document.fonts.ready;

        // One line of label-large is 20 px: a wrapped label would be 40 px tall inside its 40 px segment.
        const labels = radios(element).map((radio) => radio.querySelector('span')?.getBoundingClientRect().height);
        expect(labels).toEqual([20, 20, 20]);
        expect(radios(element).map((radio) => radio.getBoundingClientRect().height)).toEqual([40, 40, 40]);
    });

    it('badPath_aNarrowContainerWrapsALongLabelInsteadOfScrollingSideways', async () => {
        const options: readonly SegmentOption[] = [
            { value: 'system', label: 'Ca sistemul de operare al acestui telefon mobil' },
            { value: 'light', label: 'Da' },
            { value: 'dark', label: 'Nu' },
        ];
        const wrapper = await fixture<HTMLElement>(
            html`<div style="inline-size: 260px">
                <hcm-segmented-button .options=${options} value="light" label="Temă"></hcm-segmented-button>
            </div>`,
        );
        const element = wrapper.querySelector('hcm-segmented-button');
        await element?.updateComplete;
        await document.fonts.ready;

        const [long, short] = element === null ? [] : radios(element);
        expect(wrapper.scrollWidth).toBeLessThanOrEqual(260);
        expect(long?.getBoundingClientRect().height ?? 0).toBeGreaterThan(40);
        expect(short?.getBoundingClientRect().height).toBe(long?.getBoundingClientRect().height);
        for (const radio of element === null ? [] : radios(element)) {
            const box = radio.getBoundingClientRect();
            const label = radio.querySelector('span')?.getBoundingClientRect();
            // M3's 48 px minimum, so the 48 px touch target never sticks out of the group ("Nu").
            expect(box.width).toBeGreaterThanOrEqual(48);
            expect(label?.left).toBeGreaterThanOrEqual(box.left);
            expect(label?.right).toBeLessThanOrEqual(box.right);
        }
    });

    it('badPath_noOptionsRendersAnEmptyGroup', async () => {
        const element = await fixture<HcmSegmentedButton>(html`<hcm-segmented-button label="Empty"></hcm-segmented-button>`);

        expect(radios(element)).toEqual([]);
    });
});

describe('<hcm-segmented-button> too wide for its container', () => {
    afterEach(cleanup);

    /** The admin's theme choice at 360 px: three single words that cannot wrap, in a 264 px dialog. */
    const WORDS: readonly SegmentOption[] = [
        { value: 'system', label: 'Automată' },
        { value: 'light', label: 'Luminoasă' },
        { value: 'dark', label: 'Întunecată' },
    ];

    async function inBox(
        width: number,
        options: readonly SegmentOption[] = WORDS,
    ): Promise<{ box: HTMLElement; element: HcmSegmentedButton }> {
        const box = await fixture<HTMLElement>(
            html`<div style="inline-size: ${String(width)}px">
                <hcm-segmented-button .options=${options} value="system" label="Temă"></hcm-segmented-button>
            </div>`,
        );
        const element = part(box, 'hcm-segmented-button') as HcmSegmentedButton;
        await document.fonts.ready;
        return { box, element };
    }

    it('badPath_singleWordsThatDoNotFitStackOneSegmentPerRow_happyPath_sideBySideAgainWhenItWidens', async () => {
        // The visual audit at 360 px: "Întunecată" ran past the account menu's edge and the dialog scrolled sideways.
        const { box, element } = await inBox(200);
        await vi.waitFor(() => {
            expect(element.stacked).toBe(true);
        });
        await element.updateComplete;
        const stacked = radios(element).map((radio) => radio.getBoundingClientRect());
        expect(box.scrollWidth).toBeLessThanOrEqual(200);
        expect(stacked.map((rect) => Math.round(rect.width))).toEqual([200, 200, 200]);
        // Rows that touch are 48 px targets each (the tour's hit test found 40 px rows cut to 44 by the next one).
        expect(stacked.map((rect) => Math.round(rect.height))).toEqual([48, 48, 48]);
        expect(stacked[1]?.top).toBeGreaterThan(stacked[0]?.top ?? 0);
        // The rows touch without overlapping: none covers the edge of the one above it.
        expect(stacked.slice(1).map((rect, index) => Math.round(rect.top - (stacked[index]?.bottom ?? 0)))).toEqual([0, 0]);

        box.style.inlineSize = '600px';
        await vi.waitFor(() => {
            expect(element.stacked).toBe(false);
        });
        await element.updateComplete;
        const row = radios(element).map((radio) => Math.round(radio.getBoundingClientRect().top));
        expect(new Set(row).size).toBe(1);
        expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    });

    it('badPath_widerTextInAGroupThatFittedStacksIt', async () => {
        // WCAG 1.4.12's text spacing widens the labels while the host, capped at its container, keeps its size.
        const { element } = await inBox(320);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(element.stacked).toBe(false);
        const spacing = new CSSStyleSheet();
        spacing.replaceSync('* { letter-spacing: 0.3em !important; word-spacing: 0.16em !important; }');
        element.shadowRoot?.adoptedStyleSheets.push(spacing);
        await vi.waitFor(() => {
            expect(element.stacked).toBe(true);
        });
    });

    it('badPath_theSameLabelsInANewArrayKeepTheStackWithoutAFrameSideBySide', async () => {
        // The account menu builds its options in render: each update of the menu handed over a new array, which put the
        // segments side by side for a frame, past the dialog's edge (docs/LESSONS.md 295).
        const { element } = await inBox(200);
        await vi.waitFor(() => {
            expect(element.stacked).toBe(true);
        });
        element.options = WORDS.map((option) => ({ ...option }));
        await element.updateComplete;
        expect(element.stacked).toBe(true);
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(element.stacked).toBe(true);
        expect(element.scrollWidth).toBeLessThanOrEqual(element.clientWidth + 1);
    });

    it('happyPath_newLabelsAreMeasuredSideBySideAgain_andARemovedGroupStopsWatching', async () => {
        const { element } = await inBox(200);
        await vi.waitFor(() => {
            expect(element.stacked).toBe(true);
        });
        element.options = [
            { value: 'ro', label: 'RO' },
            { value: 'en', label: 'EN' },
        ];
        await element.updateComplete;
        await vi.waitFor(() => {
            expect(element.stacked).toBe(false);
        });
        await new Promise((resolve) => requestAnimationFrame(resolve));
        expect(element.stacked).toBe(false);
        element.remove();
        element.options = WORDS;
        await element.updateComplete;
        expect(element.stacked).toBe(false);
    });
});
