#!/usr/bin/env bash
# The local stack for manual testing (docs/SETUP.md → "Local stack for manual testing"): the admin, the viewer, the
# Firebase emulators (project demo-hcm) and the mock APIs of the e2e world, seeded with a Bucharest city, on fixed
# loopback ports, inside the quality image (Docker only, no host-home mount; nothing reaches a real Google, Mapbox or
# USGS host):
#
#   npm run dev:stack                           # or: bash scripts/dev/dev-stack.sh [serve]; Ctrl+C stops it
#   HCM_STACK_SEED=fresh npm run dev:stack      # a new map instead: Setup from the first sign-in (start-up mode)
#   HCM_STACK_TICKS=0 npm run dev:stack         # no scheduler clock (imagery.tick, ops.tick)
#   bash scripts/dev/dev-stack.sh tick          # run imagery.tick and ops.tick once, now
#   bash scripts/dev/dev-stack.sh check         # the stack's own check: both apps answer, the owner signs in, no leak
#   bash scripts/dev/dev-stack.sh stop          # stop a stack started elsewhere (the emulators shut down cleanly)
#
# `serve` while a stack runs (started in another terminal or by the Claude preview, .claude/launch.json) follows its
# output instead of starting a second one. Otherwise it builds the quality image if needed (Docker's cache: seconds) and
# runs scripts/dev/in-stack.sh in it (node_modules, the e2e build when an input changed, then e2e/stack/main.ts). The
# container shares the host's network (`--network host`), so the ports are the host's 127.0.0.1 ones: admin 4312, viewer
# 4310, mock APIs 4311, the emulators of firebase.json. A Playwright run of the pipeline has its own network and is
# unaffected. The container is capped at HCM_STACK_MEM_GB (default 8) GB with no extra swap and is the first thing the
# kernel kills when memory runs out (`--oom-score-adj 500`), never the desktop session; the emulators' JVMs have their own
# heap cap (EMULATOR_ENV in e2e/admin/world.ts). Never edit this file while a stack started from it runs (bash reads a script as it goes).
set -euo pipefail

readonly CONTAINER=hcm-dev-stack

usage() {
	echo "usage: bash scripts/dev/dev-stack.sh [serve|tick|check|stop]" >&2
	return 2
}

serve() {
	local root="$1" image="$2"
	if docker container inspect "$CONTAINER" >/dev/null 2>&1; then
		# Started elsewhere (another terminal, the Claude preview): follow its output instead of a second stack.
		echo "[OK] the local stack is already running; following its output (Ctrl+C leaves it running)"
		docker logs --follow --tail 20 "$CONTAINER"
		return 0
	fi
	HCM_IMAGE="$image" bash "$root/scripts/ci/build-and-test.sh"
	local -a tty=()
	if [[ -t 1 ]]; then
		tty=(--tty --interactive)
	fi
	docker run --rm --init "${tty[@]}" \
		--name "$CONTAINER" \
		--network host \
		--memory "${HCM_STACK_MEM_GB:-8}g" \
		--memory-swap "${HCM_STACK_MEM_GB:-8}g" \
		--oom-score-adj 500 \
		--user "$(id -u):$(id -g)" \
		--env HOME=/tmp/hcm-home \
		--env HCM_STACK_SEED \
		--env HCM_STACK_TICKS \
		--volume "$root:$root" \
		--workdir "$root" \
		"$image" bash scripts/dev/in-stack.sh
	return 0
}

in_stack() {
	if ! docker container inspect "$CONTAINER" >/dev/null 2>&1; then
		echo "[ERROR] no local stack is running (start it with: npm run dev:stack)" >&2
		return 1
	fi
	docker exec --user "$(id -u):$(id -g)" "$CONTAINER" npm run --silent "$@"
	return 0
}

main() {
	local root image
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	image="${HCM_IMAGE:-hcm-quality:local}"
	case "${1:-serve}" in
	serve) serve "$root" "$image" ;;
	tick) in_stack stack:tick ;;
	check) in_stack stack:check ;;
	stop) docker stop --time 60 "$CONTAINER" >/dev/null && echo "[OK] local stack stopped" ;;
	*) usage ;;
	esac
}

main "$@"
