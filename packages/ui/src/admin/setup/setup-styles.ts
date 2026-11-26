/**
 * Styles shared by the Setup Assistant's elements: the body text, the status colours, the link list, the paste and
 * text fields, the copy rows. Colours, shapes and type come only from the `--md-sys-*` tokens.
 */
import { css } from 'lit';

/** Body text, paragraphs, notes and alerts inside a card. */
export const setupTextStyles = css`
    :host {
        display: block;
        color: var(--md-sys-color-on-surface);
    }

    p {
        margin: 0;
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: 12px;
        font-family: var(--md-sys-typescale-body-medium-font);
        font-size: var(--md-sys-typescale-body-medium-size);
        line-height: var(--md-sys-typescale-body-medium-line-height);
    }

    .note {
        color: var(--md-sys-color-on-surface-variant);
    }

    .alert {
        padding: 8px 12px;
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-error-container);
        color: var(--md-sys-color-on-error-container);
    }

    .success {
        display: flex;
        gap: 8px;
        align-items: center;
        color: var(--md-sys-color-primary);
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: center;
    }

    code {
        font-family: ui-monospace, monospace;
        overflow-wrap: anywhere;
    }

    @media (forced-colors: active) {
        .alert {
            border: 1px solid CanvasText;
        }
    }
`;

/** Labelled text fields: a 48 px tall box, a visible label above it, the M3 outlined look. */
export const fieldStyles = css`
    .field {
        display: flex;
        flex-direction: column;
        gap: 4px;
        max-inline-size: 480px;
    }

    label {
        font-family: var(--md-sys-typescale-label-large-font);
        font-size: var(--md-sys-typescale-label-large-size);
        font-weight: var(--md-sys-typescale-label-large-weight);
        color: var(--md-sys-color-on-surface-variant);
    }

    .field input {
        box-sizing: border-box;
        min-block-size: 48px;
        padding-inline: 12px;
        border: 1px solid var(--md-sys-color-outline);
        border-radius: var(--md-sys-shape-corner-extra-small);
        background: var(--md-sys-color-surface);
        color: var(--md-sys-color-on-surface);
        font: inherit;
    }

    /*
     * The focused field (M3's 2 px active indicator); :focus-within too, for a field whose focus sits on a part of it.
     * Dates are text fields in the admin's language (../editing/date-text.ts), not the browser's date input.
     */
    .field input:focus-visible,
    .field input:focus-within {
        outline: 2px solid var(--md-sys-color-primary);
        outline-offset: -1px;
    }

    .hint {
        color: var(--md-sys-color-on-surface-variant);
    }

    fieldset {
        margin: 0;
        padding: 8px 16px 16px;
        border: 1px solid var(--md-sys-color-outline-variant);
        border-radius: var(--md-sys-shape-corner-medium);
    }

    legend {
        padding-inline: 4px;
    }

    .option {
        display: flex;
        gap: 12px;
        align-items: center;
        min-block-size: 48px;
    }

    .radio {
        inline-size: 20px;
        block-size: 20px;
        margin: 0;
        accent-color: var(--md-sys-color-primary);
    }
`;

/** Rows of a value with a copy button. */
export const copyStyles = css`
    .copy-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    /*
     * The text takes the free space, so every row's copy button (and its "Copied." status after it) sits at the trailing
     * edge, one under the other (space-between put the button midway between the text and the empty status).
     */
    .copy-row {
        display: flex;
        gap: 8px;
        align-items: center;
        min-block-size: 48px;
    }

    .copy-row > :first-child {
        display: flex;
        flex: 1 1 auto;
        flex-direction: column;
        min-inline-size: 0;
    }
`;

/**
 * A deep link drawn as a filled button (it opens a provider's page in a new tab): the USGS token page, and Google's
 * page that creates a billing account (M6 setup-ux, finding 3).
 */
export const linkButtonStyles = css`
    .link-button {
        display: inline-flex;
        gap: 8px;
        align-items: center;
        box-sizing: border-box;
        min-block-size: 48px;
        padding-inline: 24px;
        border-radius: var(--md-sys-shape-corner-full);
        background: var(--md-sys-color-primary);
        color: var(--md-sys-color-on-primary);
        font-family: var(--md-sys-typescale-label-large-font);
        font-size: var(--md-sys-typescale-label-large-size);
        font-weight: var(--md-sys-typescale-label-large-weight);
        text-decoration: none;

        --hcm-icon-size: 18px;
    }

    .link-button:focus-visible {
        outline: 3px solid var(--md-sys-color-secondary);
        outline-offset: 2px;
    }
`;
