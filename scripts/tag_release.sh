#!/bin/bash
##===----------------------------------------------------------------------===##
##
## This source file is part of the VSCode Swift open source project
##
## Copyright (c) 2021 the VSCode Swift project authors
## Licensed under Apache License v2.0
##
## See LICENSE.txt for license information
## See CONTRIBUTORS.txt for the list of VSCode Swift project authors
##
## SPDX-License-Identifier: Apache-2.0
##
##===----------------------------------------------------------------------===##

tag=$1

if [[ -z $tag ]]; then
    echo "tag_release.sh requires a tag"
    exit -1
fi

echo "Tagging v$tag"
git tag "$tag"
git push upstream "$tag"