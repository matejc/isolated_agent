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
  golang-go \
  && rm -rf /var/lib/apt/lists/*

# Install crush from github globally
ARG VERSION=latest
RUN go install github.com/charmbracelet/crush@${VERSION}
RUN ln -sf $(go env GOPATH)/bin/* /usr/bin/

RUN mkdir -p /workspace
WORKDIR /workspace

CMD [ "crush", "--yolo" ]
