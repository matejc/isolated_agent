#include "vmlinux.h"
#include <bpf/bpf_helpers.h>
#include <bpf/bpf_endian.h>
#include "netmon.h"

#define IPPROTO_TCP 6
#define IPPROTO_UDP 17
#define AF_INET 2
#define AF_INET6 10
#define DNS_MIN_LEN 12

struct {
    __uint(type, BPF_MAP_TYPE_RINGBUF);
    __uint(max_entries, 8 * 1024 * 1024);
} events SEC(".maps");

struct {
    __uint(type, BPF_MAP_TYPE_PERCPU_ARRAY);
    __uint(max_entries, CNT_MAX);
    __type(key, __u32);
    __type(value, __u64);
} counters SEC(".maps");

static __always_inline void count(__u32 key)
{
    __u64 *v = bpf_map_lookup_elem(&counters, &key);
    if (v)
        (*v)++;
}

static __always_inline int emit_connect(struct bpf_sock_addr *ctx, __u8 proto, __u8 family)
{
    struct connection_event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
    __u64 pt;
    if (!e) {
        count(CNT_RINGBUF_FAIL);
        return 1;
    }
    __builtin_memset(e, 0, sizeof(*e));
    pt = bpf_get_current_pid_tgid();
    e->kind = EVENT_CONNECT;
    e->timestamp_ns = bpf_ktime_get_ns();
    e->cgroup_id = bpf_get_current_cgroup_id();
    e->pid = pt >> 32;
    e->tid = (__u32)pt;
    e->uid = (__u32)bpf_get_current_uid_gid();
    e->family = family;
    e->protocol = proto;
    e->destination_port = bpf_ntohl(ctx->user_port) >> 16;
    if (family == AF_INET) {
        *(__u32 *)&e->destination[0] = ctx->user_ip4;
    } else {
        *(__u32 *)&e->destination[0] = ctx->user_ip6[0];
        *(__u32 *)&e->destination[4] = ctx->user_ip6[1];
        *(__u32 *)&e->destination[8] = ctx->user_ip6[2];
        *(__u32 *)&e->destination[12] = ctx->user_ip6[3];
    }
    bpf_get_current_comm(e->comm, sizeof(e->comm));
    bpf_ringbuf_submit(e, 0);
    return 1;
}

SEC("cgroup/connect4")
int connect4(struct bpf_sock_addr *ctx)
{
    if (ctx->protocol != IPPROTO_TCP && ctx->protocol != IPPROTO_UDP)
        return 1;
    return emit_connect(ctx, ctx->protocol, AF_INET);
}

SEC("cgroup/connect6")
int connect6(struct bpf_sock_addr *ctx)
{
    if (ctx->protocol != IPPROTO_TCP && ctx->protocol != IPPROTO_UDP)
        return 1;
    return emit_connect(ctx, ctx->protocol, AF_INET6);
}

SEC("cgroup/sendmsg4")
int sendmsg4(struct bpf_sock_addr *ctx)
{
    return emit_connect(ctx, IPPROTO_UDP, AF_INET);
}

SEC("cgroup/sendmsg6")
int sendmsg6(struct bpf_sock_addr *ctx)
{
    return emit_connect(ctx, IPPROTO_UDP, AF_INET6);
}

static __always_inline int load(struct __sk_buff *skb, __u32 off, void *dst, __u32 len)
{
    return bpf_skb_load_bytes(skb, off, dst, len);
}

static __always_inline void detect_dns_tcp(struct __sk_buff *skb, __u32 off)
{
    __u8 ports[4];
    __u16 sport, dport;

    if (load(skb, off, ports, sizeof(ports)))
        return;
    __builtin_memcpy(&sport, ports, sizeof(sport));
    __builtin_memcpy(&dport, ports + 2, sizeof(dport));
    if (bpf_ntohs(sport) == 53 || bpf_ntohs(dport) == 53)
        count(CNT_DNS_TCP_SEEN);
}

