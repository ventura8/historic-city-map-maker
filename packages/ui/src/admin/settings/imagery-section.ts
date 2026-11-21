/**
 * The imagery section (`docs/research/M3-interfaces.md` §10.7; CR-M3-8): whether a georeferenced scene goes to the
 * public map on its own when its checkpoint error is under the threshold, that threshold in metres (1–200), and the
 * years the search ranks first (at most 20), each removable; saved on their own (`cities/{city}.imagery`) with the
 * section's own draft and Save. A value the city document refuses is said at its field on Save. M25: the Landsat group (the switch of the
 * tick's own imports and its years).
 */
import {
    imagerySettingsOf,
    MAP_THRESHOLD_MAX_RANGE,
    MAX_TARGET_YEARS,
    RMSE_THRESHOLD_RANGE,
    type CityDoc,
    type CityImagery,
    type ValidationIssue,
} from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { when } from '../imagery/when.js';
import { field, issueAt } from '../layers/form-parts.js';
import { contentText } from '../shell/text.js';
import { cityHead, cityOf, sectionTitle, type SectionContext } from './section-parts.js';

const YEAR = /^(?:18|19|20)\d\d$/;
const NEW_YEAR_ID = 'imagery-new-year';

/** The threshold as typed: a number, or NaN for an empty field (the document refuses it on Save). */
function thresholdOf(text: string): number {
    return text.trim() === '' ? Number.NaN : Number(text.replace(',', '.'));
}

function shown(value: number): string {
    return Number.isNaN(value) ? '' : String(value);
}

function edit(context: SectionContext, imagery: CityImagery | undefined, patch: Partial<CityImagery>): void {
    context.intents?.editCity({ imagery: { ...imagery, ...patch } });
}

function autoPublishRow(context: SectionContext, city: CityDoc): TemplateResult {
    const label = contentText(context.locale, 'adminContent.imagery.settings.autoPublish');
    return html`<div class="switch-row">
        <span aria-hidden="true">${label}</span>
        <hcm-switch
            .checked=${imagerySettingsOf(city.imagery).autoPublish}
            ?disabled=${context.readOnly}
            label=${label}
            @hcm-change=${(event: Event) => {
                edit(context, city.imagery, { autoPublish: (event as CustomEvent<{ checked: boolean }>).detail.checked });
            }}
        ></hcm-switch>
    </div>`;
}

/** M12 (`docs/research/M12-own-tiles.md`): off, the default: a layer's tiles come from the city's own public bucket. */
function mapboxPathRow(context: SectionContext, city: CityDoc): TemplateResult {
    const { locale } = context;
    const label = contentText(locale, 'adminContent.imagery.settings.throughMapbox');
    return html`<div class="switch-row">
            <span aria-hidden="true">${label}</span>
            <hcm-switch
                .checked=${imagerySettingsOf(city.imagery).publishThroughMapbox}
                ?disabled=${context.readOnly}
                label=${label}
                @hcm-change=${(event: Event) => {
                    edit(context, city.imagery, { publishThroughMapbox: (event as CustomEvent<{ checked: boolean }>).detail.checked });
                }}
            ></hcm-switch>
        </div>
        <p class="note">
            ${contentText(locale, 'adminContent.imagery.settings.throughMapboxOff')}
            ${contentText(locale, 'adminContent.imagery.settings.throughMapboxOn')}
            ${contentText(locale, 'adminContent.imagery.settings.throughMapboxStays')}
        </p>`;
}

function thresholdField(context: SectionContext, city: CityDoc, issues: readonly ValidationIssue[]): TemplateResult {
    const { locale } = context;
    const range = { min: String(RMSE_THRESHOLD_RANGE.min), max: String(RMSE_THRESHOLD_RANGE.max) };
    return field(locale, {
        id: 'imagery-threshold',
        label: contentText(locale, 'adminContent.imagery.settings.threshold'),
        value: shown(imagerySettingsOf(city.imagery).rmseThresholdM),
        issue: issueAt(issues, 'imagery.rmseThresholdM'),
        help: contentText(locale, 'adminContent.imagery.settings.thresholdHelp', range),
        inputMode: 'decimal',
        readOnly: context.readOnly,
        onInput: (text) => {
            edit(context, city.imagery, { rmseThresholdM: thresholdOf(text) });
        },
    });
}

