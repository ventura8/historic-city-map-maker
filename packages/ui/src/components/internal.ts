/**
 * Small helpers shared by the kit elements: registration, events, text templates and value maths. Not exported from
 * `@hcm/ui`; every element is.
 */

/** Registers `tag` once; calling it again (engine and admin both register the kit) is a no-op. */
export function defineOnce(registry: CustomElementRegistry, tag: string, element: CustomElementConstructor): void {
    if (registry.get(tag) === undefined) {
        registry.define(tag, element);
    }
}

/** Dispatches a bubbling, composed `CustomEvent` (every kit event crosses shadow roots). */
export function emit(target: EventTarget, type: string, detail: unknown = {}): void {
    target.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
}

const MIRRORED_KEYS: Readonly<Record<string, string>> = { ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' };

/**
 * The key as a left-to-right layout means it: right to left (an Arabic page), Left and Right swap, so they follow what is
 * on screen (the next segment, a higher value is to the left; WAI-ARIA's keyboard guidance for bidirectional text).
 */
export function logicalKey(key: string, element: Element): string {
    return element.matches(':dir(rtl)') ? (MIRRORED_KEYS[key] ?? key) : key;
}

const PLACEHOLDER = /\{(\w+)\}/g;

/**
 * Fills `{name}` placeholders of an app-supplied, already localized template (`layers.toggle` → "Show {name}").
 * Unknown placeholders stay visible, as in `translate`.
 */
export function fillTemplate(template: string, params: Readonly<Record<string, string>>): string {
    return template.replace(PLACEHOLDER, (placeholder: string, name: string) => params[name] ?? placeholder);
}

export function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** Decimal places of `step` (0.1 → 1), so snapped values print without floating-point noise. */
function decimalsOf(step: number): number {
    const text = String(step);
    const dot = text.indexOf('.');
    return dot === -1 ? 0 : text.length - dot - 1;
}

/** `value` moved to the nearest multiple of `step` above `min`, within `min..max` (a step ≤ 0 means no snapping). */
export function snapToStep(value: number, min: number, max: number, step: number): number {
    if (Number.isNaN(step) || step <= 0) {
        return clamp(value, min, max);
    }
    const snapped = min + Math.round((value - min) / step) * step;
    return clamp(Number(snapped.toFixed(decimalsOf(step))), min, max);
}
