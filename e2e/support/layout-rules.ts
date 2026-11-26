import type { Rect } from './dom-walk.js';
import type { ChromeInfo, InteractiveInfo, LayoutSnapshot, NodeInfo, Sample, TextInfo } from './layout-probe.js';
import { boxText, elementText, type ElementRef, type Violation } from './violations.js';

/**
 * The Node half of the generic layout checker (e2e/support/layout.ts → `assertLayoutSound`): pure rules over the
 * snapshot of e2e/support/layout-probe.ts, unit-tested in e2e/test/layout-rules.test.ts. Every violation names the
 * elements involved (accessible name, selector, box).
 */

/** M3 window classes (compact < 600 ≤ medium < 840 ≤ expanded < 1200 ≤ large < 1600 ≤ extra-large). */
export type WindowClass = 'compact' | 'medium' | 'expanded' | 'large' | 'extra-large';

/**
 * A sanctioned stacking: chrome of kind `over` may cover chrome of kind `under` (`*`: any), for the reason given. A
 * popup is an `over` whose `under` is `*` or `content`: the points it covers are exempt from the occlusion check, and
 * with `content` (the map and what is drawn on it, no floating chrome) it must still keep clear of the other chrome. The
 * list is e2e/support/layout.ts → `SANCTIONED_STACKINGS`, kept minimal and documented in docs/TESTING.md.
 */
export interface Sanctioned {
    readonly over: string;
    readonly under: string;
    readonly why: string;
}

export interface LayoutContext {
    readonly windowClass: WindowClass;
    readonly sanctioned: readonly Sanctioned[];
}

/** Touch targets on compact and medium windows keep this much space between them (M3: 8 dp). */
const TARGET_GAP_PX = 8;

/**
 * Chrome that is a surface, not a touch target: a sheet, a navigation bar or rail, a top bar. Their edges meet other
 * bars by design (a navigation rail beside a top bar); the controls on them are checked by occlusion.
 */
const SURFACE_KINDS: ReadonlySet<string> = new Set(['sheet', 'navigation', 'top-bar']);

/** Overlaps up to this many CSS px in either direction are rounding, not overlap. */
const TOLERANCE_PX = 1;

/** Whether the window class is compact or medium (where M3's touch-target rules apply). */
export function isTouchClass(windowClass: WindowClass): boolean {
    return windowClass === 'compact' || windowClass === 'medium';
}

/** The window class of a viewport width. */
export function windowClassOf(width: number): WindowClass {
    const classes: readonly [number, WindowClass][] = [
        [600, 'compact'],
        [840, 'medium'],
        [1200, 'expanded'],
        [1600, 'large'],
    ];
    return classes.find(([limit]) => width < limit)?.[1] ?? 'extra-large';
}

/** An element of the snapshot as a violation names it (its visible part, else its whole box). */
export function refOf(node: NodeInfo): ElementRef {
    return { name: node.name, selector: node.selector, box: node.visible ?? node.box };
}

/** The overlap of two boxes beyond the tolerance, or null. */
export function overlapOf(first: Rect, second: Rect): Rect | null {
    const x = Math.max(first.x, second.x);
    const y = Math.max(first.y, second.y);
    const width = Math.min(first.x + first.width, second.x + second.width) - x;
    const height = Math.min(first.y + first.height, second.y + second.height) - y;
    return width > TOLERANCE_PX && height > TOLERANCE_PX ? { x, y, width, height } : null;
}

/** The empty space between two boxes (0 when they touch or overlap). */
export function gapBetween(first: Rect, second: Rect): number {
    const dx = Math.max(0, second.x - (first.x + first.width), first.x - (second.x + second.width));
    const dy = Math.max(0, second.y - (first.y + first.height), first.y - (second.y + second.height));
    return dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
}

/** Whether one of two elements contains the other in the flat tree (a part is never compared with its whole). */
export function related(nodes: readonly NodeInfo[], first: number, second: number): boolean {
    return first === second || (nodes[first]?.ancestors.includes(second) ?? false) || (nodes[second]?.ancestors.includes(first) ?? false);
}

function nodeAt(snapshot: LayoutSnapshot, id: number): NodeInfo {
    const node = snapshot.nodes[id];
    if (node === undefined) {
        throw new Error(`the layout snapshot has no element ${String(id)}`);
    }
    return node;
}

