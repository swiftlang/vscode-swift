#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VS Code Swift open source project
##
## Copyright (c) 2024 Apple Inc. and the VS Code Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VS Code Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

tag=$1

if [[ -z $tag ]]; then
    echo "tag_release.sh requires a tag"
    exit 1
fi

echo "Tagging v$tag"
git tag "$tag"
git push upstream "$tag"