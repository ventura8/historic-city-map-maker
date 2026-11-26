/**
 * The `export.*` functions (M5, `docs/research/M5-interfaces.md` §5): `export.start` records a city's static export and
 * queues its build, `export.build` (task queue) writes the zip into the private bucket, `export.download` answers a
 * signed address of a ready one. `functions/src/index.ts` exports them as the group `export` (`export` is a reserved word,
 * so through `export { exportGroup as export }`), which deploys `export-start`, `export-download` and `export-build`.
 */
import type { CallableDeps } from '../api/callable.js';
import { buildExportFunction, type ExportBuildDeps } from './build.js';
import { exportDownloadFunction, type ExportDownloadDeps } from './download.js';
import { exportStartFunction, type ExportStartDeps } from './start.js';

export type ExportFamilyDeps = CallableDeps & ExportStartDeps & ExportDownloadDeps & ExportBuildDeps;

export function exportFunctions(getDeps: () => ExportFamilyDeps) {
    return { start: exportStartFunction(getDeps), download: exportDownloadFunction(getDeps), build: buildExportFunction(getDeps) };
}
