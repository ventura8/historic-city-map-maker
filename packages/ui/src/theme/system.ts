/**
 * The Material 3 (Expressive) system tokens other than colour: shape, typography, motion, elevation and state. Values
 * are Google's, from `@material/web@2.5.0` `tokens/versions/latest/sass` (design system 34.0.21) and the web
 * spring-to-curve table of m3.material.io (docs/research/material3-research.json). They are emitted as `--md-sys-*`
 * custom properties by `applyTheme`, next to the colour tokens, so every kit element and the host's own styles share
 * one set.
 */
import { TEXT_FONT_STACK } from '../fonts/font-files.js';

export type TokenMap = Readonly<Record<string, string>>;

/** The corner scale, including the Expressive additions (large-increased 20, extra-large-increased 32, 48). */
export const SHAPE_CORNERS = {
    none: '0px',
    'extra-small': '4px',
    small: '8px',
    medium: '12px',
    large: '16px',
    'large-increased': '20px',
    'extra-large': '28px',
    'extra-large-increased': '32px',
    'extra-extra-large': '48px',
    full: '9999px',
} as const;

export type ShapeCorner = keyof typeof SHAPE_CORNERS;

const REGULAR = '400';
const MEDIUM = '500';
const BOLD = '700';

interface TypeStyle {
    readonly size: string;
    readonly lineHeight: string;
    readonly tracking: string;
    readonly weight: string;
    /** The Expressive "emphasized" weight of the same style. */
    readonly emphasizedWeight: string;
}

/** A type style; its emphasized weight is the next one up (regular: medium, medium: bold), spelt once (§133b). */
function typeStyle(size: string, lineHeight: string, tracking: string, weight: typeof REGULAR | typeof MEDIUM): TypeStyle {
    return { size, lineHeight, tracking, weight, emphasizedWeight: weight === REGULAR ? MEDIUM : BOLD };
}

/** The M3 type scale (rem, so the visitor's text zoom applies). */
export const TYPE_SCALE = {
    'display-large': typeStyle('3.5625rem', '4rem', '-0.015625rem', REGULAR),
    'display-medium': typeStyle('2.8125rem', '3.25rem', '0rem', REGULAR),
    'display-small': typeStyle('2.25rem', '2.75rem', '0rem', REGULAR),
    'headline-large': typeStyle('2rem', '2.5rem', '0rem', REGULAR),
    'headline-medium': typeStyle('1.75rem', '2.25rem', '0rem', REGULAR),
    'headline-small': typeStyle('1.5rem', '2rem', '0rem', REGULAR),
    'title-large': typeStyle('1.375rem', '1.75rem', '0rem', REGULAR),
    'title-medium': typeStyle('1rem', '1.5rem', '0.009375rem', MEDIUM),
    'title-small': typeStyle('0.875rem', '1.25rem', '0.00625rem', MEDIUM),
    'body-large': typeStyle('1rem', '1.5rem', '0.03125rem', REGULAR),
    'body-medium': typeStyle('0.875rem', '1.25rem', '0.015625rem', REGULAR),
    'body-small': typeStyle('0.75rem', '1rem', '0.025rem', REGULAR),
    'label-large': typeStyle('0.875rem', '1.25rem', '0.00625rem', MEDIUM),
    'label-medium': typeStyle('0.75rem', '1rem', '0.03125rem', MEDIUM),
    'label-small': typeStyle('0.6875rem', '1rem', '0.03125rem', MEDIUM),
} satisfies Readonly<Record<string, TypeStyle>>;

export type TypeScaleName = keyof typeof TYPE_SCALE;

interface Spring {
    /** Google's spring parameters (for a JavaScript spring, e.g. a dragged sheet). */
    readonly stiffness: number;
    readonly damping: number;
    /** The official CSS approximation of the spring for the web. */
    readonly easing: string;
    readonly duration: string;
}

/**
 * Expressive motion springs. Spatial springs (position, size, corner radius) overshoot; effects springs (colour,
 * opacity) do not. Default for sheets, fast for small components, slow for full-screen changes.
 */
export const MOTION_SPRINGS = {
    'fast-spatial': { stiffness: 1400, damping: 0.9, easing: 'cubic-bezier(0.42, 1.67, 0.21, 0.9)', duration: '350ms' },
    'default-spatial': { stiffness: 700, damping: 0.9, easing: 'cubic-bezier(0.38, 1.21, 0.22, 1)', duration: '500ms' },
    'slow-spatial': { stiffness: 300, damping: 0.9, easing: 'cubic-bezier(0.39, 1.29, 0.35, 0.98)', duration: '650ms' },
    'fast-effects': { stiffness: 3800, damping: 1, easing: 'cubic-bezier(0.31, 0.94, 0.34, 1)', duration: '150ms' },
    'default-effects': { stiffness: 1600, damping: 1, easing: 'cubic-bezier(0.34, 0.8, 0.34, 1)', duration: '200ms' },
    'slow-effects': { stiffness: 800, damping: 1, easing: 'cubic-bezier(0.34, 0.88, 0.34, 1)', duration: '300ms' },
} as const satisfies Readonly<Record<string, Spring>>;

