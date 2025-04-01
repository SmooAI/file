/* eslint-disable @typescript-eslint/no-explicit-any -- ok*/
import fetch from '@smooai/fetch';
import File, { FileSource } from '../src/File';
import { FileTypeResult, ReadableStreamWithFileType } from 'file-type/node';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { S3Client, GetObjectCommandOutput, GetObjectCommand } from '@aws-sdk/client-s3';
import path from 'path';
import { detectXml } from '@file-type/xml';
import { Readable } from 'stream';

const {
    setMockSteamFileTypeResult,
    createMockTypedStream,
    createMockReadStream,
    resetMockSteamFileTypeResult,
    mockWriteStream,
    mockSteamFileTypeResult,
    mockStreamContent,
    setMockStreamContent,
    resetMockStreamContent,
} = vi.hoisted(() => {
    const mockSteamFileTypeResult: Partial<Writable<FileTypeResult> & { useActual: boolean }> = { mime: 'text/plain', ext: 'txt', useActual: false };
    let mockStreamContent = new Uint8Array(8);
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

    const setMockStreamContent = (content: Uint8Array) => {
        mockStreamContent = content;
    };
    const resetMockStreamContent = () => {
        setMockStreamContent(new Uint8Array(8));
    };

    const createMockReadStream = () => {
        const mockReader = {
            read: vi.fn().mockResolvedValueOnce(new Uint8Array(8)).mockRejectedValue(new Uint8Array(0)),
            on: vi.fn().mockImplementation((event, callback) => {
                if (event === 'end') {
                    callback();
                }
            }),
        };

        return mockReader as unknown as Readable;
    };

    // Helper function to create a mock typed stream
    const createMockTypedStream = (fileTypeOptions: Partial<FileTypeResult> = mockSteamFileTypeResult, content: Uint8Array = mockStreamContent) => {
        const mockReader = {
            read: vi.fn().mockResolvedValueOnce(content).mockRejectedValue(new Uint8Array(0)),
            on: vi.fn().mockImplementation((event, callback) => {
                if (event === 'end') {
                    callback();
                }
            }),
        };

        return Object.assign(mockReader, {
            fileType: fileTypeOptions,
        }) as unknown as ReadableStreamWithFileType;
    };

    const mockWriteStream = {
        write: vi.fn().mockImplementation((chunk, callback) => {
            callback?.();
        }),
        end: vi.fn(),
        on: vi.fn().mockImplementation((event, callback) => {
            if (event === 'finish') {
                callback();
            }
        }),
        pipe: vi.fn().mockReturnThis(),
        unpipe: vi.fn(),
        cork: vi.fn(),
        uncork: vi.fn(),
        setDefaultEncoding: vi.fn(),
        getDefaultEncoding: vi.fn(),
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
    } as unknown as fs.WriteStream;

    return {
        mockSteamFileTypeResult,
        setMockSteamFileTypeResult,
        createMockReadStream,
        createMockTypedStream,
        resetMockSteamFileTypeResult,
        mockWriteStream,
        mockStreamContent,
        setMockStreamContent,
        resetMockStreamContent,
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

function createMockFetch() {
    // Mock @smooai/fetch
    vi.mock('@smooai/fetch', () => ({
        default: vi.fn(),
    }));
}

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

// Helper function to create a mock S3Client
function createMockS3Client(): S3Client {
    return {
        send: vi.fn().mockImplementation(async (command: any) => {
            if (command instanceof GetObjectCommand) {
                return {
                    Body: createMockReadStream(),
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

function generateMockNodeReadStream(destinationPath: string) {
    const mockNodeReadStream = Object.assign(
        new Readable({
            read() {
                this.push(Buffer.from(new Uint8Array(8)));
                this.push(null);
            },
        }),
        {
            close: vi.fn(),
            bytesRead: 8,
            path: destinationPath,
            pending: false,
        },
    );
    return mockNodeReadStream as unknown as ReturnType<typeof fs.createReadStream>;
}

describe('#File', () => {
    beforeEach(() => {
        createMockFetch();
        vi.mocked(fs.createWriteStream).mockImplementation(() => mockWriteStream);
    });

    afterEach(() => {
        resetMockSteamFileTypeResult();
        resetMockStreamContent();
    });

    it('should return metadata with valid options', async () => {
        const response = new Response(new ReadableStream(), {
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

        const response = new Response(new ReadableStream(), {
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

        const response = new Response(new ReadableStream(), {
            headers: {},
            status: 200,
        });

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

        const response = new Response(new ReadableStream(), {
            headers: {
                'content-disposition': 'attachment; filename="example.png"',
                'content-type': 'image/png',
            },
        });

        vi.mocked(fetch).mockResolvedValueOnce(response);

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
                write: vi.fn().mockImplementation((_chunk, callback) => {
                    callback?.();
                }),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
                pipe: vi.fn().mockReturnThis(),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            await file.saveToFile(destinationPath);
        });

        it('should copy bytes as file to new location', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-copy.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            await file.saveToFile(destinationPath);
        });

        it('should move bytes as file to new location', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8), { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-moved.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            await file.saveToFile(destinationPath);
        });

        it('should copy existing file to new location', async () => {
            const sourcePath = path.join(__dirname, 'test', 'example.txt');
            const file = await File.createFromFile(sourcePath, { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-copy.txt');

            const mockWriteStream = {
                write: vi.fn().mockImplementation((_chunk, callback) => {
                    callback?.();
                }),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
                pipe: vi.fn().mockReturnThis(),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            await file.saveToFile(destinationPath);
        });

        it('should move existing file to new location', async () => {
            const sourcePath = path.join(__dirname, 'test', 'example.txt');
            const file = await File.createFromFile(sourcePath, { name: 'example.txt' });
            const destinationPath = path.join(__dirname, 'test', '/example-moved.txt');

            const mockWriteStream = {
                write: vi.fn().mockImplementation((_chunk, callback) => {
                    callback?.();
                }),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
                pipe: vi.fn().mockReturnThis(),
            } as unknown as ReturnType<typeof fs.createWriteStream>;

            vi.mocked(fs.createWriteStream).mockReturnValue(mockWriteStream);

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));
            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            await file.moveTo(destinationPath);

            expect(vi.mocked(fs.promises.unlink)).toHaveBeenCalledWith(sourcePath);
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
            setMockStreamContent(new Uint8Array(Buffer.from('existing content')));
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
                write: vi.fn().mockImplementation((chunk, callback) => {
                    callback?.();
                }),
                end: vi.fn(),
                on: vi.fn().mockImplementation((event, callback) => {
                    if (event === 'finish') {
                        callback();
                    }
                }),
            } as unknown as NodeJS.WritableStream;

            await file.pipeTo(mockWriter);
        });

        it('should refresh stream for file source', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            await file.readFileBytes();

            const destinationPath = path.join(__dirname, 'test', 'example-refreshed.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            // Refresh the stream
            await file.saveToFile(destinationPath);

            // Verify we can still read from the refreshed stream
            const newBytes = await file.readFileBytes();
            expect(newBytes).toBeDefined();
        });

        it('should refresh stream for S3 source', async () => {
            const file = await File.createFromS3('test-bucket', 'test-key.txt');

            // Refresh the stream
            await file.saveToS3('test-bucket', 'test-key-refreshed.txt');

            // Verify we can still read from the refreshed stream
            const newBytes = await file.readFileBytes();
            expect(newBytes).toBeDefined();
        });

        it('should refresh stream for URL source', async () => {
            const response = new Response(new ReadableStream(), {
                headers: {
                    'content-disposition': 'attachment; filename="test.txt"',
                    'content-type': 'text/plain',
                    'content-length': '8',
                    etag: '"abc123"',
                    'last-modified': '2024-01-01T00:00:00Z',
                },
            });

            vi.mocked(fetch).mockResolvedValueOnce(response);
            setMockSteamFileTypeResult({ mime: 'text/plain', ext: 'txt' });

            const file = await File.createFromUrl('https://example.com/test.txt');
            await file.readFileBytes();

            const destinationPath = path.join(__dirname, 'test', 'example-refreshed.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            // Refresh the stream
            await file.saveToFile(destinationPath);

            // Verify we can still read from the refreshed stream
            const newBytes = await file.readFileBytes();
            expect(newBytes).toBeDefined();
        });

        it('should refresh stream for bytes source', async () => {
            const file = await File.createFromBytes(new ArrayBuffer(8));

            // Consume the stream
            await file.readFileBytes();

            const destinationPath = path.join(__dirname, 'test', 'example-refreshed.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            // Refresh the stream
            await file.saveToFile(destinationPath);

            // Verify we can still read from the refreshed stream
            const newBytes = await file.readFileBytes();
            expect(newBytes).toBeDefined();
        });
    });

    describe('file instance operations', () => {
        it('should preserve original file instance after saveToFile', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const destinationPath = path.join(__dirname, 'test', 'destination.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            const result = await sourceFile.saveToFile(destinationPath);

            expect(result.original).toBe(sourceFile);
            expect(result.newFile).toBeInstanceOf(File);
            expect(result.newFile.metadata.path).toBe(destinationPath);

            // Verify original file is still usable
            const originalBytes = await result.original.readFileBytes();
            expect(originalBytes).toBeDefined();
            expect(originalBytes.byteLength).toBeGreaterThan(0);
        });

        it('should preserve original file instance after saveToS3', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const bucket = 'test-bucket';
            const key = 'test-key.txt';

            const result = await sourceFile.saveToS3(bucket, key);

            expect(result.original).toBe(sourceFile);
            expect(result.newFile).toBeInstanceOf(File);
            expect(result.newFile.metadata.url).toBe(`s3://${bucket}/${key}`);

            // Verify original file is still usable
            const originalBytes = await result.original.readFileBytes();
            expect(originalBytes).toBeDefined();
            expect(originalBytes.byteLength).toBeGreaterThan(0);
        });

        it('should return new file instance after moveTo', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const destinationPath = path.join(__dirname, 'test', 'destination.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));
            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            const newFile = await sourceFile.moveTo(destinationPath);

            expect(newFile).toBeInstanceOf(File);
            expect(newFile.metadata.path).toBe(destinationPath);

            // Verify source file is deleted
            expect(vi.mocked(fs.promises.unlink)).toHaveBeenCalledWith(path.join(__dirname, 'test', 'example.txt'));
        });

        it('should return new file instance after moveToS3', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const bucket = 'test-bucket';
            const key = 'test-key.txt';

            const newFile = await sourceFile.moveToS3(bucket, key);

            expect(newFile).toBeInstanceOf(File);
            expect(newFile.metadata.url).toBe(`s3://${bucket}/${key}`);

            // Verify source file is deleted
            expect(vi.mocked(fs.promises.unlink)).toHaveBeenCalledWith(path.join(__dirname, 'test', 'example.txt'));
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
            mockSend.mockImplementationOnce(async (command: any) => {
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
            vi.mocked(s3Client.send).mockRejectedValueOnce(new Error('S3 error'));

            await expect(File.createFromS3(bucket, key)).rejects.toThrow('S3 error');
        });

        it('should handle S3 file source', async () => {
            const file = await File.createFromS3('test-bucket', 'test-key.txt');
            expect(file.source).toBe(FileSource.S3);
            expect(file.metadata.url).toBe('s3://test-bucket/test-key.txt');
        });

        it('should move file and return new file instance', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const destinationPath = path.join(__dirname, 'test', 'destination.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));
            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            const newFile = await sourceFile.moveTo(destinationPath);

            expect(newFile).toBeInstanceOf(File);
            expect(newFile.toString()).toContain(FileSource.File);
            expect(newFile.metadata.path).toBe(destinationPath);
            expect(newFile.metadata.name).toBe('destination.txt');
        });

        it('should copy file and return new file instance', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const destinationPath = path.join(__dirname, 'test', 'destination.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            const result = await sourceFile.saveToFile(destinationPath);

            expect(result.original).toBe(sourceFile);
            expect(result.newFile).toBeInstanceOf(File);
            expect(result.newFile.toString()).toContain(FileSource.File);
            expect(result.newFile.metadata.path).toBe(destinationPath);
            expect(result.newFile.metadata.name).toBe('destination.txt');
        });

        it('should move file to S3 and return new S3 file instance', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const bucket = 'test-bucket';
            const key = 'test-key.txt';

            const newFile = await sourceFile.moveToS3(bucket, key);

            expect(newFile).toBeInstanceOf(File);
            expect(newFile.toString()).toContain(FileSource.S3);
            expect(newFile.metadata.url).toBe(`s3://${bucket}/${key}`);
            expect(newFile.metadata.name).toBe('test-key.txt');
        });

        it('should copy file to S3 and return new S3 file instance', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const bucket = 'test-bucket';
            const key = 'test-key.txt';

            const result = await sourceFile.saveToS3(bucket, key);

            expect(result.original).toBe(sourceFile);
            expect(result.newFile).toBeInstanceOf(File);
            expect(result.newFile.toString()).toContain(FileSource.S3);
            expect(result.newFile.metadata.url).toBe(`s3://${bucket}/${key}`);
            expect(result.newFile.metadata.name).toBe('test-key.txt');
        });

        it('should get signed URL for S3 file', async () => {
            const file = await File.createFromS3('test-bucket', 'test-key.txt');
            const signedUrl = await file.getSignedUrl();
            expect(signedUrl).toBe('https://signed-url.com/example.txt');
        });

        it('should throw error when getting signed URL for non-S3 file', async () => {
            const file = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            await expect(file.getSignedUrl()).rejects.toThrow('Cannot generate signed URL for non-S3 file');
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
            const response = new Response(new ReadableStream(), {
                headers: {
                    'content-disposition': 'attachment; filename="example.png"',
                    'content-type': 'image/png',
                    'content-length': '1024',
                    etag: '"abc123"',
                    'last-modified': '2024-01-01T00:00:00Z',
                },
            });

            vi.mocked(fetch).mockResolvedValueOnce(response);
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
            mockSend.mockImplementationOnce(async (command: any) => {
                if (command instanceof GetObjectCommand) {
                    return {
                        Body: createMockReadStream(),
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

    describe('metadata operations', () => {
        it('should preserve original file stream after copy operation', async () => {
            const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
            const destinationPath = path.join(__dirname, 'test', 'destination.txt');

            vi.spyOn(fs, 'createReadStream').mockImplementationOnce(() => generateMockNodeReadStream(destinationPath));

            const { original, newFile } = await sourceFile.saveToFile(destinationPath);

            // Verify we can still read from the original file's stream
            const bytes = await original.readFileBytes();
            expect(bytes).toBeDefined();
            expect(bytes.byteLength).toBeGreaterThan(0);
            const newBytes = await newFile.readFileBytes();
            expect(newBytes).toBeDefined();
            expect(newBytes.byteLength).toBeGreaterThan(0);
        });
    });

    it('should save file to S3 and return both original and new file instances', async () => {
        const sourceFile = await File.createFromFile(path.join(__dirname, 'test', 'example.txt'));
        const bucket = 'test-bucket';
        const key = 'test-key.txt';

        const result = await sourceFile.saveToS3(bucket, key);

        expect(result.original).toBe(sourceFile);
        expect(result.newFile).toBeInstanceOf(File);
        expect(result.newFile.toString()).toContain(FileSource.S3);
        expect(result.newFile.metadata.url).toBe(`s3://${bucket}/${key}`);
        expect(result.newFile.metadata.name).toBe('test-key.txt');
    });

    // TODO: Test from S3 URL
});
