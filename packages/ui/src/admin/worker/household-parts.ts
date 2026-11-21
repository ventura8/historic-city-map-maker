/**
 * The parts of `<hcm-worker-household>` that do not need the element (W5, household computers): the words of one computer's
 * line (its state, share, versions and removal), the "Add another computer" panel, and the manual cleanup after Disconnect now
 * anyway. Each takes the element's translator and returns a template.
 */
import { WORKER_STARTER_FILE_NAMES, type UiLocale } from '@hcm/shared';
import type { AdminWorkerHouseholdKey } from '@hcm/shared/admin-worker-household';
import { html, type TemplateResult } from 'lit';

import { formatWhen } from '../editing/states.js';
import type { AddKindPort, ComputerViewPort, HouseholdPort, HouseholdViewPort, WorkerOsPort } from './worker-port.js';

export type Translate = (key: AdminWorkerHouseholdKey, params?: Readonly<Record<string, string>>) => string;

/** What a part needs of the element: the words, the locale, the copy action and which copy was asked. */
export interface PartContext {
    readonly t: Translate;
    readonly locale: UiLocale;
    readonly household: HouseholdPort;
    readonly city: string;
    copy(what: string, text: string): void;
    copiedText(what: string): string;
}

const ADD_KINDS: readonly AddKindPort[] = ['windows', 'mac', 'linux', 'headless'];

/** The computer's name in the list: the owner's or its own, else "Unnamed computer (w-…)". */
export function nameOf(t: Translate, computer: ComputerViewPort): string {
    return computer.name ?? t('adminWorkerHousehold.unnamed', { id: computer.id.slice(0, 8) });
}

/** Online, or when it was last seen; then what it does. */
export function presence(context: PartContext, computer: ComputerViewPort): string {
    const { t, locale } = context;
    const on = computer.online
        ? t('adminWorkerHousehold.online')
        : t('adminWorkerHousehold.offline', { when: formatWhen(locale, computer.seenAt) });
    if (computer.paused) {
        return `${on}. ${t('adminWorkerHousehold.paused')}`;
    }
    const doing =
        computer.state === 'busy' && computer.jobId !== null
            ? t('adminWorkerHousehold.working', { job: computer.jobId })
            : t('adminWorkerHousehold.waiting');
    return `${on}. ${doing}`;
}

/** Its share of the computer and why (M26), when the worker said it. */
export function share(context: PartContext, computer: ComputerViewPort): TemplateResult {
    const said = computer.share;
    if (said === null || computer.revoked) {
        return html``;
    }
    const size = { threads: String(said.threads), cores: String(said.cores), memory: (said.memoryMb / 1024).toFixed(1) };
    const why = context.t(`adminWorkerHousehold.why.${said.why}`);
    return html`<span class="row-detail" data-share=${said.why}>${context.t('adminWorkerHousehold.share', size)} ${why}</span>`;
}

/** The helper's and the pipeline's versions. */
export function versions({ t }: PartContext, computer: ComputerViewPort): string {
    let starter = t('adminWorkerHousehold.noStarter');
    if (computer.starter !== null) {
        starter = `${computer.starter} (${t(computer.starterCurrent ? 'adminWorkerHousehold.starterCurrent' : 'adminWorkerHousehold.starterOld')})`;
    }
    return t('adminWorkerHousehold.versions', { starter, version: computer.version });
}

/** How far Remove this computer got, in plain words; empty while none was asked. */
export function removalWords(context: PartContext, computer: ComputerViewPort): string {
    const { t } = context;
    const removal = computer.removal;
    if (removal === null) {
        return computer.revoked ? t('adminWorkerHousehold.disconnected') : '';
    }
    return removal.step === 'failed' ? t(`adminWorkerHousehold.removal.failed.${removal.why ?? 'cleanup'}`) : stepWords(context, computer);
}

/** The words of each step but a failure; `asked` by whether the computer is on. */
const STEP_WORDS = {
    asked: 'adminWorkerHousehold.removal.asked',
    accepted: 'adminWorkerHousehold.removal.accepted',
    done: 'adminWorkerHousehold.removal.done',
    failed: 'adminWorkerHousehold.removal.failed.cleanup',
} as const satisfies Readonly<Record<string, AdminWorkerHouseholdKey>>;

/** Asked (on or off), cleaning up, or done (and whether Docker stayed). */
function stepWords({ t }: PartContext, computer: ComputerViewPort): string {
    const removal = computer.removal ?? { step: 'asked' as const, dockerLeft: false };
    const offline = removal.step === 'asked' && !computer.online;
    const said = t(offline ? 'adminWorkerHousehold.removal.askedOffline' : STEP_WORDS[removal.step]);
    return removal.dockerLeft === true ? [said, t('adminWorkerHousehold.removal.dockerLeft')].join(' ') : said;
}

