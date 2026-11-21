#!/bin/bash
# Release the Mac/Windows app. The only way to ship: it refuses unless the gate passed on this exact commit
# and Windows CI is green for it, and it checks that what people download is what was tested.
#
#   harness/release.sh 0.2.3 --notes /tmp/notes.md --dry-run   check everything, change nothing
#   harness/release.sh 0.2.3 --notes /tmp/notes.md             bump → gate → push → CI → tag → release → Mac (notarize) → Windows → verify → LP
#
# Local settings (not committed): harness/release.local.env — see harness/release.example.env
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
VER=${1:?usage: harness/release.sh <version> --notes FILE [--dry-run]   |   harness/release.sh --verify <version>}
shift
NOTES="" DRY=0 VERIFY_ONLY=0
if [ "$VER" = "--verify" ]; then VERIFY_ONLY=1; VER=${1:?usage: harness/release.sh --verify <version>}; shift; fi
while [ $# -gt 0 ]; do case $1 in --notes) NOTES=$2; shift 2;; --dry-run) DRY=1; shift;; *) echo "unknown: $1"; exit 2;; esac; done
[ -f harness/release.local.env ] && source harness/release.local.env
REPO=${RELEASE_REPO:-elefant-coder/elefant-relay}
TAG="mac-v$VER"
say() { printf '\n== %s\n' "$*"; }
die() { echo "STOP: $*" >&2; exit 1; }
run() { if [ $DRY = 1 ]; then echo "(dry-run) $*"; else "$@"; fi; }

verify_downloads() { # what people download == the tested commit ($VER $TAG $SHA)
  V=$(mktemp -d); M=$(mktemp -d); X=$(mktemp -d)
  trap 'hdiutil detach -quiet "$M" 2>/dev/null || true; rm -rf "$V" "$X"' EXIT
  for f in "ElefantRelay-$VER-universal.dmg" "ElefantRelay-Setup-$VER-x64.exe"; do
    curl -sSfL -o "$V/$f" "https://github.com/$REPO/releases/download/$TAG/$f"
    want=$(gh release view "$TAG" -R "$REPO" --json assets -q ".assets[] | select(.name==\"$f\") | .digest" | sed 's/^sha256://')
    got=$(shasum -a 256 "$V/$f" | cut -d' ' -f1)
    [ -z "$want" ] || [ "$want" = "$got" ] || die "$f: sha256 differs from the release"
    echo "ok $f $got"
  done
  xattr -w com.apple.quarantine "0081;$(printf %x "$(date +%s)");Safari;" "$V/ElefantRelay-$VER-universal.dmg"
  spctl -a -vv -t install "$V/ElefantRelay-$VER-universal.dmg" 2>&1 | grep -q "Notarized Developer ID" || die "DMG is not notarized"
  hdiutil attach -quiet -readonly -nobrowse -mountpoint "$M" "$V/ElefantRelay-$VER-universal.dmg"
  xcrun stapler validate "$M/Elefant Relay.app" >/dev/null || die ".app has no notarization ticket"
  "$ROOT/app/node_modules/.bin/asar" extract "$M/Elefant Relay.app/Contents/Resources/app.asar" "$X"
  for f in main.mjs chat.mjs preload.cjs $(git ls-tree -r --name-only "$SHA" app/renderer | sed 's#^app/##'); do
    cmp -s "$X/$f" <(git show "$SHA:app/$f") || die "the DMG's $f is not the tested commit"
  done
  diff <(cd "$X" && find renderer -type f | sort) <(git ls-tree -r --name-only "$SHA" app/renderer | sed 's#^app/##' | sort) >/dev/null || die "the DMG's renderer/ has files that are not in git at $SHA"
  # lib/ is the compiled src/ of the same commit
  L=$(mktemp -d); git archive "$SHA" src tsconfig.json package.json | tar -x -C "$L"; ln -s "$ROOT/node_modules" "$L/node_modules"
  (cd "$L" && npx tsc -p . --outDir out >/dev/null) || die "could not compile src at $SHA"
  diff -rq -x relay-package.json "$X/lib" "$L/out/src" >/dev/null || die "the DMG's lib/ is not src/ at $SHA"
  cmp -s "$X/lib/relay-package.json" <(git show "$SHA:package.json") || die "the DMG's lib/relay-package.json is not package.json at $SHA"
  rm -rf "$L"
  if [ -n "${EXE_SHA:-}" ]; then [ "$(shasum -a 256 "$V/ElefantRelay-Setup-$VER-x64.exe" | cut -d' ' -f1)" = "$EXE_SHA" ] || die "the EXE is not the one CI built"; fi
  echo "ok DMG notarized, stapled, app files and lib/ match $SHA${EXE_SHA:+; EXE is the CI build}"
}

if [ $VERIFY_ONLY = 1 ]; then # check an existing release only
  git fetch -q --tags origin; SHA=$(git rev-list -n1 "$TAG"); echo "$TAG = $SHA"; verify_downloads; exit 0
fi

say "0. preconditions"
[[ $VER =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || die "version must look like 0.2.3"
[ -n "$NOTES" ] && [ -f "$NOTES" ] || die "--notes FILE is required (what changed, in English, for the release page)"
[ -z "$(git status --porcelain)" ] || die "uncommitted or untracked files (they could end up in the app)"
[ "$(git branch --show-current)" = main ] || die "not on main"
git fetch -q origin main
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || [ "$(git merge-base HEAD origin/main)" = "$(git rev-parse origin/main)" ] || die "behind origin/main"
git fetch -q --tags origin
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  [ "$(git rev-list -n1 "$TAG")" = "$(git rev-parse HEAD)" ] || die "tag $TAG exists on another commit"
  echo "tag $TAG already on HEAD: resuming a release that stopped part-way"
fi
PUBLISHED=0
if [ "$(gh release view "$TAG" -R "$REPO" --json isDraft -q .isDraft 2>/dev/null || echo none)" = false ]; then
  git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || die "release $TAG is published but the tag is not here"
  PUBLISHED=1; echo "release $TAG is already published from HEAD: redoing only the checks, the landing page and older releases"
fi
if [ -n "${LP_DIR:-}" ]; then
  [ -f "$LP_DIR/content.html" ] && [ -d "$LP_DIR/deploy" ] || die "LP_DIR must hold content.html and deploy/"
  [ -n "${LP_URL:-}" ] || die "set LP_URL in harness/release.local.env"
  grep -q 'releases/download/mac-v[0-9.]*/' "$LP_DIR/content.html" || die "no download link found in $LP_DIR/content.html"
fi
gh auth status >/dev/null 2>&1 || die "gh is not signed in"
xcrun notarytool history --keychain-profile "${NOTARY_PROFILE:?set NOTARY_PROFILE in harness/release.local.env}" >/dev/null 2>&1 || die "notarytool profile $NOTARY_PROFILE does not work (Apple agreement? keychain?)"
CUR=$(node -p 'require("./app/package.json").version')
echo "app $CUR → $VER, tag $TAG, repo $REPO"

say "1. bump the version"
if [ "$CUR" != "$VER" ]; then
  if [ $DRY = 1 ]; then echo "(dry-run) set app/package.json + lock to $VER and commit"; else
    node -e 'for (const f of ["app/package.json","app/package-lock.json"]) { const fs=require("fs"); const j=JSON.parse(fs.readFileSync(f)); j.version=process.argv[1]; if (j.packages?.[""]) j.packages[""].version=process.argv[1]; fs.writeFileSync(f, JSON.stringify(j,null,2)+"\n"); }' "$VER"
    git commit -q -m "app $VER" app/package.json app/package-lock.json
  fi
fi
SHA=$(git rev-parse HEAD)

say "2. the gate on $SHA"
if [ "$(cut -d' ' -f1 harness/out/last-pass 2>/dev/null)" = "$SHA" ]; then echo "already passed: $(cat harness/out/last-pass)"
else harness/check.sh || die "the gate failed — fix it first"; fi

say "3. push and wait for CI on $SHA (Windows build + macOS gate)"
run git push -q origin main
if [ $DRY = 1 ]; then
  for w in windows.yml check.yml; do echo "(dry-run) $w on HEAD: $(gh run list -R "$REPO" -w $w -c "$SHA" -L 1 --json conclusion,databaseId -q '.[0] | "\(.databaseId) \(.conclusion)"' 2>/dev/null) (a real run needs both 'success')"; done
else
  for _ in $(seq 60); do RUN=$(gh run list -R "$REPO" -w windows.yml -c "$SHA" -L 1 --json databaseId -q '.[0].databaseId'); [ -n "$RUN" ] && break; sleep 10; done
  [ -n "${RUN:-}" ] || die "no Windows CI run started for $SHA"
  if ! gh run watch "$RUN" -R "$REPO" --exit-status --interval 30 >/dev/null; then
    echo "Windows CI failed once — retrying the failed job (the runner has flaked before: UnknownVizError)"
    gh run rerun "$RUN" -R "$REPO" --failed; sleep 20
    gh run watch "$RUN" -R "$REPO" --exit-status --interval 30 >/dev/null || die "Windows CI failed twice: gh run view $RUN -R $REPO --log-failed"
  fi
  [ "$(gh run view "$RUN" -R "$REPO" --json headSha -q .headSha)" = "$SHA" ] || die "CI ran a different commit"
  MRUN=$(gh run list -R "$REPO" -w check.yml -c "$SHA" -L 1 --json databaseId -q '.[0].databaseId')
  [ -n "$MRUN" ] && { gh run watch "$MRUN" -R "$REPO" --exit-status --interval 30 >/dev/null || die "the macOS gate on GitHub failed: gh run view $MRUN -R $REPO --log-failed"; }
fi

if [ $PUBLISHED = 0 ]; then
say "4. tag and a draft release (published only after both files are up)"
git rev-parse -q --verify "refs/tags/$TAG" >/dev/null || run git tag "$TAG" "$SHA"
run git push -q origin "$TAG"   # the tag must exist before 'gh release create' (422 otherwise)
gh release view "$TAG" -R "$REPO" >/dev/null 2>&1 || run gh release create "$TAG" -R "$REPO" --verify-tag --draft --prerelease --title "Elefant Relay app $VER (preview) — Mac / Windows" --notes-file "$NOTES"

say "5. Mac: build, notarize the .app, then the DMG, upload"
if [ $DRY = 1 ]; then echo "(dry-run) APPLE_KEYCHAIN_PROFILE=… npm run dist && app/scripts/notarize.sh $TAG"; else
  npm run build >/dev/null   # app/lib is copied from dist/: build it from this commit
  (cd app && APPLE_KEYCHAIN_PROFILE="${APPLE_KEYCHAIN_PROFILE:-$NOTARY_PROFILE}" npm run dist)
  NOTARY_PROFILE="$NOTARY_PROFILE" bash app/scripts/notarize.sh "$TAG"
fi

say "6. Windows: the installer CI built from $SHA"
if [ $DRY = 1 ]; then echo "(dry-run) download artifact 'installer' from the CI run and upload ElefantRelay-Setup-$VER-x64.exe"; else
  W=$(mktemp -d); gh run download "$RUN" -R "$REPO" -n installer -D "$W"
  [ -f "$W/ElefantRelay-Setup-$VER-x64.exe" ] || mv "$W"/*.exe "$W/ElefantRelay-Setup-$VER-x64.exe"
  EXE_SHA=$(tr -d '\r\n ' < "$W/sha256.txt" | tr 'A-F' 'a-f')
  [ "$(shasum -a 256 "$W/ElefantRelay-Setup-$VER-x64.exe" | cut -d' ' -f1)" = "$EXE_SHA" ] || die "installer differs from CI's sha256.txt"
  gh release upload "$TAG" "$W/ElefantRelay-Setup-$VER-x64.exe" -R "$REPO" --clobber
  rm -rf "$W"
fi
fi # PUBLISHED

say "7. verify what people download"
if [ $DRY = 1 ]; then echo "(dry-run) publish the draft (still a pre-release), download both without auth, compare sha256, spctl the DMG, compare app.asar with git"; else
  [ $PUBLISHED = 1 ] || gh release edit "$TAG" -R "$REPO" --draft=false --prerelease >/dev/null
  verify_downloads
fi

say "8. landing page links → $VER"
if [ -n "${LP_DIR:-}" ] && [ -f "$LP_DIR/content.html" ]; then
  OLD=$(grep -o 'releases/download/mac-v[0-9.]*/' "$LP_DIR/content.html" | head -1 | sed 's#releases/download/mac-v##; s#/##' || true)
  [ -n "$OLD" ] || die "no download link found in $LP_DIR/content.html"
  [ -n "${LP_URL:-}" ] || die "set LP_URL in harness/release.local.env"
  echo "LP points at $OLD"
  if [ $DRY = 0 ] && [ "$OLD" != "$VER" ]; then
    cp "$LP_DIR/content.html" "$LP_DIR/content.before-$VER.html"
    sed -i '' "s#mac-v$OLD/ElefantRelay-$OLD-universal.dmg#$TAG/ElefantRelay-$VER-universal.dmg#g; s#mac-v$OLD/ElefantRelay-Setup-$OLD-x64.exe#$TAG/ElefantRelay-Setup-$VER-x64.exe#g; s#releases/tag/mac-v$OLD#releases/tag/$TAG#g" "$LP_DIR/content.html"
    grep -q "mac-v$OLD" "$LP_DIR/content.html" && die "LP still mentions $OLD — check $LP_DIR/content.html"
    cp "$LP_DIR/content.html" "$LP_DIR/deploy/index.html"
    (cd "$LP_DIR/deploy" && vercel deploy --prod --yes >/dev/null)
    sleep 15
    curl -sSf "${LP_URL:?}/?v=$RANDOM" | cmp -s - "$LP_DIR/content.html" || die "the live LP is not the new page yet"
    for u in $(grep -o "https://github.com/$REPO/releases/download/[^\"]*" "$LP_DIR/content.html" | sort -u); do
      curl -sfIL "$u" -o /dev/null || die "LP link broken: $u"
    done
    echo "ok LP live with $VER links"
  fi
else echo "skip: LP_DIR not set"; fi

say "9. point every older release at $VER"
for PREV in $(gh release list -R "$REPO" -L 50 --json tagName -q '.[].tagName' | grep "^mac-v" | grep -vx "$TAG" || true); do
  if [ $DRY = 1 ]; then echo "(dry-run) $PREV: replace its 'newer version' line with $VER"; continue; fi
  B=$(mktemp); { printf '> **A newer version is available: [%s](https://github.com/%s/releases/tag/%s)**. Please download that one.\n\n' "$VER" "$REPO" "$TAG"
    gh release view "$PREV" -R "$REPO" --json body -q .body | sed -E '/^(> )?\*\*A newer version (is available|is out)/,+1d'; } > "$B"
  gh release edit "$PREV" -R "$REPO" --notes-file "$B" >/dev/null; rm -f "$B"; echo "ok $PREV"
done

say "done"
echo "Next: run the independent verifier with harness/verify-brief.md (fill in the request and $TAG), then report."
