/**
 * Settings → Browser tab icon (`docs/research/M2-interfaces.md` → *The city's tab icon*; S-A101-*): an editor uploads
 * a PNG or a WebP as the public map's tab icon, or goes back to the default (the Layers panel's map glyph in the city's
 * colour), through `cities.setIcon`. The card reads the city's `icon` record from the city document Settings follows.
 * The card tells what the browser can before sending (the type, from the file's first bytes, and the size: `refuseIcon`);
 * the server checks everything again, the shape included, and its refusal shows beside the card. Nothing changes on a refusal.
 */
import type { CallableRequest } from '@hcm/shared';

import { outcomeOf } from '../app/services.js';
import type { ContentServices } from '../content/services.js';
import type { NoticeInput } from '../state/state.js';

export interface IconSectionState {
    /** An upload or a reset is on its way. */
    readonly busy: boolean;
    /** Why the icon did not change (the browser's check, or the server's refusal). */
    readonly error: NoticeInput | null;
}

export const NO_ICON_SECTION: IconSectionState = { busy: false, error: null };

/** What the card asks for: the chosen file as base64, or the default; the store adds the city. */
type IconChange = { readonly kind: 'upload'; readonly image: string } | { readonly kind: 'reset' };

export interface IconIntents {
    /**
     * Sends the chosen file (the card's base64 of it, once the browser found it a PNG or WebP within 1 MB), or asks for the
     * default (**Use the default icon**); true once it is the city's icon.
     */
    setIcon(change: IconChange): Promise<boolean>;
    /** The browser refused the chosen file (`packages/ui/src/admin/settings/icon-upload.ts`): its reason shows, nothing is sent. */
    refuseIcon(problem: NoticeInput): void;
}

/**
 * The card's intents; `set` receives each state (the store keeps it, and sets `NO_ICON_SECTION` when the section is
 * left, which forgets a refusal). A function, not a class: the settings chunk is at its budget (DECISIONS §166i).
 */
export function iconIntents(services: ContentServices, set: (state: IconSectionState) => void): IconIntents {
    return {
        setIcon: async (change) => {
            set({ busy: true, error: null });
            const request: CallableRequest<'cities.setIcon'> = { ...change, cityId: services.cityId };
            const outcome = await outcomeOf(() => services.callables.call('cities.setIcon', request));
            set({ busy: false, error: outcome.ok ? null : outcome.error });
            if (outcome.ok) {
                services.notify({ key: 'adminContent.settings.icon.saved' });
            }
            return outcome.ok;
        },
        refuseIcon: (error) => {
            set({ busy: false, error });
        },
    };
}
