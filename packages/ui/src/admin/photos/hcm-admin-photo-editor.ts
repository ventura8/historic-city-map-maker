/**
 * `<hcm-admin-photo-editor>`: one photo's editor in the detail pane (`docs/research/M2c-interfaces.md` §6.3, §1.3, §5;
 * behaviours A09, A37, A38). Its top row is the photo's title (the heading that takes the focus), where the draft stands
 * (Saved, Unsaved changes, Saving…) and Save, disabled while the draft is clean or invalid (its description names the
 * first problem); History, Discard and Delete follow, buttons of one style (History fires `hcm-history`, the page opens
 * it). The conflict banner names who saved the other version and when, and the fields both changed by their names; then
 * the gone banner and the sections: image, texts, date, author and rights, links, place and direction, publishing. Every
 * change is a draft the page's map previews; Save writes it. With `readOnly` (a revoked admin, `DECISIONS-for-review.md`
 * §42d) nothing on it writes: Save and the actions are off, the fields read-only; History still opens.
 */
import type { UiLocale } from '@hcm/shared';
import { LitElement, html, nothing, type TemplateResult } from 'lit';

import { emit } from '../../components/internal.js';
import type { AssistViewPort } from '../assist/assist-port.js';
import { assistStyles } from '../assist/assist-parts.js';
import { conflictFields, NOBODY, savedByText, type WhoPort } from '../editing/conflict.js';
import { cannotSaveText } from '../editing/issue-text.js';

import { LeftFields } from '../editing/number-fields.js';
import { errorTemplate, loadingTemplate, reconnectingStatus } from '../editing/states.js';
import { EMPTY } from '../shell/empty.js';
import {
    creditsSection,
    datesSection,
    linksSection,
    publishingSection,
    sourceSection,
    textsSection,
    type SectionInput,
} from './editor-sections.js';
import { imageSection, placeSection } from './editor-place.js';
import { versionsSection } from './editor-versions.js';
import { PHOTO_ACCEPT, photoFiles } from './hcm-admin-photo-list.js';
import { historyHref, localized, photoText } from './photo-text.js';
import { photoStyles } from './photo-styles.js';
import type { PhotoEditorPort, PhotosIntentsPort, PhotoValuePort, PhotoVersionKindPort } from './photos-port.js';

export const HCM_ADMIN_PHOTO_EDITOR_TAG = 'hcm-admin-photo-editor';

/** Whether Save may run: changes, no problem, no conflict, not saving, the photo still there. */
export function canSave(editor: PhotoEditorPort): boolean {
    const clean = editor.dirty.length === 0 || editor.issues.length > 0;
    return !clean && editor.conflict === null && !editor.saving && editor.status === 'ready';
}

function saveState(locale: UiLocale, editor: PhotoEditorPort, readOnly: boolean): string {
    if (readOnly) {
        return photoText(locale, 'adminContent.common.readOnly');
    }
    if (editor.saving) {
        return photoText(locale, 'adminContent.photos.editor.saving');
    }
    return photoText(locale, editor.dirty.length === 0 ? 'adminContent.photos.editor.saved' : 'adminContent.photos.editor.unsaved');
}

/** Why Save is off, described by it (nothing while it is on). */
function saveWhy(why: string | null): TemplateResult | typeof nothing {
    return why === null ? nothing : html`<p class="note" id="save-why">${why}</p>`;
}

export class HcmAdminPhotoEditor extends LitElement {
    static override readonly properties = {
        editor: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        mapReady: { type: Boolean, attribute: 'map-ready' },
        readOnly: { type: Boolean, reflect: true, attribute: 'read-only' },
        who: { attribute: false },
        assist: { attribute: false },
    };

    static override readonly styles = [...photoStyles, ...assistStyles];

