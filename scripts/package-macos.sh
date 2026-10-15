#!/bin/bash
set -euo pipefail
bundle="$1"
output="$2"
: "${APPLE_INSTALLER_SIGNING_IDENTITY:?Set the Developer ID Installer identity}"
: "${APPLE_ID:?Set Apple notarization account}"
: "${APPLE_PASSWORD:?Set Apple app-specific password}"
: "${APPLE_TEAM_ID:?Set Apple developer team}"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
pkgbuild --analyze --component "$bundle" "$work_dir/components.plist"
/usr/libexec/PlistBuddy -c 'Set :0:BundleIsRelocatable false' "$work_dir/components.plist"
/usr/libexec/PlistBuddy -c 'Set :0:BundleOverwriteAction upgrade' "$work_dir/components.plist"
/usr/libexec/PlistBuddy -c 'Set :0:BundleHasStrictIdentifier true' "$work_dir/components.plist"
pkgbuild --component "$bundle" --component-plist "$work_dir/components.plist" \
  --install-location /Applications --identifier org.team581.simulation-studio.pkg \
  --version "$STUDIO_VERSION" --scripts scripts/macos-installer "$work_dir/component.pkg"
productbuild --package "$work_dir/component.pkg" --sign "$APPLE_INSTALLER_SIGNING_IDENTITY" "$output"
xcrun notarytool submit "$output" --apple-id "$APPLE_ID" --password "$APPLE_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
xcrun stapler staple "$output"
pkgutil --check-signature "$output"
spctl --assess --type install --verbose "$output"
