package file

import "testing"

func TestParseContentDisposition(t *testing.T) {
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{
			name:   "empty header",
			header: "",
			want:   "",
		},
		{
			name:   "attachment with quoted filename",
			header: `attachment; filename="example.txt"`,
			want:   "example.txt",
		},
		{
			name:   "attachment with unquoted filename",
			header: `attachment; filename=example.txt`,
			want:   "example.txt",
		},
		{
			name:   "inline with filename",
			header: `inline; filename="report.pdf"`,
			want:   "report.pdf",
		},
		{
			name:   "no filename parameter",
			header: `attachment`,
			want:   "",
		},
		{
			name:   "filename star with UTF-8 encoding",
			header: `attachment; filename*=UTF-8''example%20file.txt`,
			want:   "example file.txt",
		},
		{
			name:   "filename star takes precedence when last",
			header: `attachment; filename="fallback.txt"; filename*=UTF-8''preferred%20name.txt`,
			want:   "preferred name.txt",
		},
		{
			name:   "filename with spaces in quotes",
			header: `attachment; filename="my document.pdf"`,
			want:   "my document.pdf",
		},
		{
			name:   "mixed case Filename",
			header: `attachment; Filename="CaseTest.doc"`,
			want:   "CaseTest.doc",
		},
		{
			name:   "percent encoded characters",
			header: `attachment; filename*=UTF-8''hello%20world%21.txt`,
			want:   "hello world!.txt",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParseContentDisposition(tt.header)
			if got != tt.want {
				t.Errorf("ParseContentDisposition(%q) = %q, want %q", tt.header, got, tt.want)
			}
		})
	}
}
