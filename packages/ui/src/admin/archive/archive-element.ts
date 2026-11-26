/**
 * What M20's two elements share (`docs/research/M20-import-local.md` §8): the feed they follow while connected (asked of the
 * Imagery area's store through the app: `ArchiveHostPort`), their texts (`translateAdminArchive`, a catalogue of the `archive`
 * chunk only), sizes and numbers in the page's language, and their styles.
 */
import { DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { translateAdminArchive, type AdminArchiveKey } from '@hcm/shared/admin-archive';
import { css, LitElement, type PropertyValues } from 'lit';

import { editingStyles } from '../editing/editing-styles.js';
import type { ArchiveFeedPort, ArchiveHostPort, ArchiveViewPort } from './archive-port.js';

type Params = Readonly<Record<string, string>>;

export function archiveText(locale: UiLocale, key: AdminArchiveKey, params?: Params): string {
    return translateAdminArchive(locale, key, params);
}

/** A whole number in the page's language (`12,345`, `12.345`). */
export function count(locale: UiLocale, value: number): string {
    return new Intl.NumberFormat(locale).format(Math.round(value));
}

const UNITS = [
    [1e9, 'gigabyte'],
    [1e6, 'megabyte'],
    [1e3, 'kilobyte'],
] as const;

/** Bytes as the page writes them: `1.2 GB`, `340 MB`, `12 kB`, `512 byte`. */
export function sizeText(locale: UiLocale, bytes: number): string {
    const [scale, unit] = UNITS.find(([each]) => bytes >= each) ?? [1, 'byte'];
    return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(bytes / scale);
}

const archiveStyles = [
    ...editingStyles,
    css`
        /* Choose a folder or zip: a link drawn as a filled button (the worker's page opens in a new tab). */
        .link-button {
            display: inline-flex;
            gap: 8px;
            align-items: center;
            box-sizing: border-box;
            min-block-size: 48px;
            padding-inline: 24px;
            border-radius: var(--md-sys-shape-corner-full);
            background: var(--md-sys-color-primary);
            color: var(--md-sys-color-on-primary);
            font-family: var(--md-sys-typescale-label-large-font);
            font-size: var(--md-sys-typescale-label-large-size);
            font-weight: var(--md-sys-typescale-label-large-weight);
            text-decoration: none;

            --hcm-icon-size: 18px;
        }

        .link-button:focus-visible {
            outline: 3px solid var(--md-sys-color-secondary);
            outline-offset: 2px;
        }

        section {
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-wrap: anywhere;
        }

        .series {
            display: flex;
            flex-direction: column;
            gap: 12px;
            padding: 16px;
            border: 1px solid var(--md-sys-color-outline-variant, CanvasText);
            border-radius: var(--md-sys-shape-corner-large, 16px);
        }

        .series[data-skip] {
            color: var(--md-sys-color-on-surface-variant, CanvasText);
        }

        .switch-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
        }
    `,
];

type ImageryIntents = NonNullable<ArchiveHostPort['content']['imagery']>['intents'];

/** The Imagery area's intents, or null (no app, or an area without them). */
function intentsOf(app: ArchiveHostPort | null): ImageryIntents | null {
    return app?.content.imagery?.intents ?? null;
}

/** The Imagery area's store hands out a feed (null: a store without it, or a chunk that did not load). */
async function feedOf(app: ArchiveHostPort | null): Promise<ArchiveFeedPort | null> {
    const intents = intentsOf(app);
    if (intents?.archive === undefined) {
        return null;
    }
    try {
        return await intents.archive();
    } catch {
        return null;
    }
}

export abstract class ArchiveElement extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        locale: { type: String },
        view: { state: true },
    };

    static override readonly styles = archiveStyles;

    declare app: ArchiveHostPort | null;
    declare locale: UiLocale;
    /** The feed's state, or null before it answers. */
    declare view: ArchiveViewPort | null;
    protected feed: ArchiveFeedPort | null = null;
    #unsubscribe: (() => void) | null = null;
    /** Each attach's number: an older one that settles late starts nothing. */
    #attempt = 0;

    constructor() {
        super();
        this.app = null;
        this.locale = DEFAULT_LOCALE;
        this.view = null;
    }

    override connectedCallback(): void {
        super.connectedCallback();
        if (this.hasUpdated) {
            void this.attach();
        }
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        this.detach();
    }

    protected override willUpdate(changed: PropertyValues): void {
        if (changed.has('app')) {
            void this.attach();
        }
    }

    protected t(key: AdminArchiveKey, params?: Params): string {
        return archiveText(this.locale, key, params);
    }

    /** The feed just attached, in `this.feed` (the report opens its archive). */
    protected attached(): void {
        // Nothing by default.
    }

    protected async attach(): Promise<void> {
        this.detach();
        const attempt = this.#attempt;
        const feed = await feedOf(this.app);
        if (feed === null || attempt !== this.#attempt) {
            return;
        }
        feed.start();
        this.feed = feed;
        this.attached();
        this.view = feed.state;
        this.#unsubscribe = feed.subscribe((state) => {
            this.view = state;
        });
    }

    protected detach(): void {
        this.#attempt += 1;
        this.#unsubscribe?.();
        this.feed?.stop();
        this.#unsubscribe = null;
        this.feed = null;
    }
}
