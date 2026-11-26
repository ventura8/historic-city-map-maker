/**
 * Shared georeferencer pair badges (owner, 2026-11-11): scan and map paint the same discs — number inside at every zoom,
 * hollow checkpoints, selected ring, dashed suggestions, half-pair and keyboard crosses. Theme colours; residual bands.
 */
export interface BadgePoint {
    readonly x: number;
    readonly y: number;
}

export interface BadgeMarker {
    readonly id: string;
    readonly label: string;
    readonly enabled: boolean;
    readonly tone?: BadgeTone;
}

export type BadgeTone = 'plain' | 'ok' | 'warn' | 'bad';

export interface BadgePalette {
    readonly marker: string;
    readonly onMarker: string;
    readonly outline: string;
    readonly warn: string;
    readonly bad: string;
}

export const BADGE_RADIUS = 11;
/** A pair answers a pointer this close to its badge (CSS px: a 48 px target), on the scan and on the map alike. */
export const PAIR_HIT_RADIUS = 24;
export const BADGE_SELECTED_RADIUS = 15;
const CROSS = 12;
const DASH: number[] = [4, 3];

/** Residual band against the city's RMSE threshold (M3 §10.4). */
export function badgeToneOf(residualM: number | undefined, thresholdM: number): BadgeTone {
    if (residualM === undefined || thresholdM <= 0) {
        return 'plain';
    }
    if (residualM <= thresholdM * 0.5) {
        return 'ok';
    }
    if (residualM <= thresholdM) {
        return 'warn';
    }
    return 'bad';
}

/** Selected ring + palette for a badge paint. */
export interface BadgeLook {
    readonly selected: boolean;
    readonly palette: BadgePalette;
}

/** Theme tokens from the scan canvas or map host. */
export function badgePaletteOf(el: Element): BadgePalette {
    const style = getComputedStyle(el);
    const t = (name: string, fallback: string): string => style.getPropertyValue(name).trim() || fallback;
    return {
        marker: t('--md-sys-color-tertiary', '#7d5260'),
        onMarker: t('--md-sys-color-on-tertiary', '#fff'),
        outline: t('--md-sys-color-on-surface', '#1d1b20'),
        warn: t('--md-sys-color-secondary', '#625b71'),
        bad: t('--md-sys-color-error', '#b3261e'),
    };
}

function fillOf(item: BadgeMarker, palette: BadgePalette): string {
    const tone = item.tone ?? 'plain';
    if (tone === 'warn') {
        return palette.warn;
    }
    if (tone === 'bad') {
        return palette.bad;
    }
    return palette.marker;
}

function disc(context: CanvasRenderingContext2D, at: BadgePoint, selected: boolean): void {
    context.beginPath();
    context.arc(at.x, at.y, selected ? BADGE_SELECTED_RADIUS : BADGE_RADIUS, 0, Math.PI * 2);
    context.lineWidth = selected ? 3 : 2;
}

function label(context: CanvasRenderingContext2D, at: BadgePoint, text: string, px: number): void {
    context.font = `600 ${String(px)}px sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(text, at.x, at.y);
}

/** Pair badge: filled when used for the fit, hollow as a checkpoint; selected grows. */
export function paintPairBadge(context: CanvasRenderingContext2D, at: BadgePoint, item: BadgeMarker, look: BadgeLook): void {
    const { selected, palette } = look;
    const fill = fillOf(item, palette);
    disc(context, at, selected);
    if (item.enabled) {
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = palette.onMarker;
        context.stroke();
        context.fillStyle = palette.onMarker;
    } else {
        context.fillStyle = 'transparent';
        context.fill();
        context.strokeStyle = fill;
        context.stroke();
        context.fillStyle = palette.outline;
    }
    label(context, at, item.label, 12);
}

/** Suggestion: dashed ring with its label (`a1`). */
export function paintSuggestionBadge(context: CanvasRenderingContext2D, at: BadgePoint, item: BadgeMarker, look: BadgeLook): void {
    const { selected, palette } = look;
    disc(context, at, selected);
    context.setLineDash(DASH);
    context.strokeStyle = palette.outline;
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = palette.outline;
    label(context, at, item.label, 11);
}

/** The ghost (2026-11-12): where the pairs so far expect the pending pair's other end, a dashed double ring with a dot, never a target. */
export function paintGhostBadge(context: CanvasRenderingContext2D, at: BadgePoint, palette: BadgePalette): void {
    context.setLineDash(DASH);
    context.lineWidth = 2;
    for (const [radius, colour] of [
        [BADGE_SELECTED_RADIUS, palette.marker],
        [BADGE_SELECTED_RADIUS + 2, palette.onMarker],
    ] as const) {
        context.beginPath();
        context.arc(at.x, at.y, radius, 0, Math.PI * 2);
        context.strokeStyle = colour;
        context.stroke();
    }
    context.setLineDash([]);
    context.beginPath();
    context.arc(at.x, at.y, 2, 0, Math.PI * 2);
    context.fillStyle = palette.marker;
    context.fill();
}

/** Half-pair or keyboard crosshair. */
export function paintBadgeCross(context: CanvasRenderingContext2D, at: BadgePoint, colour: string): void {
    context.beginPath();
    context.moveTo(at.x - CROSS, at.y);
    context.lineTo(at.x + CROSS, at.y);
    context.moveTo(at.x, at.y - CROSS);
    context.lineTo(at.x, at.y + CROSS);
    context.lineWidth = 2;
    context.strokeStyle = colour;
    context.stroke();
}
