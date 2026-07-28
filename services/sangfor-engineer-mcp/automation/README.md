# macOS learning-agent templates

The two tracked plist files are templates only. They intentionally contain no
checkout-specific path and must not be copied or installed as-is.

Render fresh plist outputs for the current checkout from any directory:

```bash
output_dir="$(mktemp -d)"
automation/render-launch-agents.sh "$output_dir"
plutil -lint "$output_dir"/*.plist
```

The renderer resolves its own service root, verifies the package manifest and
runner scripts, and has no installation side effect. Check the rendered
`ProgramArguments[0]` and `WorkingDirectory` before any separately approved
manual launch-agent operation. Existing installed jobs are
`MANUAL_EXTERNAL_PENDING`; this repository does not install, unload, or start
them.

The runner scripts resolve this checkout from their own locations. An explicit
`SANGFOR_REPO_DIR` is accepted only when it names a directory with the
`sangfor-engineer-mcp` package manifest.
