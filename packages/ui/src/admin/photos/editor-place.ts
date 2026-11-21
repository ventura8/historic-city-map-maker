/**
 * The photo editor's image and place (`docs/research/M2c-interfaces.md` §6.3, §6.4, §4.6): the image (or why there is
 * none yet) with Replace image and its progress; the place as latitude and longitude (the keyboard's way to move the
 * pin), Confirm place for a photo left at the fallback pin, the EXIF suggestions not applied yet; the direction as a
 * number, Set direction (one click on the map), Point at map centre (the crosshair: no pointer needed) and the field of
 * view, whose cone the map redraws live.
 */
import { DEFAULT_FOV, MAX_FOV, MIN_FOV, type UiLocale, type ValidationIssue } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import type { FieldsLeft } from '../editing/number-fields.js';
import { EMPTY } from '../shell/empty.js';
import { numberField, numberOf } from './editor-fields.js';
import { fieldIssue, localized, messageText, photoHref, photoText } from './photo-text.js';
import type { PhotoEditorPort, PhotosIntentsPort, PhotoValuePort, ReplacePort, SuggestionPort } from './photos-port.js';

export interface PlaceInput {
    readonly locale: UiLocale;
    readonly editor: PhotoEditorPort;
    readonly value: PhotoValuePort;
    readonly issues: readonly ValidationIssue[];
    readonly intents: PhotosIntentsPort | null;
    /** The map can take a pick (Set direction, Point at map centre). */
    readonly mapReady: boolean;
    /** The number fields left since the photo opened: only they say their problem. */
    readonly left: FieldsLeft;
    /** A revoked admin's editor: nothing that writes is on (`DECISIONS-for-review.md` §42d). */
    readonly readOnly: boolean;
}

const REPLACE_KEYS = {
    uploading: 'adminContent.photos.replace.uploading',
    processing: 'adminContent.photos.replace.processing',
    replaced: 'adminContent.photos.replace.replaced',
    same: 'adminContent.photos.replace.same',
    refused: 'adminContent.photos.replace.refused',
    failed: 'adminContent.photos.replace.failed',
} as const;

/** What a replacement's banner does: stop the upload, or close its message. */
export interface ReplaceActions {
    readonly cancel: () => void;
    readonly dismiss: () => void;
}

/** Cancel while uploading, nothing while processing, Close once it is over. */
function replaceAction(locale: UiLocale, replace: ReplacePort, actions: ReplaceActions): TemplateResult {
    if (replace.phase === 'uploading') {
        return html`<hcm-button variant="text" icon="cancel" @click=${actions.cancel}
            >${photoText(locale, 'adminContent.photos.replace.cancel')}</hcm-button
        >`;
    }
    if (replace.phase === 'processing') {
        return EMPTY;
    }
    return html`<hcm-button variant="text" icon="close" @click=${actions.dismiss}
        >${photoText(locale, 'adminContent.photos.replace.dismiss')}</hcm-button
    >`;
}

function duplicateLink(locale: UiLocale, duplicateOf: string | null): TemplateResult {
    return duplicateOf === null
        ? EMPTY
        : html`<a href=${photoHref(duplicateOf)}>${photoText(locale, 'adminContent.photos.openDuplicate')}</a>`;
}

/** The banner of an image's or a version's upload (A37, A140): its phase, why it was refused, its progress. */
export function replaceStatus(locale: UiLocale, replace: ReplacePort, actions: ReplaceActions): TemplateResult {
    const text = photoText(locale, REPLACE_KEYS[replace.phase], { percent: String(replace.percent) });
    return html`<div class="banner" role="status">
        <p>${text}</p>
        ${replace.error === null ? nothing : html`<p>${messageText(locale, replace.error, replace.params)}</p>`}
        ${duplicateLink(locale, replace.duplicateOf)}
        ${replace.phase === 'uploading' ? html`<hcm-progress .value=${replace.percent / 100} .label=${text}></hcm-progress>` : nothing}
        <div class="actions">${replaceAction(locale, replace, actions)}</div>
    </div>`;
}

