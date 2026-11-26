import type { ControlContrast, ExpectedStop, FocusEntry, FocusStop, Landmark, Named } from './a11y-probe.js';
import type { Rect } from './dom-walk.js';
import type { LayoutSnapshot } from './layout-probe.js';
import { isTouchClass, related, refOf, type WindowClass } from './layout-rules.js';
import type { LiveEntry } from './live-regions.js';
import { elementText, type ElementRef, type Violation } from './violations.js';

/**
 * The Node half of the generic accessibility checker (e2e/support/a11y.ts → `assertAccessible`): pure rules over what
 * e2e/support/a11y-probe.ts and the layout snapshot report, unit-tested in e2e/test/a11y-rules.test.ts.
 */

/** WCAG 2.5.8 (AA): a pointer target is at least 24 × 24 CSS px, or spaced so a 24 px circle on it touches no other. */
const WCAG_TARGET_PX = 24;
/** M3: touch targets of at least 48 × 48 dp, held on compact and medium windows. */
const M3_TARGET_PX = 48;
/** WCAG 1.4.11 and 2.4.13: control boundaries, states and focus indicators reach 3:1 against what is around them. */
const NON_TEXT_CONTRAST = 3;

/** An element of the accessibility probes as a violation names it. */
function namedRef(named: Named): ElementRef {
    return { name: named.name, selector: named.selector, box: named.box };
}

interface Target {
    readonly node: number;
    readonly box: Rect;
    readonly ref: ElementRef;
    readonly small: boolean;
    readonly inline: boolean;
    readonly thirdParty: boolean;
}

/** The pointer targets a visitor can use, each as the box a pointer can hit, centred on the element. */
export function pointerTargets(snapshot: LayoutSnapshot): Target[] {
    return snapshot.interactives.flatMap((control): Target[] => {
        const node = snapshot.nodes[control.node];
        const unusable = control.screenReaderOnly || control.inert || control.ariaHidden || control.disabled || control.modal === 'outside';
        if (node === undefined || unusable) {
            return [];
        }
        if (node.visible === null) {
            return [];
        }
        const { width, height } = control.target;
        const box = { x: node.box.x + node.box.width / 2 - width / 2, y: node.box.y + node.box.height / 2 - height / 2, width, height };
        const small = Math.min(width, height) + 0.5 < WCAG_TARGET_PX;
        return [{ node: control.node, box, ref: refOf(node), small, inline: control.inline, thirdParty: control.thirdParty }];
    });
}

/** Whether a circle of `radius` around the centre of `box` reaches into `other`. */
export function circleMeets(box: Rect, radius: number, other: Rect): boolean {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const nearestX = Math.max(other.x, Math.min(cx, other.x + other.width));
    const nearestY = Math.max(other.y, Math.min(cy, other.y + other.height));
    return Math.hypot(cx - nearestX, cy - nearestY) < radius;
}

/** Whether `outer` holds all of `inner` (a control drawn on a larger target, as any control over the map's canvas). */
export function holds(outer: Rect, inner: Rect): boolean {
    return (
        outer.x <= inner.x &&
        outer.y <= inner.y &&
        outer.x + outer.width >= inner.x + inner.width &&
        outer.y + outer.height >= inner.y + inner.height
    );
}

/**
 * WCAG 2.5.8's spacing exception: the 24 px circle on an undersized target meets no other target and no other circle.
 * A target the small one lies on (the map's canvas under a control) is its background, not a neighbour.
 */
function spacedEnough(target: Target, targets: readonly Target[], snapshot: LayoutSnapshot): boolean {
    const radius = WCAG_TARGET_PX / 2;
    return targets
        .filter((other) => !related(snapshot.nodes, target.node, other.node) && !holds(other.box, target.box))
        .every((other) => {
            const centre = (box: Rect): [number, number] => [box.x + box.width / 2, box.y + box.height / 2];
            const [ax, ay] = centre(target.box);
            const [bx, by] = centre(other.box);
            const circles = other.small && Math.hypot(ax - bx, ay - by) < 2 * radius;
            return !circles && !circleMeets(target.box, radius, other.box);
        });
}

/** Target sizes: WCAG 2.5.8 everywhere (inline links exempt), M3's 48 px on compact and medium (Mapbox's own controls aside). */
export function targetSizeViolations(snapshot: LayoutSnapshot, windowClass: WindowClass): Violation[] {
    const targets = pointerTargets(snapshot);
    return targets.flatMap((target): Violation[] => {
        const size = `${String(Math.round(target.box.width))}x${String(Math.round(target.box.height))}`;
        if (target.inline) {
            return [];
        }
        if (target.small && !spacedEnough(target, targets, snapshot)) {
            const message = `${elementText(target.ref)} is a ${size} pointer target, under 24 x 24 and too close to another (WCAG 2.5.8)`;
            return [{ check: 'target-size', message, elements: [target.ref] }];
        }
        const m3 = isTouchClass(windowClass) && !target.thirdParty && Math.min(target.box.width, target.box.height) + 0.5 < M3_TARGET_PX;
        const message = `${elementText(target.ref)} is a ${size} touch target, under M3's 48 x 48 on a ${windowClass} window`;
        return m3 ? [{ check: 'target-size', message, elements: [target.ref] }] : [];
    });
}

