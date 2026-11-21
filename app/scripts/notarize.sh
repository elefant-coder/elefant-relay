#!/bin/bash
# Notarize + staple the built DMG, check Gatekeeper, and replace the file on the GitHub release.
# Needs Apple's developer agreement signed (otherwise notarytool returns 403).
# Build with APPLE_KEYCHAIN_PROFILE=agent-academy-notary npm run dist so electron-builder notarizes and staples the .app
# before making the DMG (then the app opens offline too); this script notarizes and staples the DMG itself.
# Usage: app/scripts/notarize.sh [release-tag]   (default: mac-v<version>)
set -euo pipefail
cd "$(dirname "$0")/.."
VER=$(node -p 'require("./package.json").version')
TAG=${1:-mac-v$VER}
PROFILE=${NOTARY_PROFILE:-agent-academy-notary}
DMG="release/Elefant Relay-$VER-universal.dmg"
APP="release/mac-universal/Elefant Relay.app"
[ -f "$DMG" ] || { echo "no $DMG — run: npm run dist"; exit 1; }
xcrun notarytool submit "$DMG" --keychain-profile "$PROFILE" --wait
xcrun stapler validate "$APP"
xcrun stapler staple "$DMG"
spctl -a -vv -t install "$DMG"
OUT="release/ElefantRelay-$VER-universal.dmg"; cp "$DMG" "$OUT"
gh release upload "$TAG" "$OUT" --clobber -R elefant-coder/elefant-relay
echo "done: notarized and uploaded to $TAG"
