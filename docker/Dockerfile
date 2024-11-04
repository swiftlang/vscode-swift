#===----------------------------------------------------------------------===//
#
# This source file is part of the VS Code Swift open source project
#
# Copyright (c) 2024 the VS Code Swift project authors
# Licensed under Apache License v2.0
#
# See LICENSE.txt for license information
# See CONTRIBUTORS.txt for the list of VS Code Swift project authors
#
# SPDX-License-Identifier: Apache-2.0
#
#===----------------------------------------------------------------------===//
ARG swift_version=5.10
ARG ubuntu_version=jammy
ARG base_image=swift:$swift_version-$ubuntu_version
FROM $base_image
# needed to do again after FROM due to docker limitation
ARG swift_version
ARG ubuntu_version

# set as UTF-8
RUN apt-get update && apt-get install -y locales locales-all
ENV LC_ALL en_US.UTF-8
ENV LANG en_US.UTF-8
ENV LANGUAGE en_US.UTF-8

# dependencies
RUN apt-get update && apt-get install -y rsync curl gpg libasound2 libgbm1 libgtk-3-0 libnss3 xvfb build-essential

RUN useradd --user-group --create-home --system --skel /dev/null --home-dir /vscode vscode

RUN mkdir -p /usr/local/nvm
RUN chown vscode /usr/local/nvm

USER vscode
ENV NVM_DIR /usr/local/nvm

ENV NODE_VERSION v18.19.0
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
RUN /bin/bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"
ENV NODE_PATH $NVM_DIR/versions/node/$NODE_VERSION/bin
ENV PATH $NODE_PATH:$PATH
RUN npm -v
RUN node -v