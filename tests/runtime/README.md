# Isolated Linux test runtime

This separate npm lock installs only the official `@anthropic-ai/claude-code-linux-x64@2.1.281` native package for Linux x64/glibc CI. It is not part of Skynet's product dependencies, collector, production Worker or employee installation. The version matches the existing supported test protocol and `Dockerfile.analysis`.

The package's npm registry metadata was checked on 2026-10-04. The lock records its exact tarball URL and `sha512-Z7ld7AE2AtvghO0qlNFBGD8S2w+nPVUk8uq4UprAUKJr6HHavXm605iGhbzSOTgXu3F/y540JHVUW9ON87w4IQ==`. `npm ci --prefix tests/runtime --ignore-scripts --no-audit --no-fund` verifies that integrity without running installation scripts. CI then checks the exact `2.1.281 (Claude Code)` version output and retains the binary SHA-256 with the source and lock hash.

The lock was prepared on Windows with `--package-lock-only --ignore-scripts --force` solely to describe the Linux package: no native package was installed or executed by that command. CI uses normal platform checks, without `--force`. On Windows use the explicitly measured Windows test runtime in `SKYNET_CLAUDE_RUNTIME`; do not attempt to execute this Linux package or treat its presence as Windows verification.

Public tests create their own isolated Claude configuration and loopback provider with a synthetic zero-price fixture. No private model key, employee conversation, user profile, production Worker or paid endpoint is used by this setup. Running the real CLI against loopback verifies the application path; it does not accept Qwen PAYG, Desktop UI, G3, G4 or trial calibration.
