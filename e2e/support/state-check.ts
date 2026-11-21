import type { ViewerLocale } from '@hcm/shared';
import { expect, type Page } from '@playwright/test';

import { assertAccessible, assertEscapeCloses } from './a11y.js';
import { BLANK_SCROLL_PROBE, blankScrollViolations, measureBlankScroll, type BlankScrollMeasure } from './blank-scroll-probe.js';
import { DOM_WALK } from './dom-walk.js';
import { i18nLeaks } from './i18n.js';
import { assertLayoutSound, callInPage } from './layout.js';
import { reportViolations } from './report.js';
import { assertScrolledSound } from './scroll-sweep.js';
import { saveStateShots } from './state-shots.js';
import { violationLines, type Violation } from './violations.js';

/**
 * One visit of a tour state (e2e/tour/states.ts): the generic layout checker, the generic accessibility checker and the
 * i18n leak check on the page as it is, then the scroll sweep (every box a visitor scrolls, scrolled through its content,
 * the position-dependent checks again at each position: e2e/support/scroll-sweep.ts), then, for a popup or modal state,
 * Esc (it closes, and the focus goes back to the control that opened it). Every check is soft, so one run reports every state of the tour; the violations are recorded
 * in the test's output and attached with an outlined screenshot (e2e/support/report.ts). With `HCM_STATE_SCREENSHOTS`
 * the state is first saved for the visual audit (e2e/support/state-shots.ts).
 */
export interface StateVisit {
    /** The state's id in the inventory (`viewer.layers-full`, `admin.setup-billing`). */
    readonly id: string;
    /** What the visitor sees in it, as the inventory says (it names the state in the i18n check's message). */
    readonly title?: string;
    /** The language the page shows (a Romanian page must show no English-only text). */
    readonly lang: ViewerLocale;
    /** Texts a live region must have announced on the way into the state. */
    readonly announcements?: readonly string[];
    /** Axe rules that do not apply as emulated (the author-colour rules under forced colours). */
    readonly skipRules?: readonly string[];
    /** Esc closes the state's popup or modal surface; the focus returns to the control of this name (null: none opened it). */
    readonly escape?: { readonly opener: string | null };
}

/**
 * How long a state waits for its maps to finish loading before it is checked as it is: SwiftShader draws a 3840 px
 * frame slowly, and a full parallel run (the admin tour beside every tier) slows every map (the admin tour's first
 * per-push run, 2026-10-18, checked a layer's map before its attribution was filled).
 */
const MAPS_LOADED_MS = 60_000;

/**
 * Runs in the page: no admin map box is still creating its map (a box an editor just opened, before its map exists), and
 * every live map (the instrumentation's) has its style, sources and tiles loaded.
 */
function mapsLoadedInPage(): boolean {
    interface LoadedMap {
        loaded(): boolean;
        getContainer(): HTMLElement;
    }
    const creating = (root: Document | ShadowRoot): boolean =>
        [...root.querySelectorAll('*')].some(
            (element) =>
                (element.localName === 'hcm-admin-map' && (element as Element & { status?: string }).status === 'loading') ||
                (element.shadowRoot !== null && creating(element.shadowRoot)),
        );
    const maps = (window as unknown as { __hcmE2e?: { maps: LoadedMap[] } }).__hcmE2e?.maps ?? [];
    // Mapbox fills its attribution a moment after the sources load (a map without its own control has none to wait for).
    const attributed = (map: LoadedMap): boolean => {
        const inner = map.getContainer().querySelector('.mapboxgl-ctrl-attrib-inner');
        return inner?.textContent.trim() !== '';
    };
    return !creating(document) && maps.every((map) => map.loaded() && attributed(map));
}

/**
 * Waits, at most `MAPS_LOADED_MS`, until the page's maps have loaded and filled their attribution: an admin page opens its
 * map while the state shows, and Mapbox fills its attribution only after the style's sources load (a state checked
 * earlier would miss it: the admin tour at 915 × 412 did, once in four). A map that never loads is checked as it is:
 * the legal check then names what it lacks.
 */
async function mapsLoaded(page: Page): Promise<void> {
    await page.waitForFunction(mapsLoadedInPage, undefined, { timeout: MAPS_LOADED_MS }).catch(() => undefined);
}

/**
 * The `no-blank-scroll` checker (e2e/support/blank-scroll-probe.ts): an app shell's page never scrolls nor overscrolls,
 * a document ends at its last element. `blankScrollOf` answers the page's violations; `assertNoBlankScroll` is the
 * tour's soft assertion, reported with its outlined screenshot.
 */
export async function blankScrollOf(page: Page): Promise<Violation[]> {
    const measure = await callInPage<BlankScrollMeasure>(page, [...DOM_WALK, ...BLANK_SCROLL_PROBE], measureBlankScroll);
    return blankScrollViolations(measure);
}

async function assertNoBlankScroll(page: Page, state: string): Promise<void> {
    const found = await blankScrollOf(page);
    await reportViolations(page, state, found);
    expect.soft(violationLines(state, found), `${state}: no blank space to scroll into`).toEqual([]);
}

/** Checks the state the page is in (see `StateVisit`); with `escape`, the page is left with its popup closed. */
export async function expectStateSound(page: Page, visit: StateVisit): Promise<void> {
    await mapsLoaded(page);
    await saveStateShots(page, visit.id, visit.lang);
    const layout = await assertLayoutSound(page, visit.id, { report: false });
    const accessibility = await assertAccessible(page, visit.id, {
        layout,
        reportWith: layout.violations,
        announcements: visit.announcements ?? [],
        skipRules: visit.skipRules ?? [],
    });
    await assertNoBlankScroll(page, visit.id);
    await assertScrolledSound(page, visit.id, [...layout.violations, ...accessibility], { skipRules: visit.skipRules ?? [] });
    const name = visit.title === undefined ? visit.id : `${visit.id} (${visit.title})`;
    expect.soft(await i18nLeaks(page, visit.lang), `${name}: message keys, or English in a Romanian page`).toEqual([]);
    if (visit.escape !== undefined) {
        await assertEscapeCloses(page, visit.id, visit.escape.opener);
    }
}
