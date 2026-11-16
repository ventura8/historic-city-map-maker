/**
 * `<hcm-compass>`: the map's compass (the owner, 2026-11-13: "i want us to have a compass for the viewer. (and clicking on
 * it resets to north up)"; scenario V64, docs/ENGINE_API.md → *Compass*). An M3 icon button (40 px in a 48 px target) in
 * its own pill by the zoom group whose needle turns with the map's bearing on every frame the camera moves (flat: it never
 * leans with the map's tilt); a press fires the native `click`, which the viewer turns into the store's `resetNorth`. It is always shown:
 * north up and level it is quiet (the needle in the surface's text colour), turned or tilted its north point takes the
 * primary colour. Its name says what it does; the bearing and the tilt are its description (`aria-describedby`), never a
 * live region, so a turning map does not flood a screen reader. Its own element, so a frame of the camera repaints the
 * needle alone, not the viewer.
 */
import { DEFAULT_LOCALE, translate, type ViewerLocale } from '@hcm/shared';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';

import { cssProperties } from '../components/css-properties.js';
import { defineOnce } from '../components/internal.js';
import { focusRing, stateLayer, touchTarget, visuallyHidden } from '../components/styles.js';
import { baseStyles } from './shared-styles.js';
import type { MapCamera, Unsubscribe } from './store-port.js';

export const HCM_COMPASS_TAG = 'hcm-compass';

/** Where the camera comes from: the viewer store's `watchCamera`. */
export interface CameraSource {
    watchCamera(listener: (camera: MapCamera) => void): Unsubscribe;
}

const NORTH: MapCamera = { bearing: 0, pitch: 0 };

/** Whole degrees, the way the needle reads them: 359.6 is north again, so the description never says 360°. */
function wholeDegrees(value: number): number {
    return Math.round(value) % 360;
}

/** The compass's description: north and level, turned, or turned and tilted (whole degrees). */
export function compassDescription(locale: ViewerLocale, { bearing, pitch }: MapCamera): string {
    const degrees = String(wholeDegrees(bearing));
    const tilt = Math.round(pitch);
    if (tilt > 0) {
        return translate(locale, 'viewer.compassTilted', { degrees, tilt: String(tilt) });
    }
    return degrees === '0' ? translate(locale, 'viewer.compassNorth') : translate(locale, 'viewer.compassTurned', { degrees });
}

export class HcmCompass extends LitElement {
    static override readonly shadowRootOptions: ShadowRootInit = { ...LitElement.shadowRootOptions, delegatesFocus: true };

    static override readonly properties = {
        source: { attribute: false },
        locale: { type: String },
        camera: { state: true },
        north: { type: Boolean, reflect: true },
    };

    static override readonly styles = [
        baseStyles,
        focusRing,
        stateLayer,
        touchTarget,
        visuallyHidden,
        css`
            :host {
                display: inline-flex;
                vertical-align: middle;
            }

            button {
                display: inline-grid;
                place-items: center;
                box-sizing: border-box;
                width: 40px;
                height: 40px;
                padding: 0;
                margin: 0;
                border: none;
                border-radius: var(--md-sys-shape-corner-full);
                background: none;
                color: var(--md-sys-color-primary);
                overflow: visible;
            }

            :host([north]) button {
                color: var(--md-sys-color-on-surface-variant);
            }

            svg {
                width: 28px;
                height: 28px;
            }

            /*
             * The "N" inside the north triangle turns with the needle, so it always marks the map's north (the owner,
             * 2026-11-15). It takes the pill's own colour, so it is dark on a light triangle and light on a dark one.
             */
            .letter {
                fill: var(--md-sys-color-surface-container-high);
                font: 700 7px/1 var(--md-ref-typeface-plain, system-ui, sans-serif);
                text-anchor: middle;
                dominant-baseline: central;
            }

            /* The two halves are one triangle mirrored, with the same stroke, so they draw the same size (the owner, 2026-11-16). */
            .north,
            .south {
                stroke: currentcolor;
                stroke-width: 1.5;
                stroke-linejoin: round;
            }

            .south {
                fill: none;
            }

            .north {
                fill: currentcolor;
            }
        `,
    ];

    declare source: CameraSource | null;
    declare locale: ViewerLocale;
    declare camera: MapCamera;
    /** Reflected: the camera faces north and looks straight down (the quiet look; tests and styles read it). */
    declare north: boolean;

    #stop: Unsubscribe = () => undefined;

    constructor() {
        super();
        this.source = null;
        this.locale = DEFAULT_LOCALE;
        this.camera = NORTH;
        this.north = true;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        this.#watch();
    }

    override disconnectedCallback(): void {
        this.#stop();
        this.#stop = () => undefined;
        super.disconnectedCallback();
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('source') && this.isConnected) {
            this.#watch();
        }
        this.north = wholeDegrees(this.camera.bearing) === 0 && Math.round(this.camera.pitch) === 0;
    }

    #watch(): void {
        this.#stop();
        this.#stop =
            this.source?.watchCamera((camera) => {
                this.camera = camera;
            }) ?? (() => undefined);
    }

    override render(): TemplateResult {
        // The needle turns against the map (north stays on the map's north), flat at any tilt (the owner, 2026-11-15)
        const needle = { transform: `rotate(${String(-this.camera.bearing)}deg)` };
        return html`<button
                class="interactive touch-target"
                part="button"
                aria-label=${translate(this.locale, 'viewer.compass')}
                aria-describedby="heading"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" ${cssProperties(needle)}>
                    <path class="north" d="M12 1 L18.5 14 H5.5 Z"></path>
                    <path class="south" d="M12 23 L18.5 14 H5.5 Z"></path>
                    <text class="letter" x="12" y="9.8">N</text>
                </svg>
            </button>
            <span id="heading" class="visually-hidden">${compassDescription(this.locale, this.camera)}</span>`;
    }
}

export function defineHcmCompass(registry: CustomElementRegistry = customElements): void {
    defineOnce(registry, HCM_COMPASS_TAG, HcmCompass);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-compass': HcmCompass;
    }
}