/** A line to copy: the text, a Copy button and its polite word. */
function copyable(
    context: PartContext,
    what: string,
    [label, text, copyLabel]: readonly [string, string, AdminWorkerHouseholdKey],
): TemplateResult {
    return html`<pre class="text" aria-label=${label} data-line=${what}>${text}</pre>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="content_copy"
                @click=${() => {
                    context.copy(what, text);
                }}
                >${context.t(copyLabel)}</hcm-button
            >
        </div>
        <p class="note" role="status" data-copied=${what}>${context.copiedText(what)}</p>`;
}

/** The line or file that cleans a disconnected computer up by hand (the last resort: Disconnect now anyway). */
export function manualCleanup(context: PartContext, computer: ComputerViewPort): TemplateResult {
    if (!computer.revoked || computer.removal?.step === 'done') {
        return html``;
    }
    const line = context.household.cleanup(computer.os);
    const file = { url: line.split("'")[1] ?? '', name: WORKER_STARTER_FILE_NAMES.uninstall[computer.os] };
    const what = ['cleanup', computer.id].join('-');
    return html`${copyable(context, what, [context.t('adminWorkerHousehold.cleanupLine'), line, 'adminWorkerHousehold.copy'])}
        <div class="actions">
            <a class="external" href=${file.url} download=${file.name}>${context.t('adminWorkerHousehold.cleanupFile')}</a>
        </div>`;
}

/** The headless line's words: being made, failed, or the line with when its code ends and a new one. */
function headless(context: PartContext, view: HouseholdViewPort): TemplateResult {
    const { t, locale, household } = context;
    const line = view.line;
    if (view.codeFailed) {
        return html`<p class="alert" role="alert" data-line-failed>${t('adminWorkerHousehold.lineFailed')}</p>
            <div class="actions">
                <hcm-button variant="text" icon="refresh" @click=${() => void household.intents.mint()}
                    >${t('adminWorkerHousehold.retry')}</hcm-button
                >
            </div>`;
    }
    if (line === null || view.expiresAt === null) {
        return html`<p class="note" role="status">${t('adminWorkerHousehold.lineMaking')}</p>`;
    }
    return html`<p>${t('adminWorkerHousehold.headless')} ${t('adminWorkerHousehold.headless2')}</p>
        ${copyable(context, 'headless', [t('adminWorkerHousehold.line'), line, 'adminWorkerHousehold.copy'])}
        <p class="note">${t('adminWorkerHousehold.lineExpires', { time: formatWhen(locale, view.expiresAt) })}</p>
        <div class="actions">
            <hcm-button variant="text" icon="refresh" @click=${() => void household.intents.mint()}
                >${t('adminWorkerHousehold.newLine')}</hcm-button
            >
        </div>`;
}

/** A computer with a screen: this admin's address to open there, with Copy. */
function screen(context: PartContext, view: HouseholdViewPort, kind: WorkerOsPort): TemplateResult {
    const { t } = context;
    const windows = kind === 'windows' ? html`<p class="note">${t('adminWorkerHousehold.screenWindows')}</p>` : html``;
    return html`<p>${t('adminWorkerHousehold.screen')} ${t('adminWorkerHousehold.screen2')}</p>
        ${copyable(context, 'address', [t('adminWorkerHousehold.address'), view.link, 'adminWorkerHousehold.copyAddress'])} ${windows}`;
}

/** One kind of computer: the chosen one tonal and pressed (a group of buttons wraps on a phone, as a segmented row cannot). */
function kindButton(context: PartContext, value: AddKindPort, chosen: AddKindPort): TemplateResult {
    return html`<hcm-button
        variant=${value === chosen ? 'tonal' : 'text'}
        .pressed=${value === chosen}
        data-kind=${value}
        @click=${() => {
            context.household.intents.add(value);
        }}
        >${context.t(`adminWorkerHousehold.kind.${value}`)}</hcm-button
    >`;
}

/** "Add another computer": the kind, then the address or the line. */
export function addPanel(context: PartContext, view: HouseholdViewPort): TemplateResult {
    const { t, household } = context;
    const kind = view.adding;
    if (kind === null) {
        return html`<div class="actions">
            <hcm-button
                variant="tonal"
                icon="add"
                data-add
                @click=${() => {
                    household.intents.add('headless');
                }}
                >${t('adminWorkerHousehold.add')}</hcm-button
            >
        </div>`;
    }
    return html`<div class="add" data-adding=${kind}>
        <div class="actions" role="group" aria-label=${t('adminWorkerHousehold.addKind')}>
            ${ADD_KINDS.map((value) => kindButton(context, value, kind))}
        </div>
        ${kind === 'headless' ? headless(context, view) : screen(context, view, kind)}
        <div class="actions">
            <hcm-button
                variant="text"
                icon="close"
                @click=${() => {
                    household.intents.add(null);
                }}
                >${t('adminWorkerHousehold.close')}</hcm-button
            >
        </div>
    </div>`;
}
