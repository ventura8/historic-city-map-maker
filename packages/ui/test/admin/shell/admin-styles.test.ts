// The admin's base styles: the focus ring follows a surface's `--hcm-focus-ring-color` as the kit's ring does (CR-M2c-29:
// secondary was 2.38:1 on the error container of an alert).
import { css, html, LitElement, type TemplateResult } from 'lit';
import { userEvent } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { editingStyles } from '../../../src/admin/editing/editing-styles.js';
import { adminBase } from '../../../src/admin/shell/admin-styles.js';
import { deepActiveElement } from '../../../src/components/focus.js';
import { applyTheme, clearTheme } from '../../../src/theme/apply.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';

class RingProbe extends LitElement {
    static override readonly styles = [
        adminBase,
        editingStyles,
        css`
            :host {
                display: block;
                padding: 16px;
                background: var(--md-sys-color-surface);
            }
        `,
    ];

    override render(): TemplateResult {
        return html`<a id="plain" href="#plain">Plain</a>
            <div class="alert"><a id="inside" href="#inside">Inside the alert</a></div>`;
    }
}

const TAG = 'hcm-test-ring-probe';

const hosts: HTMLElement[] = [];

afterEach(() => {
    for (const host of hosts.splice(0)) {
        host.remove();
    }
    clearTheme(document.documentElement);
});

/** The probe, themed with the kit's baseline in the light scheme. */
async function probe(): Promise<RingProbe> {
    applyTheme(document.documentElement, BASELINE_THEME, 'light', false);
    const element = document.body.appendChild(document.createElement(TAG) as RingProbe);
    hosts.push(element);
    await element.updateComplete;
    return element;
}

/** The outline colour of the element Tab reaches next. */
async function ringOfNextStop(): Promise<{ readonly id: string; readonly colour: string }> {
    await userEvent.tab();
    const focused = deepActiveElement(document) as HTMLElement;
    return { id: focused.id, colour: getComputedStyle(focused).outlineColor };
}

/** A token of the applied theme, resolved by the browser to `rgb(...)`. */
function resolved(element: HTMLElement, token: string): string {
    const swatch = document.createElement('span');
    element.shadowRoot?.append(swatch);
    swatch.style.color = `var(${token})`;
    const colour = getComputedStyle(swatch).color;
    swatch.remove();
    return colour;
}

describe('adminBase', () => {
    beforeAll(() => {
        if (customElements.get(TAG) === undefined) {
            customElements.define(TAG, RingProbe);
        }
    });

    it('happyPath_theRingIsSecondaryOnTheSurface', async () => {
        const element = await probe();

        expect(await ringOfNextStop()).toEqual({ id: 'plain', colour: resolved(element, '--md-sys-color-secondary') });
    });

    it('badPath_onAnAlertTheRingTakesTheContainersOwnColour', async () => {
        const element = await probe();

        await ringOfNextStop();
        expect(await ringOfNextStop()).toEqual({ id: 'inside', colour: resolved(element, '--md-sys-color-on-error-container') });
        expect(resolved(element, '--md-sys-color-on-error-container')).not.toBe(resolved(element, '--md-sys-color-secondary'));
    });
});
