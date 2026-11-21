import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HcmTimeline } from '../../src/viewer/hcm-timeline.js';
import { PEEK_LEAVE_MS, datesPeekEvent } from '../../src/viewer/timeline-peek.js';
import { shadowQuery } from './doubles.js';
import { readyState } from './fake-store.js';
import { testManifest } from './fixtures.js';
import { COMPACT, EXPANDED, mountViewer, part, type Mounted } from './viewer-harness.js';

/**
 * V13's peek in `<hcm-map-viewer>` (the owner, 2026-11-13): a pointer resting on a year of several dates shows its menu,
 * not modal and the year not selected; a mouse's peek closes a moment after it left the year and the menu, Esc or a press
 * elsewhere close it at once, and a menu opened by selecting the year is never replaced by a peek.
 */

/** The test manifest with a second layer of 1966, dated, so 1966 has two dates. */
function twoDates() {
    return testManifest((raw) => {
        const layers = raw['layers'] as Record<string, unknown>[];
        const [, corona] = layers;
        layers.push({ ...corona, id: 'kh4-1966b', date: '1966-09-03', label: { ro: 'Corona 1966 B', en: 'Corona 1966 B' }, order: 3 });
    });
}

function timelineOf(mounted: Mounted): HcmTimeline {
    return part(mounted, 'hcm-timeline') as HcmTimeline;
}

function menuOf(mounted: Mounted): Element | null {
    return mounted.element.shadowRoot?.querySelector('hcm-date-menu') ?? null;
}

async function peek(mounted: Mounted, year: number | null, gently = false): Promise<void> {
    const dates = year === null ? null : { year, anchor: timelineOf(mounted).getBoundingClientRect().toJSON() as DOMRect };
    timelineOf(mounted).dispatchEvent(datesPeekEvent({ dates, gently }));
    await mounted.element.updateComplete;
}

async function peeking(): Promise<Mounted> {
    const mounted = await mountViewer(readyState(twoDates(), { year: 1977 }), EXPANDED);
    await peek(mounted, 1966);
    return mounted;
}

describe('<hcm-map-viewer>: the peek of a year of several dates (V13)', () => {
    beforeEach(() => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
        vi.useRealTimers();
        document.body.replaceChildren();
    });

    it('happyPath_aPeekShowsTheDatesNotModalAndSelectsNothing', async () => {
        const mounted = await peeking();
        const menu = menuOf(mounted);

        expect(menu).not.toBeNull();
        expect(menu?.shadowRoot?.querySelector('.scrim')).toBeNull();
        expect(part(mounted, '.frame').inert).toBe(false);
        const box = mounted.element.getBoundingClientRect();
        const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        const deep = hit?.shadowRoot?.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        expect(deep?.localName, 'the map under the peek takes the pointer').not.toBe('hcm-date-menu');
        expect(mounted.store.callsOf('setYear')).toEqual([]);
        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
    });

    it('happyPath_onAPhoneThePeekKeepsClearOfTheCompassTheZoomAndTheMenuButton', async () => {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1977 }), COMPACT);
        timelineOf(mounted).collapsed = false;
        await peek(mounted, 1966);
        const menu = shadowQuery(part(mounted, 'hcm-date-menu'), '.menu').getBoundingClientRect();
        const controls = ['hcm-compass', '[data-layout-check="zoom"]', 'hcm-fab-menu'].map((selector) =>
            part(mounted, selector).getBoundingClientRect(),
        );

        for (const box of controls) {
            const meets = menu.left < box.right && box.left < menu.right && menu.top < box.bottom && box.top < menu.bottom;
            expect(meets, `clear of ${JSON.stringify(box)}`).toBe(false);
        }
    });

    it('happyPath_aDatePickedInThePeekComesToTheFront', async () => {
        const mounted = await peeking();

        shadowQuery(part(mounted, 'hcm-date-menu'), '[data-item="kh4-1966b"]').click();
        await mounted.element.updateComplete;

        expect(mounted.store.callsOf('pickLayer')).toEqual([['kh4-1966b']]);
        expect(menuOf(mounted)).toBeNull();
    });

    it('happyPath_theMouseOnItsWayToTheMenuKeepsItThenLeavingBothClosesIt', async () => {
        const mounted = await peeking();
        const box = shadowQuery(part(mounted, 'hcm-date-menu'), '.menu');

        await peek(mounted, null, true);
        vi.advanceTimersByTime(PEEK_LEAVE_MS - 1);
        box.dispatchEvent(new PointerEvent('pointerenter', { pointerType: 'mouse' }));
        vi.advanceTimersByTime(PEEK_LEAVE_MS);
        await mounted.element.updateComplete;
        expect(menuOf(mounted)).not.toBeNull();

        box.dispatchEvent(new PointerEvent('pointerleave', { pointerType: 'mouse' }));
        vi.advanceTimersByTime(PEEK_LEAVE_MS);
        await mounted.element.updateComplete;
        expect(menuOf(mounted)).toBeNull();
    });

    it('badPath_escOrAPressElsewhereClosesThePeekAtOnce', async () => {
        const mounted = await peeking();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Shift' }));
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        await mounted.element.updateComplete;
        expect(menuOf(mounted)).toBeNull();

        await peek(mounted, 1966);
        part(mounted, '.map').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
        await mounted.element.updateComplete;
        expect(menuOf(mounted)).toBeNull();
        await peek(mounted, null);
        expect(mounted.store.callsOf('pickLayer')).toEqual([]);
    });

    it('badPath_aMenuOpenedBySelectingTheYearIsNeverReplacedByAPeek', async () => {
        const mounted = await mountViewer(readyState(twoDates(), { year: 1966 }), EXPANDED);
        shadowQuery(timelineOf(mounted), '[role="slider"]').dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, composed: true }),
        );
        await vi.waitFor(() => {
            expect(menuOf(mounted)).not.toBeNull();
        });
        await mounted.element.updateComplete;

        await peek(mounted, null);
        await peek(mounted, 1977);
        const menu = menuOf(mounted);
        menu?.dispatchEvent(new CustomEvent('hcm-date-menu-pointer', { detail: { inside: false } }));
        vi.advanceTimersByTime(PEEK_LEAVE_MS);
        await mounted.element.updateComplete;

        expect(menuOf(mounted)?.shadowRoot?.querySelector('.scrim')).not.toBeNull();
        expect(part(mounted, '.frame').inert).toBe(true);
    });

    it('happyPath_selectingTheYearTurnsThePeekIntoTheModalMenu', async () => {
        const mounted = await peeking();

        mounted.element.runInput('close');
        await mounted.element.updateComplete;
        expect(menuOf(mounted)).toBeNull();

        await peek(mounted, 1966);
        timelineOf(mounted).dispatchEvent(
            new CustomEvent('hcm-dates-open', {
                bubbles: true,
                composed: true,
                detail: { year: 1966, anchor: { x: 1, y: 1, width: 1, height: 1 } },
            }),
        );
        await mounted.element.updateComplete;
        expect(part(mounted, '.frame').inert).toBe(true);
    });
});
