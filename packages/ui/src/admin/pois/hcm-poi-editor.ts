/**
 * `<hcm-poi-editor>`: one place's editor (docs/research/M2c-interfaces.md §1.3, §5, §7.2; behaviours A32, A38): its
 * heading (which takes the focus when it opens), the save state, Save (off while nothing changed or something is wrong:
 * its description names the first problem), Discard, Delete and the overflow menu (History, Redraw as…), the conflict and
 * gone banners (`poi-editor-head.ts`); the shape (the drawing tools, what the map refused, the vertex list); the texts,
 * years, links, photos and Published. With `readOnly` (a revoked admin, `DECISIONS-for-review.md` §42d) nothing on it
 * writes: Save and the actions are off, the fields read-only. Fires `hcm-delete`, `hcm-redraw` with `{shape}`,
 * `hcm-history` and `hcm-pick-photos`; everything else goes to the area's intents.
 */
import type { CityRole, AdminContentKey, LngLat, UiLocale } from '@hcm/shared';
import { LitElement, html, type TemplateResult } from 'lit';

import { defineOnce, emit } from '../../components/internal.js';
import type { AssistViewPort } from '../assist/assist-port.js';
import { assistStyles, draftAssist, titleAssist } from '../assist/assist-parts.js';
import { NOBODY, type WhoPort } from '../editing/conflict.js';
import { LeftFields } from '../editing/number-fields.js';
import type { DrawToolPort } from '../map/hcm-draw-toolbar.js';
import { EMPTY } from '../shell/empty.js';
import {
    categoryField,
    descriptionFields,
    linkFields,
    photoFields,
    publishedField,
    titleFields,
    yearFields,
    type CategoryChoice,
    type FieldContext,
} from './poi-fields.js';
import { editorBanners, editorHead, type HeadInput } from './poi-editor-head.js';
import { poiText, refusalText } from './poi-text.js';
import { poiStyles } from './poi-styles.js';
import type {
    CategoryItemPort,
    PhotoChoicePort,
    PlaceEditorPort,
    PoiDraftPort,
    PoiShapePort,
    PoisIntentsPort,
    PoiValuePort,
    TraceLayerPort,
    VertexEditPort,
} from './pois-port.js';
import { traceFields, type TraceChoice } from './trace-field.js';

export const HCM_POI_EDITOR_TAG = 'hcm-poi-editor';

/** Positions a shape needs at least (the vertex list keeps them). */
const MINIMUM: Readonly<Record<PoiShapePort, number>> = { point: 1, linestring: 2, polygon: 3 };

export class HcmPoiEditor extends LitElement {
    static override readonly properties = {
        editor: { attribute: false },
        categories: { attribute: false },
        categoriesKnown: { attribute: false },
        adding: { state: true },
        photos: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        centreKnown: { attribute: false },
        readOnly: { type: Boolean, reflect: true, attribute: 'read-only' },
        role: { attribute: false },
        who: { attribute: false },
        mode: { state: true },
        assist: { attribute: false },
        traceLayers: { attribute: false },
        traceOpacity: { attribute: false },
    };

    static override readonly styles = [...poiStyles, ...assistStyles];

