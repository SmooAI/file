import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { describe, expect, it } from 'vitest';
import File, { LAZY_HEAD_BYTES } from './File';

/**
 * The TypeScript loader for the shared lazy-streaming contract.
 *
 * Every port has one of these and they all read the SAME file — copying the
 * numbers into this suite instead is the drift that this fixture exists to stop.
 */
interface Contract {
    headBytes: number;
    fill: { pattern: string };
    cases: {
        name: string;
        sourceBytes: number;
        lazyAfterConstruct: boolean;
        sizeKnownAfterConstruct: boolean;
        sha256: string;
    }[];
    eagerConstructor: { lazyAfterConstruct: boolean; sizeKnownAfterConstruct: boolean };
    fullRead: { readCaches: boolean; iterCaches: boolean; payloadReplayedAfterIteration: boolean };
}

const contract: Contract = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'spec', 'lazy-stream-contract.json'), 'utf8'));

function sourceBytes(byteLength: number): Buffer {
    const { pattern } = contract.fill;
    return Buffer.from(pattern.repeat(Math.ceil(byteLength / pattern.length))).subarray(0, byteLength);
}

/** Delivers the payload in small chunks, like a socket would. */
function chunkedStream(payload: Buffer, chunkSize = 4096): Readable {
    return Readable.from(
        (async function* () {
            for (let offset = 0; offset < payload.byteLength; offset += chunkSize) {
                await new Promise((resolve) => setImmediate(resolve));
                yield payload.subarray(offset, offset + chunkSize);
            }
        })(),
    );
}

const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

describe('lazy streaming — shared contract', () => {
    it('pulls the agreed number of head bytes for detection', () => {
        expect(LAZY_HEAD_BYTES).toBe(contract.headBytes);
    });

    it('has fixture content whose hash matches the fixture', () => {
        // Positive control: without this, a broken sourceBytes() would make every
        // case below compare two identically-wrong values and pass.
        for (const testCase of contract.cases) {
            const payload = sourceBytes(testCase.sourceBytes);
            expect(payload.byteLength).toBe(testCase.sourceBytes);
            expect(sha256(payload)).toBe(testCase.sha256);
        }
    });

    for (const testCase of contract.cases) {
        describe(testCase.name, () => {
            it(`is ${testCase.lazyAfterConstruct ? 'lazy' : 'buffered'} after the lazy constructor returns`, async () => {
                const file = await File.createFromStreamLazy(chunkedStream(sourceBytes(testCase.sourceBytes)));
                expect(file.isLazy).toBe(testCase.lazyAfterConstruct);
                expect(file.size !== undefined).toBe(testCase.sizeKnownAfterConstruct);
            });

            it('yields every byte of the source on a full read', async () => {
                const file = await File.createFromStreamLazy(chunkedStream(sourceBytes(testCase.sourceBytes)));
                const bytes = Buffer.from(await file.readFileBytes());

                expect(bytes.byteLength).toBe(testCase.sourceBytes);
                expect(sha256(bytes)).toBe(testCase.sha256);
            });

            it('yields every byte of the source when iterated', async () => {
                const file = await File.createFromStreamLazy(chunkedStream(sourceBytes(testCase.sourceBytes)));
                const hash = crypto.createHash('sha256');
                let total = 0;
                for await (const chunk of file.iterBytes()) {
                    hash.update(chunk);
                    total += chunk.byteLength;
                }

                expect(total).toBe(testCase.sourceBytes);
                expect(hash.digest('hex')).toBe(testCase.sha256);
            });

            it('buffers the whole payload in the eager constructor', async () => {
                const file = await File.createFromStream(chunkedStream(sourceBytes(testCase.sourceBytes)));

                expect(file.isLazy).toBe(contract.eagerConstructor.lazyAfterConstruct);
                expect(file.size !== undefined).toBe(contract.eagerConstructor.sizeKnownAfterConstruct);
                expect(file.size).toBe(testCase.sourceBytes);
            });
        });
    }

    it('caches a full read, so the bytes survive a second call', async () => {
        expect(contract.fullRead.readCaches).toBe(true);
        const payload = sourceBytes(contract.cases.at(-1)!.sourceBytes);
        const file = await File.createFromStreamLazy(chunkedStream(payload));

        const first = Buffer.from(await file.readFileBytes());
        const second = Buffer.from(await file.readFileBytes());

        expect(sha256(first)).toBe(sha256(payload));
        expect(sha256(second)).toBe(sha256(payload));
    });

    it('does not cache an iteration, so the payload is never replayed', async () => {
        expect(contract.fullRead.iterCaches).toBe(false);
        expect(contract.fullRead.payloadReplayedAfterIteration).toBe(false);
        const testCase = contract.cases.at(-1)!;
        const file = await File.createFromStreamLazy(chunkedStream(sourceBytes(testCase.sourceBytes)));

        for await (const _chunk of file.iterBytes()) {
            // drain
        }
        const leftovers = Buffer.from(await file.readFileBytes());

        expect(leftovers.byteLength).not.toBe(testCase.sourceBytes);
        // TypeScript reports the drained tail as an empty read; Go raises instead.
        // The fixture names that divergence — what all five share is non-replay.
        expect(leftovers.byteLength).toBe(0);
    });
});

describe('full-payload reads (regression: single-chunk truncation)', () => {
    // `readFileBytes`, `uploadToS3` and `toBuffer` each used to be one
    // `await stream.read()`, which returns only what the stream happened to have
    // buffered. Anything arriving in more than one chunk was silently cut short.
    const payload = sourceBytes(300_000);

    it('reads a multi-chunk stream whole', async () => {
        const file = await File.createFromStream(chunkedStream(payload));
        expect(Buffer.from(await file.readFileBytes()).byteLength).toBe(payload.byteLength);
    });

    it('checksums the whole file, not the first chunk', async () => {
        const filePath = path.join(__dirname, 'test', 'truncation-regression.bin');
        await fs.promises.writeFile(filePath, payload);
        try {
            const file = await File.createFromFile(filePath);
            expect(await file.getChecksum()).toBe(sha256(payload));
        } finally {
            await fs.promises.unlink(filePath);
        }
    });

    it('puts the whole file in FormData', async () => {
        const filePath = path.join(__dirname, 'test', 'truncation-regression-form.bin');
        await fs.promises.writeFile(filePath, payload);
        try {
            const file = await File.createFromFile(filePath);
            const form = await file.toFormData();
            expect((form.get('file') as { size: number }).size).toBe(payload.byteLength);
        } finally {
            await fs.promises.unlink(filePath);
        }
    });
});
