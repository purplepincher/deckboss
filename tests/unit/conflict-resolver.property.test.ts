import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { mergeEntries, dedupeCorrections } from '../../core/sync/conflict-resolver';
import type { LogEntry, Correction } from '../../core/types/log-entry';
import { newEntrySkeleton } from '../../core/types/log-entry';
import { arbitraryCorrection } from './generators';

// Helper: create a base entry with a fixed id and timestamp.
function baseEntry(id: string, timestamp: string): LogEntry {
  return newEntrySkeleton({
    id,
    timestamp,
    gps: null,
    audio: null,
    source: 'voice',
  });
}

describe('conflict-resolver property tests', () => {
  // --------------------------------------------------------------------
  // 1. Commutativity
  // --------------------------------------------------------------------
  it('mergeEntries is commutative', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbitraryCorrection(), {
          minLength: 0,
          maxLength: 10,
          selector: (c: Correction) => c.id,
        }),
        fc.uniqueArray(arbitraryCorrection(), {
          minLength: 0,
          maxLength: 10,
          selector: (c: Correction) => c.id,
        }),
        (corrA, corrB) => {
          const now = new Date().toISOString();
          const commonId = crypto.randomUUID();

          const e1 = baseEntry(commonId, now);
          e1.corrections = corrA;

          const e2 = baseEntry(commonId, now);
          e2.corrections = corrB;

          const m1 = mergeEntries(e1, e2);
          const m2 = mergeEntries(e2, e1);

          expect(m1).toEqual(m2);
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------
  // 2. Deterministic order in dedupeCorrections
  // --------------------------------------------------------------------
  it('dedupeCorrections is deterministic for the same set of ids', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbitraryCorrection(), {
          minLength: 1,
          maxLength: 10,
          selector: (c: Correction) => c.id,
        }),
        (corrections) => {
          // Generate a random permutation of the same set
          const shuffledArbitrary = fc.shuffledSubarray(corrections, {
            minLength: corrections.length,
            maxLength: corrections.length,
          });
          const [shuffled] = fc.sample(shuffledArbitrary, 1) ?? [[]];

          const a = dedupeCorrections(corrections);
          const b = dedupeCorrections(shuffled as Correction[]);

          expect(a).toEqual(b);
        },
      ),
      { numRuns: 200 },
    );
  });

  // --------------------------------------------------------------------
  // 3. Associativity (convergence of the effective view)
  // --------------------------------------------------------------------
  it('mergeEntries is associative', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbitraryCorrection(), {
          minLength: 0,
          maxLength: 6,
          selector: (c: Correction) => c.id,
        }),
        fc.uniqueArray(arbitraryCorrection(), {
          minLength: 0,
          maxLength: 6,
          selector: (c: Correction) => c.id,
        }),
        fc.uniqueArray(arbitraryCorrection(), {
          minLength: 0,
          maxLength: 6,
          selector: (c: Correction) => c.id,
        }),
        (c1, c2, c3) => {
          const now = new Date().toISOString();
          const commonId = crypto.randomUUID();

          const e1 = baseEntry(commonId, now);
          e1.corrections = c1;
          const e2 = baseEntry(commonId, now);
          e2.corrections = c2;
          const e3 = baseEntry(commonId, now);
          e3.corrections = c3;

          const left = mergeEntries(mergeEntries(e1, e2), e3);
          const right = mergeEntries(e1, mergeEntries(e2, e3));

          expect(left).toEqual(right);
        },
      ),
      { numRuns: 200 },
    );
  });
});
