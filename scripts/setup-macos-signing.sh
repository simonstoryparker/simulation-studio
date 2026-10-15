#!/bin/bash
set -euo pipefail
: "${APPLE_CERTIFICATE:?Set base64 Developer ID Application p12}"
: "${APPLE_CERTIFICATE_PASSWORD:?Set Application p12 password}"
: "${APPLE_INSTALLER_CERTIFICATE:?Set base64 Developer ID Installer p12}"
: "${APPLE_INSTALLER_CERTIFICATE_PASSWORD:?Set Installer p12 password}"
keychain="$RUNNER_TEMP/studio-signing.keychain-db"
keychain_password="$(openssl rand -hex 24)"
security create-keychain -p "$keychain_password" "$keychain"
security set-keychain-settings -lut 21600 "$keychain"
security unlock-keychain -p "$keychain_password" "$keychain"
printf '%s' "$APPLE_CERTIFICATE" | base64 --decode > "$RUNNER_TEMP/studio-app.p12"
printf '%s' "$APPLE_INSTALLER_CERTIFICATE" | base64 --decode > "$RUNNER_TEMP/studio-installer.p12"
security import "$RUNNER_TEMP/studio-app.p12" -k "$keychain" -P "$APPLE_CERTIFICATE_PASSWORD" -T /usr/bin/codesign -T /usr/bin/productbuild
security import "$RUNNER_TEMP/studio-installer.p12" -k "$keychain" -P "$APPLE_INSTALLER_CERTIFICATE_PASSWORD" -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$keychain_password" "$keychain" >/dev/null
security list-keychains -d user -s "$keychain" "$HOME/Library/Keychains/login.keychain-db"
rm -f "$RUNNER_TEMP/studio-app.p12" "$RUNNER_TEMP/studio-installer.p12"
