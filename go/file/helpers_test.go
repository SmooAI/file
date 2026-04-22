package file

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	v4 "github.com/aws/aws-sdk-go-v2/aws/signer/v4"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// PNG magic bytes (signature + minimal IHDR chunk prefix). The mimetype
// library recognizes this as image/png.
var pngBytes = []byte{
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
	0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,
	0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
	0x08, 0x00, 0x00, 0x00, 0x00,
}

// --- ToBase64 ---

func TestToBase64(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{
			name: "ascii foo",
			data: []byte("foo"),
			want: "Zm9v",
		},
		{
			name: "empty bytes",
			data: []byte{},
			want: "",
		},
		{
			name: "binary bytes",
			data: []byte{0x00, 0x01, 0x02, 0x03},
			want: base64.StdEncoding.EncodeToString([]byte{0x00, 0x01, 0x02, 0x03}),
		},
		{
			name: "png bytes",
			data: pngBytes,
			want: base64.StdEncoding.EncodeToString(pngBytes),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := NewFromBytes(tt.data)
			if err != nil {
				t.Fatalf("NewFromBytes: %v", err)
			}
			got, err := f.ToBase64()
			if err != nil {
				t.Fatalf("ToBase64: %v", err)
			}
			if got != tt.want {
				t.Errorf("ToBase64() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- Validate ---

func TestValidate_HappyPath(t *testing.T) {
	f, err := NewFromBytes(pngBytes, MetadataHint{Name: "pic.png", MimeType: "image/png"})
	if err != nil {
		t.Fatalf("NewFromBytes: %v", err)
	}
	err = f.Validate(ValidateOptions{
		MaxSize:          1024,
		AllowedMimes:     []string{"image/png", "image/jpeg"},
		ExpectedMimeType: "image/png",
	})
	if err != nil {
		t.Fatalf("expected no error, got %v", err)
	}
}

func TestValidate_EmptyOptionsIsNoOp(t *testing.T) {
	f, err := NewFromBytes(pngBytes)
	if err != nil {
		t.Fatalf("NewFromBytes: %v", err)
	}
	if err := f.Validate(ValidateOptions{}); err != nil {
		t.Errorf("empty options should be a no-op, got %v", err)
	}
}

func TestValidate_SizeFailures(t *testing.T) {
	tests := []struct {
		name       string
		hint       MetadataHint
		data       []byte
		maxSize    int64
		wantActual int64
	}{
		{
			name:       "bytes exceed maxSize",
			data:       pngBytes,
			maxSize:    5,
			wantActual: int64(len(pngBytes)),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, err := NewFromBytes(tt.data, tt.hint)
			if err != nil {
				t.Fatalf("NewFromBytes: %v", err)
			}
			err = f.Validate(ValidateOptions{MaxSize: tt.maxSize})
			if err == nil {
				t.Fatal("expected error, got nil")
			}

			var vErr *FileValidationError
			if !errors.As(err, &vErr) {
				t.Fatalf("expected *FileValidationError, got %T: %v", err, err)
			}
			if vErr.Kind != KindSize {
				t.Errorf("Kind = %q, want %q", vErr.Kind, KindSize)
			}
			if vErr.MaxSize != tt.maxSize {
				t.Errorf("MaxSize = %d, want %d", vErr.MaxSize, tt.maxSize)
			}
			if vErr.ActualSize != tt.wantActual {
				t.Errorf("ActualSize = %d, want %d", vErr.ActualSize, tt.wantActual)
			}
			if !errors.Is(err, ErrFileValidation) {
				t.Error("expected errors.Is(err, ErrFileValidation) to be true")
			}
		})
	}
}

func TestValidate_MimeFailure(t *testing.T) {
	f, err := NewFromBytes(pngBytes, MetadataHint{Name: "pic.png", MimeType: "image/png"})
	if err != nil {
		t.Fatalf("NewFromBytes: %v", err)
	}
	err = f.Validate(ValidateOptions{AllowedMimes: []string{"application/pdf"}})
	if err == nil {
		t.Fatal("expected error")
	}

	var vErr *FileValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected *FileValidationError, got %T", err)
	}
	if vErr.Kind != KindMime {
		t.Errorf("Kind = %q, want %q", vErr.Kind, KindMime)
	}
	if vErr.ActualMimeType != "image/png" {
		t.Errorf("ActualMimeType = %q, want %q", vErr.ActualMimeType, "image/png")
	}
	if len(vErr.AllowedMimes) != 1 || vErr.AllowedMimes[0] != "application/pdf" {
		t.Errorf("AllowedMimes = %v, want [application/pdf]", vErr.AllowedMimes)
	}
	// Verify the error message contains useful context.
	msg := err.Error()
	if !strings.Contains(msg, "image/png") || !strings.Contains(msg, "application/pdf") {
		t.Errorf("error message %q should contain both the actual and allowed mime types", msg)
	}
}

func TestValidate_MimeFailure_DefensiveCopy(t *testing.T) {
	// Mutating the caller's slice must not alter the error's AllowedMimes.
	allowed := []string{"application/pdf"}
	f, _ := NewFromBytes(pngBytes, MetadataHint{Name: "pic.png", MimeType: "image/png"})
	err := f.Validate(ValidateOptions{AllowedMimes: allowed})
	if err == nil {
		t.Fatal("expected error")
	}
	allowed[0] = "mutated"

	var vErr *FileValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected *FileValidationError")
	}
	if vErr.AllowedMimes[0] != "application/pdf" {
		t.Errorf("AllowedMimes was not defensively copied: %v", vErr.AllowedMimes)
	}
}

func TestValidate_ContentMismatch(t *testing.T) {
	// Bytes are a PNG but caller claims the client sent application/pdf.
	// Classic mime-spoofing defense.
	f, err := NewFromBytes(pngBytes, MetadataHint{Name: "spoofed.pdf", MimeType: "application/pdf"})
	if err != nil {
		t.Fatalf("NewFromBytes: %v", err)
	}
	err = f.Validate(ValidateOptions{ExpectedMimeType: "application/pdf"})
	if err == nil {
		t.Fatal("expected content-mismatch error")
	}

	var vErr *FileValidationError
	if !errors.As(err, &vErr) {
		t.Fatalf("expected *FileValidationError, got %T", err)
	}
	if vErr.Kind != KindContentMismatch {
		t.Errorf("Kind = %q, want %q", vErr.Kind, KindContentMismatch)
	}
	if vErr.ClaimedMimeType != "application/pdf" {
		t.Errorf("ClaimedMimeType = %q, want %q", vErr.ClaimedMimeType, "application/pdf")
	}
	if vErr.DetectedMimeType != "image/png" {
		t.Errorf("DetectedMimeType = %q, want %q", vErr.DetectedMimeType, "image/png")
	}
}

func TestValidate_ErrorsIs_MatchesSentinel(t *testing.T) {
	f, _ := NewFromBytes(pngBytes, MetadataHint{MimeType: "image/png"})
	err := f.Validate(ValidateOptions{AllowedMimes: []string{"application/pdf"}})
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrFileValidation) {
		t.Error("errors.Is(err, ErrFileValidation) should be true for any validation failure")
	}
}

