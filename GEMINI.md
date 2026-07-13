# Gemini-Specific Operating Charter for Sangfor OS

@AGENTS.md

This file contains optimized guidelines tailored for the Gemini model family running in the Antigravity environment.

## 1. Context & Tool Execution
- **Utilize Context Wisely**: Gemini possesses a very large context window. When investigating a bug or tracing an integration path, read the relevant files completely (up to the 800-line tool limit) to build a solid mental model before proposing changes.
- **Search First**: Use `grep_search` and `run_command` (find/git) to locate targets rather than guessing paths.
- **Strict Verification**: Gemini must always run typechecks, linting, and builds to verify changes (matching F6). Never report completion on assertion alone.

## 2. Thinking & Planning
- **Self-Refutation (F5)**: Before executing any complex plan, explicitly state 2-3 ways the plan could fail and resolve them.
- **Structured Logic**: Format your intermediate steps clearly. If a command fails, log the exact error and change the approach honestly (F10).

## 3. Communication Style
- **Language**: Respond to the user in Korean, as it is their preferred language. Keep all code, variable names, commit messages, and configurations in English.
- **Conciseness**: Lead with the conclusion (F11) in a complete, readable sentence. Do not output unnecessary verbose explanations unless requested.
