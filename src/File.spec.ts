/* eslint-disable @typescript-eslint/no-explicit-any -- ok*/
import fetch from '@smooai/fetch';
import File, { FileSource } from '../src/File';
import { FileTypeResult, ReadableStreamWithFileType } from 'file-type/node';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { S3Client, GetObjectCommandOutput, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { detectXml } from '@file-type/xml';

// Helper function to create a mock S3Client
function createMockS3Client(): S3Client {
    return {
        send: vi.fn().mockImplementation(async (command: any) => {
            if (command instanceof GetObjectCommand) {
                return {
                    Body: new ReadableStream(),
                    ContentType: 'text/plain',
                    ContentLength: 1024,
                    LastModified: new Date('2024-01-01'),
                } as GetObjectCommandOutput;
            }
            return undefined;
        }),
        config: {},
        destroy: vi.fn(),
        middlewareStack: { clone: vi.fn(), use: vi.fn(), remove: vi.fn(), addRelativeTo: vi.fn(), resolve: vi.fn() },
    } as unknown as S3Client;
}

const { setMockSteamFileTypeResult, createMockTypedStream, mockReadStream, resetMockSteamFileTypeResult, mockWriteStream, mockSteamFileTypeResult } =
    vi.hoisted(() => {
        const mockSteamFileTypeResult: Partial<Writable<FileTypeResult> & { useActual: boolean }> = { mime: 'text/plain', ext: 'txt', useActual: false };
        const setMockSteamFileTypeResult = (
            fileTypeResult: Partial<Writable<FileTypeResult> & { useActual: boolean }> = { mime: 'text/plain', ext: 'txt', useActual: false },
        ) => {
            mockSteamFileTypeResult.mime = fileTypeResult.mime;
            mockSteamFileTypeResult.ext = fileTypeResult.ext;
            mockSteamFileTypeResult.useActual = fileTypeResult.useActual;
        };
        const resetMockSteamFileTypeResult = () => {
            setMockSteamFileTypeResult();
        };

        // Helper function to create a mock typed stream
        const createMockTypedStream = (fileTypeOptions: Partial<FileTypeResult> = mockSteamFileTypeResult) => {
            const mockReader = {
                read: vi
                    .fn()
                    .mockResolvedValueOnce({ done: false, value: new Uint8Array(8) })
                    .mockResolvedValue({ done: true }),
            };

            return Object.assign(mockReader, {
                fileType: fileTypeOptions,
            }) as unknown as ReadableStreamWithFileType;
        };

        const mockReadStream = new ReadableStream();

        const mockWriteStream = {
            write: vi.fn(),
            end: vi.fn(),
            on: vi.fn(),
            close: vi.fn(),
            bytesWritten: 0,
            path: '',
            pending: false,
            writable: true,
            writableEnded: false,
            writableFinished: false,
            writableHighWaterMark: 0,
            writableLength: 0,
            writableObjectMode: false,
            writableCorked: 0,
            destroyed: false,
            closed: false,
            errored: null,
            writableNeedDrain: false,
            _write: vi.fn(),
            _writev: vi.fn(),
            _destroy: vi.fn(),
            _final: vi.fn(),
            setDefaultEncoding: vi.fn(),
            cork: vi.fn(),
            uncork: vi.fn(),
            destroy: vi.fn(),
            addListener: vi.fn(),
            emit: vi.fn(),
            eventNames: vi.fn(),
            getMaxListeners: vi.fn(),
            listenerCount: vi.fn(),
            listeners: vi.fn(),
            off: vi.fn(),
            once: vi.fn(),
            prependListener: vi.fn(),
            prependOnceListener: vi.fn(),
            rawListeners: vi.fn(),
            removeAllListeners: vi.fn(),
            removeListener: vi.fn(),
            setMaxListeners: vi.fn(),
        } as unknown as fs.WriteStream;

        return {
            mockSteamFileTypeResult,
            setMockSteamFileTypeResult,
            createMockTypedStream,
            mockReadStream,
            resetMockSteamFileTypeResult,
            mockWriteStream,
        };
    });

// Mock fs
vi.mock('fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('fs')>();

    const def = {
        createWriteStream: vi.fn(() => mockWriteStream),
        createReadStream: actual.createReadStream,
        constants: {
            ...actual.constants,
            R_OK: 4,
            W_OK: 2,
        },
    };

    Object.defineProperty(def, 'promises', {
        value: {
            unlink: vi.fn(() => Promise.resolve()),
            access: vi.fn(() => Promise.resolve()),
            stat: vi.fn(() =>
                Promise.resolve({
                    size: 100,
                    mtime: new Date('2024-01-01'),
                    birthtime: new Date('2023-12-31'),
                }),
            ),
            appendFile: vi.fn(() => Promise.resolve()),
            readFile: vi.fn(() => Promise.resolve(Buffer.from(''))),
            writeFile: vi.fn(() => Promise.resolve()),
            truncate: vi.fn(() => Promise.resolve()),
        },
        writable: true,
    });

    return {
        default: def,
        ...def,
    };
});

