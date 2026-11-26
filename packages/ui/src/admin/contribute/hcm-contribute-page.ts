/**
 * `<hcm-contribute-page>`: `#/contribute/<city>` and `#/contribute/<city>/<photoId>` (M13, `docs/research/M13-roles.md` §§3, 4;
 * behaviours A92, A93): asking for a role and being told the answer, or suggesting where a photo was taken and which way the
 * camera faced, with the photo editor's map, and contesting a placed photo's date, place or direction. Text only: nothing a
 * person types is ever rendered as HTML.
 */
import {
    REQUESTABLE_ROLES,
    type ContributeContextResponse,
    type ContributePhoto,
    type UiLocale,
    type RequestableRole,
    type SuggestionProposal,
} from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import type { AdminRouteIdPort } from '../admin-port.js';
import type { AreaPort, ContentPort } from '../content-port.js';
import { defineUiKit } from '../../components/define.js';
import { AreaPage } from '../editing/area-page.js';
import { defineEditingElements } from '../editing/define.js';
import { editingStyles } from '../editing/editing-styles.js';
import { defineHcmAdminMap } from '../map/hcm-admin-map.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { ContributeIntentsPort, ContributeViewState } from './contribute-port.js';
import { bearingField, coordinateField, dateFields } from './proposal-fields.js';

export const HCM_CONTRIBUTE_PAGE_TAG = 'hcm-contribute-page';

const styles = css`
    .pane {
        max-inline-size: 720px;
    }

    form {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    hcm-admin-map {
        display: block;
        block-size: 320px;
    }

    /* M3's 48 px touch target on a compact window. */
    a {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    img {
        max-inline-size: 240px;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
    }

    textarea {
        min-block-size: 96px;
    }
`;

/** The value of a form's field. */
function fieldOf(form: HTMLFormElement, name: string): string {
    const value = new FormData(form).get(name);
    return typeof value === 'string' ? value : '';
}

function textField(
    id: string,
    label: string,
    options: { readonly required?: boolean; readonly type?: string; readonly value?: string; readonly long?: boolean } = {},
): TemplateResult {
    const input =
        options.long === true
            ? html`<textarea id=${id} name=${id} ?required=${options.required === true} maxlength="1000"></textarea>`
            : html`<input
                  id=${id}
                  name=${id}
                  type=${options.type ?? 'text'}
                  .value=${options.value ?? ''}
                  ?required=${options.required === true}
              />`;
    return html`<div class="field"><label for=${id}>${label}</label>${input}</div>`;
}

/** The kit's button lives in its own shadow root, so it asks its form to submit: the browser checks the required fields first. */
function submitButton(label: string, busy: boolean): TemplateResult {
    const send = (event: Event): void => {
        (event.currentTarget as HTMLElement).closest('form')?.requestSubmit();
    };
    return html`<hcm-button variant="filled" icon="send" ?disabled=${busy} @click=${send}>${label}</hcm-button>`;
}

const PLACE_TEXTS = { title: 'adminContent.contribute.place.title', intro: 'adminContent.contribute.place.intro' } as const;
const CORRECTION_TEXTS = { title: 'adminContent.contribute.correct.title', intro: 'adminContent.contribute.correct.intro' } as const;

/** What this account may still ask for: an uploader may ask for more, and whoever reviews has nothing to ask. */
function askableRoles(context: ContributeContextResponse): readonly RequestableRole[] {
    if (context.role === null) {
        return REQUESTABLE_ROLES;
    }
    return context.role === 'uploader' ? ['moderator'] : [];
}

function roleOption(locale: UiLocale, role: RequestableRole): TemplateResult {
    const key = `adminContent.contribute.role.${role}` as const;
    return html`<option value=${role}>${contentText(locale, key)}</option>`;
}

class HcmContributePage extends AreaPage<ContributeViewState, ContributeIntentsPort> {
    static override readonly fillsPage: boolean = false;

    static override readonly styles = [...editingStyles, styles];

    protected readonly route: AdminRouteIdPort = 'contribute';

    protected storeOf(content: ContentPort): AreaPort<ContributeViewState, ContributeIntentsPort> | null {
        return content.contribute;
    }

    override render(): TemplateResult {
        const view = this.view;
        if (view === null) {
            return EMPTY;
        }
        return html`<div class="pane">${this.#body(this.locale, view)}</div>`;
    }

