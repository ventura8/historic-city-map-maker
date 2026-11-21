/**
 * The banners above the shell's page (`hcm-admin-shell.ts`): a revoked admin's (§35e: the page stays, read-only, with
 * Sign out) and, since finding 29 of 2026-10-31 (`docs/research/manual-test-2026-10-25.md`), a newer admin served by
 * Hosting while this tab runs the old one: a polite status with Reload, which never blocks the page (the sign-in lives
 * in the tab's `sessionStorage`, so it survives the reload). Both sit in the scrolling region, inside `<main>`.
 */
import { html, type TemplateResult } from 'lit';

import type { AdminStatePort } from '../admin-port.js';
import { EMPTY } from './empty.js';
import { shellText } from './text.js';

/** The access was removed while editing: the page stays, read-only, under this until the admin signs out (§35e). */
export function revokedBanner(state: AdminStatePort, signOut: () => void): TemplateResult {
    if (state.revoked !== true) {
        return EMPTY;
    }
    return html`<div class="banner revoked" role="alert">
        <p>${shellText(state.locale, 'adminShell.session.revoked')}</p>
        <hcm-button variant="tonal" icon="logout" @click=${signOut}>${shellText(state.locale, 'adminShell.auth.signOut')}</hcm-button>
    </div>`;
}

/** A newer admin is served (finding 29): the words and Reload, announced politely once. */
export function releaseBanner(state: AdminStatePort, reload: () => void): TemplateResult {
    const release = state.newRelease ?? null;
    return html`<div class="release-status" role="status">
        ${
            release === null
                ? EMPTY
                : html`<div class="banner release" data-release=${release}>
                      <p>${shellText(state.locale, 'adminShell.update.ready')}</p>
                      <hcm-button variant="filled" icon="refresh" @click=${reload}
                          >${shellText(state.locale, 'adminShell.update.reload')}</hcm-button
                      >
                  </div>`
        }
    </div>`;
}
