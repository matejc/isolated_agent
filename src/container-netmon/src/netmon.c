#define _GNU_SOURCE
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <ftw.h>
#include <getopt.h>
#include <netinet/in.h>
#include <resolv.h>
#include <signal.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/statfs.h>
#include <sys/types.h>
#include <limits.h>
#include <linux/magic.h>
#include <time.h>
#include <unistd.h>
#include <bpf/bpf.h>
#include <bpf/libbpf.h>
#include "netmon.h"
#include "netmon.skel.h"

#define MAX_NAMES 8
#define MAX_HOSTNAME 253
#define DEFAULT_CACHE_MAX 4096

struct cache_name {
    char value[MAX_HOSTNAME + 1];
    uint64_t expires_ns;
};
struct cache_entry {
    bool used;
    uint64_t container_id;
    int family;
    uint8_t address[16];
    unsigned int count;
    struct cache_name names[MAX_NAMES];
    uint64_t touched_ns;
};
struct dns_cache {
    struct cache_entry *entries;
    size_t capacity;
    size_t count;
};
struct app {
    struct dns_cache cache;
    uint64_t container_id;
    bool no_dns;
};
static volatile sig_atomic_t exiting;
static uint64_t mono_ns(void)
{
    struct timespec time;

    clock_gettime(CLOCK_MONOTONIC, &time);
    return (uint64_t)time.tv_sec * 1000000000ULL + time.tv_nsec;
}

static void on_signal(int signal_number)
{
    (void)signal_number;
    exiting = 1;
}

static void cache_prune(struct dns_cache *c, uint64_t now)
{
    for (size_t i = 0; i < c->capacity; i++) {
        struct cache_entry *entry = &c->entries[i];
        unsigned int output = 0;

        if (!entry->used)
            continue;
        for (unsigned int j = 0; j < entry->count; j++) {
            if (entry->names[j].expires_ns > now)
                entry->names[output++] = entry->names[j];
        }
        entry->count = output;
        if (!output) {
            entry->used = false;
            c->count--;
        }
    }
}
static struct cache_entry *cache_find(struct dns_cache *cache, uint64_t id,
                                      int family, const uint8_t *address)
{
    size_t address_size = family == AF_INET ? 4 : 16;

    for (size_t i = 0; i < cache->capacity; i++) {
        struct cache_entry *entry = &cache->entries[i];

        if (entry->used && entry->container_id == id &&
            entry->family == family &&
            !memcmp(entry->address, address, address_size))
            return entry;
    }
    return NULL;
}
static void cache_put(struct dns_cache *cache, uint64_t id, int family,
                      const uint8_t *address, const char *name, uint32_t ttl,
                      uint64_t now)
{
    struct cache_entry *entry = NULL;
    size_t address_size = family == AF_INET ? 4 : 16;

    if (!ttl || !name[0] || strlen(name) > MAX_HOSTNAME)
        return;
    entry = cache_find(cache, id, family, address);
    if (!entry) {
        if (cache->count >= cache->capacity) {
            size_t victim = 0;
            uint64_t oldest = UINT64_MAX;

            for (size_t i = 0; i < cache->capacity; i++) {
                if (cache->entries[i].touched_ns < oldest) {
                    oldest = cache->entries[i].touched_ns;
                    victim = i;
                }
            }
            entry = &cache->entries[victim];
        } else {
            for (size_t i = 0; i < cache->capacity; i++) {
                if (!cache->entries[i].used) {
                    entry = &cache->entries[i];
                    cache->count++;
                    break;
                }
            }
        }
        if (!entry)
            return;
        memset(entry, 0, sizeof(*entry));
        entry->used = true;
        entry->container_id = id;
        entry->family = family;
        memcpy(entry->address, address, address_size);
    }
    entry->touched_ns = now;
    for (unsigned int i = 0; i < entry->count; i++) {
        if (!strcasecmp(entry->names[i].value, name)) {
            entry->names[i].expires_ns = now + (uint64_t)ttl * 1000000000ULL;
            return;
        }
    }
    if (entry->count < MAX_NAMES) {
        struct cache_name *slot = &entry->names[entry->count++];

        snprintf(slot->value, sizeof(slot->value), "%s", name);
        slot->expires_ns = now + (uint64_t)ttl * 1000000000ULL;
    }
}

