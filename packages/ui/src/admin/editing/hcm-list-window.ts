/**
 * `<hcm-list-window>`: a long admin list drawn a window at a time (owner, 2026-11-22: the 315 places of "Disappeared
 * streets" needed More after More). The page hands it every item; it draws the first `step` of them and, when the end
 * of the window scrolls into view (an `IntersectionObserver` on the last line), the next `step`, then asks the page for
 * the documents past what was read (`more`). The DOM holds only what the reader scrolled to, so thousands of items stay
 * fast; the button on the last line is the same step for a keyboard or a browser without the observer.
 *
 * It renders into its own light DOM, so the rows the page's `rows` makes keep the page's styles.
 */
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';

export const HCM_LIST_WINDOW_TAG = 'hcm-list-window';

/** How many rows a window adds at a time. */
export const LIST_WINDOW_STEP = 200;

export class HcmListWindow extends LitElement {
    static override readonly properties = {
        items: { attribute: false },
        rows: { attribute: false },
        hasMore: { attribute: false },
        more: { attribute: false },
        label: { attribute: false },
        step: { attribute: false },
        shown: { state: true },
    };

    declare items: readonly unknown[];
    declare rows: (items: readonly unknown[]) => TemplateResult;
    declare hasMore: boolean;
    declare more: (() => void) | null;
    /** The fallback button's text ("Show more"). */
    declare label: string;
    declare step: number;
    declare shown: number;
    #observer: IntersectionObserver | null = null;

    constructor() {
        super();
        this.items = [];
        this.rows = () => html``;
        this.hasMore = false;
        this.more = null;
        this.label = '';
        this.step = LIST_WINDOW_STEP;
        this.shown = LIST_WINDOW_STEP;
    }

    override createRenderRoot(): HTMLElement {
        return this;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.style.display = 'block';
        if (typeof IntersectionObserver === 'function') {
            this.#observer = new IntersectionObserver(
                (entries) => {
                    if (entries.some((entry) => entry.isIntersecting)) {
                        this.advance();
                    }
                },
                { rootMargin: '0px 0px 400px 0px' },
            );
        }
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#observer?.disconnect();
        this.#observer = null;
    }

    readonly #step = (): void => {
        this.advance();
    };

    /** The next window of rows, or the next documents once every read row is drawn. */
    advance(): void {
        if (this.shown < this.items.length) {
            this.shown += this.step;
        } else if (this.hasMore) {
            this.more?.();
        }
    }

    /** True while rows or documents remain past the window. */
    get pending(): boolean {
        return this.shown < this.items.length || this.hasMore;
    }

    protected override updated(changed: PropertyValues<this>): void {
        super.updated(changed);
        // Observing again reports the end's visibility now: a window that still leaves it on screen grows once more.
        this.#observer?.disconnect();
        const end = this.querySelector(':scope > .list-end');
        if (end !== null) {
            this.#observer?.observe(end);
        }
    }

    override render(): TemplateResult {
        if (!this.pending) {
            return this.rows(this.items.slice(0, this.shown));
        }
        // With the observer the end is an empty line that grows the list as it scrolls into view (Tab through the rows
        // reaches it too); a button that vanished mid-round would lose the keyboard's place. Without one, the button.
        const end =
            this.#observer === null
                ? html`<div class="list-end actions more">
                      <hcm-button variant="text" icon="expand_more" @click=${this.#step}>${this.label}</hcm-button>
                  </div>`
                : html`<div class="list-end" aria-hidden="true"></div>`;
        return html`${this.rows(this.items.slice(0, this.shown))}${end}`;
    }
}

export function defineHcmListWindow(registry: CustomElementRegistry = customElements): void {
    defineHcmButton(registry);
    defineOnce(registry, HCM_LIST_WINDOW_TAG, HcmListWindow);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-list-window': HcmListWindow;
    }
}
