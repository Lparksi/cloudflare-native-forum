#!/usr/bin/env bash
set -euo pipefail
# Official self-contained archive, SHA-256 from the GitHub release asset digest:
# https://github.com/aboutcode-org/scancode-toolkit/releases/tag/v32.4.1
# Requires Linux x86_64 and Python 3.12; no pip network resolution.
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]]
python3.12 --version
: "${RUNNER_TEMP:?Set RUNNER_TEMP to a temporary tools directory}"
archive="$RUNNER_TEMP/scancode-toolkit.tar.gz"
tool="$RUNNER_TEMP/scancode-toolkit"
curl --fail --silent --show-error --location --retry 3 \
  https://github.com/aboutcode-org/scancode-toolkit/releases/download/v32.4.1/scancode-toolkit-v32.4.1_py3.12-linux.tar.gz \
  -o "$archive"
echo "856fec5d06c7701a8a77c9d9d92235495a71602be74a542d5836a1ab8a9cc420  $archive" | sha256sum --check -
mkdir -p "$tool"
tar -xzf "$archive" -C "$tool" --strip-components=1
(cd "$tool" && ./configure)
"$tool/scancode" --version
