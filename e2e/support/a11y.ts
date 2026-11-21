import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

import {
    A11Y_PROBE,
    activeName,
    controlContrasts,
    expectedStops,
    landmarks,
    openPopups,
    recordFocus,
    rememberFocus,
    restoreFocus,
} from './a11y-probe.js';
import type { ControlContrast, ExpectedStop, FocusEntry, Landmark } from './a11y-probe.js';
import {
    contrastViolations,
    focusViolations,
    landmarkViolations,
    liveRegionViolations,
    roundOf,
    stopsOf,
    targetSizeViolations,
} from './a11y-rules.js';
import { COLOUR } from './colour.js';
import { DOM_WALK } from './dom-walk.js';
import { callInPage, layoutViolationsOf } from './layout.js';
import { LAYOUT_PROBE, type LayoutSnapshot } from './layout-probe.js';
import { renderedContrastViolations } from './rendered-contrast.js';
import { windowClassOf } from './layout-rules.js';
import { takeLiveLog, type LiveEntry } from './live-regions.js';
import type { PageFunction } from './page-script.js';
import { reportViolations } from './report.js';
import { violationLines, violationShape, type Violation } from './violations.js';

/**
 * The accessibility checks of the tour and a11y tiers (docs/research/design-review-testability.md §4.3; the user's
 * request of 2026-10-12, docs/TESTING.md → *The tour's checkers*). `axeViolations` is axe on the live page (shadow roots
 * included): contrast is judged per theme, so a dark-mode project catches a seed colour that fails there; the map canvas
 * is excluded (no DOM content; Mapbox's controls are checked where they sit). `assertAccessible` is the generic checker
 * every tour state runs: axe with best practices, target sizes, one full Tab round (every stop once, in order, a ring
 * of 3:1, uncovered, no trap, never out of an open modal), the non-text contrast of controls in the page's scheme and in
 * high contrast, named and distinct landmarks, the announcements the state expects, and the layout checks again under
 * the WCAG 1.4.12 text spacing and, on a phone, at 320 CSS px wide (WCAG 1.4.10).
 */
const AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'];

/** What `assertAccessible` runs axe with: every WCAG A and AA level up to 2.2, and axe's best practices. */
const ASSERT_AXE_TAGS: readonly string[] = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'];

/**
 * `css-orientation-lock` parses the page's stylesheets in a scratch document that inherits the page's CSP, whose
 * `style-src` refuses the `<style>` elements axe writes there (its CSSOM preload): under the city sites' policy it
 * cannot run and would only log CSP violations. So the rule is off and nothing is preloaded (the other preload, media
 * readiness, serves audio and video rules; the viewer has neither). The viewer's styles lock no orientation.
 */
const RULES_BLOCKED_BY_THE_PAGE_CSP: readonly string[] = ['css-orientation-lock'];

export interface AxeOptions {
    /** Selectors to limit the check to (the whole page by default). */
    readonly include?: readonly string[];
    /** Rules that do not apply to the page as emulated (the colour rules under forced colours). */
    readonly skipRules?: readonly string[];
    /** The axe tags to run (WCAG 2.0 A and AA, 2.1 AA and 2.2 AA by default). */
    readonly tags?: readonly string[];
    /** These rules only, instead of the tags (the scroll sweep's colour contrast of what each position shows). */
    readonly rules?: readonly string[];
}

export interface AxeViolation {
    readonly id: string;
    readonly impact: string;
    readonly targets: readonly string[];
}

/** Mapbox's canvas: no DOM content (its controls are checked where they sit). */
const MAP_CANVAS = 'canvas.mapboxgl-canvas';

type AxeRunOptions = Parameters<AxeBuilder['options']>[0];
type AxeResults = Awaited<ReturnType<AxeBuilder['analyze']>>;

/** One axe run: the context and options `AxeBuilder` would pass to `axe.run` for these `AxeOptions`. */
interface AxeRun {
    readonly context: { readonly include: string[]; readonly exclude: string[] };
    readonly options: AxeRunOptions;
}

