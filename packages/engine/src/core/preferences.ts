/**
 * The visitor's stored choices (language, theme, analytics consent, the single-key shortcuts) under `hcm:<cityId>:<name>`, so two cities on one
 * origin keep their own. Storage may be missing or throw (private browsing, blocked cookies, a full quota): every
 * access is guarded, a failure reads as "nothing stored" and a lost write is only logged.
 */
import type { Logger } from '@hcm/shared';

export type PreferenceName = 'lang' | 'theme' | 'accent' | 'consent' | 'shortcuts';

export type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function preferenceKey(cityId: string, name: PreferenceName): string {
    return `hcm:${cityId}:${name}`;
}

export class Preferences {
    readonly #storage: PreferenceStorage;
    readonly #log: Logger;

    constructor(storage: PreferenceStorage, log: Logger) {
        this.#storage = storage;
        this.#log = log;
    }

    /** The stored value, or null (none, no city yet, or storage unavailable). */
    get(cityId: string | undefined, name: PreferenceName): string | null {
        if (cityId === undefined) {
            return null;
        }
        try {
            return this.#storage.getItem(preferenceKey(cityId, name));
        } catch {
            return null;
        }
    }

    /** Stores `value` (null removes it); without a city nothing is stored. */
    set(cityId: string | undefined, name: PreferenceName, value: string | null): void {
        if (cityId === undefined) {
            return;
        }
        const key = preferenceKey(cityId, name);
        try {
            if (value === null) {
                this.#storage.removeItem(key);
            } else {
                this.#storage.setItem(key, value);
            }
        } catch {
            this.#log.warn('preference not stored', { name });
        }
    }
}
