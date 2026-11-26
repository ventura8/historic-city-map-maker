/**
 * What the editors' pages read of the admin app (`docs/research/M2c-interfaces.md` §2.3): one area store per page,
 * mirrored structurally like `admin-port.ts` (`@hcm/ui` sits below `@hcm/admin`). `AdminAppPort.content` holds one
 * member per area, null when the app has no module for it; `packages/admin/test/app/admin-port.test.ts` checks at
 * compile time that each real store satisfies its port.
 *
 * Shared by every workstream: one marked section per area (§11.2). A workstream adds its member (and its view types'
 * import) inside its own section only and never moves the markers. The shapes every live list and document share are
 * in `area-port.ts` (re-exported here): an area's port file imports them from there, so no import goes round in a
 * circle through this file.
 */
import type { AreaPort } from './area-port.js';
import type { AdminsIntentsPort, AdminsViewState } from './admins/admins-port.js';
import type { ContributeIntentsPort, ContributeViewState } from './contribute/contribute-port.js';
import type { ReviewIntentsPort, ReviewViewState } from './review/review-port.js';
import type { NewCityIntentsPort, NewCityViewState } from './cities/cities-port.js';
import type { CrashesIntentsPort, CrashesViewState } from './crashes/crashes-port.js';
import type { GeorefIntentsPort, GeorefViewState } from './georef/georef-port.js';
import type { HistoryIntentsPort, HistoryViewState } from './history/history-port.js';
import type { HomeIntentsPort, HomeViewState } from './home/home-port.js';
import type { ImageryIntentsPort, ImageryViewState } from './imagery/imagery-port.js';
import type { InboxIntentsPort, InboxViewState } from './inbox/inbox-port.js';
import type { JobsIntentsPort, JobsViewState } from './jobs/jobs-port.js';
import type { LayersIntentsPort, LayersViewState } from './layers/layers-port.js';
import type { PhotosIntentsPort, PhotosViewState } from './photos/photos-port.js';
import type { PoisIntentsPort, PoisViewState } from './pois/pois-port.js';
import type { SettingsIntentsPort, SettingsViewState } from './settings/settings-port.js';
import type { StoriesIntentsPort, StoriesViewState } from './stories/stories-port.js';
import type { TilesIntentsPort, TilesViewState } from './tiles/tiles-port.js';

export type { AreaPort, DocStatePort, ListStatePort, LoadStatusPort, StoredPort, StoreFailurePort } from './area-port.js';

export interface ContentPort {
    // [section photos] owner: photos
    readonly photos: AreaPort<PhotosViewState, PhotosIntentsPort> | null;
    // [end photos]
    // [section pois] owner: pois
    readonly pois: AreaPort<PoisViewState, PoisIntentsPort> | null;
    // [end pois]
    // [section layers] owner: layers-settings
    readonly layers: AreaPort<LayersViewState, LayersIntentsPort> | null;
    // [end layers]
    // [section settings] owner: layers-settings
    readonly settings: AreaPort<SettingsViewState, SettingsIntentsPort> | null;
    // [end settings]
    // [section ops] owner: ops-screens (admins, history, jobs, crash reports, the dashboard)
    readonly admins: AreaPort<AdminsViewState, AdminsIntentsPort> | null;
    readonly history: AreaPort<HistoryViewState, HistoryIntentsPort> | null;
    readonly jobs: AreaPort<JobsViewState, JobsIntentsPort> | null;
    readonly crashes: AreaPort<CrashesViewState, CrashesIntentsPort> | null;
    readonly home: AreaPort<HomeViewState, HomeIntentsPort> | null;
    // [end ops]
    // [section imagery] owner: admin-imagery (docs/research/M3-interfaces.md §10)
    readonly imagery: AreaPort<ImageryViewState, ImageryIntentsPort> | null;
    readonly georef: AreaPort<GeorefViewState, GeorefIntentsPort> | null;
    // [end imagery]
    // [section inbox] owner: assists-notify (docs/research/M4-interfaces.md §5.5)
    readonly inbox: AreaPort<InboxViewState, InboxIntentsPort> | null;
    // [end inbox]
    // [section review] owner: roles (docs/research/M13-roles.md §8)
    readonly review: AreaPort<ReviewViewState, ReviewIntentsPort> | null;
    readonly contribute: AreaPort<ContributeViewState, ContributeIntentsPort> | null;
    // [end review]
    // [section stories] owner: stories (docs/research/M17-stories.md §6)
    readonly stories: AreaPort<StoriesViewState, StoriesIntentsPort> | null;
    // [end stories]
    // [section help] owner: tilewizard (docs/research/M20-import-local.md §19.11)
    readonly help: AreaPort<TilesViewState, TilesIntentsPort> | null;
    // [end help]
    // [section cities] owner: multi-city (docs/research/M5-interfaces.md §1.6)
    readonly cities: AreaPort<NewCityViewState, NewCityIntentsPort> | null;
    // [end cities]
}
