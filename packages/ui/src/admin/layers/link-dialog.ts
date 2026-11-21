/**
 * The Link dialog (`docs/research/M2c-interfaces.md` §8.1, CR-M2c-27; behaviour A15): a Mapbox tileset of the map's own
 * account or a tile server's https address, the layer's names, year, kind and attribution. What the server would refuse
 * (another account's tileset, a credential in the address) is said at once; the fields' problems once Link was pressed.
 * A tile server's addresses must be allowed by the city site's CSP: the dialog names them.
 */
import { LAYER_KINDS, translateApiError, type UiLocale } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { contentText } from '../shell/text.js';
import { field, issueAt } from './form-parts.js';
import type { LayersIntentsPort, LinkFormPort, LinkStatePort } from './layers-port.js';

function textField(
    locale: UiLocale,
    link: LinkStatePort,
    intents: LayersIntentsPort | null,
    spec: { name: keyof LinkFormPort; path: string; key: Parameters<typeof contentText>[1]; help?: string; required?: boolean },
): TemplateResult {
    return field(locale, {
        id: `link-${spec.name}`,
        label: contentText(locale, spec.key),
        value: String(link.form[spec.name]),
        issue: issueAt(link.issues, spec.path),
        ...(spec.help === undefined ? {} : { help: spec.help }),
        ...(spec.required === true ? { required: true } : {}),
        onInput: (text) => {
            intents?.editLink({ [spec.name]: text });
        },
    });
}

function choices(locale: UiLocale, link: LinkStatePort, intents: LayersIntentsPort | null): TemplateResult {
    const kind = (event: Event): void => {
        intents?.editLink({ kind: (event.target as HTMLSelectElement).value as LinkFormPort['kind'] });
    };
    const size = (event: Event): void => {
        intents?.editLink({ tileSize: (event.target as HTMLSelectElement).value === '512' ? 512 : 256 });
    };
    return html`<div class="fields">
        <div class="field">
            <label for="link-kind">${contentText(locale, 'adminContent.layers.kind')}</label>
            <select id="link-kind" @change=${kind}>
                ${LAYER_KINDS.map(
                    (value) =>
                        html`<option value=${value} ?selected=${link.form.kind === value}>
                            ${contentText(locale, `adminContent.layers.kind.${value}`)}
                        </option>`,
                )}
            </select>
        </div>
        <div class="field">
            <label for="link-size">${contentText(locale, 'adminContent.layers.tileSize')}</label>
            <select id="link-size" @change=${size}>
                ${([256, 512] as const).map(
                    (value) =>
                        html`<option value=${value} ?selected=${link.form.tileSize === value}>
                            ${contentText(locale, 'adminContent.layers.tileSizeValue', { size: String(value) })}
                        </option>`,
                )}
            </select>
        </div>
    </div>`;
}

function refusalNote(locale: UiLocale, link: LinkStatePort): TemplateResult | typeof nothing {
    const refusal = link.refusal;
    return refusal === null
        ? nothing
        : html`<p class="alert" role="alert"><span>${translateApiError(locale, refusal.code, refusal.params)}</span></p>`;
}

function originsNote(locale: UiLocale, link: LinkStatePort): TemplateResult | typeof nothing {
    const origins = link.origins.join(', ');
    return origins === '' ? nothing : html`<p class="note">${contentText(locale, 'adminContent.layers.cspNote', { origins })}</p>`;
}

function notes(locale: UiLocale, link: LinkStatePort): TemplateResult {
    return html`${refusalNote(locale, link)} ${originsNote(locale, link)}`;
}

/** Check's answer: checking, the tile's type, or why no tile came (S-A15-HAPPY-PROBED, S-A15-BAD-INVALID-URL). */
function probeNote(locale: UiLocale, probe: LinkStatePort['probe']): TemplateResult {
    if (probe.status === 'checking') {
        return html`<p class="note" role="status">${contentText(locale, 'adminContent.layers.checking')}</p>`;
    }
    if (probe.status === 'ok') {
        return html`<p class="note" role="status" data-probe="ok">
            ${contentText(locale, 'adminContent.layers.tilesAnswer', { type: probe.contentType })}
        </p>`;
    }
    return probe.status === 'failed'
        ? html`<p class="alert" role="alert" data-probe="failed">
              <span>${translateApiError(locale, probe.refusal.code, probe.refusal.params)}</span>
          </p>`
        : html``;
}

/** Check, under the address: one tile asked by the server before the layer is linked. */
function checkRow(locale: UiLocale, link: LinkStatePort, intents: LayersIntentsPort | null): TemplateResult {
    return html`<div class="actions">
            <hcm-button
                variant="tonal"
                icon="travel_explore"
                ?disabled=${link.probe.status === 'checking'}
                @click=${() => void intents?.checkLink()}
                >${contentText(locale, 'adminContent.layers.check')}</hcm-button
            >
        </div>
        ${probeNote(locale, link.probe)}`;
}

/**
 * The dialog while it is open (nothing otherwise: the page shows the Link button). The refusal and the origins to allow
 * come first, under the intro: on a phone the form scrolls, and a reason below the fields would be out of sight.
 */
export function linkDialog(
    locale: UiLocale,
    link: LinkStatePort | null,
    intents: LayersIntentsPort | null,
    linked: (id: string) => void,
): TemplateResult {
    const send = async (): Promise<void> => {
        const id = await intents?.submitLink();
        if (typeof id === 'string') {
            linked(id);
        }
    };
    /** Esc, the close button or the scrim (a dialog closed by its state closes the store's form again: no harm). */
    const closed = (): void => {
        intents?.closeLink();
    };
    const current = link ?? {
        form: { address: '', tileSize: 256, labelRo: '', labelEn: '', year: '', kind: 'map', attribution: '' },
        issues: [],
        refusal: null,
        origins: [],
        tried: false,
        sending: false,
        probe: { status: 'idle' as const },
    };
    return html`<hcm-dialog
        .open=${link !== null}
        .headline=${contentText(locale, 'adminContent.layers.linkTitle')}
        .closeLabel=${contentText(locale, 'adminContent.common.cancel')}
        @hcm-close=${closed}
    >
        <div class="pane dialog-body">
            <p>${contentText(locale, 'adminContent.layers.linkIntro')}</p>
            ${notes(locale, current)}
            ${textField(locale, current, intents, { name: 'address', path: 'address', key: 'adminContent.layers.address', help: contentText(locale, 'adminContent.layers.addressHelp'), required: true })}
            ${link === null ? nothing : checkRow(locale, link, intents)}
            ${textField(locale, current, intents, { name: 'labelRo', path: 'label.ro', key: 'adminContent.layers.labelRo', required: true })}
            ${textField(locale, current, intents, { name: 'labelEn', path: 'label.en', key: 'adminContent.layers.labelEn' })}
            ${textField(locale, current, intents, { name: 'year', path: 'year', key: 'adminContent.layers.year', required: true })}
            ${textField(locale, current, intents, { name: 'attribution', path: 'attribution', key: 'adminContent.layers.attribution' })}
            ${choices(locale, current, intents)}
        </div>
        <hcm-button slot="actions" variant="text" @click=${() => intents?.closeLink()}
            >${contentText(locale, 'adminContent.common.cancel')}</hcm-button
        >
        <hcm-button slot="actions" variant="filled" ?disabled=${current.probe.status === 'failed'} @click=${() => void send()}
            >${contentText(locale, current.sending ? 'adminContent.layers.linking' : 'adminContent.layers.linkAction')}</hcm-button
        >
    </hcm-dialog>`;
}
