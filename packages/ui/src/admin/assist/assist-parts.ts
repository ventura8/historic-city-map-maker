/**
 * The assists' slots in the photo, place and layer editors (`docs/research/M4-interfaces.md` §4.1; CR-M4-4), as
 * templates the editors' chunks import (a leaf module: no element, no store). Under a title: **Suggest a title**, the
 * suggestions from OpenStreetMap as buttons that fill the title, with OpenStreetMap's attribution and its licence link,
 * or why there are none. Beside a Romanian and English pair: **English draft** while only Romanian has text (or
 * **Romanian draft** while only English has), so a draft never replaces what the admin typed; the model's note once a
 * draft fills the field, or why there is none. Every text is plain text; a status region exists before its text, so it is
 * announced.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, nothing, type TemplateResult } from 'lit';

import { visuallyHidden } from '../../components/styles.js';
import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import type { AssistActionsPort, AssistFieldPort, AssistViewPort, DraftPort, TitleSuggestionsPort } from './assist-port.js';

/** OpenStreetMap's copyright and licence page, which every suggestion's attribution links to (the ODbL). */
export const OSM_COPYRIGHT_URL = 'https://osm.org/copyright';

export interface TitleAssistInput {
    readonly locale: UiLocale;
    readonly view: AssistViewPort;
    readonly actions: AssistActionsPort;
    /** The ids of the slot's parts (`photo-title`). */
    readonly id: string;
    readonly readOnly: boolean;
}

function statusText(locale: UiLocale, titles: TitleSuggestionsPort): string {
    const asking = titles.status === 'asking' || titles.status === 'queued';
    if (asking) {
        return contentText(locale, 'adminContent.assist.waiting');
    }
    return titles.status === 'ready' && titles.suggestions.length === 0 ? contentText(locale, 'adminContent.assist.none') : '';
}

/** The id of the note that names the suggestions' group. */
function suggestionsId(input: TitleAssistInput): string {
    return `${input.id}-suggestions`;
}

function suggestionButtons(input: TitleAssistInput, titles: TitleSuggestionsPort): TemplateResult {
    if (titles.suggestions.length === 0) {
        return EMPTY;
    }
    const { locale, actions } = input;
    const labelledBy = suggestionsId(input);
    return html`<div class="chips" role="group" aria-labelledby=${labelledBy} data-assist-suggestions>
            ${titles.suggestions.map(
                (suggestion, index) =>
                    html`<hcm-button
                        variant="outlined"
                        ?disabled=${input.readOnly}
                        @click=${() => {
                            actions.useTitle(index);
                        }}
                        ><span class="visually-hidden">${contentText(locale, 'adminContent.assist.use', { title: suggestion.ro })}</span
                        ><span aria-hidden="true">${suggestion.ro}</span></hcm-button
                    >`,
            )}
        </div>
        <p class="note attribution" data-attribution>
            ${contentText(locale, 'adminContent.assist.attribution')}
            <a href=${OSM_COPYRIGHT_URL} target="_blank" rel="noopener noreferrer">osm.org/copyright</a>
        </p>`;
}

/** The title's slot: Suggest a title, the suggestions with their attribution, or why there are none. */
export function titleAssist(input: TitleAssistInput): TemplateResult {
    const { locale, view, actions } = input;
    const titles = view.titles;
    const busy = titles.status === 'asking' || titles.status === 'queued';
    const noteId = suggestionsId(input);
    return html`<div class="assist" data-assist="title" data-status=${titles.status}>
        <div class="actions">
            <hcm-button
                variant="text"
                icon="place"
                ?disabled=${busy || input.readOnly}
                @click=${() => {
                    actions.suggestTitle();
                }}
                >${contentText(locale, 'adminContent.assist.suggestTitle')}</hcm-button
            >
        </div>
        <p class="note" id=${noteId} ?hidden=${titles.suggestions.length === 0}>
            ${contentText(locale, 'adminContent.assist.suggestions')}
        </p>
        ${suggestionButtons(input, titles)}
        <p class="note status" role="status">${statusText(locale, titles)}</p>
        ${titles.error === null ? EMPTY : html`<p class="alert" role="alert"><hcm-icon name="info"></hcm-icon><span>${noticeOf(locale, titles.error)}</span></p>`}
    </div>`;
}

/** One side of a Romanian and English pair. */
type Side = 'ro' | 'en';

