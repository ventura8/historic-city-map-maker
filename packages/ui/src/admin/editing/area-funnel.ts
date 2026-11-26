/**
 * A wizard area page's funnels (§200), called from its `updated`: each snapshot of the view compared with the page's last
 * one (`trackFunnel`). In the admin's `funnels` chunk with the wizards' snapshots, out of `editor-shared`.
 */
import { trackFunnel, type FunnelSnapshot } from '@hcm/shared/funnels';

export function trackAreaFunnels<State>(
    target: EventTarget,
    view: State | null,
    funnels: (view: State) => readonly (FunnelSnapshot | null)[],
): void {
    if (view !== null) {
        for (const snapshot of funnels(view)) {
            trackFunnel(target, snapshot);
        }
    }
}
