/**
 * The legacy import card's body (step h, `docs/research/M2b-interfaces.md` §3.3 h): one button imports the old
 * Bucharest photos (one click), a progress bar counts them, the photos that failed processing are listed with their
 * reason, and the card says when all of them are on the map. Importing again is safe: nothing is created twice.
 */
import { css, html, nothing, type TemplateResult } from 'lit';

import { defineHcmButton } from '../../components/button.js';
import { defineOnce } from '../../components/internal.js';
import { defineHcmProgress } from '../../components/progress.js';
import { EMPTY } from '../shell/empty.js';
import { SetupBody, defineSetupBodyParts } from './setup-body.js';
import type { SetupViewState } from './setup-port.js';
import { setupTextStyles } from './setup-styles.js';
import { setupText } from './setup-text.js';

const HCM_SETUP_IMPORT_TAG = 'hcm-setup-import';

type ImportSlice = SetupViewState['legacyImport'];

/** Every photo of the bundle is on the map. */
function isComplete(imported: ImportSlice): boolean {
    return imported.total > 0 && imported.done >= imported.total;
}

/** Photos on the map that get the old site's direction on the next click (`docs/research/M5-interfaces.md` → *Directions from the old site*). */
function directions(imported: ImportSlice): number {
    return imported.directions ?? 0;
}

/** Nothing is left to do: every photo on the map, with its direction and its author's credit. */
function isDone(imported: ImportSlice): boolean {
    return isComplete(imported) && directions(imported) === 0 && imported.credits !== true;
}

/**
 * Photos of the bundle that are not imported yet while some are: a stopped import, or the old site's 2023 additions on a
 * map that has the first 45 (`docs/research/M5-interfaces.md` → *The 2023 additions*). Zero before the first import.
 */
function missing(imported: ImportSlice): number {
    return imported.done > 0 ? imported.total - imported.done : 0;
}

/** The bar shows while the import runs and while a partial import waits to be finished. */
function showsProgress(imported: ImportSlice): boolean {
    return imported.running || (imported.done > 0 && !isComplete(imported));
}

/** The link of a photo the server never received: the primary colour and a full target, as the server checks' fix. */
const fixStyles = css`
    .fix {
        display: inline-flex;
        align-items: center;
        min-block-size: 48px;
        color: var(--md-sys-color-primary);
    }
`;

export class HcmSetupImport extends SetupBody {
    static override readonly styles = [setupTextStyles, fixStyles];

    protected override renderBody(state: SetupViewState): TemplateResult {
        const imported = state.legacyImport;
        return html`<div class="body">
            ${
                isDone(imported)
                    ? html`<p class="success">${this.t('adminSetup.import.done', { count: String(imported.total) })}</p>`
                    : this.renderAction(state)
            }
            ${showsProgress(imported) ? this.renderProgress(imported) : nothing} ${this.renderFailed(imported)}
        </div>`;
    }

    private renderAction(state: SetupViewState): TemplateResult {
        const { total, running } = state.legacyImport;
        return html`${this.renderMissing(state.legacyImport)} ${this.renderFixes(state.legacyImport)}
            <div class="actions">
                <hcm-button
                    variant="filled"
                    icon="upload"
                    ?disabled=${running || total === 0 || this.step(state, 'legacyImport').busy}
                    @click=${() => {
                        this.act((intents) => {
                            intents.importLegacy();
                        });
                    }}
                    >${this.actionLabel(state.legacyImport)}</hcm-button
                >
            </div>`;
    }

    /**
     * "Import the photos (45)" the first time; "Import the missing photos (12)" once some are on the map; with every photo
     * on it, "Add the old site's directions (1)", or the credits' new authors. One click does all that is left.
     */
    private actionLabel(imported: ImportSlice): string {
        const toImport = missing(imported);
        if (toImport > 0) {
            return this.t('adminSetup.import.actionMissing', { count: String(toImport) });
        }
        if (!isComplete(imported)) {
            return this.t('adminSetup.import.action', { count: String(imported.total) });
        }
        return directions(imported) > 0
            ? this.t('adminSetup.import.actionDirections', { count: String(directions(imported)) })
            : this.t('adminSetup.import.actionCredits');
    }

    /** How many directions the click adds, and the credits' new authors (not while the import runs). */
    private renderFixes(imported: ImportSlice): TemplateResult {
        if (imported.running) {
            return EMPTY;
        }
        const count = directions(imported);
        const notes = [
            ...(count > 0 ? [this.t('adminSetup.import.directions', { count: String(count) })] : []),
            ...(imported.credits === true ? [this.t('adminSetup.import.credits')] : []),
        ];
        return html`${notes.map((note) => this.renderNote(note))}`;
    }

    private renderNote(text: string): TemplateResult {
        return html`<p class="note">${text}</p>`;
    }

    /** What the missing photos are, and that the photos already on the map stay as they are (not while the import runs). */
    private renderMissing(imported: ImportSlice): TemplateResult {
        const toImport = missing(imported);
        if (toImport === 0 || imported.running) {
            return EMPTY;
        }
        return html`<p class="note">${this.t('adminSetup.import.missing', { count: String(toImport) })}</p>`;
    }

    private renderProgress(imported: ImportSlice): TemplateResult {
        const text = this.t('adminSetup.import.progress', { done: String(imported.done), total: String(imported.total) });
        return html`<hcm-progress .value=${imported.done / Math.max(imported.total, 1)} label=${text}></hcm-progress>
            <p class="note" role="status">${text}</p>`;
    }

    private renderFailed(imported: ImportSlice): TemplateResult {
        if (imported.failed.length === 0) {
            return EMPTY;
        }
        return html`<ul class="failed">
            ${imported.failed.map(
                (failure) =>
                    html`<li data-photo=${failure.id}>
                        <code>${failure.id}</code>: ${setupText(this.locale, { key: failure.detail })} ${this.renderFix(failure.detail)}
                    </li>`,
            )}
        </ul>`;
    }

    /**
     * M6 (server-bugs, finding 17 of 2026-10-25; S-A28-BAD-STUCK-AGAIN): a photo whose upload the server never received
     * links the step that grants the role its events need, as the server checks' list does for the events check.
     */
    private renderFix(detail: ImportSlice['failed'][number]['detail']): TemplateResult {
        if (detail !== 'apiError.photo.notReceived') {
            return EMPTY;
        }
        const step = this.t('adminSetup.step.provision');
        return html`<a class="fix" href="#/setup/provision">${this.t('adminSetup.selfTest.fix', { step })}</a>`;
    }
}

/** Registers `<hcm-setup-import>` and what it renders. */
export function defineHcmSetupImport(registry: CustomElementRegistry = customElements): void {
    defineSetupBodyParts(registry);
    defineHcmButton(registry);
    defineHcmProgress(registry);
    defineOnce(registry, HCM_SETUP_IMPORT_TAG, HcmSetupImport);
}

declare global {
    interface HTMLElementTagNameMap {
        'hcm-setup-import': HcmSetupImport;
    }
}
