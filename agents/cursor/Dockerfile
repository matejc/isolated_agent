FROM ubuntu:26.04

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
  binutils \
  && rm -rf /var/lib/apt/lists/*

ARG VERSION=latest  # its always latest
RUN curl -fsSL https://cursor.com/install | bash

ENV PATH="/root/.local/bin:/root/.cursor/bin:${PATH}"

RUN mkdir -p /workspace
WORKDIR /workspace

CMD [ "agent" ]
