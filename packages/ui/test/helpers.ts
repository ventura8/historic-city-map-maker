// Shared fixtures of the ui-kit browser tests: render a Lit template into a themed host, wait for frames, record
// events. Every test file calls `cleanup()` after each test.
import { render, type TemplateResult } from 'lit';

import { deepActiveElement } from '../src/components/focus.js';
import { contrastRatio } from '../src/theme/dynamic-color.js';
import { installFonts } from '../src/fonts/font-faces.js';
import { applyTheme, clearTheme } from '../src/theme/apply.js';
import { BASELINE_THEME } from '../src/theme/baseline.js';

/** Where the Vitest dev server serves the committed fonts (the repository root is the server root). */
export const FONT_BASE = '/packages/ui/fonts/';

const hosts: HTMLElement[] = [];

/** A themed container in the document (baseline light theme, kit fonts installed). */
function themedHost(): HTMLElement {
    installFonts(document, FONT_BASE);
    const host = document.createElement('div');
    document.body.append(host);
    applyTheme(host, BASELINE_THEME, 'light', false);
    hosts.push(host);
    return host;
}

/** Renders `template` into a themed host and resolves with its first element once it has rendered. */
export async function fixture<T extends Element>(template: TemplateResult): Promise<T> {
    const host = themedHost();
    render(template, host);
    const element = host.firstElementChild as T;
    await (element as Partial<{ updateComplete: Promise<unknown> }>).updateComplete;
    return element;
}

/** The focused element, inside shadow roots too. */
export function deepFocus(): Element | null {
    return deepActiveElement(document);
}

export function cleanup(): void {
    for (const host of hosts.splice(0)) {
        clearTheme(host);
    }
    document.body.replaceChildren();
}

export function nextFrame(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

/** Collects the `detail` of every `type` event that reaches `target`. */
export function recordEvents<T = unknown>(target: EventTarget, type: string, details: T[] = []): T[] {
    target.addEventListener(type, (event) => {
        details.push((event as CustomEvent<T>).detail);
    });
    return details;
}

/** The element of `selector` in `element`'s shadow root (throws when missing, so a test fails loudly). */
export function shadowPart(element: Element, selector: string): HTMLElement {
    const found = element.shadowRoot?.querySelector<HTMLElement>(selector);
    if (found === null || found === undefined) {
        throw new Error(`no ${selector} in <${element.localName}>`);
    }
    return found;
}

/** The element of `selector` in a light-DOM `root` (throws when missing). */
export function part(root: ParentNode, selector: string): HTMLElement {
    const found = root.querySelector<HTMLElement>(selector);
    if (found === null) {
        throw new Error(`no ${selector}`);
    }
    return found;
}

/** Dispatches a keyboard event the way a key press reaches a focused control. */
export function press(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
}

export function release(target: Element, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, composed: true }));
}

/** `#rrggbb` of a computed opaque colour (`rgb(r, g, b)`), for `contrastRatio`. */
function hexOf(colour: string): string {
    const channels = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(colour);
    if (channels === null) {
        throw new Error(`not an rgb() colour: ${colour}`);
    }
    return `#${channels
        .slice(1, 4)
        .map((value) => Number(value).toString(16).padStart(2, '0'))
        .join('')}`;
}

/** The shadow root of `element` (throws when it has none). */
export function shadowRootOf(element: Element): ShadowRoot {
    if (element.shadowRoot === null) {
        throw new Error(`<${element.localName}> has no shadow root`);
    }
    return element.shadowRoot;
}

/** The contrast of the focus ring `element` shows now against `background` (a computed colour or `#rrggbb`). */
export function ringContrast(element: Element | null, background: string): number {
    if (element === null) {
        throw new Error('nothing has the focus');
    }
    const style = getComputedStyle(element);
    if (style.outlineStyle === 'none') {
        throw new Error(`<${element.localName}> shows no focus ring`);
    }
    return contrastRatio(hexOf(style.outlineColor), background.startsWith('#') ? background : hexOf(background));
}
