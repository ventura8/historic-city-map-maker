/**
 * The photo editor's improved and colorized versions (the owner 2026-11-09; behaviour A140): for each, its thumbnail (or
 * "None yet"), Add a file or Replace the file (the upload's banner as Replace image's: `replaceStatus`), Remove (an edit
 * of `versions`, saved with the draft; only `photos.onUpload` adds one), and who made it (`versionCredits`), which the
 * public map shows under that version. Only a reviewer (an administrator or a moderator) has the section: the server
 * refuses an uploader's version (`apiError.photo.versionNotAllowed`).
 */
import type { UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { textField, textOf } from './editor-fields.js';
import { replaceStatus } from './editor-place.js';
import { fieldIssue, photoText } from './photo-text.js';
import type { PhotoEditorPort, PhotoPatchPort, PhotosIntentsPort, PhotoValuePort, PhotoVersionKindPort } from './photos-port.js';

export interface VersionsInput {
    readonly locale: UiLocale;
    readonly editor: PhotoEditorPort;
    readonly value: PhotoValuePort;
    readonly intents: PhotosIntentsPort | null;
    readonly edit: (patch: PhotoPatchPort) => void;
    readonly readOnly: boolean;
}

const VERSION_KINDS: readonly PhotoVersionKindPort[] = ['improved', 'colorized'];

/** `versions` without `kind` (absent when none is left). */
function withoutVersion(versions: NonNullable<PhotoValuePort['versions']>, kind: PhotoVersionKindPort): PhotoPatchPort {
    const rest = Object.fromEntries(Object.entries(versions).filter(([key]) => key !== kind));
    return { versions: Object.keys(rest).length === 0 ? undefined : rest };
}

function credit(input: VersionsInput, kind: PhotoVersionKindPort): TemplateResult {
    const { locale, value } = input;
    const changed = (typed: string): void => {
        const text = textOf(typed);
        const others = Object.fromEntries(Object.entries(value.versionCredits ?? {}).filter(([key]) => key !== kind));
        const credits = text === undefined ? others : { ...others, [kind]: text };
        input.edit({ versionCredits: Object.keys(credits).length === 0 ? undefined : credits });
    };
    const options = {
        id: `photo-version-${kind}-credit`,
        label: photoText(locale, 'adminContent.photos.version.credit'),
        value: value.versionCredits?.[kind] ?? '',
        error: fieldIssue(locale, input.editor.issues, `versionCredits.${kind}`),
        maxlength: 200,
        readOnly: input.readOnly,
    };
    return textField(options, changed);
}

/** Add a file (none yet) or Replace the file, and Remove (`remove`, null without a version). */
function buttons(input: VersionsInput, kind: PhotoVersionKindPort, remove: (() => void) | null, choose: () => void): TemplateResult {
    const { locale } = input;
    const busy = input.editor.versionUploads[kind]?.phase === 'uploading' || input.readOnly;
    const add = remove === null ? 'adminContent.photos.version.add' : 'adminContent.photos.version.replace';
    const removeButton = html`<hcm-button variant="text" icon="delete" ?disabled=${input.readOnly} @click=${remove}
        >${photoText(locale, 'adminContent.photos.version.remove')}</hcm-button
    >`;
    return html`<div class="actions">
        <hcm-button variant="tonal" icon="image" ?disabled=${busy} @click=${choose}>${photoText(locale, add)}</hcm-button>
        ${remove === null ? EMPTY : removeButton}
    </div>`;
}

/** The version's thumbnail, or "None yet". */
function shownImage(locale: UiLocale, label: string, thumb: string | undefined): TemplateResult {
    return thumb === undefined
        ? html`<p class="note">${photoText(locale, 'adminContent.photos.version.none')}</p>`
        : html`<img class="image" src=${thumb} alt=${label} />`;
}

/** The banner of the version's upload, while there is one to show. */
function uploadStatus(input: VersionsInput, kind: PhotoVersionKindPort): TemplateResult | typeof nothing {
    const upload = input.editor.versionUploads[kind];
    const actions = {
        cancel: () => {
            input.intents?.cancelVersion(kind);
        },
        dismiss: () => {
            input.intents?.dismissVersion(kind);
        },
    };
    return upload === null ? nothing : replaceStatus(input.locale, upload, actions);
}

function version(input: VersionsInput, kind: PhotoVersionKindPort, choose: (kind: PhotoVersionKindPort) => void): TemplateResult {
    const { locale } = input;
    const label = photoText(locale, `adminContent.photos.version.${kind}`);
    const versions = input.value.versions ?? {};
    const image = versions[kind]?.image;
    const remove = (): void => {
        input.edit(withoutVersion(versions, kind));
    };
    const shown = shownImage(locale, label, image?.thumb);
    return html`<section class="version" data-version=${kind}>
        <h3>${label}</h3>
        ${shown} ${uploadStatus(input, kind)}
        ${buttons(input, kind, image === undefined ? null : remove, () => {
            choose(kind);
        })}
        ${credit(input, kind)}
    </section>`;
}

/** The section, or nothing for an uploader. */
export function versionsSection(input: VersionsInput, choose: (kind: PhotoVersionKindPort) => void): TemplateResult {
    if (input.editor.role === 'uploader') {
        return EMPTY;
    }
    return html`<fieldset class="versions">
        <legend>${photoText(input.locale, 'adminContent.photos.section.versions')}</legend>
        <p class="note">${photoText(input.locale, 'adminContent.photos.version.hint')}</p>
        ${VERSION_KINDS.map((kind) => version(input, kind, choose))}
    </fieldset>`;
}
