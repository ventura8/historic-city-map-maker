/**
 * The visitor's analytics consent (scenario V19, PLAN Addendum 2): `unknown` until they answer the banner, stored per
 * city under `hcm:<cityId>:consent`, withdrawable in About. Google's Consent Mode v2 starts with everything denied;
 * accepting grants `analytics_storage` only (no advertising storage, no ad personalisation, ever).
 */
import type { Logger } from '@hcm/shared';
import { Listeners, type Unsubscribe } from '@hcm/ui/map';

import { Preferences, type PreferenceStorage } from '../core/preferences.js';
import type { ConsentState } from './telemetry-port.js';

export type ConsentValue = 'granted' | 'denied';

/** Consent Mode v2 settings (`setConsent` of firebase/analytics): the defaults before any answer. */
export const CONSENT_DENIED = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
} as const;

/** After "Accept": analytics storage only. */
export const CONSENT_GRANTED = { ...CONSENT_DENIED, analytics_storage: 'granted' } as const;

export function parseConsent(value: string | null): ConsentState {
    return value === 'granted' || value === 'denied' ? value : 'unknown';
}

export class ConsentStore {
    readonly #preferences: Preferences;
    readonly #listeners: Listeners<[ConsentState]>;
    #cityId: string | undefined;
    /** The state while the visitor has not answered: `unknown`, or `denied` under a privacy signal. */
    readonly #unanswered: ConsentState;
    /** The visitor's own answer (stored, or given on this page), or null. */
    #answer: ConsentValue | null;
    #state: ConsentState;

    /**
     * `declined`: the browser asks not to be tracked (Do Not Track, Global Privacy Control; `privacySignal` of
     * `@hcm/shared`): without a stored answer the visitor counts as having declined, never stored, so no banner asks;
     * an "Accept" in About still applies.
     */
    constructor(storage: PreferenceStorage, log: Logger, cityId: string | undefined, declined = false) {
        this.#preferences = new Preferences(storage, log);
        this.#listeners = new Listeners((error) => {
            log.error('consent listener failed', { error: String(error) });
        });
        this.#cityId = cityId;
        this.#unanswered = declined ? 'denied' : 'unknown';
        this.#answer = this.#stored(cityId);
        this.#state = this.#answer ?? this.#unanswered;
    }

    get state(): ConsentState {
        return this.#state;
    }

    /** The city became known (the manifest loaded): its stored answer applies, or an earlier answer is stored for it. */
    setCity(cityId: string): void {
        if (cityId === this.#cityId) {
            return;
        }
        this.#cityId = cityId;
        const stored = this.#stored(cityId);
        if (stored === null && this.#answer !== null) {
            this.#preferences.set(cityId, 'consent', this.#answer);
            return;
        }
        this.#answer = stored;
        this.#change(stored ?? this.#unanswered);
    }

    /** The answer stored for `cityId` (or the page before a city), or null. */
    #stored(cityId: string | undefined): ConsentValue | null {
        const stored = parseConsent(this.#preferences.get(cityId, 'consent'));
        return stored === 'unknown' ? null : stored;
    }

    /** The visitor's answer, stored and announced (stored only once the city is known). */
    set(consent: ConsentValue): void {
        this.#preferences.set(this.#cityId, 'consent', consent);
        this.#answer = consent;
        this.#change(consent);
    }

    onChange(listener: (consent: ConsentState) => void): Unsubscribe {
        return this.#listeners.add(listener);
    }

    #change(next: ConsentState): void {
        if (next !== this.#state) {
            this.#state = next;
            this.#listeners.emit(next);
        }
    }

    destroy(): void {
        this.#listeners.clear();
    }
}
