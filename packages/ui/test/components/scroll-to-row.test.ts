import { afterEach, describe, expect, it, vi } from 'vitest';

import { scrollRowToTop, scrollerOf } from '../../src/components/scroll-to-row.js';

/** A pane that scrolls, holding a host whose shadow root holds ten 40 px rows; the rows keep 30 px clear above them. */
function paneWithRows(): { pane: HTMLElement; rows: HTMLElement[] } {
    const pane = document.createElement('div');
    pane.style.cssText = 'height: 100px; overflow-y: auto';
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    const rows = Array.from({ length: 10 }, () => {
        const row = document.createElement('div');
        row.style.cssText = 'height: 40px; scroll-margin-block-start: 30px';
        return row;
    });
    root.append(...rows);
    pane.append(host);
    document.body.append(pane);
    return { pane, rows };
}

describe('scroll-to-row', () => {
    afterEach(() => {
        document.body.replaceChildren();
        vi.restoreAllMocks();
    });

    it('happyPath_theRowsOwnPaneScrollsItToTheTopBelowItsMarginAndThePageDoesNot', () => {
        const { pane, rows } = paneWithRows();
        const row = rows[5]!;
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
        const { pane, rows } = paneWithRows();
        const scroll = vi.spyOn(pane, 'scrollTo');
        scrollRowToTop(rows[0]!, 'smooth');
        expect(scroll).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });
    });
});
