#!/bin/zsh
# Render U031 launchd templates for this checkout. Rendering never installs jobs.
set -euo pipefail

die() { print -u2 -r -- "render-launch-agents: $*"; exit 64; }
[[ $# -eq 1 ]] || die "usage: $0 <new-empty-output-dir>"

AUTOMATION_DIR="${0:A:h}"
SERVICE_ROOT="${AUTOMATION_DIR:h}"
OUTPUT_DIR="${1:A}"

[[ -f "$SERVICE_ROOT/package.json" ]] || die "missing service package manifest"
grep -Eq '"name"[[:space:]]*:[[:space:]]*"sangfor-engineer-mcp"' "$SERVICE_ROOT/package.json" || die "unexpected service package"
[[ -d "$OUTPUT_DIR" ]] || die "output directory does not exist"
[[ -z "$(find "$OUTPUT_DIR" -mindepth 1 -maxdepth 1 -print -quit)" ]] || die "output directory must be empty"

typeset -a names scripts
names=(com.jmpark.sangfor.learnall.plist com.jmpark.sangfor.learnkb.plist)
scripts=(automation/scripts/run-learnall.sh automation/scripts/run-learn-kb-full.sh)
for target in $scripts; do
  [[ -f "$SERVICE_ROOT/$target" ]] || die "missing target script: $target"
done

for name in $names; do
  template="$AUTOMATION_DIR/templates/${name}.template"
  [[ -f "$template" ]] || die "missing template: $template"
  escaped_root="${SERVICE_ROOT//|/\\|}"
  sed "s|__SERVICE_ROOT__|$escaped_root|g" "$template" > "$OUTPUT_DIR/$name"
done

print -r -- "rendered ${#names} launch-agent plists for $SERVICE_ROOT"
