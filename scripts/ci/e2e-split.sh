#!/usr/bin/env bash
# Runs one pipeline stage with its Playwright runs split between this machine and a second Docker machine reached over
# ssh (the NUC by default), both from this working tree, uncommitted changes included:
#
#   PIPELINE_STAGE=quality bash scripts/ci/e2e-split.sh     # or e2e, tour-matrix, all (the default, as run-all-checks.sh)
#
# Here the whole stage runs through scripts/ci/run-all-checks.sh with E2E_SHARD set to this machine's part of every
# Playwright run. Meanwhile the second machine receives the tree (rsync of what git sees: no ignored file, so no local
# secret, no .git, no node_modules) and runs only the stage's Playwright stages (e2e, tour-matrix) with the other part,
# in its own quality image. Both outputs stream with a [local] or [<host>] prefix. Then the second machine's reports
# come back to reports/split/<host>/, the two blob reports of each Playwright run are merged in the image (`playwright
# merge-reports`) into the usual reports/junit/e2e*.xml and reports/playwright*/, and one verdict line ends the run:
# `[SUCCESS] stage '<x>' passed` only when both parts and the merge passed; otherwise `[FAILURE] ...`, exit 1, and the
# stage's green marker is removed.
#
# HCM_SPLIT_HOST   the ssh host (default nuc; empty: this machine only)
# HCM_SPLIT_DIR    the tree's folder on it, under its home (default hcm-ci; a git clone, or created)
# HCM_SPLIT_PARTS  this machine's parts and the remote's; they become E2E_SHARD ranges of every tier but the admin
#                  tier: the remote takes the head of the queue (the long tour tests), this machine the tail (short
#                  functional tests). Defaults, measured (docs/research/pipeline-baseline.md): "2:3" for e2e and
#                  tour-matrix ("1-3/5" there, "4-5/5" here), "1:2" for quality and all, where this machine also runs
#                  static, tests and build first. Measured again on 2026-10-18 after the per-push tiering
#                  (DECISIONS-for-review.md §42g): `quality` in 460 s, this machine's part (static, tests, 228 s of
#                  Playwright, build) about 20 s shorter than the NUC's 447 s, so "1:2" stays.
#
# The admin tier's locked tests run one at a time on each machine (one Firebase project in its emulators; its content
# tests, a city each, run on every worker), so the admin tier is not counted into those ranges: each machine runs its own part of the admin projects (E2E_ADMIN_PART=1-2/3 on the remote,
# 3/3 here; e2e/split.ts), each with its own emulators, at the same time (docs/research/DECISIONS-for-review.md §32f,
# §33a).
#
# When the host does not answer within 5 s (ssh BatchMode), lacks docker or rsync, or another split holds it (a lock
# folder next to HCM_SPLIT_DIR, stale after two hours), the stage runs here only, exactly as run-all-checks.sh runs it.
# When the connection drops during the run (ssh exit 255), this machine runs the remote's part itself afterwards.
set -euo pipefail

readonly SSH_OPTIONS=(-o BatchMode=yes -o ConnectTimeout=5 -o ServerAliveInterval=30)
readonly SSH_FAILED=255

# The Playwright stages inside a stage (scripts/ci/pipeline.py: STAGES and COMPOSITE_STAGES; pinned by
# scripts/ci/tests/test_e2e_split.py).
playwright_stages() {
	case "$1" in
	e2e | tour-matrix) echo "$1" ;;
	quality) echo e2e ;;
	all) echo e2e tour-matrix ;;
	esac
	return 0
}

default_parts() {
	case "$1" in
	e2e | tour-matrix) echo 2:3 ;;
	*) echo 1:2 ;;
	esac
	return 0
}

# "first-last/total" of one side, or "index/total" for a single slice.
shard_range() {
	local first=$1 last=$2 total=$3
	if ((first == last)); then
		echo "$first/$total"
	else
		echo "$first-$last/$total"
	fi
	return 0
}

# The blob, junit and HTML report names of a Playwright stage (e2e/playwright.config.ts).
report_name() {
	if [[ $1 == tour-matrix ]]; then
		echo e2e-tour-matrix
	else
		echo e2e
	fi
	return 0
}

say() {
	echo "[split] $*"
	return 0
}

prefix() {
	sed -u "s/^/[$1] /"
	return 0
}