struct cname {
    char alias[MAX_HOSTNAME + 1];
    char target[MAX_HOSTNAME + 1];
    uint32_t ttl;
};
static bool copy_hostname(char dst[MAX_HOSTNAME + 1], const char *src)
{
    size_t len = strnlen(src, MAX_HOSTNAME + 1);
    if (len > MAX_HOSTNAME)
        return false;
    memcpy(dst, src, len + 1);
    return true;
}
static int parse_dns_response(struct dns_cache *cache, uint64_t id,
                              const uint8_t *message, size_t length,
                              uint64_t now)
{
    ns_msg handle;
    struct cname cnames[32];
    unsigned int cname_count = 0;
    int inserted = 0;
    int answer_count;

    if (length < 12 || length > INT_MAX ||
        ns_initparse(message, (int)length, &handle) < 0 ||
        !ns_msg_getflag(handle, ns_f_qr))
        return -1;
    answer_count = ns_msg_count(handle, ns_s_an);
    if (answer_count > 256)
        answer_count = 256;

    for (int i = 0; i < answer_count; i++) {
        ns_rr record;
        char target[MAX_HOSTNAME + 1];

        if (ns_parserr(&handle, ns_s_an, i, &record) < 0 ||
            ns_rr_type(record) != ns_t_cname || cname_count >= 32)
            continue;
        if (ns_name_uncompress(ns_msg_base(handle), ns_msg_end(handle),
                               ns_rr_rdata(record), target,
                               sizeof(target)) >= 0 &&
            copy_hostname(cnames[cname_count].alias, ns_rr_name(record)) &&
            copy_hostname(cnames[cname_count].target, target)) {
            cnames[cname_count++].ttl = ns_rr_ttl(record);
        }
    }

    for (int i = 0; i < answer_count; i++) {
        ns_rr record;
        int family;

        if (ns_parserr(&handle, ns_s_an, i, &record) < 0)
            continue;
        if (ns_rr_type(record) == ns_t_a && ns_rr_rdlen(record) == 4)
            family = AF_INET;
        else if (ns_rr_type(record) == ns_t_aaaa &&
                 ns_rr_rdlen(record) == 16)
            family = AF_INET6;
        else
            continue;

        cache_put(cache, id, family, ns_rr_rdata(record), ns_rr_name(record),
                  ns_rr_ttl(record), now);
        inserted++;
        for (unsigned int j = 0; j < cname_count; j++) {
            uint32_t ttl;

            if (strcasecmp(cnames[j].target, ns_rr_name(record)))
                continue;
            ttl = cnames[j].ttl < ns_rr_ttl(record) ? cnames[j].ttl
                                                     : ns_rr_ttl(record);
            cache_put(cache, id, family, ns_rr_rdata(record),
                      cnames[j].alias, ttl, now);
        }
    }
    return inserted;
}
static void wall_time(uint64_t event_ns, char *buf, size_t size)
{
    struct timespec real, mono;
    struct tm tm;
    int64_t ns;
    time_t sec;
    size_t used;
    clock_gettime(CLOCK_REALTIME, &real);
    clock_gettime(CLOCK_MONOTONIC, &mono);
    ns = (int64_t)real.tv_sec * 1000000000LL + real.tv_nsec +
         ((int64_t)event_ns - ((int64_t)mono.tv_sec * 1000000000LL + mono.tv_nsec));
    sec = (time_t)(ns / 1000000000LL);
    gmtime_r(&sec, &tm);
    used = strftime(buf, size, "%Y-%m-%dT%H:%M:%S", &tm);
    if (used && used < size)
        snprintf(buf + used, size - used, ".%09lldZ",
                 (long long)(ns % 1000000000LL));
}
static int handle_event(void *ctx, void *data, size_t size)
{
    struct app *app = ctx;
    uint32_t kind;

    if (size < sizeof(kind))
        return 0;
    memcpy(&kind, data, sizeof(kind));

    if (kind == EVENT_DNS_PACKET) {
        const struct dns_packet_event *event = data;

        if (size < sizeof(*event) || app->no_dns ||
            event->captured_len != event->message_len)
            return 0;
        parse_dns_response(&app->cache, app->container_id, event->payload,
                           event->captured_len, event->timestamp_ns);
        return 0;
    }

    if (kind == EVENT_CONNECT) {
        const struct connection_event *event = data;
        struct cache_entry *entry;
        char ip[INET6_ADDRSTRLEN];
        char when[48] = {0};

        if (size < sizeof(*event) ||
            !inet_ntop(event->family, event->destination, ip, sizeof(ip)))
            return 0;
        cache_prune(&app->cache, event->timestamp_ns);
        entry = cache_find(&app->cache, app->container_id, event->family,
                           event->destination);
        wall_time(event->timestamp_ns, when, sizeof(when));
        printf("CONNECT time=%s timestamp_ns=%llu host_pid=%u tid=%u uid=%u "
               "comm=%.*s protocol=%s dst=%s:%u hostnames=",
               when, (unsigned long long)event->timestamp_ns, event->pid,
               event->tid, event->uid, TASK_COMM_LEN, event->comm,
               event->protocol == IPPROTO_TCP ? "tcp" : "udp", ip,
               event->destination_port);
        if (entry) {
            for (unsigned int i = 0; i < entry->count; i++) {
                if (i)
                    putchar(',');
                fputs(entry->names[i].value, stdout);
            }
        }
        putchar('\n');
        fflush(stdout);
    }
    return 0;
}