/** The run for `options`, reporting violations only (the passes' nodes are never read, and serialising them is slow). */
function axeRunOf(options: AxeOptions): AxeRun {
    const runOnly: AxeRunOptions['runOnly'] =
        options.rules === undefined
            ? { type: 'tag', values: [...(options.tags ?? AXE_TAGS)] }
            : { type: 'rule', values: [...options.rules] };
    const disabled = [...RULES_BLOCKED_BY_THE_PAGE_CSP, ...(options.skipRules ?? [])];
    return {
        context: { include: [...(options.include ?? [])], exclude: [MAP_CANVAS] },
        options: {
            preload: false,
            resultTypes: ['violations'],
            runOnly,
            rules: Object.fromEntries(disabled.map((id) => [id, { enabled: false }])),
        },
    };
}

/** Runs in the page: `axe.run` when an earlier check of this document injected axe, else null (a new document). */
function runInjectedAxe(run: AxeRun): Promise<AxeResults> | null {
    const axe = (window as unknown as { axe?: { run: (context: AxeRun['context'], options: AxeRunOptions) => Promise<AxeResults> } }).axe;
    return axe === undefined ? null : axe.run(run.context, run.options);
}

/** `AxeBuilder` for `run`; in legacy mode it runs `axe.run` in the page (and injects axe into it) instead of per frame. */
function builderOf(page: Page, run: AxeRun, legacy: boolean): AxeBuilder {
    let builder = new AxeBuilder({ page }).options(run.options).exclude(MAP_CANVAS).setLegacyMode(legacy);
    for (const selector of run.context.include) {
        builder = builder.include(selector);
    }
    return builder;
}

/**
 * The violations on `page` (empty when it passes), optionally limited to `include` selectors. A page of one frame (every
 * page of the apps) runs `axe.run` in place: `AxeBuilder` injects axe on the first check of a document (legacy mode: no
 * per-frame partial runs and no blank page to merge them in), and the later checks of that document (the scroll sweep's
 * positions) reuse it: the same rules and results in a quarter of the time (docs/research/pipeline-baseline.md → *Addendum:
 * the quality review*). A page with frames keeps `AxeBuilder`'s frame-by-frame run, which also tests cross-origin frames.
 */
export async function axeViolations(page: Page, options: AxeOptions = {}): Promise<AxeViolation[]> {
    const run = axeRunOf(options);
    const oneFrame = page.frames().length === 1;
    const injected = oneFrame ? await page.evaluate(runInjectedAxe, run) : null;
    const results = injected ?? (await builderOf(page, run, oneFrame).analyze());
    return results.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact ?? 'unknown',
        targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}

/** What a state asks of `assertAccessible` beyond the generic checks. */
export interface AccessibleOptions {
    /** Texts a live region must have announced since the last check (a toast, an error, a slider's new value). */
    readonly announcements?: readonly string[];
    /** Axe rules that do not apply as emulated (the author-colour rules under forced colours). */
    readonly skipRules?: readonly string[];
    /** The layout snapshot and violations `assertLayoutSound` just took of this state (else it is taken again). */
    readonly layout?: { readonly snapshot: LayoutSnapshot; readonly violations: readonly Violation[] };
    /** Reported with the state's own violations by the caller (one screenshot per state): the layout's from `layout`. */
    readonly reportWith?: readonly Violation[];
}

/** How long a state's announcements may take (the snackbar fills its region a moment after it shows). */
const ANNOUNCEMENT_TIMEOUT_MS = 5_000;

/** Runs in the page: whether the live log holds every text of `texts` (without reading it out). */
function liveLogHolds(texts: readonly string[]): boolean {
    const log = (window as unknown as { hcmLiveLog?: LiveEntry[] }).hcmLiveLog ?? [];
    return texts.every((text) => log.some((entry) => entry.text.includes(text)));
}

/** The live log since the last read, once it holds every expected text or after a few seconds. */
async function announcementsOf(page: Page, expected: readonly string[]): Promise<LiveEntry[]> {
    if (expected.length > 0) {
        await page.waitForFunction(liveLogHolds, expected, { timeout: ANNOUNCEMENT_TIMEOUT_MS }).catch(() => undefined);
    }
    return page.evaluate(takeLiveLog);
}

/** The in-page helpers of the accessibility probes. */
const A11Y_HELPERS: readonly PageFunction[] = [...DOM_WALK, ...COLOUR, ...LAYOUT_PROBE, ...A11Y_PROBE];

function run<T>(page: Page, entry: PageFunction, arg: unknown = null): Promise<T> {
    return callInPage<T>(page, A11Y_HELPERS, entry, arg);
}

