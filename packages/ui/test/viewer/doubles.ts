/**
 * Lightweight test doubles of the ui-kit elements the viewer renders (docs/research/M1-interfaces.md §5.1), with the
 * documented properties and events only: the viewer is tested against the kit's contract, not its looks. Each double
 * is defined only when the tag is still free, so a test that loads the real kit uses the real element.
 */
import { LitElement, html, nothing, type TemplateResult } from 'lit';

function fire(target: HTMLElement, type: string, detail: unknown = null): void {
    target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
}

class SheetDouble extends LitElement {
    static override readonly properties = { open: { type: Boolean, reflect: true }, label: {}, variant: { reflect: true }, closeLabel: {} };
    declare open: boolean;
    declare label: string;
    declare variant: string;
    declare closeLabel: string;

    constructor() {
        super();
        this.open = false;
        this.label = '';
        this.variant = 'bottom';
        this.closeLabel = '';
    }

    override render(): TemplateResult {
        if (!this.open) {
            return html``;
        }
        const close = (): void => {
            fire(this, 'hcm-close');
        };
        return html`<div role="dialog" aria-label=${this.label}>
            <slot name="header"></slot><slot></slot><button aria-label=${this.closeLabel} @click=${close}></button>
        </div>`;
    }

    /** The sheet's surface (`HcmSheet.sheet`): what covers the map. */
    sheet(): HTMLElement | null {
        return this.renderRoot.querySelector('div');
    }
}

class DialogDouble extends LitElement {
    static override readonly properties = {
        open: { type: Boolean, reflect: true },
        headline: {},
        closeLabel: {},
        fullscreen: { type: Boolean },
    };
    declare open: boolean;
    declare headline: string;
    declare closeLabel: string;

    constructor() {
        super();
        this.open = false;
        this.headline = '';
        this.closeLabel = '';
    }

    override render(): TemplateResult {
        if (!this.open) {
            return html``;
        }
        const close = (): void => {
            fire(this, 'hcm-close', { returnValue: '' });
        };
        return html`<div role="dialog" aria-label=${this.headline}>
            <h2>${this.headline}</h2>
            <slot></slot><button aria-label=${this.closeLabel} @click=${close}></button>
        </div>`;
    }
}

class ButtonDouble extends LitElement {
    static override readonly properties = { variant: {}, icon: {}, disabled: { type: Boolean }, label: { attribute: false } };
    declare label: string | undefined;

    override render(): TemplateResult {
        return html`<button aria-label=${this.label ?? nothing}><slot></slot></button>`;
    }
}

class IconButtonDouble extends LitElement {
    static override readonly properties = {
        icon: {},
        label: {},
        disabled: { type: Boolean },
        softDisabled: { type: Boolean, attribute: 'soft-disabled' },
        expanded: { attribute: false },
    };
    declare label: string;
    declare disabled: boolean;
    declare softDisabled: boolean;
    declare expanded: boolean | undefined;

    constructor() {
        super();
        this.label = '';
        this.disabled = false;
        this.softDisabled = false;
    }

    override render(): TemplateResult {
        return html`<button
            aria-label=${this.label}
            aria-expanded=${this.expanded ?? nothing}
            ?disabled=${this.disabled}
            aria-disabled=${String(this.softDisabled)}
        ></button>`;
    }
}

class SnackbarDouble extends LitElement {
    static override readonly properties = { message: {}, closeLabel: {} };
    declare message: string;
    declare closeLabel: string;

    constructor() {
        super();
        this.message = '';
        this.closeLabel = '';
    }

    override render(): TemplateResult {
        const dismiss = (): void => {
            fire(this, 'hcm-dismiss');
        };
        return html`<p role="status">${this.message}</p>
            <button aria-label=${this.closeLabel} @click=${dismiss}></button>`;
    }
}

class ProgressDouble extends LitElement {
    static override readonly properties = { label: {}, indeterminate: { type: Boolean } };
    declare label: string;

    constructor() {
        super();
        this.label = '';
    }

    override render(): TemplateResult {
        return html`<div role="progressbar" aria-label=${this.label}></div>`;
    }
}

/** Holds what the viewer passes to `<hcm-overlay-list>`; tests fire its events themselves. */
class OverlayListDouble extends LitElement {
    static override readonly properties = { items: {}, groups: {}, toggleLabel: {}, opacityLabel: {}, valueText: {}, changedText: {} };
    declare items: readonly { readonly id: string; readonly label: string }[];
    /** Every `reveal` the panel asked for, in order. */
    readonly revealed: (readonly string[])[] = [];

    constructor() {
        super();
        this.items = [];
    }

    reveal(ids: readonly string[]): boolean {
        this.revealed.push(ids);
        return true;
    }

    override render(): TemplateResult {
        return html`<ul>
            ${this.items.map((item) => html`<li>${item.label}</li>`)}
        </ul>`;
    }
}

/** The kit FAB menu: holds its items (tests fire `hcm-select` with `{value}` themselves) behind one FAB button. */
class FabMenuDouble extends LitElement {
    static override readonly properties = { icon: {}, label: {}, closeLabel: {}, items: {}, open: { type: Boolean } };
    declare label: string;
    declare items: readonly { readonly value: string; readonly label: string; readonly icon: string }[];

