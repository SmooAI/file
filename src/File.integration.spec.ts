import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import { setupServer } from 'msw/node';
import { http, HttpResponse } from 'msw';
import File from './File';
import fs from 'fs';
import path from 'path';
import os from 'os';

const TEST_DIR = path.join(__dirname, 'test');
const TEST_FILES = {
    text: path.join(TEST_DIR, 'example.txt'),
    empty: path.join(TEST_DIR, 'empty.txt'),
    docx: path.join(TEST_DIR, 'example.docx'),
    png: path.join(TEST_DIR, 'icon.png'),
    svg: path.join(TEST_DIR, 'icon.svg'),
    pdf: path.join(TEST_DIR, 'icon.pdf'),
} as const;

type TestFileKey = keyof typeof TEST_FILES;

// Create a reverse map of file basenames to their keys in TEST_FILES
const TEST_FILES_REVERSE = Object.entries(TEST_FILES).reduce(
    (acc, [key, filePath]) => {
        acc[path.basename(filePath)] = key as TestFileKey;
        return acc;
    },
    {} as Record<string, TestFileKey>,
);

// Helper function to determine MIME type based on file extension
function getMimeType(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase();
    switch (ext) {
        case '.txt':
            return 'text/plain';
        case '.png':
            return 'image/png';
        case '.svg':
            return 'image/svg+xml';
        case '.pdf':
            return 'application/pdf';
        case '.docx':
            return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
        default:
            return 'application/octet-stream';
    }
}

const server = setupServer(
    http.get('https://api.example.com/files/:id', (req) => {
        const { id } = req.params;
        const file = TEST_FILES[id as keyof typeof TEST_FILES];
        if (!file) {
            return HttpResponse.json({ error: 'File not found' }, { status: 404 });
        }

        const fileContent = fs.readFileSync(file);
        const fileName = path.basename(file);
        const mimeType = getMimeType(fileName);

        return new HttpResponse(fileContent, {
            headers: {
                'Content-Type': mimeType,
                'Content-Length': `${fileContent.length}`,
                'Content-Disposition': `attachment; filename="${fileName}"`,
            },
        });
    }),
);

