FROM ubuntu:24.04

# Install basic development tools, ca-certificates, and iptables/ipset, then clean up apt cache to reduce image size
RUN apt-get update && apt-get install -y --no-install-recommends \
  aggregate \
  ca-certificates \
  curl \
  dnsutils \
  fzf \
  gh \
  git \
  gnupg2 \
  iproute2 \
  ipset \
  iptables \
  jq \
  less \
  man-db \
  procps \
  unzip \
  ripgrep \
  patch \
  && rm -rf /var/lib/apt/lists/*

# Install Node.js 24
RUN curl -fsSL https://deb.nodesource.com/setup_24.x | bash - \
  && apt-get install -y nodejs \
  && rm -rf /var/lib/apt/lists/*

# Set up npm global directory with proper permissions
RUN mkdir -p /usr/local/share/npm-global \
  && chmod 755 /usr/local/share/npm-global

ARG VERSION=latest
RUN npm install -g @just-every/code@${VERSION} \
    && npm cache clean --force

# Set npm global config for any user
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

RUN mkdir -p /workspace
WORKDIR /workspace

CMD [ "code", "--dangerously-bypass-approvals-and-sandbox" ]