// Mock @smooai/fetch
vi.mock('@smooai/fetch', () => ({
    default: vi.fn(),
}));

type Writable<T> = {
    -readonly [P in keyof T]: T[P];
};

// Mock stream-mmmagic
vi.mock('file-type/node', async (importOriginal) => {
    const actual = await importOriginal<typeof import('file-type')>();
    return {
        fileTypeFromFile: vi.fn().mockResolvedValue({ mime: 'text/plain', ext: 'txt' }),
        FileTypeParser: vi.fn().mockImplementation(() => ({
            toDetectionStream: vi.fn().mockImplementation((...args) => {
                if (mockSteamFileTypeResult.useActual) {
                    return new actual.FileTypeParser({
                        customDetectors: [detectXml],
                    }).toDetectionStream(args?.[0], args?.[1]);
                }
                return createMockTypedStream();
            }),
        })),
    };
});

// Mock AWS SDK
vi.mock('@aws-sdk/client-s3', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@aws-sdk/client-s3')>();
    const mockS3Client = createMockS3Client();
    return {
        ...actual,
        S3Client: vi.fn().mockImplementation(() => mockS3Client),
    };
});

// Mock S3 request presigner
vi.mock('@aws-sdk/s3-request-presigner', () => ({
    getSignedUrl: vi.mocked(() => Promise.resolve('https://signed-url.com/example.txt')),
}));

