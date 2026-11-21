#!/usr/bin/env bash
# The single entry point for every quality stage, locally and in CI:
#
#   PIPELINE_STAGE=static bash scripts/ci/run-all-checks.sh
#
# Stages: static, tests, e2e, tour-matrix, build, sonar, deps, release, contract, quality (static+tests+e2e+build)
# and all (static, tests, e2e, tour-matrix, build, sonar; the default). Gates never run on the host: this wrapper builds the quality
# image, then runs scripts/ci/in-container.sh inside it as the calling user, with the repository
# mounted at the SAME absolute path (coverage report paths match Sonar's) and a throwaway HOME.
# Variables forwarded by name only (`--env NAME`, never NAME=value, so no value is in argv): CI,
# the commit ranges CI computes (GITLEAKS_LOG_OPTS, COMMIT_RANGE), E2E_SHARD, E2E_TIER and E2E_ADMIN_PART (the e2e run),
# MAPBOX_PUBLIC_TOKEN (the site build's URL-restricted pk. token), HCM_PUBLIC_BUCKET (the public bucket whose manifest
# the Bucharest site reads; unset, it bundles the seed snapshot), SONAR_TOKEN, the memory knobs of scripts/ci/parallel.py (HCM_MAX_PARALLEL, HCM_LOW_MEM, HCM_LINT_WORKERS,
# HCM_E2E_WORKERS, VITEST_MAX_WORKERS) and PIPELINE_JOBS (how many gates run at
# once; unset is what the CPUs and the free memory allow, 1 runs them one at a time).
# HCM_MEM_GB=<n> caps the container's memory (and swap) at n GB; unset, it has no cap. scripts/ci/parallel.py reads the cap
# (cgroup `memory.max`), so a capped run picks fewer workers instead of running out (measured peaks of each stage:
# docs/research/DECISIONS-for-review.md §180).
set -euo pipefail

main() {
	local root image
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	image="${HCM_IMAGE:-hcm-quality:local}"
	HCM_IMAGE="$image" bash "$root/scripts/ci/build-and-test.sh"
	local -a tty=()
	if [[ -t 1 ]]; then
		tty=(--tty)
	fi
	local -a memory=()
	if [[ "${HCM_MEM_GB:-}" =~ ^[1-9][0-9]*$ ]]; then
		memory=(--memory "${HCM_MEM_GB}g" --memory-swap "${HCM_MEM_GB}g")
	fi
	docker run --rm --init "${tty[@]}" "${memory[@]}" \
		--user "$(id -u):$(id -g)" \
		--env HOME=/tmp/hcm-home \
		--env PIPELINE_STAGE="${PIPELINE_STAGE:-all}" \
		--env CI \
		--env GITLEAKS_LOG_OPTS \
		--env COMMIT_RANGE \
		--env E2E_SHARD \
		--env E2E_TIER \
		--env E2E_ADMIN_PART \
		--env MAPBOX_PUBLIC_TOKEN \
		--env HCM_PUBLIC_BUCKET \
		--env SONAR_TOKEN \
		--env PIPELINE_JOBS \
		--env HCM_MAX_PARALLEL \
		--env HCM_LOW_MEM \
		--env HCM_LINT_WORKERS \
		--env HCM_E2E_WORKERS \
		--env VITEST_MAX_WORKERS \
		--oom-score-adj "${HCM_OOM_SCORE_ADJ:-500}" \
		--volume "$root:$root" \
		--workdir "$root" \
		"$image" bash scripts/ci/in-container.sh
	return 0
}

main "$@"
