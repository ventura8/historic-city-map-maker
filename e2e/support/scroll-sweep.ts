import { expect, test, type Page } from '@playwright/test';

import { axeRecords, axeViolations, contrastChecks } from './a11y.js';
import { targetSizeViolations } from './a11y-rules.js';
import { COLOUR } from './colour.js';
import { DOM_WALK } from './dom-walk.js';
import { callInPage, layoutViolationsOf, settleAnimations } from './layout.js';
import { LAYOUT_PROBE } from './layout-probe.js';
import { windowClassOf } from './layout-rules.js';
import type { PageFunction } from './page-script.js';
import { reportViolations } from './report.js';
import { restoreScrollers, SCROLL_PROBE, scrollers, scrollToPosition, type ScrollerInfo } from './scroll-probe.js';
import { violationLines, violationShape, type Violation } from './violations.js';

/**
 * The scroll sweep of a state (docs/TESTING.md → *The tour's checkers*; lesson 84 of docs/LESSONS.md): the checkers
 * measure what is scrolled into view, so a fault below the fold waited for a layout change to be seen (the places
 * editor's chosen position at 1.27:1 in high contrast, found only once the map box stopped pushing it down). After the
 * state's own checks, every box a visitor scrolls (the page, a pane, a sheet, a dialog's content: e2e/support/scroll-
 * probe.ts → `scrollers`) is scrolled through its content a window at a time, and at each position the checks that
 * depend on what is in view run again: the layout checker, the target sizes, the non-text contrast in the page's scheme
 * and in high contrast, and axe's colour contrast. A violation the state already had, or that an earlier position
 * found, is not reported again (`violationShape`: the same fault at other coordinates); a new one is reported with the
 * position it was seen at and its outlined screenshot. Every scroller is then put back where it was. The Tab round, the
 * landmarks, the announcements and the text-spacing and reflow variants do not depend on the scroll position and run
 * once, on the state as it is.
 */

/** The in-page helpers of the sweep: the probes it repeats need the layout probe's (`modalSurfaces`). */
const SWEEP_HELPERS: readonly PageFunction[] = [...DOM_WALK, ...COLOUR, ...LAYOUT_PROBE, ...SCROLL_PROBE];

/** The axe rules that depend on what is in view (an element scrolled away is only "incomplete" for axe). */
const POSITION_RULES: readonly string[] = ['color-contrast'];

/** What the sweep repeats at one position. */
async function positionViolations(page: Page, skipRules: readonly string[]): Promise<Violation[]> {
    const { snapshot, violations } = await layoutViolationsOf(page);
    const targets = targetSizeViolations(snapshot, windowClassOf(snapshot.viewport.width));
    const contrast = await contrastChecks(page);
    const rules = POSITION_RULES.filter((rule) => !skipRules.includes(rule));
    const axe = rules.length === 0 ? [] : axeRecords(await axeViolations(page, { rules }));
    return [...violations, ...targets, ...contrast, ...axe];
}

/** Keeps the violations not seen yet (adding them to `seen`), each saying where the page was scrolled. */
function fresh(found: readonly Violation[], seen: Set<string>, where: string): Violation[] {
    return found.flatMap((violation) => {
        const shape = violationShape(violation);
        if (seen.has(shape)) {
            return [];
        }
        seen.add(shape);
        return [{ ...violation, message: `${violation.message} (${where})` }];
    });
}

/** Visits every position of one scroller; answers what they found that `seen` did not hold. */
async function sweepOne(page: Page, state: string, scroller: ScrollerInfo, context: SweepContext): Promise<Violation[]> {
    const found: Violation[] = [];
    for (const top of scroller.positions) {
        const at = await callInPage<number | null>(page, SWEEP_HELPERS, scrollToPosition, [scroller.index, top]);
        if (at === null) {
            break;
        }
        const where = `${scroller.name} scrolled to ${String(Math.round(at))} px`;
        const added = fresh(await positionViolations(page, context.skipRules), context.seen, where);
        await reportViolations(page, `${state}, ${where}`, added);
        found.push(...added);
    }
    return found;
}

interface SweepContext {
    readonly seen: Set<string>;
    readonly skipRules: readonly string[];
}

/**
 * Scrolls every scroller of the page through its content and checks each position (see the module's comment), as a
 * soft assertion; `known` are the state's own violations, which are not reported again. The page is left scrolled as
 * it was. Answers the new violations.
 */
export async function assertScrolledSound(
    page: Page,
    state: string,
    known: readonly Violation[],
    options: { readonly skipRules?: readonly string[] } = {},
): Promise<Violation[]> {
    const context: SweepContext = { seen: new Set(known.map(violationShape)), skipRules: options.skipRules ?? [] };
    const found: Violation[] = [];
    try {
        const swept = await callInPage<ScrollerInfo[]>(page, SWEEP_HELPERS, scrollers);
        // What was swept, in the report (an annotation of the test): a sweep that found nothing still says where it looked.
        const positions = swept.map((scroller) => `${scroller.name} (${String(scroller.positions.length)})`).join(', ');
        test.info().annotations.push({
            type: 'scroll sweep',
            description: `${state}: ${positions === '' ? 'nothing scrolls' : positions}`,
        });
        for (const scroller of swept) {
            found.push(...(await sweepOne(page, state, scroller, context)));
        }
    } finally {
        await callInPage(page, SWEEP_HELPERS, restoreScrollers);
        await settleAnimations(page);
    }
    expect.soft(violationLines(`${state} scrolled through`, found), `${state}: sound wherever it is scrolled`).toEqual([]);
    return found;
}
