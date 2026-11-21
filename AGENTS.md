# AGENTS.md — working on Elefant Relay

For AI agents (Claude Code, Codex) and people. Short on purpose: rules here are enforced by scripts where possible.

## What this is
- `src/` the CLI + MCP server (npm `elefant-relay`), `relay/` the Cloudflare relay, `app/` the Mac/Windows app (Electron, same code).
- Promises to users that must never break: messages are end-to-end encrypted (the relay can't read them); a friend's request runs
  only after the user allows it; requests run with read-only tools and cannot read the key folder; in AI-to-AI mode the user's AI
  runs with no tools and no CLAUDE.md / memory, and every message it sends is shown for OK first.

## The loop for any change
1. **Reproduce first.** Write the check that shows the problem (it must fail now). UI problems: a real-mouse check in
   `app/test/driver-clicks.mjs` (`press` / `mouseDown` / `mouseUp` from `app/test/ui.mjs`); library problems: `test/*.test.ts`.
   `element.click()` cannot lose a click to a redraw — never use it to test clicking.
2. Fix with the smallest change.
3. **Gate:** `harness/check.sh` (≈6 min; `--quick` for typecheck + tests while iterating). It must say PASS before you call it done.
4. **Independent verifier** for anything users will download: hand `harness/verify-brief.md` to a fresh agent. Fix what it
   finds, move its reproduction scripts into `app/test/` or `test/`, and add a row to `harness/CASES.md`.
5. **Release** only with `harness/release.sh <version> --notes FILE` (try `--dry-run` first). It refuses without a gate pass on
   the exact commit and green Windows CI, tags before creating the release, notarizes, uploads, checks the downloads match the
   commit, moves the landing page links, and points older releases at the new one.

## Rules
- Tests live in the repo. Never leave a check only in /tmp — it is gone the next day.
- Proving a check: in a worktree of HEAD, put back only the old file(s) (`git show <old>:path > path`), run the check, see it
  fail; then see it pass on HEAD. Record both in `harness/CASES.md`.
- The screen redraws from data (`refresh()` in `app/renderer/app.js`). Anything that redraws must go through the press guard
  (`pressing` / `held`); don't call `render()` from async callbacks — use `renderSoon()`.
- `npm test` must stay offline and fast; app tests use the echo agent (`test/fixtures/echo-agent.mjs`), never a real AI.
- Windows CI (`.github/workflows/windows.yml`) builds the installer that is shipped. If it fails once with a runner error
  (e.g. UnknownVizError) re-run the failed job; twice means a real problem.
- In zsh, write `"${v}:path"`, not `$v:path` (`:a` / `:h` are modifiers).
- Don't publish to npm, push tags, or create releases outside `harness/release.sh`. The owner decides when to release.
