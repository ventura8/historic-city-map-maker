import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { SHEET_DETENTS, defineHcmSheet, detentHeights, settleDetent, type HcmSheet } from '../../src/components/sheet.js';
import { cleanup, deepFocus, fixture, part, press, recordEvents, shadowPart } from '../helpers.js';

defineHcmSheet();

/** A 600 px map box holding an opener button and the sheet. */
async function sheetIn(modal: boolean, variant = 'bottom'): Promise<{ sheet: HcmSheet; opener: HTMLButtonElement }> {
    const box = await fixture<HTMLElement>(
        html`<div style="position: relative; height: 600px; width: 400px">
            <button id="opener">Open</button>
            <hcm-sheet label="Fotografie" close-label="Închide" handle-label="Redimensionează" variant=${variant} ?modal=${modal}
                ><span slot="header">Strada Uranus</span><a href="#details">Detalii</a><button slot="actions">Mai mult</button></hcm-sheet
            >
        </div>`,
    );
    const sheet = part(box, 'hcm-sheet') as HcmSheet;
    await sheet.updateComplete;
    return { sheet, opener: part(box, '#opener') as HTMLButtonElement };
}

async function open(sheet: HcmSheet, opener: HTMLButtonElement): Promise<void> {
    opener.focus();
    sheet.open = true;
    await sheet.updateComplete;
}

/** A click on the handle needs the sheet to finish entering or changing height first. */
async function settledSheet(sheet: HcmSheet): Promise<void> {
    await sheet.updateComplete;
    await Promise.all(
        shadowPart(sheet, '.sheet')
            .getAnimations()
            .map((animation) => animation.finished),
    );
}

function pointer(target: EventTarget, type: string, clientY: number, button = 0): void {
    target.dispatchEvent(new PointerEvent(type, { clientY, button, bubbles: true, composed: true }));
}

describe('detents', () => {
    it('happyPath_heightsFollowTheContainer', () => {
        expect(detentHeights(600)).toEqual({ peek: 160, half: 300, full: 528 });
        expect(detentHeights(300)).toEqual({ peek: 90, half: 150, full: 228 });
    });

    it('happyPath_aReleaseSettlesOnTheNearestHeight', () => {
        expect(SHEET_DETENTS.map((detent) => settleDetent(detentHeights(600)[detent] + 10, 600))).toEqual(['peek', 'half', 'full']);
    });

    it('badPath_belowHalfThePeekHeightCloses', () => {
        expect(settleDetent(79, 600)).toBeNull();
        expect(settleDetent(0, 0)).toBe('peek');
    });
});