    constructor() {
        super();
        this.label = '';
        this.items = [];
    }

    override render(): TemplateResult {
        return html`<button aria-haspopup="menu" aria-label=${this.label}></button>`;
    }
}

/** The kit consent banner: two buttons firing `hcm-consent` with `{decision}`. */
class ConsentBannerDouble extends LitElement {
    static override readonly properties = { headline: {}, body: {}, acceptLabel: {}, declineLabel: {} };
    declare headline: string;
    declare body: string;
    declare acceptLabel: string;
    declare declineLabel: string;

    constructor() {
        super();
        this.headline = '';
        this.body = '';
        this.acceptLabel = '';
        this.declineLabel = '';
    }

    override render(): TemplateResult {
        const decide = (decision: string) => (): void => {
            fire(this, 'hcm-consent', { decision });
        };
        return html`<section aria-label=${this.headline}>
            <p>${this.body}</p>
            <button @click=${decide('denied')}>${this.declineLabel}</button><button @click=${decide('granted')}>${this.acceptLabel}</button>
        </section>`;
    }
}

/** The kit segmented button: a radio per option firing `hcm-change` with `{value}`. */
class SegmentedButtonDouble extends LitElement {
    static override readonly properties = { options: {}, value: {}, label: {} };
    declare options: readonly { readonly value: string; readonly label: string }[];
    declare value: string;
    declare label: string;

    constructor() {
        super();
        this.options = [];
        this.value = '';
        this.label = '';
    }

    override render(): TemplateResult {
        return html`<div role="radiogroup" aria-label=${this.label}>
            ${this.options.map(
                (option) =>
                    html`<button
                        role="radio"
                        aria-checked=${String(option.value === this.value)}
                        @click=${() => {
                            fire(this, 'hcm-change', { value: option.value });
                        }}
                    >
                        ${option.label}
                    </button>`,
            )}
        </div>`;
    }
}

class IconDouble extends LitElement {
    static override readonly properties = { name: {}, filled: { type: Boolean } };
}

/** The kit language dropdown: the segmented button's options as a native list, firing `hcm-change` with `{value}`. */
class LanguageSelectDouble extends SegmentedButtonDouble {
    override render(): TemplateResult {
        const change = (event: Event): void => {
            fire(this, 'hcm-change', { value: (event.currentTarget as HTMLSelectElement).value });
        };
        return html`<select aria-label=${this.label} @change=${change}>
            ${this.options.map(
                (option) => html`<option value=${option.value} ?selected=${option.value === this.value}>${option.label}</option>`,
            )}
        </select>`;
    }
}

const DOUBLES: readonly (readonly [string, CustomElementConstructor])[] = [
    ['hcm-sheet', SheetDouble],
    ['hcm-dialog', DialogDouble],
    ['hcm-button', ButtonDouble],
    ['hcm-icon-button', IconButtonDouble],
    ['hcm-snackbar', SnackbarDouble],
    ['hcm-progress', ProgressDouble],
    ['hcm-overlay-list', OverlayListDouble],
    ['hcm-fab-menu', FabMenuDouble],
    ['hcm-consent-banner', ConsentBannerDouble],
    ['hcm-segmented-button', SegmentedButtonDouble],
    ['hcm-language-select', LanguageSelectDouble],
    ['hcm-icon', IconDouble],
];

/** Defines every double whose tag is still free. */
export function defineKitDoubles(): void {
    for (const [tag, element] of DOUBLES) {
        if (customElements.get(tag) === undefined) {
            customElements.define(tag, element);
        }
    }
}

/** Fires a kit event on `target` the way the kit does (bubbling, composed). */
export function fireKitEvent(target: Element, type: string, detail: unknown = null): void {
    target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
}

/** The element `selector` finds in `host`'s shadow root; fails the test when it is missing. */
export function shadowQuery(host: Element, selector: string): HTMLElement {
    const found = host.shadowRoot?.querySelector<HTMLElement>(selector) ?? null;
    if (found === null) {
        throw new Error(`no ${selector} in <${host.localName}>`);
    }
    return found;
}

/** Every element `selector` finds in `host`'s shadow root. */
export function shadowQueryAll(host: Element, selector: string): HTMLElement[] {
    return [...(host.shadowRoot?.querySelectorAll<HTMLElement>(selector) ?? [])];
}

/** The visible text of `host`'s shadow root, whitespace collapsed. */
export function shadowText(host: Element): string {
    return (host.shadowRoot?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Creates `tag`, sets `properties`, connects it and waits for its first render. */
export async function mountElement<T extends HTMLElement & { readonly updateComplete: Promise<boolean> }>(
    tag: string,
    properties: Partial<T> = {},
): Promise<T> {
    const element = document.createElement(tag) as T;
    Object.assign(element, properties);
    document.body.append(element);
    await element.updateComplete;
    return element;
}

/** Records every `type` event `target` receives, with its detail. */
export function recordEvents(target: EventTarget, ...types: readonly string[]): { type: string; detail: unknown }[] {
    const seen: { type: string; detail: unknown }[] = [];
    for (const type of types) {
        target.addEventListener(type, (event) => {
            seen.push({ type, detail: (event as CustomEvent).detail });
        });
    }
    return seen;
}
