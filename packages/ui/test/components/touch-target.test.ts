import { html, type TemplateResult } from 'lit';
import { afterEach, describe, expect, it } from 'vitest';

import { defineHcmButton } from '../../src/components/button.js';
import { defineHcmChip } from '../../src/components/chip.js';
import { defineHcmIconButton } from '../../src/components/icon-button.js';
import { defineHcmSegmentedButton } from '../../src/components/segmented-button.js';
import { cleanup, fixture, part, shadowPart } from '../helpers.js';

defineHcmButton();
defineHcmChip();
defineHcmIconButton();
defineHcmSegmentedButton();

/** M3: a touch target of at least 48 × 48 dp around a smaller control (the kit's `touchTarget` `::after`). */
const TARGET_PX = 48;

/** The four points 1 px inside the ring of a centred `width` × `height` target, and the four 2 px beyond it. */
function ringPoints(control: DOMRect): { inside: [number, number][]; beyond: [number, number][] } {
    const cx = control.x + control.width / 2;
    const cy = control.y + control.height / 2;
    const halfWidth = Math.max(control.width, TARGET_PX) / 2;
    const halfHeight = Math.max(control.height, TARGET_PX) / 2;
    const around = (dx: number, dy: number): [number, number][] => [
        [cx, cy - dy],
        [cx, cy + dy],
        [cx - dx, cy],
        [cx + dx, cy],
    ];
    return { inside: around(halfWidth - 1, halfHeight - 1), beyond: around(halfWidth + 2, halfHeight + 2) };
}

const CONTROLS: readonly [string, TemplateResult][] = [
    ['hcm-icon-button', html`<hcm-icon-button icon="close" label="Close"></hcm-icon-button>`],
    ['hcm-button', html`<hcm-button>Retry</hcm-button>`],
    ['hcm-chip', html`<hcm-chip label="1945"></hcm-chip>`],
    [
        'hcm-segmented-button',
        html`<hcm-segmented-button .options=${[{ value: 'a', label: 'A' }]} value="a" label="One"></hcm-segmented-button>`,
    ],
];

/**
 * A pointer hits the kit's 48 × 48 touch target all round, past the control's own 40 or 32 px box: the state layer's
 * `overflow: hidden` once cut the ring to the control, so a tap 2 px outside a 40 px icon button missed it (LA-6 of
 * docs/research/layout-a11y-findings.md). Hit-tested, because the pseudo-element's computed size is 48 px either way.
 */
describe('the kit touch target', () => {
    afterEach(cleanup);

    it.each(CONTROLS)('happyPath_%s_takesATapInItsRing_badPath_notBeyondIt', async (tag, template) => {
        const wrapper = await fixture<HTMLElement>(html`<div style="display: inline-block; padding: 64px">${template}</div>`);
        const host = part(wrapper, tag);
        await (host as Partial<{ updateComplete: Promise<unknown> }>).updateComplete;
        const control = shadowPart(host, 'button').getBoundingClientRect();
        const { inside, beyond } = ringPoints(control);

        expect(Math.min(control.width, control.height)).toBeLessThan(TARGET_PX);
        expect(inside.map(([x, y]) => document.elementFromPoint(x, y))).toEqual(inside.map(() => host));
        expect(beyond.map(([x, y]) => document.elementFromPoint(x, y))).toEqual(beyond.map(() => wrapper));
    });
});
