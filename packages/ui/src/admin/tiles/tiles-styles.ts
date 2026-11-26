/**
 * The tile-import wizard's styles: the grid's cells (`--hcm-tile-cell` a side: 88 px, 64 px on a phone), each thumbnail cut from the
 * sprite through the CSSOM (`cssProperties`: its size, its place in the sprite, its turn and mirror), the weak seam's strips, the
 * meter's bars, and a bottom action bar on a phone.
 */
import { css } from 'lit';

export const tileStyles = css`
    :host {
        --hcm-tile-cell: 88px;

        /* At 320 px even a 6 : 1 strip is 48 px high: a touch target on a medium window. */
        --hcm-seam-side: 320px;
    }

    @media (width < 600px) {
        :host {
            --hcm-tile-cell: 64px;

            /* A strip as wide as a 320 px window allows, so even a 6 : 1 strip is 48 px high (a touch target); the two stack. */
            --hcm-seam-side: 288px;
        }
    }

    .thumb {
        display: block;
        inline-size: calc(var(--tw) * var(--hcm-tile-cell) / 128);
        block-size: calc(var(--th) * var(--hcm-tile-cell) / 128);
        background-image: var(--img);
        background-repeat: no-repeat;
        background-size: calc(var(--sw) * var(--hcm-tile-cell) / 128) calc(var(--sh) * var(--hcm-tile-cell) / 128);
        background-position: calc(var(--tx) * var(--hcm-tile-cell) / -128) calc(var(--ty) * var(--hcm-tile-cell) / -128);
        background-color: var(--md-sys-color-surface-container-highest, GrayText);
        transform: var(--tf);
        pointer-events: none;
    }

    .badge {
        position: absolute;
        inset-block-end: 2px;
        inset-inline-start: 2px;
        padding: 0 4px;
        border-radius: var(--md-sys-shape-corner-small, 8px);
        background: var(--md-sys-color-surface-container, Canvas);
        color: var(--md-sys-color-on-surface, CanvasText);
        font-size: var(--md-sys-typescale-label-small-size, 0.6875rem);
        line-height: 1rem;
        pointer-events: none;
    }
`;
