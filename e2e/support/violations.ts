import type { Rect } from './dom-walk.js';

/**
 * What the tour's checkers report (e2e/support/layout.ts, e2e/support/a11y.ts): one violation per broken invariant,
 * naming every element involved by its accessible name, a readable selector and its box, so the fix can start from the
 * message alone; the same records outline the offending boxes on the screenshot attached to the failing test and feed
 * docs/research/layout-a11y-findings.md.
 */

/** The checks, in the order of the tour's invariants (docs/TESTING.md → *The tour's checkers*). */
type Check =
    | 'occlusion'
    | 'modal-escape'
    | 'overlap'
    | 'gap'
    | 'edge'
    | 'page-scroll'
    | 'sideways-scroll'
    | 'no-blank-scroll'
    | 'legal'
    | 'clipped-text'
    | 'text-overlap'
    | 'graphic-overlap'
    | 'axe'
    | 'target-size'
    | 'focus-order'
    | 'focus-ring'
    | 'focus-obscured'
    | 'keyboard-trap'
    | 'modal-escape-key'
    | 'non-text-contrast'
    | 'rendered-contrast'
    | 'landmark'
    | 'live-region';

/** An element named in a violation. */
export interface ElementRef {
    readonly name: string;
    readonly selector: string;
    readonly box: Rect | null;
}

export interface Violation {
    readonly check: Check;
    readonly message: string;
    readonly elements: readonly ElementRef[];
}

/** `x,y wxh` of a box, rounded to CSS px. */
export function boxText(box: Rect | null): string {
    if (box === null) {
        return 'off screen';
    }
    const round = (value: number): string => String(Math.round(value));
    return `${round(box.x)},${round(box.y)} ${round(box.width)}x${round(box.height)}`;
}

/** An element as a failure message names it: `"name" (selector) at x,y wxh`. */
export function elementText(element: ElementRef): string {
    const name = element.name === '' ? '(no name)' : `"${element.name}"`;
    return `${name} (${element.selector}) at ${boxText(element.box)}`;
}

/**
 * A violation without its coordinates: the same fault seen at another place (a narrower viewport, another scroll
 * position) has the same shape, so a variant or a sweep reports only what it adds.
 */
export function violationShape(violation: Violation): string {
    return `${violation.check} ${violation.message.replace(/-?\d+(?:\.\d+)?/g, '#')}`;
}

/** One line per violation, for the assertion message. */
export function violationLines(state: string, violations: readonly Violation[]): string[] {
    return violations.map((violation) => `${state}: [${violation.check}] ${violation.message}`);
}

/** The colour each check's boxes are outlined in on the attached screenshot. */
const OUTLINE: Readonly<Record<string, string>> = {
    occlusion: '#d50000',
    overlap: '#ff6d00',
    gap: '#ffab00',
    edge: '#aa00ff',
    legal: '#2962ff',
};

const DEFAULT_OUTLINE = '#c51162';

/** Text for an SVG text node (no markup from the page reaches the drawing). */
function svgText(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * An SVG of the page's size outlining every element the violations name, labelled with the check and the element's
 * number in the message, to lay over a screenshot of the page (e2e/support/report.ts).
 */
export function outlineSvg(viewport: { readonly width: number; readonly height: number }, violations: readonly Violation[]): string {
    const shapes = violations.flatMap((violation, index) =>
        violation.elements.flatMap((element, part) => {
            const box = element.box;
            if (box === null) {
                return [];
            }
            const colour = OUTLINE[violation.check] ?? DEFAULT_OUTLINE;
            const label = svgText(`${String(index + 1)}.${String(part + 1)} ${violation.check}`);
            return [
                `<rect x="${String(box.x)}" y="${String(box.y)}" width="${String(box.width)}" height="${String(box.height)}" fill="none" stroke="${colour}" stroke-width="3"/>`,
                `<text x="${String(box.x + 2)}" y="${String(Math.max(box.y - 3, 12))}" fill="${colour}" font-size="12" font-family="sans-serif">${label}</text>`,
            ];
        }),
    );
    const { width, height } = viewport;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${String(width)}" height="${String(height)}">${shapes.join('')}</svg>`;
}
