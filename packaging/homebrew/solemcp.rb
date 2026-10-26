class Solemcp < Formula
  desc "Local control plane for MCP servers"
  homepage "https://github.com/omerTajElsir/solemcp"
  url "https://github.com/omerTajElsir/solemcp/releases/download/v0.0.0/solemcp-0.0.0-macos-arm64.tar.gz"
  # PLACEHOLDER_SHA256 is not a real checksum. Fill it from the release SHA256SUMS
  # when a tag is cut:
  #   packaging/homebrew/fill-checksum.sh dist/release/SHA256SUMS solemcp-0.0.0-macos-arm64.tar.gz
  sha256 "PLACEHOLDER_SHA256"
  license "Apache-2.0"

  # The release asset is a versioned tarball of the bundle plus a launcher.
  # It still needs Node.js 22. Node SEA is not used: the loader runs the blob
  # as CommonJS, and the SoleMCP bundle is ESM.
  depends_on "node@22"

  def install
    libexec.install "solemcp.mjs"
    libexec.install "ui" if Dir.exist?("ui")
    (bin/"solemcp").write <<~EOS
      #!/bin/bash
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/solemcp.mjs" "$@"
    EOS
  end

  test do
    assert_match "solemcp", shell_output("#{bin}/solemcp --help")
  end
end