func TestFileValidationError_ErrorMessages(t *testing.T) {
	tests := []struct {
		name string
		err  *FileValidationError
		want string
	}{
		{
			name: "size known",
			err:  &FileValidationError{Kind: KindSize, ActualSize: 100, MaxSize: 50},
			want: "file: size (100 bytes) exceeds maximum allowed (50 bytes)",
		},
		{
			name: "size unknown",
			err:  &FileValidationError{Kind: KindSize, ActualSize: -1, MaxSize: 50},
			want: "file: size is unknown; maxSize is 50 bytes",
		},
		{
			name: "mime with actual",
			err: &FileValidationError{
				Kind:           KindMime,
				ActualMimeType: "text/html",
				AllowedMimes:   []string{"image/png"},
			},
			want: `file: mime type "text/html" is not in the allowed list: [image/png]`,
		},
		{
			name: "mime without actual",
			err: &FileValidationError{
				Kind:         KindMime,
				AllowedMimes: []string{"image/png"},
			},
			want: "file: mime type is unknown; allowed types are: [image/png]",
		},
		{
			name: "content mismatch",
			err: &FileValidationError{
				Kind:             KindContentMismatch,
				ClaimedMimeType:  "application/pdf",
				DetectedMimeType: "image/png",
			},
			want: "file: content does not match claimed mime type; claimed=application/pdf detected=image/png",
		},
		{
			name: "content mismatch with unknowns",
			err:  &FileValidationError{Kind: KindContentMismatch},
			want: "file: content does not match claimed mime type; claimed=unknown detected=unknown",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.err.Error(); got != tt.want {
				t.Errorf("Error() = %q, want %q", got, tt.want)
			}
		})
	}
}

// --- CreatePresignedUploadURL ---

