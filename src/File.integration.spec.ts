import { describe, expect, it, beforeEach, afterEach } from 'vitest';
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
};

describe('File Integration Tests', () => {
    let tempDir: string;

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

    it('should handle DOCX files', async () => {
        const file = await File.createFromFile(TEST_FILES.docx);
        
        expect(file.name).toBe('example.docx');
        expect(file.mimeType).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        expect(file.size).toBeGreaterThan(0);
        expect(file.extension).toBe('docx');
    });

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
});