# Checks the host and takes its lock; exit 3 when docker or rsync is missing, 4 when another split holds the lock.
prepare_remote() {
	ssh "${SSH_OPTIONS[@]}" "$host" bash -s -- "$dir" <<'REMOTE'
set -u
command -v docker >/dev/null && command -v rsync >/dev/null || exit 3
lock="$1.split-lock"
find "$lock" -maxdepth 0 -mmin +120 -exec rmdir {} + 2>/dev/null
mkdir -- "$lock" 2>/dev/null || exit 4
mkdir -p -- "$1" && cd -- "$1" && { [ -d .git ] || git init -q; }
REMOTE
}

release_remote() {
	ssh "${SSH_OPTIONS[@]}" "$host" bash -s -- "$dir" <<'REMOTE' || true
rmdir -- "$1.split-lock" 2>/dev/null
exit 0
REMOTE
	return 0
}

sync_tree() {
	rsync -a --delete -e "ssh ${SSH_OPTIONS[*]}" --exclude .git --exclude node_modules --exclude reports \
		--exclude '.docker-build-cache*' --filter=':- .gitignore' "$root/" "$host:$dir/"
}

# The admin part of each side (E2E_ADMIN_PART): of three parts the remote, about twice as fast, runs the first two (four
# of the six admin projects, all journeys) and this machine the third, a journey and the harness (e2e/projects.ts deals
# them out; a run without the admin tier ignores it). Measured on 2026-10-17 with the state checks: halves left this machine's two journeys the last to end.
readonly REMOTE_ADMIN_PART=1-2/3 LOCAL_ADMIN_PART=3/3