describe('File Integration Tests', () => {
    let tempDir: string;
    const BUCKET_NAME = 'smoo-dev-test-bucket';

    beforeAll(() => server.listen());
    afterAll(() => server.close());

    beforeEach(() => {
        // Create a temporary directory for test files
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'temp-'));
    });

    afterEach(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    describe('createFromFile', () => {
        it('should create a file from a local file and read its contents', async () => {
            const file = await File.createFromFile(TEST_FILES.text);

            expect(file.name).toBe('example.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('txt');

            const content = await file.readFileString();
            expect(content).toBeTruthy();
        });

        it('should handle empty files correctly', async () => {
            const file = await File.createFromFile(TEST_FILES.empty);

            expect(file.name).toBe('empty.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBe(0);
            expect(file.extension).toBe('txt');

            const content = await file.readFileString();
            expect(content).toBe('');
        });

        it('should handle binary files (PNG)', async () => {
            const file = await File.createFromFile(TEST_FILES.png);

            expect(file.name).toBe('icon.png');
            expect(file.mimeType).toBe('image/png');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('png');

            const bytes = await file.readFileBytes();
            expect(bytes.byteLength).toBeGreaterThan(0);
        });

        it('should handle SVG files', async () => {
            const file = await File.createFromFile(TEST_FILES.svg);

            expect(file.name).toBe('icon.svg');
            expect(file.mimeType).toBe('image/svg+xml');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('svg');

            const content = await file.readFileString();
            expect(content).toContain('<?xml');
            expect(content).toContain('<svg');
        });

        it('should handle PDF files', async () => {
            const file = await File.createFromFile(TEST_FILES.pdf);

            expect(file.name).toBe('icon.pdf');
            expect(file.mimeType).toBe('application/pdf');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('pdf');

            const bytes = await file.readFileBytes();
            expect(bytes.byteLength).toBeGreaterThan(0);
            // Check for PDF magic number (%PDF)
            expect(String.fromCharCode(...new Uint8Array(bytes.slice(0, 4)))).toBe('%PDF');
        });

        it('should handle DOCX files', async () => {
            const file = await File.createFromFile(TEST_FILES.docx);

            expect(file.name).toBe('example.docx');
            expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('docx');
        });
    });

    describe('createFromUrl', () => {
        it('should create a file from URL for text files', async () => {
            const file = await File.createFromUrl('https://api.example.com/files/text');

            expect(file.name).toBe('example.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('txt');

            const content = await file.readFileString();
            expect(content).toBeTruthy();
        });

        it('should create a file from URL for empty files', async () => {
            const file = await File.createFromUrl('https://api.example.com/files/empty');

            expect(file.name).toBe('empty.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBe(0);
            expect(file.extension).toBe('txt');

            const content = await file.readFileString();
            expect(content).toBe('');
        });

        it('should create a file from URL for PNG files', async () => {
            const file = await File.createFromUrl('https://api.example.com/files/png');

            expect(file.name).toBe('icon.png');
            expect(file.mimeType).toBe('image/png');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('png');

            const bytes = await file.readFileBytes();
            expect(bytes.byteLength).toBeGreaterThan(0);
        });

        it('should create a file from URL for SVG files', async () => {
            const file = await File.createFromUrl('https://api.example.com/files/svg');

            expect(file.name).toBe('icon.svg');
            expect(file.mimeType).toBe('image/svg+xml');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('svg');

            const content = await file.readFileString();
            expect(content).toContain('<?xml');
            expect(content).toContain('<svg');
        });

        it('should create a file from URL for PDF files', async () => {
            const file = await File.createFromUrl('https://api.example.com/files/pdf');

            expect(file.name).toBe('icon.pdf');
            expect(file.mimeType).toBe('application/pdf');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('pdf');

            const bytes = await file.readFileBytes();
            expect(bytes.byteLength).toBeGreaterThan(0);
            // Check for PDF magic number (%PDF)
            expect(String.fromCharCode(...new Uint8Array(bytes.slice(0, 4)))).toBe('%PDF');
        });

        it('should create a file from URL for DOCX files', async () => {
            const file = await File.createFromUrl('https://api.example.com/files/docx');

            expect(file.name).toBe('example.docx');
            expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('docx');
        });

        it('should handle non-existent files', async () => {
            await expect(File.createFromUrl('https://api.example.com/files/nonexistent')).rejects.toThrow('File not found');
        });
    });

    // Only works when logged in to AWS for smoo.dev
    describe.skip('createFromS3', () => {
        it('should create a file from S3 for text files', async () => {
            const file = await File.createFromS3(BUCKET_NAME, 'example.txt');

            expect(file.name).toBe('example.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('txt');

            const content = await file.readFileString();
            expect(content).toBeTruthy();
        });

        it('should create a file from S3 for empty files', async () => {
            const file = await File.createFromS3(BUCKET_NAME, 'empty.txt');

            expect(file.name).toBe('empty.txt');
            expect(file.mimeType).toBe('text/plain');
            expect(file.size).toBe(0);
            expect(file.extension).toBe('txt');

            const content = await file.readFileString();
            expect(content).toBe('');
        });

        it('should create a file from S3 for PNG files', async () => {
            const file = await File.createFromS3(BUCKET_NAME, 'icon.png');

            expect(file.name).toBe('icon.png');
            expect(file.mimeType).toBe('image/png');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('png');

            const bytes = await file.readFileBytes();
            expect(bytes.byteLength).toBeGreaterThan(0);
        });

        it('should create a file from S3 for SVG files', async () => {
            const file = await File.createFromS3(BUCKET_NAME, 'icon.svg');

            expect(file.name).toBe('icon.svg');
            expect(file.mimeType).toBe('image/svg+xml');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('svg');

            const content = await file.readFileString();
            expect(content).toContain('<?xml');
            expect(content).toContain('<svg');
        });

        it('should create a file from S3 for PDF files', async () => {
            const file = await File.createFromS3(BUCKET_NAME, 'icon.pdf');

            expect(file.name).toBe('icon.pdf');
            expect(file.mimeType).toBe('application/pdf');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('pdf');

            const bytes = await file.readFileBytes();
            expect(bytes.byteLength).toBeGreaterThan(0);
            // Check for PDF magic number (%PDF)
            expect(String.fromCharCode(...new Uint8Array(bytes.slice(0, 4)))).toBe('%PDF');
        });

        it('should create a file from S3 for DOCX files', async () => {
            const file = await File.createFromS3(BUCKET_NAME, 'example.docx');

            expect(file.name).toBe('example.docx');
            expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
            expect(file.size).toBeGreaterThan(0);
            expect(file.extension).toBe('docx');
        });

        it('should handle non-existent files in S3', async () => {
            await expect(File.createFromS3(BUCKET_NAME, 'nonexistent.txt')).rejects.toThrow('The specified key does not exist.');
        });
    });

    describe('file operations', () => {
        it('should save a file to a new location', async () => {
            const file = await File.createFromFile(TEST_FILES.text);
            const newPath = path.join(tempDir, 'new-example.txt');

            const result = await file.saveToFile(newPath);

            expect(result.original).toBe(file);
            expect(result.newFile.path).toBe(newPath);
            expect(fs.existsSync(newPath)).toBe(true);

            const newContent = await result.newFile.readFileString();
            const originalContent = await file.readFileString();
            expect(newContent).toBe(originalContent);
        });

        it('should move a file to a new location', async () => {
            const file = await File.createFromFile(TEST_FILES.text);
            const newPath = path.join(tempDir, 'moved-example.txt');

            const movedFile = await file.moveTo(newPath);

            expect(movedFile.path).toBe(newPath);
            expect(fs.existsSync(newPath)).toBe(true);
            expect(fs.existsSync(TEST_FILES.text)).toBe(false);

            const nextMovedFile = await movedFile.moveTo(TEST_FILES.text);
            expect(nextMovedFile.path).toBe(TEST_FILES.text);
            expect(fs.existsSync(TEST_FILES.text)).toBe(true);
        });

        it('should append content to a file', async () => {
            const file = await File.createFromFile(TEST_FILES.text);
            const newPath = path.join(tempDir, 'appended-example.txt');
            const originalContent = await file.readFileString();
            const appendContent = '\nAppended content';

            const result = await file.saveToFile(newPath);
            await result.newFile.append(appendContent);

            const finalContent = await result.newFile.readFileString();
            expect(finalContent).toBe(originalContent + appendContent);
        });

        it('should prepend content to a file', async () => {
            const file = await File.createFromFile(TEST_FILES.text);
            const newPath = path.join(tempDir, 'prepended-example.txt');
            const originalContent = await file.readFileString();
            const prependContent = 'Prepended content\n';

            const result = await file.saveToFile(newPath);
            await result.newFile.prepend(prependContent);

            const finalContent = await result.newFile.readFileString();
            expect(finalContent).toBe(prependContent + originalContent);
        });

        it('should truncate a file to a specific size', async () => {
            const file = await File.createFromFile(TEST_FILES.text);
            const newPath = path.join(tempDir, 'truncated-example.txt');
            const truncateSize = 5;

            const result = await file.saveToFile(newPath);
            await result.newFile.truncate(truncateSize);

            const finalContent = await result.newFile.readFileString();
            expect(finalContent.length).toBe(truncateSize);
        });

        it('should pipe file content to a write stream', async () => {
            const file = await File.createFromFile(TEST_FILES.png);
            const outputPath = path.join(TEST_DIR, 'piped-icon.png');
            const writeStream = fs.createWriteStream(outputPath);

            await file.pipeTo(writeStream);
            writeStream.end();

            // Verify the file was created and has content
            expect(fs.existsSync(outputPath)).toBe(true);
            const stats = fs.statSync(outputPath);
            expect(stats.size).toBeGreaterThan(0);

            // Clean up
            fs.unlinkSync(outputPath);
            expect(fs.existsSync(outputPath)).toBe(false);
        });
    });
});