/** Two animation frames: the page has drawn what the last action changed. */
async function settled(page: Page): Promise<void> {
    await page.evaluate(
        () =>
            new Promise<void>((resolve) => {
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        resolve();
                    });
                });
            }),
    );
}

/** Presses Tab `presses` times, recording where the focus lands each time. */
async function tabWalk(page: Page, presses: number): Promise<FocusEntry[]> {
    const walk: FocusEntry[] = [];
    for (let press = 0; press < presses; press += 1) {
        await page.keyboard.press('Tab');
        walk.push(await run<FocusEntry>(page, recordFocus));
    }
    return walk;
}

/**
 * One full round of the Tab order from where the focus is now (a second batch of presses when the first did not come
 * back to its start, as elements the page did not list may take a stop), then the focus goes back where it was.
 */
async function focusRound(page: Page, modalOpen: boolean): Promise<Violation[]> {
    const expected = await run<ExpectedStop[]>(page, expectedStops);
    await run(page, rememberFocus);
    const presses = expected.length + 3;
    let walk: FocusEntry[] = [];
    for (let batch = 0; batch < 3 && roundOf(stopsOf(walk)) === null; batch += 1) {
        walk = [...walk, ...(await tabWalk(page, presses))];
    }
    // Tab past the last element hands the focus to the browser, and the page then has none (a clipboard write needs
    // it): one more Tab brings it back into the page before the focus returns where it was.
    const last = walk.at(-1);
    if (last !== undefined && 'left' in last) {
        await page.keyboard.press('Tab');
    }
    await run(page, restoreFocus);
    return focusViolations(walk, expected, modalOpen);
}

/**
 * Non-text contrast in the page's scheme and, unless colours are forced, in its high-contrast scheme; and the contrast
 * the FAB menu's controls are painted with, read from the screen (`rendered-contrast.ts`).
 */
export async function contrastChecks(page: Page): Promise<Violation[]> {
    const scheme = (await page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)) ? 'dark' : 'light';
    const found = [
        ...contrastViolations(await run<ControlContrast[]>(page, controlContrasts), scheme),
        ...(await renderedContrastViolations(page, scheme)),
    ];
    if (await page.evaluate(() => matchMedia('(forced-colors: active)').matches)) {
        return found;
    }
    await page.emulateMedia({ contrast: 'more' });
    await settled(page);
    const high = contrastViolations(await run<ControlContrast[]>(page, controlContrasts), `${scheme} high contrast`);
    await page.emulateMedia({ contrast: null });
    await settled(page);
    return [...found, ...high];
}

/** WCAG 1.4.12: these spacings, set by a reader's stylesheet, must not cut or overlap any text. */
const TEXT_SPACING = `* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-block-end: 2em !important; }`;

/** Runs in the page: adds (or, with `on` false, removes) the text-spacing sheet in the document and every shadow root. */
function textSpacing([on, rules]: readonly [boolean, string]): void {
    const scope = window as unknown as { hcmTextSpacing?: CSSStyleSheet };
    scope.hcmTextSpacing ??= new CSSStyleSheet();
    const sheet = scope.hcmTextSpacing;
    sheet.replaceSync(rules);
    const roots: (Document | ShadowRoot)[] = [document];
    // The loop also visits the roots it adds, as for...of walks a growing array to its end.
    for (const root of roots) {
        for (const element of Array.from(root.querySelectorAll('*'))) {
            if (element.shadowRoot !== null) {
                roots.push(element.shadowRoot);
            }
        }
    }
    for (const root of roots) {
        const others = root.adoptedStyleSheets.filter((adopted) => adopted !== sheet);
        root.adoptedStyleSheets = on ? [...others, sheet] : others;
    }
}

/** The layout violations that `change` brings about which the state did not have already. */
async function layoutUnder(
    page: Page,
    base: readonly Violation[],
    change: () => Promise<void>,
    undo: () => Promise<void>,
): Promise<Violation[]> {
    await change();
    await settled(page);
    const { violations } = await layoutViolationsOf(page);
    await undo();
    await settled(page);
    // The same violation at other coordinates (a narrower viewport moves everything) is the state's own, not a new one.
    const known = new Set(base.map(violationShape));
    return violations.filter((violation) => !known.has(violationShape(violation)));
}

