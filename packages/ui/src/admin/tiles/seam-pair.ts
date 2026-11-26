/**
 * `<hcm-seam-pair>`: step 2 of the tile-import wizard (`docs/research/M20-import-local.md` §19.11; S-A-HAPPY-TILE-WIZARD-SEAM,
 * -SEAM-KEYS). One doubtful or missing seam at a time: the two strips side by side, cut from `seams.jpg`, with the pipeline's guess
 * drawn as a dot on each (a missing seam has none, and says so). The owner accepts the guess (Enter, the pair focused) or picks one
 * matching point on each strip: a click, or the strip focused, a cross moved with the arrows (Shift: farther) and Space or Enter.
 * The cross and each pick are said in a live region. N goes to the next seam.
 */
import type { UiLocale } from '@hcm/shared';
import { css, html, LitElement, type TemplateResult } from 'lit';

import { cssProperties } from '../../components/css-properties.js';
import { adminBase } from '../shell/admin-styles.js';
import { spriteProperties } from './tile-grid.js';
import { tilesText as t } from './tiles-text.js';
import { tileStyles } from './tiles-styles.js';
import type { TilePointPort, TileRectPort, TileSeamPort, TilesIntentsPort, TilesViewState } from './tiles-port.js';

const HCM_SEAM_PAIR_TAG = 'hcm-seam-pair';

type Side = 'a' | 'b';

/** The arrows' directions for the cross. */
const NUDGES: Readonly<Record<string, readonly [number, number]>> = {
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
};

/** The keys that pick the point under the cross. */
const PICK_KEYS: ReadonlySet<string> = new Set([' ', 'Enter']);

/** A step of the cross: this share of the strip's rectangle, `FAR_STEP` with Shift. */
const STEP = 0.02;
const FAR_STEP = 0.1;

function inside(value: number, from: number, size: number): number {
    return Math.min(Math.max(value, from), from + size);
}

/** The middle of a strip's rectangle, where the cross starts when nothing else is there. */
export function centreOf(sheet: TileRectPort): TilePointPort {
    return [Math.round(sheet[0] + sheet[2] / 2), Math.round(sheet[1] + sheet[3] / 2)];
}

/** The cross moved one step (`far`: a long one) in a direction, kept inside the strip's rectangle. */
export function nudged(point: TilePointPort, sheet: TileRectPort, [dx, dy]: readonly [number, number], far: boolean): TilePointPort {
    const step = far ? FAR_STEP : STEP;
    return [
        Math.round(inside(point[0] + dx * step * sheet[2], sheet[0], sheet[2])),
        Math.round(inside(point[1] + dy * step * sheet[3], sheet[1], sheet[3])),
    ];
}

/** A point of the sheet's rectangle as a share of the strip shown, in per cent. */
function placeOf(point: TilePointPort, sheet: TileRectPort): Readonly<Record<string, string>> {
    return {
        '--x': `${String(((point[0] - sheet[0]) / sheet[2]) * 100)}%`,
        '--y': `${String(((point[1] - sheet[1]) / sheet[3]) * 100)}%`,
    };
}

/** Where a click on a strip lands in the oriented sheet's pixels. */
function pointOf(event: MouseEvent, element: Element, sheet: TileRectPort): TilePointPort {
    const box = element.getBoundingClientRect();
    const across = (event.clientX - box.left) / Math.max(box.width, 1);
    const down = (event.clientY - box.top) / Math.max(box.height, 1);
    return [Math.round(sheet[0] + across * sheet[2]), Math.round(sheet[1] + down * sheet[3])];
}

/** Enter accepts the guess, N goes to the next seam (no modifier). */
function keyAction(event: KeyboardEvent): 'acceptSeam' | 'nextSeam' | undefined {
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return undefined;
    }
    const keys: Readonly<Record<string, 'acceptSeam' | 'nextSeam'>> = { Enter: 'acceptSeam', n: 'nextSeam', N: 'nextSeam' };
    return keys[event.key];
}

