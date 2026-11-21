/**
 * The order card's styles (`docs/research/M4-interfaces.md` §1.7): a card like the approval card, the guide's numbered
 * steps, and EarthExplorer's link as a filled button (the flow's first input: 48 px, a 3:1 focus ring).
 */
import { css } from 'lit';

export const orderStyles = css`
    .order-card {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 16px;
        border-radius: var(--md-sys-shape-corner-large, 16px);
        background: var(--md-sys-color-surface-container-low, Canvas);
    }

    .order-card > h3,
    .order-card > p,
    .order-card .guide {
        margin: 0;
    }

    .order-card .guide {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding-inline-start: 24px;
    }

    .order-card .guide-label {
        font-weight: var(--md-sys-typescale-title-small-weight, 500);
    }

    .ee-link {
        display: inline-flex;
        align-items: center;
        box-sizing: border-box;
        min-block-size: 48px;
        padding-inline: 24px;
        border-radius: var(--md-sys-shape-corner-full, 9999px);
        background: var(--md-sys-color-primary, LinkText);
        color: var(--md-sys-color-on-primary, Canvas);
        font-family: var(--md-sys-typescale-label-large-font, inherit);
        font-size: var(--md-sys-typescale-label-large-size, 0.875rem);
        font-weight: var(--md-sys-typescale-label-large-weight, 500);
        text-decoration: none;
    }

    .ee-link:focus-visible {
        outline: 3px solid var(--md-sys-color-secondary, Highlight);
        outline-offset: 2px;
    }
`;
