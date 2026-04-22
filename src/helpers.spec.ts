import { describe, expect, it, vi } from 'vitest';
import File, { FileContentMismatchError, FileMimeError, FileSizeError, FileValidationError } from '../src/File';

vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.fn(async (_client, _command, opts: { expiresIn: number }) => `https://signed.example/?expires=${opts.expiresIn}`),
}));

// PNG magic bytes: 89 50 4E 47 0D 0A 1A 0A
const PNG_HEADER = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Minimal PNG: signature + IHDR chunk + IEND chunk. `file-type` recognizes just the signature.
const PNG_BYTES = new Uint8Array([...PNG_HEADER, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 0, 0, 0, 0]);

describe('File.createFromWebFile', () => {
    it('preserves web File name and type hints', async () => {
        const blob = Object.assign(new Blob([PNG_BYTES], { type: 'image/png' }), { name: 'pic.png' });
        const file = await File.createFromWebFile(blob as Blob & { name: string; type: string });

        expect(file.name).toBe('pic.png');
        expect(file.mimeType).toBe('image/png');
        expect(file.size).toBe(PNG_BYTES.byteLength);
    });

    it('accepts a plain Blob without a name', async () => {
        const blob = new Blob([PNG_BYTES], { type: 'image/png' });
        const file = await File.createFromWebFile(blob);
        expect(file.mimeType).toBe('image/png');
    });

    it('lets explicit metadataHint override webFile hints', async () => {
        const blob = Object.assign(new Blob([PNG_BYTES], { type: 'image/png' }), { name: 'pic.png' });
        const file = await File.createFromWebFile(blob as Blob & { name: string; type: string }, { name: 'custom.png' });
        expect(file.name).toBe('custom.png');
    });
});

describe('File.prototype.validate', () => {
    const buildPng = () => File.createFromWebFile(Object.assign(new Blob([PNG_BYTES], { type: 'image/png' }), { name: 'pic.png' }));

    it('passes when all constraints are satisfied', async () => {
        const file = await buildPng();
        await expect(file.validate({ maxSize: 1024, allowedMimes: ['image/png'], expectedMimeType: 'image/png' })).resolves.toBeUndefined();
    });

    it('throws FileSizeError when over maxSize', async () => {
        const file = await buildPng();
        await expect(file.validate({ maxSize: 5 })).rejects.toBeInstanceOf(FileSizeError);
        await expect(file.validate({ maxSize: 5 })).rejects.toBeInstanceOf(FileValidationError);
    });

    it('throws FileMimeError when mime is not in allowlist', async () => {
        const file = await buildPng();
        const err = await file.validate({ allowedMimes: ['application/pdf'] }).catch((e) => e);
        expect(err).toBeInstanceOf(FileMimeError);
        expect(err.actualMimeType).toBe('image/png');
        expect(err.allowedMimes).toEqual(['application/pdf']);
    });

    it('throws FileContentMismatchError when expected type disagrees with detected magic bytes', async () => {
        // Caller claims the client sent a PDF but the bytes are a PNG — classic mime-spoofing.
        const blob = Object.assign(new Blob([PNG_BYTES], { type: 'application/pdf' }), { name: 'spoofed.pdf' });
        const file = await File.createFromWebFile(blob as Blob & { name: string; type: string });
        const err = await file.validate({ expectedMimeType: 'application/pdf' }).catch((e) => e);
        expect(err).toBeInstanceOf(FileContentMismatchError);
        expect(err.claimedMimeType).toBe('application/pdf');
        expect(err.detectedMimeType).toBe('image/png');
    });

    it('no-ops when options object is empty', async () => {
        const file = await buildPng();
        await expect(file.validate({})).resolves.toBeUndefined();
    });
});

describe('File.prototype.toBase64', () => {
    it('encodes file bytes as base64', async () => {
        const bytes = new Uint8Array([0x66, 0x6f, 0x6f]).buffer; // "foo"
        const file = await File.createFromBytes(bytes, { name: 'foo.txt', mimeType: 'text/plain' });
        expect(await file.toBase64()).toBe('Zm9v');
    });
});

describe('File.createPresignedUploadUrl', () => {
    it('returns a signed URL honoring expiresIn', async () => {
        const url = await File.createPresignedUploadUrl({
            bucket: 'my-bucket',
            key: 'uploads/test.png',
            contentType: 'image/png',
            expiresIn: 600,
        });
        expect(url).toContain('expires=600');
    });

    it('defaults expiresIn to 3600', async () => {
        const url = await File.createPresignedUploadUrl({
            bucket: 'my-bucket',
            key: 'uploads/test.png',
        });
        expect(url).toContain('expires=3600');
    });
});

describe('FileValidationError hierarchy', () => {
    it('subclasses derive from FileValidationError', () => {
        expect(new FileSizeError(100, 50)).toBeInstanceOf(FileValidationError);
        expect(new FileMimeError('text/plain', ['image/png'])).toBeInstanceOf(FileValidationError);
        expect(new FileContentMismatchError('image/png', 'application/pdf')).toBeInstanceOf(FileValidationError);
    });

    it('carries structured context on FileSizeError', () => {
        const err = new FileSizeError(100, 50);
        expect(err.actualSize).toBe(100);
        expect(err.maxSize).toBe(50);
        expect(err.name).toBe('FileSizeError');
    });

    it('carries structured context on FileMimeError', () => {
        const err = new FileMimeError('text/plain', ['image/png', 'image/jpeg']);
        expect(err.actualMimeType).toBe('text/plain');
        expect(err.allowedMimes).toEqual(['image/png', 'image/jpeg']);
    });

    it('carries structured context on FileContentMismatchError', () => {
        const err = new FileContentMismatchError('application/pdf', 'image/png');
        expect(err.claimedMimeType).toBe('application/pdf');
        expect(err.detectedMimeType).toBe('image/png');
    });
});
