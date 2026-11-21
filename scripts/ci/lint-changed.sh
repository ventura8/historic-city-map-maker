#!/usr/bin/env bash
# `npm run lint:changed`: ESLint on the TypeScript and JavaScript files that differ from the work branch's remote
# (origin/feat/engine-rewrite, or the ref in LINT_BASE), on one worker: the check before a commit. Only the TypeScript
# programs of the changed files' projects are built (the whole tree in one process took 8.8 GB on one worker and 17.8 GB on four,
# 2026-11-12). The full gate stays `npm run lint` in the pipeline's static stage.
set -euo pipefail

main() {
	local base="${LINT_BASE:-origin/feat/engine-rewrite}"
	local -a files=()
	local file
	while IFS= read -r -d '' file; do
		if [[ -f "$file" ]]; then
			files+=("$file")
		fi
	done < <(
		git diff --name-only -z --diff-filter=d "$base" -- '*.ts' '*.js' '*.mjs' '*.cjs'
		git ls-files -z --others --exclude-standard -- '*.ts' '*.js' '*.mjs' '*.cjs'
	)
	if [[ ${#files[@]} -eq 0 ]]; then
		echo "[lint:changed] no changed TypeScript or JavaScript file against $base"
		return 0
	fi
	echo "[lint:changed] ${#files[@]} files against $base, one worker"
	if [[ "${NODE_OPTIONS:-}" != *max-old-space-size* ]]; then
		export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=8192"
	fi
	npx eslint --concurrency=1 --max-warnings 0 --no-inline-config --report-unused-disable-directives-severity error \
		--no-warn-ignored "${files[@]}"
}

main "$@"