/** The covered points in words (`first` of `count` covered out of `total` sampled), and what covers the first. */
function failedSampleText(snapshot: LayoutSnapshot, first: Sample, count: number, total: number): { text: string; hit: ElementRef[] } {
    const hit = first.hit === null ? null : nodeAt(snapshot, first.hit);
    const where = ` (first at ${String(Math.round(first.x))},${String(Math.round(first.y))})`;
    const by = hit === null ? 'nothing of the page' : elementText(refOf(hit));
    return {
        text: `${String(count)} of ${String(total)} sampled points${where} hit ${by}`,
        hit: hit === null ? [] : [refOf(hit)],
    };
}

/** Whether the element `hit` lies in chrome sanctioned to cover anything (the open FAB menu, a transient popup). */
function inSanctionedPopup(snapshot: LayoutSnapshot, sanctioned: readonly Sanctioned[], hit: number | null): boolean {
    const popups = new Set(sanctioned.filter((rule) => rule.under === '*' || rule.under === 'content').map((rule) => rule.over));
    const chain = hit === null ? [] : [hit, ...nodeAt(snapshot, hit).ancestors];
    return snapshot.chrome.some((chrome) => popups.has(chrome.kind) && chain.includes(chrome.node));
}

/**
 * At most this many CSS px of a control shown at the edge of what scrolls: Chromium hit-tests the last fraction of a
 * pixel at a scroller's clip as the element beyond it (a 4 px sliver of a field at the bottom of a dialog's scrolling
 * content was "covered" by the dialog's actions: input at 707 px, actions at 707.5 px, the clip at 708 px; CR-M2c-29),
 * and the visitor scrolls the control into view anyway. The state checker scrolls every scroller through its content
 * (e2e/support/state-check.ts), so the control is checked whole at another position.
 */
const SLIVER_PX = 5;

/** Whether only a sliver of the control shows, cut on an axis it scrolls on (by a scroller or the page). */
export function scrolledToASliver(control: InteractiveInfo, node: NodeInfo): boolean {
    const visible = node.visible;
    if (visible === null) {
        return false;
    }
    const cutY = control.scrolls.y && visible.height <= SLIVER_PX && node.box.height > visible.height + TOLERANCE_PX;
    const cutX = control.scrolls.x && visible.width <= SLIVER_PX && node.box.width > visible.width + TOLERANCE_PX;
    return cutY || cutX;
}

/**
 * (a) Every usable interactive element is on top where it is drawn (a point under a sanctioned popup aside, a sliver at
 * a scroller's edge aside: `scrolledToASliver`); outside an open modal, none is usable.
 */
export function occlusionViolations(snapshot: LayoutSnapshot, sanctioned: readonly Sanctioned[] = []): Violation[] {
    const [modal] = snapshot.modals;
    return snapshot.interactives.flatMap((control): Violation[] => {
        const node = nodeAt(snapshot, control.node);
        if (control.screenReaderOnly || node.visible === null) {
            return [];
        }
        if (control.modal !== 'outside' && scrolledToASliver(control, node)) {
            return [];
        }
        if (control.modal === 'outside') {
            const usable = !control.inert && !control.ariaHidden && control.focusable;
            const surface = modal === undefined ? 'a modal surface' : elementText(refOf(nodeAt(snapshot, modal)));
            const message = `${elementText(refOf(node))} is outside the open modal ${surface} yet not inert, not aria-hidden and in the Tab order`;
            return usable ? [{ check: 'modal-escape', message, elements: [refOf(node)] }] : [];
        }
        // Content scrolled under a fixed bar is not covered for good: it scrolls out (focus-obscured checks the focused).
        const scrolledUnder = (sample: Sample): boolean => sample.pinned && (control.scrolls.y || control.scrolls.x);
        const covered = control.samples.filter(
            (sample) => !sample.ok && !scrolledUnder(sample) && !inSanctionedPopup(snapshot, sanctioned, sample.hit),
        );
        const [first] = covered;
        if (control.inert || control.ariaHidden || first === undefined) {
            return [];
        }
        const failed = failedSampleText(snapshot, first, covered.length, control.samples.length);
        return [
            {
                check: 'occlusion',
                message: `${elementText(refOf(node))} is covered: ${failed.text}`,
                elements: [refOf(node), ...failed.hit],
            },
        ];
    });
}

/** A piece of usable chrome and the part of it a visitor sees. */
type SeenChrome = ChromeInfo & { readonly rect: Rect };

