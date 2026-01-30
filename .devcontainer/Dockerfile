FROM swiftlang/swift:nightly-jammy

#  python3-lldb-13 is only needed for swiftly and a great dep to remove to test post-install script ;)
RUN export DEBIAN_FRONTEND=noninteractive DEBCONF_NONINTERACTIVE_SEEN=true \
    && apt-get -q update \
    && apt-get -q dist-upgrade -y \
    && apt-get -q install -y \
      curl \
      sqlite3 \
      libsqlite3-dev \
      libncurses5-dev \
      python3 \
      python3-lldb-13 \
      build-essential \
      sudo

# Install nvm / Node.js
RUN mkdir -p /usr/local/nvm
ENV NVM_DIR /usr/local/nvm
ENV NODE_VERSION v22.17.0
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
RUN /bin/bash -c "source $NVM_DIR/nvm.sh && nvm install $NODE_VERSION"
ENV NODE_PATH $NVM_DIR/versions/node/$NODE_VERSION/bin
ENV PATH $NODE_PATH:$PATH
RUN npm -v
RUN node -v

# Create a "vscode" user that is a sudoer
RUN useradd -ms /bin/bash vscode
RUN echo "vscode:vscode" | chpasswd
RUN adduser vscode sudo

# Install swiftly
USER vscode
ENV SWIFTLY_HOME_DIR /home/vscode/.swiftly
ENV SWIFTLY_BIN_DIR /home/vscode/.swiftly/bin
ENV SWIFTLY_TOOLCHAINS_DIR /home/vscode/.swiftly/bin
RUN mkdir -p $SWIFTLY_HOME_DIR
RUN cd ~ && curl -O https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz && \
    tar zxf swiftly-$(uname -m).tar.gz && \
    ./swiftly init --quiet-shell-followup && \
    . "${SWIFTLY_HOME_DIR}/env.sh" && \
    hash -r

# Use swiftly toolchain by default
RUN echo "export SWIFTLY_HOME_DIR=$SWIFTLY_HOME_DIR" >> ~/.bashrc
RUN echo "export SWIFTLY_BIN_DIR=$SWIFTLY_BIN_DIR" >> ~/.bashrc
RUN echo '. "${SWIFTLY_HOME_DIR}/env.sh"' >> ~/.bashrc
