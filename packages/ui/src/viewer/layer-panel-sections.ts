/**
 * The Layers panel's three collapsible sections (the owner, 2026-11-22): the pinned strip at the top, then Places (the
 * POI categories), then the historical layers. Pinned and Places start expanded, Layers collapsed. Each section has a
 * header button with `aria-expanded` and a chevron; a collapsed body stays in the DOM but `hidden`, so it leaves the
 * accessibility tree and the Tab order. The state is remembered per viewer in localStorage, every access guarded: a
 * private window or blocked storage only loses the memory, never the panel.
 */
import { css, html, type TemplateResult } from 'lit';

export type PanelSection = 'pinned' | 'places' | 'layers';

export type SectionState = Readonly<Record<PanelSection, boolean>>;

export const DEFAULT_SECTIONS: SectionState = { pinned: true, places: true, layers: false };

export const SECTIONS_STORAGE_KEY = 'hcm.layerPanel.sections';

function storage(): Storage | null {
    try {
        return globalThis.localStorage;
    } catch {
        return null;
    }
}

function readStored(): unknown {
    const raw = storage()?.getItem(SECTIONS_STORAGE_KEY) ?? null;
    return raw === null ? null : JSON.parse(raw);
}

/** One stored flag, or its default when it is missing or not a boolean. */
function flag(stored: Partial<Record<PanelSection, unknown>>, key: PanelSection): boolean {
    const value = stored[key];
    return typeof value === 'boolean' ? value : DEFAULT_SECTIONS[key];
}

/** The remembered state, or the defaults when nothing (or something unreadable) is stored. */
export function loadSections(): SectionState {
    try {
        const parsed = readStored();
        if (typeof parsed !== 'object' || parsed === null) {
            return DEFAULT_SECTIONS;
        }
        const stored = parsed as Partial<Record<PanelSection, unknown>>;
        return { pinned: flag(stored, 'pinned'), places: flag(stored, 'places'), layers: flag(stored, 'layers') };
    } catch {
        return DEFAULT_SECTIONS;
    }
}

/** Remembers the state; a storage that refuses only loses the memory. */
export function saveSections(state: SectionState): void {
    try {
        storage()?.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(state));
    } catch {
        // Storage full or blocked: the panel keeps working with the state in memory.
    }
}

export interface SectionView {
    readonly id: PanelSection;
    readonly label: string;
    readonly expanded: boolean;
    readonly onToggle: (id: PanelSection) => void;
}

/** One section: a header button (`aria-expanded`, chevron) and its body, `hidden` while collapsed. */
export function renderSection(view: SectionView, body: TemplateResult): TemplateResult {
    const bodyId = `section-${view.id}`;
    const onClick = (): void => {
        view.onToggle(view.id);
    };
    return html`<section class="section ${view.id}" data-section=${view.id}>
        <h3 class="section-heading">
            <button
                type="button"
                class="section-toggle interactive"
                aria-expanded=${String(view.expanded)}
                aria-controls=${bodyId}
                @click=${onClick}
            >
                <span class="section-label">${view.label}</span>
                <hcm-icon name=${view.expanded ? 'expand_less' : 'expand_more'}></hcm-icon>
            </button>
        </h3>
        <div class="section-body" id=${bodyId} ?hidden=${!view.expanded}>${body}</div>
    </section>`;
}

export const sectionStyles = css`
    .section {
        display: flex;
        flex-direction: column;
    }

    .section-heading {
        margin: 0;
    }

    .section-toggle {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        inline-size: 100%;
        min-block-size: 48px;
        padding-inline: 0 4px;
        border: 0;
        border-radius: var(--md-sys-shape-corner-small);
        background: transparent;
        color: var(--md-sys-color-primary);
        font: inherit;
        font-size: var(--md-sys-typescale-title-small-size);
        font-weight: var(--md-sys-typescale-title-small-weight, 500);
        line-height: var(--md-sys-typescale-title-small-line-height);
        text-align: start;
        cursor: pointer;
    }

    .section-body {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .section-body[hidden] {
        display: none;
    }
`;
