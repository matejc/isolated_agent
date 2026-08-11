package dnscache

import "testing"

var (
	aOne     = []byte{0x12, 0x34, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0, 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 3, 'c', 'o', 'm', 0, 0, 1, 0, 1, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 1, 2, 3, 4}
	aaaaOne  = []byte{0, 1, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0, 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 3, 'c', 'o', 'm', 0, 0, 0x1c, 0, 1, 0xc0, 0x0c, 0, 0x1c, 0, 1, 0, 0, 0, 60, 0, 16, 0x20, 1, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}
	cnameA   = []byte{0, 2, 0x81, 0x80, 0, 1, 0, 2, 0, 0, 0, 0, 3, 'w', 'w', 'w', 7, 'e', 'x', 'a', 'm', 'p', 'l', 'e', 3, 'c', 'o', 'm', 0, 0, 1, 0, 1, 0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 30, 0, 2, 0xc0, 0x10, 0xc0, 0x10, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 5, 6, 7, 8}
	multiA   = []byte{0, 3, 0x81, 0x80, 0, 1, 0, 2, 0, 0, 0, 0, 1, 'x', 0, 0, 1, 0, 1, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, 1, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 60, 0, 4, 10, 0, 0, 2}
	nxdomain = []byte{0, 4, 0x81, 0x83, 0, 1, 0, 0, 0, 0, 0, 0, 1, 'x', 0, 0, 1, 0, 1}
	zeroTTL  = []byte{0, 5, 0x81, 0x80, 0, 1, 0, 1, 0, 0, 0, 0, 1, 'z', 0, 0, 1, 0, 1, 0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 0, 0, 4, 9, 9, 9, 9}
)

func TestDNSCache(t *testing.T) {
	c := New(2)
	tm := uint64(1_000_000_000)
	ip4 := []byte{1, 2, 3, 4}
	ip6 := []byte{0x20, 1, 0x0d, 0xb8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}

	if n, err := ParseResponse(c, 7, aOne, tm); err != nil || n != 1 {
		t.Fatalf("A parse = %d, %v", n, err)
	}
	if c.Find(7, 2, ip4) == nil {
		t.Fatal("missing A cache entry")
	}
	if n, err := ParseResponse(c, 7, aaaaOne, tm); err != nil || n != 1 {
		t.Fatalf("AAAA parse = %d, %v", n, err)
	}
	if c.Find(7, 10, ip6) == nil {
		t.Fatal("missing AAAA cache entry")
	}

	c = New(2)
	if n, err := ParseResponse(c, 7, cnameA, tm); err != nil || n != 1 {
		t.Fatalf("CNAME parse = %d, %v", n, err)
	}
	entry := c.Find(7, 2, []byte{5, 6, 7, 8})
	if entry == nil || len(entry.Names) != 2 {
		t.Fatalf("CNAME entry = %#v", entry)
	}
	if n, err := ParseResponse(c, 7, nxdomain, tm); err != nil || n != 0 {
		t.Fatalf("NXDOMAIN parse = %d, %v", n, err)
	}
	if _, err := ParseResponse(c, 7, []byte{0, 1, 2}, tm); err == nil {
		t.Fatal("malformed response succeeded")
	}
	if _, err := ParseResponse(c, 7, aOne[:len(aOne)-2], tm); err == nil {
		t.Fatal("truncated response succeeded")
	}

	c = New(2)
	if n, err := ParseResponse(c, 7, multiA, tm); err != nil || n != 2 {
		t.Fatalf("multi A parse = %d, %v", n, err)
	}
	if c.Count() != 2 {
		t.Fatalf("cache count = %d", c.Count())
	}
	if n, err := ParseResponse(c, 7, zeroTTL, tm); err != nil || n != 1 {
		t.Fatalf("zero TTL parse = %d, %v", n, err)
	}
	if c.Count() != 2 {
		t.Fatalf("zero TTL changed count to %d", c.Count())
	}

	c.Put(8, 2, ip4, "duplicate.example", 1, tm)
	c.Put(8, 2, ip4, "duplicate.example", 2, tm)
	entry = c.Find(8, 2, ip4)
	if entry == nil || len(entry.Names) != 1 {
		t.Fatalf("duplicate entry = %#v", entry)
	}
	c.Put(8, 2, ip4, "alias.example", 1, tm)
	if len(entry.Names) != 2 {
		t.Fatalf("alias count = %d", len(entry.Names))
	}
	c.Prune(tm + 3_000_000_000)
	if c.Find(8, 2, ip4) != nil {
		t.Fatal("expired entry survived prune")
	}

	c = New(2)
	c.Put(9, 2, ip4, "v4", 10, tm)
	v6 := []byte{1, 2, 3, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}
	c.Put(9, 10, v6, "v6", 10, tm)
	if c.Find(9, 2, ip4) == nil || c.Find(9, 10, v6) == nil {
		t.Fatal("family-specific entries missing")
	}
}
