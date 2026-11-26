import ts from 'typescript';

import { engineConfigSchema, validate, type EngineConfig } from '@hcm/shared';

import { SiteBuildError, issuesText } from './errors.js';

/**
 * Reads a site's `config.js` without running it. The file is a classic script that the browser runs before the
 * engine (docs/ENGINE_API.md → config.js); the build only needs its data, so it parses the script with the
 * TypeScript parser and accepts exactly one statement, `window.HistoricCityMapConfig = <literal>` (or
 * `globalThis.…`, the same object in a page), whose value is plain literal data: objects with plain keys, arrays,
 * strings, numbers, booleans and null. Anything that would need evaluating (a call, a variable, a spread, a
 * computed key, a template with substitutions) is refused, and the data is then validated with `engineConfigSchema`.
 * The build reads `manifestUrl` from it; the unit tests pin every committed config.js.
 */

const TARGETS = new Set(['window', 'globalThis']);
const PROPERTY = 'HistoricCityMapConfig';

type Convert = (node: ts.Node, path: string) => unknown;

function refuse(node: ts.Node, path: string): never {
    throw new SiteBuildError(`${path}: only literal data is allowed in config.js, found ${ts.SyntaxKind[node.kind]}`);
}

function literal(node: ts.Node, path: string): unknown {
    const convert = CONVERTERS.get(node.kind) ?? refuse;
    return convert(node, path);
}

function negativeNumber(node: ts.Node, path: string): number {
    const unary = node as ts.PrefixUnaryExpression;
    return unary.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(unary.operand)
        ? -Number(unary.operand.text)
        : refuse(node, path);
}

function propertyName(name: ts.PropertyName, path: string): string {
    return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : refuse(name, path);
}

function property(node: ts.ObjectLiteralElementLike, path: string): [string, unknown] {
    if (!ts.isPropertyAssignment(node)) {
        return refuse(node, path);
    }
    const key = propertyName(node.name, path);
    return [key, literal(node.initializer, `${path}.${key}`)];
}

/** `Object.fromEntries` defines own properties, so a `__proto__` key stays data (and the strict schema refuses it). */
function objectLiteral(node: ts.Node, path: string): Record<string, unknown> {
    return Object.fromEntries((node as ts.ObjectLiteralExpression).properties.map((element) => property(element, path)));
}

function arrayLiteral(node: ts.Node, path: string): unknown[] {
    return (node as ts.ArrayLiteralExpression).elements.map((element, index) => literal(element, `${path}[${String(index)}]`));
}

const CONVERTERS: ReadonlyMap<ts.SyntaxKind, Convert> = new Map<ts.SyntaxKind, Convert>([
    [ts.SyntaxKind.StringLiteral, (node) => (node as ts.StringLiteral).text],
    [ts.SyntaxKind.NoSubstitutionTemplateLiteral, (node) => (node as ts.NoSubstitutionTemplateLiteral).text],
    [ts.SyntaxKind.NumericLiteral, (node) => Number((node as ts.NumericLiteral).text)],
    [ts.SyntaxKind.PrefixUnaryExpression, negativeNumber],
    [ts.SyntaxKind.TrueKeyword, () => true],
    [ts.SyntaxKind.FalseKeyword, () => false],
    [ts.SyntaxKind.NullKeyword, () => null],
    [ts.SyntaxKind.ParenthesizedExpression, (node, path) => literal((node as ts.ParenthesizedExpression).expression, path)],
    [ts.SyntaxKind.ObjectLiteralExpression, objectLiteral],
    [ts.SyntaxKind.ArrayLiteralExpression, arrayLiteral],
]);

/** `window.HistoricCityMapConfig` or `globalThis.HistoricCityMapConfig`. */
function isConfigTarget(left: ts.Expression): boolean {
    return (
        ts.isPropertyAccessExpression(left) &&
        ts.isIdentifier(left.expression) &&
        TARGETS.has(left.expression.text) &&
        left.name.text === PROPERTY
    );
}

/** The right-hand side of `window.HistoricCityMapConfig = …`, or null when `statement` is anything else. */
function assignedValue(statement: ts.Statement): ts.Expression | null {
    if (!ts.isExpressionStatement(statement) || !ts.isBinaryExpression(statement.expression)) {
        return null;
    }
    const { left, operatorToken, right } = statement.expression;
    return operatorToken.kind === ts.SyntaxKind.EqualsToken && isConfigTarget(left) ? right : null;
}

function syntaxErrors(source: string, filename: string): string[] {
    const { diagnostics = [] } = ts.transpileModule(source, {
        fileName: filename,
        reportDiagnostics: true,
        compilerOptions: { allowJs: true },
    });
    return diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '));
}

function configValue(source: string, filename: string): unknown {
    const errors = syntaxErrors(source, filename);
    if (errors.length > 0) {
        throw new SiteBuildError(`${filename}: not valid JavaScript: ${errors.join('; ')}`);
    }
    const statements = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS).statements;
    const [only] = statements;
    const value = statements.length === 1 && only !== undefined ? assignedValue(only) : null;
    if (value === null) {
        throw new SiteBuildError(`${filename}: must hold exactly one statement, window.HistoricCityMapConfig = { … };`);
    }
    return literal(value, `${filename}: HistoricCityMapConfig`);
}

/** The validated configuration of `source`; throws SiteBuildError when it is not one literal assignment or is invalid. */
export function readConfigJs(source: string, filename = 'config.js'): EngineConfig {
    const result = validate(engineConfigSchema, configValue(source, filename));
    if (!result.ok) {
        throw new SiteBuildError(`${filename}: invalid configuration\n${issuesText(result.issues)}`);
    }
    return result.value;
}