/** The focus stops of a walk, without the moments the focus left the page. */
export function stopsOf(walk: readonly FocusEntry[]): FocusStop[] {
    return walk.filter((entry): entry is FocusStop => 'id' in entry);
}

/**
 * The stops of a walk with presses that stayed on one element taken once (the fields of a native date input are one
 * control); the focus leaving the page between two stops keeps both.
 */
export function distinctRuns(walk: readonly FocusEntry[]): FocusStop[] {
    return walk.filter((entry, index): entry is FocusStop => {
        const before = walk[index - 1];
        return 'id' in entry && !(before !== undefined && 'id' in before && before.id === entry.id);
    });
}

/** One round of the Tab order: the stops from the first until it comes back (null when it never does). */
export function roundOf(stops: readonly FocusStop[]): FocusStop[] | null {
    const [first] = stops;
    const back = stops.findIndex((stop, index) => index > 0 && stop.id === first?.id);
    return back === -1 ? null : stops.slice(0, back);
}

/** What is wrong with one focus stop: hidden, without a ring, a faint ring, covered, or outside the open modal. */
export function stopViolations(stop: FocusStop, modalOpen: boolean): Violation[] {
    const ref = namedRef(stop);
    const found: Violation[] = [];
    if (stop.box === null) {
        found.push({ check: 'focus-order', message: `Tab reaches ${elementText(ref)}, which nobody can see`, elements: [ref] });
    } else if (stop.obscured) {
        found.push({
            check: 'focus-obscured',
            message: `the focused ${elementText(ref)} is hidden under other content (WCAG 2.4.11)`,
            elements: [ref],
        });
    }
    if (!stop.ring) {
        found.push({ check: 'focus-ring', message: `${elementText(ref)} shows no focus indicator when Tab reaches it`, elements: [ref] });
    } else if (stop.ringContrast !== null && stop.ringContrast < NON_TEXT_CONTRAST) {
        const ratio = stop.ringContrast.toFixed(2);
        found.push({
            check: 'focus-ring',
            message: `the focus ring of ${elementText(ref)} has ${ratio}:1 against its surroundings (3:1)`,
            elements: [ref],
        });
    }
    if (stop.ring && stop.ringCutBy !== null) {
        const message = `the focus ring of ${elementText(ref)} is cut off by ${stop.ringCutBy}, which hides its overflow (WCAG 2.4.7)`;
        found.push({ check: 'focus-ring', message, elements: [ref] });
    }
    if (modalOpen && stop.modal === 'outside') {
        found.push({ check: 'modal-escape', message: `Tab leaves the open modal for ${elementText(ref)}`, elements: [ref] });
    }
    return found;
}

/** Whether two boxes share a column (their horizontal extents overlap). */
function sameColumn(first: Rect | null, second: Rect | null): boolean {
    return first !== null && second !== null && Math.min(first.x + first.width, second.x + second.width) > Math.max(first.x, second.x);
}

/**
 * Steps of one round that go back up the page within one column of one component (its markup order is not its visual
 * order); moving from a list on the left to the top of a detail pane on its right is a new column, not a step back.
 */
export function orderViolations(round: readonly FocusStop[]): Violation[] {
    return round.flatMap((previous, index): Violation[] => {
        const stop = round.at(index + 1);
        if (stop?.scope !== previous.scope || stop.content.bottom >= previous.content.top - 1 || !sameColumn(stop.box, previous.box)) {
            return [];
        }
        const message = `Tab goes back up from ${elementText(namedRef(previous))} to ${elementText(namedRef(stop))} inside ${stop.scope}`;
        return [{ check: 'focus-order', message, elements: [namedRef(previous), namedRef(stop)] }];
    });
}

/** The round's coverage: every expected stop exactly once. */
export function coverageViolations(round: readonly FocusStop[], expected: readonly ExpectedStop[]): Violation[] {
    const firstAt = (id: number): number => round.findIndex((other) => other.id === id);
    const twice = round.filter(
        (stop, index) => firstAt(stop.id) === index && round.some((other, at) => at !== index && other.id === stop.id),
    );
    const missing = expected.filter((stop) => firstAt(stop.id) === -1);
    return [
        ...twice.map((stop): Violation => ({
            check: 'focus-order',
            message: `Tab reaches ${elementText(namedRef(stop))} more than once in one round`,
            elements: [namedRef(stop)],
        })),
        ...missing.map((stop): Violation => ({
            check: 'focus-order',
            message: `Tab never reaches ${elementText(namedRef(stop))}`,
            elements: [namedRef(stop)],
        })),
    ];
}