/** The usable chrome, without an element that contains other chrome (its parts stand for it). */
export function usableChrome(snapshot: LayoutSnapshot): SeenChrome[] {
    const usable = snapshot.chrome.flatMap((chrome): SeenChrome[] => {
        const rect = nodeAt(snapshot, chrome.node).visible;
        return chrome.usable && rect !== null ? [{ ...chrome, rect }] : [];
    });
    return usable.filter(
        (chrome) => !usable.some((other) => other !== chrome && nodeAt(snapshot, other.node).ancestors.includes(chrome.node)),
    );
}

/** Whether `over` may cover `under` (or the other way round) by a sanctioned stacking. */
export function isSanctioned(sanctioned: readonly Sanctioned[], first: string, second: string): boolean {
    const allows = (over: string, under: string): boolean =>
        sanctioned.some((rule) => rule.over === over && (rule.under === '*' || rule.under === under));
    return allows(first, second) || allows(second, first);
}

/** The pairs of `items` whose elements are not related, each once. */
function pairs<T extends { readonly node: number }>(snapshot: LayoutSnapshot, items: readonly T[]): [T, T][] {
    return items.flatMap((first, index) =>
        items
            .slice(index + 1)
            .filter((second) => !related(snapshot.nodes, first.node, second.node))
            .map((second): [T, T] => [first, second]),
    );
}

/** (b) No two pieces of usable floating chrome overlap, except a sanctioned stacking. */
export function overlapViolations(snapshot: LayoutSnapshot, context: LayoutContext): Violation[] {
    return pairs(snapshot, usableChrome(snapshot)).flatMap(([first, second]): Violation[] => {
        const a = nodeAt(snapshot, first.node);
        const b = nodeAt(snapshot, second.node);
        const overlap = overlapOf(first.rect, second.rect);
        if (overlap === null || isSanctioned(context.sanctioned, first.kind, second.kind)) {
            return [];
        }
        const message = `${first.kind} ${elementText(refOf(a))} overlaps ${second.kind} ${elementText(refOf(b))} by ${boxText(overlap)}`;
        return [{ check: 'overlap', message, elements: [refOf(a), refOf(b)] }];
    });
}

/** Whether a piece of chrome is, or holds, a usable interactive element (a touch target). */
function isTarget(snapshot: LayoutSnapshot, chrome: ChromeInfo): boolean {
    return snapshot.interactives.some(
        (control) =>
            !control.inert &&
            !control.ariaHidden &&
            (control.node === chrome.node || nodeAt(snapshot, control.node).ancestors.includes(chrome.node)),
    );
}

/** (b) On compact and medium windows, floating touch targets of different components keep 8 px apart. */
export function gapViolations(snapshot: LayoutSnapshot, context: LayoutContext): Violation[] {
    if (!isTouchClass(context.windowClass)) {
        return [];
    }
    const targets = usableChrome(snapshot).filter((chrome) => !SURFACE_KINDS.has(chrome.kind) && isTarget(snapshot, chrome));
    return pairs(snapshot, targets).flatMap(([first, second]): Violation[] => {
        const a = nodeAt(snapshot, first.node);
        const b = nodeAt(snapshot, second.node);
        const sameComponent = first.group !== null && first.group === second.group;
        if (sameComponent || overlapOf(first.rect, second.rect) !== null) {
            return [];
        }
        const gap = gapBetween(first.rect, second.rect);
        if (gap >= TARGET_GAP_PX || isSanctioned(context.sanctioned, first.kind, second.kind)) {
            return [];
        }
        const message = `${first.kind} ${elementText(refOf(a))} is ${gap.toFixed(1)} px from ${second.kind} ${elementText(refOf(b))} (at least ${String(TARGET_GAP_PX)})`;
        return [{ check: 'gap', message, elements: [refOf(a), refOf(b)] }];
    });
}

/** Which sides of the viewport a box crosses (it must still show partly; a box wholly off screen is not drawn there). */
export function crossedSides(box: Rect, viewport: { readonly width: number; readonly height: number }): { x: boolean; y: boolean } | null {
    const onScreen = box.x < viewport.width && box.y < viewport.height && box.x + box.width > 0 && box.y + box.height > 0;
    if (!onScreen) {
        return null;
    }
    const x = box.x < -TOLERANCE_PX || box.x + box.width > viewport.width + TOLERANCE_PX;
    const y = box.y < -TOLERANCE_PX || box.y + box.height > viewport.height + TOLERANCE_PX;
    return x || y ? { x, y } : null;
}

