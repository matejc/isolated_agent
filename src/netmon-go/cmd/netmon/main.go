package main

import (
	"bytes"
	"encoding/binary"
	"errors"
	"flag"
	"fmt"
	"io/fs"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"

	"example.com/netmon-go/internal/dnscache"
	"github.com/cilium/ebpf"
	"github.com/cilium/ebpf/link"
	"github.com/cilium/ebpf/ringbuf"
	"github.com/cilium/ebpf/rlimit"
	"golang.org/x/sys/unix"
)

const (
	eventConnect   = 1
	eventDNSPacket = 2

	ipProtoTCP = 6

	defaultCacheMax = 4096
	cgroupRoot      = "/sys/fs/cgroup"
)

var counterNames = []string{
	"ringbuf_fail",
	"malformed_l3",
	"malformed_ipv4",
	"fragmented_ipv4",
	"unsupported_ipv6",
	"malformed_udp",
	"dns_too_short",
	"dns_capture_truncated",
	"dns_tcp_seen",
}

type app struct {
	cache       *dnscache.Cache
	containerID uint64
	noDNS       bool
}

type connectionEvent struct {
	Kind            uint32
	Pad             uint32
	TimestampNS     uint64
	CgroupID        uint64
	PID             uint32
	TID             uint32
	UID             uint32
	Family          uint16
	Protocol        uint8
	Pad2            uint8
	DestinationPort uint16
	Pad3            uint16
	Destination     [16]byte
	Comm            [16]byte
}

type dnsPacketEvent struct {
	Kind        uint32
	Ifindex     uint32
	TimestampNS uint64
	Direction   uint8
	Family      uint8
	Protocol    uint8
	Pad         uint8
	MessageLen  uint16
	CapturedLen uint16
	Payload     [1232]byte
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(exitCode(err))
	}
}