/** M20 (`docs/research/M20-import-local.md` §5): whether a drawn map within its scaled threshold publishes itself, and the cap. */
function mapsGroup(context: SectionContext, city: CityDoc, issues: readonly ValidationIssue[]): TemplateResult {
    const { locale } = context;
    const settings = imagerySettingsOf(city.imagery);
    const label = contentText(locale, 'adminContent.imagery.settings.mapAutoPublish');
    const range = { min: String(MAP_THRESHOLD_MAX_RANGE.min), max: String(MAP_THRESHOLD_MAX_RANGE.max) };
    return html`<section class="group" data-maps>
        <h3>${contentText(locale, 'adminContent.imagery.settings.maps')}</h3>
        <p class="note">${contentText(locale, 'adminContent.imagery.settings.mapsNote')}</p>
        <div class="switch-row">
            <span aria-hidden="true">${label}</span>
            <hcm-switch
                .checked=${settings.mapAutoPublish}
                ?disabled=${context.readOnly}
                label=${label}
                @hcm-change=${(event: Event) => {
                    edit(context, city.imagery, { mapAutoPublish: (event as CustomEvent<{ checked: boolean }>).detail.checked });
                }}
            ></hcm-switch>
        </div>
        ${field(locale, {
            id: 'imagery-map-threshold',
            label: contentText(locale, 'adminContent.imagery.settings.mapThresholdMax'),
            value: shown(settings.mapThresholdMaxM),
            issue: issueAt(issues, 'imagery.mapThresholdMaxM'),
            help: contentText(locale, 'adminContent.imagery.settings.mapThresholdMaxHelp', range),
            inputMode: 'decimal',
            readOnly: context.readOnly,
            onInput: (text) => {
                edit(context, city.imagery, { mapThresholdMaxM: thresholdOf(text) });
            },
        })}
    </section>`;
}

/** The city's imagery with `landsatTo` set to `year`, or without it (up to the current year) when the field is emptied. */
function withLandsatTo(imagery: CityImagery | undefined, text: string): CityImagery {
    const rest: CityImagery = { ...imagery };
    delete rest.landsatTo;
    return text.trim() === '' ? rest : { ...rest, landsatTo: thresholdOf(text) };
}

/**
 * M25 (`docs/research/M25-landsat.md` §4): a year field of the Landsat range. An empty From is NaN (the document refuses it on Save);
 * an empty To is the default, up to the current year.
 */
function landsatYearField(
    context: SectionContext,
    city: CityDoc,
    issues: readonly ValidationIssue[],
    key: 'landsatFrom' | 'landsatTo',
): TemplateResult {
    const { locale } = context;
    return field(locale, {
        id: `imagery-${key}`,
        label: contentText(locale, `adminContent.imagery.settings.${key}`),
        value: shown(imagerySettingsOf(city.imagery)[key] ?? Number.NaN),
        issue: issueAt(issues, `imagery.${key}`),
        inputMode: 'numeric',
        readOnly: context.readOnly,
        onInput: (text) => {
            if (key === 'landsatTo') {
                context.intents?.editCity({ imagery: withLandsatTo(city.imagery, text) });
                return;
            }
            edit(context, city.imagery, { [key]: thresholdOf(text) });
        },
    });
}

/** M25: whether the tick imports the best Landsat scene of each year on its own, and which years. */
function landsatGroup(context: SectionContext, city: CityDoc, issues: readonly ValidationIssue[]): TemplateResult {
    const { locale } = context;
    const label = contentText(locale, 'adminContent.imagery.settings.landsatAuto');
    return html`<section class="group" data-landsat>
        <h3>${contentText(locale, 'adminContent.imagery.settings.landsat')}</h3>
        <p class="note">${contentText(locale, 'adminContent.imagery.settings.landsatNote')}</p>
        <div class="switch-row">
            <span aria-hidden="true">${label}</span>
            <hcm-switch
                .checked=${imagerySettingsOf(city.imagery).landsatAuto}
                ?disabled=${context.readOnly}
                label=${label}
                @hcm-change=${(event: Event) => {
                    edit(context, city.imagery, { landsatAuto: (event as CustomEvent<{ checked: boolean }>).detail.checked });
                }}
            ></hcm-switch>
        </div>
        ${landsatYearField(context, city, issues, 'landsatFrom')} ${landsatYearField(context, city, issues, 'landsatTo')}
    </section>`;
}