    /** M13: the admin's role in the city: an uploader's place is published by its review. */
    declare role: CityRole | null;
    declare editor: PlaceEditorPort | null;
    declare categories: readonly CategoryItemPort[];
    /** The city's categories were listed: without any, the category field offers the starter categories. */
    declare categoriesKnown: boolean;
    /** The starter categories are being written. */
    declare adding: boolean;
    declare photos: readonly PhotoChoicePort[];
    declare intents: PoisIntentsPort | null;
    /** Whether Add at centre has a centre to add (the city is read): the button waits until then. */
    declare centreKnown: boolean;
    declare locale: UiLocale;
    /** The admin's access was removed: nothing on the editor writes (§42d). */
    declare readOnly: boolean;
    /** Who reads the page and the admins' names: the conflict banner names who saved. */
    declare who: WhoPort;
    /** The drawing tool the admin picked last; a place opens drawing when it has no shape yet, else selecting. */
    declare mode: 'draw' | 'select';
    /** M4 (CR-M4-4): the title suggestions and translation drafts of the open place (none: no assist slots). */
    declare assist: AssistViewPort | null;
    /** M27: the city's old maps a street can be traced on, and the chosen one's opacity in percent. */
    declare traceLayers: readonly TraceLayerPort[];
    declare traceOpacity: number;
    /** The years left since the place opened (they say their problem from then on). */
    readonly #left = new LeftFields(() => {
        this.requestUpdate();
    });
    /** The place the tools were last set for, and whether it had a shape then. */
    #shown: ShownPlace | null = null;

    constructor() {
        super();
        this.role = null;
        this.editor = null;
        this.categories = [];
        this.categoriesKnown = false;
        this.adding = false;
        this.photos = [];
        this.intents = null;
        this.centreKnown = true;
        this.locale = 'en';
        this.readOnly = false;
        this.who = NOBODY;
        this.mode = 'select';
        this.assist = null;
        this.traceLayers = [];
        this.traceOpacity = 100;
    }

    /**
     * The tools follow the map's drawing session (`packages/admin/src/pois/map-session.ts`): a place without a shape opens
     * with Draw pressed, as the map draws its first clicks; one with a shape with Select. A point is finished by its click,
     * after which the map selects it: Select is pressed then too.
     */
    protected override willUpdate(): void {
        const shown = shownOf(this.editor);
        const mode = toolsFor(this.#shown, shown, this.editor?.shape);
        this.#shown = shown;
        if (mode !== null) {
            this.mode = mode;
        }
    }

    override render(): TemplateResult {
        const editor = this.editor;
        const draft = editor?.draft ?? null;
        if (editor === null || draft === null) {
            return EMPTY;
        }
        const head = this.#headInput(editor, draft);
        return html`<div class="pane form">
            ${editorHead(head)} ${editorBanners(head)} ${this.#shape(editor, draft)}
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.trace')}</legend>
                ${traceFields(this.#context(draft), this.#traceChoice())}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.texts')}</legend>
                ${categoryField(this.#context(draft), this.#categoryChoice())} ${titleFields(this.#context(draft))}
                ${this.#assists(draft.value, 'title')} ${descriptionFields(this.#context(draft))}
                ${this.#assists(draft.value, 'description')}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.years')}</legend>
                ${yearFields(this.#context(draft))}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.links')}</legend>
                ${linkFields(this.#context(draft))}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.photos')}</legend>
                ${photoFields(this.#context(draft), this.photos, () => {
                    emit(this, 'hcm-pick-photos');
                })}
            </fieldset>
            <fieldset>
                <legend>${poiText(this.locale, 'adminContent.pois.section.publishing')}</legend>
                ${publishedField(this.#context(draft))}
            </fieldset>
        </div>`;
    }

    /** M4 (CR-M4-4): the title's suggestions and its draft button, or the description's draft button. */
    #assists(value: PoiValuePort, field: 'title' | 'description'): TemplateResult {
        const view = this.assist;
        const actions = this.intents;
        if (view === null || actions === null) {
            return EMPTY;
        }
        const draft = draftAssist({ locale: this.locale, view, actions, field, text: value[field], readOnly: this.readOnly });
        return field === 'title'
            ? html`${titleAssist({ locale: this.locale, view, actions, id: 'place-title', readOnly: this.readOnly })} ${draft}`
            : draft;
    }

    #traceChoice(): TraceChoice {
        return {
            ...{ layers: this.traceLayers, opacity: this.traceOpacity },
            setOpacity: (percent) => this.intents?.setTraceOpacity(percent),
        };
    }

    #categoryChoice(): CategoryChoice {
        return {
            ...{ categories: this.categories, known: this.categoriesKnown, adding: this.adding },
            addStarters: () => {
                void this.#addStarters();
            },
        };
    }

    async #addStarters(): Promise<void> {
        this.adding = true;
        try {
            await this.intents?.addStarterCategories();
        } finally {
            this.adding = false;
        }
    }

    #context(draft: PoiDraftPort): FieldContext {
        const edit = (patch: Parameters<FieldContext['edit']>[0]): void => {
            this.intents?.edit(patch);
        };
        return {
            ...{ locale: this.locale, value: draft.value, issues: draft.issues, edit },
            ...{ left: this.#left.forItem(draft.id), readOnly: this.readOnly, role: this.role },
        };
    }

    #headInput(editor: PlaceEditorPort, draft: PoiDraftPort): HeadInput {
        return {
            host: this,
            locale: this.locale,
            draft,
            shape: editor.shape,
            intents: this.intents,
            readOnly: this.readOnly,
            who: this.who,
        };
    }

    #shape(editor: PlaceEditorPort, draft: PoiDraftPort): TemplateResult {
        const tools = toolState(editor, draft);
        return html`<fieldset>
            <legend>${poiText(this.locale, 'adminContent.pois.section.shape')}</legend>
            <hcm-draw-toolbar
                .shape=${editor.shape}
                .mode=${this.mode}
                .locale=${this.locale}
                ?read-only=${this.readOnly}
                ?can-delete=${tools.canDelete}
                ?can-undo=${tools.canUndo}
                .canAddCentre=${this.centreKnown}
                @hcm-tool=${(event: CustomEvent<{ readonly tool: DrawToolPort }>) => {
                    this.#tool(event.detail.tool, editor);
                }}
            ></hcm-draw-toolbar>
            <p class="note">${poiText(this.locale, hintKey(this.mode, editor.shape))}</p>
            <p class="note">${poiText(this.locale, 'adminContent.map.crosshair')}</p>
            <p class="alert-region" role="alert">${editor.refusal === null ? '' : refusalText(this.locale, editor.refusal)}</p>
            ${this.#missing(draft)}
            <hcm-vertex-list
                ?read-only=${this.readOnly}
                .positions=${tools.positions}
                .selected=${editor.vertex}
                .locale=${this.locale}
                @hcm-vertex=${(event: CustomEvent<VertexEditPort>) => this.intents?.editVertex(event.detail)}
                @hcm-vertex-select=${(event: CustomEvent<{ readonly index: number | null }>) => this.intents?.selectVertex(event.detail.index)}
            ></hcm-vertex-list>
        </fieldset>`;
    }

    #missing(draft: PoiDraftPort): TemplateResult {
        return draft.value.geometry === null
            ? html`<p class="note">${poiText(this.locale, 'adminContent.pois.field.geometryMissing')}</p>`
            : EMPTY;
    }

    #tool(tool: DrawToolPort, editor: PlaceEditorPort): void {
        const intents = this.intents;
        if (intents === null) {
            return;
        }
        if (tool === 'draw' || tool === 'select') {
            this.mode = tool;
        }
        TOOLS[tool](intents, editor);
    }
}