static uint64_t wanted_cgroup_id;
static char found_cgroup_path[PATH_MAX];
static int find_cgroup_cb(const char *path, const struct stat *st, int type,
                          struct FTW *ftw)
{
    (void)ftw;
    if (type == FTW_D && st && (uint64_t)st->st_ino == wanted_cgroup_id) {
        if (snprintf(found_cgroup_path, sizeof(found_cgroup_path), "%s", path) >=
            (int)sizeof(found_cgroup_path))
            return -1;
        return 1;
    }
    return 0;
}
static int cgroup_path_from_id(uint64_t id, char *path, size_t size)
{
    int ret;
    wanted_cgroup_id = id;
    found_cgroup_path[0] = '\0';
    ret = nftw("/sys/fs/cgroup", find_cgroup_cb, 32, FTW_PHYS);
    if (ret != 1 || !found_cgroup_path[0])
        return -1;
    return snprintf(path, size, "%s", found_cgroup_path) < (int)size ? 0 : -1;
}
static int bump_memlock(void)
{
    struct rlimit limit = {RLIM_INFINITY, RLIM_INFINITY};

    if (setrlimit(RLIMIT_MEMLOCK, &limit) && errno != EPERM) {
        perror("setrlimit(RLIMIT_MEMLOCK)");
        return -1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    static const struct option options[] = {
        {"cgroup-id", required_argument, NULL, 'c'},
        {"no-dns", no_argument, NULL, 'n'},
        {"dns-cache-max", required_argument, NULL, 'm'},
        {0},
    };
    static const char *counter_names[CNT_MAX] = {
        "ringbuf_fail",       "malformed_l3",       "malformed_ipv4",
        "fragmented_ipv4",   "unsupported_ipv6",   "malformed_udp",
        "dns_too_short",      "dns_capture_truncated", "dns_tcp_seen",
    };
    const char *id_arg = NULL;
    const char *cache_arg = NULL;
    struct app app = {0};
    struct netmon_bpf *skeleton = NULL;
    struct ring_buffer *ring = NULL;
    struct bpf_link *links[6] = {0};
    struct stat stat_buffer;
    struct statfs filesystem;
    char cgroup_path[PATH_MAX];
    char *end = NULL;
    size_t cache_max = DEFAULT_CACHE_MAX;
    int cgroup_fd = -1;
    int result = 1;
    int option;

    while ((option = getopt_long(argc, argv, "c:nm:", options, NULL)) != -1) {
        switch (option) {
        case 'c':
            id_arg = optarg;
            break;
        case 'n':
            app.no_dns = true;
            break;
        case 'm':
            cache_arg = optarg;
            break;
        default:
            fprintf(stderr,
                    "usage: %s --cgroup-id ID [--no-dns] "
                    "[--dns-cache-max N]\n",
                    argv[0]);
            return 2;
        }
    }
    if (!id_arg) {
        fprintf(stderr, "--cgroup-id is required\n");
        return 2;
    }
    errno = 0;
    app.container_id = strtoull(id_arg, &end, 10);
    if (errno || !app.container_id || end == id_arg || *end) {
        fprintf(stderr, "invalid cgroup ID: %s\n", id_arg);
        return 2;
    }
    if (cache_arg) {
        unsigned long parsed;

        errno = 0;
        parsed = strtoul(cache_arg, &end, 10);
        if (errno || end == cache_arg || *end || !parsed || parsed > 1000000) {
            fprintf(stderr, "invalid DNS cache size: %s\n", cache_arg);
            return 2;
        }
        cache_max = parsed;
    }
    if (statfs("/sys/fs/cgroup", &filesystem) ||
        filesystem.f_type != CGROUP2_SUPER_MAGIC) {
        fprintf(stderr, "cgroup v2 is not mounted at /sys/fs/cgroup\n");
        goto cleanup;
    }
    if (cgroup_path_from_id(app.container_id, cgroup_path,
                            sizeof(cgroup_path))) {
        fprintf(stderr, "cannot find cgroup v2 directory with ID %llu\n",
                (unsigned long long)app.container_id);
        goto cleanup;
    }
    if (stat(cgroup_path, &stat_buffer) || !S_ISDIR(stat_buffer.st_mode) ||
        (uint64_t)stat_buffer.st_ino != app.container_id) {
        fprintf(stderr, "resolved cgroup identity changed: %s\n", cgroup_path);
        goto cleanup;
    }
    cgroup_fd = open(cgroup_path, O_RDONLY | O_DIRECTORY);
    if (cgroup_fd < 0) {
        perror("open cgroup");
        goto cleanup;
    }
    fprintf(stderr, "cgroup=%s cgroup_id=%llu\n", cgroup_path,
            (unsigned long long)app.container_id);

    app.cache.capacity = cache_max;
    app.cache.entries = calloc(cache_max, sizeof(*app.cache.entries));
    if (!app.cache.entries) {
        perror("allocate DNS cache");
        goto cleanup;
    }
    libbpf_set_strict_mode(LIBBPF_STRICT_ALL);
    if (bump_memlock())
        goto cleanup;
    skeleton = netmon_bpf__open_and_load();
    if (!skeleton) {
        fprintf(stderr, "failed to open/load BPF skeleton\n");
        goto cleanup;
    }
    {
        struct bpf_program *programs[6] = {
            skeleton->progs.connect4,       skeleton->progs.connect6,
            skeleton->progs.sendmsg4,       skeleton->progs.sendmsg6,
            skeleton->progs.cgroup_ingress, skeleton->progs.cgroup_egress,
        };
        int attach_count = app.no_dns ? 4 : 6;

        for (int i = 0; i < attach_count; i++) {
            long error;

            links[i] = bpf_program__attach_cgroup(programs[i], cgroup_fd);
            error = libbpf_get_error(links[i]);
            if (error) {
                links[i] = NULL;
                fprintf(stderr, "cgroup attach failed: %s\n",
                        strerror((int)-error));
                goto cleanup;
            }
        }
    }
    ring = ring_buffer__new(bpf_map__fd(skeleton->maps.events), handle_event,
                            &app, NULL);
    if (!ring) {
        fprintf(stderr, "failed to create ring buffer: %s\n", strerror(errno));
        goto cleanup;
    }
    signal(SIGINT, on_signal);
    signal(SIGTERM, on_signal);
    fprintf(stderr, "attached connect4 connect6 sendmsg4 sendmsg6%s\n",
            app.no_dns ? "" : " cgroup_skb_ingress cgroup_skb_egress");
    {
        uint64_t last_maintenance = mono_ns();

        while (!exiting) {
            int poll_result = ring_buffer__poll(ring, 250);
            uint64_t now;

            if (poll_result == -EINTR)
                continue;
            if (poll_result < 0) {
                fprintf(stderr, "ring buffer poll: %s\n",
                        strerror(-poll_result));
                goto cleanup;
            }
            now = mono_ns();
            if (now - last_maintenance < 30000000000ULL)
                continue;
            cache_prune(&app.cache, now);
            last_maintenance = now;
            if (stat(cgroup_path, &stat_buffer) ||
                (uint64_t)stat_buffer.st_ino != app.container_id) {
                fprintf(stderr, "cgroup disappeared or changed identity\n");
                goto cleanup;
            }
        }
    }
    result = 0;

cleanup:
    if (skeleton) {
        int map_fd = bpf_map__fd(skeleton->maps.counters);
        int cpu_count = libbpf_num_possible_cpus();
        uint64_t *values = cpu_count > 0 ? calloc(cpu_count, sizeof(*values))
                                         : NULL;

        for (uint32_t key = 0; key < CNT_MAX && values; key++) {
            uint64_t total = 0;

            if (!bpf_map_lookup_elem(map_fd, &key, values)) {
                for (int cpu = 0; cpu < cpu_count; cpu++)
                    total += values[cpu];
            }
            fprintf(stderr, "counter.%s=%llu\n", counter_names[key],
                    (unsigned long long)total);
        }
        free(values);
    }
    ring_buffer__free(ring);
    for (size_t i = 0; i < sizeof(links) / sizeof(links[0]); i++)
        bpf_link__destroy(links[i]);
    netmon_bpf__destroy(skeleton);
    if (cgroup_fd >= 0)
        close(cgroup_fd);
    free(app.cache.entries);
    return result;
}

#ifdef NETMON_TEST
/* Tests include this file after renaming main and exercise static parser/cache functions. */
#endif
