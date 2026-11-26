/**
 * The base of an editor area's page (`docs/research/M2c-interfaces.md` §2.3): the shell's page outlet sets `app` and
 * `state`; the page follows its own area's store only (`app.content.<area>`), copies the store's state into `view` on
 * every change, opens the store with the route's params when it connects or they change, and closes it when it
 * disconnects. A list and detail page fills the page area (`fillsPage`): only its panes scroll.
 *
 * While the shell says the admin's access was removed (`revoked`, `DECISIONS-for-review.md` §35e) the page is read-only
 * (`readOnly`, the host's `read-only` attribute, §42d): its editors disable Save and every action that writes, and their
 * fields are read-only, so what is on screen can still be selected and copied until sign-out.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { LitElement } from 'lit';

import type { AdminAppPort, AdminRouteIdPort, AdminStatePort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';

export abstract class AreaPage<State, Intents> extends LitElement {
    /** The outlet gives a filling page the page area's height and lets it scroll its own panes (CR-M2c-8). */
    static readonly fillsPage: boolean = true;

    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
        view: { state: true },
    };

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;
    /** The area's state, or null while the app has no store for it. */
    declare view: State | null;
    #followed: { readonly store: AreaPort<State, Intents>; readonly stop: () => void } | null = null;
    /** The params the store was last opened with (`a/b`), null while closed. */
    #opened: string | null = null;

    constructor() {
        super();
        this.app = null;
        this.state = null;
        this.view = null;
    }

    /** The page's route (its own params open the store). */
    protected abstract readonly route: AdminRouteIdPort;

    /** The page's store among the app's areas. */
    protected abstract storeOf(content: ContentPort): AreaPort<State, Intents> | null;

    override connectedCallback(): void {
        super.connectedCallback();
        this.#follow();
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.#unfollow();
    }

    protected override willUpdate(): void {
        this.#follow();
        this.#open();
        this.toggleAttribute('read-only', this.readOnly);
    }

    /** The admin's access was removed: nothing on the page may write any more (§42d). */
    protected get readOnly(): boolean {
        return this.state?.revoked === true;
    }

    /** The signed-in admin's uid ("you" in who saved what), or null. */
    protected get self(): string | null {
        return this.state?.user?.uid ?? null;
    }

    /** The admins' names by uid, as far as the shell knows them. */
    protected get people(): Readonly<Record<string, string>> {
        return this.state?.people ?? {};
    }

    /** The store's intents (null without a store). */
    protected get intents(): Intents | null {
        return this.#followed?.store.intents ?? null;
    }

    protected get locale(): UiLocale {
        return this.state?.locale ?? DEFAULT_LOCALE;
    }

    /** The route's params while this page's route shows. */
    protected get params(): readonly string[] {
        return this.state?.route.id === this.route ? this.state.route.params : [];
    }

    /** The address of one of the page's items (`#/jobs/abc`). */
    protected href(params: readonly string[]): string {
        return ['#', this.route, ...params].join('/');
    }

    /** Opens the page's own address with these params (Back to the list, a new selection). */
    protected go(params: readonly string[]): void {
        this.app?.intents.navigate({ id: this.route, params });
    }

    /** The store to follow: the app's for this page while connected, else none. */
    #wanted(): AreaPort<State, Intents> | null {
        return this.app !== null && this.isConnected ? this.storeOf(this.app.content) : null;
    }

    #follow(): void {
        const store = this.#wanted();
        if (store === (this.#followed?.store ?? null)) {
            return;
        }
        this.#unfollow();
        if (store !== null) {
            const stop = store.subscribe((view) => {
                this.view = view;
            });
            this.#followed = { store, stop };
            this.view = store.state;
        }
    }

    /** Opens the store with the route's params when they are new (this page's route only). */
    #open(): void {
        const key = this.params.join('/');
        if (this.#followed === null || this.state?.route.id !== this.route || key === this.#opened) {
            return;
        }
        this.#opened = key;
        this.#followed.store.open(this.params);
    }

    #unfollow(): void {
        if (this.#followed !== null) {
            this.#followed.stop();
            this.#followed.store.close();
            this.#followed = null;
            this.#opened = null;
        }
    }
}
