/**
 * The Statistics view's live sections' styles (the owner's "prettify" of 2026-11-13), in the `statistics-live` chunk and
 * adopted by the crashes page once that chunk is there (`hcm-crashes-list-page.ts`): Material 3 Expressive on the kit's
 * tokens, spacing on the 4/8 dp grid; stat cards for the key numbers, the apps' data table, horizontal bar lists, step
 * bars for the wizards, error cards, and skeletons while Google answers (a slow shimmer unless motion is reduced).
 */
import { css } from 'lit';

export const statisticsLiveStyles = css`
    .statistics h4,
    .statistics h5 {
        margin: 0;
        font-size: var(--md-sys-typescale-title-small-size);
        line-height: var(--md-sys-typescale-title-small-line-height);
        font-weight: var(--md-sys-typescale-title-small-weight);
    }

    .statistics .info {
        display: flex;
        gap: 12px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
    }

    .statistics .info a {
        color: inherit;
    }

    .statistics .numbers,
    .statistics .crash-groups,
    .statistics .block {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .statistics .section-head h3 {
        font-size: var(--md-sys-typescale-title-large-size);
        line-height: var(--md-sys-typescale-title-large-line-height);
        font-weight: var(--md-sys-typescale-title-large-weight);
    }

    /* The period and its action on one row; the period's 48 px targets reach 4 px past its 40 px row. */
    .statistics .toolbar {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
        padding-block: 4px;
    }

    .statistics .consent {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .statistics .grid:empty {
        display: none;
    }

    /* The key numbers: stat cards, two per row on a phone. */
    .statistics .stats {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(100%, 148px), 1fr));
        gap: 16px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .statistics .stat {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-surface-container);
    }

    .statistics .stat-label {
        color: var(--md-sys-color-on-surface-variant);
        font-size: var(--md-sys-typescale-label-large-size);
        line-height: var(--md-sys-typescale-label-large-line-height);
    }

    .statistics .stat-value {
        color: var(--md-sys-color-on-surface);
        font-size: var(--md-sys-typescale-display-small-size);
        line-height: var(--md-sys-typescale-display-small-line-height);
        font-weight: 500;
        font-variant-numeric: tabular-nums;
    }

    /* The apps' table: M3's data table on the card, numbers aligned at their end. */
    .statistics .table-wrap {
        max-inline-size: 100%;
        overflow-x: auto;
    }

    .statistics table {
        inline-size: 100%;
        border-collapse: collapse;
        font-variant-numeric: tabular-nums;
    }

    .statistics th,
    .statistics td {
        padding: 12px 16px 12px 0;
        border-block-end: 1px solid var(--md-sys-color-outline-variant);
        text-align: start;
        vertical-align: middle;
    }

    .statistics thead th {
        color: var(--md-sys-color-on-surface-variant);
        font-size: var(--md-sys-typescale-label-large-size);
        font-weight: 500;
    }

    .statistics tbody th {
        font-weight: 400;
    }

    .statistics .num {
        text-align: end;
    }

    .statistics tr:last-child > * {
        border-block-end: none;
    }

    .statistics svg.daily {
        display: block;
        color: var(--md-sys-color-primary);
    }

    /* A ranked list's rows: the name and the numbers on one line, the bar under them. */
    .statistics .bars,
    .statistics .steps {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .statistics .bar-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto 3.5em;
        gap: 4px 12px;
        align-items: baseline;
        font-variant-numeric: tabular-nums;
    }

    .statistics .bar-name {
        display: flex;
        flex-direction: column;
        min-inline-size: 0;
    }

    .statistics .bar-raw {
        font-size: var(--md-sys-typescale-body-small-size);
    }

    .statistics .bar-value {
        font-weight: 500;
    }

    .statistics .bar-share {
        color: var(--md-sys-color-on-surface-variant);
        text-align: end;
    }

    .statistics .bar-track {
        display: block;
        grid-column: 1 / -1;
        block-size: 8px;
        border-radius: var(--md-sys-shape-corner-full);
        background: var(--md-sys-color-surface-container-highest);
        overflow: hidden;
    }

    .statistics .bar-fill {
        display: block;
        inline-size: var(--hcm-bar, 0%);
        min-inline-size: 4px;
        block-size: 100%;
        border-radius: inherit;
        background: var(--md-sys-color-primary);
    }

    .statistics details.more > .bars {
        padding-block-start: 8px;
    }

    /* A wizard's steps: the name, the bar (its share of the first step's people), the facts, the errors. */
    .statistics .step {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .statistics .step-facts {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 16px;
        margin: 0;
        color: var(--md-sys-color-on-surface-variant);
        font-size: var(--md-sys-typescale-body-medium-size);
    }

    .statistics .step-facts dt {
        display: inline;
    }

    .statistics .step-facts dt::after {
        content: ': ';
    }

    .statistics .step-facts dd {
        display: inline;
        margin: 0;
        color: var(--md-sys-color-on-surface);
        font-variant-numeric: tabular-nums;
    }

    .statistics .step-errors {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .statistics .badge {
        padding-inline: 6px;
        border-radius: var(--md-sys-shape-corner-full);
        background: var(--md-sys-color-error);
        color: var(--md-sys-color-on-error);
        font-variant-numeric: tabular-nums;
    }

    /* The errors: a card each, its title, how often as a chip, when it was seen, the full text folded. */
    .statistics .errors {
        display: flex;
        flex-direction: column;
        gap: 12px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .statistics .error-item {
        gap: 8px;
    }

    .statistics .error-head {
        display: flex;
        flex-wrap: wrap;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px 16px;
    }

    .statistics .error-title {
        flex: 1 1 240px;
        min-inline-size: 0;
        font-size: var(--md-sys-typescale-title-small-size);
        line-height: var(--md-sys-typescale-title-small-line-height);
        font-weight: 500;
    }

    .statistics pre.cause {
        margin: 0;
        padding: 12px;
        border-radius: var(--md-sys-shape-corner-medium);
        background: var(--md-sys-color-surface-container-highest);
        font-family: var(--hcm-font-mono, ui-monospace, monospace);
        font-size: var(--md-sys-typescale-body-small-size);
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }

    /* The skeletons while Google answers: the cards' shapes, a slow shimmer unless motion is reduced. */
    .statistics .skeletons {
        display: flex;
        flex-direction: column;
        gap: 16px;
    }

    .statistics .skeleton {
        display: block;
        border-radius: var(--md-sys-shape-corner-large);
        background: var(--md-sys-color-surface-container-high);
        animation: hcm-skeleton 1.5s ease-in-out infinite alternate;
    }

    .statistics .skeleton.stat {
        block-size: 96px;
    }

    .statistics .skeleton.block {
        block-size: 200px;
    }

    @keyframes hcm-skeleton {
        to {
            opacity: 0.5;
        }
    }

    @media (prefers-reduced-motion: reduce) {
        .skeleton {
            animation: none;
        }
    }
`;
