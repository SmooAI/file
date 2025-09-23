import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { GetObjectCommand, GetObjectCommandOutput, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { detectXml } from '@file-type/xml';
import fetch, { Response } from '@smooai/fetch';
import ServerLogger from '@smooai/logger/AwsServerLogger';
import contentDisposition from 'content-disposition';
import { fileTypeFromFile, FileTypeParser, ReadableStreamWithFileType } from 'file-type/node';
import { FormData, File as FormDataFile } from 'formdata-node';
import mime from 'mime-types';
import invariant from 'tiny-invariant';

const logger = new ServerLogger();

const parser = new FileTypeParser({
    customDetectors: [detectXml],
});

const buildS3Client = () => new S3Client({ apiVersion: '2023-11-01' });

const toDetectionStream = parser.toDetectionStream.bind(parser);

/**
 * Represents metadata about a file including its properties and attributes.
 * @interface
 * @example
 * const metadata: Metadata = {
 *   name: 'example.txt',
 *   mimeType: 'text/plain',
 *   size: 1024,
 *   extension: 'txt',
 *   url: 'https://example.com/file.txt',
 *   path: '/path/to/file.txt',
 *   hash: 'abc123',
 *   lastModified: new Date(),
 *   createdAt: new Date()
 * };
 */
export interface Metadata {
    name?: string;
    mimeType?: string;
    size?: number;
    extension?: string;
    url?: string;
    path?: string;
    response?: Response;
    hash?: string;
    lastModified?: Date;
    createdAt?: Date;
}

/**
 * A partial set of metadata properties that can be used as hints when creating a file.
 * @type {Partial<Metadata>}
 * @example
 * const hint: MetadataHint = {
 *   name: 'document.pdf',
 *   mimeType: 'application/pdf'
 * };
 */
export type MetadataHint = Partial<Metadata>;

/**
 * Enumeration of possible file sources.
 * @enum {string}
 * @example
 * const source = FileSource.Url; // For files loaded from URLs
 * const source = FileSource.Bytes; // For files created from byte arrays
 * const source = FileSource.File; // For files from the filesystem
 * const source = FileSource.Stream; // For files from streams
 * const source = FileSource.S3; // For files from Amazon S3
 */
export enum FileSource {
    Url = 'Url',
    Bytes = 'Bytes',
    File = 'File',
    Stream = 'Stream',
    S3 = 'S3',
}

/**
 * A class representing a file with various operations and properties.
 * This class provides methods to create, read, write, and manipulate files from different sources.
 * @class
 * @example
 * // Create a file from URL
 * const file = await File.createFromUrl('https://example.com/file.txt');
 *
 * // Create a file from local filesystem
 * const file = await File.createFromFile('/path/to/file.txt');
 *
 * // Create a file from S3
 * const file = await File.createFromS3('my-bucket', 'path/to/file.txt');
 *
 * // Create a file from bytes
 * const file = await File.createFromBytes(new Uint8Array([1, 2, 3]));
 *
 * // Create a file from stream
 * const file = await File.createFromStream(readableStream);
 */
export default class File {
    private s3Client: S3Client = buildS3Client();

    private fileSource!: FileSource;
    private _stream!: ReadableStreamWithFileType;
    private _metadata!: Metadata;
    private bytes: ArrayBufferLike | undefined;

    private get stream(): ReadableStreamWithFileType {
        return this._stream;
    }

    private set stream(value: ReadableStreamWithFileType) {
        this._stream = value;
    }

    get metadata(): Metadata {
        return this._metadata;
    }

    get name(): string | undefined {
        return this._metadata.name;
    }

    get mimeType(): string | undefined {
        return this._metadata.mimeType;
    }

    get size(): number | undefined {
        return this._metadata.size;
    }

    get extension(): string | undefined {
        return this._metadata.extension;
    }

    get url(): string | undefined {
        return this._metadata.url;
    }

    get path(): string | undefined {
        return this._metadata.path;
    }

    get hash(): string | undefined {
        return this._metadata.hash;
    }

    get lastModified(): Date | undefined {
        return this._metadata.lastModified;
    }

    get createdAt(): Date | undefined {
        return this._metadata.createdAt;
    }

    get source(): FileSource {
        return this.fileSource;
    }

    private set metadata(value: Metadata) {
        this._metadata = value;
    }

    private constructor(fileSource: FileSource, stream: ReadableStreamWithFileType, metadata: Metadata, bytes?: ArrayBufferLike) {
        logger.info({ metadata }, 'File created');
        this.fileSource = fileSource;
        this.stream = stream;
        this.metadata = metadata;
        this.bytes = bytes;
    }

    private clone(other: File): File {
        this.fileSource = other.fileSource;
        this.stream = other.stream;
        this.metadata = other.metadata;
        this.bytes = other.bytes;
        return this;
    }

    private async refresh() {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const newFile = await File.createFromFile(this.metadata.path);
            this.clone(newFile);
        } else if (this.fileSource === FileSource.S3 && this.metadata.url) {
            const [bucket, key] = this.metadata.url.replace('s3://', '').split('/', 2);
            const newFile = await File.createFromS3(bucket, key);
            this.clone(newFile);
        } else if (this.fileSource === FileSource.Url && this.metadata.url) {
            const newFile = await File.createFromUrl(this.metadata.url);
            this.clone(newFile);
        } else if (this.fileSource === FileSource.Bytes && this.bytes) {
            const newFile = await File.createFromBytes(this.bytes);
            this.clone(newFile);
        } else if (this.fileSource === FileSource.Stream && this.stream) {
            const newFile = await File.createFromStream(this.stream);
            this.clone(newFile);
        } else {
            throw new Error(`Cannot refresh file from source: ${this.fileSource}`);
        }
    }

    private static webStreamToNodeStream(webStream: ReadableStream): Readable {
        // Create a single reader instance for the entire lifetime of the node stream.
        const reader = webStream.getReader();

        return new Readable({
            async read() {
                try {
                    const { done, value } = await reader.read();
                    if (done) {
                        this.push(null);
                    } else {
                        // Ensure value is a Buffer; adjust if your data is already a Buffer
                        this.push(Buffer.from(value));
                    }
                } catch (error) {
                    this.destroy(error as Error);
                }
            },
        });
    }

    /**
     * Creates a new File instance from a URL.
     * @param {string} url - The URL to load the file from
     * @param {MetadataHint} [metadataHint] - Optional metadata hints
     * @returns {Promise<File>} A new File instance
     * @example
     * const file = await File.createFromUrl('https://example.com/file.txt');
     */
    static async createFromUrl(url: string, metadataHint?: MetadataHint): Promise<File> {
        const response = await fetch(url);
        invariant(response.body, 'Response body is missing');

        // Clone the stream so we can use it multiple times if needed
        const webStream = response.body as unknown as ReadableStream;
        const nodeStream = File.webStreamToNodeStream(webStream.tee()[0]);
        const typedStream = await toDetectionStream(nodeStream);

        const metadata = await File.getFileMetadata({
            metadataHint: {
                ...metadataHint,
                url,
            },
            fileSource: FileSource.Url,
            internalResponse: response,
            stream: typedStream,
        });
        return new File(FileSource.Url, typedStream, metadata);
    }

    /**
     * Creates a new File instance from an S3 bucket and key.
     * @param {string} bucket - The S3 bucket name
     * @param {string} key - The S3 object key
     * @param {MetadataHint} [metadataHint] - Optional metadata hints
     * @returns {Promise<File>} A new File instance
     * @example
     * const file = await File.createFromS3('my-bucket', 'path/to/file.txt');
     */
    static async createFromS3(bucket: string, key: string, metadataHint?: MetadataHint): Promise<File> {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });
        const s3Client = buildS3Client();
        const response = await s3Client.send(command);
        invariant(response.Body, 'Response body is missing');

        const typedStream = await toDetectionStream(new Readable().wrap(response.Body as unknown as NodeJS.ReadableStream));

        const metadata = await File.getFileMetadata({
            metadataHint: {
                ...metadataHint,
                url: `s3://${bucket}/${key}`,
                name: path.basename(key),
            },
            fileSource: FileSource.S3,
            stream: typedStream,
            s3Response: response,
        });
        return new File(FileSource.S3, typedStream, metadata);
    }

    /**
     * Creates a new File instance from a byte array.
     * @param {ArrayBuffer} bytes - The byte array to create the file from
     * @param {MetadataHint} [metadataHint] - Optional metadata hints
     * @returns {Promise<File>} A new File instance
     * @example
     * const file = await File.createFromBytes(new Uint8Array([1, 2, 3]));
     */
    static async createFromBytes(bytes: ArrayBufferLike, metadataHint?: MetadataHint): Promise<File> {
        const nodeStream = new Readable();
        nodeStream.push(Buffer.from(bytes));
        nodeStream.push(null);
        nodeStream.pause();
        const typedStream = await toDetectionStream(nodeStream);

        const metadata = await File.getFileMetadata({
            metadataHint: {
                ...metadataHint,
                size: bytes.byteLength,
            },
            fileSource: FileSource.Bytes,
            stream: typedStream,
        });
        return new File(FileSource.Bytes, typedStream, metadata, bytes);
    }

    /**
     * Creates a new File instance from a local file path.
     * @param {string} filePath - The path to the local file
     * @param {MetadataHint} [metadataHint] - Optional metadata hints
     * @returns {Promise<File>} A new File instance
     * @example
     * const file = await File.createFromFile('/path/to/file.txt');
     */
    static async createFromFile(filePath: string, metadataHint?: MetadataHint): Promise<File> {
        const nodeStream = new Readable().wrap(fs.createReadStream(filePath)).pause();
        const typedStream = await toDetectionStream(nodeStream);

        const metadata = await File.getFileMetadata({
            metadataHint: {
                ...metadataHint,
                path: filePath,
                name: path.basename(filePath),
            },
            fileSource: FileSource.File,
            stream: typedStream,
        });
        return new File(FileSource.File, typedStream, metadata);
    }

    /**
     * Creates a new File instance from a readable stream.
     * @param {NodeJS.ReadableStream} stream - The readable stream
     * @param {MetadataHint} [metadataHint] - Optional metadata hints
     * @returns {Promise<File>} A new File instance
     * @example
     * const file = await File.createFromStream(readableStream);
     */
    static async createFromStream(stream: NodeJS.ReadableStream, metadataHint?: MetadataHint): Promise<File> {
        const nodeStream = new Readable().wrap(stream).pause();
        const typedStream = await toDetectionStream(nodeStream);
        const metadata = await File.getFileMetadata({
            metadataHint,
            fileSource: FileSource.Stream,
            stream: typedStream,
        });
        return new File(FileSource.Stream, typedStream, metadata);
    }

    private static getFilenameFromUrl(urlString: string | undefined): string | null {
        if (!urlString) {
            return null;
        }

        try {
            const url = new URL(urlString);
            const pathname = url.pathname;
            const filename = path.basename(pathname);
            // Return filename if it's non-empty and not just a directory indicator
            return filename && filename !== '/' ? filename : null;
        } catch (_error) {
            return null;
        }
    }

    static async getFileMetadata(options: {
        fileSource: FileSource;
        metadataHint?: MetadataHint;
        internalResponse?: Response;
        stream?: ReadableStreamWithFileType;
        s3Response?: GetObjectCommandOutput;
    }): Promise<Metadata> {
        let name: string | undefined = options.metadataHint?.name;
        let extension: string | undefined = options.metadataHint?.extension;
        let mimeType: string | undefined = options.metadataHint?.mimeType;
        let size: number | undefined = options.metadataHint?.size;
        let hash: string | undefined = options.metadataHint?.hash;
        let lastModified: Date | undefined = options.metadataHint?.lastModified;
        let createdAt: Date | undefined = options.metadataHint?.createdAt;
        const response = options.internalResponse ?? options.metadataHint?.response ?? (undefined as unknown as Response);
        const path = options.metadataHint?.path;
        const url = options.metadataHint?.url;

        let stream = options.stream;
        if (!stream && response?.body) {
            // @smooai/fetch should provide a Web ReadableStream
            const nodeStream = new Readable().wrap(response.body as unknown as NodeJS.ReadableStream).pause();
            stream = await toDetectionStream(nodeStream);
        }

        if (response) {
            const contentDispositionValue = response.headers.get('content-disposition');
            const contentType = response.headers.get('content-type');
            const contentLength = response.headers.get('content-length');
            const etag = response.headers.get('etag');
            const lastModifiedHeader = response.headers.get('last-modified');
            const contentMD5 = response.headers.get('content-md5');

            const disposition = contentDispositionValue ? contentDisposition.parse(contentDispositionValue) : undefined;
            name = disposition?.parameters?.filename ?? File.getFilenameFromUrl(url) ?? name;
            size = contentLength !== null && contentLength !== undefined ? Number(contentLength) : size;
            mimeType = contentType ?? (name ? mime.lookup(name) || null : null) ?? mimeType;

            if (etag) {
                hash = etag.replace(/"/g, '');
            } else if (contentMD5) {
                hash = contentMD5;
            }

            if (lastModifiedHeader) {
                lastModified = new Date(lastModifiedHeader);
            }

            logger.debug({ name, size, mimeType, hash, lastModified }, 'File metadata parsed from response headers');
        }

        if (options.s3Response) {
            const contentDispositionValue = options.s3Response.ContentDisposition;
            const contentType = options.s3Response.ContentType;
            const contentLength = options.s3Response.ContentLength;
            const etag = options.s3Response.ETag;
            const lastModifiedHeader = options.s3Response.LastModified;

            const disposition = contentDispositionValue ? contentDisposition.parse(contentDispositionValue) : undefined;
            name = disposition?.parameters?.filename ?? name;
            size = contentLength !== null && contentLength !== undefined ? Number(contentLength) : size;
            mimeType = contentType ?? (name ? mime.lookup(name) || null : null) ?? mimeType;

            if (etag) {
                hash = etag.replace(/"/g, '');
            }

            if (lastModifiedHeader) {
                lastModified = new Date(lastModifiedHeader);
            }

            logger.debug({ name, size, mimeType, hash, lastModified }, 'File metadata parsed from S3 response headers');
        }

        if (options.fileSource === FileSource.File && path) {
            const fileType = await fileTypeFromFile(path, {
                customDetectors: [detectXml],
            });
            mimeType = fileType && fileType.mime ? fileType.mime : mimeType;
            extension = fileType && fileType.ext ? fileType.ext : extension;

            const stats = await fs.promises.stat(path);
            size = stats.size;
            lastModified = stats.mtime;
            createdAt = stats.birthtime;

            logger.debug({ mimeType, extension, size, lastModified, createdAt }, 'File metadata parsed from file system');
        }

        if (!mimeType && name) {
            mimeType = (mime.lookup(name) || null) ?? mimeType;
            logger.debug({ mimeType }, 'Mime type detected from file name');
        }

        if (stream) {
            logger.debug('Detecting mime type from stream');
            mimeType = stream.fileType?.mime ?? mimeType;
            extension = stream.fileType?.ext ?? extension;
            logger.debug(`Detected mime type: ${mimeType}, extenstion: ${extension}`);
        }

        if (!extension && mimeType) {
            extension = (mime.extension(mimeType) || null) ?? extension;
        }

        return <Metadata>{
            name,
            mimeType,
            size,
            extension,
            url,
            path,
            hash,
            lastModified,
            createdAt,
        };
    }

    /**
     * Reads the file contents as bytes.
     * @returns {Promise<ArrayBuffer>} The file contents as an ArrayBuffer
     * @example
     * const bytes = await file.readFileBytes();
     */
    async readFileBytes(): Promise<ArrayBufferLike> {
        if (this.bytes) {
            return this.bytes;
        }

        const reader = this.stream;

        const buffer: Buffer | null = await reader.read();
        this.bytes = buffer !== null ? buffer.buffer : Buffer.from([]).buffer;
        return new Uint8Array(this.bytes).buffer;
    }

    /**
     * Reads the file contents as a string.
     * @returns {Promise<string>} The file contents as a UTF-8 string
     * @example
     * const content = await file.readFileString();
     */
    async readFileString(): Promise<string> {
        const bytes = Buffer.from(await this.readFileBytes());
        return bytes.toString('utf-8');
    }

    /**
     * Converts the file to a FormData object.
     * @param {string} [attrName='file'] - The name of the form field
     * @returns {Promise<FormData>} A FormData object containing the file
     * @example
     * const formData = await file.toFormData('document');
     */
    async toFormData(attrName = 'file'): Promise<FormData> {
        const form = new FormData();
        form.append(attrName, new FormDataFile([await this.readFileBytes()], this.metadata.name ?? ''));
        return form;
    }

    /**
     * Returns a string representation of the file.
     * @returns {string} A JSON string containing the file metadata
     * @example
     * console.log(file.toString());
     */
    toString(): string {
        return JSON.stringify({
            ...this.metadata,
            fileSource: this.fileSource,
        });
    }

    /**
     * Saves the file to a new location on the filesystem.
     * @param {string} destinationPath - The path where the file should be saved
     * @returns {Promise<{original: File, newFile: File}>} The original and new file instances
     * @example
     * const { original, newFile } = await file.saveToFile('/path/to/new/location.txt');
     */
    async saveToFile(destinationPath: string): Promise<{ original: File; newFile: File }> {
        const writeStream = fs.createWriteStream(destinationPath);
        await this.pipeTo(writeStream);
        return {
            original: this,
            newFile: await File.createFromFile(destinationPath),
        };
    }

    /**
     * Moves the file to a new location on the filesystem.
     * @param {string} destinationPath - The new path for the file
     * @returns {Promise<File>} The new file instance
     * @example
     * const newFile = await file.moveTo('/path/to/new/location.txt');
     */
    async moveTo(destinationPath: string): Promise<File> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const result = await this.saveToFile(destinationPath);
            await fs.promises.unlink(this.metadata.path);
            return result.newFile;
        } else {
            const result = await this.saveToFile(destinationPath);
            return result.newFile;
        }
    }

    /**
     * Deletes the file from the filesystem.
     * @returns {Promise<void>}
     * @example
     * await file.delete();
     */
    async delete(): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await fs.promises.unlink(this.metadata.path);
        }
    }

    /**
     * Pipes the file contents to a writable stream.
     * @param {NodeJS.WritableStream} destination - The destination writable stream
     * @param {Object} options - Pipe options
     * @param {boolean} [options.saveBytes=true] - Whether to save the bytes in memory
     * @returns {Promise<void>}
     * @example
     * await file.pipeTo(writableStream);
     */
    async pipeTo(
        destination: NodeJS.WritableStream,
        options: {
            saveBytes?: boolean;
        } = { saveBytes: true },
    ): Promise<void> {
        const { saveBytes } = options;
        if (this.bytes) {
            const buffer = Buffer.from(this.bytes);
            return new Promise((resolve, reject) => {
                destination.write(buffer, (err) => {
                    if (err) reject(err);
                    resolve();
                });
            });
        }

        const reader = this.stream;
        const nodeStream = new Readable().wrap(reader);

        return new Promise((resolve, reject) => {
            nodeStream.on('error', reject);
            destination.on('error', reject);
            destination.on('finish', resolve);
            nodeStream.on('data', (chunk) => {
                if (saveBytes) {
                    this.bytes = Buffer.concat([!this.bytes ? Buffer.from([]) : Buffer.from(this.bytes), chunk]).buffer;
                }
            });

            nodeStream.pipe(destination);
        });
    }

    /**
     * Uploads the file to an S3 bucket.
     * @param {string} bucket - The S3 bucket name
     * @param {string} key - The S3 object key
     * @returns {Promise<void>}
     * @example
     * await file.uploadToS3('my-bucket', 'path/to/file.txt');
     */
    async uploadToS3(bucket: string, key: string): Promise<void> {
        const reader = this.stream;

        const buffer: Buffer | null = await reader.read();
        this.bytes = buffer !== null ? buffer.buffer : Buffer.from([]).buffer;

        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: Buffer.from(this.bytes),
            ContentType: this.metadata.mimeType,
            ContentLength: this.metadata.size,
            ContentDisposition: this.metadata.name ? `attachment; filename="${this.metadata.name}"` : undefined,
        });

        await this.s3Client.send(command);
    }

    /**
     * Saves the file to S3 and returns both the original and new file instances.
     * @param {string} bucket - The S3 bucket name
     * @param {string} key - The S3 object key
     * @returns {Promise<{original: File, newFile: File}>} The original and new file instances
     * @example
     * const { original, newFile } = await file.saveToS3('my-bucket', 'path/to/file.txt');
     */
    async saveToS3(bucket: string, key: string): Promise<{ original: File; newFile: File }> {
        // Upload to S3 and create new file instance
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: await this.toBuffer(),
            ContentType: this.metadata.mimeType,
            ContentLength: this.metadata.size,
            ContentDisposition: this.metadata.name ? `attachment; filename="${this.metadata.name}"` : undefined,
        });

        await this.s3Client.send(command);

        // Create new file instance
        const newFile = await File.createFromS3(bucket, key);

        return { original: this, newFile };
    }

    /**
     * Moves the file to S3 and returns the new file instance.
     * @param {string} bucket - The S3 bucket name
     * @param {string} key - The S3 object key
     * @returns {Promise<File>} The new file instance
     * @example
     * const newFile = await file.moveToS3('my-bucket', 'path/to/file.txt');
     */
    async moveToS3(bucket: string, key: string): Promise<File> {
        // Upload to S3 and get new file instance
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: await this.toBuffer(),
            ContentType: this.metadata.mimeType,
            ContentLength: this.metadata.size,
            ContentDisposition: this.metadata.name ? `attachment; filename="${this.metadata.name}"` : undefined,
        });

        await this.s3Client.send(command);

        // If this is a file on disk, delete it
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await fs.promises.unlink(this.metadata.path);
        }

        return File.createFromS3(bucket, key);
    }

    /**
     * Checks if the file exists on the filesystem.
     * @returns {Promise<boolean>} Whether the file exists
     * @example
     * const exists = await file.exists();
     */
    async exists(): Promise<boolean> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            try {
                await fs.promises.access(this.metadata.path);
                return true;
            } catch {
                return false;
            }
        }
        return true; // For non-file sources, we assume they exist since we have their data
    }

    /**
     * Checks if the file is readable.
     * @returns {Promise<boolean>} Whether the file is readable
     * @example
     * const isReadable = await file.isReadable();
     */
    async isReadable(): Promise<boolean> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            try {
                await fs.promises.access(this.metadata.path, fs.constants.R_OK);
                return true;
            } catch {
                return false;
            }
        }
        return true; // For non-file sources, we assume they're readable since we have their data
    }

    /**
     * Checks if the file is writable.
     * @returns {Promise<boolean>} Whether the file is writable
     * @example
     * const isWritable = await file.isWritable();
     */
    async isWritable(): Promise<boolean> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            try {
                await fs.promises.access(this.metadata.path, fs.constants.W_OK);
                return true;
            } catch {
                return false;
            }
        }
        return false; // For non-file sources, we can't write back to them
    }

    /**
     * Calculates the SHA-256 checksum of the file.
     * @returns {Promise<string>} The file's checksum
     * @example
     * const checksum = await file.getChecksum();
     */
    async getChecksum(): Promise<string> {
        const bytes = await this.readFileBytes();
        const buffer = Buffer.from(bytes);
        const hash = crypto.createHash('sha256');
        hash.update(buffer);
        return hash.digest('hex');
    }

    /**
     * Updates the file's metadata.
     * @param {Partial<Metadata>} metadata - The metadata to update
     * @returns {Promise<void>}
     * @example
     * await file.setMetadata({ name: 'new-name.txt' });
     */
    async setMetadata(metadata: Partial<Metadata>): Promise<void> {
        this.metadata = {
            ...this.metadata,
            ...metadata,
        };
    }

    /**
     * Gets the file's filesystem stats.
     * @returns {Promise<fs.Stats | undefined>} The file's stats or undefined if not a filesystem file
     * @example
     * const stats = await file.getStats();
     */
    async getStats(): Promise<fs.Stats | undefined> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            return await fs.promises.stat(this.metadata.path);
        }
        return undefined;
    }

    /**
     * Appends content to the end of the file.
     * @param {string | Buffer} content - The content to append
     * @returns {Promise<void>}
     * @example
     * await file.append('Additional content');
     */
    async append(content: string | Buffer): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
            await fs.promises.appendFile(this.metadata.path, buffer);
            await this.refresh();
        } else {
            throw new Error('Cannot append to non-file source');
        }
    }

    /**
     * Prepends content to the beginning of the file.
     * @param {string | Buffer} content - The content to prepend
     * @returns {Promise<void>}
     * @example
     * await file.prepend('New content at start');
     */
    async prepend(content: string | Buffer): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const existingContent = Buffer.from(await this.readFileBytes());
            const newContent = Buffer.isBuffer(content) ? content : Buffer.from(content);
            await fs.promises.writeFile(this.metadata.path, Buffer.concat([newContent, existingContent]));
            await this.refresh();
        } else {
            throw new Error('Cannot prepend to non-file source');
        }
    }

    /**
     * Truncates the file to the specified size.
     * @param {number} size - The new size of the file
     * @returns {Promise<void>}
     * @example
     * await file.truncate(1000);
     */
    async truncate(size: number): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await fs.promises.truncate(this.metadata.path, size);
            await this.refresh();
        } else {
            throw new Error('Cannot truncate non-file source');
        }
    }

    /**
     * Gets a signed URL for accessing an S3 file.
     * @param {number} [expiresIn=3600] - The number of seconds until the URL expires
     * @returns {Promise<string>} The signed URL
     * @example
     * const signedUrl = await file.getSignedUrl(7200); // URL expires in 2 hours
     */
    async getSignedUrl(expiresIn: number = 3600): Promise<string> {
        if (this.fileSource === FileSource.S3 && this.metadata.url) {
            const [bucket, key] = this.metadata.url.replace('s3://', '').split('/', 2);
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            });
            return await getSignedUrl(this.s3Client, command, { expiresIn });
        }
        throw new Error('Cannot generate signed URL for non-S3 file');
    }

    private async toBuffer(): Promise<Buffer> {
        const reader = this.stream;

        const buffer: Buffer | null = await reader.read();
        this.bytes = buffer !== null ? buffer.buffer : Buffer.from([]).buffer;

        return Buffer.from(this.bytes);
    }
}