func run() error {
	var cgroupID uint64
	var noDNS bool
	var cacheMax uint64

	flags := flag.NewFlagSet(os.Args[0], flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	flags.Uint64Var(&cgroupID, "cgroup-id", 0, "cgroup v2 directory inode")
	flags.BoolVar(&noDNS, "no-dns", false, "disable DNS packet capture")
	flags.Uint64Var(&cacheMax, "dns-cache-max", defaultCacheMax, "maximum DNS cache entries")
	if err := flags.Parse(os.Args[1:]); err != nil {
		return usageError{err}
	}
	if cgroupID == 0 {
		return usageError{errors.New("--cgroup-id is required")}
	}
	if cacheMax == 0 || cacheMax > 1_000_000 {
		return usageError{fmt.Errorf("invalid DNS cache size: %d", cacheMax)}
	}
	if err := checkCgroup2(); err != nil {
		return err
	}

	cgroupPath, err := cgroupPathFromID(cgroupID)
	if err != nil {
		return fmt.Errorf("cannot find cgroup v2 directory with ID %d", cgroupID)
	}
	if err := verifyCgroupIdentity(cgroupPath, cgroupID); err != nil {
		return err
	}
	cgroupDir, err := os.Open(cgroupPath)
	if err != nil {
		return fmt.Errorf("open cgroup: %w", err)
	}
	cgroupDir.Close()
	app := &app{cache: dnscache.New(int(cacheMax)), containerID: cgroupID, noDNS: noDNS}
	fmt.Fprintf(os.Stderr, "cgroup=%s cgroup_id=%d\n", cgroupPath, cgroupID)

	if err := rlimit.RemoveMemlock(); err != nil && !errors.Is(err, unix.EPERM) {
		return fmt.Errorf("setrlimit(RLIMIT_MEMLOCK): %w", err)
	}

	var objects netmonObjects
	if err := loadNetmonObjects(&objects, nil); err != nil {
		return fmt.Errorf("failed to open/load BPF object: %w", err)
	}
	defer objects.Close()

	links, err := attachPrograms(cgroupPath, noDNS, &objects)
	if err != nil {
		return err
	}
	defer closeLinks(links)

	reader, err := ringbuf.NewReader(objects.Events)
	if err != nil {
		return fmt.Errorf("failed to create ring buffer: %w", err)
	}
	defer reader.Close()

	fmt.Fprintf(os.Stderr, "attached connect4 connect6 sendmsg4 sendmsg6%s\n", map[bool]string{true: "", false: " cgroup_skb_ingress cgroup_skb_egress"}[noDNS])

	signals := make(chan os.Signal, 1)
	signal.Notify(signals, syscall.SIGINT, syscall.SIGTERM)
	defer signal.Stop(signals)

	result := poll(app, reader, cgroupPath, cgroupID, signals)
	printCounters(objects.Counters)
	return result
}

func attachPrograms(cgroupPath string, noDNS bool, objects *netmonObjects) ([]link.Link, error) {
	programs := []struct {
		name    string
		program *ebpf.Program
		attach  ebpf.AttachType
	}{
		{"connect4", objects.Connect4, ebpf.AttachCGroupInet4Connect},
		{"connect6", objects.Connect6, ebpf.AttachCGroupInet6Connect},
		{"sendmsg4", objects.Sendmsg4, ebpf.AttachCGroupUDP4Sendmsg},
		{"sendmsg6", objects.Sendmsg6, ebpf.AttachCGroupUDP6Sendmsg},
		{"cgroup_skb_ingress", objects.CgroupIngress, ebpf.AttachCGroupInetIngress},
		{"cgroup_skb_egress", objects.CgroupEgress, ebpf.AttachCGroupInetEgress},
	}
	if noDNS {
		programs = programs[:4]
	}

	links := make([]link.Link, 0, len(programs))
	for _, item := range programs {
		cgLink, err := link.AttachCgroup(link.CgroupOptions{Path: cgroupPath, Attach: item.attach, Program: item.program})
		if err != nil {
			closeLinks(links)
			return nil, fmt.Errorf("cgroup attach failed for %s: %w", item.name, err)
		}
		links = append(links, cgLink)
	}
	return links, nil
}

func closeLinks(links []link.Link) {
	for _, l := range links {
		l.Close()
	}
}

func poll(app *app, reader *ringbuf.Reader, cgroupPath string, cgroupID uint64, signals <-chan os.Signal) error {
	lastMaintenance := monoNS()
	for {
		select {
		case <-signals:
			return nil
		default:
		}

		reader.SetDeadline(time.Now().Add(250 * time.Millisecond))
		record, err := reader.Read()
		if err == nil {
			handleEvent(app, record.RawSample)
		} else if !errors.Is(err, os.ErrDeadlineExceeded) && !errors.Is(err, ringbuf.ErrClosed) {
			return fmt.Errorf("ring buffer poll: %w", err)
		}

		now := monoNS()
		if now-lastMaintenance < 30_000_000_000 {
			continue
		}
		app.cache.Prune(now)
		lastMaintenance = now
		if err := verifyCgroupIdentity(cgroupPath, cgroupID); err != nil {
			return errors.New("cgroup disappeared or changed identity")
		}
	}
}

func handleEvent(app *app, data []byte) {
	if len(data) < 4 {
		return
	}
	kind := nativeEndian().Uint32(data[:4])
	switch kind {
	case eventDNSPacket:
		var event dnsPacketEvent
		if app.noDNS || binary.Read(bytes.NewReader(data), nativeEndian(), &event) != nil {
			return
		}
		if event.CapturedLen > uint16(len(event.Payload)) || event.CapturedLen != event.MessageLen {
			return
		}
		message := event.Payload[:event.CapturedLen]
		if !dnsResponse(message) {
			return
		}
		_, _ = dnscache.ParseResponse(app.cache, app.containerID, message, event.TimestampNS)
	case eventConnect:
		var event connectionEvent
		if binary.Read(bytes.NewReader(data), nativeEndian(), &event) != nil {
			return
		}
		printConnection(app, &event)
	}
}

func printConnection(app *app, event *connectionEvent) {
	destination := destinationIP(event.Family, event.Destination)
	if destination == "" {
		return
	}
	app.cache.Prune(event.TimestampNS)
	entry := app.cache.Find(app.containerID, int(event.Family), event.Destination[:])
	protocol := "udp"
	if event.Protocol == ipProtoTCP {
		protocol = "tcp"
	}

	hostnames := make([]string, 0, dnscache.MaxNames)
	if entry != nil {
		for _, name := range entry.Names {
			hostnames = append(hostnames, name.Value)
		}
	}

	// bpf_log.sh merges this process's stdout with bpftrace's stdout. Emit the
	// complete record in one write so another producer cannot splice a record
	// between the hostname list and its terminating newline.
	fmt.Printf("CONNECT time=%s timestamp_ns=%d host_pid=%d tid=%d uid=%d comm=%s protocol=%s dst=%s:%d hostnames=%s\n",
		wallTime(event.TimestampNS), event.TimestampNS, event.PID, event.TID, event.UID, commString(event.Comm), protocol,
		destination, event.DestinationPort, strings.Join(hostnames, ","))
}

func dnsResponse(message []byte) bool {
	return len(message) >= 3 && message[2]&0x80 != 0
}

func destinationIP(family uint16, raw [16]byte) string {
	switch family {
	case 2:
		return net.IP(raw[:4]).String()
	case 10:
		return net.IP(raw[:]).String()
	default:
		return ""
	}
}

func commString(comm [16]byte) string {
	if idx := bytes.IndexByte(comm[:], 0); idx >= 0 {
		return string(comm[:idx])
	}
	return string(comm[:])
}

func printCounters(counters *ebpf.Map) {
	for key, name := range counterNames {
		var values []uint64
		if err := counters.Lookup(uint32(key), &values); err != nil {
			fmt.Fprintf(os.Stderr, "counter.%s=0\n", name)
			continue
		}
		var total uint64
		for _, value := range values {
			total += value
		}
		fmt.Fprintf(os.Stderr, "counter.%s=%d\n", name, total)
	}
}

func checkCgroup2() error {
	var stat unix.Statfs_t
	if err := unix.Statfs(cgroupRoot, &stat); err != nil || stat.Type != unix.CGROUP2_SUPER_MAGIC {
		return errors.New("cgroup v2 is not mounted at /sys/fs/cgroup")
	}
	return nil
}

func cgroupPathFromID(id uint64) (string, error) {
	var found string
	err := filepath.WalkDir(cgroupRoot, func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return nil
		}
		if !d.IsDir() {
			return nil
		}
		info, err := d.Info()
		if err != nil {
			return nil
		}
		stat, ok := info.Sys().(*syscall.Stat_t)
		if ok && stat.Ino == id {
			found = path
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil && !errors.Is(err, filepath.SkipAll) {
		return "", err
	}
	if found == "" {
		return "", os.ErrNotExist
	}
	return found, nil
}

func verifyCgroupIdentity(path string, id uint64) error {
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return errors.New("resolved cgroup identity changed")
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok || stat.Ino != id {
		return errors.New("resolved cgroup identity changed")
	}
	return nil
}

func wallTime(eventNS uint64) string {
	real := time.Now()
	mono := monoNS()
	eventWall := real.Add(time.Duration(int64(eventNS) - int64(mono)))
	return eventWall.UTC().Format("2006-01-02T15:04:05.000000000Z")
}

func monoNS() uint64 {
	var ts unix.Timespec
	_ = unix.ClockGettime(unix.CLOCK_MONOTONIC, &ts)
	return uint64(ts.Sec)*1_000_000_000 + uint64(ts.Nsec)
}

func nativeEndian() binary.ByteOrder {
	var value uint16 = 0x0102
	first := *(*byte)(unsafe.Pointer(&value))
	if first == 0x02 {
		return binary.LittleEndian
	}
	return binary.BigEndian
}

func exitCode(err error) int {
	var usage usageError
	if errors.As(err, &usage) {
		return 2
	}
	return 1
}

type usageError struct{ error }

func init() {
	if runtime.GOOS != "linux" {
		fmt.Fprintln(os.Stderr, "netmon requires Linux")
		os.Exit(1)
	}
}
