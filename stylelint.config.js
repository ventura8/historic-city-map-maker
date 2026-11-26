// Stylelint: standard config plus the correctness rules the sibling repos enable explicitly.
// Lit `css` tagged templates inside .ts files are linted too, through the postcss-lit syntax.
/** @type {import('stylelint').Config} */
export default {
    extends: ['stylelint-config-standard'],
    reportNeedlessDisables: true,
    reportInvalidScopeDisables: true,
    reportDescriptionlessDisables: true,
    rules: {
        'no-empty-source': true,
        'block-no-empty': true,
        'color-no-invalid-hex': true,
        'declaration-block-no-duplicate-properties': true,
        'declaration-property-value-no-unknown': true,
        'property-no-unknown': true,
        'unit-no-unknown': true,
        'selector-pseudo-class-no-unknown': true,
        'no-descending-specificity': true,
        // Colours come only from the M3 tokens generated per city (packages/ui/src/theme).
        'color-no-hex': true,
        'color-named': 'never',
    },
    overrides: [
        {
            files: ['**/*.ts'],
            customSyntax: 'postcss-lit',
        },
    ],
};
