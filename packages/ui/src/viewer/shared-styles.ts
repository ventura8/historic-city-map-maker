/**
 * Styles shared by the viewer elements. Colours come only from the M3 `--md-sys-color-*` tokens the city's manifest
 * carries, shapes and type from the M3 system tokens: `<hcm-map-viewer>` applies them all on connect, before its first
 * render (the baseline theme until a manifest arrives), so the `--md-sys-*` and `--md-ref-*` names carry no fallback,
 * as in the kit; `test/viewer/theme-tokens.test.ts` checks that every one the viewer names is set.
 */
import { css } from 'lit';

export const baseStyles = css`
    :host {
        font-family: var(--md-ref-typeface-plain);
        color: var(--md-sys-color-on-surface);
    }

    /* The kit's ring (focusRing): secondary, or the colour a surface sets in --hcm-focus-ring-color. */
    :focus-visible {
        outline: var(--hcm-focus-ring-width, 3px) solid var(--hcm-focus-ring-color, var(--md-sys-color-secondary));
        outline-offset: 2px;
    }

    a {
        color: var(--md-sys-color-primary);
    }

    h2,
    h3,
    p {
        margin: 0;
    }

    h2 {
        font-size: var(--md-sys-typescale-title-large-size);
        line-height: 1.3;
        font-weight: 500;
    }

    h3 {
        font-size: var(--md-sys-typescale-title-small-size);
        font-weight: 500;
        letter-spacing: 0.01em;
    }

    ul {
        margin: 0;
        padding: 0;
        list-style: none;
    }

    [hidden] {
        display: none !important;
    }
`;

/** The docked (standard) side sheet: a pane next to the map, with its own heading and close button. */
export const sheetStyles = css`
    .docked {
        display: flex;
        flex-direction: column;
        block-size: 100%;
        box-sizing: border-box;
        background: var(--md-sys-color-surface-container-low);
        border-inline-start: 1px solid var(--md-sys-color-outline-variant);
    }

    .docked > header {
        display: flex;
        align-items: center;
        gap: 8px;
        padding-block: 12px;
        padding-inline: 24px 12px;
    }

    .docked > header > h2 {
        flex: 1;
        min-inline-size: 0;
        overflow-wrap: anywhere;
    }

    .docked > .body {
        flex: 1;
        overflow: hidden auto;
        padding-block: 0 24px;
        padding-inline: 24px;
    }

    .sheet-title {
        overflow-wrap: anywhere;
    }
`;

/** Labelled sections of a detail sheet (links, photos, credits). */
export const detailStyles = css`
    .details {
        display: flex;
        flex-direction: column;
        gap: 12px;
        line-height: 1.5;
    }

    .details section {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .details li + li {
        margin-block-start: 4px;
    }

    /*
     * A link of a list, or a link alone on its line (p.link: Street View, Suggest a correction), is a target of its own: 48 px
     * tall like every touch target (a link inside a sentence is exempt). The Pixel Tablet found the two lone links 19 px tall.
     */
    .details li > a,
    .details .link > a {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
    }

    .supporting {
        color: var(--md-sys-color-on-surface-variant);
    }

    .note {
        padding: 8px 12px;
        border-radius: var(--md-sys-shape-corner-small);
        background: var(--md-sys-color-secondary-container);
        color: var(--md-sys-color-on-secondary-container);
    }
`;
