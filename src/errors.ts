/**
 * Base class for all file validation errors.
 * Consumers can `catch (err) { if (err instanceof FileValidationError) { ... } }`
 * to uniformly map validation failures to an HTTP 400 or similar boundary response.
 */
export class FileValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FileValidationError';
    }
}

/**
 * Thrown when a file exceeds the declared `maxSize` during validation.
 */
export class FileSizeError extends FileValidationError {
    constructor(
        public readonly actualSize: number | undefined,
        public readonly maxSize: number,
    ) {
        super(
            actualSize === undefined
                ? `File size is unknown; maxSize is ${maxSize} bytes`
                : `File size (${actualSize} bytes) exceeds maximum allowed (${maxSize} bytes)`,
        );
        this.name = 'FileSizeError';
    }
}

/**
 * Thrown when a file's mime type is not in the declared `allowedMimes` list.
 */
export class FileMimeError extends FileValidationError {
    constructor(
        public readonly actualMimeType: string | undefined,
        public readonly allowedMimes: readonly string[],
    ) {
        super(
            actualMimeType
                ? `File mime type "${actualMimeType}" is not in the allowed list: ${allowedMimes.join(', ')}`
                : `File mime type is unknown; allowed types are: ${allowedMimes.join(', ')}`,
        );
        this.name = 'FileMimeError';
    }
}

/**
 * Thrown when the magic-byte-detected mime type does not match the mime type
 * claimed by the source (e.g. a `.php` file uploaded with `Content-Type: image/png`).
 * This is the primary defense against mime-spoofing attacks for user uploads.
 */
export class FileContentMismatchError extends FileValidationError {
    constructor(
        public readonly claimedMimeType: string | undefined,
        public readonly detectedMimeType: string | undefined,
    ) {
        super(`File content does not match claimed mime type. Claimed: ${claimedMimeType ?? 'unknown'}, detected: ${detectedMimeType ?? 'unknown'}`);
        this.name = 'FileContentMismatchError';
    }
}