/** The typed year when the list takes it (from 1800 to 2099, not in the list yet, room left), else null. */
function acceptedYear(text: string, years: readonly number[]): number | null {
    const year = Number(text);
    return YEAR.test(text) && !years.includes(year) && years.length < MAX_TARGET_YEARS ? year : null;
}

/** Adds the year typed in the field, or says why it cannot. */
function addYear(context: SectionContext, city: CityDoc, input: HTMLInputElement): void {
    const years = imagerySettingsOf(city.imagery).targetYears;
    const year = acceptedYear(input.value.trim(), years);
    if (year === null) {
        context.announce(contentText(context.locale, 'adminContent.imagery.settings.yearRefused', { max: String(MAX_TARGET_YEARS) }));
        return;
    }
    edit(context, city.imagery, { targetYears: [...years, year].sort((a, b) => a - b) });
    input.value = '';
}

function yearRow(context: SectionContext, city: CityDoc, year: number): TemplateResult {
    const years = imagerySettingsOf(city.imagery).targetYears;
    return html`<li class="year-row">
        <span>${String(year)}</span>
        <hcm-icon-button
            icon="delete"
            label=${contentText(context.locale, 'adminContent.imagery.settings.removeYear', { year: String(year) })}
            ?disabled=${context.readOnly}
            @click=${() => {
                edit(context, city.imagery, { targetYears: years.filter((candidate) => candidate !== year) });
            }}
        ></hcm-icon-button>
    </li>`;
}

function yearsGroup(context: SectionContext, city: CityDoc, issues: readonly ValidationIssue[]): TemplateResult {
    const { locale } = context;
    const years = imagerySettingsOf(city.imagery).targetYears;
    const issue = issueAt(issues, 'imagery.targetYears');
    const add = (event: Event): void => {
        // The field is this page's one with its id, in the same shadow root as the button.
        const input = ((event.currentTarget as HTMLElement).getRootNode() as ParentNode).querySelector(`#${NEW_YEAR_ID}`);
        if (input instanceof HTMLInputElement) {
            addYear(context, city, input);
        }
    };
    return html`<section class="group">
        <h3>${contentText(locale, 'adminContent.imagery.settings.years')}</h3>
        <p class="note">${contentText(locale, 'adminContent.imagery.settings.yearsHelp', { max: String(MAX_TARGET_YEARS) })}</p>
        ${when(
            years.length === 0,
            () => html`<p class="note" data-state="no-years">${contentText(locale, 'adminContent.imagery.settings.noYears')}</p>`,
        )}
        <ul class="rows years">
            ${years.map((year) => yearRow(context, city, year))}
        </ul>
        ${when(issue !== null, () => html`<p class="error" role="alert">${contentText(locale, 'adminContent.imagery.settings.yearsInvalid')}</p>`)}
        <div class="field">
            <label for=${NEW_YEAR_ID}>${contentText(locale, 'adminContent.imagery.settings.newYear')}</label>
            <input id=${NEW_YEAR_ID} inputmode="numeric" ?readonly=${context.readOnly} />
        </div>
        <div class="actions">
            <hcm-button variant="tonal" icon="add" ?disabled=${context.readOnly} @click=${add}
                >${contentText(locale, 'adminContent.imagery.settings.addYear')}</hcm-button
            >
        </div>
    </section>`;
}

export function imagerySection(context: SectionContext): TemplateResult {
    const { locale } = context;
    const city = cityOf(context);
    const head = cityHead(context, sectionTitle(locale, 'imagery'));
    if (city === null) {
        return head;
    }
    const issues = context.view.citySection.draft.issues;
    return html`${head}
        <p class="note">${contentText(locale, 'adminContent.imagery.settings.note')}</p>
        <section class="group">
            <h3>${contentText(locale, 'adminContent.imagery.settings.publishing')}</h3>
            ${autoPublishRow(context, city)} ${thresholdField(context, city, issues)} ${mapboxPathRow(context, city)}
        </section>
        ${mapsGroup(context, city, issues)} ${yearsGroup(context, city, issues)} ${landsatGroup(context, city, issues)}`;
}
