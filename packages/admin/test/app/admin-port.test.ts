// The admin app must satisfy the structural ports its elements read (`docs/research/M2b-interfaces.md` §1.7): a change
// on either side that breaks the other fails `tsc` here, the Setup Assistant's state and intents (setup-ui's
// `SetupViewState`, `SetupIntentsPort`) included. The runtime assertions only keep the file a test.
import type { AdminAppPort, AdminPageElement, ContentPort } from '@hcm/ui/admin';
import { describe, expect, it } from 'vitest';

import type { ADMINS_MODULE } from '../../src/admins/admins.js';
import type { CRASHES_MODULE } from '../../src/crashes/crashes.js';
import type { HISTORY_MODULE } from '../../src/history/history.js';
import type { GEOREF_MODULE } from '../../src/georef/georef.js';
import type { HOME_MODULE } from '../../src/home/home.js';
import type { IMAGERY_MODULE } from '../../src/imagery/imagery.js';
import type { INBOX_MODULE } from '../../src/inbox/inbox.js';
import type { JOBS_MODULE } from '../../src/jobs/jobs.js';
import type { layersModule } from '../../src/layers/layers.js';
import type { PHOTOS_MODULE } from '../../src/photos/module.js';
import type { POIS_MODULE } from '../../src/pois/pois.js';
import type { settingsModule } from '../../src/settings/settings.js';

import { ADMIN_AUTH_STATES } from '../../src/auth/auth-state.js';
import type { AdminApp } from '../../src/app/mount.js';
import { ADMIN_ROUTES } from '../../src/routing/routes.js';
import type { SetupModule } from '../../src/setup/module.js';
import type { SetupState } from '../../src/setup/state.js';

type Assignable<Source, Target> = [Source] extends [Target] ? true : false;

/** The app as the entry mounts it: setup-ui's module (`createSetupModule`), or none. */
type EntryApp = AdminApp<SetupState | null, ReturnType<SetupModule['create']> | null>;

const APP_SATISFIES_PORT: Assignable<EntryApp, AdminAppPort> = true;
const MISSING_CONFIG_APP_SATISFIES_PORT: Assignable<AdminApp<null, null>, AdminAppPort> = true;
const STATES_MIRRORED: Assignable<(typeof ADMIN_AUTH_STATES)[number], AdminAppPort['state']['auth']> = true;
const ROUTES_MIRRORED: Assignable<(typeof ADMIN_ROUTES)[number], AdminAppPort['state']['route']['id']> = true;
const PAGE_GETS_THE_APP: Assignable<EntryApp, NonNullable<AdminPageElement['app']>> = true;

/** The store an area's module creates. */
type StoreOf<Module extends { create(services: never): unknown }> = ReturnType<Module['create']>;

// Each real area store satisfies its page's port (docs/research/M2c-interfaces.md §2.3): one marked section per area.
// [section photos] owner: photos
const PHOTOS_PORT: Assignable<StoreOf<typeof PHOTOS_MODULE>, NonNullable<ContentPort['photos']>> = true;
// [end photos]
// [section pois] owner: pois
const POIS_PORT: Assignable<StoreOf<typeof POIS_MODULE>, NonNullable<ContentPort['pois']>> = true;

describe('the photos and places ports', () => {
    it('happyPath_thePhotosAndPlacesStoresSatisfyTheirPagesPorts', () => {
        expect([PHOTOS_PORT, POIS_PORT]).toEqual([true, true]);
    });
});
// [end pois]
// [section layers] owner: layers-settings
const LAYERS_PORT: Assignable<StoreOf<typeof layersModule>, NonNullable<ContentPort['layers']>> = true;
// [end layers]
// [section settings] owner: layers-settings
const SETTINGS_PORT: Assignable<StoreOf<ReturnType<typeof settingsModule>>, NonNullable<ContentPort['settings']>> = true;

describe('the layers and settings ports', () => {
    it('happyPath_theLayersAndSettingsStoresSatisfyTheirPagesPorts', () => {
        expect([LAYERS_PORT, SETTINGS_PORT]).toEqual([true, true]);
    });
});
// [end settings]
// [section ops] owner: ops-screens
const OPS_PORTS: readonly true[] = [
    true satisfies Assignable<StoreOf<typeof ADMINS_MODULE>, NonNullable<ContentPort['admins']>>,
    true satisfies Assignable<StoreOf<typeof HISTORY_MODULE>, NonNullable<ContentPort['history']>>,
    true satisfies Assignable<StoreOf<typeof JOBS_MODULE>, NonNullable<ContentPort['jobs']>>,
    true satisfies Assignable<StoreOf<typeof CRASHES_MODULE>, NonNullable<ContentPort['crashes']>>,
    true satisfies Assignable<StoreOf<typeof HOME_MODULE>, NonNullable<ContentPort['home']>>,
];
// [end ops]
// [section imagery] owner: admin-imagery
const IMAGERY_PORTS: readonly true[] = [
    true satisfies Assignable<StoreOf<typeof IMAGERY_MODULE>, NonNullable<ContentPort['imagery']>>,
    true satisfies Assignable<StoreOf<typeof GEOREF_MODULE>, NonNullable<ContentPort['georef']>>,
];

describe('the imagery ports', () => {
    it('happyPath_theImageryAndGeoreferencerStoresSatisfyTheirPagesPorts', () => {
        expect(IMAGERY_PORTS).toEqual([true, true]);
    });
});
// [end imagery]
// [section inbox] owner: assists-notify (docs/research/M4-interfaces.md §5.5)
const INBOX_PORT: Assignable<StoreOf<typeof INBOX_MODULE>, NonNullable<ContentPort['inbox']>> = true;

describe('the inbox port', () => {
    it('happyPath_theInboxStoreSatisfiesItsPagesPort', () => {
        expect([INBOX_PORT]).toEqual([true]);
    });
});
// [end inbox]

describe('the admin ports', () => {
    it('happyPath_theAppAndItsStateSatisfyTheElementsPorts', () => {
        expect([APP_SATISFIES_PORT, MISSING_CONFIG_APP_SATISFIES_PORT, STATES_MIRRORED, ROUTES_MIRRORED, PAGE_GETS_THE_APP]).toEqual([
            true,
            true,
            true,
            true,
            true,
        ]);
        expect(ADMIN_AUTH_STATES).toHaveLength(15);
        expect(ADMIN_ROUTES).toHaveLength(18);
        expect(OPS_PORTS).toHaveLength(5);
    });
});
