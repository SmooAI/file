import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { FileContentMismatchError, FileMimeError, FileSizeError, FileValidationError, FileValidationKind } from './errors';

/**
 * The TypeScript loader for the shared error taxonomy.
 *
 * Every port has one of these and they all read the SAME file — copying the
 * `kind` values into this suite instead is the drift the fixture exists to stop.
 */
interface Taxonomy {
    kinds: Record<string, { value: string; fields: string[] }>;
    cases: {
        name: string;
        kind: string;
        actualSize?: number | null;
        maxSize?: number;
        actualMimeType?: string | null;
        allowedMimeTypes?: string[];
        claimedMimeType?: string | null;
        detectedMimeType?: string | null;
    }[];
}

const taxonomy: Taxonomy = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'spec', 'error-taxonomy.json'), 'utf8'));

function build(testCase: Taxonomy['cases'][number]): FileValidationError {
    switch (testCase.kind) {
        case taxonomy.kinds.size.value:
            return new FileSizeError(testCase.actualSize ?? undefined, testCase.maxSize!);
        case taxonomy.kinds.mime.value:
            return new FileMimeError(testCase.actualMimeType ?? undefined, testCase.allowedMimeTypes!);
        case taxonomy.kinds.contentMismatch.value:
            return new FileContentMismatchError(testCase.claimedMimeType ?? undefined, testCase.detectedMimeType ?? undefined);
        default:
            throw new Error(`fixture has an unknown kind: ${testCase.kind}`);
    }
}

describe('validation error taxonomy — shared contract', () => {
    it('exposes exactly the kinds the fixture declares', () => {
        expect(Object.values(FileValidationKind).sort()).toEqual(
            Object.values(taxonomy.kinds)
                .map((k) => k.value)
                .sort(),
        );
    });

    it('has cases covering every declared kind', () => {
        // Positive control: a fixture that silently lost a kind would leave the
        // loop below asserting nothing about it, while still passing.
        const covered = new Set(taxonomy.cases.map((c) => c.kind));
        for (const kind of Object.values(taxonomy.kinds)) {
            expect(covered.has(kind.value)).toBe(true);
        }
    });

    for (const testCase of taxonomy.cases) {
        describe(testCase.name, () => {
            it('carries the portable kind', () => {
                expect(build(testCase).kind).toBe(testCase.kind);
            });

            it('is catchable as FileValidationError', () => {
                expect(build(testCase)).toBeInstanceOf(FileValidationError);
            });

            it('carries the structured fields for its kind', () => {
                const error = build(testCase);
                if (error instanceof FileSizeError) {
                    expect(error.actualSize).toBe(testCase.actualSize ?? undefined);
                    expect(error.maxSize).toBe(testCase.maxSize);
                } else if (error instanceof FileMimeError) {
                    expect(error.actualMimeType).toBe(testCase.actualMimeType ?? undefined);
                    expect([...error.allowedMimes]).toEqual(testCase.allowedMimeTypes);
                } else if (error instanceof FileContentMismatchError) {
                    expect(error.claimedMimeType).toBe(testCase.claimedMimeType ?? undefined);
                    expect(error.detectedMimeType).toBe(testCase.detectedMimeType ?? undefined);
                }
            });

            it('has a non-empty message', () => {
                // The wording is deliberately NOT pinned across ports — Go's is
                // idiomatically Go. That every port says something is still worth checking.
                expect(build(testCase).message.length).toBeGreaterThan(0);
            });
        });
    }
});
