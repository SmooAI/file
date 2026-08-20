package file

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"
)

// The Go loader for the shared error taxonomy.
//
// Every port has one of these and they all read the SAME file
// (spec/error-taxonomy.json). Copying the Kind values into this test instead is
// the drift the fixture exists to stop.

type taxonomyCase struct {
	Name             string   `json:"name"`
	Kind             string   `json:"kind"`
	ActualSize       *int64   `json:"actualSize"`
	MaxSize          int64    `json:"maxSize"`
	ActualMimeType   string   `json:"actualMimeType"`
	AllowedMimeTypes []string `json:"allowedMimeTypes"`
	ClaimedMimeType  string   `json:"claimedMimeType"`
	DetectedMimeType string   `json:"detectedMimeType"`
}

type errorTaxonomy struct {
	Kinds map[string]struct {
		Value string `json:"value"`
	} `json:"kinds"`
	Cases []taxonomyCase `json:"cases"`
}

func loadTaxonomy(t *testing.T) errorTaxonomy {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join("..", "..", "spec", "error-taxonomy.json"))
	if err != nil {
		t.Fatalf("read taxonomy: %v", err)
	}
	var taxonomy errorTaxonomy
	if err := json.Unmarshal(raw, &taxonomy); err != nil {
		t.Fatalf("parse taxonomy: %v", err)
	}
	if len(taxonomy.Cases) == 0 {
		t.Fatal("taxonomy has no cases — a fixture nobody exercises is worse than none")
	}
	return taxonomy
}

func declaredKinds(taxonomy errorTaxonomy) []string {
	kinds := make([]string, 0, len(taxonomy.Kinds))
	for _, k := range taxonomy.Kinds {
		kinds = append(kinds, k.Value)
	}
	sort.Strings(kinds)
	return kinds
}

func buildValidationError(t *testing.T, c taxonomyCase) *FileValidationError {
	t.Helper()
	switch ValidationKind(c.Kind) {
	case KindSize:
		// Go has no optional int64, so an unknown size is -1 rather than null.
		actual := int64(-1)
		if c.ActualSize != nil {
			actual = *c.ActualSize
		}
		return &FileValidationError{Kind: KindSize, ActualSize: actual, MaxSize: c.MaxSize}
	case KindMime:
		return &FileValidationError{Kind: KindMime, ActualMimeType: c.ActualMimeType, AllowedMimes: c.AllowedMimeTypes}
	case KindContentMismatch:
		return &FileValidationError{
			Kind:             KindContentMismatch,
			ClaimedMimeType:  c.ClaimedMimeType,
			DetectedMimeType: c.DetectedMimeType,
		}
	default:
		t.Fatalf("fixture has an unknown kind: %s", c.Kind)
		return nil
	}
}

func TestTaxonomyExposesExactlyTheDeclaredKinds(t *testing.T) {
	taxonomy := loadTaxonomy(t)
	exposed := []string{string(KindContentMismatch), string(KindMime), string(KindSize)}
	sort.Strings(exposed)

	if !reflect.DeepEqual(exposed, declaredKinds(taxonomy)) {
		t.Errorf("Go exposes %v, fixture declares %v", exposed, declaredKinds(taxonomy))
	}
}

func TestTaxonomyCasesCoverEveryDeclaredKind(t *testing.T) {
	// Positive control: a fixture that silently lost a kind would leave the
	// per-case test asserting nothing about it, while still passing.
	taxonomy := loadTaxonomy(t)
	seen := map[string]bool{}
	for _, c := range taxonomy.Cases {
		seen[c.Kind] = true
	}
	covered := make([]string, 0, len(seen))
	for kind := range seen {
		covered = append(covered, kind)
	}
	sort.Strings(covered)

	if !reflect.DeepEqual(covered, declaredKinds(taxonomy)) {
		t.Errorf("cases cover %v, fixture declares %v", covered, declaredKinds(taxonomy))
	}
}

func TestTaxonomyCarriesKindAndFields(t *testing.T) {
	taxonomy := loadTaxonomy(t)
	for _, c := range taxonomy.Cases {
		t.Run(c.Name, func(t *testing.T) {
			err := buildValidationError(t, c)

			if string(err.Kind) != c.Kind {
				t.Errorf("Kind = %q, fixture says %q", err.Kind, c.Kind)
			}
			if !errors.Is(err, ErrFileValidation) {
				t.Error("not catchable via errors.Is(err, ErrFileValidation)")
			}

			switch err.Kind {
			case KindSize:
				want := int64(-1)
				if c.ActualSize != nil {
					want = *c.ActualSize
				}
				if err.ActualSize != want || err.MaxSize != c.MaxSize {
					t.Errorf("size fields = (%d, %d), want (%d, %d)", err.ActualSize, err.MaxSize, want, c.MaxSize)
				}
			case KindMime:
				if err.ActualMimeType != c.ActualMimeType || !reflect.DeepEqual(err.AllowedMimes, c.AllowedMimeTypes) {
					t.Errorf("mime fields = (%q, %v), want (%q, %v)", err.ActualMimeType, err.AllowedMimes, c.ActualMimeType, c.AllowedMimeTypes)
				}
			case KindContentMismatch:
				if err.ClaimedMimeType != c.ClaimedMimeType || err.DetectedMimeType != c.DetectedMimeType {
					t.Errorf("mismatch fields = (%q, %q), want (%q, %q)",
						err.ClaimedMimeType, err.DetectedMimeType, c.ClaimedMimeType, c.DetectedMimeType)
				}
			}

			// The wording is deliberately NOT pinned across ports — Go's is
			// idiomatically Go. That every port says something is still worth checking.
			if err.Error() == "" {
				t.Error("empty error message")
			}
		})
	}
}
