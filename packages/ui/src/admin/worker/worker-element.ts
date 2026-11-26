/**
 * What M7's two elements share (`docs/research/M7-local-worker.md` §4.4, §7): the feed they follow while connected (asked
 * of the Jobs area's store through the app: `WorkerHostPort`), their texts (`translateAdminWorker`, a catalogue of the
 * `worker` chunk only), the numbers in the page's language, a refusal's live region and Cloud Run's free-tier meter.
 */
import { CLOUD_RUN_FREE_TIER, DEFAULT_LOCALE, type UiLocale } from '@hcm/shared';
import { translateAdminWorker, type AdminWorkerKey } from '@hcm/shared/admin-worker';
import { css, html, LitElement, type PropertyValues, type TemplateResult } from 'lit';

import { editingStyles } from '../editing/editing-styles.js';
import { EMPTY } from '../shell/empty.js';
import { noticeOf } from '../shell/text.js';
import type { CloudRunUsePort, WorkerFeedPort, WorkerHostPort, WorkerViewPort } from './worker-port.js';

type Params = Readonly<Record<string, string>>;

function workerText(locale: UiLocale, key: AdminWorkerKey, params?: Params): string {
    return translateAdminWorker(locale, key, params);
}

/** A whole number in the page's language (`12,345`, `12.345`). */
export function count(locale: UiLocale, value: number): string {
    return new Intl.NumberFormat(locale).format(Math.round(value));
}

/** "Cloud Run this month (estimate)": the month's use of each figure of the free tier, and a bar for the larger share. */
export function meter(locale: UiLocale, usage: CloudRunUsePort): TemplateResult {
    const free = CLOUD_RUN_FREE_TIER;
    const share = Math.max(usage.vcpuSeconds / free.vcpuSeconds, usage.gibSeconds / free.gibSeconds);
    const use = {
        ...{ vcpu: count(locale, usage.vcpuSeconds), vcpuFree: count(locale, free.vcpuSeconds) },
        ...{ gib: count(locale, usage.gibSeconds), gibFree: count(locale, free.gibSeconds) },
    };
    return html`<div class="meter" data-meter>
        <p>${workerText(locale, 'adminWorker.meter')}</p>
        <hcm-progress
            .value=${share}
            .label=${workerText(locale, 'adminWorker.meterShare', { percent: String(Math.round(share * 100)) })}
        ></hcm-progress>
        <p class="note">${workerText(locale, 'adminWorker.meterUse', use)}</p>
    </div>`;
}

export const workerStyles = [
    ...editingStyles,
    css`
        section {
            display: flex;
            flex-direction: column;
            gap: 12px;
            overflow-wrap: anywhere;
        }

        /* Batch 4 (the owner, 2026-11-09): a choice's label wraps between words, never inside one ("compute r"). */
        hcm-segmented-button {
            overflow-wrap: normal;
        }

        .title {
            font-size: var(--md-sys-typescale-title-medium-size, 1rem);
            line-height: var(--md-sys-typescale-title-medium-line-height, 1.5rem);
            font-weight: var(--md-sys-typescale-title-medium-weight, 500);
        }

        /* Empty, the computer's live region stays in the page but takes no line of the panel's rhythm. */
        p[data-local]:empty {
            position: absolute;
        }

        .meter {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }
    `,
];

/** The Jobs area's chunk, then a feed from its store (null: a store without feeds). */
async function askFeed(app: WorkerHostPort): Promise<WorkerFeedPort | null> {
    await app.loadPage('jobs');
    return (await app.content.jobs?.intents.worker?.()) ?? null;
}

export abstract class WorkerElement extends LitElement {
    static override readonly properties = {
        app: { attribute: false },
        locale: { type: String },
        view: { state: true },
    };

    declare app: WorkerHostPort | null;
    declare locale: UiLocale;
    /** The feed's state, or null before it answers. */
    declare view: WorkerViewPort | null;
    protected feed: WorkerFeedPort | null = null;
    #unsubscribe: (() => void) | null = null;
    /** Each attach's number: an older one that settles late starts nothing. */
    #attempt = 0;

    constructor() {
        super();
        this.app = null;
        this.locale = DEFAULT_LOCALE;
        this.view = null;
    }

    /** The version's job the element follows (null: none). */
    protected abstract readonly jobId: string | null;

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
        if (changed.has('app') || changed.has('job')) {
            void this.attach();
        }
    }

    protected t(key: AdminWorkerKey, params?: Params): string {
        return workerText(this.locale, key, params);
    }

    /** The last change's refusal, in a region that exists before it fills. */
    protected refusal(view: WorkerViewPort): TemplateResult {
        const said = view.refusal === null ? EMPTY : html`<p class="alert">${noticeOf(this.locale, view.refusal)}</p>`;
        return html`<div role="alert">${said}</div>`;
    }

    protected async attach(): Promise<void> {
        this.detach();
        const attempt = this.#attempt;
        const feed = await this.#feedOf(this.app);
        if (feed === null || attempt !== this.#attempt) {
            return;
        }
        feed.start(this.jobId);
        this.feed = feed;
        this.view = feed.state;
        this.#unsubscribe = feed.subscribe((state) => {
            this.view = state;
        });
    }

    /** A new feed from the Jobs area's store (its chunk loaded first); null without an app or when it does not load. */
    async #feedOf(app: WorkerHostPort | null): Promise<WorkerFeedPort | null> {
        try {
            return app === null ? null : await askFeed(app);
        } catch {
            return null;
        }
    }

    protected detach(): void {
        this.#attempt += 1;
        this.#unsubscribe?.();
        this.feed?.stop();
        this.#unsubscribe = null;
        this.feed = null;
    }
}