/** A strip's piece of the sprite as CSS properties. */
function stripProperties(rect: TileRectPort, sprite: TilesViewState['seamsSprite']): Readonly<Record<string, string>> {
    const [sx, sy, sw, sh] = rect;
    const whole = spriteProperties(sprite);
    return {
        ...{ '--sx': String(sx), '--sy': String(sy), '--sw': String(sw), '--sh': String(sh) },
        ...{ '--spw': whole['--sw'], '--sph': whole['--sh'], '--img': whole['--img'] },
    };
}

/** A dot at a point of the strip (none: nothing). */
function dot(point: TilePointPort | null, sheet: TileRectPort, classes: string): TemplateResult | string {
    return point === null ? '' : html`<span class=${classes} ${cssProperties(placeOf(point, sheet))}></span>`;
}

/** A missing seam's note that the app has no guess (a seam with a guess: nothing). */
function noGuessNote(locale: UiLocale, seam: TileSeamPort): TemplateResult | string {
    return seam.suggestion === null ? html`<p class="note">${t(locale, 'adminTiles.noGuess')}</p>` : '';
}

/** What a strip's keys work on: its side and name, its rectangle, and where the cross starts. */
interface StripKeys {
    readonly side: Side;
    readonly name: string;
    readonly sheet: TileRectPort;
    readonly start: TilePointPort | null;
}

class HcmSeamPair extends LitElement {
    static override readonly properties = {
        view: { attribute: false },
        intents: { attribute: false },
        locale: { type: String },
        cross: { state: true },
        said: { state: true },
    };

    static override readonly styles = [
        adminBase,
        tileStyles,
        css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 12px;
            }

            .pair {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
            }

            figure {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin: 0;
            }

            .strip {
                position: relative;
                inline-size: calc(var(--sw) * var(--hcm-seam-side) / 256);
                block-size: calc(var(--sh) * var(--hcm-seam-side) / 256);
                background-image: var(--img);
                background-repeat: no-repeat;
                background-size: calc(var(--spw) * var(--hcm-seam-side) / 256) calc(var(--sph) * var(--hcm-seam-side) / 256);
                background-position: calc(var(--sx) * var(--hcm-seam-side) / -256) calc(var(--sy) * var(--hcm-seam-side) / -256);
                background-color: var(--md-sys-color-surface-container-highest, GrayText);
                cursor: crosshair;
            }

            .dot {
                position: absolute;
                inset-inline-start: var(--x);
                inset-block-start: var(--y);
                inline-size: 12px;
                block-size: 12px;
                margin: -6px;
                border: 2px solid var(--md-sys-color-on-primary, Canvas);
                border-radius: 50%;
                background: var(--md-sys-color-primary, Highlight);
                pointer-events: none;
            }

            .dot.guess {
                background: var(--md-sys-color-tertiary, Mark);
            }

            .dot.cross {
                border-radius: 0;
                background: transparent;
                border-color: var(--md-sys-color-secondary, Highlight);
            }

            .strip:focus-visible {
                outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
                outline-offset: 2px;
            }

            .pair:focus-visible {
                outline: var(--md-sys-state-focus-indicator-thickness, 3px) solid var(--md-sys-color-secondary, Highlight);
                outline-offset: 2px;
            }

