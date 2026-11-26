#!/usr/bin/env bash
# `npm run lint`: ESLint over the whole tree, as one ESLint process per group of TypeScript projects (2026-11-12).
#
# typescript-eslint's `projectService` keeps every TypeScript program it opens until the process ends, and a test
# project's program also holds its package's sources and those of every package it imports: one process over the
# whole tree held the 21 programs of the 22 `tsconfig` projects at once (no file fell into a default project) and
# peaked at 8.6 GB on one worker, 14.2 GB on two, 17.8 GB on four. One process per group holds only its own: the
# largest group (functions) peaks at 2.9 GB, so one group at a time fits a 4 GB machine. Every rule still runs on every
# file: the groups are disjoint, and the last one is the rest of the tree (`.` without the others), so a new folder is
# linted without an edit here. A group's TypeScript programs are the ones a whole-tree run builds for its files, so the
# type-aware rules see the same types.
#
# How many groups run at once: scripts/ci/parallel.py lint (one per 4 GiB available and per 2 CPUs; HCM_LINT_WORKERS
# sets it, HCM_LOW_MEM=1 runs them one at a time). Extra ESLint arguments are passed to every group.
set -euo pipefail

# Largest first, so the long groups start early when several run at once.
LINT_GROUPS=(
	functions
	packages/admin
	packages/shared
	packages/ui
	e2e
	scripts
	"packages/engine packages/create-historic-city packages/test-support firebase"
)
# A group's programs can outgrow V8's default heap on a small machine: a ceiling, not a reservation.
HEAP_MB=6144
# The groups' logs; global, as the EXIT trap that removes it runs after main has returned.
LINT_OUT=""

eslint_group() {
	local -a paths folders ignores=()
	local group folder
	if [[ "$1" == "." ]]; then
		paths=(.)
		for group in "${LINT_GROUPS[@]}"; do
			read -r -a folders <<<"$group"
			for folder in "${folders[@]}"; do
				ignores+=(--ignore-pattern "$folder/**")
			done
		done
	else
		read -r -a paths <<<"$1"
	fi
	shift
	npx eslint --concurrency=1 --max-warnings 0 --no-inline-config --report-unused-disable-directives-severity error \
		"${ignores[@]}" "$@" "${paths[@]}"
}

main() {
	local workers status=0 index running=0
	workers="${HCM_LINT_WORKERS:-$(python3 scripts/ci/parallel.py lint)}"
	if [[ "${NODE_OPTIONS:-}" != *max-old-space-size* ]]; then
		export NODE_OPTIONS="${NODE_OPTIONS:-} --max-old-space-size=$HEAP_MB"
	fi
	local -a all=("${LINT_GROUPS[@]}" .)
	LINT_OUT="$(mktemp -d)"
	trap 'rm -rf "$LINT_OUT"' EXIT
	echo "[lint] ${#all[@]} groups, $workers at a time"
	for index in "${!all[@]}"; do
		if ((running >= workers)); then
			wait -n || true
			running=$((running - 1))
		fi
		{
			local rc=0
			eslint_group "${all[$index]}" "$@" >"$LINT_OUT/$index.log" 2>&1 || rc=$?
			echo "$rc" >"$LINT_OUT/$index.rc"
		} &
		running=$((running + 1))
	done
	wait
	for index in "${!all[@]}"; do
		cat "$LINT_OUT/$index.log"
		if [[ "$(cat "$LINT_OUT/$index.rc")" != "0" ]]; then
			status=1
			echo "[lint] group '${all[$index]}' failed"
		fi
	done
	return "$status"
}

main "$@"
