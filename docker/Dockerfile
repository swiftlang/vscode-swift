ARG swift_version=5.5
ARG ubuntu_version=focal
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
RUN apt-get update && apt-get install -y curl gpg libasound2 libgbm1 libgtk-3-0 libnss3 xvfb

# install NodeJS 16
# Add the NodeSource package signing key
ENV KEYRING /usr/share/keyrings/nodesource.gpg
RUN curl -fsSL https://deb.nodesource.com/gpgkey/nodesource.gpg.key | gpg --dearmor | tee "$KEYRING" >/dev/null
RUN gpg --no-default-keyring --keyring "$KEYRING" --list-keys
# Add the desired NodeSource repository
ENV VERSION node_16.x
ENV DISTRO $ubuntu_version
RUN echo "deb [signed-by=$KEYRING] https://deb.nodesource.com/$VERSION $DISTRO main" | tee /etc/apt/sources.list.d/nodesource.list
RUN echo "deb-src [signed-by=$KEYRING] https://deb.nodesource.com/$VERSION $DISTRO main" | tee -a /etc/apt/sources.list.d/nodesource.list
# Update package lists and install Node.js
RUN apt-get update && apt-get install -y nodejs

RUN useradd --user-group --create-home --system --skel /dev/null --home-dir /vscode vscode