# container-netmon

`container-netmon` runs on a Linux host and reports outbound TCP connects and UDP destinations for one cgroup. It correlates those destinations with traditional UDP DNS responses observed by cgroup skb hooks. Event output uses the same labeled text format as `container-audit.bt`; operational messages stay on stderr.

## Architecture

Four cgroup v2 socket-address programs (`connect4`, `connect6`, `sendmsg4`, and `sendmsg6`) obtain destinations directly from `bpf_sock_addr`, without syscall address decoding. `cgroup_skb/ingress` and `cgroup_skb/egress` programs capture UDP DNS messages into an 8 MiB ring buffer and always return 1 to allow traffic. Userspace parses responses with `ns_initparse`, `ns_parserr`, and `ns_name_uncompress`, and keeps a bounded, TTL-aware cache keyed by container cgroup identity, address family, and address.

The loader accepts a cgroup v2 ID (the cgroup directory inode), finds the matching directory under `/sys/fs/cgroup`, opens it, and attaches all six programs through cgroup `bpf_link` objects. It does not inspect Docker, enter network namespaces, or discover interfaces.

## Prerequisites and build

Required: Linux with cgroup v2 and kernel BTF, root or equivalent BPF/network capabilities, Docker, clang/LLVM, bpftool, a host C compiler, libbpf development files, libelf, zlib, and libresolv. On Debian/Ubuntu, packages commonly include `clang llvm bpftool libbpf-dev libelf-dev zlib1g-dev libc6-dev pkg-config make gcc iproute2 docker.io`.

```bash
make
make test
```

The Makefile generates `vmlinux.h` from `/sys/kernel/btf/vmlinux`, compiles CO-RE BPF with the host architecture define, generates `src/netmon.skel.h`, and links the loader with libbpf, libelf, zlib, and libresolv. `make format` uses clang-format. `make integration` runs the privileged Docker test; set `NETMON_TEST_IMAGE` to override `alpine:3.20`.

`BPF_CC` defaults to `clang`; `CC` defaults to the host `cc`. On conventional Linux both may be Clang (`make CC=clang BPF_CC=clang`). NixOS generally requires unwrapped Clang for `BPF_CC` and a wrapped compiler for `CC`, because only the wrapper supplies host libc headers and linker paths.

## Usage

```bash
sudo ./container-netmon --cgroup-id 123456
sudo ./container-netmon --cgroup-id 123456 --dns-cache-max 8192
```

Options include `--no-dns` and `--dns-cache-max N` (default 4096). Startup reports the cgroup path/ID and attached programs to stderr. Docker lookup is deliberately kept outside the loader; `../bpf_log.sh CONTAINER` resolves the ID and starts both monitoring components.

Example output:

```text
CONNECT time=2026-08-06T12:00:00.014000000Z timestamp_ns=123456789 host_pid=1234 tid=1234 uid=1000 comm=curl protocol=tcp dst=93.184.216.34:443 hostnames=example.com
```

## DNS semantics and limits

Only complete UDP DNS responses are inserted. A, AAAA, and CNAME records are supported; CNAME aliases and answer owner names are retained when the response makes their relationship visible. Each IP has at most eight names, hostnames are at most 253 bytes, the total cache has a hard configured limit, duplicates are coalesced, zero-TTL answers are not cached, and expired names are periodically removed. Full DNS message length and bounded captured length (1232 bytes) are recorded; over-bound messages are counted and deliberately not parsed.

Correlation is approximate, not proof: caches, races, shared resolvers, split DNS, direct IP use, NAT, and applications' own resolution stacks can disconnect a DNS answer from a later connection. Cgroup skb data starts at the network layer, so Ethernet and VLAN parsing is unnecessary. IPv4 variable headers are supported and fragments are ignored. IPv6 packets with anything other than UDP/TCP in the base header are counted as unsupported extension-header traffic. Malformed/truncated cases and ring-buffer loss are printed as counters at shutdown.

TCP port 53 is detected and counted as `dns_tcp_seen`, but DNS-over-TCP is not decoded; it needs flow reassembly using the two-byte message-length prefix. DoT hides DNS in TLS, normally TCP 853, and DoH hides it in HTTPS, so port-53 parsing cannot recover those names.

Optional resolver uprobes are intentionally not part of this first milestone and connection monitoring never depends on them. A future `getaddrinfo` mode could cover dynamically linked glibc or musl objects with a usable symbol, but would not universally cover pure-Go or static programs, Java internals, c-ares, DoH, or DoT.

## Attachment lifecycle and debugging

The process retains all six cgroup `bpf_link` objects and destroys them on SIGINT/SIGTERM. Cgroup disappearance or identity change causes a clear exit. No qdisc or TC filter is created.

Useful inspection commands:

```bash
bpftool prog show
bpftool link show
```

For verifier failures, inspect the libbpf verifier log on stderr, ensure the running kernel matches the generated CO-RE environment, and confirm `/sys/kernel/btf/vmlinux` is readable. Check that cgroup v2 is mounted at `/sys/fs/cgroup` and the process has the required BPF privileges.
