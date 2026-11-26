/**
 * `<hcm-page-outlet>`: where the shell shows the current route's page (`docs/research/M2b-interfaces.md` §1.1). The page
 * registry of the app names the page's element once its module is loaded (`app.loadPage`); the outlet creates it and
 * sets `app` and `state` on it at every change. While the page's module loads (each editor area is a chunk of its own,
 * `DECISIONS-for-review.md` §34b) the outlet says so; a route without a page (Setup before setup-ui's page is wired) shows
 * a short note instead of an empty screen; a page whose module failed to load (the network, or a deploy that replaced
 * its chunk) says so with Retry, which loads it again (`S-A29-BAD-CHUNK-LOAD`). A page whose class declares
 * `static fillsPage = true` (the editors' list and detail pages, `docs/research/M2c-interfaces.md` §1.3) is given the
 * page area's whole height: the outlet reflects `fill`, the shell stops scrolling the page area, and the page scrolls
 * its own panes.
 */
import { LitElement, css, html, type TemplateResult } from 'lit';

import type { AdminAppPort, AdminPageElement, AdminRouteIdPort, AdminStatePort } from '../admin-port.js';
import { adminBase } from './admin-styles.js';
import { shellText } from './text.js';

export const HCM_PAGE_OUTLET_TAG = 'hcm-page-outlet';

type Loaded = { readonly route: AdminRouteIdPort; readonly page: AdminPageElement | null; readonly failed: boolean } | null;

/** True when the page's class asks for the page area's whole height (CR-M2c-8). */
export function fillsPage(page: Element | null): boolean {
    return (page?.constructor as { readonly fillsPage?: unknown } | undefined)?.fillsPage === true;
}

export class HcmPageOutlet extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
        loaded: { state: true },
    };

    static override readonly styles = [
        adminBase,
        css`
            :host {
                display: block;
            }

            :host([fill]) {
                display: flex;
                flex-direction: column;
                min-block-size: 0;
            }

            :host([fill]) > * {
                flex: 1 1 auto;
                min-block-size: 0;
            }

            .note {
                padding: 24px;
                color: var(--md-sys-color-on-surface-variant, CanvasText);
            }

            .failed {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 16px;
                padding: 24px;
            }

            .failed p {
                margin: 0;
                color: var(--md-sys-color-on-surface, CanvasText);
            }
        `,
    ];

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    declare loaded: Loaded;
    /** The route being loaded, so a slower earlier load never replaces a later one. */
    #loading: AdminRouteIdPort | null = null;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.loaded = null;
    }

    protected override willUpdate(): void {
        const route = this.state === null ? null : this.state.route.id;
        if (route !== null && route !== this.#loading) {
            void this.#load(route);
        }
        const page = this.#page();
        if (page !== null) {
            page.app = this.app;
            page.state = this.state;
        }
        this.toggleAttribute('fill', fillsPage(page));
    }

    override render(): TemplateResult {
        const page = this.#page();
        if (page !== null) {
            return html`${page}`;
        }
        const state = this.state;
        if (state === null) {
            return html`<p class="note" role="status"></p>`;
        }
        return this.loaded?.failed === true ? this.#failed(state) : this.#note(state);
    }

    /** Loading, or no page for this route. */
    #note(state: AdminStatePort): TemplateResult {
        const key = this.loaded === null ? 'adminShell.loading' : 'adminShell.page.unavailable';
        return html`<p class="note" role="status">${shellText(state.locale, key)}</p>`;
    }

    /** The page's module did not load: why, and Retry. */
    #failed(state: AdminStatePort): TemplateResult {
        const retry = (): void => {
            void this.#load(state.route.id);
        };
        return html`<div class="failed" role="alert">
            <p>${shellText(state.locale, 'adminShell.page.failed')}</p>
            <hcm-button variant="filled" icon="refresh" @click=${retry}>${shellText(state.locale, 'adminShell.page.retry')}</hcm-button>
        </div>`;
    }

    /** The loaded page of the current route, or null. */
    #page(): AdminPageElement | null {
        const loaded = this.loaded;
        return loaded !== null && loaded.route === this.state?.route.id ? loaded.page : null;
    }

    async #load(route: AdminRouteIdPort): Promise<void> {
        const app = this.app;
        if (app === null) {
            return;
        }
        this.#loading = route;
        this.loaded = null;
        const tag = await app.loadPage(route).catch(() => undefined);
        if (this.#loading === route) {
            this.loaded = tag === undefined ? { route, page: null, failed: true } : { route, page: this.#created(app, tag), failed: false };
        }
    }

    /** The page element of `tag` (none for null), handed the app and the state. */
    #created(app: AdminAppPort, tag: string | null): AdminPageElement | null {
        const page = tag === null ? null : (this.ownerDocument.createElement(tag) as AdminPageElement);
        if (page !== null) {
            page.app = app;
            page.state = this.state;
        }
        return page;
    }
}

/** Registers `<hcm-page-outlet>` once; calling it again is a no-op. */
export function defineHcmPageOutlet(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_PAGE_OUTLET_TAG) === undefined) {
        registry.define(HCM_PAGE_OUTLET_TAG, HcmPageOutlet);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-page-outlet': HcmPageOutlet;
    }
}