function imageBody(locale: UiLocale, editor: PhotoEditorPort, title: string): TemplateResult {
    if (editor.image !== null) {
        return html`<img class="image" src=${editor.image.web} alt=${photoText(locale, 'adminContent.photos.image.alt', { title })} />`;
    }
    if (editor.processingError !== null) {
        return html`<p class="alert" role="alert">${messageText(locale, editor.processingError)}</p>`;
    }
    const key = editor.processing === 'pending' ? 'adminContent.photos.image.processing' : 'adminContent.photos.image.none';
    return html`<p class="note">${photoText(locale, key)}</p>`;
}

export function imageSection(input: PlaceInput, chooseFile: () => void): TemplateResult {
    const { locale, editor, intents } = input;
    const title = localized(locale, input.value.title);
    const replacing = editor.replace?.phase === 'uploading';
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.image')}</legend>
        ${imageBody(locale, editor, title)}
        ${editor.duplicateOf === null ? nothing : html`<p>${duplicateLink(locale, editor.duplicateOf)}</p>`}
        ${
            editor.replace === null
                ? nothing
                : replaceStatus(locale, editor.replace, {
                      cancel: () => intents?.cancelReplace(),
                      dismiss: () => intents?.dismissReplace(),
                  })
        }
        <div class="actions">
            <hcm-button variant="tonal" icon="image" ?disabled=${replacing || input.readOnly} @click=${chooseFile}
                >${photoText(locale, 'adminContent.photos.editor.replace')}</hcm-button
            >
        </div>
    </fieldset>`;
}

const SUGGESTION_KEYS = {
    location: 'adminContent.photos.suggestion.location',
    year: 'adminContent.photos.suggestion.year',
    bearing: 'adminContent.photos.suggestion.bearing',
    title: 'adminContent.photos.suggestion.titleText',
} as const;

function suggestion(input: PlaceInput, item: SuggestionPort): TemplateResult {
    const { locale, intents } = input;
    return html`<li class="upload">
        <span>${photoText(locale, SUGGESTION_KEYS[item.field], { value: item.text })}</span>
        ${
            item.outside
                ? html`<span class="note">${photoText(locale, 'adminContent.photos.suggestion.outside')}</span>`
                : html`<span class="actions"
                      ><hcm-button
                          variant="text"
                          icon="check"
                          ?disabled=${input.readOnly}
                          @click=${() => intents?.applySuggestion(item.field)}
                          >${photoText(locale, 'adminContent.photos.suggestion.apply')}</hcm-button
                      ></span
                  >`
        }
    </li>`;
}

function suggestions(input: PlaceInput): TemplateResult {
    const { locale, editor } = input;
    if (editor.suggestions.length === 0) {
        return html``;
    }
    return html`<h3>${photoText(locale, 'adminContent.photos.suggestion.title')}</h3>
        <ul class="uploads">
            ${editor.suggestions.map((item) => suggestion(input, item))}
        </ul>`;
}

/** M13 §5: a photo with no place says so, and one click gives it a pin to drag. */
function noPlace(input: PlaceInput): TemplateResult {
    const { locale, intents } = input;
    return html`<p class="note">${photoText(locale, 'adminContent.photos.place.none')}</p>
        <div class="actions">
            <hcm-button variant="tonal" icon="place" ?disabled=${input.readOnly} @click=${() => intents?.placeAtCentre()}
                >${photoText(locale, 'adminContent.photos.place.set')}</hcm-button
            >
        </div>`;
}

function placeFields(input: PlaceInput): TemplateResult {
    const { locale, value, issues, intents, left } = input;
    const { location } = value;
    if (location === undefined) {
        return noPlace(input);
    }
    const error = fieldIssue(locale, issues, 'location');
    const set = (axis: 'lat' | 'lng', typed: string): void => {
        const number = numberOf(typed);
        intents?.edit({ location: { ...location, [axis]: number ?? Number.NaN } });
    };
    return html`<div class="pair">
        ${numberField(
            {
                id: 'photo-lat',
                label: photoText(locale, 'adminContent.photos.field.lat'),
                value: String(location.lat),
                error,
                min: -90,
                max: 90,
                step: 'any',
                readOnly: input.readOnly,
            },
            (typed) => {
                set('lat', typed);
            },
            left,
        )}
        ${numberField(
            {
                id: 'photo-lng',
                label: photoText(locale, 'adminContent.photos.field.lng'),
                value: String(location.lng),
                error,
                min: -180,
                max: 180,
                step: 'any',
                readOnly: input.readOnly,
            },
            (typed) => {
                set('lng', typed);
            },
            left,
        )}
    </div>`;
}

function direction(input: PlaceInput): TemplateResult {
    const { locale, editor, intents } = input;
    const mapReady = input.mapReady && !input.readOnly;
    if (editor.picking) {
        return html`<div class="banner" role="status">
            <p>${photoText(locale, 'adminContent.photos.direction.picking')}</p>
            <div class="actions">
                <hcm-button variant="text" icon="cancel" @click=${() => intents?.cancelDirection()}
                    >${photoText(locale, 'adminContent.photos.direction.cancel')}</hcm-button
                >
            </div>
        </div>`;
    }
    return html`<div class="actions">
        <hcm-button variant="tonal" icon="explore" ?disabled=${!mapReady} @click=${() => void intents?.setDirection()}
            >${photoText(locale, 'adminContent.photos.direction.set')}</hcm-button
        >
        <hcm-button variant="text" icon="center_focus_strong" ?disabled=${!mapReady} @click=${() => intents?.pointAtCentre()}
            >${photoText(locale, 'adminContent.photos.direction.centre')}</hcm-button
        >
    </div>`;
}

export function placeSection(input: PlaceInput): TemplateResult {
    const { locale, editor, value, intents } = input;
    const fov = value.fov ?? DEFAULT_FOV;
    const fovText = photoText(locale, 'adminContent.photos.field.fovValue', { value: String(fov) });
    return html`<fieldset>
        <legend>${photoText(locale, 'adminContent.photos.section.place')}</legend>
        ${placeFields(input)}
        ${
            editor.checkPlace
                ? html`<div class="banner">
                      <p>${photoText(locale, 'adminContent.photos.place.check')}</p>
                      <div class="actions">
                          <hcm-button
                              variant="tonal"
                              icon="place"
                              ?disabled=${input.readOnly}
                              @click=${() => intents?.confirmPlace(editor.id)}
                              >${photoText(locale, 'adminContent.photos.confirmPlace')}</hcm-button
                          >
                      </div>
                  </div>`
                : nothing
        }
        ${suggestions(input)} ${value.location === undefined ? nothing : aimFields(input, fov, fovText)}
    </fieldset>`;
}

function aimFields(input: PlaceInput, fov: number, fovText: string): TemplateResult {
    const { locale, value, issues, intents } = input;
    return html`${numberField(
            {
                id: 'photo-bearing',
                label: photoText(locale, 'adminContent.photos.field.bearing'),
                value: value.bearing === undefined ? '' : String(value.bearing),
                error: fieldIssue(locale, issues, 'bearing'),
                min: 0,
                max: 360,
                step: 'any',
                readOnly: input.readOnly,
            },
            (typed) => {
                intents?.edit({ bearing: numberOf(typed) });
            },
            input.left,
        )}
        ${direction(input)}
        <div class="field">
            <span>${photoText(locale, 'adminContent.photos.field.fov')}</span>
            <hcm-slider
                .min=${MIN_FOV}
                .max=${MAX_FOV}
                .step=${1}
                .value=${fov}
                .label=${photoText(locale, 'adminContent.photos.field.fov')}
                .valueText=${fovText}
                ?disabled=${input.readOnly}
                @hcm-input=${(event: CustomEvent<{ value: number }>) => {
                    intents?.edit({ fov: event.detail.value });
                }}
            ></hcm-slider>
            <span class="note" aria-hidden="true">${fovText}</span>
        </div>`;
}
