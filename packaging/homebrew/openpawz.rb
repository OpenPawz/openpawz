# OpenPawz Homebrew Formula
# Install: brew install OpenPawz/tap/openpawz
#
# This formula should live in the OpenPawz/homebrew-tap repository.
# Copy this file to that repo as Formula/openpawz.rb

class Openpawz < Formula
  desc "Multi-agent AI desktop app — fully local, open source"
  homepage "https://github.com/OpenPawz/openpawz"
  version "0.1.0"
  license "MIT"

  on_macos do
    if Hardware::CPU.arm?
      url "https://github.com/OpenPawz/openpawz/releases/download/v#{version}/openpawz_#{version}_aarch64.dmg"
      sha256 "PLACEHOLDER_ARM64_SHA256"
    else
      url "https://github.com/OpenPawz/openpawz/releases/download/v#{version}/openpawz_#{version}_x64.dmg"
      sha256 "PLACEHOLDER_X64_SHA256"
    end
  end

  on_linux do
    url "https://github.com/OpenPawz/openpawz/releases/download/v#{version}/openpawz_#{version}_amd64.AppImage"
    sha256 "PLACEHOLDER_LINUX_SHA256"
  end

  def install
    if OS.mac?
      # Extract .app from .dmg and install to prefix
      prefix.install Dir["*.app"].first
    else
      bin.install "openpawz_#{version}_amd64.AppImage" => "openpawz"
    end
  end

  def caveats
    <<~EOS
      OpenPawz has been installed.

      To start: open the app from your Applications folder (macOS)
      or run `openpawz` from the command line (Linux).

      Documentation: https://github.com/OpenPawz/openpawz
    EOS
  end

  test do
    assert_predicate prefix/"Open Pawz Desktop.app", :exist? if OS.mac?
    assert_predicate bin/"openpawz", :exist? if OS.linux?
  end
end
