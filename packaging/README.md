# Packaging

This directory contains packaging templates for distributing OpenPawz across
different platforms. Each subdirectory is self-contained.

## Status

All templates use **placeholder SHA256 hashes** that must be replaced with real
values once release binaries are built and uploaded to GitHub Releases.

| Package | Directory | Notes |
|---------|-----------|-------|
| **Homebrew** | `homebrew/` | Copy `openpawz.rb` to a `OpenPawz/homebrew-tap` repo as `Formula/openpawz.rb`. Users install with `brew install OpenPawz/tap/openpawz`. |
| **AUR** | `aur/` | Publish `PKGBUILD` to the Arch User Repository as `openpawz-bin`. |
| **Flatpak** | `flatpak/` | Submit the manifest + desktop/metainfo files as a PR to `flathub/flathub`. Requires a stable release. |
| **Snap** | `snap/` | Move `snapcraft.yaml` to `snap/snapcraft.yaml` in the repo root (or a dedicated snap repo). Publish to the Snap Store. |

## Before Publishing

1. Build release binaries via `tauri build` (or CI)
2. Upload them to the GitHub Release for the tag
3. Compute SHA256 hashes: `shasum -a 256 <file>`
4. Replace all `PLACEHOLDER_*` values in the templates
5. Follow each platform's submission process