    #body(locale: UiLocale, view: ContributeViewState): TemplateResult {
        if (view.status === 'loading') {
            return html`<p role="status">${contentText(locale, 'adminContent.contribute.loading')}</p>`;
        }
        if (view.context === null) {
            return this.#failed(locale, view);
        }
        return view.context.photo === null ? this.#ask(locale, view, view.context) : this.#suggest(locale, view, view.context.photo);
    }

    #failed(locale: UiLocale, view: ContributeViewState): TemplateResult {
        const retry = (): void => {
            this.intents?.retry();
        };
        return html`<p class="alert" role="alert">
                ${view.failure === null ? contentText(locale, 'adminContent.contribute.loadFailed') : noticeOf(locale, view.failure)}
            </p>
            <div class="actions">
                <hcm-button variant="tonal" icon="refresh" @click=${retry}>${contentText(locale, 'adminContent.common.retry')}</hcm-button>
            </div>`;
    }

    /** The account's standing, or the form when it may ask. */
    #ask(locale: UiLocale, view: ContributeViewState, context: ContributeContextResponse): TemplateResult {
        const name = locale === 'en' ? (context.city.name.en ?? context.city.name.ro) : context.city.name.ro;
        return html`<h2>${contentText(locale, 'adminContent.contribute.title', { city: name })}</h2>
            <p>${contentText(locale, 'adminContent.contribute.intro')}</p>
            ${this.#standing(locale, view, context)}`;
    }

    /** What the account stands as, and the form when it may ask: a request answered earlier decides nothing once the role is gone. */
    #standing(locale: UiLocale, view: ContributeViewState, context: ContributeContextResponse): TemplateResult {
        const roles = askableRoles(context);
        if (context.blocked) {
            return html`<p class="alert" role="alert">${contentText(locale, 'adminContent.contribute.blocked')}</p>`;
        }
        if (roles.length === 0) {
            return this.#member(locale);
        }
        return this.#request(locale, view, context, roles);
    }

    #request(
        locale: UiLocale,
        view: ContributeViewState,
        context: ContributeContextResponse,
        roles: readonly RequestableRole[],
    ): TemplateResult {
        const form = this.#requestForm(locale, view, roles);
        const asked = context.request;
        if (asked === null || asked.status === 'approved') {
            return context.role === null ? form : this.#askMore(locale, form);
        }
        return asked.status === 'pending'
            ? html`<p role="status">${contentText(locale, 'adminContent.contribute.pending')}</p>`
            : this.#refused(locale, asked, form);
    }

    /** An uploader: a member who may ask for more; M28: the satellite sources stay with the owner and the editors, and why. */
    #askMore(locale: UiLocale, form: TemplateResult): TemplateResult {
        return html`${this.#member(locale)}
            <p class="note" data-satellite-note>
                ${contentText(locale, 'adminContent.contribute.satelliteNote')}
                ${contentText(locale, 'adminContent.contribute.satelliteNote2')}
            </p>
            <p>${contentText(locale, 'adminContent.contribute.askMore')}</p>
            ${form}`;
    }

    #member(locale: UiLocale): TemplateResult {
        return html`<p role="status">${contentText(locale, 'adminContent.contribute.member')}</p>
            <p><a href="#/photos">${contentText(locale, 'adminContent.contribute.openAdmin')}</a></p>`;
    }

    #refused(locale: UiLocale, request: NonNullable<ContributeContextResponse['request']>, form: TemplateResult): TemplateResult {
        return html`<p class="alert" role="alert">${contentText(locale, 'adminContent.contribute.refused')}</p>
            ${request.note === undefined ? nothing : html`<p>${contentText(locale, 'adminContent.contribute.refusedNote', { note: request.note })}</p>`}
            ${this.#askAgain(locale, request, form)}`;
    }

    /** The date a refused account may ask again, or the form once it has passed. */
    #askAgain(locale: UiLocale, request: NonNullable<ContributeContextResponse['request']>, form: TemplateResult): TemplateResult {
        const retryAt = request.retryAt ?? '';
        if (Date.parse(retryAt) > Date.now()) {
            return html`<p>${contentText(locale, 'adminContent.contribute.retry', { date: retryAt.slice(0, 10) })}</p>`;
        }
        return form;
    }

    #requestForm(locale: UiLocale, view: ContributeViewState, roles: readonly RequestableRole[]): TemplateResult {
        const submit = (event: SubmitEvent): void => {
            event.preventDefault();
            const form = event.currentTarget as HTMLFormElement;
            void this.intents?.request(fieldOf(form, 'role') as RequestableRole, fieldOf(form, 'reason'), fieldOf(form, 'credit'));
        };
        return html`<form @submit=${submit}>
            <div class="field">
                <label for="role">${contentText(locale, 'adminContent.contribute.role')}</label>
                <select id="role" name="role">
                    ${roles.map((role) => roleOption(locale, role))}
                </select>
            </div>
            ${textField('reason', contentText(locale, 'adminContent.contribute.reason'), { required: true, long: true })}
            ${textField('credit', contentText(locale, 'adminContent.contribute.credit'))} ${this.#problem(locale, view)}
            <div class="actions">${submitButton(contentText(locale, 'adminContent.contribute.send'), view.busy)}</div>
        </form>`;
    }

    #problem(locale: UiLocale, view: ContributeViewState): TemplateResult {
        return view.problem === null ? EMPTY : html`<p class="alert" role="alert">${noticeOf(locale, view.problem)}</p>`;
    }

    #suggest(locale: UiLocale, view: ContributeViewState, photo: ContributePhoto): TemplateResult {
        const placed = photo.location !== undefined;
        const title = locale === 'en' ? (photo.title.en ?? photo.title.ro) : photo.title.ro;
        const texts = placed ? CORRECTION_TEXTS : PLACE_TEXTS;
        return html`<h2>${contentText(locale, texts.title)}</h2>
            <p>${contentText(locale, texts.intro)}</p>
            <h3>${title}</h3>
            <img src=${photo.thumb} alt=${title} />
            ${this.#mapBox(locale, view)}
            <form @submit=${this.#sendSuggestion}>
                ${this.#placeFields(locale, view)} ${placed ? dateFields(locale, view.proposal, this.#edit) : EMPTY}
                ${textField('why', contentText(locale, 'adminContent.contribute.why'), { required: placed, long: true })}
                ${textField('source', contentText(locale, 'adminContent.contribute.sourceUrl'), { type: 'url' })}
                ${textField('credit', contentText(locale, 'adminContent.contribute.credit'))} ${this.#problem(locale, view)}
                ${this.#thanks(locale, view)}
                <div class="actions">${submitButton(contentText(locale, 'adminContent.contribute.suggest'), view.busy)}</div>
            </form>`;
    }

    readonly #sendSuggestion = (event: SubmitEvent): void => {
        event.preventDefault();
        const form = event.currentTarget as HTMLFormElement;
        void this.intents?.suggest({ reason: fieldOf(form, 'why'), sourceUrl: fieldOf(form, 'source'), credit: fieldOf(form, 'credit') });
    };

    #thanks(locale: UiLocale, view: ContributeViewState): TemplateResult {
        const remaining = view.thanks?.remaining;
        return remaining === undefined
            ? EMPTY
            : html`<p role="status">${contentText(locale, 'adminContent.contribute.thanks', { remaining: String(remaining) })}</p>`;
    }

    #mapBox(locale: UiLocale, view: ContributeViewState): TemplateResult {
        return html`<hcm-admin-map
            .status=${view.map}
            .locale=${locale}
            @hcm-map-host=${(event: CustomEvent<{ readonly container: HTMLElement }>) => this.intents?.attachMap(event.detail.container)}
            @hcm-zoom=${(event: CustomEvent<{ readonly delta: number }>) => this.intents?.zoomBy(event.detail.delta)}
        ></hcm-admin-map>`;
    }

    #placeFields(locale: UiLocale, view: ContributeViewState): TemplateResult {
        const { location, bearing } = view.proposal;
        return html`<div class="actions">
                <hcm-button variant="tonal" icon="place" @click=${() => this.intents?.placeAtCentre()}
                    >${contentText(locale, 'adminContent.contribute.pin')}</hcm-button
                >
                <hcm-button
                    variant="text"
                    icon="explore"
                    ?disabled=${location === undefined}
                    @click=${() => void this.intents?.pickDirection()}
                    >${contentText(locale, 'adminContent.contribute.direction')}</hcm-button
                >
            </div>
            ${view.picking ? html`<p role="status">${contentText(locale, 'adminContent.contribute.picking')}</p>` : nothing}
            ${coordinateField(locale, 'lat', location, this.#edit)} ${coordinateField(locale, 'lng', location, this.#edit)}
            ${bearingField(locale, bearing, this.#edit)}`;
    }

    readonly #edit = (patch: SuggestionProposal): void => {
        this.intents?.edit(patch);
    };
}

/** Registers `<hcm-contribute-page>` and what it renders; idempotent per registry. */
export function defineHcmContributePage(registry: CustomElementRegistry = customElements): void {
    defineUiKit(registry);
    defineEditingElements(registry);
    defineHcmAdminMap(registry);
    if (registry.get(HCM_CONTRIBUTE_PAGE_TAG) === undefined) {
        registry.define(HCM_CONTRIBUTE_PAGE_TAG, HcmContributePage);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-contribute-page': HcmContributePage;
    }
}
