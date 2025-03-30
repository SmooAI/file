import { GetObjectCommand, GetObjectCommandOutput, S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import contentDisposition from 'content-disposition';
import { fileTypeFromFile, AnyWebReadableByteStreamWithFileType, ReadableStreamWithFileType, FileTypeParser } from 'file-type/node';
import { detectXml } from '@file-type/xml';
import { File as FormDataFile, FormData } from 'formdata-node';
import fs from 'fs';
import mime from 'mime-types';
import path from 'path';
import { Readable } from 'stream';
import invariant from 'tiny-invariant';
import crypto from 'crypto';

import fetch, { Response } from '@smooai/fetch';
import ServerLogger from '@smooai/logger/AwsLambdaLogger';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
const logger = new ServerLogger();

const s3Client = new S3Client({ apiVersion: '2023-11-01' });

const { toDetectionStream } = new FileTypeParser({
    customDetectors: [detectXml],
});

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

export type MetadataHint = Partial<Metadata>;

export enum FileSource {
    Url = 'Url',
    Bytes = 'Bytes',
    File = 'File',
    Stream = 'Stream',
}

export default class File {
    private fileSource!: FileSource;
    private _stream!: ReadableStreamWithFileType;
    private _metadata!: Metadata;
    private bytes: ArrayBuffer | undefined;

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

    private set metadata(value: Metadata) {
        this._metadata = value;
    }

    private constructor(fileSource: FileSource, stream: ReadableStreamWithFileType, metadata: Metadata, bytes?: ArrayBuffer) {
        logger.info({ metadata }, 'File created');
        this.fileSource = fileSource;
        this.stream = stream;
        this.metadata = metadata;
        this.bytes = bytes;
    }

    private static webStreamToNodeStream(webStream: ReadableStream): Readable {
        return new Readable({
            read() {
                webStream
                    .getReader()
                    .read()
                    .then(({ done, value }) => {
                        if (done) {
                            this.push(null);
                        } else {
                            this.push(Buffer.from(value));
                        }
                    });
            },
        });
    }

    static async createFromUrl(url: string, metadataHint?: MetadataHint): Promise<File> {
        const response = await fetch(url);
        invariant(response.body, 'Response body is missing');

        const webStream = response.body as unknown as ReadableStream;
        const nodeStream = File.webStreamToNodeStream(webStream);
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

    static async createFromS3(bucket: string, key: string, metadataHint?: MetadataHint): Promise<File> {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key,
        });
        const response = await s3Client.send(command);
        invariant(response.Body, 'Response body is missing');

        const webStream = response.Body as unknown as ReadableStream;
        const nodeStream = File.webStreamToNodeStream(webStream);
        const typedStream = await toDetectionStream(nodeStream);

        const metadata = await File.getFileMetadata({
            metadataHint: {
                ...metadataHint,
                url: `s3://${bucket}/${key}`,
                name: path.basename(key),
            },
            fileSource: FileSource.Url,
            stream: typedStream,
            s3Response: response,
        });
        return new File(FileSource.Url, typedStream, metadata);
    }

    static async createFromBytes(bytes: ArrayBuffer, metadataHint?: MetadataHint): Promise<File> {
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

    static async createFromFile(filePath: string, metadataHint?: MetadataHint): Promise<File> {
        const nodeStream = fs.createReadStream(filePath).pause();
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
            name = disposition?.parameters?.filename ?? name;
            size = Number(contentLength) || size;
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
            size = Number(contentLength) || size;
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
            size = stats.size || size;
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

    async readFileBytes(): Promise<ArrayBuffer> {
        if (this.bytes) {
            return this.bytes;
        }

        const reader = this.stream;
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const buffer = Buffer.concat(chunks);
        this.bytes = buffer.buffer;
        return new Uint8Array(buffer).buffer;
    }

    async readFileString(): Promise<string> {
        const bytes = Buffer.from(await this.readFileBytes());
        return bytes.toString('utf-8');
    }

    async toFormData(attrName = 'file'): Promise<FormData> {
        const form = new FormData();
        form.append(attrName, new FormDataFile([await this.readFileBytes()], this.metadata.name ?? ''));
        return form;
    }

    toString(): string {
        return JSON.stringify({
            ...this.metadata,
            fileSource: this.fileSource,
        });
    }

    async saveToFile(destinationPath: string): Promise<void> {
        const writeStream = fs.createWriteStream(destinationPath);
        const reader = this.stream;

        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                writeStream.write(Buffer.from(value));
            }
            await new Promise<void>((resolve, reject) => {
                writeStream.on('finish', () => resolve());
                writeStream.on('error', (err) => reject(err));
            });
        } finally {
            writeStream.end();
        }
    }

    async copyTo(destinationPath: string): Promise<void> {
        await this.saveToFile(destinationPath);
    }

    async moveTo(destinationPath: string): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await this.saveToFile(destinationPath);
            await fs.promises.unlink(this.metadata.path);
            this.metadata.path = destinationPath;
            this.metadata.name = path.basename(destinationPath);
        } else {
            await this.saveToFile(destinationPath);
        }
    }

    async delete(): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await fs.promises.unlink(this.metadata.path);
        }
    }

    async pipeTo(destination: WritableStream): Promise<void> {
        const reader = this.stream;
        const writer = destination.getWriter();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            await writer.write(value);
        }
        await writer.close();
    }

    async uploadToS3(bucket: string, key: string): Promise<void> {
        const reader = this.stream;
        const chunks: Uint8Array[] = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
        }
        const buffer = Buffer.concat(chunks);

        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: buffer,
            ContentType: this.metadata.mimeType,
            ContentLength: this.metadata.size,
            ContentDisposition: this.metadata.name ? `attachment; filename="${this.metadata.name}"` : undefined,
        });

        await s3Client.send(command);
    }

    async moveToS3(bucket: string, key: string): Promise<void> {
        await this.uploadToS3(bucket, key);
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await fs.promises.unlink(this.metadata.path);
        }
    }

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

    async getChecksum(): Promise<string> {
        const bytes = await this.readFileBytes();
        const buffer = Buffer.from(bytes);
        const hash = crypto.createHash('sha256');
        hash.update(buffer);
        return hash.digest('hex');
    }

    async setMetadata(metadata: Partial<Metadata>): Promise<void> {
        this.metadata = {
            ...this.metadata,
            ...metadata,
        };
    }

    async refreshMetadata(): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const stats = await fs.promises.stat(this.metadata.path);
            this.metadata = {
                ...this.metadata,
                size: stats.size,
                lastModified: stats.mtime,
                createdAt: stats.birthtime,
            };
        }
    }

    async getStats(): Promise<fs.Stats | undefined> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            return await fs.promises.stat(this.metadata.path);
        }
        return undefined;
    }

    async append(content: string | Buffer): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
            await fs.promises.appendFile(this.metadata.path, buffer);
            await this.refreshMetadata();
        } else {
            throw new Error('Cannot append to non-file source');
        }
    }

    async prepend(content: string | Buffer): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            const existingContent = await fs.promises.readFile(this.metadata.path);
            const newContent = Buffer.isBuffer(content) ? content : Buffer.from(content);
            await fs.promises.writeFile(this.metadata.path, Buffer.concat([newContent, existingContent]));
            await this.refreshMetadata();
        } else {
            throw new Error('Cannot prepend to non-file source');
        }
    }

    async truncate(size: number): Promise<void> {
        if (this.fileSource === FileSource.File && this.metadata.path) {
            await fs.promises.truncate(this.metadata.path, size);
            await this.refreshMetadata();
        } else {
            throw new Error('Cannot truncate non-file source');
        }
    }

    async getSignedUrl(expiresIn: number = 3600): Promise<string> {
        if (this.metadata.url?.startsWith('s3://')) {
            const [bucket, key] = this.metadata.url.replace('s3://', '').split('/', 2);
            const command = new GetObjectCommand({
                Bucket: bucket,
                Key: key,
            });
            return await getSignedUrl(s3Client, command, { expiresIn });
        }
        throw new Error('Cannot generate signed URL for non-S3 file');
    }
}