/** A Romanian and English pair as an editor holds it (either side may be absent). */
export interface PairTextPort {
    readonly ro?: string | undefined;
    readonly en?: string | undefined;
}

export interface DraftAssistInput {
    readonly locale: UiLocale;
    readonly view: AssistViewPort;
    readonly actions: AssistActionsPort;
    readonly field: AssistFieldPort;
    /** The pair as typed: which side has text decides the button. */
    readonly text: PairTextPort | undefined;
    readonly readOnly: boolean;
}

function filled(text: string | undefined): boolean {
    return text !== undefined && text.trim() !== '';
}

/** The empty language a draft would fill from the other one; none while both or neither have text. */
export function draftTarget(text: PairTextPort | undefined): Side | null {
    const ro = filled(text?.ro);
    if (ro === filled(text?.en)) {
        return null;
    }
    return ro ? 'en' : 'ro';
}

/** The side the last draft of `field` filled (its note stays once both sides have text), or null. */
function draftedSide(input: DraftAssistInput): Side | null {
    return (['en', 'ro'] as const).find((side) => input.view.drafts[draftSlotOf(input.field, side)] !== undefined) ?? null;
}

/** What a done draft says: the model that proposed it, and that it was shortened when it was. */
function doneNote(locale: UiLocale, draft: DraftPort): TemplateResult {
    const truncated = draft.truncated ? html` ${contentText(locale, 'adminContent.assist.truncated')}` : nothing;
    return html`<p class="note" data-draft-note>
        ${contentText(locale, 'adminContent.assist.draftNote', { model: draft.model ?? '' })}${truncated}
    </p>`;
}

function draftNote(locale: UiLocale, draft: DraftPort | undefined): TemplateResult {
    if (draft === undefined || draft.status === 'working') {
        return EMPTY;
    }
    return draft.status === 'failed'
        ? html`<p class="alert" role="alert"><hcm-icon name="info"></hcm-icon><span>${noticeOf(locale, draft.error)}</span></p>`
        : doneNote(locale, draft);
}

function draftLabel(locale: UiLocale, to: Side): string {
    return contentText(locale, to === 'en' ? 'adminContent.assist.draftToEn' : 'adminContent.assist.draftToRo');
}

/** The draft button for the empty language. */
function draftButton(input: DraftAssistInput, to: Side, working: boolean): TemplateResult {
    const { locale, actions, field } = input;
    return html`<div class="actions">
        <hcm-button
            variant="text"
            icon="translate"
            ?disabled=${working || input.readOnly}
            @click=${() => {
                actions.draftText(field, to);
            }}
            >${draftLabel(locale, to)}</hcm-button
        >
    </div>`;
}

/** The pair's slot: the draft button for the language that is empty, and what the last draft said (kept once it filled it). */
export function draftAssist(input: DraftAssistInput): TemplateResult {
    const to = draftTarget(input.text);
    const shown = to ?? draftedSide(input);
    return shown === null ? EMPTY : draftSlot(input, to, input.view.drafts[draftSlotOf(input.field, shown)]);
}

/** The slot itself: the button while a side is empty, the status while a draft is written, and what the last one said. */
function draftSlot(input: DraftAssistInput, to: Side | null, draft: DraftPort | undefined): TemplateResult {
    const { locale, field } = input;
    const working = draft?.status === 'working';
    return html`<div class="assist" data-assist=${draftSlotName(field)}>
        ${to === null ? EMPTY : draftButton(input, to, working)}
        <p class="note status" role="status">${working ? contentText(locale, 'adminContent.assist.drafting') : ''}</p>
        ${draftNote(locale, draft)}
    </div>`;
}

/** The key of a draft in the assists' state (`title.en`). */
function draftSlotOf(field: AssistFieldPort, to: Side): string {
    return `${field}.${to}`;
}

/** The slot's `data-assist` (`draft-title`). */
function draftSlotName(field: AssistFieldPort): string {
    return `draft-${field}`;
}

/** The slots' styles: a compact column under its field, the note and the attribution in the kit's small text. */
export const assistStyles = [
    visuallyHidden,
    css`
        .assist {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .assist .actions {
            gap: 8px;
        }

        /* The licence link is a touch target of its own: 48 px tall, as M3 asks on compact and medium windows. */
        .assist .attribution a {
            display: inline-flex;
            align-items: center;
            min-block-size: 48px;
        }
    `,
];
