import { ar } from './ar.js';
import { bg } from './bg.js';
import { bn } from './bn.js';
import { de } from './de.js';
import { el } from './el.js';
import { en } from './en.js';
import { es } from './es.js';
import { fa } from './fa.js';
import { fr } from './fr.js';
import { hi } from './hi.js';
import { hu } from './hu.js';
import { id } from './id.js';
import { it } from './it.js';
import { ja } from './ja.js';
import { ko } from './ko.js';
import { nl } from './nl.js';
import { pl } from './pl.js';
import { pt } from './pt.js';
import { ro } from './ro.js';
import { ru } from './ru.js';
import { tr } from './tr.js';
import { uk } from './uk.js';
import { ur } from './ur.js';
import { vi } from './vi.js';
import { zh } from './zh.js';
import type { ViewerLocale } from './index.js';
import { ar as arLabels } from './map-labels/ar.js';
import { bg as bgLabels } from './map-labels/bg.js';
import { bn as bnLabels } from './map-labels/bn.js';
import { de as deLabels } from './map-labels/de.js';
import { el as elLabels } from './map-labels/el.js';
import { en as enLabels } from './map-labels/en.js';
import { es as esLabels } from './map-labels/es.js';
import { fa as faLabels } from './map-labels/fa.js';
import { fr as frLabels } from './map-labels/fr.js';
import { hi as hiLabels } from './map-labels/hi.js';
import { hu as huLabels } from './map-labels/hu.js';
import { id as idLabels } from './map-labels/id.js';
import { it as itLabels } from './map-labels/it.js';
import { ja as jaLabels } from './map-labels/ja.js';
import { ko as koLabels } from './map-labels/ko.js';
import { nl as nlLabels } from './map-labels/nl.js';
import { pl as plLabels } from './map-labels/pl.js';
import { pt as ptLabels } from './map-labels/pt.js';
import { ro as roLabels } from './map-labels/ro.js';
import { ru as ruLabels } from './map-labels/ru.js';
import { tr as trLabels } from './map-labels/tr.js';
import { uk as ukLabels } from './map-labels/uk.js';
import { ur as urLabels } from './map-labels/ur.js';
import { vi as viLabels } from './map-labels/vi.js';
import { zh as zhLabels } from './map-labels/zh.js';

/**
 * Every viewer language's texts (the nine newest partial while they are translated: a key not here shows in English), the main catalogue and the map labels' family in one object: what the engine's build
 * writes to `i18n/<locale>.json` (`scripts/site/src/i18n-catalogues.ts`) and what the tests register. Never imported by
 * the engine itself, which fetches each language when it is first shown (docs/ENGINE_API.md → Language).
 */
export const VIEWER_CATALOGUES: Readonly<Record<ViewerLocale, Readonly<Record<string, string>>>> = {
    ro: { ...ro, ...roLabels },
    en: { ...en, ...enLabels },
    es: { ...es, ...esLabels },
    fr: { ...fr, ...frLabels },
    de: { ...de, ...deLabels },
    it: { ...it, ...itLabels },
    pt: { ...pt, ...ptLabels },
    ru: { ...ru, ...ruLabels },
    uk: { ...uk, ...ukLabels },
    pl: { ...pl, ...plLabels },
    tr: { ...tr, ...trLabels },
    ar: { ...ar, ...arLabels },
    hi: { ...hi, ...hiLabels },
    zh: { ...zh, ...zhLabels },
    ja: { ...ja, ...jaLabels },
    ko: { ...ko, ...koLabels },
    nl: { ...nl, ...nlLabels },
    hu: { ...hu, ...huLabels },
    id: { ...id, ...idLabels },
    vi: { ...vi, ...viLabels },
    bn: { ...bn, ...bnLabels },
    bg: { ...bg, ...bgLabels },
    el: { ...el, ...elLabels },
    fa: { ...fa, ...faLabels },
    ur: { ...ur, ...urLabels },
};
