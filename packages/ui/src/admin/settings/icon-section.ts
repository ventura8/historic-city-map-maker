/**
 * Settings → Browser tab icon (`docs/research/M2-interfaces.md` → *The city's tab icon*; S-A101-*): the public map's
 * tab icon as visitors see it (the 180 px file of the public bucket, its address carrying the file's hash so the card
 * never shows a cached old one; the inlined default before the city has one), whether it is the default or an upload,
 * **Upload an image** (PNG or WebP) and, for an upload, **Use the default icon**. While a change is on its way the
 * buttons wait; a refusal (an SVG, an image too small) shows beside them and nothing changes.
 */
import { type CityDoc, type UiLocale } from '@hcm/shared';
import { DEFAULT_FAVICON_DATA_URL } from '@hcm/shared/tab-icon';
import { html, nothing, type TemplateResult } from 'lit';

import { EMPTY } from '../shell/empty.js';
import { contentText, noticeOf } from '../shell/text.js';
import { readIcon } from './icon-upload.js';
import type { SectionContext } from './section-parts.js';
import { sectionRowTexts } from './section-parts.js';

/** What the file picker offers (the server checks the bytes again: never a file's name or the type a browser guesses). */
const ICON_ACCEPT = 'image/png,image/webp';

type IconRecord = NonNullable<CityDoc['icon']>;

/** The preview's address: the 180 px file, versioned by its hash; the default inlined before the city has an icon. */
export function iconPreviewUrl(icon: IconRecord | undefined): string {
    return icon === undefined ? DEFAULT_FAVICON_DATA_URL : `${icon.url}?v=${icon.sha256.slice(0, 8)}`;
}

/** Before the city has an icon: when it is drawn. */
function noneYet(locale: UiLocale, icon: IconRecord | undefined): TemplateResult {
    return icon === undefined ? html`<p class="note">${contentText(locale, 'adminContent.settings.icon.none')}</p>` : EMPTY;
}

function preview(locale: UiLocale, icon: IconRecord | undefined): TemplateResult {
    const source = icon?.source ?? 'default';
    const tag = source === 'custom' ? 'adminContent.settings.icon.custom' : 'adminContent.settings.icon.default';
    return html`<div class="actions">
            <img
                data-icon-preview
                src=${iconPreviewUrl(icon)}
                width="96"
                height="96"
                alt=${contentText(locale, 'adminContent.settings.icon.preview')}
            />
            <span class="note" data-icon-source=${source}>${contentText(locale, tag)}</span>
        </div>
        ${noneYet(locale, icon)}`;
}

function chosen(context: SectionContext, event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file !== undefined) {
        void readIcon(file).then((read) => {
            sendIcon(context, read);
        });
    }
}

/** The file to `cities.setIcon`, or the browser's reason to the card. */
function sendIcon(context: SectionContext, read: Awaited<ReturnType<typeof readIcon>>): void {
    if ('image' in read) {
        void context.intents?.setIcon({ kind: 'upload', image: read.image });
    } else {
        context.intents?.refuseIcon(read.problem);
    }
}

function pick(event: Event): void {
    (event.currentTarget as HTMLElement).parentElement?.querySelector<HTMLInputElement>('input[type="file"]')?.click();
}

function actions(context: SectionContext, custom: boolean): TemplateResult {
    const { locale } = context;
    const busy = context.view.icon.busy || context.readOnly;
    const reset = (): void => {
        void context.intents?.setIcon({ kind: 'reset' });
    };
    return html`<div class="actions">
            <hcm-button variant="filled" icon="upload" ?disabled=${busy} aria-describedby="icon-hint" @click=${pick}
                >${contentText(locale, 'adminContent.settings.icon.upload')}</hcm-button
            >
            ${
                custom
                    ? html`<hcm-button variant="text" icon="restore" ?disabled=${busy} @click=${reset}
                          >${contentText(locale, 'adminContent.settings.icon.reset')}</hcm-button
                      >`
                    : nothing
            }
            <input
                class="file-input"
                type="file"
                accept=${ICON_ACCEPT}
                hidden
                @change=${(event: Event) => {
                    chosen(context, event);
                }}
            />
        </div>
        <p class="note" id="icon-hint">${contentText(locale, 'adminContent.settings.icon.uploadHint')}</p>`;
}

function status(context: SectionContext): TemplateResult {
    const { locale, view } = context;
    if (view.icon.error !== null) {
        return html`<p class="alert" role="alert" data-icon-error><span>${noticeOf(locale, view.icon.error)}</span></p>`;
    }
    return html`<p class="note status" role="status">${view.icon.busy ? contentText(locale, 'adminContent.settings.icon.saving') : ''}</p>`;
}

export function iconSection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const icon = context.view.city.doc?.data.icon;
    return html`<h2 tabindex="-1" data-detail-heading>${sectionRowTexts(locale, 'icon').title}</h2>
        <section class="group" data-section="icon">
            <p class="note">${contentText(locale, 'adminContent.settings.icon.intro')}</p>
            ${preview(locale, icon)} ${actions(context, icon?.source === 'custom')} ${status(context)}
            <p class="note">${contentText(locale, 'adminContent.settings.icon.cache')}</p>
        </section>`;
}
