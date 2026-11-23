/** A bearing in whole degrees, `[0, 360)`: the shot direction's dial and its typed degrees (V93). */
export function wholeBearing(value: number): number {
    return ((Math.round(value) % 360) + 360) % 360;
}
