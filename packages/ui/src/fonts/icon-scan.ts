// The icon names a TypeScript or Lit source sets, for `packages/ui/scripts/build-fonts.mjs --check` (finding 82 of
// 2026-11-03; a name outside the font's subset draws nothing). What is read, each only where it names an icon, so a text
// never counts (these comments give no example: this file is scanned too):
//
// * a literal icon attribute or property, and a literal `name` attribute on `hcm-icon` alone (any element may have a name);
// * the literal outcomes of a hole of either: a literal after `?` or `:`, or the whole hole, is an outcome; a literal
//   compared against is not, nor an expression with no literal.
const NAME = String.raw`[a-z][a-z0-9_]*`;
const LITERAL = new RegExp(String.raw`\bicon(?:=|: )["'](${NAME})["']`, 'g');
const ICON_NAME = new RegExp(String.raw`<hcm-icon\b[^>]*?\sname="(${NAME})"`, 'g');
const HOLE = /(?:\bicon=|<hcm-icon\b[^>]*?\sname=)\$\{([^}]*)\}/g;
const OUTCOME = new RegExp(String.raw`(?:^\s*|[?:]\s*)'(${NAME})'`, 'g');

function firstGroups(source: string, pattern: RegExp): string[] {
    return [...source.matchAll(pattern)].flatMap((match) => match.slice(1, 2));
}

/** The icon names `source` sets (duplicates kept: a caller reports each with its file). */
export function iconNamesIn(source: string): readonly string[] {
    const holes = firstGroups(source, HOLE).flatMap((hole) => firstGroups(hole, OUTCOME));
    return [...firstGroups(source, LITERAL), ...firstGroups(source, ICON_NAME), ...holes];
}
