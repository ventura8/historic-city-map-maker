/** Residual bands for the shared badges on both panes. */
import { badgeToneOf, type BadgeTone } from '@hcm/ui/admin/georef/marker-badge';

export function tonesOf(residuals: Readonly<Record<string, number>>, thresholdM: number): Readonly<Record<string, BadgeTone>> {
    const tones: Record<string, BadgeTone> = {};
    for (const [id, metres] of Object.entries(residuals)) {
        tones[id] = badgeToneOf(metres, thresholdM);
    }
    return tones;
}
