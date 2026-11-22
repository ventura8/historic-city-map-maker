/**
 * `<hcm-archive-join>`: **Join with…** on an archive map's page (finding of 2026-11-14, the owner's harti.zip maps;
 * `docs/research/M8-join-interfaces.md` §11). It lists the maps of the same year that could be parts of the same map (two halves,
 * a set's sheets), each with its button; one click starts the join (`imagery.join` with `versionIds`) and the card links it. Each
 * part keeps its own points; the join checks where they meet, and says so in plain words when they do not. Nothing shows for a map
 * that is no archive map, has no points of its own, is part of a join already, or has no other map of its year to join.
 */
import type { LayerVersionState, UiLocale } from '@hcm/shared';
import { LitElement, html, type PropertyValues, type TemplateResult } from 'lit';

import { editingStyles } from '../../editing/editing-styles.js';
import { contentText } from '../../shell/text.js';
import type { ArchiveJoinCandidatePort, ImageryIntentsPort, VersionViewPort } from '../imagery-port.js';
import { labelText } from '../imagery-text.js';

export const HCM_ARCHIVE_JOIN_TAG = 'hcm-archive-join';

/** The states a part may be joined in (the server's `isUsablePart` for an archive map). */
const JOINABLE: ReadonlySet<LayerVersionState> = new Set<LayerVersionState>(['published', 'approved', 'awaiting_approval']);

/**
 * The version is an archive map the join can take: usable, with its own points, held by no live join. `held` is the page's
 * own reading (the join named in `partOf` is still on its way); without it any `partOf` holds. A join that failed leaves its
 * stamp behind: its maps are offered again (live 2026-11-15, the 1974 and 1978 joins).
 */
export function archiveJoinOffered(version: VersionViewPort | null, held: boolean | null = null): version is VersionViewPort {
    return extendable(version) || (version?.archiveMap === true && usable(version) && !holds(version, held));
}

/**
 * A published join of archive maps (each part's entity is its own version id), offered **Add sheets to this join** (live 2026-11-22:
 * a 1990 sheet was missing from the 47 joined): a new join of its parts plus the one picked, on the same layer.
 */
export function extendable(version: VersionViewPort | null): boolean {
    return (
        version?.origin === 'join' &&
        version.state === 'published' &&
        version.parts.length > 0 &&
        version.parts.every((part) => part.entityId === part.versionId)
    );
}

/** Usable, with points of its own. */
function usable(version: VersionViewPort): boolean {
    return JOINABLE.has(version.state) && pointed(version);
}

/** A live join holds the version: the page's reading, else any `partOf`. */
function holds(version: VersionViewPort, held: boolean | null): boolean {
    return held ?? version.partOf !== null;
}

/** Points of its own, not a file's embedded georeference. */
function pointed(version: VersionViewPort): boolean {
    const method = version.georef?.method;
    return method !== undefined && method !== 'embedded';
}

export class HcmArchiveJoin extends LitElement {
    static override readonly properties = {
        locale: { attribute: false },
        intents: { attribute: false },
        version: { attribute: false },
        held: { attribute: false },
        hrefOf: { attribute: false },
        candidates: { state: true },
        busy: { state: true },
        started: { state: true },
    };

    static override readonly styles = editingStyles;

    declare locale: UiLocale;
    declare intents: ImageryIntentsPort | null;
    declare version: VersionViewPort | null;
    /** A live join holds the version (null: read from its `partOf`). */
    declare held: boolean | null;
    /** The page's link to a version (`#/imagery/version/<id>`). */
    declare hrefOf: (params: readonly string[]) => string;
    declare candidates: readonly ArchiveJoinCandidatePort[];
    declare busy: boolean;
    /** The join started here, linked. */
    declare started: string | null;
    #askedFor: string | null = null;

    constructor() {
        super();
        this.locale = 'ro';
        this.intents = null;
        this.version = null;
        this.held = null;
        this.hrefOf = (params) => `#/imagery/${params.join('/')}`;
        this.candidates = [];
        this.busy = false;
        this.started = null;
    }

    protected override willUpdate(changed: PropertyValues<this>): void {
        if (changed.has('version') || changed.has('intents') || changed.has('held')) {
            this.#ask();
        }
    }

    /** The candidates of the open version, asked once per version. */
    #ask(): void {
        const version = this.version;
        const key = archiveJoinOffered(version, this.held) ? version.id : null;
        if (key === this.#askedFor) {
            return;
        }
        this.#askedFor = key;
        this.candidates = [];
        this.started = null;
        if (key !== null && version !== null) {
            this.#load(key, version);
        }
    }

    #load(key: string, version: VersionViewPort): void {
        void this.intents?.archiveJoinCandidates({ id: version.id, layerId: version.layerId, year: version.year }).then((found) => {
            if (this.#askedFor === key) {
                this.candidates = found;
            }
        });
    }

    async #join(candidate: ArchiveJoinCandidatePort): Promise<void> {
        const version = this.version;
        if (version === null || this.intents === null) {
            return;
        }
        this.busy = true;
        const own = extendable(version) ? version.parts.map((part) => part.versionId) : [version.id];
        this.started = await this.intents.joinArchive([...own, candidate.id]);
        this.busy = false;
    }

    #t(key: Parameters<typeof contentText>[1], params?: Readonly<Record<string, string>>): string {
        return contentText(this.locale, key, params);
    }

    override render(): TemplateResult {
        const version = this.version;
        if (!archiveJoinOffered(version, this.held) || this.candidates.length === 0) {
            return html``;
        }
        const adding = extendable(version);
        return html`<section class="choices" data-archive-join=${adding ? 'add' : 'join'}>
            <h3>${this.#t(adding ? 'adminContent.imagery.join.addTitle' : 'adminContent.imagery.join.archiveTitle')}</h3>
            <p class="note">
                ${this.#t(adding ? 'adminContent.imagery.join.addIntro' : 'adminContent.imagery.join.archiveIntro', {
                    year: String(version.year),
                })}
            </p>
            ${this.started === null ? this.#buttons() : this.#startedLink(this.started)}
        </section>`;
    }

    #buttons(): TemplateResult {
        return html`<div class="actions">
            ${this.candidates.map(
                (candidate) =>
                    html`<hcm-button
                        variant="tonal"
                        icon="layers"
                        data-join-with=${candidate.id}
                        ?disabled=${this.busy}
                        @click=${() => void this.#join(candidate)}
                        >${this.#t(this.#withKey(), { map: labelText(candidate.label, this.locale) })}</hcm-button
                    >`,
            )}
        </div>`;
    }

    #withKey(): 'adminContent.imagery.join.addWith' | 'adminContent.imagery.join.archiveWith' {
        return extendable(this.version) ? 'adminContent.imagery.join.addWith' : 'adminContent.imagery.join.archiveWith';
    }

    #startedLink(joinId: string): TemplateResult {
        return html`<p role="status" data-state="archive-join-started">
            ${this.#t('adminContent.imagery.join.archiveStarted')}
            <a class="external" href=${this.hrefOf(['version', joinId])}>${this.#t('adminContent.imagery.join.archiveOpen')}</a>
        </p>`;
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-archive-join': HcmArchiveJoin;
    }
}
