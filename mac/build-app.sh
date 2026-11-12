#!/bin/zsh
# Build "OneDrive Manager.app" into ~/Applications.
#   1. `next build` (production server the app launches)
#   2. compile the Swift shell
#   3. assemble the bundle (Info.plist carries project dir + node path)
# Re-run after changing app code so the launched build is current.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node)"
APP="$HOME/Applications/OneDrive Manager.app"
# Port = the one in the registered OAuth redirect URI (single source of truth).
PORT="$(grep -E '^AZURE_REDIRECT_URI=' "$ROOT/.env" | sed -E 's#.*://[^:/]+:([0-9]+).*#\1#')"
[[ "$PORT" == <-> ]] || { echo "Couldn't read a port from AZURE_REDIRECT_URI in .env" >&2; exit 1; }
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "→ next build"
(cd "$ROOT" && npm run build --silent)

echo "→ compiling Swift shell"
swiftc -O "$ROOT/mac/OneDriveManager.swift" -o "$TMP/OneDriveManager"

echo "→ icon"
mkdir -p "$TMP/icon.iconset"
cp "$ROOT/app/icon.png" "$TMP/base.png" >/dev/null
for s in 16 32 128 256 512; do
  sips -z $s $s "$TMP/base.png" --out "$TMP/icon.iconset/icon_${s}x${s}.png" >/dev/null
  sips -z $((s*2)) $((s*2)) "$TMP/base.png" --out "$TMP/icon.iconset/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$TMP/icon.iconset" -o "$TMP/AppIcon.icns"

echo "→ assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$TMP/OneDriveManager" "$APP/Contents/MacOS/"
cp "$TMP/AppIcon.icns" "$APP/Contents/Resources/"
cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>OneDrive Manager</string>
  <key>CFBundleDisplayName</key><string>OneDrive Manager</string>
  <key>CFBundleIdentifier</key><string>xyz.erdman.onedrive-manager</string>
  <key>CFBundleExecutable</key><string>OneDriveManager</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict>
  <key>ODMProjectDir</key><string>$ROOT</string>
  <key>ODMPort</key><integer>$PORT</integer>
  <key>ODMNodePath</key><string>$NODE</string>
</dict></plist>
EOF
codesign --force --sign - "$APP" >/dev/null 2>&1 || true

echo "✓ Built: $APP (port $PORT)"
