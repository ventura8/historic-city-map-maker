/**
 * `<hcm-admins-page>`: `#/admins`, `#/admins/<uid>` and `#/admins/invite/<inviteId>` (`docs/research/M2c-interfaces.md`
 * §9.1; behaviour A02; M5 `docs/research/M5-interfaces.md` §1.7, behaviour A51: the current city's admins), in the list and
 * detail layout. The list holds the city's admins (role in the city, the project's owner, "you") and the city's pending
 * invitations (expiry); the detail shows an admin (address, role, since when) with the role field and **Remove access**,
 * or an invitation (created, expiry, the sign-in link when it was made in this visit, copied at once and with Copy) with
 * **Cancel invitation**; each asks first. **Invite** opens a dialog for the Google account's address (checked in the page
 * first) and the role (Editor unless changed). Only the city's owners invite, change roles and remove; an editor sees the
 * list and why. Oneself is never removable: the page says why (the server refuses it anyway).
 */
import { cityInviteRequestSchema, type CityAdminsListResponse, type CityRole, type InviteResponse, type UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import type { AdminNoticeInputPort, AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { AreaPage } from '../editing/area-page.js';
import { editingStyles } from '../editing/editing-styles.js';
import { current, formatDay, loadingTemplate, whoText } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf, shellText } from '../shell/text.js';
import type { AdminsIntentsPort, AdminsViewState, RevokeInputPort } from './admins-port.js';
import { adminsStyles, inviteDialog } from './invite-dialog.js';
import { questionOf, type Pending } from './questions.js';
import { currentCityName, ownsCurrentCity, roleField, roleText, rowDetail } from './roles.js';

export const HCM_ADMINS_PAGE_TAG = 'hcm-admins-page';

type Admin = CityAdminsListResponse['admins'][number];
type Invite = CityAdminsListResponse['invites'][number];

/** How an admin is named: the Google display name, else the address. */
function nameOf(locale: UiLocale, admin: Admin): string {
    return admin.displayName ?? admin.email ?? shellText(locale, 'adminShell.admins.unnamed');
}

/** The open item's key (`detailKey`): an admin's uid or an invitation's id. */
function keyOf(selected: AdminsViewState['selected']): string {
    if (selected === null) {
        return '';
    }
    return selected.kind === 'admin' ? selected.uid : selected.inviteId;
}

/** The admin or the invitation the selection names, if the list holds it. */
function selectedItem(list: CityAdminsListResponse, selected: NonNullable<AdminsViewState['selected']>): Admin | Invite | undefined {
    if (selected.kind === 'admin') {
        return list.admins.find((candidate) => candidate.uid === selected.uid);
    }
    return list.invites.find((candidate) => candidate.inviteId === selected.inviteId);
}

/** Why an admin's access has no Remove: the project's owner stays an owner, and nobody removes oneself; else null. */
function removalNote(admin: Admin): 'adminContent.admins.ownerNote' | 'adminContent.admins.selfNote' | null {
    if (admin.projectOwner) {
        return 'adminContent.admins.ownerNote';
    }
    return admin.self ? 'adminContent.admins.selfNote' : null;
}

function isAdmin(item: Admin | Invite): item is Admin {
    return 'uid' in item;
}

function namesOf(list: CityAdminsListResponse | null): Readonly<Record<string, string>> {
    return Object.fromEntries((list?.admins ?? []).map((admin) => [admin.uid, admin.displayName ?? admin.email ?? admin.uid]));
}

export class HcmAdminsPage extends AreaPage<AdminsViewState, AdminsIntentsPort> {
    static override readonly properties = {
        ...AreaPage.properties,
        inviting: { state: true },
        inviteIssue: { state: true },
        pending: { state: true },
        issue: { state: true },
        copied: { state: true },
    };

    static override readonly styles = [...editingStyles, adminsStyles];

    protected readonly route: AdminRouteIdPort = 'admins';
    /** The invitation dialog is open. */
    declare inviting: boolean;
    /** The dialog's message (an invalid address, a refusal). */
    declare inviteIssue: AdminNoticeInputPort | null;
    declare pending: Pending | null;
    /** A refused removal, shown in the detail. */
    declare issue: AdminNoticeInputPort | null;
    declare copied: boolean;

    constructor() {
        super();
        this.inviting = false;
        this.inviteIssue = null;
        this.pending = null;
        this.issue = null;
        this.copied = false;
    }

    protected storeOf(content: ContentPort): AreaPort<AdminsViewState, AdminsIntentsPort> | null {
        return content.admins;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        const locale = this.locale;
        const back = (): void => {
            this.go([]);
        };
        const dialog = {
            ...{ locale, open: this.inviting, busy: view.busy, issue: this.inviteIssue, city: currentCityName(this.state, locale) },
            submit: (email: string, role: CityRole) => this.#sendInvite(email, role),
            close: () => {
                this.#closeInvite();
            },
        };
        return html`<hcm-list-detail
                ?detail=${view.selected !== null}
                .detailKey=${keyOf(view.selected)}
                .listLabel=${contentText(locale, 'adminContent.admins.listLabel')}
                .detailLabel=${contentText(locale, 'adminContent.admins.detailLabel')}
                .backLabel=${contentText(locale, 'adminContent.common.back')}
                .closeLabel=${contentText(locale, 'adminContent.common.close')}
                @hcm-back=${back}
            >
                <div slot="list">${this.#list(locale, view)}</div>
                <div slot="detail">${this.#detail(locale, view)}</div>
            </hcm-list-detail>
            ${inviteDialog(dialog)} ${this.#confirm(locale)}`;
    }

    #list(locale: UiLocale, view: AdminsViewState): TemplateResult {
        const invite = (): void => {
            this.inviteIssue = null;
            this.inviting = true;
        };
        const head = ownsCurrentCity(this.state)
            ? html`<div class="list-head">
                  <p class="note">${shellText(locale, 'adminShell.admins.intro')}</p>
                  <div class="actions">
                      <hcm-button variant="filled" icon="person_add" ?disabled=${this.readOnly} @click=${invite}
                          >${shellText(locale, 'adminShell.admins.invite')}</hcm-button
                      >
                  </div>
              </div>`
            : html`<div class="list-head"><p class="note">${shellText(locale, 'adminShell.admins.ownerOnly')}</p></div>`;
        return html`${head}${this.#listBody(locale, view)}`;
    }

    #listBody(locale: UiLocale, view: AdminsViewState): TemplateResult {
        if (view.list === null) {
            return view.status === 'error' ? this.#loadFailed(locale, view) : loadingTemplate(locale);
        }
        const selected = view.selected;
        return html`<div class="pane">
            <h2>${shellText(locale, 'adminShell.nav.admins')}</h2>
            <ul class="rows flush">
                ${view.list.admins.map((admin) => this.#adminRow(locale, admin, selected?.kind === 'admin' && selected.uid === admin.uid))}
            </ul>
            <h2>${shellText(locale, 'adminShell.admins.pending')}</h2>
            ${
                view.list.invites.length === 0
                    ? html`<p class="note">${shellText(locale, 'adminShell.admins.none')}</p>`
                    : html`<ul class="rows flush">
                          ${view.list.invites.map((invite) => this.#inviteRow(locale, invite, selected?.kind === 'invite' && selected.inviteId === invite.inviteId))}
                      </ul>`
            }
        </div>`;
    }

    #loadFailed(locale: UiLocale, view: AdminsViewState): TemplateResult {
        const retry = (): void => {
            void this.intents?.refresh();
        };
        return html`<div class="pane">
            <p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, view.failure)}</span></p>
            <div class="actions">
                <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
            </div>
        </div>`;
    }

    #adminRow(locale: UiLocale, admin: Admin, selected: boolean): TemplateResult {
        const detail = rowDetail(locale, admin);
        return html`<li>
            <a class="row" href=${this.href([admin.uid])} aria-current=${current(selected)}>
                <span class="row-title">${nameOf(locale, admin)}</span>
                <span class="row-detail">${detail}</span>
            </a>
        </li>`;
    }

    #inviteRow(locale: UiLocale, invite: Invite, selected: boolean): TemplateResult {
        return html`<li>
            <a class="row" href=${this.href(['invite', invite.inviteId])} aria-current=${current(selected)}>
                <span class="row-title"
                    >${contentText(locale, 'adminContent.admins.inviteTitle', { date: formatDay(locale, invite.createdAt) })}</span
                >
                <span class="row-detail"
                    >${contentText(locale, 'adminContent.admins.expires', { date: formatDay(locale, invite.expiresAt) })}</span
                >
            </a>
        </li>`;
    }

    #detail(locale: UiLocale, view: AdminsViewState): TemplateResult {
        const selected = view.selected;
        if (selected === null) {
            return html`<hcm-empty-state icon="group" .text=${contentText(locale, 'adminContent.admins.choose')}></hcm-empty-state>`;
        }
        if (view.list === null) {
            return view.status === 'error' ? EMPTY : loadingTemplate(locale);
        }
        return this.#item(locale, view, selectedItem(view.list, selected));
    }

    #item(locale: UiLocale, view: AdminsViewState, item: Admin | Invite | undefined): TemplateResult {
        if (item === undefined) {
            return this.#notFound(locale);
        }
        return isAdmin(item) ? this.#admin(locale, view, item) : this.#inviteDetail(locale, view, item);
    }

    #notFound(locale: UiLocale): TemplateResult {
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.admins.notFound')}</h2>
            <p><a href=${this.href([])}>${contentText(locale, 'adminContent.admins.backToList')}</a></p>
        </div>`;
    }

    #self(): string | null {
        return this.state?.user?.uid ?? null;
    }

    #admin(locale: UiLocale, view: AdminsViewState, admin: Admin): TemplateResult {
        const name = nameOf(locale, admin);
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${name}</h2>
            ${this.#issue(locale)}
            <dl class="facts">
                <dt>${contentText(locale, 'adminContent.admins.address')}</dt>
                <dd>${admin.email ?? shellText(locale, 'adminShell.admins.unnamed')}</dd>
                <dt>${contentText(locale, 'adminContent.admins.role')}</dt>
                <dd>${rowDetail(locale, { ...admin, self: false })}</dd>
                <dt>${contentText(locale, 'adminContent.admins.since')}</dt>
                <dd>${formatDay(locale, admin.createdAt)}</dd>
            </dl>
            ${this.#roleChange(locale, view, admin, name)} ${this.#removeAccess(locale, view, admin, name)}
        </div>`;
    }

    /** M5: the city's owners change an admin's role (asked first); editors see it only (S-A51-HAPPY-ROLE). */
    #roleChange(locale: UiLocale, view: AdminsViewState, admin: Admin, name: string): TemplateResult {
        if (!ownsCurrentCity(this.state)) {
            return EMPTY;
        }
        const city = currentCityName(this.state, locale);
        const change = (role: CityRole): void => {
            this.issue = null;
            this.pending = role === admin.role ? null : { request: { kind: 'role', uid: admin.uid, role }, name };
        };
        return roleField({
            ...{ locale, id: 'role', value: admin.role, change },
            label: shellText(locale, 'adminShell.admins.roleOf', { name, city }),
            disabled: view.busy || this.readOnly || admin.projectOwner,
        });
    }

    /**
     * Remove access, for the city's owners; oneself and the project's owner never, and the page says why (the project's
     * owner: the map always has an owner, `apiError.city.projectOwnerStays`; anyone else: not one's own access).
     */
    #removeAccess(locale: UiLocale, view: AdminsViewState, admin: Admin, name: string): TemplateResult {
        const note = removalNote(admin);
        if (note !== null) {
            return html`<p class="note">${contentText(locale, note)}</p>`;
        }
        if (!ownsCurrentCity(this.state)) {
            return EMPTY;
        }
        const ask = (): void => {
            this.issue = null;
            this.pending = { request: { kind: 'admin', uid: admin.uid }, name };
        };
        return html`<div class="actions">
            <hcm-button variant="outlined" icon="person_remove" ?disabled=${view.busy || this.readOnly} @click=${ask}
                >${contentText(locale, 'adminContent.admins.remove')}</hcm-button
            >
        </div>`;
    }

    #inviteDetail(locale: UiLocale, view: AdminsViewState, invite: Invite): TemplateResult {
        const created = formatDay(locale, invite.createdAt);
        const ask = (): void => {
            this.issue = null;
            this.pending = { request: { kind: 'invite', inviteId: invite.inviteId }, name: created };
        };
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${contentText(locale, 'adminContent.admins.inviteTitle', { date: created })}</h2>
            ${this.#issue(locale)}
            <dl class="facts">
                <dt>${contentText(locale, 'adminContent.admins.role')}</dt>
                <dd>${roleText(locale, invite.role)}</dd>
                <dt>${contentText(locale, 'adminContent.admins.expiresLabel')}</dt>
                <dd>${formatDay(locale, invite.expiresAt)}</dd>
                <dt>${contentText(locale, 'adminContent.admins.invitedBy')}</dt>
                <dd>${whoText(locale, invite.invitedBy, this.#self(), namesOf(view.list))}</dd>
            </dl>
            ${this.#link(locale, view.invited, invite)} ${this.#cancelInvite(locale, view, ask)}
        </div>`;
    }

    /** Cancel the invitation, for the city's owners. */
    #cancelInvite(locale: UiLocale, view: AdminsViewState, ask: () => void): TemplateResult {
        if (!ownsCurrentCity(this.state)) {
            return EMPTY;
        }
        return html`<div class="actions">
            <hcm-button variant="outlined" icon="cancel" ?disabled=${view.busy || this.readOnly} @click=${ask}
                >${contentText(locale, 'adminContent.admins.cancelInvite')}</hcm-button
            >
        </div>`;
    }

    /** The sign-in link of the invitation made in this visit, with Copy; for an older one, how to send it. */
    #link(locale: UiLocale, invited: InviteResponse | null, invite: Invite): TemplateResult {
        if (invited?.inviteId !== invite.inviteId) {
            return html`<p class="note">${contentText(locale, 'adminContent.admins.linkLater')}</p>`;
        }
        const copy = (): void => {
            void this.#copy(invited.signInUrl);
        };
        return html`<p>${shellText(locale, 'adminShell.admins.invited', { date: formatDay(locale, invited.expiresAt) })}</p>
            <div class="field">
                <label for="link">${shellText(locale, 'adminShell.admins.link')}</label>
                <input id="link" type="url" readonly .value=${invited.signInUrl} />
            </div>
            <div class="actions">
                <hcm-button variant="tonal" icon="content_copy" @click=${copy}>${shellText(locale, 'adminShell.admins.copy')}</hcm-button>
            </div>
            <p class="note status" role="status">${this.copied ? shellText(locale, 'adminShell.admins.copied') : ''}</p>`;
    }

    #issue(locale: UiLocale): TemplateResult {
        return this.issue === null
            ? EMPTY
            : html`<p class="alert" role="alert"><hcm-icon name="error"></hcm-icon><span>${noticeOf(locale, this.issue)}</span></p>`;
    }

    async #copy(url: string): Promise<void> {
        try {
            await navigator.clipboard.writeText(url);
            this.copied = true;
        } catch {
            this.renderRoot.querySelector<HTMLInputElement>('#link')?.select();
        }
    }

    async #sendInvite(email: string, role: CityRole): Promise<void> {
        const parsed = cityInviteRequestSchema.safeParse({ cityId: this.#cityId(), email: email.trim(), role });
        if (!parsed.success) {
            this.inviteIssue = { key: 'adminShell.admins.invalidEmail' };
            return;
        }
        this.#invited(await this.intents?.invite(parsed.data.email, role));
    }

    /** The open city (M5): the invitation is to it. */
    #cityId(): string {
        return this.state?.cityId ?? '';
    }

    /** The invitation made (its link copied at once) or refused (why, at the dialog); no store, nothing. */
    #invited(outcome: Awaited<ReturnType<AdminsIntentsPort['invite']>> | undefined): void {
        if (outcome === undefined) {
            return;
        }
        if (!outcome.ok) {
            this.inviteIssue = outcome.error;
            return;
        }
        this.inviting = false;
        this.copied = false;
        this.go(['invite', outcome.value.inviteId]);
        void this.#copyAtOnce(outcome.value.signInUrl);
    }

    /**
     * The new invitation's link goes to the clipboard at once, from the click that made it (one input less: the owner
     * pastes it into a message next). A browser that refuses leaves the link with its Copy button, as for any copy.
     */
    async #copyAtOnce(url: string): Promise<void> {
        this.copied = await navigator.clipboard.writeText(url).then(
            () => true,
            () => false,
        );
    }

    #closeInvite(): void {
        this.inviting = false;
        this.inviteIssue = null;
    }

    #confirm(locale: UiLocale): TemplateResult {
        const pending = this.pending;
        const question = questionOf(locale, pending, currentCityName(this.state, locale));
        const confirm = (): void => {
            this.pending = null;
            if (pending !== null) {
                void this.#confirmed(pending.request);
            }
        };
        const dismiss = (): void => {
            this.pending = null;
        };
        return html`<hcm-confirm-dialog
            ?destructive=${question.destructive}
            .open=${pending !== null}
            .headline=${question.headline}
            .body=${question.body}
            .confirmLabel=${question.confirm}
            .cancelLabel=${question.cancel}
            .closeLabel=${contentText(locale, 'adminContent.common.close')}
            @hcm-confirm=${confirm}
            @hcm-cancel=${dismiss}
        ></hcm-confirm-dialog>`;
    }

    /** A confirmed role change (the admin stays open) or removal (back to the list). */
    async #confirmed(request: Pending['request']): Promise<void> {
        await (request.kind === 'role' ? this.#changeRole(request.uid, request.role) : this.#remove(request));
    }

    async #changeRole(uid: string, role: CityRole): Promise<void> {
        const changed = await this.intents?.setRole(uid, role);
        this.issue = changed?.ok === false ? changed.error : null;
    }

    async #remove(request: RevokeInputPort): Promise<void> {
        const outcome = await this.intents?.revoke(request);
        if (outcome?.ok === false) {
            this.issue = outcome.error;
            return;
        }
        this.go([]);
    }
}

export function defineHcmAdminsPage(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMINS_PAGE_TAG) === undefined) {
        registry.define(HCM_ADMINS_PAGE_TAG, HcmAdminsPage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admins-page': HcmAdminsPage;
    }
}
