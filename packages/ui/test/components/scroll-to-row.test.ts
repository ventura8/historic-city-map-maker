import { afterEach, describe, expect, it, vi } from 'vitest';

import { scrollRowToTop, scrollerOf } from '../../src/components/scroll-to-row.js';

/** A pane that scrolls, holding a host whose shadow root holds ten 40 px rows; the rows keep 30 px clear above them. */
function paneWithRows(): { pane: HTMLElement; first: HTMLElement; sixth: HTMLElement } {
    const pane = document.createElement('div');
    pane.style.cssText = 'height: 100px; overflow-y: auto';
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const row = (): HTMLElement => {
        const element = document.createElement('div');
        element.style.cssText = 'height: 40px; scroll-margin-block-start: 30px';
        root.append(element);
        return element;
    };
    const first = row();
    for (let index = 1; index < 5; index += 1) {
        row();
    }
    const sixth = row();
    for (let index = 6; index < 10; index += 1) {
        row();
    }
    pane.append(host);
    document.body.append(pane);
    return { pane, first, sixth };
}

describe('scroll-to-row', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    it('happyPath_theRowsOwnPaneScrollsItToTheTopBelowItsMarginAndThePageDoesNot', () => {
        const { pane, sixth: row } = paneWithRows();
        expect(scrollerOf(row)).toBe(pane);
        const scroll = vi.spyOn(pane, 'scrollTo');
        const page = vi.spyOn(window, 'scrollTo');
        expect(scrollRowToTop(row, 'instant')).toBe(true);
        expect(scroll).toHaveBeenCalledWith({ top: 170, behavior: 'instant' });
        expect(page).not.toHaveBeenCalled();
    });

    it('badPath_noScrollerScrollsNothingAndTheFirstRowStopsAtZero', () => {
        const lone = document.createElement('div');
        document.body.append(lone);
        expect(scrollRowToTop(lone, 'smooth')).toBe(false);
        const { pane, first } = paneWithRows();
        const scroll = vi.spyOn(pane, 'scrollTo');
        scrollRowToTop(first, 'smooth');
        expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });

    it('happyPath_aRowSlottedIntoASheetScrollsTheSheetsOwnScroller', () => {
        // A modal sheet: its scroller is in its shadow root, around the slot that shows the panel's rows.
        const sheet = document.createElement('div');
        const content = document.createElement('div');
        content.style.cssText = 'height: 100px; overflow-y: auto';
        content.append(document.createElement('slot'));
        sheet.attachShadow({ mode: 'open' }).append(content);
        const rows = Array.from({ length: 10 }, () => {
            const row = document.createElement('div');
            row.style.cssText = 'height: 40px';
            return row;
        });
        sheet.append(...rows);
        document.body.append(sheet);

        expect(scrollerOf(rows[5] as HTMLElement)).toBe(content);
    });
});
