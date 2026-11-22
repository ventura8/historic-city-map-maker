/**
 * The place editor's Facts (`docs/research/M17-stories.md` §13): architect(s), the years built, demolished and abandoned,
 * the style in both languages, floors and height, the LMI code, uses and addresses one per line (`facts-text.ts`) and the
 * related places (`placeLinksField`). A field writes on `change` (when the admin leaves it), so a half-typed year is never
 * read; an empty field removes its fact, and no fact left removes `facts`.
 */
import type { PlaceFacts } from '@hcm/shared';
import { html, nothing, type TemplateResult } from 'lit';

import { placeLinksField } from '../editing/place-links.js';
import type { PlacePickPort } from '../editing/place-pick-port.js';
import { contentText } from '../shell/text.js';
import { datedLine, parseCommaList, parseDatedLines } from './facts-text.js';
import type { FieldContext } from './poi-fields.js';

type Facts = Partial<Record<keyof PlaceFacts, unknown>>;

/** `facts` with `key` set to `value` (undefined: removed); no fact left, undefined. */
export function withFact(facts: PlaceFacts | undefined, key: keyof PlaceFacts, value: unknown): PlaceFacts | undefined {
    const next: Facts = { ...facts, [key]: value };
    const kept = Object.fromEntries(Object.entries(next).filter(([, item]) => item !== undefined));
    return Object.keys(kept).length === 0 ? undefined : kept;
}

function numberOrUndefined(text: string): number | undefined {
    const trimmed = text.trim().replace(',', '.');
    if (trimmed === '') {
        return undefined;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
}

interface Input {
    readonly id: string;
    readonly key: Parameters<typeof contentText>[1];
    readonly value: string;
    readonly set: (typed: string) => void;
    readonly lines?: boolean;
    readonly hint?: Parameters<typeof contentText>[1];
}

function input(context: FieldContext, spec: Input): TemplateResult {
    const change = (event: Event): void => {
        spec.set((event.target as HTMLInputElement | HTMLTextAreaElement).value);
    };
    const hintPart = [spec.id, 'hint'].join('-');
    const hintId = spec.hint === undefined ? nothing : hintPart;
    const field =
        spec.lines === true
            ? html`<textarea
                  id=${spec.id}
                  rows="3"
                  ?readonly=${context.readOnly}
                  .value=${spec.value}
                  aria-describedby=${hintId}
                  @change=${change}
              ></textarea>`
            : html`<input
                  id=${spec.id}
                  autocomplete="off"
                  ?readonly=${context.readOnly}
                  .value=${spec.value}
                  aria-describedby=${hintId}
                  @change=${change}
              />`;
    return html`<div class="field">
        <label for=${spec.id}>${contentText(context.locale, spec.key)}</label>
        ${field} ${spec.hint === undefined ? nothing : html`<p class="note" id=${hintPart}>${contentText(context.locale, spec.hint)}</p>`}
    </div>`;
}

function textOf(value: number | string | undefined): string {
    return value === undefined ? '' : String(value);
}

function scalarInputs(
    context: FieldContext,
    facts: PlaceFacts | undefined,
    set: (key: keyof PlaceFacts, value: unknown) => void,
): TemplateResult {
    const number = (id: string, key: 'yearBuilt' | 'yearDemolished' | 'yearAbandoned' | 'floors' | 'heightM') =>
        input(context, {
            id,
            key: `adminContent.pois.facts.${key}`,
            value: textOf(facts?.[key]),
            set: (typed) => {
                set(key, numberOrUndefined(typed));
            },
        });
    const style = (language: 'ro' | 'en') =>
        input(context, {
            id: `facts-style-${language}`,
            key: `adminContent.pois.facts.style.${language}`,
            value: facts?.style?.[language] ?? '',
            set: (typed) => {
                const text = { ...facts?.style, [language]: typed.trim() === '' ? undefined : typed.trim() };
                set('style', text.ro === undefined ? undefined : text);
            },
        });
    return html`${input(context, {
        id: 'facts-architects',
        key: 'adminContent.pois.facts.architects',
        hint: 'adminContent.pois.facts.architectsHint',
        value: (facts?.architects ?? []).join(', '),
        set: (typed) => {
            const names = parseCommaList(typed);
            set('architects', names.length === 0 ? undefined : names);
        },
    })}
    ${number('facts-built', 'yearBuilt')} ${number('facts-demolished', 'yearDemolished')} ${number('facts-abandoned', 'yearAbandoned')}
    ${style('ro')} ${style('en')} ${number('facts-floors', 'floors')} ${number('facts-height', 'heightM')}
    ${input(context, {
        id: 'facts-lmi',
        key: 'adminContent.pois.facts.lmiCode',
        hint: 'adminContent.pois.facts.lmiHint',
        value: facts?.lmiCode ?? '',
        set: (typed) => {
            set('lmiCode', typed.trim() === '' ? undefined : typed.trim());
        },
    })}`;
}

function lineInputs(
    context: FieldContext,
    facts: PlaceFacts | undefined,
    set: (key: keyof PlaceFacts, value: unknown) => void,
): TemplateResult {
    const uses = (facts?.uses ?? []).map((use) => datedLine({ ...use, text: use.use.ro }));
    const addresses = (facts?.addresses ?? []).map((address) => datedLine(address));
    return html`${input(context, {
        id: 'facts-uses',
        key: 'adminContent.pois.facts.uses',
        hint: 'adminContent.pois.facts.linesHint',
        lines: true,
        value: uses.join('\n'),
        set: (typed) => {
            const lines = parseDatedLines(typed).map(({ text, yearStart, yearEnd }) => ({
                use: { ro: text },
                ...(yearStart === undefined ? {} : { yearStart }),
                ...(yearEnd === undefined ? {} : { yearEnd }),
            }));
            set('uses', lines.length === 0 ? undefined : lines);
        },
    })}
    ${input(context, {
        id: 'facts-addresses',
        key: 'adminContent.pois.facts.addresses',
        hint: 'adminContent.pois.facts.addressesHint',
        lines: true,
        value: addresses.join('\n'),
        set: (typed) => {
            const lines = parseDatedLines(typed);
            set('addresses', lines.length === 0 ? undefined : lines);
        },
    })}`;
}

function invalidNote(context: FieldContext): TemplateResult {
    return html`<p class="note error" role="alert">${contentText(context.locale, 'adminContent.pois.facts.invalid')}</p>`;
}

/** The Facts fieldset's fields; `places` are the city's places the related-places picker offers. */
export function factsFields(context: FieldContext, places: readonly PlacePickPort[] | null): TemplateResult {
    const facts = context.value.facts;
    const set = (key: keyof PlaceFacts, value: unknown): void => {
        context.edit({ facts: withFact(facts, key, value) });
    };
    const invalid = context.issues.some((issue) => issue.path.startsWith('facts'));
    return html`${scalarInputs(context, facts, set)} ${lineInputs(context, facts, set)}
    ${placeLinksField({
        id: 'facts-related',
        label: 'adminContent.pois.facts.related',
        hint: 'adminContent.pois.facts.relatedHint',
        locale: context.locale,
        ids: facts?.relatedPlaceIds ?? [],
        places,
        readOnly: context.readOnly,
        change: (ids) => {
            set('relatedPlaceIds', ids === undefined ? undefined : [...ids]);
        },
    })}
    ${invalid ? invalidNote(context) : nothing}`;
}
