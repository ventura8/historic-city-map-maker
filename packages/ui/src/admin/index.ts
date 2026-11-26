// The admin's elements (`@hcm/ui/admin`, docs/research/M2b-interfaces.md §1.7): imported only by @hcm/admin, never by the
// engine, so the public viewer's bundle carries no admin element or text.
export { ADMIN_TAGS, defineAdminElements } from './define.js';
export type { AreaElements } from './areas/area.js';
export { HCM_BLOCKED_PANEL_TAG, HcmBlockedPanel } from './auth/hcm-blocked-panel.js';
export { HCM_CLAIM_PANEL_TAG, HcmClaimPanel } from './auth/hcm-claim-panel.js';
export { HCM_CONSENT_NOTE_TAG, HcmConsentNote } from './auth/hcm-consent-note.js';
export type { GoogleScopePort } from './auth/hcm-consent-note.js';
export { HCM_JOIN_PANEL_TAG, HcmJoinPanel } from './auth/hcm-join-panel.js';
export { HCM_SIGN_IN_TAG, HcmSignIn } from './auth/hcm-sign-in.js';
export { AdminPanel, issueTemplate } from './auth/panel.js';
export { HCM_ACCOUNT_MENU_TAG, HcmAccountMenu } from './shell/hcm-account-menu.js';
export { HCM_ADMIN_NAV_TAG, HcmAdminNav } from './shell/hcm-admin-nav.js';
export type { AdminNavVariant } from './shell/hcm-admin-nav.js';
export { HCM_ADMIN_SHELL_TAG, HcmAdminShell, shellLayout, shownTokens, themeTokensOf } from './shell/hcm-admin-shell.js';
export type { ShellLayout } from './shell/hcm-admin-shell.js';
export { HCM_PAGE_OUTLET_TAG, HcmPageOutlet } from './shell/hcm-page-outlet.js';
export { adminBase, panelStyles } from './shell/admin-styles.js';
export { contentText, noticeOf, noticeText, shellText } from './shell/text.js';
// setup-ui's pages (`setup`, `crashes`), which the admin's page registry loads.
export { SETUP_PAGE_TAGS, defineSetupElements } from './setup/define.js';
// The quota card's Quotas page (finding 47 of 2026-11-01): links.test.ts keeps it equal to links.json's `gcp.quotas`.
export { quotasUrl } from './setup/install-status.js';
export type {
    AdminAppPort,
    AdminAuthStatePort,
    AdminDestinationPort,
    AdminIntentsPort,
    AdminNoticeInputPort,
    AdminNoticeKey,
    AdminNoticePort,
    AdminOutcomePort,
    AdminPageElement,
    AdminRouteIdPort,
    AdminRoutePort,
    AdminStatePort,
} from './admin-port.js';
export type { AreaPort, ContentPort, DocStatePort, ListStatePort, LoadStatusPort, StoredPort, StoreFailurePort } from './content-port.js';
// The editing kit (docs/research/M2c-interfaces.md §9.5): every area's pages build on it.
export { AreaPage } from './editing/area-page.js';
export { EDITING_TAGS, defineEditingElements } from './editing/define.js';
export { editingStyles } from './editing/editing-styles.js';
export { HCM_CONFIRM_DIALOG_TAG, HcmConfirmDialog } from './editing/hcm-confirm-dialog.js';
export { HCM_EMPTY_STATE_TAG, HcmEmptyState } from './editing/hcm-empty-state.js';
export { HCM_LIST_DETAIL_TAG, HcmListDetail } from './editing/hcm-list-detail.js';
export type { PageChrome } from './editing/hcm-list-detail.js';
export {
    current,
    errorTemplate,
    failureText,
    formatDay,
    formatWhen,
    listBody,
    loadingTemplate,
    reconnectingStatus,
    whoText,
} from './editing/states.js';
export type { ListTexts } from './editing/states.js';
// The editors' pages and their ports: one marked section per area (§11.2).
// [section photos] owner: photos
export { HCM_PHOTOS_PAGE_TAG, HcmPhotosPage } from './photos/hcm-photos-page.js';
export { HCM_ADMIN_PHOTO_EDITOR_TAG, HcmAdminPhotoEditor } from './photos/hcm-admin-photo-editor.js';
export { HCM_ADMIN_PHOTO_LIST_TAG, HcmAdminPhotoList } from './photos/hcm-admin-photo-list.js';
export { definePhotosElements } from './photos/define.js';
export type { PhotosAreaPort, PhotosIntentsPort, PhotosViewState } from './photos/photos-port.js';
// [end photos]
// [section pois] owner: pois
export { HCM_POIS_PAGE_TAG, HcmPoisPage, saveFile } from './pois/hcm-pois-page.js';
export { HCM_POI_EDITOR_TAG, HcmPoiEditor } from './pois/hcm-poi-editor.js';
export { HCM_POI_LIST_TAG, HcmPoiList } from './pois/hcm-poi-list.js';
export { definePoisElements } from './pois/define.js';
export type { PoisAreaPort, PoisIntentsPort, PoisViewState } from './pois/pois-port.js';
export type { StoriesIntentsPort, StoriesViewState } from './stories/stories-port.js';
export type {
    TilePointPort,
    TileQualityPort,
    TileRectPort,
    TileSeamPort,
    TileSheetPort,
    TilesIntentsPort,
    TileStepPort,
    TilesViewState,
} from './tiles/tiles-port.js';
export { HCM_ADMIN_MAP_TAG, HcmAdminMap } from './map/hcm-admin-map.js';
export { HCM_DRAW_TOOLBAR_TAG, HcmDrawToolbar } from './map/hcm-draw-toolbar.js';
export { HCM_VERTEX_LIST_TAG, HcmVertexList } from './map/hcm-vertex-list.js';
export { defineAdminMapElements } from './map/define.js';
// [end pois]
// [section layers] owner: layers-settings
export { HCM_LAYERS_PAGE_TAG, HcmLayersPage } from './layers/hcm-layers-page.js';
export { defineLayersElements } from './layers/define.js';
export type { LayersIntentsPort, LayersViewState, PreviewSinkPort } from './layers/layers-port.js';
// [end layers]
// [section settings] owner: layers-settings
export { HCM_SETTINGS_PAGE_TAG, HcmSettingsPage } from './settings/hcm-settings-page.js';
export { HCM_ICON_PICKER_TAG, HcmIconPicker } from './settings/hcm-icon-picker.js';
export { defineSettingsElements } from './settings/define.js';
export type { SettingsIntentsPort, SettingsViewState } from './settings/settings-port.js';
// [end settings]
// [section ops] owner: ops-screens
export { HCM_ADMINS_PAGE_TAG, HcmAdminsPage } from './admins/hcm-admins-page.js';
export type { AdminSelectionPort, AdminsIntentsPort, AdminsViewState } from './admins/admins-port.js';
export { HCM_CRASHES_LIST_PAGE_TAG, HcmCrashesListPage, errorGroupUrl } from './crashes/hcm-crashes-list-page.js';
export type { CrashesIntentsPort, CrashesViewState, CrashGroupPort, CrashPeriodPort } from './crashes/crashes-port.js';
export { HCM_HISTORY_PAGE_TAG, HcmHistoryPage } from './history/hcm-history-page.js';
export { describeValue } from './history/describe.js';
export type { HistoryIntentsPort, HistoryItemPort, HistoryViewState } from './history/history-port.js';
export { HCM_HOME_PAGE_TAG, HcmHomePage } from './home/hcm-home-page.js';
export type { HomeIntentsPort, HomeViewState } from './home/home-port.js';
export { HCM_JOBS_PAGE_TAG, HcmJobsPage } from './jobs/hcm-jobs-page.js';
export type { JobItemPort, JobsIntentsPort, JobsViewState } from './jobs/jobs-port.js';
// [end ops]
