/**
 * Synthetic DOM for the unit tests of the tour's in-page probes (e2e/test/*.test.ts, Vitest in Chromium): elements built
 * with DOM calls (never markup strings), open shadow roots, slots, and a stage fixed at the top left of the page so
 * every box is where the test puts it.
 */

type Child = Node | string;

/** An element with attributes (`style` included) and children. */
export function h(tag: string, attributes: Readonly<Record<string, string>> = {}, ...children: Child[]): HTMLElement {
    const element = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) {
        element.setAttribute(name, value);
    }
    element.append(...children);
    return element;
}

/** An element whose open shadow root holds `shadow` (a `slot` there shows the element's own children). */
export function host(
    tag: string,
    attributes: Readonly<Record<string, string>>,
    shadow: readonly Child[],
    ...children: Child[]
): HTMLElement {
    const element = h(tag, attributes, ...children);
    element.attachShadow({ mode: 'open' }).append(...shadow);
    return element;
}

/** An unpadded stage at the page's top left, as large as the viewport, holding `children`; removed by `clearStage`. */
export function stage(...children: Child[]): HTMLElement {
    const style = 'position: absolute; left: 0; top: 0; width: 100vw; height: 100vh; margin: 0; padding: 0; font: 16px/20px sans-serif;';
    const root = h('div', { 'data-stage': '', style }, ...children);
    document.body.append(root);
    return root;
}

export function clearStage(): void {
    for (const root of Array.from(document.querySelectorAll('[data-stage]'))) {
        root.remove();
    }
}

/** A box placed absolutely in the stage. */
export function at(x: number, y: number, width: number, height: number, extra = ''): string {
    return `position: absolute; left: ${String(x)}px; top: ${String(y)}px; width: ${String(width)}px; height: ${String(height)}px; margin: 0; padding: 0; border: 0; ${extra}`;
}
