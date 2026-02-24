package file

import (
	"strings"
)

// ParseContentDisposition extracts the filename from a Content-Disposition header value.
// It handles both RFC 6266 forms:
//
//	attachment; filename="example.txt"
//	attachment; filename=example.txt
//	attachment; filename*=UTF-8''example%20file.txt
//
// Returns an empty string if no filename is found.
func ParseContentDisposition(header string) string {
	if header == "" {
		return ""
	}

	var filename string
	var filenameStar string

	// Normalize and split on semicolons.
	parts := strings.Split(header, ";")
	for _, part := range parts {
		part = strings.TrimSpace(part)

		// Check for filename*= (RFC 5987 extended parameter).
		if strings.HasPrefix(strings.ToLower(part), "filename*=") {
			val := part[len("filename*="):]
			// Format is: charset'language'value (e.g., UTF-8''example%20file.txt)
			if idx := strings.LastIndex(val, "'"); idx >= 0 {
				val = val[idx+1:]
			}
			val = decodePercent(val)
			val = unquote(val)
			if val != "" {
				filenameStar = val
			}
			continue
		}

		// Check for filename=.
		if strings.HasPrefix(strings.ToLower(part), "filename=") {
			val := part[len("filename="):]
			val = unquote(val)
			if val != "" {
				filename = val
			}
		}
	}

	// Per RFC 6266, filename* takes precedence over filename.
	if filenameStar != "" {
		return filenameStar
	}
	return filename
}

// unquote removes surrounding double quotes from a string.
func unquote(s string) string {
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}

// decodePercent performs basic percent-decoding (RFC 3986).
func decodePercent(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	i := 0
	for i < len(s) {
		if s[i] == '%' && i+2 < len(s) {
			hi := unhex(s[i+1])
			lo := unhex(s[i+2])
			if hi >= 0 && lo >= 0 {
				b.WriteByte(byte(hi<<4 | lo))
				i += 3
				continue
			}
		}
		b.WriteByte(s[i])
		i++
	}
	return b.String()
}

// unhex returns the numeric value of a hex digit, or -1 if invalid.
func unhex(c byte) int {
	switch {
	case '0' <= c && c <= '9':
		return int(c - '0')
	case 'a' <= c && c <= 'f':
		return int(c - 'a' + 10)
	case 'A' <= c && c <= 'F':
		return int(c - 'A' + 10)
	default:
		return -1
	}
}
