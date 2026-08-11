package dnscache

import "github.com/miekg/dns"

type cname struct {
	alias  string
	target string
	ttl    uint32
}

func ParseResponse(cache *Cache, id uint64, message []byte, now uint64) (int, error) {
	if len(message) < 12 {
		return -1, dns.ErrBuf
	}

	var msg dns.Msg
	if err := msg.Unpack(message); err != nil || !msg.Response {
		if err == nil {
			err = dns.ErrBuf
		}
		return -1, err
	}

	cnames := make([]cname, 0, 32)
	for _, rr := range msg.Answer {
		record, ok := rr.(*dns.CNAME)
		if !ok || len(cnames) >= 32 {
			continue
		}
		alias := cleanName(record.Hdr.Name)
		target := cleanName(record.Target)
		if len(alias) <= MaxHostname && len(target) <= MaxHostname {
			cnames = append(cnames, cname{alias: alias, target: target, ttl: record.Hdr.Ttl})
		}
	}

	inserted := 0
	for _, rr := range msg.Answer {
		switch record := rr.(type) {
		case *dns.A:
			name := cleanName(record.Hdr.Name)
			cache.Put(id, 2, record.A.To4(), name, record.Hdr.Ttl, now)
			inserted++
			insertCNAMEs(cache, id, 2, record.A.To4(), name, record.Hdr.Ttl, cnames, now)
		case *dns.AAAA:
			name := cleanName(record.Hdr.Name)
			cache.Put(id, 10, record.AAAA.To16(), name, record.Hdr.Ttl, now)
			inserted++
			insertCNAMEs(cache, id, 10, record.AAAA.To16(), name, record.Hdr.Ttl, cnames, now)
		}
	}

	return inserted, nil
}

func insertCNAMEs(cache *Cache, id uint64, family int, address []byte, name string, ttl uint32, cnames []cname, now uint64) {
	for _, cn := range cnames {
		if !equalFoldClean(cn.target, name) {
			continue
		}
		aliasTTL := ttl
		if cn.ttl < aliasTTL {
			aliasTTL = cn.ttl
		}
		cache.Put(id, family, address, cn.alias, aliasTTL, now)
	}
}

func equalFoldClean(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}