static __always_inline int dns_packet(struct __sk_buff *skb, __u8 direction)
{
    __u8 first, ip4[20], ip6[40], udp[8];
    __u16 sport, dport, ulen;
    __u32 off = 0, ihl, dnslen, cap;
    __u8 family;

    /* BPF_PROG_TYPE_CGROUP_SKB exposes the packet starting at the L3 header. */
    if (load(skb, 0, &first, sizeof(first))) {
        count(CNT_BAD_L3);
        return 0;
    }
    if ((first >> 4) == 4) {
        __u16 frag;
        if (load(skb, off, ip4, sizeof(ip4))) {
            count(CNT_BAD_IPV4);
            return 0;
        }
        ihl = (ip4[0] & 15) * 4;
        if ((ip4[0] >> 4) != 4 || ihl < 20 || ihl > 60) {
            count(CNT_BAD_IPV4);
            return 0;
        }
        __builtin_memcpy(&frag, ip4 + 6, 2);
        if (bpf_ntohs(frag) & 0x3fff) {
            count(CNT_IPV4_FRAGMENT);
            return 0;
        }
        if (ip4[9] == IPPROTO_TCP) {
            detect_dns_tcp(skb, off + ihl);
            return 0;
        }
        if (ip4[9] != IPPROTO_UDP)
            return 0;
        off += ihl;
        family = AF_INET;
    } else if ((first >> 4) == 6) {
        if (load(skb, off, ip6, sizeof(ip6)) || (ip6[0] >> 4) != 6) {
            count(CNT_IPV6_EXT);
            return 0;
        }
        if (ip6[6] == IPPROTO_TCP) {
            detect_dns_tcp(skb, off + 40);
            return 0;
        }
        if (ip6[6] != IPPROTO_UDP) {
            count(CNT_IPV6_EXT);
            return 0;
        }
        off += 40;
        family = AF_INET6;
    } else {
        count(CNT_BAD_L3);
        return 0;
    }
    if (load(skb, off, udp, sizeof(udp))) {
        count(CNT_BAD_UDP);
        return 0;
    }
    __builtin_memcpy(&sport, udp, 2);
    __builtin_memcpy(&dport, udp + 2, 2);
    __builtin_memcpy(&ulen, udp + 4, 2);
    if (bpf_ntohs(sport) != 53 && bpf_ntohs(dport) != 53)
        return 0;
    ulen = bpf_ntohs(ulen);
    if (ulen < 8) {
        count(CNT_BAD_UDP);
        return 0;
    }
    dnslen = (__u32)ulen - 8;
    if (dnslen < DNS_MIN_LEN) {
        count(CNT_DNS_SHORT);
        return 0;
    }
    cap = dnslen > DNS_CAPTURE_MAX ? DNS_CAPTURE_MAX : dnslen;
    if (dnslen > DNS_CAPTURE_MAX)
        count(CNT_DNS_TRUNCATED);
    if (cap < DNS_MIN_LEN || cap > DNS_CAPTURE_MAX)
        return 0;
    {
        struct dns_packet_event *e = bpf_ringbuf_reserve(&events, sizeof(*e), 0);
        if (!e) {
            count(CNT_RINGBUF_FAIL);
            return 0;
        }
        e->kind = EVENT_DNS_PACKET;
        e->ifindex = skb->ifindex;
        e->timestamp_ns = bpf_ktime_get_ns();
        e->direction = direction;
        e->family = family;
        e->protocol = IPPROTO_UDP;
        e->message_len = (__u16)dnslen;
        e->captured_len = (__u16)cap;
        if (load(skb, off + 8, e->payload, cap)) {
            bpf_ringbuf_discard(e, 0);
            count(CNT_BAD_UDP);
            return 0;
        }
        bpf_ringbuf_submit(e, 0);
    }
    return 0;
}

SEC("cgroup_skb/ingress")
int cgroup_ingress(struct __sk_buff *skb)
{
    dns_packet(skb, DIR_INGRESS);
    return 1;
}

SEC("cgroup_skb/egress")
int cgroup_egress(struct __sk_buff *skb)
{
    dns_packet(skb, DIR_EGRESS);
    return 1;
}
char LICENSE[] SEC("license") = "GPL";