describe('#File', () => {
    beforeEach(() => {
        vi.mocked(fs.createWriteStream).mockImplementation(() => mockWriteStream);
    });

    afterEach(() => {
        resetMockSteamFileTypeResult();
    });

    it('should return metadata with valid options', async () => {
        const response = new Response(mockReadStream, {
            headers: {
                'content-disposition': 'attachment; filename="example.txt"',
                'content-type': 'text/plain',
                'content-length': '1024',
            },
            status: 200,
        });

        const expectedMetadata = {
            name: 'example.txt',
            mimeType: 'text/plain',
            size: 1024,
            extension: 'txt',
            url: 'https://smoo.ai/example.txt',
            hash: undefined,
            lastModified: undefined,
            createdAt: undefined,
            path: undefined,
        };

        const metadata = await File.getFileMetadata({
            fileSource: FileSource.Url,
            internalResponse: response,
            stream: createMockTypedStream(),
            metadataHint: {
                url: 'https://smoo.ai/example.txt',
                size: 30,
                mimeType: 'text/html',
                name: 'blah.exe',
            },
        });

        expect(metadata).toEqual(expectedMetadata);
    });

    it('should return metadata for word document', async () => {
        const thisMockTypedStream = createMockTypedStream({
            ext: 'docx',
            mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });

        const response = new Response(mockReadStream, {
            headers: {
                'content-disposition': 'attachment; filename="example.docx"',
                'content-type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'content-length': '1024',
            },
            status: 200,
        });

        const expectedMetadata = {
            name: 'example.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            size: 1024,
            extension: 'docx',
            url: 'https://smoo.ai/example.docx',
            hash: undefined,
            lastModified: undefined,
            createdAt: undefined,
            path: undefined,
        };

        const metadata = await File.getFileMetadata({
            fileSource: FileSource.Url,
            internalResponse: response,
            stream: thisMockTypedStream,
            metadataHint: {
                url: 'https://smoo.ai/example.docx',
            },
        });

        expect(metadata).toEqual(expectedMetadata);
    });

    it('should return empty metadata when options are not provided', async () => {
        const metadata = await File.getFileMetadata({ fileSource: FileSource.Url });
        expect(metadata.extension).toBeUndefined();
        expect(metadata.name).toBeUndefined();
        expect(metadata.mimeType).toBeUndefined();
        expect(metadata.size).toBeUndefined();
        expect(metadata.url).toBeUndefined();
        expect(metadata.hash).toBeUndefined();
        expect(metadata.lastModified).toBeUndefined();
        expect(metadata.createdAt).toBeUndefined();
        expect(metadata.path).toBeUndefined();
    });

    it('should handle missing or invalid headers', async () => {
        const thisMockTypedStream = createMockTypedStream({});

        const response = new Response(mockReadStream, {
            headers: {},
            status: 200,
        });

        vi.mocked(fetch).mockResolvedValue(response);

        const metadata = await File.getFileMetadata({
            fileSource: FileSource.Url,
            internalResponse: response,
            stream: thisMockTypedStream,
        });

        expect(metadata.extension).toBeUndefined();
        expect(metadata.name).toBeUndefined();
        expect(metadata.mimeType).toBeUndefined();
        expect(metadata.size).toBeUndefined();
        expect(metadata.url).toBeUndefined();
        expect(metadata.hash).toBeUndefined();
        expect(metadata.lastModified).toBeUndefined();
        expect(metadata.createdAt).toBeUndefined();
        expect(metadata.path).toBeUndefined();
    });

    it('should create file from url', async () => {
        setMockSteamFileTypeResult({ mime: 'image/png', ext: 'png' });
        const url = 'https://example.com/example.png';

        const response = new Response(mockReadStream, {
            headers: {
                'content-disposition': 'attachment; filename="example.png"',
                'content-type': 'image/png',
            },
        });

        vi.mocked(fetch).mockResolvedValue(response);

        const file = await File.createFromUrl(url, { size: 19463 });

        expect(file.metadata).toEqual({
            name: 'example.png',
            mimeType: 'image/png',
            size: 19463,
            extension: 'png',
            url,
            hash: undefined,
            lastModified: undefined,
            createdAt: undefined,
            path: undefined,
        });
    });

    describe('file system operations', () => {
        it('should save bytes as file to disk', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-save-to-disk.txt');

            const mockWriteStream = {
                write: vi.fn(),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

            await file.saveToFile(destinationPath);

            expect(mockWriteStream.write).toHaveBeenCalledWith(Buffer.from(new Uint8Array(8)));
            expect(mockWriteStream.end).toHaveBeenCalled();
        });

        it('should copy bytes as file to new location', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-copy.txt');

            const mockWriteStream = {
                write: vi.fn(),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValueOnce(mockWriteStream);

            await file.copyTo(destinationPath);

            expect(mockWriteStream.write).toHaveBeenCalledWith(Buffer.from(new Uint8Array(8)));
            expect(mockWriteStream.end).toHaveBeenCalled();
        });

        it('should move bytes as file to new location', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-moved.txt');

            const mockWriteStream = {
                write: vi.fn(),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValueOnce(mockWriteStream);

            await file.moveTo(destinationPath);

            expect(mockWriteStream.write).toHaveBeenCalledWith(Buffer.from(new Uint8Array(8)));
            expect(mockWriteStream.end).toHaveBeenCalled();
            expect(file.metadata.name).toBe('example.txt');
        });

        it('should copy existing file to new location', async () => {
            const sourcePath = path.join(__dirname, 'test', 'example.txt');
            const file = await File.createFromFile(sourcePath, { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-copy.txt');

            const mockWriteStream = {
                write: vi.fn(),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

            await file.copyTo(destinationPath);

            expect(mockWriteStream.write).toHaveBeenCalled();
            expect(mockWriteStream.end).toHaveBeenCalled();
            expect(file.metadata.path).toBe(sourcePath);
            expect(file.metadata.name).toBe('example.txt');
        });

        it('should move existing file to new location', async () => {
            const sourcePath = path.join(__dirname, 'test', 'example.txt');
            const file = await File.createFromFile(sourcePath, { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-moved.txt');

            const mockWriteStream = {
                write: vi.fn(),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

            await file.moveTo(destinationPath);

            expect(mockWriteStream.write).toHaveBeenCalled();
            expect(mockWriteStream.end).toHaveBeenCalled();
            expect(vi.mocked(fs.promises.unlink)).toHaveBeenCalledWith(sourcePath);
            expect(file.metadata.path).toBe(destinationPath);
            expect(file.metadata.name).toBe('example-moved.txt');
        });

        it('should delete file', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });

            await file.delete();

            expect(vi.mocked(fs.promises.unlink)).toHaveBeenCalledWith(path.join(__dirname, 'test', 'example.txt'));
        });

        it('should check if file exists', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });
            vi.mocked(fs.promises.access).mockResolvedValue(undefined);

            const exists = await file.exists();

            expect(exists).toBe(true);
        });

        it('should check if file is readable', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });
            vi.mocked(fs.promises.access).mockResolvedValue(undefined);

            const isReadable = await file.isReadable();

            expect(isReadable).toBe(true);
        });

        it('should check if file is writable', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });
            vi.mocked(fs.promises.access).mockResolvedValue(undefined);

            const isWritable = await file.isWritable();

            expect(isWritable).toBe(true);
        });

        it('should append content to file', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });
            const content = 'new content';

            await file.append(content);

            expect(vi.mocked(fs.promises.appendFile)).toHaveBeenCalledWith(path.join(__dirname, 'test', 'example.txt'), Buffer.from(content));
        });

        it('should prepend content to file', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });
            const content = 'new content';
            const existingContent = Buffer.from('existing content');
            vi.mocked(fs.promises.readFile).mockResolvedValue(existingContent);

            await file.prepend(content);

            expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledWith(
                path.join(__dirname, 'test', 'example.txt'),
                Buffer.concat([Buffer.from(content), existingContent]),
            );
        });

        it('should truncate file', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });
            const size = 100;

            await file.truncate(size);

            expect(vi.mocked(fs.promises.truncate)).toHaveBeenCalledWith(path.join(__dirname, 'test', 'example.txt'), size);
        });
    });

    describe('stream operations', () => {
        it('should pipe to writable stream', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const mockWriter = {
                write: vi.fn(),
                close: vi.fn(),
            };
            const destination = {
                getWriter: vi.fn().mockReturnValue(mockWriter),
            } as unknown as WritableStream;

            await file.pipeTo(destination);

            expect(mockWriter.write).toHaveBeenCalled();
            expect(mockWriter.close).toHaveBeenCalled();
        });
    });

    describe('S3 operations', () => {
        it('should upload to S3', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), {
                name: 'example.txt',
                mimeType: 'text/plain',
                size: 8,
            });
            const bucket = 'test-bucket';
            const key = 'example.txt';

            await file.uploadToS3(bucket, key);

            const s3Client = new S3Client();
            expect(s3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        Bucket: bucket,
                        Key: key,
                        ContentType: 'text/plain',
                        ContentLength: 8,
                        ContentDisposition: 'attachment; filename="example.txt"',
                    }),
                }),
            );
        });

        it('should move to S3', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), {
                name: 'example.txt',
                mimeType: 'text/plain',
                size: 8,
            });
            const bucket = 'test-bucket';
            const key = 'example.txt';

            await file.moveToS3(bucket, key);

            expect(vi.mocked(fs.promises.unlink)).toHaveBeenCalledWith(path.join(__dirname, 'test', 'example.txt'));
        });

        it('should create file from S3', async () => {
            const bucket = 'test-bucket';
            const key = 'example.txt';

            const s3Client = new S3Client();

            const file = await File.createFromS3(bucket, key);

            expect(file.metadata).toEqual({
                name: 'example.txt',
                mimeType: 'text/plain',
                size: 1024,
                extension: 'txt',
                url: `s3://${bucket}/${key}`,
                hash: undefined,
                lastModified: new Date('2024-01-01'),
                createdAt: undefined,
                path: undefined,
            });

            expect(s3Client.send).toHaveBeenCalledWith(
                expect.objectContaining({
                    input: expect.objectContaining({
                        Bucket: bucket,
                        Key: key,
                    }),
                }),
            );
        });

        it('should throw error when S3 response body is missing', async () => {
            const bucket = 'test-bucket';
            const key = 'example.txt';

            const s3Client = new S3Client();
            const mockSend = vi.mocked(s3Client.send);
            mockSend.mockImplementation(async (command: any) => {
                if (command instanceof GetObjectCommand) {
                    return {
                        Body: undefined,
                        ContentType: 'text/plain',
                        ContentLength: 1024,
                        LastModified: new Date('2024-01-01'),
                    } as GetObjectCommandOutput;
                }
                return undefined;
            });

            await expect(File.createFromS3(bucket, key)).rejects.toThrow('Response body is missing');
        });

        it('should handle S3 errors', async () => {
            const bucket = 'test-bucket';
            const key = 'example.txt';

            const s3Client = new S3Client();
            vi.mocked(s3Client.send).mockRejectedValue(new Error('S3 error'));

            await expect(File.createFromS3(bucket, key)).rejects.toThrow('S3 error');
        });
    });

    describe('metadata operations', () => {
        it('should set metadata', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const newMetadata = {
                name: 'new-name.txt',
                mimeType: 'text/plain',
            };

            await file.setMetadata(newMetadata);

            expect(file.metadata.name).toBe('new-name.txt');
            expect(file.metadata.mimeType).toBe('text/plain');
        });

        it('should refresh metadata', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });

            await file.refreshMetadata();

            expect(file.metadata.size).toBe(100);
            expect(file.metadata.lastModified).toEqual(new Date('2024-01-01'));
            expect(file.metadata.createdAt).toEqual(new Date('2023-12-31'));
        });

        it('should get file stats', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'), { name: 'example.txt' });

            const stats = await file.getStats();

            expect(stats).toBeDefined();
            expect(stats?.size).toBe(100);
            expect(stats?.mtime).toEqual(new Date('2024-01-01'));
            expect(stats?.birthtime).toEqual(new Date('2023-12-31'));
        });

        it('should generate checksum', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });

            const checksum = await file.getChecksum();

            expect(checksum).toBeDefined();
            expect(typeof checksum).toBe('string');
            expect(checksum.length).toBe(64); // SHA-256 produces 64 hex characters
        });

        it('should read metadata from PNG file', async () => {
            setMockSteamFileTypeResult({ useActual: true });

            const file = await File.createFromFile(path.join(__dirname, 'test', '/icon.png'), { name: 'icon.png' });

            expect(file.metadata).toEqual({
                name: 'icon.png',
                mimeType: 'image/png',
                size: 100,
                extension: 'png',
                url: undefined,
                hash: undefined,
                lastModified: new Date('2024-01-01'),
                createdAt: new Date('2023-12-31'),
                path: path.join(__dirname, 'test', '/icon.png'),
            });
        });

        it('should read metadata from SVG file', async () => {
            setMockSteamFileTypeResult({ useActual: true });

            const file = await File.createFromFile(path.join(__dirname, 'test', '/icon.svg'), { name: 'icon.svg' });

            expect(file.metadata).toEqual({
                name: 'icon.svg',
                mimeType: 'image/svg+xml',
                size: 100,
                extension: 'svg',
                url: undefined,
                hash: undefined,
                lastModified: new Date('2024-01-01'),
                createdAt: new Date('2023-12-31'),
                path: path.join(__dirname, 'test', '/icon.svg'),
            });
        });

        it('should read metadata from DOCX file', async () => {
            setMockSteamFileTypeResult({ useActual: true });

            const file = await File.createFromFile(path.join(__dirname, 'test', '/example.docx'), { name: 'example.docx' });

            expect(file.metadata).toEqual({
                name: 'example.docx',
                mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                size: 100,
                extension: 'docx',
                url: undefined,
                hash: undefined,
                lastModified: new Date('2024-01-01'),
                createdAt: new Date('2023-12-31'),
                path: path.join(__dirname, 'test', '/example.docx'),
            });
        });

        it('should return undefined for missing metadata values', async () => {
            setMockSteamFileTypeResult({ mime: undefined, ext: undefined });
            const file = await File.createFromBytes(new ArrayBuffer(8));

            expect(file.name).toBeUndefined();
            expect(file.mimeType).toBeUndefined();
            expect(file.size).toBe(8);
            expect(file.extension).toBeUndefined();
            expect(file.url).toBeUndefined();
            expect(file.path).toBeUndefined();
            expect(file.hash).toBeUndefined();
            expect(file.lastModified).toBeUndefined();
            expect(file.createdAt).toBeUndefined();
        });
    });

    describe('metadata getters', () => {
        it('should return correct metadata values from URL file', async () => {
            const url = 'https://example.com/example.png';
            const response = new Response(mockReadStream, {
                headers: {
                    'content-disposition': 'attachment; filename="example.png"',
                    'content-type': 'image/png',
                    'content-length': '1024',
                    etag: '"abc123"',
                    'last-modified': '2024-01-01T00:00:00Z',
                },
            });

            vi.mocked(fetch).mockResolvedValue(response);
            setMockSteamFileTypeResult({ mime: 'image/png', ext: 'png' });

            const file = await File.createFromUrl(url);

            expect(file.name).toBe('example.png');
            expect(file.mimeType).toBe('image/png');
            expect(file.size).toBe(1024);
            expect(file.extension).toBe('png');
            expect(file.url).toBe(url);
            expect(file.path).toBeUndefined();
            expect(file.hash).toBe('abc123');
            expect(file.lastModified).toEqual(new Date('2024-01-01T00:00:00Z'));
            expect(file.createdAt).toBeUndefined();
        });

        it('should return correct metadata values from S3 file', async () => {
            const bucket = 'test-bucket';
            const key = 'example.txt';
            const s3Client = new S3Client();
            const mockSend = vi.mocked(s3Client.send);
            mockSend.mockImplementation(async (command: any) => {
                if (command instanceof GetObjectCommand) {
                    return {
                        Body: mockReadStream,
                        ContentType: 'text/plain',
                        ContentLength: 1024,
                        LastModified: new Date('2024-01-01'),
                        ETag: '"xyz789"',
                    } as GetObjectCommandOutput;
                }
                return undefined;
            });

            const file = await File.createFromS3(bucket, key);

            expect(file.name).toBe('example.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBe(1024);
            expect(file.extension).toBe('txt');
            expect(file.url).toBe(`s3://${bucket}/${key}`);
            expect(file.path).toBeUndefined();
            expect(file.hash).toBe('xyz789');
            expect(file.lastModified).toEqual(new Date('2024-01-01'));
            expect(file.createdAt).toBeUndefined();
        });

        it('should return correct metadata values from local file', async () => {
            const filePath = path.join(__dirname, 'test', 'example.txt');
            vi.mocked(fs.promises.stat).mockResolvedValue({
                size: 1024,
                mtime: new Date('2024-01-01'),
                birthtime: new Date('2023-12-31'),
                isFile: () => true,
                isDirectory: () => false,
                isSymbolicLink: () => false,
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isFIFO: () => false,
                isSocket: () => false,
                uid: 0,
                gid: 0,
                rdev: 0,
                blksize: 0,
                blocks: 0,
                ino: 0,
                mode: 0,
                nlink: 0,
                atime: new Date(),
                ctime: new Date(),
                atimeMs: 0,
                mtimeMs: 0,
                ctimeMs: 0,
                birthtimeMs: 0,
                dev: 0,
            });

            const file = await File.createFromFile(filePath);

            expect(file.name).toBe('example.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBe(1024);
            expect(file.extension).toBe('txt');
            expect(file.url).toBeUndefined();
            expect(file.path).toBe(filePath);
            expect(file.hash).toBeUndefined();
            expect(file.lastModified).toEqual(new Date('2024-01-01'));
            expect(file.createdAt).toEqual(new Date('2023-12-31'));
        });

        it('should return undefined for missing metadata values', async () => {
            setMockSteamFileTypeResult({ mime: undefined, ext: undefined });
            const file = await File.createFromBytes(new ArrayBuffer(8));

            expect(file.name).toBeUndefined();
            expect(file.mimeType).toBeUndefined();
            expect(file.size).toBe(8);
            expect(file.extension).toBeUndefined();
            expect(file.url).toBeUndefined();
            expect(file.path).toBeUndefined();
            expect(file.hash).toBeUndefined();
            expect(file.lastModified).toBeUndefined();
            expect(file.createdAt).toBeUndefined();
        });
    });

    // TODO: Test from S3 URL
});
