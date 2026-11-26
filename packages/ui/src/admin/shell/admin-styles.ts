/**
 * Styles shared by the admin's elements. Colours come only from the M3 `--md-sys-color-*` tokens the shell applies (the
 * city's theme, or the kit's baseline before it is read), with CSS system colours as fallbacks so a panel shown before
 * the theme still reads.
 */
import { css } from 'lit';

export const adminBase = css`
    :host {
        font-family: var(--md-ref-typeface-plain, system-ui, sans-serif);
        color: var(--md-sys-color-on-surface, CanvasText);
        -webkit-tap-highlight-color: transparent;
    }

    :host([hidden]),
    [hidden] {
        display: none !important;
    }

    /*
     * The kit's ring (focusRing): secondary, or the colour a surface sets in --hcm-focus-ring-color for what is on it (the
     * error container's alerts: secondary is 2.38:1 there, CR-M2c-29).
     */
    :focus-visible {
        outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid
            var(--hcm-focus-ring-color, var(--md-sys-color-secondary, Highlight));
        outline-offset: var(--md-sys-state-focus-indicator-outer-offset, 2px);
    }

    @media (forced-colors: active) {
        :focus-visible {
            outline-color: Highlight;
        }
    }

    h1,
    h2,
    p {
        margin: 0;
    }

    a {
        color: var(--md-sys-color-primary, LinkText);
    }
`;

/**
 * A centred panel (sign-in, claim, join, blocked): title, text, an optional message, actions. The panel is the whole
 * screen: from the medium window class (600 px wide) and 480 px tall it sits in the middle of the window, a compact
 * window starts it at the top so a long panel is never cut (M6 setup-ux, finding 2 of 2026-10-25).
 */
export const panelStyles = css`
    :host {
        display: grid;
        align-content: start;
        box-sizing: border-box;
        min-block-size: 100dvh;
        padding-block: max(24px, env(safe-area-inset-top));
        padding-inline: max(16px, env(safe-area-inset-left)) max(16px, env(safe-area-inset-right));
    }

    @media (width >= 600px) and (height >= 480px) {
        :host {
            align-content: center;
        }
    }

    .panel {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        gap: 16px;
        max-inline-size: 560px;
        margin-inline: auto;
        padding: 24px;
        border-radius: var(--md-sys-shape-corner-extra-large, 28px);
        background: var(--md-sys-color-surface-container-low, Canvas);
        overflow-wrap: anywhere;
    }

    h1 {
        font-size: var(--md-sys-typescale-headline-small-size, 1.5rem);
        line-height: var(--md-sys-typescale-headline-small-line-height, 2rem);
        font-weight: var(--md-sys-typescale-headline-small-weight, 400);
    }

    p {
        font-size: var(--md-sys-typescale-body-large-size, 1rem);
        line-height: var(--md-sys-typescale-body-large-line-height, 1.5rem);
    }

    .issue {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 12px 16px;
        border-radius: var(--md-sys-shape-corner-medium, 12px);
        background: var(--md-sys-color-error-container, Canvas);
        color: var(--md-sys-color-on-error-container, CanvasText);
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
    }

    /* M13 §3: the Contribute page's way back to the map, a link with a button's target size. */
    .back {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        padding-inline: 12px;
    }
`;
