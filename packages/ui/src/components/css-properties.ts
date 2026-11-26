/**
 * `cssProperties({...})`: sets CSS properties on an element through the CSSOM (`style.setProperty`), on every render
 * including the first. Lit's `styleMap` writes a `style` attribute on its first render, which the city page's strict
 * Content Security Policy (`style-src` without `'unsafe-inline'`, design-review-security-cost.md §1.8) refuses; the
 * CSSOM is not subject to it. Values come from the kit's own numbers or from schema-checked data (`#rrggbb`). Every
 * kit and viewer element uses it instead of `styleMap` or a `style=${...}` binding.
 *
 * Use it as an element binding: `<div ${cssProperties({ '--hcm-position': '40%' })}>`. An empty or absent value
 * removes a property this directive set on an earlier render.
 */
import { noChange } from 'lit';
import { Directive, PartType, directive, type ElementPart, type PartInfo } from 'lit/directive.js';

export type CssPropertyValues = Readonly<Record<string, string | undefined>>;

class CssPropertiesDirective extends Directive {
    /** The properties the last render set, so a later render can remove the ones it no longer names. */
    #applied: ReadonlySet<string> = new Set();

    constructor(partInfo: PartInfo) {
        super(partInfo);
        if (partInfo.type !== PartType.ELEMENT) {
            throw new Error('cssProperties binds an element only');
        }
    }

    /** The declarations to apply, without empty or absent values (an empty value would remove the property). */
    render(values: CssPropertyValues): readonly (readonly [string, string])[] {
        return Object.entries(values).filter((entry): entry is [string, string] => entry[1] !== undefined && entry[1] !== '');
    }

    override update(part: ElementPart, [values]: [CssPropertyValues]): typeof noChange {
        const style = (part.element as HTMLElement).style;
        const declarations = this.render(values);
        const names = new Set(declarations.map(([name]) => name));
        for (const name of this.#applied) {
            if (!names.has(name)) {
                style.removeProperty(name);
            }
        }
        for (const [name, value] of declarations) {
            style.setProperty(name, value);
        }
        this.#applied = names;
        return noChange;
    }
}

export const cssProperties = directive(CssPropertiesDirective);
