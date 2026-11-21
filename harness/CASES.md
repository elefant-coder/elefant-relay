# Cases — bugs that shipped, and the check that now catches each

Add one row every time a bug reaches users or a verifier sends work back. A case is done only when its check
**fails on the old code and passes on the fix**. Timing checks sweep the delay in small steps; they catch
old code at a few points (record which), so keep the steps fine (prove it: see "Proving a check" in AGENTS.md).

| # | Version | What people saw | Cause | Check | Proven on old code |
|---|---|---|---|---|---|
| 1 | 0.2.0 | "Enter a code" did nothing | the screen redrew every 1.5 s and reset the tab | clicks C1, C3 | 822c83c: C1 FAIL (4 redraws idle), C3 never reached |
| 2 | 0.2.0 | could not pick "6 rounds" | a `<select>` closed when the screen redrew | clicks C6 | (menu replaced by buttons; C6 needs the buttons) |
| 3 | 0.2.1 | first click after opening/closing the dialog lost | dialog kind in the "changed?" signature → extra redraw | clicks C2, C3 | 41c594d: C2 4/4 extra redraws, C3 lost at 250/300 ms (of 31) |
| 4 | 0.2.1 | a click held while something arrives is lost | redraw between press and release replaces the button | clicks C4, C7 | 41c594d: C4 3/3, C7 wrong choice |
| 5 | 0.2.2 | button pressed ~0.5 s after Send did nothing | only polls waited for the press; Send's redraw did not | clicks C8 | f82163a and 41c594d: lost at 400/440/480 ms (of 27) |
| 6 | 0.2.2 | Cancel held while the friend joins → no check number | `close` cleared whatever dialog was open | clicks C5 | f82163a: FAIL |
| 7 | 0.1.0–0.2.1 | friend "paired", this side waits forever | finishInvites wrote back a stale invite list | test/invites.test.ts | 41c594d pair.ts: FAIL |
| 8 | 0.2.0 (dev) | the app could not open a friend's message | Electron (BoringSSL) has no chacha20-poly1305 | test/aead.test.ts | — |
| 9 | 0.1.0 | requests never picked up | a listener from an older setup kept the old mailbox | test/listener.test.ts | — |
| 10 | 0.2.0 (dev) | long chats pushed the input box off the window | the page grew instead of the message list | run-pair `checkLayout` | — |
| 11 | 0.2.0 (dev) | AI-to-AI answered with the user's private notes | the tool-less AI still loaded CLAUDE.md / memory | run-pair FAKE_LOG checks (Windows CI) | — |

## Known gaps (no check yet)
- Windows timing: the click checks run on macOS only (locally and in .github/workflows/check.yml); Windows CI runs run-pair/run-extra.
- Real Claude Code / Codex on Windows, SmartScreen, Windows on ARM, a Japanese-language Windows.
- A mouse released outside the window (sendInputEvent does not go through the OS capture).