/** The message of an element cut off by an ancestor nobody can scroll, or partly off a viewport nothing scrolls. */
function edgeMessage(snapshot: LayoutSnapshot, kind: string, node: NodeInfo, cutBy: number | null): string {
    const what = `${kind} ${elementText({ ...refOf(node), box: node.box })}`;
    if (cutBy !== null) {
        return `${what} is cut off by ${elementText(refOf(nodeAt(snapshot, cutBy)))}, which hides its overflow and does not scroll`;
    }
    return `${what} is partly outside the ${String(snapshot.viewport.width)}x${String(snapshot.viewport.height)} viewport`;
}

/**
 * (c) No usable interactive element or text is partly off screen unless something scrolls it into view on that axis,
 * and none is cut off by an ancestor that hides its overflow without scrolling (the rest of it is out of reach).
 */
export function edgeViolations(snapshot: LayoutSnapshot): Violation[] {
    const usable = snapshot.interactives.filter(
        (control) => !control.screenReaderOnly && !control.inert && !control.ariaHidden && control.modal !== 'outside',
    );
    const texts = snapshot.texts.filter((text) => !text.thirdParty);
    const candidates = [...usable.map((control) => ({ ...control, kind: 'control' })), ...texts.map((text) => ({ ...text, kind: 'text' }))];
    const seen = new Set<number>();
    return candidates.flatMap((candidate): Violation[] => {
        const node = nodeAt(snapshot, candidate.node);
        const crossed = crossedSides(node.box, snapshot.viewport);
        const offScreen = crossed !== null && ((crossed.x && !candidate.scrolls.x) || (crossed.y && !candidate.scrolls.y));
        const cut = candidate.cutBy !== null && node.visible !== null;
        if (seen.has(candidate.node) || (!offScreen && !cut)) {
            return [];
        }
        seen.add(candidate.node);
        const elements = [
            { ...refOf(node), box: node.box },
            ...(cut && candidate.cutBy !== null ? [refOf(nodeAt(snapshot, candidate.cutBy))] : []),
        ];
        return [{ check: 'edge', message: edgeMessage(snapshot, candidate.kind, node, cut ? candidate.cutBy : null), elements }];
    });
}

/** (c) The page never scrolls sideways; the message names what sticks out. */
export function pageScrollViolations(snapshot: LayoutSnapshot): Violation[] {
    const overflow = snapshot.page.scrollWidth - snapshot.viewport.width;
    if (overflow <= 0) {
        return [];
    }
    const wide = snapshot.nodes.filter((node) => node.box.x + node.box.width > snapshot.viewport.width + TOLERANCE_PX).slice(0, 3);
    const names = wide.map((node) => elementText({ ...refOf(node), box: node.box })).join('; ');
    const culprits = names === '' ? '' : ': ' + names;
    const message = `the page scrolls ${String(overflow)} px sideways${culprits}`;
    return [{ check: 'page-scroll', message, elements: wide.map((node) => ({ ...refOf(node), box: node.box })) }];
}

/** (c) Nothing scrolls sideways inside the page either (WCAG 1.4.10): the message names what sticks out, when an element does. */
export function sidewaysScrollViolations(snapshot: LayoutSnapshot): Violation[] {
    return snapshot.sideways.map((scroller) => {
        const node = refOf(nodeAt(snapshot, scroller.node));
        const culprits = scroller.culprits.map((id) => refOf(nodeAt(snapshot, id)));
        const named = culprits.length === 0 ? '' : `: ${culprits.map((culprit) => elementText(culprit)).join('; ')}`;
        const message = `${elementText(node)} scrolls sideways, its content ${String(Math.round(scroller.overflow))} px wider than it${named}`;
        return { check: 'sideways-scroll', message, elements: [node, ...culprits] };
    });
}

