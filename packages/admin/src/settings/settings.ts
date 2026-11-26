/**
 * The settings area (`docs/research/M2c-interfaces.md` §8.5; behaviours A19, A36, A39): `#/settings` lists the sections,
 * `#/settings/<section>` opens one (`area`, `texts`, `theme`, `categories`, `overlays`), each its own draft with its own
 * Save, previewed live on the page's map (and, for the theme, on the whole admin) and written by nothing else.
 * `#/settings/categories/<id>` opens a POI category's editor (`_new` for one not saved yet). Its state and intents are in
 * `./state.ts`, the store in `./settings-store.ts`.
 */
import type { AreaModule } from '../content/areas.js';
import { SettingsStore } from './settings-store.js';
import type { SettingsIntents, SettingsOptions, SettingsState } from './state.js';

/** The settings area's module (registered in `packages/admin/src/index.ts`, section settings), with its contrast check. */
export function settingsModule(options: SettingsOptions): AreaModule<SettingsState, SettingsIntents> {
    return { area: 'settings', create: (services) => new SettingsStore(services, { theme: services.theme, passes: options.passes }) };
}