describe('<hcm-sheet>', () => {
    afterEach(cleanup);

    it('happyPath_aStandardBottomSheetIsALabelledRegionThatTakesTheFocus', async () => {
        const { sheet, opener } = await sheetIn(false);
        expect(getComputedStyle(sheet).display).toBe('none');

        await open(sheet, opener);

        await expect.element(page.getByRole('region', { name: 'Fotografie' })).toBeVisible();
        expect(sheet.shadowRoot?.activeElement).toBe(shadowPart(sheet, '.sheet'));
        expect(shadowPart(sheet, '.sheet').getBoundingClientRect().height).toBe(300);
        expect(sheet.shadowRoot?.querySelector('.scrim')).toBeNull();
        expect(await axeViolations(sheet)).toEqual([]);
    });
    it('happyPath_escapeClosesAndReturnsTheFocus', async () => {
        const { sheet, opener } = await sheetIn(false);
        const closes = recordEvents(sheet, 'hcm-close');
        await open(sheet, opener);

        press(shadowPart(sheet, '.sheet'), 'Escape');
        await sheet.updateComplete;

        expect(closes).toHaveLength(1);
        expect(sheet.open).toBe(false);
        expect(document.activeElement).toBe(opener);
    });

    it('happyPath_theCloseButtonCloses', async () => {
        const { sheet, opener } = await sheetIn(false);
        const closes = recordEvents(sheet, 'hcm-close');
        await open(sheet, opener);

        await userEvent.click(page.getByRole('button', { name: 'Închide' }));
        sheet.close();

        expect(closes).toHaveLength(1);
    });

    it('happyPath_aModalSheetIsADialogWithAScrimAndATabTrap', async () => {
        const { sheet, opener } = await sheetIn(true);
        const closes = recordEvents(sheet, 'hcm-close');
        await open(sheet, opener);

        await expect.element(page.getByRole('dialog', { name: 'Fotografie' })).toBeVisible();
        shadowPart(sheet, '.sheet').querySelector<HTMLElement>('.handle')?.focus();
        await userEvent.tab({ shift: true });
        expect(deepFocus()?.textContent).toBe('Mai mult');
        await userEvent.tab();
        expect(deepFocus()).toBe(shadowPart(sheet, '.handle'));

        shadowPart(sheet, '.scrim').click();
        expect(closes).toHaveLength(1);
    });

    it('happyPath_theHandleCyclesAndArrowKeysStep', async () => {
        const { sheet, opener } = await sheetIn(false);
        const detents = recordEvents<{ detent: string }>(sheet, 'hcm-detent-change');
        await open(sheet, opener);
        const handle = page.getByRole('button', { name: 'Redimensionează' });

        await settledSheet(sheet);
        await userEvent.click(handle);
        expect(sheet.detent).toBe('full');
        await settledSheet(sheet);
        await userEvent.click(handle);
        expect(sheet.detent).toBe('peek');
        press(shadowPart(sheet, '.handle'), 'ArrowUp');
        press(shadowPart(sheet, '.handle'), 'ArrowUp');
        press(shadowPart(sheet, '.handle'), 'ArrowDown');
        const other = press(shadowPart(sheet, '.handle'), 'Enter');
        await sheet.updateComplete;

        expect(detents.map((detail) => detail.detent)).toEqual(['full', 'peek', 'half', 'full', 'half']);
        expect(other.defaultPrevented).toBe(false);
        expect(sheet.getAttribute('detent')).toBe('half');
    });

    it('happyPath_draggingTheHandleSettlesOnTheNearestHeight', async () => {
        const { sheet, opener } = await sheetIn(false);
        const detents = recordEvents<{ detent: string }>(sheet, 'hcm-detent-change');
        await open(sheet, opener);
        const handle = shadowPart(sheet, '.handle');

        pointer(handle, 'pointerdown', 300);
        pointer(document, 'pointermove', 100);
        expect(shadowPart(sheet, '.sheet').style.height).toBe('500px');
        expect(shadowPart(sheet, '.sheet').classList.contains('dragging')).toBe(true);
        pointer(document, 'pointerup', 100);
        handle.click();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(detents).toEqual([{ detent: 'full' }]);
        expect(shadowPart(sheet, '.sheet').style.height).toBe('');
        handle.click();
        expect(detents.at(-1)).toEqual({ detent: 'peek' });
    });

    it('badPath_draggingFarDownClosesTheSheet', async () => {
        const { sheet, opener } = await sheetIn(false);
        const closes = recordEvents(sheet, 'hcm-close');
        await open(sheet, opener);

        pointer(shadowPart(sheet, '.handle'), 'pointerdown', 300);
        pointer(document, 'pointermove', 590);
        pointer(document, 'pointercancel', 590);

        expect(closes).toHaveLength(1);
    });

    it('badPath_aTapIsNotADragAndOtherButtonsAreIgnored', async () => {
        const { sheet, opener } = await sheetIn(false);
        const detents = recordEvents(sheet, 'hcm-detent-change');
        await open(sheet, opener);
        const handle = shadowPart(sheet, '.handle');

        pointer(handle, 'pointerdown', 300, 2);
        pointer(document, 'pointermove', 100);
        pointer(handle, 'pointerdown', 300);
        pointer(document, 'pointermove', 302);
        pointer(document, 'pointerup', 302);

        expect(detents).toEqual([]);
        expect(shadowPart(sheet, '.sheet').style.height).toBe('');
    });

    it('happyPath_aSideSheetHasNoHandleAndSitsAtTheEnd', async () => {
        const { sheet, opener } = await sheetIn(false, 'side');
        await open(sheet, opener);

        expect(sheet.shadowRoot?.querySelector('.handle')).toBeNull();
        expect(shadowPart(sheet, '.sheet').getBoundingClientRect().width).toBe(360);
        press(shadowPart(sheet, '.sheet'), 'Tab');
        expect(sheet.open).toBe(true);
    });

    it('badPath_removingTheSheetMidDragStopsListening', async () => {
        const { sheet, opener } = await sheetIn(false);
        await open(sheet, opener);

        pointer(shadowPart(sheet, '.handle'), 'pointerdown', 300);
        sheet.remove();
        pointer(document, 'pointermove', 100);
        pointer(document, 'pointerup', 100);

        expect(sheet.detent).toBe('half');
    });
});