func TestCreatePresignedUploadURL(t *testing.T) {
	var capturedBucket, capturedKey, capturedCT string
	var capturedCL int64
	var capturedExpires time.Duration

	presign := &mockPresignClient{
		presignPutObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
			capturedBucket = *params.Bucket
			capturedKey = *params.Key
			if params.ContentType != nil {
				capturedCT = *params.ContentType
			}
			if params.ContentLength != nil {
				capturedCL = *params.ContentLength
			}

			// Apply option functions to inspect Expires.
			opts := &s3.PresignOptions{}
			for _, fn := range optFns {
				fn(opts)
			}
			capturedExpires = opts.Expires

			return &v4.PresignedHTTPRequest{
				URL:    fmt.Sprintf("https://%s.s3.amazonaws.com/%s?signed=true", *params.Bucket, *params.Key),
				Method: "PUT",
			}, nil
		},
	}

	cleanup := setMockS3(&mockS3Client{}, presign)
	defer cleanup()

	url, err := CreatePresignedUploadURL(context.Background(), "my-bucket", "uploads/avatar.png", &PresignedUploadOptions{
		ContentType: "image/png",
		ExpiresIn:   10 * time.Minute,
		MaxSize:     2 * 1024 * 1024,
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !strings.Contains(url, "signed=true") {
		t.Errorf("URL %q should contain 'signed=true'", url)
	}
	if capturedBucket != "my-bucket" {
		t.Errorf("bucket = %q, want %q", capturedBucket, "my-bucket")
	}
	if capturedKey != "uploads/avatar.png" {
		t.Errorf("key = %q, want %q", capturedKey, "uploads/avatar.png")
	}
	if capturedCT != "image/png" {
		t.Errorf("ContentType = %q, want %q", capturedCT, "image/png")
	}
	if capturedCL != 2*1024*1024 {
		t.Errorf("ContentLength = %d, want %d", capturedCL, 2*1024*1024)
	}
	if capturedExpires != 10*time.Minute {
		t.Errorf("Expires = %v, want %v", capturedExpires, 10*time.Minute)
	}
}

func TestCreatePresignedUploadURL_Defaults(t *testing.T) {
	var capturedExpires time.Duration
	var capturedCT *string
	var capturedCL *int64

	presign := &mockPresignClient{
		presignPutObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
			capturedCT = params.ContentType
			capturedCL = params.ContentLength
			opts := &s3.PresignOptions{}
			for _, fn := range optFns {
				fn(opts)
			}
			capturedExpires = opts.Expires
			return &v4.PresignedHTTPRequest{URL: "https://signed.example/", Method: "PUT"}, nil
		},
	}
	cleanup := setMockS3(&mockS3Client{}, presign)
	defer cleanup()

	// nil options and zero-value fields should yield sensible defaults.
	_, err := CreatePresignedUploadURL(context.Background(), "bucket", "key", nil)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if capturedExpires != 1*time.Hour {
		t.Errorf("default Expires = %v, want 1h", capturedExpires)
	}
	if capturedCT != nil {
		t.Errorf("ContentType should be nil when not set, got %v", *capturedCT)
	}
	if capturedCL != nil {
		t.Errorf("ContentLength should be nil when MaxSize is 0, got %v", *capturedCL)
	}
}

func TestCreatePresignedUploadURL_ValidatesArgs(t *testing.T) {
	// No bucket.
	_, err := CreatePresignedUploadURL(context.Background(), "", "key", nil)
	if err == nil {
		t.Error("expected error for empty bucket")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}

	// No key.
	_, err = CreatePresignedUploadURL(context.Background(), "bucket", "", nil)
	if err == nil {
		t.Error("expected error for empty key")
	}
	if !errors.Is(err, ErrInvalidSource) {
		t.Errorf("expected ErrInvalidSource, got %v", err)
	}
}

func TestCreatePresignedUploadURL_SigningError(t *testing.T) {
	presign := &mockPresignClient{
		presignPutObjectFn: func(ctx context.Context, params *s3.PutObjectInput, optFns ...func(*s3.PresignOptions)) (*v4.PresignedHTTPRequest, error) {
			return nil, fmt.Errorf("access denied")
		},
	}
	cleanup := setMockS3(&mockS3Client{}, presign)
	defer cleanup()

	_, err := CreatePresignedUploadURL(context.Background(), "bucket", "key", &PresignedUploadOptions{})
	if err == nil {
		t.Fatal("expected error")
	}
	if !errors.Is(err, ErrS3) {
		t.Errorf("expected ErrS3, got %v", err)
	}
}
