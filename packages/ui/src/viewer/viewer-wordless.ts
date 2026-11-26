/**
 * The one card the engine words itself (docs/ENGINE_API.md → Language): the engine bundles no catalogue, so when boot
 * failed before any language's texts could be fetched, not even Romanian's (a page opened from the disk, a blocked
 * folder), only these two lines can say so, each in its own language.
 */
import { hasCatalogue, type ViewerLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

/** What the choice reads of the render's view: a boot error, the state's status, the page's language. */
interface BootView {
    readonly bootError: unknown;
    readonly state: { readonly status: string } | null;
    readonly locale: ViewerLocale;
}

/** The status layer (`status`), or this card when boot failed and the page has no texts in its language. */
export function statusOrCard(view: BootView, status: () => TemplateResult): TemplateResult {
    const failed = view.bootError !== null || view.state?.status === 'error';
    return failed && !hasCatalogue(view.locale) ? catalogueDown() : status();
}

/** The card, in Romanian and English; its button reloads the page, the one retry every boot has. */
function catalogueDown(): TemplateResult {
    const reload = reloadOf(globalThis.location);
    return html`<div class="status">
        <div class="catalogue-down" role="alert">
            <p lang="ro">Harta nu s-a putut încărca.</p>
            <p lang="en">The map could not be loaded.</p>
            <hcm-button variant="tonal" icon="refresh" @click=${reload}
                ><span lang="ro">Reîncearcă</span> · <span lang="en">Retry</span></hcm-button
            >
        </div>
    </div>`;
}

/** The button's handler: reloads the given location (the page's; a test passes its own, as the page's cannot be spied on). */
export function reloadOf(location: Pick<Location, 'reload'>): () => void {
    return () => {
        location.reload();
    };
}
