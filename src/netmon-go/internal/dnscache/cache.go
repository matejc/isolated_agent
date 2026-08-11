package dnscache

import (
	"bytes"
	"net"
	"strings"
)

const (
	MaxNames    = 8
	MaxHostname = 253
)

type Name struct {
	Value     string
	ExpiresNS uint64
}

type Entry struct {
	ContainerID uint64
	Family      int
	Address     [16]byte
	Names       []Name
	TouchedNS   uint64
}

type Cache struct {
	entries  []Entry
	capacity int
}

func New(capacity int) *Cache {
	return &Cache{capacity: capacity, entries: make([]Entry, 0, capacity)}
}

func (c *Cache) Count() int {
	return len(c.entries)
}

func (c *Cache) Find(id uint64, family int, address []byte) *Entry {
	addressSize := addrSize(family)
	if addressSize == 0 || len(address) < addressSize {
		return nil
	}
	for i := range c.entries {
		entry := &c.entries[i]
		if entry.ContainerID == id && entry.Family == family && bytes.Equal(entry.Address[:addressSize], address[:addressSize]) {
			return entry
		}
	}
	return nil
}

func (c *Cache) Put(id uint64, family int, address []byte, name string, ttl uint32, now uint64) {
	addressSize := addrSize(family)
	name = cleanName(name)
	if ttl == 0 || name == "" || len(name) > MaxHostname || addressSize == 0 || len(address) < addressSize || c.capacity <= 0 {
		return
	}

	entry := c.Find(id, family, address)
	if entry == nil {
		if len(c.entries) >= c.capacity {
			victim := 0
			oldest := ^uint64(0)
			for i := range c.entries {
				if c.entries[i].TouchedNS < oldest {
					oldest = c.entries[i].TouchedNS
					victim = i
				}
			}
			entry = &c.entries[victim]
			*entry = Entry{}
		} else {
			c.entries = append(c.entries, Entry{})
			entry = &c.entries[len(c.entries)-1]
		}
		entry.ContainerID = id
		entry.Family = family
		copy(entry.Address[:], address[:addressSize])
	}

	entry.TouchedNS = now
	expires := now + uint64(ttl)*1_000_000_000
	for i := range entry.Names {
		if strings.EqualFold(entry.Names[i].Value, name) {
			entry.Names[i].ExpiresNS = expires
			return
		}
	}
	if len(entry.Names) < MaxNames {
		entry.Names = append(entry.Names, Name{Value: name, ExpiresNS: expires})
	}
}

func (c *Cache) Prune(now uint64) {
	keptEntries := c.entries[:0]
	for i := range c.entries {
		entry := c.entries[i]
		keptNames := entry.Names[:0]
		for _, name := range entry.Names {
			if name.ExpiresNS > now {
				keptNames = append(keptNames, name)
			}
		}
		entry.Names = keptNames
		if len(entry.Names) > 0 {
			keptEntries = append(keptEntries, entry)
		}
	}
	c.entries = keptEntries
}

func addrSize(family int) int {
	switch family {
	case 2:
		return net.IPv4len
	case 10:
		return net.IPv6len
	default:
		return 0
	}
}

func cleanName(name string) string {
	return strings.TrimSuffix(name, ".")
}
