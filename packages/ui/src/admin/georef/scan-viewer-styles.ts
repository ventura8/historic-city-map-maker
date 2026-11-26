/** `<hcm-scan-viewer>`'s own styles (`./hcm-scan-viewer.ts`): the canvas filling the pane, its cursor and focus ring, the zoom buttons. */
import { css } from 'lit';

export const scanViewerStyles = css`
    :host {
        display: block;
        position: relative;
        min-block-size: 240px;
        background: var(--md-sys-color-surface-container-high, Canvas);
    }

    canvas {
        display: block;
        inline-size: 100%;
        block-size: 100%;
        touch-action: none;
        cursor: grab;
    }

    canvas:focus-visible {
        outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
        outline-offset: -3px;
    }

    :host([adding]) canvas {
        cursor: crosshair;
    }

    .zoom {
        position: absolute;
        inset-block-start: 8px;
        inset-inline-end: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .zoom hcm-icon-button {
        background: var(--md-sys-color-surface-container-highest, Canvas);
        border-radius: 50%;
    }
`;