/** The open place, and whether it has a shape. */
interface ShownPlace {
    readonly id: string;
    readonly drawn: boolean;
}

function shownOf(editor: PlaceEditorPort | null): ShownPlace | null {
    const draft = editor?.draft ?? null;
    return draft === null ? null : { id: draft.id, drawn: draft.value.geometry !== null };
}

/** A point placed by its click since the last render: the map selects it then. */
function pointPlaced(previous: ShownPlace, shown: ShownPlace, shape: PoiShapePort | undefined): boolean {
    return shape === 'point' && !previous.drawn && shown.drawn;
}

/** The tool a place opens with: Draw until it has a shape. */
function openingTool(shown: ShownPlace): 'draw' | 'select' {
    return shown.drawn ? 'select' : 'draw';
}

/** The tool to press now: on a newly opened place, or once its point is placed; null keeps the admin's pick. */
function toolsFor(previous: ShownPlace | null, shown: ShownPlace | null, shape: PoiShapePort | undefined): 'draw' | 'select' | null {
    if (shown === null) {
        return null;
    }
    if (previous?.id !== shown.id) {
        return openingTool(shown);
    }
    return pointPlaced(previous, shown, shape) ? 'select' : null;
}

/** What each drawing tool asks of the area. */
const TOOLS: Readonly<Record<DrawToolPort, (intents: PoisIntentsPort, editor: PlaceEditorPort) => void>> = {
    draw: (intents) => {
        intents.setTool('draw');
    },
    select: (intents) => {
        intents.setTool('select');
    },
    'add-centre': (intents) => {
        intents.addAtCentre();
    },
    'undo-vertex': (intents) => {
        intents.undoLastVertex();
    },
    'delete-vertex': (intents, editor) => {
        if (editor.vertex !== null) {
            intents.editVertex({ kind: 'remove', index: editor.vertex });
        }
    },
};

function hintKey(mode: 'draw' | 'select', shape: PoiShapePort): AdminContentKey {
    return mode === 'draw' ? DRAW_HINTS[shape] : 'adminContent.map.drawHint.select';
}

const DRAW_HINTS: Readonly<Record<PoiShapePort, AdminContentKey>> = {
    point: 'adminContent.map.drawHint.point',
    linestring: 'adminContent.map.drawHint.linestring',
    polygon: 'adminContent.map.drawHint.polygon',
};

/** The positions the vertex list shows, and whether a position can be deleted or the last one removed. */
function toolState(
    editor: PlaceEditorPort,
    draft: PoiDraftPort,
): { readonly positions: readonly LngLat[]; readonly canDelete: boolean; readonly canUndo: boolean } {
    const drawn = draft.value.geometry !== null;
    const positions = drawn ? listed(draft) : editor.sketch;
    const minimum = drawn ? MINIMUM[editor.shape] : 0;
    return {
        positions,
        canDelete: editor.vertex !== null && positions.length > MINIMUM[editor.shape],
        canUndo: positions.length > minimum,
    };
}

/** The positions the vertex list shows of a drawn place. */
function listed(draft: PoiDraftPort): readonly LngLat[] {
    const geometry = draft.value.geometry;
    if (geometry === null) {
        return [];
    }
    if (geometry.type === 'Point') {
        return [geometry.coordinates];
    }
    return geometry.type === 'LineString' ? geometry.coordinates : (geometry.coordinates[0] ?? []).slice(0, -1);
}

/** Registers `<hcm-poi-editor>` once. */
export function defineHcmPoiEditor(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_POI_EDITOR_TAG, HcmPoiEditor);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-poi-editor': HcmPoiEditor;
    }
}
