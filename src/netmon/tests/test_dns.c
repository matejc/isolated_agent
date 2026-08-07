#define main netmon_program_main
#include "../src/netmon.c"
#undef main
#include <assert.h>

/* Raw response fixtures use example.com and DNS compression (c00c). */
static const uint8_t a_one[]={0x12,0x34,0x81,0x80,0,1,0,1,0,0,0,0,7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,1,0,1,0xc0,0x0c,0,1,0,1,0,0,0,60,0,4,1,2,3,4};
static const uint8_t aaaa_one[]={0,1,0x81,0x80,0,1,0,1,0,0,0,0,7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,0x1c,0,1,0xc0,0x0c,0,0x1c,0,1,0,0,0,60,0,16,0x20,1,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,1};
static const uint8_t cname_a[]={0,2,0x81,0x80,0,1,0,2,0,0,0,0,3,'w','w','w',7,'e','x','a','m','p','l','e',3,'c','o','m',0,0,1,0,1,0xc0,0x0c,0,5,0,1,0,0,0,30,0,2,0xc0,0x10,0xc0,0x10,0,1,0,1,0,0,0,60,0,4,5,6,7,8};
static const uint8_t multi_a[]={0,3,0x81,0x80,0,1,0,2,0,0,0,0,1,'x',0,0,1,0,1,0xc0,0x0c,0,1,0,1,0,0,0,60,0,4,10,0,0,1,0xc0,0x0c,0,1,0,1,0,0,0,60,0,4,10,0,0,2};
static const uint8_t nxdomain[]={0,4,0x81,0x83,0,1,0,0,0,0,0,0,1,'x',0,0,1,0,1};
static const uint8_t zero_ttl[]={0,5,0x81,0x80,0,1,0,1,0,0,0,0,1,'z',0,0,1,0,1,0xc0,0x0c,0,1,0,1,0,0,0,0,0,4,9,9,9,9};
static const uint8_t malformed[]={0,1,2};

int main(void)
{
    struct dns_cache c={.capacity=2,.entries=calloc(2,sizeof(struct cache_entry))};uint64_t t=1000000000ULL;uint8_t ip4[4]={1,2,3,4},ip6[16]={0x20,1,0x0d,0xb8,0,0,0,0,0,0,0,0,0,0,0,1};
    assert(parse_dns_response(&c,7,a_one,sizeof(a_one),t)==1);assert(cache_find(&c,7,AF_INET,ip4));
    assert(parse_dns_response(&c,7,aaaa_one,sizeof(aaaa_one),t)==1);assert(cache_find(&c,7,AF_INET6,ip6));
    memset(c.entries,0,2*sizeof(*c.entries));c.count=0;assert(parse_dns_response(&c,7,cname_a,sizeof(cname_a),t)==1);uint8_t ca[4]={5,6,7,8};struct cache_entry*e=cache_find(&c,7,AF_INET,ca);assert(e&&e->count==2);
    assert(parse_dns_response(&c,7,nxdomain,sizeof(nxdomain),t)==0);assert(parse_dns_response(&c,7,malformed,sizeof(malformed),t)<0);assert(parse_dns_response(&c,7,a_one,sizeof(a_one)-2,t)<0);
    memset(c.entries,0,2*sizeof(*c.entries));c.count=0;assert(parse_dns_response(&c,7,multi_a,sizeof(multi_a),t)==2);assert(c.count==2);
    assert(parse_dns_response(&c,7,zero_ttl,sizeof(zero_ttl),t)==1);assert(c.count==2); /* zero TTL was not inserted; limit remains bounded */
    cache_put(&c,8,AF_INET,ip4,"duplicate.example",1,t);assert(c.count<=c.capacity);cache_put(&c,8,AF_INET,ip4,"duplicate.example",2,t);e=cache_find(&c,8,AF_INET,ip4);assert(e&&e->count==1);
    cache_put(&c,8,AF_INET,ip4,"alias.example",1,t);assert(e->count==2);cache_prune(&c,t+3000000000ULL);assert(!cache_find(&c,8,AF_INET,ip4));
    memset(c.entries,0,2*sizeof(*c.entries));c.count=0;
    cache_put(&c,9,AF_INET,ip4,"v4",10,t);cache_put(&c,9,AF_INET6,(uint8_t[16]){1,2,3,4},"v6",10,t);assert(cache_find(&c,9,AF_INET,ip4)&&cache_find(&c,9,AF_INET6,(uint8_t[16]){1,2,3,4}));
    free(c.entries);puts("DNS/cache tests passed");return 0;
}
