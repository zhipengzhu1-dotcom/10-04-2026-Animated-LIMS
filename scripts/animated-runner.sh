#!/usr/bin/env bash
# CI's runners in Docker on the owner's Mac (docs/ci-runner.md). Each pass of a slot registers a just-in-time runner
# that takes one job in a fresh container and then deregisters, so no job sees another job's workspace.
# The registration comes from gh api at each pass and lives only in the container's arguments, never in a file.
# Every name here starts with animated-runner, so start, stop and status never touch another project's runners.
set -euo pipefail
REPO=zhipengzhu1-dotcom/10-04-2026-Animated-LIMS
IMAGE=ghcr.io/actions/actions-runner:2.337.0@sha256:f5a0d9a3d857315f2aed7075a02a29f46927ad198221c3b1c66585ae9fe36c0d
SLOTS=(1 2)
LOGS="$HOME/Library/Logs/animated-runner"

case "${1:-}" in
  slot)
    SLOT=${2:?usage: scripts/animated-runner.sh slot 1|2}
    while true; do
      docker rm -f "animated-runner-$SLOT" >/dev/null 2>&1 || true
      # Docker stopped or image missing: wait here, so no runner registers that cannot start.
      docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE" >/dev/null || { sleep 30; continue; }
      # runner_group_id 1 is the repo's Default runner group.
      CONFIG=$(gh api -X POST "repos/$REPO/actions/runners/generate-jitconfig" -f name="animated-runner-$SLOT-$(date +%s)" \
        -F runner_group_id=1 -f 'labels[]=self-hosted' -f 'labels[]=Linux' -f 'labels[]=ARM64' -f 'labels[]=animated' \
        --jq .encoded_jit_config) || { sleep 30; continue; }
      docker run --rm --name "animated-runner-$SLOT" "$IMAGE" ./run.sh --jitconfig "$CONFIG" || sleep 30
    done
    ;;
  start)
    # A second loop for a slot would remove the first loop's container mid-job.
    if pgrep -f 'animated-runner\.sh slot' >/dev/null; then echo "The slots are already running. Run stop first." >&2; exit 1; fi
    mkdir -p "$LOGS"
    for n in "${SLOTS[@]}"; do
      # caffeinate holds off idle sleep while the slot runs. A sleeping Mac freezes the runner, and GitHub fails its job.
      nohup caffeinate -i "$0" slot "$n" >>"$LOGS/$n.log" 2>&1 &
    done
    ;;
  stop)
    pkill -f 'animated-runner\.sh slot' || true
    for n in "${SLOTS[@]}"; do docker rm -f "animated-runner-$n" >/dev/null 2>&1 || true; done
    gh api --paginate "repos/$REPO/actions/runners" --jq '.runners[] | select(.name | startswith("animated-runner-")) | .id' |
      while read -r id; do gh api -X DELETE "repos/$REPO/actions/runners/$id" || echo "runner $id not deleted" >&2; done
    ;;
  status)
    gh api --paginate "repos/$REPO/actions/runners" --jq '.runners[] | [.name, .status, .busy] | @tsv'
    if pgrep -f '^caffeinate -i .*animated-runner\.sh slot' >/dev/null; then echo "The slots keep the Mac awake."
    else echo "No slot keeps the Mac awake. Run stop, then start." >&2; exit 1; fi ;;
  *) echo "usage: scripts/animated-runner.sh start|status|stop|slot 1|2" >&2; exit 2 ;;
esac
