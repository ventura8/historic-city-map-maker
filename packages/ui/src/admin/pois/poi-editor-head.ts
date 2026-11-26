/**
 * The top of the place editor (docs/research/M2c-interfaces.md §1.3, §5.1; the UX review of 2026-10-18,
 * `DECISIONS-for-review.md` §42c–§42e): the heading, the save state, Discard and Save at the trailing end, then Delete and
 * the overflow menu (History and "Redraw as…", the actions an admin needs least often) as buttons of one style; the
 * conflict banner, which names who saved the other version and when and the fields both changed by their names; the gone
 * banner. A revoked admin's editor is read-only: every action that writes is off, History still opens.
 */
import type { UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { emit } from '../../components/internal.js';
import { conflictFields, savedByText, type WhoPort } from '../editing/conflict.js';
import type { OverflowAction } from '../editing/hcm-overflow-menu.js';
import { cannotSaveText } from '../editing/issue-text.js';
import { EMPTY } from '../shell/empty.js';
import { localized, poiText, SHAPE_KEYS } from './poi-text.js';
import type { PoiDraftPort, PoiShapePort, PoisIntentsPort } from './pois-port.js';

/** What the top of the editor shows and where its events go. */
export interface HeadInput {
    readonly host: HTMLElement;
    readonly locale: UiLocale;
    readonly draft: PoiDraftPort;
    readonly shape: PoiShapePort;
    readonly intents: PoisIntentsPort | null;
    readonly readOnly: boolean;
    readonly who: WhoPort;
}

const SHAPES: readonly PoiShapePort[] = ['point', 'linestring', 'polygon'];

const SHAPE_ICONS: Readonly<Record<PoiShapePort, string>> = { point: 'place', linestring: 'polyline', polygon: 'pentagon' };

/** The save state's words: read only, saving, new, unsaved or saved. */
function stateKey(draft: PoiDraftPort, readOnly: boolean): Parameters<typeof poiText>[1] {
    if (readOnly) {
        return 'adminContent.common.readOnly';
    }
    if (draft.saving) {
        return 'adminContent.pois.state.saving';
    }
    if (draft.isNew) {
        return 'adminContent.pois.state.new';
    }
    return draft.dirty.length > 0 ? 'adminContent.pois.state.unsaved' : 'adminContent.pois.state.saved';
}

/** Nothing may be written: read only, a Save running, or the place deleted elsewhere. */
function cannotWrite(draft: PoiDraftPort, readOnly: boolean): boolean {
    return readOnly || draft.saving || draft.gone;
}

/** Save is off while nothing may be written, with a problem, or with nothing to save. */
function saveBlocked(draft: PoiDraftPort, readOnly: boolean): boolean {
    const nothingToSave = !draft.isNew && draft.dirty.length === 0;
    return cannotWrite(draft, readOnly) || draft.issues.length > 0 || nothingToSave;
}

function titleOf(locale: UiLocale, draft: PoiDraftPort): string {
    const title = localized(locale, draft.value.title).trim();
    if (title !== '') {
        return title;
    }
    return poiText(locale, draft.isNew ? 'adminContent.pois.newPlace' : 'adminContent.pois.untitled');
}

/** Save's note: every field it waits for, by what to do ("Cannot save: add a title in Romanian; choose a category."). */
function issueLine(locale: UiLocale, issues: PoiDraftPort['issues']): TemplateResult {
    return issues.length === 0 ? EMPTY : html`<p class="note" id="save-issue">${cannotSaveText(locale, issues)}</p>`;
}

/** The overflow menu's actions: History (a saved place), then Redraw as each other shape. */
function overflowActions(input: HeadInput): OverflowAction[] {
    const { locale, draft } = input;
    const history: OverflowAction[] = draft.isNew
        ? []
        : [{ id: 'history', label: poiText(locale, 'adminContent.pois.history'), icon: 'history' }];
    const redraw = SHAPES.filter((shape) => shape !== input.shape).map((shape) => ({
        id: `redraw-${shape}`,
        label: poiText(locale, 'adminContent.pois.redraw', { shape: poiText(locale, SHAPE_KEYS[shape]).toLocaleLowerCase(locale) }),
        icon: SHAPE_ICONS[shape],
        disabled: input.readOnly,
    }));
    return [...history, ...redraw];
}

function chosen(host: HTMLElement, id: string): void {
    if (id === 'history') {
        emit(host, 'hcm-history');
        return;
    }
    emit(host, 'hcm-redraw', { shape: id.replace('redraw-', '') as PoiShapePort });
}

function deleteButton(input: HeadInput): TemplateResult {
    const { draft, locale } = input;
    if (draft.isNew || draft.gone) {
        return EMPTY;
    }
    return html`<hcm-button
        variant="text"
        icon="delete"
        class="delete"
        ?disabled=${input.readOnly}
        @click=${() => {
            emit(input.host, 'hcm-delete');
        }}
        >${poiText(locale, 'adminContent.pois.delete')}</hcm-button
    >`;
}

function actions(input: HeadInput): TemplateResult {
    const { locale } = input;
    return html`<div class="actions" role="group" aria-label=${poiText(locale, 'adminContent.pois.actions')}>
        ${deleteButton(input)}
        <hcm-overflow-menu
            class="more"
            .label=${poiText(locale, 'adminContent.pois.actions')}
            .closeLabel=${poiText(locale, 'adminContent.common.close')}
            .actions=${overflowActions(input)}
            @hcm-action=${(event: CustomEvent<{ readonly id: string }>) => {
                chosen(input.host, event.detail.id);
            }}
        ></hcm-overflow-menu>
    </div>`;
}

/** The title, the save state, then Discard and Save at the trailing end; then Delete and the overflow menu. */
export function editorHead(input: HeadInput): TemplateResult {
    const { locale, draft, readOnly } = input;
    const issue = draft.issues.length === 0 ? undefined : 'save-issue';
    return html`<div class="editor-head">
            <h2 data-detail-heading tabindex="-1">${titleOf(locale, draft)}</h2>
            <p class="state note" role="status">${poiText(locale, stateKey(draft, readOnly))}</p>
            <hcm-button
                class="discard"
                variant="text"
                ?disabled=${readOnly || draft.dirty.length === 0 || draft.saving}
                @click=${() => input.intents?.discard()}
                >${poiText(locale, 'adminContent.common.discard')}</hcm-button
            >
            <hcm-button
                class="save"
                variant="filled"
                ?disabled=${saveBlocked(draft, readOnly)}
                aria-describedby=${issue ?? nothing}
                @click=${() => void input.intents?.save()}
                >${poiText(locale, 'adminContent.common.save')}</hcm-button
            >
        </div>
        ${issueLine(locale, draft.issues)} ${actions(input)}`;
}

function conflictBanner(input: HeadInput): TemplateResult {
    const { locale, draft } = input;
    const conflict = draft.conflict;
    if (conflict === null) {
        return EMPTY;
    }
    const fields = poiText(locale, 'adminContent.pois.conflictFields', { fields: conflictFields(locale, conflict) });
    // The text above its two actions, not beside them: beside, a phone squeezed Keep mine under Take theirs.
    return html`<div class="alert" role="alert">
        <div class="alert-body">
            <p>${poiText(locale, 'adminContent.pois.conflict')} ${savedByText(locale, conflict, input.who)} ${fields}</p>
            <div class="actions">
                <hcm-button variant="tonal" class="keep-mine" ?disabled=${input.readOnly} @click=${() => input.intents?.keepMine()}
                    >${poiText(locale, 'adminContent.pois.keepMine')}</hcm-button
                >
                <hcm-button variant="text" class="take-theirs" ?disabled=${input.readOnly} @click=${() => input.intents?.takeTheirs()}
                    >${poiText(locale, 'adminContent.pois.takeTheirs')}</hcm-button
                >
            </div>
        </div>
    </div>`;
}

/** The conflict banner (who and when, the fields by name) and the gone banner. */
export function editorBanners(input: HeadInput): TemplateResult {
    const gone = input.draft.gone ? html`<p class="alert" role="alert">${poiText(input.locale, 'adminContent.pois.gone')}</p>` : EMPTY;
    return html`${conflictBanner(input)} ${gone}`;
}