describe('<hcm-sheet> actions and landmarks', () => {
    afterEach(cleanup);

    it('happyPath_slottedActionsShowInTheirRow', async () => {
        const { sheet, opener } = await sheetIn(true);
        await open(sheet, opener);

        await expect.poll(() => shadowPart(sheet, '.actions').hidden).toBe(false);
        await expect.element(page.getByRole('button', { name: 'Mai mult' })).toBeVisible();
    });

    it('badPath_withoutActionsTheirRowTakesNoRoomAndNothingIsABanner', async () => {
        // The tour: the empty actions row (16 px) sat over the end of a POI sheet's content, and axe took the sheet's
        // header row for a second page banner under the lightbox.
        const box = await fixture<HTMLElement>(
            html`<div style="position: relative; height: 600px; width: 400px">
                <hcm-sheet modal label="Loc" close-label="Închide" handle-label="Redimensionează"
                    ><span slot="header">Casa Uranus</span>
                    <p>Fișa locului</p></hcm-sheet
                >
            </div>`,
        );
        const sheet = part(box, 'hcm-sheet') as HcmSheet;
        sheet.open = true;
        await sheet.updateComplete;

        await expect.element(page.getByRole('dialog', { name: 'Loc' })).toBeVisible();
        expect(shadowPart(sheet, '.actions').hidden).toBe(true);
        const content = shadowPart(sheet, '.content').getBoundingClientRect();
        expect(content.bottom).toBeCloseTo(shadowPart(sheet, '.sheet').getBoundingClientRect().bottom, 0);
        expect(page.getByRole('banner').query()).toBeNull();
    });
});

describe('the drag handle', () => {
    afterEach(cleanup);

    it('happyPath_theHandlesFocusRingIsDrawnInsideTheSheet', async () => {
        const { sheet, opener } = await sheetIn(false);
        await open(sheet, opener);
        await userEvent.keyboard('{Tab}');
        const handle = shadowPart(sheet, '.handle');
        const style = getComputedStyle(handle);
        const grow = Number.parseFloat(style.outlineOffset) + Number.parseFloat(style.outlineWidth);

        // The sheet hides its overflow: a ring past its top edge was cut (the visual audit's full-height sheet).
        expect(deepFocus()).toBe(handle);
        expect(handle.matches(':focus-visible')).toBe(true);
        expect(handle.getBoundingClientRect().top - grow).toBeGreaterThanOrEqual(shadowPart(sheet, '.sheet').getBoundingClientRect().top);
    });

    it('happyPath_theHandleIsA48pxTargetFromTheSheetsTopEdge', async () => {
        const { sheet, opener } = await sheetIn(false);
        await open(sheet, opener);
        const handle = shadowPart(sheet, '.handle').getBoundingClientRect();
        const top = shadowPart(sheet, '.sheet').getBoundingClientRect().top;
        const centre = handle.x + handle.width / 2;

        // M3's 48 x 48 target is the button itself: a ring rising past the sheet's top edge was cut to 36 px (the tour).
        expect([handle.width, handle.height, handle.top]).toEqual([48, 48, top]);
        expect(sheet.shadowRoot?.elementFromPoint(centre, top + 1)).toBe(shadowPart(sheet, '.handle'));
        expect(sheet.shadowRoot?.elementFromPoint(centre, handle.bottom - 1)).toBe(shadowPart(sheet, '.handle'));
    });
});

describe('<hcm-sheet>, its own box', () => {
    afterEach(cleanup);

    it('badPath_noScrollMovesTheSheetItselfSoItsHeaderStaysInPlace', async () => {
        // The tour (c915l, 2026-11-16): a scroll into view pushed the Layers sheet's own box 24 px up, its title and Close
        // cut off. The sheet clips its overflow (`overflow: clip`): no script and no focus can scroll it.
        const { sheet, opener } = await sheetIn(false);
        await open(sheet, opener);
        const box = shadowPart(sheet, '.sheet');
        box.scrollTop = 24;
        box.scrollTo({ top: 48 });
        expect(box.scrollTop).toBe(0);
        expect(getComputedStyle(box).overflow).toBe('clip');
    });
});
