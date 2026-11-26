/**
 * The editors' services as `mount` builds them (`docs/research/M2c-interfaces.md` §2.2): the entry's `ContentDeps`
 * (Firestore, the theme function, the areas' own services, the city) joined with the shell's (the guarded callables,
 * the clock, `localStorage`, the logger, who is signed in, the language, the snackbar, the revocation check, the theme
 * preview the whole admin wears). A revoked admin's writes are refused before they reach Firestore (`../content/revoked.ts`).
 */
import type { Logger } from '@hcm/shared';

import type { ContentDeps } from '../content/registry.js';
import { writesRefusedWhen } from '../content/revoked.js';
import type { ContentServices } from '../content/services.js';
import type { CallablesPort } from '../firebase/ports.js';
import type { ShellStateAccess } from '../state/state.js';
import type { Clock, KeyValueStore } from './ports.js';

export interface ContentShell {
    /** M14: the start page's city, which New city opens with. */
    readonly firstCity?: ContentServices['firstCity'];
    readonly content: ContentDeps;
    /** `infra/project.json`'s cities: the first is edited before the shell knows the admin's own (M5). */
    readonly cities: readonly string[];
    readonly callables: CallablesPort;
    readonly clock: Clock;
    readonly local: KeyValueStore;
    readonly log: Logger;
    readonly shell: ShellStateAccess;
    /** A refused read or write: the shell asks `admin.session` again. */
    readonly denied: () => void;
    /** §203: the Statistics view's numbers, made from the shell's Google consent (`statistics-wiring.ts`). */
    readonly statistics?: (cityId: () => string) => ContentServices['statistics'];
}

/** An admin's name as the lists show it: the Google display name, else the address; none without either. */
function nameOf(admin: { readonly displayName?: string | undefined; readonly email?: string | undefined }): string {
    return admin.displayName ?? admin.email ?? '';
}

/**
 * Asks `admins.list` once (again after a failure) and gives the shell every admin's name by uid. The names are shown
 * as text only (who saved a conflicting change); they leave with the session.
 */
function peopleOf(parts: ContentShell, cityId: () => string): () => void {
    let asked: Promise<void> | null = null;
    const ask = async (): Promise<void> => {
        try {
            const { admins } = await parts.callables.call('admins.list', { cityId: cityId() });
            const named = admins.map((admin) => [admin.uid, nameOf(admin)] as const).filter(([, name]) => name !== '');
            parts.shell.update({ people: Object.fromEntries(named) });
        } catch (error) {
            asked = null;
            parts.log.warn('admins could not be listed for their names', { error: String(error) });
        }
    };
    return () => {
        asked ??= ask();
    };
}

/**
 * The city the areas edit: the shell's current city (M5, `docs/research/M5-interfaces.md` §1.5: decided once
 * `admin.session` answers, before any area opens), else the `e2e` build's own city, else the project's first.
 */
function currentCityOf(parts: ContentShell): () => string {
    return () => parts.shell.get().cityId ?? parts.content.cityId ?? parts.cities[0] ?? '';
}

/** The admin's map, told which city it shows: an account that cannot read Setup's token wears that city's public one (M13 §8). */
function mapsOfCity(maps: ContentDeps['areas']['maps'], cityId: () => string): Pick<ContentServices, 'maps'> {
    if (maps === undefined || maps === null) {
        return {};
    }
    return { maps: { create: (container, options) => maps.create(container, { cityId: cityId(), ...options }) } };
}

export function contentServices(parts: ContentShell): ContentServices {
    const { content, shell } = parts;
    const cityId = currentCityOf(parts);
    return {
        ...content.areas,
        ...mapsOfCity(content.areas.maps, cityId),
        get cityId() {
            return cityId();
        },
        firstCity: parts.firstCity,
        statistics: parts.statistics?.(cityId) ?? content.areas.statistics ?? null,
        adminCityIds: () => shell.get().cities.map((city) => city.id),
        store: writesRefusedWhen(content.store, () => shell.get().revoked),
        ...{ theme: content.theme, callables: parts.callables },
        ...{ clock: parts.clock, local: parts.local, log: parts.log, denied: parts.denied },
        user: () => {
            const user = shell.get().user;
            return user === null ? null : { uid: user.uid, name: user.displayName ?? user.email };
        },
        locale: () => shell.get().locale,
        cityRole: () => {
            const state = shell.get();
            return state.cities.find((city) => city.id === cityId())?.role ?? null;
        },
        people: peopleOf(parts, cityId),
        readOnly: () => shell.get().revoked,
        notify: (notice) => {
            shell.update({ notice: shell.notice(notice) });
        },
        previewTheme: (preview) => {
            shell.update({ theme: { ...shell.get().theme, preview } });
        },
    };
}