            .actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
            }
        `,
    ];

    declare view: TilesViewState | null;
    declare intents: TilesIntentsPort | null;
    declare locale: UiLocale;
    /** The keyboard's cross on each strip (null: not moved yet). */
    declare cross: { readonly a: TilePointPort | null; readonly b: TilePointPort | null };
    /** The live region's text: where the cross is, or the point picked. */
    declare said: string;
    /** The seam the cross belongs to; another seam starts it again. */
    #crossFor = '';

    constructor() {
        super();
        this.view = null;
        this.intents = null;
        this.locale = 'ro';
        this.cross = { a: null, b: null };
        this.said = '';
    }

    override willUpdate(): void {
        const seam = this.view?.seams[this.view.seam];
        const key = seam === undefined ? '' : [this.view?.seam, seam.a, seam.b].join(':');
        if (key !== this.#crossFor) {
            this.#crossFor = key;
            this.cross = { a: null, b: null };
            this.said = '';
        }
    }

    override render(): TemplateResult {
        const view = this.view;
        const seam = view?.seams[view.seam];
        if (view === null || seam === undefined) {
            return html`<p class="note" role="status">${t(this.locale, 'adminTiles.noSeams')}</p>`;
        }
        const of = { n: String(view.seam + 1), total: String(view.seams.length), a: seam.nameA, b: seam.nameB };
        return html`<h3>${t(this.locale, 'adminTiles.seamOf', of)}</h3>
            <p class="note" id="seam-help">${t(this.locale, 'adminTiles.seamHelp')} ${t(this.locale, 'adminTiles.seamKeys')}</p>
            ${noGuessNote(this.locale, seam)}
            <div class="pair" role="group" tabindex="0" aria-label=${t(this.locale, 'adminTiles.seamsLabel')} @keydown=${this.#key}>
                ${this.#strip(view, seam, 'a')} ${this.#strip(view, seam, 'b')}
            </div>
            <p class="note" role="status">${seam.answered ? t(this.locale, 'adminTiles.seamAnswered') : ''}</p>
            <p class="note" role="status">${this.said}</p>
            <div class="actions">
                <hcm-button variant="tonal" icon="check" ?disabled=${seam.suggestion === null} @click=${() => this.intents?.acceptSeam()}
                    >${t(this.locale, 'adminTiles.acceptSeam')}</hcm-button
                >
                <hcm-button variant="outlined" icon="chevron_right" @click=${() => this.intents?.nextSeam()}
                    >${t(this.locale, 'adminTiles.nextSeam')}</hcm-button
                >
            </div>`;
    }

    #strip(view: TilesViewState, seam: TileSeamPort, side: Side): TemplateResult {
        const strip = seam.strips === null ? undefined : seam.strips[side];
        if (strip === undefined) {
            return html``;
        }
        const name = side === 'a' ? seam.nameA : seam.nameB;
        const guess = seam.suggestion === null ? null : seam.suggestion[side];
        return html`<figure>
            <div
                class="strip"
                role="application"
                tabindex="0"
                aria-label=${t(this.locale, 'adminTiles.strip', { name })}
                aria-describedby="seam-help"
                data-side=${side}
                ${cssProperties(stripProperties(strip.sprite, view.seamsSprite))}
                @click=${(event: MouseEvent) => {
                    this.intents?.pick(side, pointOf(event, event.currentTarget as Element, strip.sheet));
                }}
                @keydown=${(event: KeyboardEvent) => {
                    this.#stripKey(event, { side, name, sheet: strip.sheet, start: this.cross[side] ?? seam.picked[side] ?? guess });
                }}
            >
                ${dot(guess, strip.sheet, 'dot guess')} ${dot(seam.picked[side], strip.sheet, 'dot')}
                ${dot(this.cross[side], strip.sheet, 'dot cross')}
            </div>
            <figcaption class="note">${name}</figcaption>
        </figure>`;
    }

    /** On a focused strip: the arrows move the cross, Space or Enter picks the point under it (the pair's keys stay out). */
    #stripKey(event: KeyboardEvent, on: StripKeys): void {
        const nudge = NUDGES[event.key];
        if (nudge === undefined && !PICK_KEYS.has(event.key)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        const at = on.start ?? centreOf(on.sheet);
        if (nudge === undefined) {
            this.#pickAt(on, at);
            return;
        }
        const cross = nudged(at, on.sheet, nudge, event.shiftKey);
        this.cross = { ...this.cross, [on.side]: cross };
        this.said = t(this.locale, 'adminTiles.cursorAt', { name: on.name, x: String(cross[0]), y: String(cross[1]) });
    }

    #pickAt(on: StripKeys, at: TilePointPort): void {
        this.said = t(this.locale, 'adminTiles.pointPicked', { name: on.name, x: String(at[0]), y: String(at[1]) });
        this.intents?.pick(on.side, at);
    }

    #key = (event: KeyboardEvent): void => {
        const action = keyAction(event);
        if (action !== undefined) {
            event.preventDefault();
            this.intents?.[action]();
        }
    };
}

export function defineHcmSeamPair(registry: CustomElementRegistry = customElements): void {
    if (registry.get(HCM_SEAM_PAIR_TAG) === undefined) {
        registry.define(HCM_SEAM_PAIR_TAG, HcmSeamPair);
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-seam-pair': HcmSeamPair;
    }
}
