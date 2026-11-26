/**
 * The base of the Setup Assistant's pages (`<hcm-setup-page>`, `<hcm-crashes-page>`). The controller reaches a page in
 * one of two ways:
 *
 * - through the shell's page outlet, which sets `app` and `state` on every page element at every change
 *   (admin-shell's `AdminPageElement`): the Setup Assistant's state is then `state.setup`, its intents
 *   `app.intents.setup`, the language `state.locale`;
 * - as `port` (a test, or a host with the controller at hand), which the page subscribes to while it is connected.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { LitElement, type PropertyValues } from 'lit';

import type { SetupIntentsPort, SetupPort, SetupViewState } from './setup-port.js';

/** What the page outlet's `app` offers: the admin's intents, the Setup Assistant's among them (`AdminIntents.setup`). */
export interface SetupHostApp {
    readonly intents: { readonly setup?: SetupIntentsPort | null };
}

/** What the page outlet's `state` offers: the admin's language and the Setup Assistant's state (`AdminState.setup`). */
export interface SetupHostState {
    readonly locale: UiLocale;
    readonly setup?: SetupViewState | null;
}

export abstract class SetupPortHost extends LitElement {
    static override readonly properties = {
        port: { attribute: false },
        app: { attribute: false },
        state: { attribute: false },
        locale: { type: String },
        view: { state: true },
    };

    declare port: SetupPort | null;
    declare app: SetupHostApp | null;
    declare state: SetupHostState | null;
    declare locale: UiLocale;
    /** The Setup Assistant's latest state (null before the controller exists). */
    declare view: SetupViewState | null;

    /** The controller's intents, set together with `view`. */
    protected intents: SetupIntentsPort | null = null;

    private unsubscribe: (() => void) | null = null;

    constructor() {
        super();
        this.port = null;
        this.app = null;
        this.state = null;
        this.locale = DEFAULT_LOCALE;
        this.view = null;
    }

    /** The page's language: the admin's when the outlet gave its state, else `locale`. */
    protected get language(): UiLocale {
        return this.state?.locale ?? this.locale;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.attach();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.detach();
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('port') && this.isConnected) {
            this.attach();
        }
        if (this.followsOutlet(changed)) {
            this.follow();
        }
    }

    /** Without a `port`, the outlet's new `state` or `app` is the page's. */
    private followsOutlet(changed: PropertyValues<this>): boolean {
        return this.port === null && (changed.has('state') || changed.has('app'));
    }

    /** The outlet's state and intents (no subscription: the outlet sets them at every change). */
    private follow(): void {
        this.view = this.state?.setup ?? null;
        this.intents = this.app?.intents.setup ?? null;
    }

    private attach(): void {
        this.detach();
        const port = this.port;
        if (port === null) {
            this.follow();
            return;
        }
        this.intents = port.intents;
        this.view = port.getState();
        this.unsubscribe = port.subscribe((state) => {
            this.view = state;
        });
    }

    private detach(): void {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }
}
