# Isolate and inspect your LLM agent

## Usage

### Run Agent

Build the local image of Codex agent and runs it in foreground
Codex agent container is named `isolated_codex`

```bash
./codex/run.sh /path/to/your/workdir
```


### Run inspection tool

For prerequirements check shell.nix and run: 

```
nix-shell
```

Build code (optional, will be automatic later on):

```bash
make -C ./src/netmon
```

To inspect the Codex container:

Warning: it needs root (it will ask for it via sudo when needed)

```bash
./src/bpf_log.sh isolated_codex
```

Not complete example of output for when agent was asked to run `id`:

```
EXEC time=2026-08-06T20:18:17.271373Z host_pid=328231 ppid=266893 uid=1000 comm=bash file=/usr/bin/id args=id
RO time=2026-08-06T20:18:17.271488Z host_pid=328231 uid=1000 comm=id path=/etc/ld.so.cache flags=0x80000
RO time=2026-08-06T20:18:17.271494Z host_pid=328231 uid=1000 comm=id path=/lib/x86_64-linux-gnu/libselinux.so.1 flags=0x80000
RO time=2026-08-06T20:18:17.271507Z host_pid=328231 uid=1000 comm=id path=/lib/x86_64-linux-gnu/libc.so.6 flags=0x80000
RO time=2026-08-06T20:18:17.271522Z host_pid=328231 uid=1000 comm=id path=/lib/x86_64-linux-gnu/libpcre2-8.so.0 flags=0x80000
RO time=2026-08-06T20:18:17.271617Z host_pid=328231 uid=1000 comm=id path=/proc/filesystems flags=0x80000
RO time=2026-08-06T20:18:17.271631Z host_pid=328231 uid=1000 comm=id path= flags=0x80000
RO time=2026-08-06T20:18:17.271635Z host_pid=328231 uid=1000 comm=id path=/usr/share/locale/locale.alias flags=0x80000
RO time=2026-08-06T20:18:17.271637Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_IDENTIFICATION flags=0x80000
RO time=2026-08-06T20:18:17.271638Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_IDENTIFICATION flags=0x80000
RO time=2026-08-06T20:18:17.271641Z host_pid=328231 uid=1000 comm=id path=/usr/lib/x86_64-linux-gnu/gconv/gconv-modules.cache flags=0x80000
RO time=2026-08-06T20:18:17.271646Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_MEASUREMENT flags=0x80000
RO time=2026-08-06T20:18:17.271647Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_MEASUREMENT flags=0x80000
RO time=2026-08-06T20:18:17.271651Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_TELEPHONE flags=0x80000
RO time=2026-08-06T20:18:17.271651Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_TELEPHONE flags=0x80000
RO time=2026-08-06T20:18:17.271654Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_ADDRESS flags=0x80000
RO time=2026-08-06T20:18:17.271655Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_ADDRESS flags=0x80000
RO time=2026-08-06T20:18:17.271658Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_NAME flags=0x80000
RO time=2026-08-06T20:18:17.271659Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_NAME flags=0x80000
RO time=2026-08-06T20:18:17.271662Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_PAPER flags=0x80000
RO time=2026-08-06T20:18:17.271663Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_PAPER flags=0x80000
RO time=2026-08-06T20:18:17.271668Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_MESSAGES flags=0x80000
RO time=2026-08-06T20:18:17.271668Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_MESSAGES flags=0x80000
RO time=2026-08-06T20:18:17.271670Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_MESSAGES/SYS_LC_MESSAGES flags=0x80000
RO time=2026-08-06T20:18:17.271675Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_MONETARY flags=0x80000
RO time=2026-08-06T20:18:17.271675Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_MONETARY flags=0x80000
RO time=2026-08-06T20:18:17.271679Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_COLLATE flags=0x80000
RO time=2026-08-06T20:18:17.271679Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_COLLATE flags=0x80000
RO time=2026-08-06T20:18:17.271682Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_TIME flags=0x80000
RO time=2026-08-06T20:18:17.271683Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_TIME flags=0x80000
RO time=2026-08-06T20:18:17.271687Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_NUMERIC flags=0x80000
RO time=2026-08-06T20:18:17.271688Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_NUMERIC flags=0x80000
RO time=2026-08-06T20:18:17.271691Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.UTF-8/LC_CTYPE flags=0x80000
RO time=2026-08-06T20:18:17.271692Z host_pid=328231 uid=1000 comm=id path=/usr/lib/locale/C.utf8/LC_CTYPE flags=0x80000
RO time=2026-08-06T20:18:17.271718Z host_pid=328231 uid=1000 comm=id path=/etc/nsswitch.conf flags=0x80000
RO time=2026-08-06T20:18:17.271728Z host_pid=328231 uid=1000 comm=id path=/etc/passwd flags=0x80000
RO time=2026-08-06T20:18:17.271737Z host_pid=328231 uid=1000 comm=id path=/etc/group flags=0x80000
RO time=2026-08-06T20:18:17.271742Z host_pid=328231 uid=1000 comm=id path=/proc/sys/kernel/ngroups_max flags=0x80000
RO time=2026-08-06T20:18:17.271748Z host_pid=328231 uid=1000 comm=id path=/proc/sys/kernel/ngroups_max flags=0x80000
RO time=2026-08-06T20:18:17.271750Z host_pid=328231 uid=1000 comm=id path=/etc/group flags=0x80000
EXEC time=2026-08-06T20:18:17.293593Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/root/.codex/tmp/arg0/codex-arg0MndDIo/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293614Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293632Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/local/sbin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293642Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/local/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293653Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/sbin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293662Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293671Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/sbin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293683Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293696Z host_pid=328232 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/local/share/npm-global/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.293901Z host_pid=328233 ppid=266889 uid=1000 comm=tokio-rt-worker file=/root/.codex/tmp/arg0/codex-arg0MndDIo/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.293911Z host_pid=328233 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.293919Z host_pid=328233 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/local/sbin/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.293928Z host_pid=328233 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/local/bin/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.293935Z host_pid=328233 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/sbin/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.293943Z host_pid=328233 ppid=266889 uid=1000 comm=tokio-rt-worker file=/usr/bin/getconf args=getconf LONG_BIT
RO time=2026-08-06T20:18:17.294074Z host_pid=328233 uid=1000 comm=getconf path=/etc/ld.so.cache flags=0x80000
RO time=2026-08-06T20:18:17.294087Z host_pid=328233 uid=1000 comm=getconf path=/lib/x86_64-linux-gnu/libc.so.6 flags=0x80000
CONNECT time=2026-08-06T20:18:17.303773836Z timestamp_ns=30290898777320 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=192.168.88.22:53 hostnames=
CONNECT time=2026-08-06T20:18:17.303820820Z timestamp_ns=30290898824289 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=192.168.88.22:53 hostnames=
CONNECT time=2026-08-06T20:18:17.305183268Z timestamp_ns=30290900186741 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=2606:4700:4408::ac40:9bd1:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.305192716Z timestamp_ns=30290900196185 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=2a06:98c1:3101::6812:202f:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.305195655Z timestamp_ns=30290900199124 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=104.18.32.47:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.305199882Z timestamp_ns=30290900203350 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=172.64.155.209:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.305237673Z timestamp_ns=30290900241141 host_pid=266875 tid=266889 uid=1000 comm=tokio-rt-worker protocol=tcp dst=172.64.155.209:443 hostnames=chatgpt.com
EXEC time=2026-08-06T20:18:17.313165Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/root/.codex/tmp/arg0/codex-arg0MndDIo/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313187Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313205Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/local/sbin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313216Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/local/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313227Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/sbin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313239Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313251Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/sbin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313267Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313280Z host_pid=328234 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/local/share/npm-global/bin/lsb_release args=lsb_release -a
EXEC time=2026-08-06T20:18:17.313489Z host_pid=328235 ppid=328193 uid=1000 comm=tokio-rt-worker file=/root/.codex/tmp/arg0/codex-arg0MndDIo/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.313507Z host_pid=328235 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/lib/node_modules/@openai/codex/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/codex-path/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.313523Z host_pid=328235 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/local/sbin/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.313533Z host_pid=328235 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/local/bin/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.313543Z host_pid=328235 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/sbin/getconf args=getconf LONG_BIT
EXEC time=2026-08-06T20:18:17.313553Z host_pid=328235 ppid=328193 uid=1000 comm=tokio-rt-worker file=/usr/bin/getconf args=getconf LONG_BIT
RO time=2026-08-06T20:18:17.313698Z host_pid=328235 uid=1000 comm=getconf path=/etc/ld.so.cache flags=0x80000
RO time=2026-08-06T20:18:17.313716Z host_pid=328235 uid=1000 comm=getconf path=/lib/x86_64-linux-gnu/libc.so.6 flags=0x80000
CONNECT time=2026-08-06T20:18:17.318457991Z timestamp_ns=30290913461473 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=192.168.88.22:53 hostnames=
CONNECT time=2026-08-06T20:18:17.318474702Z timestamp_ns=30290913478172 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=192.168.88.22:53 hostnames=
CONNECT time=2026-08-06T20:18:17.319919867Z timestamp_ns=30290914923340 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=2a06:98c1:3101::6812:202f:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.319928349Z timestamp_ns=30290914931832 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=2606:4700:4408::ac40:9bd1:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.319932463Z timestamp_ns=30290914935931 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=172.64.155.209:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.319936688Z timestamp_ns=30290914940157 host_pid=266875 tid=328194 uid=1000 comm=tokio-rt-worker protocol=udp dst=104.18.32.47:65535 hostnames=chatgpt.com
CONNECT time=2026-08-06T20:18:17.319961980Z timestamp_ns=30290914965449 host_pid=266875 tid=266894 uid=1000 comm=tokio-rt-worker protocol=tcp dst=172.64.155.209:443 hostnames=chatgpt.com
```
