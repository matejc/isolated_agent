# netmon-go

`netmon-go` is a Go userspace rewrite of `../netmon`. It keeps the same C eBPF programs and event ABI, but replaces the libbpf C loader, DNS parser, cache, and output loop with Go.

## Build

Required: Go, clang/LLVM, Linux kernel BTF support, root or equivalent BPF/network capabilities, and cgroup v2 mounted at `/sys/fs/cgroup`.

```bash
make
make test
```

The Makefile uses `github.com/cilium/ebpf/cmd/bpf2go` to compile `bpf/netmon.bpf.c` and generate Go bindings in `cmd/netmon`. The resulting binary is `./netmon`.

## Usage

```bash
sudo ./netmon --cgroup-id 123456
sudo ./netmon --cgroup-id 123456 --dns-cache-max 8192
sudo ./netmon --cgroup-id 123456 --no-dns
```

Output format is intentionally kept compatible with the C version:

```text
CONNECT time=2026-08-06T12:00:00.014000000Z timestamp_ns=123456789 host_pid=1234 tid=1234 uid=1000 comm=curl protocol=tcp dst=93.184.216.34:443 hostnames=example.com
```

## Notes

The Go rewrite still compiles the eBPF side from C because that is the least risky migration path. The userspace side loads the generated object, attaches the four socket-address programs and optional cgroup skb DNS programs, reads events from the ring buffer, maintains the TTL-aware DNS cache, and prints shutdown counters.
