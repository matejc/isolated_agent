#ifndef NETMON_H
#define NETMON_H

/* vmlinux.h supplies kernel fixed-width types to the BPF compilation. */
#ifndef __VMLINUX_H__
#include <linux/types.h>
#endif

#define DNS_CAPTURE_MAX 1232
#define TASK_COMM_LEN 16

enum event_kind { EVENT_CONNECT = 1, EVENT_DNS_PACKET = 2 };
enum packet_direction { DIR_INGRESS = 1, DIR_EGRESS = 2 };
enum counter_id {
    CNT_RINGBUF_FAIL,
    CNT_BAD_L3,
    CNT_BAD_IPV4,
    CNT_IPV4_FRAGMENT,
    CNT_IPV6_EXT,
    CNT_BAD_UDP,
    CNT_DNS_SHORT,
    CNT_DNS_TRUNCATED,
    CNT_DNS_TCP_SEEN,
    CNT_MAX
};

struct connection_event {
    __u32 kind;
    __u32 _pad;
    __u64 timestamp_ns;
    __u64 cgroup_id;
    __u32 pid;
    __u32 tid;
    __u32 uid;
    __u16 family;
    __u8 protocol;
    __u8 _pad2;
    __u16 destination_port;
    __u16 _pad3;
    __u8 destination[16];
    char comm[TASK_COMM_LEN];
};

struct dns_packet_event {
    __u32 kind;
    __u32 ifindex;
    __u64 timestamp_ns;
    __u8 direction;
    __u8 family;
    __u8 protocol;
    __u8 _pad;
    __u16 message_len;
    __u16 captured_len;
    __u8 payload[DNS_CAPTURE_MAX];
};

#endif