/**
 * The Tab walk: one full round visits every expected stop once, in an order that never climbs back up inside a
 * component, each with a visible ring of 3:1, uncovered; with a modal open it never leaves the modal; the focus never
 * sticks on one element.
 */
export function focusViolations(walk: readonly FocusEntry[], expected: readonly ExpectedStop[], modalOpen: boolean): Violation[] {
    const [first, ...rest] = stopsOf(walk);
    const leaves = modalOpen && walk.some((entry) => 'left' in entry);
    const left: Violation[] = leaves ? [{ check: 'modal-escape', message: 'Tab leaves the page from the open modal', elements: [] }] : [];
    if (first === undefined) {
        return expected.length === 0 ? left : [...left, { check: 'focus-order', message: 'Tab reaches nothing on the page', elements: [] }];
    }
    const stops = [first, ...rest];
    const round = roundOf(distinctRuns(walk));
    if (round === null) {
        return [...left, unfinishedRound(first, rest.at(-1) ?? first, stops)];
    }
    return [
        ...left,
        ...coverageViolations(round, expected),
        ...orderViolations(round),
        ...round.flatMap((stop) => stopViolations(stop, modalOpen)),
    ];
}

/** A walk that never came back to its first stop: stuck on one element (a trap), or too long a round. */
function unfinishedRound(first: FocusStop, last: FocusStop, stops: readonly FocusStop[]): Violation {
    const tail = stops.slice(-3);
    const stuck = tail.length === 3 && tail.every((stop) => stop.id === last.id);
    if (stuck) {
        return {
            check: 'keyboard-trap',
            message: `the focus stays on ${elementText(namedRef(last))}: Tab cannot leave it`,
            elements: [namedRef(last)],
        };
    }
    const message = `Tab did not come back to ${elementText(namedRef(first))} within ${String(stops.length)} presses`;
    return { check: 'focus-order', message, elements: [namedRef(first)] };
}

/** Non-text contrast (WCAG 1.4.11) of the controls that need it, in the named scheme. */
export function contrastViolations(contrasts: readonly ControlContrast[], scheme: string): Violation[] {
    return contrasts
        .filter((control) => control.ratio < NON_TEXT_CONTRAST)
        .map((control) => {
            const what = { state: 'its track, handle and border', field: 'its border', icon: 'its icon' }[control.kind];
            const message = `${elementText(namedRef(control))}: ${what} reach ${control.ratio.toFixed(2)}:1 against the background in ${scheme} (3:1)`;
            return { check: 'non-text-contrast' as const, message, elements: [namedRef(control)] };
        });
}

/** The landmark roles that must carry a name (WCAG 1.3.1, 2.4.1: a region without one is not a landmark at all). */
const NAMED_ROLES = new Set(['navigation', 'complementary', 'region', 'form', 'search']);

/** Landmarks: those that need a name have one, and no two of one role share a name. */
export function landmarkViolations(found: readonly Landmark[]): Violation[] {
    const unnamed = found.filter((landmark) => NAMED_ROLES.has(landmark.role) && landmark.name === '');
    const keyOf = (landmark: Landmark): string => `${landmark.role}\u0000${landmark.name.toLowerCase()}`;
    const keys = found.map(keyOf);
    const shared = found.filter(
        (landmark, index) => keys.indexOf(keyOf(landmark)) === index && keys.filter((key) => key === keyOf(landmark)).length > 1,
    );
    return [
        ...unnamed.map((landmark): Violation => ({
            check: 'landmark',
            message: `the ${landmark.role} landmark ${elementText(namedRef(landmark))} has no name`,
            elements: [namedRef(landmark)],
        })),
        ...shared.map((landmark): Violation => ({
            check: 'landmark',
            message: `more than one ${landmark.role} landmark is named "${landmark.name}"`,
            elements: found.filter((other) => keyOf(other) === keyOf(landmark)).map(namedRef),
        })),
    ];
}

/**
 * A live announcement of `text`: a polite region that existed before the text (a region created with its text is not
 * announced), or an alert (announced as it is inserted).
 */
export function announced(log: readonly LiveEntry[], text: string): boolean {
    return log.some((entry) => entry.text.includes(text) && (entry.role === 'alert' || (!entry.fresh && entry.politeness !== 'off')));
}

/** The announcements a state expects, each a violation when the live log does not hold it. */
export function liveRegionViolations(log: readonly LiveEntry[], expected: readonly string[]): Violation[] {
    return expected
        .filter((text) => !announced(log, text))
        .map((text) => ({
            check: 'live-region' as const,
            message: `"${text}" is never announced by a live region that existed before it`,
            elements: [],
        }));
}
