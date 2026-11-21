/** A folder name: letters, digits, `_`, `.`, `-`, but never `.` or `..` themselves. */
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

/** Below `dist/` and nothing else: the site build deletes such a folder before it writes it (a site, the Pages tree). */
export function isOutputDir(path: string): boolean {
    const [first, ...rest] = path.split('/');
    return first === 'dist' && rest.length > 0 && rest.every((segment) => SEGMENT.test(segment));
}
