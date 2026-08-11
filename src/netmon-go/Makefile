BPF_CC ?= clang
GO ?= go
TARGET ?= bpfel
ARCH_RAW := $(shell uname -m)
ARCH := $(if $(filter x86_64,$(ARCH_RAW)),x86,$(if $(filter aarch64 arm64,$(ARCH_RAW)),arm64,$(if $(filter ppc64le,$(ARCH_RAW)),powerpc,$(if $(filter s390x,$(ARCH_RAW)),s390,$(if $(filter riscv64,$(ARCH_RAW)),riscv,$(ARCH_RAW))))))
BPF2GO := $(GO) run github.com/cilium/ebpf/cmd/bpf2go

.PHONY: all clean generate test integration check-tools
all: check-tools generate netmon

check-tools:
	@command -v $(GO) >/dev/null || { echo "go is required" >&2; exit 1; }
	@command -v $(BPF_CC) >/dev/null || { echo "$(BPF_CC) is required to compile eBPF" >&2; exit 1; }

cmd/netmon/netmon_bpfel.go cmd/netmon/netmon_bpfel.o: bpf/netmon.bpf.c bpf/netmon.h bpf/vmlinux.h go.mod go.sum
	cd cmd/netmon && $(BPF2GO) -go-package main -target $(TARGET) -cc $(BPF_CC) netmon ../../bpf/netmon.bpf.c -- -O2 -g -D__TARGET_ARCH_$(ARCH) -I../../bpf

generate: cmd/netmon/netmon_bpfel.go

netmon: generate
	$(GO) build -o $@ ./cmd/netmon

test: generate
	$(GO) test ./...
	@bash -n tests/integration.sh

integration: netmon
	sudo ./tests/integration.sh

clean:
	rm -f netmon cmd/netmon/netmon_bpfel.go cmd/netmon/netmon_bpfel.o cmd/netmon/netmon_bpfeb.go cmd/netmon/netmon_bpfeb.o
