/** The Contribute page as it reads its store (M13, `docs/research/M13-roles.md` §§3, 4), mirroring `packages/admin/src/contribute/`. */
import type { ContributeContextResponse, RequestableRole, SuggestionProposal } from '@hcm/shared';

import type { MapStatusPort } from '../pois/pois-port.js';
import type { AdminNoticeInputPort, AdminOutcomePort } from '../notice-port.js';

export interface ContributeViewState {
    readonly status: 'loading' | 'ready' | 'error';
    readonly context: ContributeContextResponse | null;
    readonly failure: AdminNoticeInputPort | null;
    readonly busy: boolean;
    /** The problem of the last send, shown beside the button. */
    readonly problem: AdminNoticeInputPort | null;
    /** A suggestion went through: how many more today. */
    readonly thanks: { readonly remaining: number } | null;
    readonly proposal: SuggestionProposal;
    readonly map: MapStatusPort | 'unavailable';
    readonly picking: boolean;
}

interface ContributeSuggestion {
    readonly reason?: string | undefined;
    readonly sourceUrl?: string | undefined;
    readonly credit?: string | undefined;
}

export interface ContributeIntentsPort {
    retry(): void;
    request(role: RequestableRole, reason: string, credit: string): Promise<AdminOutcomePort<{ readonly status: 'pending' }>>;
    attachMap(container: HTMLElement): void;
    zoomBy(delta: number): void;
    edit(patch: SuggestionProposal): void;
    /** The pin goes to the map's centre: the keyboard's way to place it. */
    placeAtCentre(): void;
    /** The next click on the map says what the camera looked at. */
    pickDirection(): Promise<void>;
    cancelPick(): void;
    suggest(words: ContributeSuggestion): Promise<AdminOutcomePort<{ readonly remainingToday: number }>>;
}
