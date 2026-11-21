/**
 * Pieces shared by the sign-in, claim, join and blocked panels: the panel's message and the "use another account"
 * button. A panel element takes the app (for its intents) and the state (to render), as every admin element does.
 */
import type { UiLocale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import type { AdminAppPort, AdminNoticeInputPort, AdminStatePort } from '../admin-port.js';
import { EMPTY } from '../shell/empty.js';
import { noticeOf, shellText } from '../shell/text.js';

/** The panel's message as an alert (announced when it appears), or nothing. */
export function issueTemplate(locale: UiLocale, issue: AdminNoticeInputPort | null): TemplateResult {
    return issue === null
        ? EMPTY
        : html`<p class="issue" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, issue)}</span></p>`;
}

/** The base of a panel element: `app` and `state` properties, and the sign-out button. */
export class AdminPanel extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        state: { attribute: false },
    };

    declare app: AdminAppPort | null;
    declare state: AdminStatePort | null;

    constructor() {
        super();
        this.app = null;
        this.state = null;
    }

    /** Signs out, so another Google account can sign in. */
    protected otherAccount(locale: UiLocale): TemplateResult {
        const signOut = (): void => {
            void this.app?.intents.signOut();
        };
        return html`<hcm-button variant="text" @click=${signOut}>${shellText(locale, 'adminShell.auth.otherAccount')}</hcm-button>`;
    }
}
