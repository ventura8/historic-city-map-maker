/**
 * M28 (`docs/research/M28-sources.md` §10): what the curated country lists share: the ready request letter, in the
 * institutions' language, with `{city}` filled in by the admin.
 */
import type { PlaceRequest } from './country-sources.js';

const ASK_COPIES =
    'Vă rog să-mi spuneți cum pot consulta aceste documente, ce acte trebuie să aduc și cum pot obține copii digitale (scanări) ale ' +
    'planurilor, cu tarifele aferente. Copiile vor fi folosite pe o hartă istorică online, necomercială, cu menționarea sursei.';

/** A letter asking how to see `ask`'s items and what their scans cost. */
export function letter(subject: string, ask: string): PlaceRequest {
    return {
        subject,
        body: `Bună ziua,\n\nRealizez o hartă istorică online a orașului {city}. ${ask}\n\n${ASK_COPIES}\n\nVă mulțumesc.`,
    };
}

/** What every such letter says, for the owner to read in their language. */
export const MEANING_PLANS = {
    ro:
        'Scrisoarea spune că faceți o hartă istorică online a orașului, numește planurile pe care le căutați și întreabă cum le puteți ' +
        'consulta și cât costă scanările.',
    en:
        'The letter says you are making an online historical map of the city, names the plans you look for, and asks how to see them ' +
        'and what scans cost.',
};