/** (d) With a map on screen, exactly one Mapbox logo and one attribution are visible, and nothing covers them. */
export function legalViolations(snapshot: LayoutSnapshot): Violation[] {
    if (!snapshot.legal.map) {
        return [];
    }
    const { owes } = snapshot.legal;
    const kinds = [
        ['Mapbox logo', snapshot.legal.logos, owes.logo],
        ['map attribution', snapshot.legal.attributions, owes.attribution],
    ] as const;
    return kinds.flatMap(([label, items, owed]): Violation[] => {
        const nodes = items.map((item) => refOf(nodeAt(snapshot, item.node)));
        // Owed or not, two of a kind are one too many; none is wrong only where the strip of the map reaches it.
        const counted: Violation[] =
            items.length === 1 || (items.length === 0 && !owed)
                ? []
                : [
                      {
                          check: 'legal',
                          message: `${String(items.length)} visible ${label}s instead of exactly one (Mapbox terms)`,
                          elements: nodes,
                      },
                  ];
        const covered = items.flatMap((item): Violation[] => {
            const failing = item.samples.filter((sample) => !sample.ok);
            const [first] = failing;
            if (first === undefined) {
                return [];
            }
            const node = refOf(nodeAt(snapshot, item.node));
            const failed = failedSampleText(snapshot, first, failing.length, item.samples.length);
            return [
                {
                    check: 'legal',
                    message: `the ${label} ${elementText(node)} is covered: ${failed.text}`,
                    elements: [node, ...failed.hit],
                },
            ];
        });
        return [...counted, ...covered];
    });
}

/** (e) No label cuts its own text (an ellipsis too: the tour has always required every label to fit). */
export function clippedTextViolations(snapshot: LayoutSnapshot): Violation[] {
    return snapshot.texts
        .filter((text) => text.clipped && !text.thirdParty)
        .map((text) => {
            const node = refOf(nodeAt(snapshot, text.node));
            return { check: 'clipped-text', message: `${elementText(node)} cuts its text`, elements: [node] };
        });
}

/** (e) No visible text runs over another text. */
export function textOverlapViolations(snapshot: LayoutSnapshot): Violation[] {
    const shown = snapshot.texts.filter((text) => text.shown);
    return pairs(snapshot, shown).flatMap(([first, second]): Violation[] => {
        const overlap = first.lines.flatMap((line) => second.lines.map((other) => overlapOf(line, other))).find((box) => box !== null);
        if (overlap === undefined) {
            return [];
        }
        const a = refOf(nodeAt(snapshot, first.node));
        const b = refOf(nodeAt(snapshot, second.node));
        return [
            {
                check: 'text-overlap',
                message: `the text of ${elementText(a)} runs over ${elementText(b)} at ${boxText(overlap)}`,
                elements: [a, b],
            },
        ];
    });
}

/** The part of a text's lines a box covers beyond the tolerance, or null. */
function coveredLine(text: TextInfo, box: Rect): Rect | null {
    return text.lines.map((line) => overlapOf(line, box)).find((overlap) => overlap !== null) ?? null;
}

/**
 * (e) No loading indicator is drawn over a text but its own (M6, finding 6 of 2026-10-25: a busy step's indicator, an
 * 18 px box whose 38 px shape turned over the chip's label). The shape's box as drawn now is compared with every text's
 * lines; a text inside the indicator is its own.
 */
export function graphicOverlapViolations(snapshot: LayoutSnapshot): Violation[] {
    return snapshot.graphics.flatMap((graphic) => {
        const shape = nodeAt(snapshot, graphic.node);
        const box = shape.visible ?? shape.box;
        return snapshot.texts
            .filter((text) => !nodeAt(snapshot, text.node).ancestors.includes(graphic.node))
            .flatMap((text): Violation[] => {
                const covered = coveredLine(text, box);
                if (covered === null) {
                    return [];
                }
                const [a, b] = [refOf(shape), refOf(nodeAt(snapshot, text.node))];
                const message = `the loading indicator ${elementText(a)} is drawn over the text of ${elementText(b)} at ${boxText(covered)}`;
                return [{ check: 'graphic-overlap', message, elements: [a, b] }];
            });
    });
}

/** Every layout violation of the snapshot. */
export function layoutViolations(snapshot: LayoutSnapshot, context: LayoutContext): Violation[] {
    return [
        ...occlusionViolations(snapshot, context.sanctioned),
        ...overlapViolations(snapshot, context),
        ...gapViolations(snapshot, context),
        ...edgeViolations(snapshot),
        ...pageScrollViolations(snapshot),
        ...sidewaysScrollViolations(snapshot),
        ...legalViolations(snapshot),
        ...clippedTextViolations(snapshot),
        ...textOverlapViolations(snapshot),
        ...graphicOverlapViolations(snapshot),
    ];
}