    declare editor: PhotoEditorPort | null;
    declare intents: PhotosIntentsPort | null;
    declare locale: UiLocale;
    declare mapReady: boolean;
    /** The admin's access was removed: nothing on the editor writes (§42d). */
    declare readOnly: boolean;
    /** Who reads the page and the admins' names: the conflict banner names who saved. */
    declare who: WhoPort;
    /** M4 (CR-M4-4): the title suggestions and translation drafts of the open photo (none: no assist slots). */
    declare assist: AssistViewPort | null;
    /** The list-detail layout asked for the focus before the heading was there (the photo still loading). */
    #wantsFocus = false;
    /** The number fields left since the photo opened (they say their problem from then on). */
    readonly #left = new LeftFields(() => {
        this.requestUpdate();
    });

    constructor() {
        super();
        this.editor = null;
        this.intents = null;
        this.locale = 'ro';
        this.mapReady = false;
        this.readOnly = false;
        this.who = NOBODY;
        this.assist = null;
    }

    /**
     * The layout's `[data-detail-heading]` is this element: its heading (inside the shadow root) takes the focus, now or
     * once the photo has loaded.
     */
    override focus(options?: FocusOptions): void {
        this.#wantsFocus = !this.#focusHeading(options);
    }

    protected override updated(): void {
        if (this.#wantsFocus) {
            this.#wantsFocus = !this.#focusHeading();
        }
    }

    #focusHeading(options?: FocusOptions): boolean {
        const heading = this.renderRoot.querySelector<HTMLElement>('[data-detail-heading]');
        heading?.focus(options);
        return heading !== null;
    }

    override render(): TemplateResult {
        const editor = this.editor;
        if (editor === null) {
            return EMPTY;
        }
        const locale = this.locale;
        if (editor.status === 'loading') {
            return loadingTemplate(locale);
        }
        if (editor.status === 'error') {
            return errorTemplate(locale, editor.failure, () => this.intents?.retryPhoto());
        }
        return editor.value === null ? this.#notFound(locale, editor) : this.#form(locale, editor, editor.value);
    }

    #notFound(locale: UiLocale, editor: PhotoEditorPort): TemplateResult {
        return html`<div class="pane">
            <h2 tabindex="-1" data-detail-heading>${photoText(locale, 'adminContent.photos.editor.notFound')}</h2>
            <p><a href=${historyHref(editor.id)}>${photoText(locale, 'adminContent.photos.editor.seeHistory')}</a></p>
        </div>`;
    }

    #form(locale: UiLocale, editor: PhotoEditorPort, value: PhotoValuePort): TemplateResult {
        const left = this.#left.forItem(editor.id);
        const input: SectionInput = {
            locale,
            value,
            issues: editor.issues,
            edit: (patch) => {
                this.intents?.edit(patch);
            },
            left,
            readOnly: this.readOnly,
            assist: this.assist === null || this.intents === null ? null : { view: this.assist, actions: this.intents },
        };
        const place = {
            ...{ locale, editor, value, issues: editor.issues, intents: this.intents },
            ...{ mapReady: this.mapReady, left, readOnly: this.readOnly },
        };
        return html`<div class="pane form">
            ${this.#head(locale, editor, value)} ${this.#banners(locale, editor)} ${reconnectingStatus(locale, editor.reconnecting)}
            ${imageSection(place, this.#choose)} ${versionsSection({ ...place, edit: input.edit }, this.#chooseVersion)}
            ${textsSection(input)} ${datesSection(input)} ${creditsSection(input)} ${sourceSection(input)} ${linksSection(input)}
            ${placeSection(place)} ${publishingSection(input, editor)}
            <input class="file-input" type="file" accept=${PHOTO_ACCEPT} hidden @change=${this.#chosen} />
            <input class="version-input" type="file" accept=${PHOTO_ACCEPT} hidden @change=${this.#chosenVersion} />
        </div>`;
    }

    #head(locale: UiLocale, editor: PhotoEditorPort, value: PhotoValuePort): TemplateResult {
        const why = editor.issues.length === 0 ? null : cannotSaveText(locale, editor.issues);
        const save = async (): Promise<void> => {
            await this.intents?.save();
        };
        return html`<div class="editor-head">
                <h2 tabindex="-1" data-detail-heading>
                    ${photoText(locale, 'adminContent.photos.editor.title', { title: localized(locale, value.title) })}
                </h2>
                <span class="note" role="status">${saveState(locale, editor, this.readOnly)}</span>
                <hcm-button
                    variant="filled"
                    icon="check"
                    ?disabled=${this.readOnly || !canSave(editor)}
                    aria-describedby=${why === null ? nothing : 'save-why'}
                    @click=${save}
                    >${photoText(locale, 'adminContent.photos.editor.save')}</hcm-button
                >
            </div>
            ${saveWhy(why)} ${this.#actions(locale, editor)}`;
    }

    /** History, Discard (once something changed) and Delete: text buttons of one style; only History while read only. */
    #actions(locale: UiLocale, editor: PhotoEditorPort): TemplateResult {
        const discard = html`<hcm-button variant="text" icon="undo" ?disabled=${this.readOnly} @click=${() => this.intents?.discard()}
            >${photoText(locale, 'adminContent.photos.editor.discard')}</hcm-button
        >`;
        return html`<div class="actions">
            <hcm-button
                variant="text"
                icon="history"
                class="history"
                @click=${() => {
                    emit(this, 'hcm-history');
                }}
                >${photoText(locale, 'adminContent.photos.editor.history')}</hcm-button
            >
            ${editor.touched ? discard : nothing}
            ${
                editor.role === 'moderator'
                    ? nothing
                    : html`<hcm-button variant="text" icon="delete" ?disabled=${this.readOnly} @click=${() => this.intents?.requestDelete()}
                          >${photoText(locale, 'adminContent.photos.editor.delete')}</hcm-button
                      >`
            }
        </div>`;
    }

    #banners(locale: UiLocale, editor: PhotoEditorPort): TemplateResult {
        if (editor.status === 'gone') {
            return html`<p class="alert" role="alert">${photoText(locale, 'adminContent.photos.editor.gone')}</p>`;
        }
        const conflict = editor.conflict;
        if (conflict === null) {
            return EMPTY;
        }
        return html`<div class="banner" role="alert">
            <p>${savedByText(locale, conflict, this.who)}</p>
            <p>${photoText(locale, 'adminContent.photos.editor.conflict', { fields: conflictFields(locale, conflict) })}</p>
            <div class="actions">
                <hcm-button variant="tonal" ?disabled=${this.readOnly} @click=${() => this.intents?.keepMine()}
                    >${photoText(locale, 'adminContent.photos.editor.keepMine')}</hcm-button
                >
                <hcm-button variant="text" ?disabled=${this.readOnly} @click=${() => this.intents?.takeTheirs()}
                    >${photoText(locale, 'adminContent.photos.editor.takeTheirs')}</hcm-button
                >
            </div>
        </div>`;
    }

    readonly #choose = (): void => {
        this.renderRoot.querySelector<HTMLInputElement>('.file-input')?.click();
    };

    /** The version the next chosen file is for (A140). */
    #version: PhotoVersionKindPort = 'improved';

    readonly #chooseVersion = (kind: PhotoVersionKindPort): void => {
        this.#version = kind;
        this.renderRoot.querySelector<HTMLInputElement>('.version-input')?.click();
    };

    readonly #chosenVersion = (event: Event): void => {
        const input = event.currentTarget as HTMLInputElement;
        const [file] = photoFiles(input.files);
        input.value = '';
        if (file !== undefined) {
            this.intents?.uploadVersion(this.#version, file);
        }
    };

    readonly #chosen = (event: Event): void => {
        const input = event.currentTarget as HTMLInputElement;
        const [file] = photoFiles(input.files);
        input.value = '';
        if (file !== undefined) {
            this.intents?.replaceImage(file);
        }
    };
}

/** Registers `<hcm-admin-photo-editor>` once; calling it again is a no-op. */
export function defineHcmAdminPhotoEditor(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_ADMIN_PHOTO_EDITOR_TAG) === undefined) {
        registry.define(HCM_ADMIN_PHOTO_EDITOR_TAG, HcmAdminPhotoEditor);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-admin-photo-editor': HcmAdminPhotoEditor;
    }
}
