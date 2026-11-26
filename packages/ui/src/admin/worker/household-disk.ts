/**
 * One computer's disk in `<hcm-worker-household>` (cleanup item 6, 2026-11-14: "workers must not leave behind temp or unnecessary
 * data"): what the worker's folder uses and the free space of its disk; when that is below the worker's floor, what happened (the
 * disk is almost full), why it matters (it takes no new map work) and the fix (Free space now, or room made on the computer); and
 * **Free space now** (`worker.manage` `freeSpace`): asked, then what it freed and when.
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { formatWhen } from '../editing/states.js';
import type { PartContext } from './household-parts.js';
import type { ComputerViewPort, HouseholdViewPort } from './worker-port.js';

const GB = 1024 ** 3;

/** Bytes as gigabytes with one decimal, in the admin's language. */
function gigabytes(locale: UiLocale, bytes: number): string {
    return new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / GB);
}

/** The disk's line and, below its floor, the warning. */
function diskWords(context: PartContext, disk: NonNullable<ComputerViewPort['disk']>): TemplateResult {
    const { t, locale } = context;
    const free = gigabytes(locale, disk.freeBytes);
    const line = html`<span class="row-detail" data-disk
        >${t('adminWorkerHousehold.disk', { used: gigabytes(locale, disk.workBytes), free })}</span
    >`;
    if (disk.freeBytes >= disk.floorBytes) {
        return line;
    }
    const floor = gigabytes(locale, disk.floorBytes);
    return html`${line}
        <p class="alert" role="alert" data-low-disk>
            ${t('adminWorkerHousehold.lowDisk', { free })} ${t('adminWorkerHousehold.lowDisk2', { floor })}
            ${t('adminWorkerHousehold.lowDisk3')}
        </p>`;
}

/** "Free space now": waiting for the computer, or what the last one freed (nothing to delete said as such); empty before any. */
function freedWords({ t, locale }: PartContext, computer: ComputerViewPort): string {
    if (computer.freeing) {
        return t('adminWorkerHousehold.freeing');
    }
    const freed = computer.freed;
    if (freed === null) {
        return '';
    }
    const when = formatWhen(locale, freed.at);
    return freed.bytes === 0
        ? t('adminWorkerHousehold.freedNothing', { when })
        : t('adminWorkerHousehold.freed', { size: gigabytes(locale, freed.bytes), when });
}

/** Free space now waits for an earlier action, or for the computer to answer the one asked. */
function busy(view: HouseholdViewPort, computer: ComputerViewPort): boolean {
    return view.acting !== null || computer.freeing;
}

/**
 * The computer's disk, its warning, Free space now and its outcome; nothing for a computer disconnected or being removed, or whose
 * worker never said its disk (one too old to free space on request).
 */
export function diskPart(context: PartContext, view: HouseholdViewPort, computer: ComputerViewPort): TemplateResult {
    const disk = computer.disk;
    if (disk === null || computer.revoked || computer.removal !== null) {
        return html``;
    }
    return html`${diskWords(context, disk)}
        <p class="note" role="status" data-freed=${computer.freeing ? 'asked' : String(computer.freed !== null)}>
            ${freedWords(context, computer)}
        </p>
        <div class="actions">
            <hcm-button
                variant="tonal"
                icon="delete"
                data-free-space
                ?disabled=${busy(view, computer)}
                @click=${() => void context.household.intents.freeSpace(computer.id)}
                >${context.t('adminWorkerHousehold.freeSpace')}</hcm-button
            >
        </div>`;
}
