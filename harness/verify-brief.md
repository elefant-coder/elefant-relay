# Brief for the independent verifier

Give this to a fresh agent with no memory of the work (Claude: `elefant-kit:verifier`; another model family: `ai-run review`).
Fill in the brackets. **Do not** add what you think was fixed or why — only the request and where to look.

---

Verify read-only and return PASS / PARTIAL / FAIL with evidence. Do not change code, commit, upload or deploy.
You may run tests and write under a new folder in /tmp. Aim for ≤ 40 minutes.

Request (verbatim): [the owner's words]

Targets:
- Code: <repo path> at commit [sha] (diff against the last verified commit: `git diff [old] [sha]`)
- Release: GitHub release [tag] — ElefantRelay-[ver]-universal.dmg and ElefantRelay-Setup-[ver]-x64.exe
- Landing page: [url]

Check:
A. The request works the way the person who asked would use it (real mouse, not element.click()). Try timings around redraws:
   while something arrives, right after Send / Allow / Join, with a slow relay (app/test/proxy.mjs).
B. Nothing that used to work broke: `harness/check.sh` (all steps), and the rows of harness/CASES.md.
C. What people download is the tested commit: download without auth into an empty folder, quarantine + `spctl -a -vv -t install`
   (Notarized), `xcrun stapler validate` on the mounted .app, app.asar's renderer/app.js equals the commit. Unmount at the end.
D. The landing page links point at [ver], return 200, and sizes match the release.

Output: per check PASS/FAIL with evidence; for each problem, steps to reproduce and a suggested fix; overall verdict.
If you write a new reproduction script that catches a real problem, say where it is so it can be moved into app/test/.
