/**
 * The Link dialog's state (behaviour A15, CR-M2c-27): the form as typed, what `linkCheck` finds (shown at the fields
 * once the admin has tried to send, the policy refusal at once), the origins a tile server needs in the public site's
 * CSP, and the call. The city's Mapbox account (`cities/{city}.mapbox.user`) is read while the dialog is open: a tileset
 * of any other account is refused before `layers.link` is called, which refuses it again.
 */
import {
    cityDocSchema,
    FIRESTORE_PATHS,
    imageryProbeRequestSchema,
    layerSourceRefusal,
    validate,
    type CityDoc,
    type ImageryProbeRequest,
    type ValidationIssue,
} from '@hcm/shared';

import type { Unsubscribe } from '../app/ports.js';
import type { ContentServices, Stored } from '../content/services.js';
import { CallableFailure } from '../firebase/ports.js';
import { codeOf } from './deletion.js';
import { EMPTY_LINK_FORM, linkCheck, sourceOf, type LinkForm, type LinkRefusal } from './link.js';

/**
 * **Check** (M3, `imagery.probeTiles`; S-A15-HAPPY-PROBED, S-A15-BAD-INVALID-URL): one tile of the address asked
 * server-side. Not run yet, running, the tile's type, or why no tile came; a new address forgets it.
 */
export type LinkProbe =
    | { readonly status: 'idle' | 'checking' }
    | { readonly status: 'ok'; readonly contentType: string }
    | { readonly status: 'failed'; readonly refusal: LinkRefusal };

const IDLE_PROBE: LinkProbe = { status: 'idle' };

export interface LinkState {
    readonly form: LinkForm;
    /** Problems at the fields (`address`, `label.ro`, `year`, ...), shown once the admin pressed Link. */
    readonly issues: readonly ValidationIssue[];
    /** A source the server would refuse (another account's tileset, a credential in the address). */
    readonly refusal: LinkRefusal | null;
    /** The origins of a tile server: the public site's CSP must allow them (a site rebuild). */
    readonly origins: readonly string[];
    /** The admin pressed Link once: issues are shown from then on. */
    readonly tried: boolean;
    readonly sending: boolean;
    /** Check's answer for the address as it stands; a failed one keeps Link off until the address changes. */
    readonly probe: LinkProbe;
}

/** Why a probe failed: the callable's code with its parameters (`{status}`, ...), or unavailable. */
function refusalOf(error: unknown): LinkRefusal {
    if (error instanceof CallableFailure && error.details.params !== undefined) {
        return { code: error.details.code, params: error.details.params };
    }
    return { code: codeOf(error) };
}

/** What Check does: ask the server, or show what the dialog's own checks found. */
type ProbeAsk = { readonly kind: 'ask'; readonly request: ImageryProbeRequest } | { readonly kind: 'refused'; readonly probe: LinkProbe };

/** Link may be sent: not sending already, and Check did not find the address without tiles. */
function sendable(state: LinkState): boolean {
    return !state.sending && state.probe.status !== 'failed';
}

/** Whether `patch` changes what Check asked: the address or the tile size. */
function changesSource(patch: Partial<LinkForm>): boolean {
    return patch.address !== undefined || patch.tileSize !== undefined;
}

export class LayerLinker {
    readonly #services: ContentServices;
    readonly #changed: (state: LinkState | null) => void;
    #state: LinkState | null = null;
    #mapboxUser: string | null = null;
    #stop: Unsubscribe | null = null;

    constructor(services: ContentServices, changed: (state: LinkState | null) => void) {
        this.#services = services;
        this.#changed = changed;
    }

