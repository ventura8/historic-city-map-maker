/**
 * M28 (`docs/research/M28-sources.md` §5, §10–§11): the Platform and Sources cards with their catalogue
 * (`@hcm/shared/admin-sources`, several hundred texts in two languages) as a chunk of their own (`sources-cards`), so what
 * the admin loads before it shows stays within its budget; the setup page fetches it as it is defined, and the two
 * elements upgrade when it is in.
 */
import { defineHcmSetupPlatform } from './hcm-setup-platform.js';
import { defineHcmSetupSources } from './hcm-setup-sources.js';

/** Registers `<hcm-setup-platform>` and `<hcm-setup-sources>` (again, a no-op). */
export function defineSourcesCards(registry: CustomElementRegistry): void {
    defineHcmSetupPlatform(registry);
    defineHcmSetupSources(registry);
}
