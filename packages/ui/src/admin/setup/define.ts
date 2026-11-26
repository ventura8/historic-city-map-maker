/**
 * Registers the Setup Assistant's elements (setup-ui, `docs/research/M2b-interfaces.md` §1.2): `<hcm-setup-page>` with
 * every card and body, and `<hcm-crashes-page>` with `<hcm-crash-groups>`. The admin's page registry loads them for the
 * routes `setup` and `crashes`; the viewer never does. Idempotent.
 */
import { HCM_CRASHES_PAGE_TAG, defineHcmCrashesPage } from './hcm-crashes-page.js';
import { HCM_SETUP_PAGE_TAG, defineHcmSetupPage } from './hcm-setup-page.js';

/** The page tags of the routes `setup` and `crashes` (the page registry's loaders name them). */
export const SETUP_PAGE_TAGS = { setup: HCM_SETUP_PAGE_TAG, crashes: HCM_CRASHES_PAGE_TAG } as const;

export function defineSetupElements(registry: CustomElementRegistry = customElements): void {
    defineHcmSetupPage(registry);
    defineHcmCrashesPage(registry);
}
