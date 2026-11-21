/**
 * Keeps the keyboard focus on an editor page when a re-render disables the control that had it (Save once the draft is
 * saved, Discard once it is clean): Chromium drops the focus to the page's body, where Esc and the arrow keys no longer
 * reach anything (`docs/LESSONS.md` #19). The focus goes to the open item's heading instead.
 */
import type { ReactiveController, ReactiveControllerHost } from 'lit';

class FocusKeeper implements ReactiveController {
    readonly #host: ReactiveControllerHost & HTMLElement;
    #focused: Element | null = null;

    constructor(host: ReactiveControllerHost & HTMLElement) {
        this.#host = host;
    }

    hostUpdate(): void {
        this.#focused = this.#host.shadowRoot?.activeElement ?? null;
    }

    hostUpdated(): void {
        const focused = this.#focused;
        this.#focused = null;
        if (focused?.hasAttribute('disabled') === true) {
            this.#host.shadowRoot?.querySelector<HTMLElement>('[data-detail-heading]')?.focus();
        }
    }
}

/** Adds the focus keeper to an editor page (in its constructor). */
export function keepFocus(host: ReactiveControllerHost & HTMLElement): void {
    host.addController(new FocusKeeper(host));
}
