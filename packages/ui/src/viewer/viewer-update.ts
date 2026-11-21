/**
 * The map keeps itself up to date (`../app-update.ts`; `docs/ENGINE_API.md` → *Installable app* → *Updates*): the page's
 * script reloads it into a newer deploy when the visitor leaves it alone, and never while a dialog (About, Settings,
 * Help), the full-size view, swipe compare or the map's menu is open: the reload would close it. Until then a snackbar
 * says "A new version of the map is ready" with Reload, which reloads now (the place, the year and the photo are in the
 * address, so the map opens again where it was). It shares the toast's dock (`toastDock`), above the toast.
 */
import { translate, type ViewerLocale } from '@hcm/shared';
import { html, type ReactiveController, type ReactiveControllerHost, type TemplateResult } from 'lit';
import { keyed } from 'lit/directives/keyed.js';

import { reloadApp, watchUpdate } from '../app-update.js';
import { EMPTY } from './empty.js';
import { isDialogSheet } from './input-commands.js';
import type { MenuPoint } from './map-menu-trigger.js';
import type { ViewerState, ViewerToast } from './store-port.js';

/** The snackbar's two answers, while a newer build waits and the visitor has not closed it. */
export interface UpdateOffer {
    readonly onReload: () => void;
    readonly onDismiss: () => void;
}

/** True while a reload would close what the visitor has open. */
export function reloadHeld(state: ViewerState | null, mapMenu: MenuPoint | null): boolean {
    if (mapMenu !== null) {
        return true;
    }
    return state !== null && (state.lightbox || state.compare !== null || isDialogSheet(state.sheet));
}

/** What the controller reads of `<hcm-map-viewer>`. */
export interface UpdateHost extends ReactiveControllerHost {
    readonly viewState: ViewerState | null;
    readonly mapMenu: MenuPoint | null;
}

/** Hands the viewer's hold to the page script while the element is connected, and keeps the snackbar's state. */
export class ViewerUpdates implements ReactiveController {
    readonly #host: UpdateHost;
    #ready = false;
    #stop: () => void = () => undefined;
    readonly #offer: UpdateOffer = {
        onReload: () => {
            reloadApp(window);
        },
        onDismiss: () => {
            this.#set(false);
        },
    };

    constructor(host: UpdateHost) {
        this.#host = host;
        host.addController(this);
    }

    /** The snackbar's answers while it shows; null: none. */
    offer(): UpdateOffer | null {
        return this.#ready ? this.#offer : null;
    }

    hostConnected(): void {
        const host = this.#host;
        this.#stop = watchUpdate(
            window,
            () => reloadHeld(host.viewState, host.mapMenu),
            (ready) => {
                this.#set(ready);
            },
        );
    }

    hostDisconnected(): void {
        this.#stop();
    }

    #set(ready: boolean): void {
        this.#ready = ready;
        this.#host.requestUpdate();
    }
}

/** "A new version of the map is ready" with Reload, kept until the visitor answers. */
function updateSnackbar(locale: ViewerLocale, offer: UpdateOffer | null | undefined): TemplateResult {
    if (offer === null || offer === undefined) {
        return EMPTY;
    }
    return html`<hcm-snackbar
        data-layout-check="update"
        timeout-ms="0"
        stacked
        .message=${translate(locale, 'app.updateReady')}
        .actionLabel=${translate(locale, 'app.reload')}
        .closeLabel=${translate(locale, 'action.close')}
        @hcm-action=${offer.onReload}
        @hcm-dismiss=${offer.onDismiss}
    ></hcm-snackbar>`;
}

/** The toast's dock: the update's snackbar, then the store's toast; nothing when neither shows. */
export function toastDock(
    locale: ViewerLocale,
    toast: ViewerToast | null,
    onToastDismiss: (event: Event) => void,
    update: UpdateOffer | null | undefined,
): TemplateResult {
    if (toast === null && (update === null || update === undefined)) {
        return EMPTY;
    }
    const message =
        toast === null
            ? EMPTY
            : keyed(
                  toast,
                  html`<hcm-snackbar
                      data-layout-check="toast"
                      .message=${translate(locale, toast.key, toast.params)}
                      .closeLabel=${translate(locale, 'action.close')}
                      @hcm-dismiss=${onToastDismiss}
                  ></hcm-snackbar>`,
              );
    return html`<div class="dock toast">${updateSnackbar(locale, update)}${message}</div>`;
}
