/**
 * The Statistics view's own styles (`#/crashes/statistics`, the owner's "prettify" of 2026-11-13), in the crashes chunk:
 * a wider pane than the editors' (1200 px), the page's head, the off note, the cards' surface, the adaptive grid (one
 * column on a phone, two or three on a wide window) and the native disclosures (a 48 px summary: Show all, the full text
 * of an error, the folded help with every wizard's step codes). The live sections' styles come with their chunk
 * (`statistics-live-styles.ts`), so this chunk stays within its 5 KB budget.
 */
import { css } from 'lit';

export const statisticsStyles = css`
    /* The crashes page fills the page area (its list and detail panes scroll): this view scrolls on its own. */
    .statistics {
        block-size: 100%;
        overflow-y: auto;
        gap: 24px;
        max-inline-size: 1200px;
    }

    /* M3's 48 px touch target for the links on their own lines (the tour's target-size check on a compact window). */
    .statistics p > a,
    .statistics a.external,
    a[data-statistics-link] {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    .statistics code {
        font-family: var(--hcm-font-mono, ui-monospace, monospace);
        font-size: 0.875em;
        overflow-wrap: anywhere;
    }

    .statistics .page-head,
    .statistics .section-head {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    /* The adaptive grid: one column on a phone, two or three as the window widens. */
    .statistics .grid,
    .statistics .wizards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr));
        gap: 16px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .statistics .card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-inline-size: 0;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-surface-container-low);
        color: var(--md-sys-color-on-surface);
    }

    /* Show all, the full text of an error and the help: a native disclosure, its summary 48 px high. */
    .statistics summary {
        padding-block: 12px;
        line-height: 24px;
        color: var(--md-sys-color-primary);
        font-weight: 500;
        cursor: pointer;
    }

    .statistics .help > summary {
        color: inherit;
        font-size: var(--md-sys-typescale-title-medium-size);
    }

    .statistics .help-body {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }
`;
