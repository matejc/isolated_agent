package dnscache

import (
	"fmt"
	"net"
	"testing"
)

func TestPutReplacesOldestNameWhenFull(t *testing.T) {
	cache := New(1)
	address := net.ParseIP("192.0.2.1").To4()

	for i := 0; i < MaxNames; i++ {
		cache.Put(1, 2, address, fmt.Sprintf("name-%d.example", i), 60, uint64(i))
	}
	cache.Put(1, 2, address, "new.example", 60, MaxNames)

	entry := cache.Find(1, 2, address)
	if entry == nil {
		t.Fatal("cache entry not found")
	}
	if len(entry.Names) != MaxNames {
		t.Fatalf("got %d names, want %d", len(entry.Names), MaxNames)
	}
	if got := entry.Names[0].Value; got != "name-1.example" {
		t.Fatalf("first name = %q, want %q", got, "name-1.example")
	}
	if got := entry.Names[MaxNames-1].Value; got != "new.example" {
		t.Fatalf("last name = %q, want %q", got, "new.example")
	}
}

func TestPutRefreshesExistingNameWithoutEviction(t *testing.T) {
	cache := New(1)
	address := net.ParseIP("192.0.2.1").To4()

	for i := 0; i < MaxNames; i++ {
		cache.Put(1, 2, address, fmt.Sprintf("name-%d.example", i), 60, uint64(i))
	}
	cache.Put(1, 2, address, "NAME-0.EXAMPLE", 120, 100)

	entry := cache.Find(1, 2, address)
	if got := entry.Names[0].Value; got != "name-0.example" {
		t.Fatalf("first name = %q, duplicate refresh evicted or reordered it", got)
	}
	if got, want := entry.Names[0].ExpiresNS, uint64(120_000_000_100); got != want {
		t.Fatalf("expiration = %d, want %d", got, want)
	}
}
