#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) 2021 the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

if [[ "$1" != "--force-run" ]]; then
    # This file is supplanted by the GitHub Actions enabled in
    # https://github.com/swiftlang/vscode-swift/pull/1159,
    # Until https://github.com/swiftlang/vscode-swift/pull/1176 is
    # merged we still run the licence check here via the scripts/test.sh
    # with the --force-run flag, and the soundness Jenkins job is skipped
    # with this exit 0. This lets us run this licence check in the GitHub Actions
    # until the standard licence check in GH Actions can be used.
    exit 0
fi

set -eu

original_dir=$(pwd)
cd "$(dirname "$0")/.."

here="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

function replace_acceptable_years() {
    # this needs to replace all acceptable forms with 'YEARS'
    sed -e 's/20[12][0123456789]-20[12][0123456789]/YEARS/' -e 's/20[12][0123456789]/YEARS/'
}

printf "=> Checking license headers... "
tmp=$(mktemp /tmp/.vscode-swift-soundness_XXXXXX)

for language in typescript-or-javascript bash; do
  declare -a matching_files
  matching_files=( -name '*' )
  case "$language" in
      typescript-or-javascript)
        matching_files=( -name '*.js' -o -name '*.ts' )
        cat > "$tmp" <<"EOF"
//===----------------------------------------------------------------------===//
//
// This source file is part of the VS Code Swift open source project
//
// Copyright (c) YEARS the VS Code Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VS Code Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//
EOF
        ;;
      bash)
        matching_files=( -name '*.sh' )
        cat > "$tmp" <<"EOF"
#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) YEARS the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##
EOF
      ;;
    *)
      echo >&2 "ERROR: unknown language '$language'"
      ;;
  esac

  expected_lines=$(wc -l < "$tmp")
  expected_sha=$(shasum < "$tmp")

  (
    cd "$here/.."
    {
        find . \
            \( \! -path './.build/*' -a \
            \( \! -path './node_modules/*' -a \
            \( \! -path './out/*' -a \
            \( \! -path './.vscode-test/*' -a \
            \( \! -path './dist/*' -a \
            \( \! -path './assets/*' -a \
            \( \! -path './coverage/*' -a \
            \( "${matching_files[@]}" \) \
            \) \) \) \) \) \) \) \)
    } | while read -r line; do
      if [[ "$(replace_acceptable_years < "$line" | head -n "$expected_lines" | shasum)" != "$expected_sha" ]]; then
        printf "\033[0;31mmissing headers in file '%s'!\033[0m\n" "$line"
        diff -u <(replace_acceptable_years < "$line" | head -n "$expected_lines") "$tmp"
        exit 1
      fi
    done
    printf "\033[0;32mokay.\033[0m\n"
  )
done

rm "$tmp"
cd "$original_dir"

# printf "=> Checking for broken links in documentation... "
# find . -name node_modules -prune -o -name \*.md -print0 | xargs -0 -n1 npx markdown-link-check
# printf "\033[0;32mokay.\033[0m\n"