    open(): void {
        if (this.#state !== null) {
            return;
        }
        const { store, cityId } = this.#services;
        this.#stop = store.watchDoc(
            FIRESTORE_PATHS.city(cityId),
            cityDocSchema,
            (city) => {
                this.#cityChanged(city);
            },
            () => undefined,
        );
        this.#update(EMPTY_LINK_FORM, false, IDLE_PROBE);
    }

    edit(patch: Partial<LinkForm>): void {
        const state = this.#state;
        if (state !== null) {
            this.#update({ ...state.form, ...patch }, state.tried, changesSource(patch) ? IDLE_PROBE : state.probe);
        }
    }

    /** Check: the address's own checks (the schema, the city's Mapbox account), then one tile asked by the server. */
    async check(): Promise<void> {
        const state = this.#state;
        if (state === null || state.probe.status === 'checking') {
            return;
        }
        const asked = this.#probeRequest(state.form);
        if (asked.kind === 'refused') {
            this.#update(state.form, true, asked.probe);
            return;
        }
        this.#set({ ...state, probe: { status: 'checking' } });
        this.#probed(state.form, await this.#probe(asked.request));
    }

    /** Check's request, or what its own checks found: an invalid address (its field says why) or another account's tileset. */
    #probeRequest(form: LinkForm): ProbeAsk {
        const request = validate(imageryProbeRequestSchema, {
            cityId: this.#services.cityId,
            source: sourceOf(form.address, form.tileSize),
        });
        if (!request.ok) {
            return { kind: 'refused', probe: IDLE_PROBE };
        }
        const refusal = layerSourceRefusal(request.value.source, this.#mapboxUser);
        return refusal === null ? { kind: 'ask', request: request.value } : { kind: 'refused', probe: { status: 'failed', refusal } };
    }

    async #probe(request: ImageryProbeRequest): Promise<LinkProbe> {
        try {
            const answer = await this.#services.callables.call('imagery.probeTiles', request);
            return { status: 'ok', contentType: answer.contentType };
        } catch (error) {
            return { status: 'failed', refusal: refusalOf(error) };
        }
    }

    /** Check's answer, unless the address changed (or the dialog closed) meanwhile. */
    #probed(form: LinkForm, probe: LinkProbe): void {
        const state = this.#state;
        if (state !== null && state.form.address === form.address && state.form.tileSize === form.tileSize) {
            this.#set({ ...state, probe });
        }
    }

    close(): void {
        this.#stop?.();
        this.#stop = null;
        this.#set(null);
    }

    /** Sends the form when it passes every check; the new layer's id, or null. */
    async submit(): Promise<string | null> {
        const state = this.#state;
        if (state === null || !sendable(state)) {
            return null;
        }
        const check = linkCheck(this.#services.cityId, state.form, this.#mapboxUser);
        if (!check.ok) {
            this.#update(state.form, true, state.probe);
            return null;
        }
        this.#set({ ...state, tried: true, sending: true });
        try {
            const { layerId } = await this.#services.callables.call('layers.link', check.request);
            this.#services.notify({ key: 'adminContent.layers.linked', params: { name: check.request.label.ro } });
            this.close();
            return layerId;
        } catch (error) {
            this.#refused(codeOf(error));
            return null;
        }
    }

    #refused(code: ReturnType<typeof codeOf>): void {
        const state = this.#state;
        if (state !== null) {
            this.#set({ ...state, sending: false, refusal: { code } });
        }
    }

    #cityChanged(city: Stored<CityDoc> | null): void {
        this.#mapboxUser = city?.data.mapbox?.user ?? null;
        if (this.#state !== null) {
            this.#update(this.#state.form, this.#state.tried, this.#state.probe);
        }
    }

    #update(form: LinkForm, tried: boolean, probe: LinkProbe): void {
        const check = linkCheck(this.#services.cityId, form, this.#mapboxUser);
        this.#set({
            form,
            tried,
            probe,
            sending: false,
            issues: check.ok || !tried ? [] : check.issues,
            refusal: check.ok ? null : check.refusal,
            origins: check.ok ? check.origins : [],
        });
    }

    #set(state: LinkState | null): void {
        this.#state = state;
        this.#changed(state);
    }
}
