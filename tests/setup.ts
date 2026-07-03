import "fake-indexeddb/auto";
import "@testing-library/jest-dom/vitest";
import { Blob as NodeBlob } from "node:buffer";

// jsdom's own Blob class isn't recognized by Node's global structuredClone()
// (which fake-indexeddb's IndexedDB implementation uses to clone values on
// insertion, per spec) — every Blob written via idb-keyval/local-db.ts's
// putAudioBlob() and read back via getAudioBlob() silently comes back as an
// empty, sizeless, typeless plain object, not a Blob. No test in this suite
// exercising that round-trip has ever actually verified byte fidelity — the
// audio-verification tests all pass "for the wrong reason," comparing two
// equally-corrupted `undefined` values. Node's own Blob (globalThis.Blob
// before jsdom overrides it) IS structuredClone-compatible, so swapping the
// global in test setup makes every existing Blob-through-IndexedDB
// assertion in this suite actually meaningful, with no production code
// change. See tests/unit/restore-drill.test.ts's audio-fidelity assertions
// for the test that surfaced this.
globalThis.Blob = NodeBlob as unknown as typeof Blob;
