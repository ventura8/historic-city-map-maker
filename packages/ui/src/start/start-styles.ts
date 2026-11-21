import { css } from 'lit';

/**
 * The start page's own styles: logical properties only, colours from the kit's M3 tokens (its baseline theme, both schemes,
 * contrast checked by the tour), 48 px targets, one column up to a readable width.
 */
export const startHostStyles = css`
    :host {
        --surface: var(--md-sys-color-surface);
        --on-surface: var(--md-sys-color-on-surface);
        --muted: var(--md-sys-color-on-surface-variant);
        --primary: var(--md-sys-color-primary);
        --on-primary: var(--md-sys-color-on-primary);
        --panel: var(--md-sys-color-surface-container);
        --error: var(--md-sys-color-error);
        --line: var(--md-sys-color-outline);

        display: block;
        min-block-size: 100dvh;
        background: var(--surface);
        color: var(--on-surface);
        font:
            1rem/1.5 system-ui,
            sans-serif;
    }
`;

export const startStyles = css`
    header {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding-inline: 16px;
        padding-block: 8px;
        border-block-end: 1px solid var(--line);
    }

    .brand {
        margin: 0;
        font-weight: 600;
    }

    .language {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    main {
        box-sizing: border-box;
        max-inline-size: 44rem;
        margin-inline: auto;
        padding-inline: 16px;
        padding-block: 16px 48px;
    }

    h1 {
        font-size: 2rem;
        line-height: 1.2;
        margin-block: 16px;
    }

    h2 {
        font-size: 1.25rem;
        margin-block: 24px 8px;
    }

    .lede {
        font-size: 1.125rem;
        color: var(--muted);
    }

    .note {
        color: var(--muted);
        font-size: 0.875rem;
        margin-block: 4px;
    }

    .for-readers {
        position: absolute;
        inline-size: 1px;
        block-size: 1px;
        margin: 0;
        overflow: hidden;
        clip-path: inset(50%);
        white-space: nowrap;
    }

    .alert {
        color: var(--error);
        margin-block: 4px;
    }

    a {
        color: var(--primary);
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    button,
    a.filled {
        box-sizing: border-box;
        min-block-size: 48px;
        min-inline-size: 48px;
        padding-inline: 24px;
        border: 0;
        border-radius: 24px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
    }

    button.filled,
    a.filled {
        background: var(--primary);
        color: var(--on-primary);
        text-decoration: none;
    }

    button[disabled] {
        cursor: not-allowed;
        background: var(--panel);
        color: var(--muted);
    }

    .panel {
        margin-block: 24px;
        padding: 16px;
        border-radius: 12px;
        background: var(--panel);
    }

    .panel h2 {
        margin-block-start: 0;
    }

    form {
        display: grid;
        gap: 16px;
        justify-items: start;
    }

    fieldset {
        box-sizing: border-box;
        inline-size: 100%;
        margin: 0;
        padding: 12px;
        border: 1px solid var(--line);
        border-radius: 12px;
    }

    legend {
        font-weight: 600;
        padding-inline: 4px;
    }

    .field {
        display: grid;
        gap: 4px;
        inline-size: 100%;
    }

    input:not([type='radio']),
    select {
        box-sizing: border-box;
        inline-size: 100%;
        min-block-size: 48px;
        padding-inline: 12px;
        border: 1px solid var(--line);
        border-radius: 8px;
        background: var(--surface);
        color: var(--on-surface);
        font: inherit;
    }

    .language select {
        inline-size: auto;
    }

    button:focus-visible,
    a:focus-visible,
    input:focus-visible,
    select:focus-visible {
        outline: 3px solid var(--primary);
        outline-offset: 2px;
    }

    .edges {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(8rem, 1fr));
        gap: 8px;
    }

    .choice {
        display: flex;
        align-items: center;
        gap: 8px;
        min-block-size: 48px;
    }

    .choice input {
        appearance: none;
        box-sizing: border-box;
        flex: none;
        inline-size: 48px;
        block-size: 48px;
        margin: 0;
        border: 2px solid var(--line);
        border-radius: 50%;
        background: var(--surface);
    }

    .choice input:checked {
        border-color: var(--primary);
        background: radial-gradient(circle, var(--primary) 0 30%, var(--surface) 35%);
    }

    .steps {
        list-style: none;
        padding: 0;
        margin-block: 16px;
        display: grid;
        gap: 8px;
    }

    .steps li {
        display: flex;
        flex-wrap: wrap;
        justify-content: space-between;
        gap: 8px;
        padding: 12px;
        border-radius: 8px;
        background: var(--panel);
    }

    .chip {
        font-weight: 600;
    }

    .steps li[data-state='failed'] .chip {
        color: var(--error);
    }
`;
