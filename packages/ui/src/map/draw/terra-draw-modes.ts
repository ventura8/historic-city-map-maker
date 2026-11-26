/**
 * The Terra Draw modes the admin's map uses (docs/research/M2c-interfaces.md §4.4, DECISIONS-for-review.md §34g): `static`
 * shows the shapes (Terra Draw's render mode), the four shape modes own the features of their shape (their styles and
 * their checks; a new shape is drawn by clicks, `click-growth.ts`, while Terra Draw shows it), and `select` drags a
 * feature, a vertex or a midpoint (which inserts a vertex), each checked by the same `validation`; a vertex is removed from
 * the vertex list, or with a right click. The select mode keeps its selection when the map is clicked elsewhere (a click
 * then moves a selected point, the single-pointer way, WCAG 2.5.7) and leaves the keys to the editor's tools. Everything
 * is drawn in the edited item's colour: shapes as the viewer draws a POI category (a translucent fill, a solid outline),
 * vertices and midpoints as white-ringed dots large enough to grab. Style names are Terra Draw 1.37's.
 */
import { SELECT_MODE, STATIC_MODE } from './mode-names.js';
import type { TdModeOptions, TdStyles, TdValidation, TerraDrawModules } from './terra-draw-types.js';

const WHITE = '#ffffff';

/** A vertex handle's radius in CSS px: 10 px plus its 2 px ring is a 24 px target (WCAG 2.5.8 minimum). */
const HANDLE_RADIUS = 10;

/** What `select` lets the admin move, per shape mode; every move is checked by `validation` (the limits, §4.5). */
function selectFlags(validation: TdValidation): Readonly<Record<string, unknown>> {
    const editable = {
        feature: { validation, draggable: true, coordinates: { draggable: true, midpoints: { draggable: true }, deletable: true } },
    };
    return {
        point: { feature: { validation, draggable: true } },
        linestring: editable,
        polygon: editable,
        rectangle: { feature: { validation, draggable: true, coordinates: { draggable: true, resizable: 'opposite' } } },
    };
}

function handle(prefix: string, color: string): TdStyles {
    return {
        [`${prefix}Color`]: color,
        [`${prefix}Width`]: HANDLE_RADIUS,
        [`${prefix}OutlineColor`]: WHITE,
        [`${prefix}OutlineWidth`]: 2,
    };
}

/** The styles of each mode. */
interface DrawStyles {
    readonly static: TdStyles;
    readonly point: TdStyles;
    readonly linestring: TdStyles;
    readonly polygon: TdStyles;
    readonly rectangle: TdStyles;
    readonly select: TdStyles;
}

/** The styles of each mode, in `color`. */
function drawStyles(color: string): DrawStyles {
    const area = { fillColor: color, fillOpacity: 0.3, outlineColor: color, outlineWidth: 3 };
    return {
        static: {
            ...{ pointColor: color, pointWidth: HANDLE_RADIUS, lineStringColor: color, lineStringWidth: 4 },
            ...{ polygonFillColor: color, polygonFillOpacity: 0.3, polygonOutlineColor: color, polygonOutlineWidth: 3 },
        },
        point: handle('point', color),
        linestring: { lineStringColor: color, lineStringWidth: 4, ...handle('closingPoint', color) },
        polygon: { ...area, ...handle('closingPoint', color) },
        rectangle: area,
        select: { ...handle('selectionPoint', color), ...handle('midPoint', WHITE), ...handle('selectedPoint', color) },
    };
}

/** Each mode's name and its styles in `color` (`setModeStyles` when the edited item's colour changes). */
export function modeStyles(color: string): readonly (readonly [string, TdStyles])[] {
    const styles = drawStyles(color);
    return [
        [STATIC_MODE, styles.static],
        ['point', styles.point],
        ['linestring', styles.linestring],
        ['polygon', styles.polygon],
        ['rectangle', styles.rectangle],
        [SELECT_MODE, styles.select],
    ];
}

/** The mode instances for `new TerraDraw({modes})`; `validation` guards every shape mode and every move in `select`. */
export function drawModes(modules: TerraDrawModules, color: string, validation: TdValidation): unknown[] {
    const styles = drawStyles(color);
    const shape = (modeStyles: TdStyles): TdModeOptions => ({ styles: modeStyles, validation });
    return [
        new modules.TerraDrawRenderMode({ modeName: STATIC_MODE, styles: styles.static }),
        new modules.TerraDrawPointMode(shape(styles.point)),
        new modules.TerraDrawLineStringMode(shape(styles.linestring)),
        new modules.TerraDrawPolygonMode(shape(styles.polygon)),
        new modules.TerraDrawRectangleMode(shape(styles.rectangle)),
        new modules.TerraDrawSelectMode({
            ...{ modeName: SELECT_MODE, flags: selectFlags(validation), styles: styles.select },
            ...{ keyEvents: null, allowManualDeselection: false },
        }),
    ];
}