# The remote part: each Playwright stage with the remote's shard and admin part, every stage even after a failure. The
# remote shell splits the arguments again, so E2E_TIER travels as `tier=<value>` (an empty value would vanish).
run_remote() {
	ssh "${SSH_OPTIONS[@]}" "$host" bash -s -- "$dir" "$remote_shard" "$REMOTE_ADMIN_PART" "tier=${E2E_TIER:-}" "${stages[@]}" <<'REMOTE'
dir=$1 shard=$2 admin=$3 tier=${4#tier=}
shift 4
cd -- "$dir" || exit 2
rc=0
for stage in "$@"; do
	PIPELINE_STAGE=$stage E2E_SHARD=$shard E2E_ADMIN_PART=$admin E2E_TIER=$tier bash scripts/ci/run-all-checks.sh </dev/null || rc=1
done
exit "$rc"
REMOTE
}

run_local() {
	PIPELINE_STAGE=$stage E2E_SHARD=$local_shard E2E_ADMIN_PART=$LOCAL_ADMIN_PART bash "$root/scripts/ci/run-all-checks.sh"
}

# The remote's part on this machine, after a dropped connection.
run_remote_here() {
	local rc=0 part
	for part in "${stages[@]}"; do
		PIPELINE_STAGE=$part E2E_SHARD=$remote_shard E2E_ADMIN_PART=$REMOTE_ADMIN_PART bash "$root/scripts/ci/run-all-checks.sh" || rc=1
	done
	return "$rc"
}

# Copies this machine's blob reports aside: a later Playwright run here (the fallback) empties reports/blob/.
keep_blobs() {
	local from=$1 part name
	for part in "${stages[@]}"; do
		name=$(report_name "$part")
		mkdir -p "$merge_root/$name"
		cp "$from/$name/"*.zip "$merge_root/$name/" 2>/dev/null || say "no blob report of $part in ${from#"$root"/}"
	done
	return 0
}

# Merges the two parts of every Playwright run into reports/junit/<name>.xml and, when `$1` is html (a part failed),
# into one HTML report, reports/playwright<suffix>/ (each part keeps its own: reports/playwright*/ of this machine's,
# reports/split/<host>/playwright*/ of the host's). The e2e config gives the merge this tree's test folders: the
# host's blob names its own paths.
merge_reports() {
	local reporters=junit rc=0 part name suffix
	[[ $1 != html ]] || reporters=junit,html
	for part in "${stages[@]}"; do
		name=$(report_name "$part")
		suffix=${name#e2e}
		docker run --rm --init --user "$(id -u):$(id -g)" --env HOME=/tmp --env PLAYWRIGHT_HTML_OPEN=never \
			--env PLAYWRIGHT_JUNIT_OUTPUT_FILE="$root/reports/junit/$name.xml" \
			--env PLAYWRIGHT_HTML_OUTPUT_DIR="$root/reports/playwright$suffix" \
			--volume "$root:$root" --workdir "$root/e2e" "$image" "$root/node_modules/.bin/playwright" \
			merge-reports --config playwright.config.ts --reporter "$reporters" "$merge_root/$name" || rc=1
	done
	return "$rc"
}

local_only() {
	say "$1: stage '$stage' runs here only"
	exec bash "$root/scripts/ci/run-all-checks.sh"
}

main() {
	root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
	stage=${PIPELINE_STAGE:-all}
	export PIPELINE_STAGE=$stage
	image=${HCM_IMAGE:-hcm-quality:local}
	host=${HCM_SPLIT_HOST-nuc}
	dir=${HCM_SPLIT_DIR:-hcm-ci}
	read -ra stages <<<"$(playwright_stages "$stage")"
	((${#stages[@]} > 0)) || local_only "no Playwright run in it"
	[[ -n $host ]] || local_only "HCM_SPLIT_HOST is empty"
	[[ $host =~ ^[A-Za-z0-9._@-]+$ && $dir =~ ^[A-Za-z0-9._/-]+$ && ${E2E_TIER:-} =~ ^[a-z,-]*$ ]] ||
		local_only "HCM_SPLIT_HOST, HCM_SPLIT_DIR or E2E_TIER has characters this script does not pass on"
	local parts here there total
	parts=${HCM_SPLIT_PARTS:-$(default_parts "$stage")}
	[[ $parts =~ ^([1-9][0-9]*):([1-9][0-9]*)$ ]] || local_only "HCM_SPLIT_PARTS must be <here>:<remote>, got '$parts'"
	here=${BASH_REMATCH[1]} there=${BASH_REMATCH[2]} total=$((here + there))
	# The host takes the head of the queue (e2e/projects.ts: the long tour tests) and this machine the tail of short
	# functional tests; each takes its part of the admin tier besides (E2E_ADMIN_PART).
	remote_shard=$(shard_range 1 "$there" "$total")
	local_shard=$(shard_range $((there + 1)) "$total" "$total")
	command -v rsync >/dev/null || local_only "rsync is not installed here"

	local prepared=0
	prepare_remote || prepared=$?
	case $prepared in
	0) ;;
	3) local_only "$host has no docker or no rsync" ;;
	4) local_only "another split holds $host ($dir.split-lock)" ;;
	"$SSH_FAILED") local_only "$host does not answer" ;;
	*)
		release_remote
		local_only "$host could not prepare $dir (exit $prepared)"
		;;
	esac
	trap release_remote EXIT
	local label=${host//[^A-Za-z0-9._-]/_}
	merge_root="$root/reports/split/merge"
	rm -rf "$merge_root" "$root/reports/split/$label"
	sync_tree
	say "stage '$stage': $local_shard here, $remote_shard on $host (${stages[*]}; admin part $LOCAL_ADMIN_PART here, $REMOTE_ADMIN_PART there)"

	local started=$SECONDS remote_pid remote_rc=0 local_rc=0
	(
		rc=0
		run_remote 2>&1 | prefix "$host" || rc=${PIPESTATUS[0]}
		say "$host: exit $rc after $((SECONDS - started)) s"
		exit "$rc"
	) &
	remote_pid=$!
	run_local 2>&1 | prefix local || local_rc=${PIPESTATUS[0]}
	say "here: exit $local_rc after $((SECONDS - started)) s"
	keep_blobs "$root/reports/blob"
	wait "$remote_pid" || remote_rc=$?
	mkdir -p "$root/reports/split/$label"
	rsync -a -e "ssh ${SSH_OPTIONS[*]}" "$host:$dir/reports/" "$root/reports/split/$label/" || say "could not copy the reports of $host"
	if ((remote_rc == SSH_FAILED)); then
		say "the connection to $host dropped: running its part ($remote_shard) here"
		remote_rc=0
		run_remote_here 2>&1 | prefix local || remote_rc=${PIPESTATUS[0]}
		keep_blobs "$root/reports/blob"
	else
		keep_blobs "$root/reports/split/$label/blob"
	fi

	local merge_rc=0 html=no
	((local_rc == 0 && remote_rc == 0)) || html=html
	merge_reports "$html" 2>&1 | prefix merge || merge_rc=${PIPESTATUS[0]}
	local marker="reports/pipeline/green-$stage.json"
	if ((local_rc == 0 && remote_rc == 0 && merge_rc == 0)); then
		echo "[SUCCESS] stage '$stage' passed ($marker; Playwright split: $local_shard here, $remote_shard on $host, $((SECONDS - started)) s)"
		return 0
	fi
	rm -f "$root/$marker"
	echo "[FAILURE] stage '$stage' failed: here (exit $local_rc), $host (exit $remote_rc), report merge (exit $merge_rc); logs above, reports in reports/split/"
	return 1
}

if [[ ${BASH_SOURCE[0]} == "$0" ]]; then
	main "$@"
fi
