#!/usr/bin/env bash
# Body of the `vitest` gate (`npm test`): runs INSIDE `firebase emulators:exec --project demo-hcm
# --only auth,firestore,storage` (package.json), so every Vitest project shares the emulators: the
# security-rules matrix (firebase/rules-tests) and the emulator-backed functions tests run in the same
# `vitest run --coverage` as the rest, which keeps ONE merged lcov (reports/coverage/ts/lcov.info).
#
# Afterwards it saves the Firestore emulator's rule-coverage report (only reachable while the
# emulators run) to reports/rules/; the `rules-coverage` gate then checks it
# (scripts/ci/check_rules_coverage.py, which streams the JSON report to disk; the HTML view is not asked for). The
# report is saved even when Vitest fails, and the Vitest exit status is preserved.
#
# `npm test` starts the emulators with JAVA_TOOL_OPTIONS='-XX:CICompilerCount=2 -Xmx6g': a heap ceiling of 6 GB per JVM.
# Unset, each may take a quarter of the machine's memory, 3 GB under a 12 GB container cap; the Firestore emulator builds
# the 582 MB JSON report in its heap, which ran out ("Java heap space", HTTP 500) at 3 and 4 GB and passed at 6 GB with the
# whole container at 8.2 GB (DECISIONS-for-review.md §180g). And one C1 and one C2
# compiler thread per JVM instead of about four and eight on 16 hardware threads, whose JIT work
# took about two thirds of the Firestore emulator's CPU in a run this short, beside the tests.
# C1 alone (-XX:TieredStopAtLevel=1) cut that further but made the coverage report
# slower to build than the tests gained (docs/research/pipeline-baseline.md, the tests addendum).
# The Storage emulator echoes the JVM's "Picked up JAVA_TOOL_OPTIONS" line as an "Unexpected rules
# runtime error" warning at start-up; that line is expected.
set -uo pipefail

# No test may reach the network: without this, firebase-admin's Google clients probe the GCE metadata
# server (MetadataLookupWarning ... ETIMEDOUT), which on a busy machine also pushed emulator tests past
# their hook timeouts (CR-M2-34, docs/research/M2-interfaces.md).
export METADATA_SERVER_DETECTION=none

npm run --silent test:unit
status=$?
python3 scripts/ci/check_rules_coverage.py save || status=1
exit "$status"
