BPF_CC ?= clang
CC = cc
BPFTOOL ?= bpftool
CFLAGS ?= -O2 -g -Wall -Wextra -Werror
CPPFLAGS += -Isrc
LIBBPF_CFLAGS := $(shell pkg-config --cflags libbpf 2>/dev/null)
LIBS := $(shell pkg-config --libs libbpf 2>/dev/null || echo '-lbpf -lelf -lz') -lresolv
ARCH_RAW := $(shell uname -m)
ARCH := $(if $(filter x86_64,$(ARCH_RAW)),x86,$(if $(filter aarch64 arm64,$(ARCH_RAW)),arm64,$(if $(filter ppc64le,$(ARCH_RAW)),powerpc,$(if $(filter s390x,$(ARCH_RAW)),s390,$(if $(filter riscv64,$(ARCH_RAW)),riscv,$(ARCH_RAW))))))

.PHONY: all clean format test integration check-tools
all: check-tools netmon

check-tools:
	@command -v $(BPF_CC) >/dev/null || { echo "$(BPF_CC) is required to compile eBPF" >&2; exit 1; }
	@command -v $(CC) >/dev/null || { echo "$(CC) is required to compile userspace" >&2; exit 1; }
	@command -v $(BPFTOOL) >/dev/null || { echo "bpftool is required to generate vmlinux.h and the skeleton" >&2; exit 1; }
	@command -v pkg-config >/dev/null || { echo "pkg-config is required to locate libbpf" >&2; exit 1; }
	@pkg-config --exists libbpf || { echo "libbpf development files are required" >&2; exit 1; }

vmlinux.h:
	@test -r /sys/kernel/btf/vmlinux || { echo "kernel BTF unavailable at /sys/kernel/btf/vmlinux" >&2; exit 1; }
	$(BPFTOOL) btf dump file /sys/kernel/btf/vmlinux format c > $@.tmp
	mv $@.tmp $@

src/netmon.bpf.o: src/netmon.bpf.c src/netmon.h vmlinux.h
	$(BPF_CC) -g -O2 -target bpf -D__TARGET_ARCH_$(ARCH) -Wno-missing-declarations $(LIBBPF_CFLAGS) -I. -Isrc -c $< -o $@

src/netmon.skel.h: src/netmon.bpf.o
	$(BPFTOOL) gen skeleton $< > $@.tmp
	mv $@.tmp $@

netmon: src/netmon.c src/netmon.h src/netmon.skel.h
	$(CC) $(CPPFLAGS) $(LIBBPF_CFLAGS) $(CFLAGS) $< -o $@ $(LIBS)

tests/test_dns: tests/test_dns.c src/netmon.c src/netmon.h src/netmon.skel.h
	$(CC) $(CPPFLAGS) $(LIBBPF_CFLAGS) $(CFLAGS) -Wno-unused-function $< -o $@ $(LIBS)

test: tests/test_dns
	./tests/test_dns
	@bash -n tests/integration.sh

integration: netmon
	sudo ./tests/integration.sh

format:
	clang-format -i src/netmon.h src/netmon.bpf.c src/netmon.c tests/test_dns.c

clean:
	rm -f netmon src/netmon.bpf.o src/netmon.skel.h tests/test_dns vmlinux.h.tmp src/netmon.skel.h.tmp
