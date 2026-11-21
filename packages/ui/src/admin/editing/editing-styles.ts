/**
 * Styles of the editors' pages (`docs/research/M2c-interfaces.md` §9.5): the rows of a list (links to their item, the
 * selected one marked), a pane's sections and headings, the notes, alerts and statuses every screen has (§1.4), chips,
 * rows of actions, and native fields (outlined, 48 px, the ring on `:focus-visible, :focus-within` as the USGS card's
 * fix). Rings stay inside the pane: rows and fields leave room for the 3 px ring and its 2 px offset, because a pane
 * scrolls and would cut a ring that reaches past it (`docs/research/layout-a11y-findings.md`).
 */
import { css } from 'lit';

import { adminBase } from '../shell/admin-styles.js';
import { bulkBarStyles } from './bulk-bar.js';

export const editingStyles = [
    adminBase,
    css`
        :host {
            display: block;
        }

        .pane {
            display: flex;
            flex-direction: column;
            gap: 16px;
            box-sizing: border-box;
            max-inline-size: 840px;
            margin-inline: auto;
            padding: 16px;
            overflow-wrap: anywhere;
        }

        h2,
        h3 {
            margin: 0;
        }

        h2 {
            font-size: var(--md-sys-typescale-headline-small-size, 1.5rem);
            line-height: var(--md-sys-typescale-headline-small-line-height, 2rem);
            font-weight: var(--md-sys-typescale-headline-small-weight, 400);
        }

        h3 {
            font-size: var(--md-sys-typescale-title-medium-size, 1rem);
            line-height: var(--md-sys-typescale-title-medium-line-height, 1.5rem);
            font-weight: var(--md-sys-typescale-title-medium-weight, 500);
        }

        h2:focus,
        h3:focus {
            outline: none;
        }

        h2:focus-visible,
        h3:focus-visible {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
        }

        p {
            margin: 0;
            font-size: var(--md-sys-typescale-body-large-size, 1rem);
            line-height: var(--md-sys-typescale-body-large-line-height, 1.5rem);
        }

        .note {
            color: var(--md-sys-color-on-surface-variant, CanvasText);
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
            line-height: var(--md-sys-typescale-body-medium-line-height, 1.25rem);
        }

        .alert {
            display: flex;
            align-items: flex-start;
            gap: 8px;
            padding: 12px 16px;
            border-radius: var(--md-sys-shape-corner-medium, 12px);
            background: var(--md-sys-color-error-container, Canvas);
            color: var(--md-sys-color-on-error-container, CanvasText);

            --hcm-focus-ring-color: var(--md-sys-color-on-error-container, CanvasText);
        }

        .alert a {
            color: inherit;
        }

        .alert-body {
            display: flex;
            flex-direction: column;
            gap: 8px;
            min-inline-size: 0;
        }

        .alert-body > p {
            margin: 0;
        }

        /* A text button on the error container (Take theirs in a conflict banner) reads in the banner's own colour: the
           primary tone did not reach 4.5:1 there (the generic checkers on editing.conflict, DECISIONS-for-review.md §42c). */
        .alert hcm-button[variant='text']::part(button) {
            color: var(--md-sys-color-on-error-container, CanvasText);
        }

        .status:empty,
        .alert-region:empty {
            display: none;
        }

        .actions {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
        }

        /* Rows of chips 16 px apart: a 32 px chip's 48 px touch target reaches 8 px above and below it, and two wrapped
           rows 8 px apart would cover each other's (the first row's target was 40 px high on a phone). */
        .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 16px 8px;
        }

        .tag {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            min-block-size: 32px;
            box-sizing: border-box;
            padding: 4px 12px;
            border: 1px solid var(--md-sys-color-outline-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-small, 8px);
            font-size: var(--md-sys-typescale-label-large-size, 0.875rem);

            --hcm-icon-size: 18px;
        }

        .tag[data-tone='error'] {
            border-color: transparent;
            background: var(--md-sys-color-error-container, Canvas);
            color: var(--md-sys-color-on-error-container, CanvasText);
        }

        .tag[data-tone='good'] {
            border-color: transparent;
            background: var(--md-sys-color-secondary-container, Canvas);
            color: var(--md-sys-color-on-secondary-container, CanvasText);
        }

        .tag[data-tone='wait'] {
            border-color: transparent;
            background: var(--md-sys-color-tertiary-container, Canvas);
            color: var(--md-sys-color-on-tertiary-container, CanvasText);
        }

        .rows {
            display: flex;
            flex-direction: column;
            gap: 4px;
            margin: 0;
            padding: 8px;
            list-style: none;
        }

        .row {
            display: flex;
            flex-direction: column;
            justify-content: center;
            gap: 2px;
            box-sizing: border-box;
            min-block-size: 56px;
            padding: 8px 16px;
            border-radius: var(--md-sys-shape-corner-large, 16px);
            color: inherit;
            text-decoration: none;
        }

        a.row:hover {
            background: color-mix(in srgb, var(--md-sys-color-on-surface, CanvasText) 8%, transparent);
        }

        a.row[aria-current='page'] {
            background: var(--md-sys-color-secondary-container, Highlight);
            color: var(--md-sys-color-on-secondary-container, HighlightText);
        }

        .row-title {
            font-size: var(--md-sys-typescale-body-large-size, 1rem);
            line-height: var(--md-sys-typescale-body-large-line-height, 1.5rem);
        }

        .row-detail {
            color: var(--md-sys-color-on-surface-variant, CanvasText);
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
            line-height: var(--md-sys-typescale-body-medium-line-height, 1.25rem);
        }

        a.row[aria-current='page'] .row-detail {
            color: inherit;
        }

        .list-head {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px 16px 0;
        }

        .facts {
            display: grid;
            grid-template-columns: minmax(0, max-content) minmax(0, 1fr);
            gap: 8px 16px;
            margin: 0;
        }

        .facts dt {
            color: var(--md-sys-color-on-surface-variant, CanvasText);
        }

        .facts dd {
            margin: 0;
        }

        .field {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .field label {
            font-size: var(--md-sys-typescale-body-medium-size, 0.875rem);
        }

        .field input,
        .field select,
        .field textarea {
            box-sizing: border-box;
            min-block-size: 48px;
            min-inline-size: 0;
            padding-inline: 16px;
            border: 1px solid var(--md-sys-color-outline, CanvasText);
            border-radius: var(--md-sys-shape-corner-extra-small, 4px);
            background: transparent;
            color: inherit;
            font: inherit;
        }

        .field input:focus-visible,
        .field input:focus-within,
        .field select:focus-visible,
        .field textarea:focus-visible {
            outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
            outline-offset: 0;
        }

        .field[data-invalid] input {
            border-color: var(--md-sys-color-error, CanvasText);
        }

        .field .error {
            color: var(--md-sys-color-error, CanvasText);
            font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
        }

        a.external {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            min-block-size: 48px;

            --hcm-icon-size: 18px;
        }

        pre.text {
            margin: 0;
            padding: 12px;
            border-radius: var(--md-sys-shape-corner-small, 8px);
            background: var(--md-sys-color-surface-container, Canvas);
            font-family: ui-monospace, monospace;
            font-size: var(--md-sys-typescale-body-small-size, 0.75rem);
            white-space: pre-wrap;
            overflow-wrap: anywhere;
        }
    `,
    bulkBarStyles,
];