/** A phone held upright and wider than 320 CSS px: the reflow check narrows it to 320 (a 320 px project is there already). */
function reflowWidth(page: Page): number | null {
    const viewport = page.viewportSize();
    return viewport !== null && viewport.width > 320 && viewport.width < 600 && viewport.height >= 480 ? 320 : null;
}

/** The text-spacing (WCAG 1.4.12) and reflow (WCAG 1.4.10) variants of the layout checks. */
async function adaptationChecks(page: Page, base: readonly Violation[]): Promise<{ spacing: Violation[]; reflow: Violation[] }> {
    const spacing = await layoutUnder(
        page,
        base,
        () => page.evaluate(textSpacing, [true, TEXT_SPACING] as const),
        () => page.evaluate(textSpacing, [false, ''] as const),
    );
    const width = reflowWidth(page);
    const viewport = page.viewportSize();
    if (width === null || viewport === null) {
        return { spacing, reflow: [] };
    }
    const reflow = await layoutUnder(
        page,
        base,
        () => page.setViewportSize({ width, height: viewport.height }),
        () => page.setViewportSize(viewport),
    );
    return { spacing, reflow };
}

/** Axe's findings as violations (its selectors name the elements; boxes are not known). */
export function axeRecords(found: readonly AxeViolation[]): Violation[] {
    return found.map((violation) => ({
        check: 'axe' as const,
        message: `${violation.id} (${violation.impact}): ${violation.targets.join(' | ')}`,
        elements: violation.targets.map((target) => ({ name: '', selector: target, box: null })),
    }));
}

/**
 * Checks every accessibility invariant of the state the page is in, as soft assertions so a tour reports every state;
 * the violations are recorded and attached with an outlined screenshot. The page is left as it was: the focus goes back
 * where it was, the text spacing, the viewport and the contrast emulation are undone.
 */
export async function assertAccessible(page: Page, state: string, options: AccessibleOptions = {}): Promise<Violation[]> {
    const live = await announcementsOf(page, options.announcements ?? []);
    const axe = axeRecords(await axeViolations(page, { tags: ASSERT_AXE_TAGS, skipRules: options.skipRules ?? [] }));
    const { snapshot, violations: layout } = options.layout ?? (await layoutViolationsOf(page));
    const targets = targetSizeViolations(snapshot, windowClassOf(snapshot.viewport.width));
    const named = landmarkViolations(await run<Landmark[]>(page, landmarks));
    const announcements = liveRegionViolations(live, options.announcements ?? []);
    const contrast = await contrastChecks(page);
    const focus = await focusRound(page, snapshot.modals.length > 0);
    const { spacing, reflow } = await adaptationChecks(page, layout);
    const groups: readonly [string, readonly Violation[]][] = [
        [state, [...axe, ...targets, ...named, ...announcements, ...contrast, ...focus]],
        [`${state} + text spacing`, spacing],
        [`${state} at 320 px`, reflow],
    ];
    for (const [index, [name, violations]] of groups.entries()) {
        // One outlined screenshot per state, of the state as it is; the variants' boxes are of a page now undone.
        const reported = index === 0 ? [...(options.reportWith ?? []), ...violations] : violations;
        await reportViolations(page, name, reported, index === 0);
        expect.soft(violationLines(name, violations), `${name}: accessible`).toEqual([]);
    }
    return groups.flatMap(([, violations]) => violations);
}

/**
 * Checks that Esc closes the open popup or modal surface and gives the focus back to `opener` (its accessible name),
 * when the state was opened from one; soft, like the other checks. The page is left with the popup closed.
 */
export async function assertEscapeCloses(page: Page, state: string, opener: string | null): Promise<void> {
    const soft = expect.configure({ soft: true });
    const open = await run<string[]>(page, openPopups);
    await page.keyboard.press('Escape');
    // The popup on top closes; one beneath it (the photo sheet under the lightbox) is then on top and stays.
    const closed = async (): Promise<boolean> => {
        const after = await run<string[]>(page, openPopups);
        return open.some((popup) => !after.includes(popup));
    };
    await soft.poll(closed, { message: `${state}: Esc closes the popup on top` }).toBe(true);
    if (opener !== null) {
        await soft.poll(() => run<string>(page, activeName), { message: `${state}: the focus returns to ${opener}` }).toBe(opener);
    }
}