export type MotionSpring = keyof typeof MOTION_SPRINGS;

/** The baseline easing curves (no overshoot); `standard` replaces every spatial spring under reduced motion. */
export const MOTION_EASINGS = {
    standard: 'cubic-bezier(0.2, 0, 0, 1)',
    'standard-accelerate': 'cubic-bezier(0.3, 0, 1, 1)',
    'standard-decelerate': 'cubic-bezier(0, 0, 0, 1)',
    'emphasized-accelerate': 'cubic-bezier(0.3, 0, 0.8, 0.15)',
    'emphasized-decelerate': 'cubic-bezier(0.05, 0.7, 0.1, 1)',
    linear: 'cubic-bezier(0, 0, 1, 1)',
} as const;

/** Key and ambient shadow of each elevation level (M3), in the scheme's shadow colour. */
const SHADOWS: readonly (readonly [key: string, ambient: string])[] = [
    ['0 0 0 0', '0 0 0 0'],
    ['0 1px 2px 0', '0 1px 3px 1px'],
    ['0 1px 2px 0', '0 2px 6px 2px'],
    ['0 1px 3px 0', '0 4px 8px 3px'],
    ['0 2px 3px 0', '0 6px 10px 4px'],
    ['0 4px 4px 0', '0 8px 12px 6px'],
];

/** State-layer opacities and the focus indicator. */
export const STATE_TOKENS: TokenMap = {
    '--md-sys-state-hover-state-layer-opacity': '0.08',
    '--md-sys-state-focus-state-layer-opacity': '0.1',
    '--md-sys-state-pressed-state-layer-opacity': '0.1',
    '--md-sys-state-dragged-state-layer-opacity': '0.16',
    '--md-sys-state-disabled-state-layer-opacity': '0.38',
    '--md-sys-state-focus-indicator-thickness': '3px',
    '--md-sys-state-focus-indicator-outer-offset': '2px',
    '--md-sys-state-focus-indicator-inner-offset': '-3px',
};

function shadowColor(percent: number): string {
    return `color-mix(in srgb, var(--md-sys-color-shadow) ${String(percent)}%, transparent)`;
}

function shapeTokens(): TokenMap {
    return Object.fromEntries(Object.entries(SHAPE_CORNERS).map(([name, value]) => [`--md-sys-shape-corner-${name}`, value]));
}

/** Display, headline and title-large use the brand typeface, the rest the plain one (both Roboto Flex here). */
function typefaceOf(name: string): string {
    return /^(display|headline)-|^title-large$/.test(name) ? 'var(--md-ref-typeface-brand)' : 'var(--md-ref-typeface-plain)';
}

function typeTokens(): TokenMap {
    return Object.fromEntries(
        Object.entries(TYPE_SCALE).flatMap(([name, style]): [string, string][] => [
            [`--md-sys-typescale-${name}-font`, typefaceOf(name)],
            [`--md-sys-typescale-${name}-size`, style.size],
            [`--md-sys-typescale-${name}-line-height`, style.lineHeight],
            [`--md-sys-typescale-${name}-tracking`, style.tracking],
            [`--md-sys-typescale-${name}-weight`, style.weight],
            [`--md-sys-typescale-emphasized-${name}-weight`, style.emphasizedWeight],
        ]),
    );
}

function motionTokens(): TokenMap {
    const springs = Object.entries(MOTION_SPRINGS).flatMap(([name, spring]): [string, string][] => [
        [`--md-sys-motion-spring-${name}-easing`, spring.easing],
        [`--md-sys-motion-spring-${name}-duration`, spring.duration],
    ]);
    const easings = Object.entries(MOTION_EASINGS).map(([name, value]): [string, string] => [`--md-sys-motion-easing-${name}`, value]);
    return Object.fromEntries([...springs, ...easings]);
}

function elevationTokens(): TokenMap {
    return Object.fromEntries(
        SHADOWS.map(([key, ambient], level): [string, string] => [
            `--md-sys-elevation-level${String(level)}`,
            level === 0 ? 'none' : `${key} ${shadowColor(30)}, ${ambient} ${shadowColor(15)}`,
        ]),
    );
}

/** Every non-colour system token, as `--md-sys-*` / `--md-ref-*` custom properties. */
export const SYSTEM_TOKENS: TokenMap = {
    '--md-ref-typeface-brand': TEXT_FONT_STACK,
    '--md-ref-typeface-plain': TEXT_FONT_STACK,
    ...shapeTokens(),
    ...typeTokens(),
    ...motionTokens(),
    ...elevationTokens(),
    ...STATE_TOKENS,
};

/**
 * Overrides under `prefers-reduced-motion: reduce`: spatial springs (movement, overshoot) become instant with the
 * standard curve; effects (fades) keep their short durations, which carry no motion.
 */
export const REDUCED_MOTION_TOKENS: TokenMap = Object.fromEntries(
    Object.keys(MOTION_SPRINGS)
        .filter((name) => name.endsWith('-spatial'))
        .flatMap((name): [string, string][] => [
            [`--md-sys-motion-spring-${name}-easing`, MOTION_EASINGS.standard],
            [`--md-sys-motion-spring-${name}-duration`, '0ms'],
        ]),
);
