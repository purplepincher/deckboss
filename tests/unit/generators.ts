import fc from 'fast-check';
import type { LogEntry, Correction } from '../../core/types/log-entry';
import { newEntrySkeleton } from '../../core/types/log-entry';
import { SCHEMA_VERSION } from '../../core/types/common';

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------
const uuidArb = fc.uuidV4();

const threeHoursAgo = new Date(Date.now() - 3 * 60 * 60 * 1000);
const now = new Date();
const recentDateArb = fc.date({ min: threeHoursAgo, max: now }).map(d => d.toISOString());

// ---------------------------------------------------------------------------
// Correction arbitrary
// ---------------------------------------------------------------------------
export function arbitraryCorrection(): fc.Arbitrary<Correction> {
  // optional "fields" used when type === "amend"
  const fieldsArb: fc.Arbitrary<Correction['fields']> = fc.option(
    fc.record({
      transcript: fc.option(
        fc.record({
          text: fc.string({ minLength: 1, maxLength: 200 }),
          confidence: fc.float({ min: 0, max: 1 }),
          language: fc.constant('en-US'),
          engine: fc.constant<'webspeech' | 'whisper-1'>('webspeech'),
        }),
        { nil: false },
      ),
      entities: fc.constant([] as Correction['fields']['entities']),
      tags: fc.constant([] as Correction['fields']['tags']),
    }),
    { nil: true },
  );

  return fc.record({
    id: uuidArb,
    created_at: recentDateArb,
    type: fc.constantFrom('amend' as const, 'retract' as const),
    author: fc.constant(undefined) as fc.Arbitrary<Correction['author']>,
    reason: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: true }),
    fields: fieldsArb,
  }) as unknown as fc.Arbitrary<Correction>;
}

// ---------------------------------------------------------------------------
// LogEntry arbitrary
// ---------------------------------------------------------------------------
export function arbitraryLogEntry(opts?: {
  corrections?: fc.Arbitrary<Correction[]>;
}): fc.Arbitrary<LogEntry> {
  const correctionsArb =
    opts?.corrections ??
    fc.array(arbitraryCorrection(), { minLength: 0, maxLength: 6 });

  return fc
    .record({
      id: uuidArb,
      timestamp: fc.date().map(d => d.toISOString()),
      gps: fc.constant(null),
      audio: fc.constant(null),
      source: fc.constantFrom('voice' as const, 'text' as const, 'import' as const),
      corrections: correctionsArb,
    })
    .map(rec => {
      const entry = newEntrySkeleton({
        id: rec.id,
        timestamp: rec.timestamp,
        gps: rec.gps,
        audio: rec.audio,
        source: rec.source,
      });
      // newEntrySkeleton always initialises corrections to [] – overwrite
      entry.corrections = rec.corrections;
      return entry;
    });
}
