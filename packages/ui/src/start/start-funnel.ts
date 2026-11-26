/**
 * The start page's funnel (M14; `trackFunnel` of `@hcm/shared/funnels`, `docs/ARCHITECTURE.md` → *Wizard funnels*): its
 * screens in order, the screens before the one on screen done, a failure on the screen it shows by its key, the done
 * screen complete. The page loads no analytics of its own (no Firebase, no Google script before the owner's project
 * exists), so its signals reach a hub only where a page that embeds it listens.
 */
import type { FunnelSnapshot } from '@hcm/shared/funnels';

const ORDER = ['intro', 'plan', 'work', 'provider', 'done'] as const;

/** What the funnel reads of the page's view (`StartPageView` of `hcm-start-page.ts`). */
interface StartFunnelView {
    readonly screen: 'closed' | (typeof ORDER)[number];
    readonly failure: { readonly key: string } | null;
    readonly notice: string | null;
}

/** The screen's failure, else the first screen's notice, by key. */
function failureOf(view: StartFunnelView): string | null {
    return view.failure?.key ?? view.notice;
}

/** Where the start stands; null while it is closed. */
export function startFunnel(view: StartFunnelView): FunnelSnapshot | null {
    const screen = view.screen;
    if (screen === 'closed') {
        return null;
    }
    const failure = failureOf(view);
    return {
        wizard: 'start',
        order: ORDER,
        step: screen,
        done: ORDER.slice(0, ORDER.indexOf(screen) + Number(screen === 'done')),
        errors: failure === null ? {} : { [screen]: failure },
        complete: screen === 'done',
    };
}
