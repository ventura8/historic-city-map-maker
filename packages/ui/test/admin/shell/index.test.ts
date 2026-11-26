import { describe, expect, it } from 'vitest';

import * as admin from '../../../src/admin/index.js';

describe('@hcm/ui/admin', () => {
    // The entry is shared by every editor workstream (one marked section per area, docs/research/M2c-interfaces.md §11.2):
    // this pins what the shell, Setup and the ops screens export; the other areas' tests pin theirs.
    it('happyPath_exposesTheShellsElementsAndHelpers', () => {
        expect(Object.keys(admin)).toEqual(
            expect.arrayContaining([
                'ADMIN_TAGS',
                'SETUP_PAGE_TAGS',
                'defineSetupElements',
                'AdminPanel',
                'HCM_ACCOUNT_MENU_TAG',
                'HCM_ADMINS_PAGE_TAG',
                'HCM_ADMIN_NAV_TAG',
                'HCM_ADMIN_SHELL_TAG',
                'HCM_BLOCKED_PANEL_TAG',
                'HCM_CLAIM_PANEL_TAG',
                'HCM_CONSENT_NOTE_TAG',
                'HCM_JOIN_PANEL_TAG',
                'HCM_PAGE_OUTLET_TAG',
                'HCM_SIGN_IN_TAG',
                'HcmAccountMenu',
                'HcmAdminNav',
                'HcmAdminShell',
                'HcmAdminsPage',
                'HcmBlockedPanel',
                'HcmClaimPanel',
                'HcmConsentNote',
                'HcmJoinPanel',
                'HcmPageOutlet',
                'HcmSignIn',
                'adminBase',
                'defineAdminElements',
                'issueTemplate',
                'noticeOf',
                'noticeText',
                'panelStyles',
                'shellLayout',
                'shellText',
                'shownTokens',
                'themeTokensOf',
                'contentText',
            ]),
        );
        expect(admin.ADMIN_TAGS).toContain(admin.HCM_ADMIN_SHELL_TAG);
    });

    it('happyPath_exposesTheEditingKitAndTheOpsPages', () => {
        expect(Object.keys(admin)).toEqual(
            expect.arrayContaining([
                'AreaPage',
                'EDITING_TAGS',
                'defineEditingElements',
                'editingStyles',
                'HCM_CONFIRM_DIALOG_TAG',
                'HcmConfirmDialog',
                'HCM_EMPTY_STATE_TAG',
                'HcmEmptyState',
                'HCM_LIST_DETAIL_TAG',
                'HcmListDetail',
                'current',
                'errorTemplate',
                'failureText',
                'formatDay',
                'formatWhen',
                'listBody',
                'loadingTemplate',
                'reconnectingStatus',
                'whoText',
                'HcmAdminsPage',
                'HCM_CRASHES_LIST_PAGE_TAG',
                'HcmCrashesListPage',
                'errorGroupUrl',
                'HCM_HISTORY_PAGE_TAG',
                'HcmHistoryPage',
                'describeValue',
                'HCM_HOME_PAGE_TAG',
                'HcmHomePage',
                'HCM_JOBS_PAGE_TAG',
                'HcmJobsPage',
            ]),
        );
    });
});
