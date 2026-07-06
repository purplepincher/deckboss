import { describe, it, expect, vi } from "vitest";
import { clear, createStore } from "idb-keyval";
import {
  putEntry,
  getEntry,
  allEntries,
  putAudioBlob,
  getAudioBlob,
  setConfig,
  getAudioVerifiedAt,
  allSyncJobs,
} from "../../src/core/storage/local-db";
import {
  enqueueEntryForSync,
  enqueueAudioForSync,
  pushAllLocalEntries,
  pullRemoteEntries,
  syncNow,
  rehydrateAudioForEntry,
} from "../../src/core/sync/sync-engine";
import { buildAdapter, clearAdapterCache } from "../../src/core/storage/registry";
import { LocalZipAdapter } from "../../src/core/storage/adapters/local-zip";
import { defaultAppConfig } from "../../src/config/schema";
import {
  buildEntry,
  buildAmendCorrection,
  buildRetractCorrection,
  applyCorrections,
} from "../../src/core/tensor-log/entry-builder";
import { newEntrySkeleton, type LogEntry, type EffectiveLogEntry, type CorrectionAuthor, type EditableFields } from "../../src/core/types/log-entry";
import { audioPath, entryPath, MANIFEST_PATH } from "../../src/core/storage/interface";
import { mimeToExt } from "../../src/utils/file";

/**
 * THE RESTORE DRILL (Fable Phase 2 plan §5, item 3 / A1).
 *
 * The premise under test: DeckBoss's BYOK cloud storage is "the canonical
 * archive," the phone is just a cache — so a fresh device pointed at the
 * same storage should recover everything a lost device had. This has never
 * been exercised end-to-end before this test. Every prior audit this
 * session examined the *write* path; this file is exclusively concerned
 * with *read-side recovery from a cold start*.
 *
 * "Device A" and "device B" are simulated as two completely separate local
 * IndexedDB states (wiped between phases via wipeLocalDeviceState() below —
 * device B starts with zero prior local knowledge, exactly like a fresh
 * install) that both resolve, through the real registry.buildAdapter()
 * cache, to the exact same LocalZipAdapter instance — the one thing that's
 * legitimately shared in real life (the same bucket/export), unlike
 * anything in IndexedDB (which never leaves the device it's on).
 *
 * Every write happens through the real call sequence the app itself uses
 * (see useRecording.ts's onStop handler and state/store.ts's
 * amendEntry/retractEntry) — buildEntry/buildAmendCorrection/
 * buildRetractCorrection, putEntry, enqueueEntryForSync/enqueueAudioForSync,
 * putAudioBlob — never a hand-rolled shortcut. Every sync happens through
 * pushAllLocalEntries/pullRemoteEntries/syncNow, never by poking the
 * adapter's files/blobs maps directly (except where a test deliberately
 * corrupts storage to simulate an adversarial condition, which is called
 * out explicitly in each case).
 */

const LOCAL_ZIP_CONFIG = { ...defaultAppConfig(), storage: { activeBackend: "local-zip" as const } };
const TEST_DEVICE_ID = crypto.randomUUID();

// The five IndexedDB databases local-db.ts owns (see its header comment:
// "each store gets its OWN database"). Wiping all five is what "a
// completely fresh in-memory IndexedDB state" means for this app — no
// shortcut, no reuse of device A's entries/audio/config/queue/verified-state.
const LOCAL_DB_STORES: Array<[string, string]> = [
  ["deckboss-entries", "entries"],
  ["deckboss-audio", "audio"],
  ["deckboss-meta", "meta"],
  ["deckboss-sync-queue", "sync-queue"],
  ["deckboss-audio-verified", "audio-verified"],
];

async function wipeLocalDeviceState(): Promise<void> {
  for (const [dbName, storeName] of LOCAL_DB_STORES) {
    await clear(createStore(dbName, storeName));
  }
}

// ---- Real-call-path helpers, mirroring useRecording.ts / state/store.ts --

async function captureEntry(params: {
  audioBlob: Blob | null;
  transcript?: Parameters<typeof buildEntry>[0]["transcript"];
  timestamp?: string;
}): Promise<LogEntry> {
  const entry = await buildEntry({
    deviceId: TEST_DEVICE_ID,
    audioBlob: params.audioBlob,
    gps: null,
    transcript: params.transcript,
    source: "voice",
    timestamp: params.timestamp,
  });
  // Mirrors useRecording.ts: save the entry first, then best-effort audio.
  await putEntry(entry);
  await enqueueEntryForSync(entry.id);
  if (entry.audio && params.audioBlob) {
    await putAudioBlob(entry.id, params.audioBlob);
    await enqueueAudioForSync(entry.id, params.audioBlob);
  }
  return entry;
}

async function amend(entryId: string, fields: EditableFields, reason?: string, author?: CorrectionAuthor): Promise<LogEntry> {
  const raw = await getEntry(entryId);
  if (!raw) throw new Error(`amend(): entry ${entryId} not found locally`);
  // Mirrors state/store.ts's amendEntry exactly.
  const next: LogEntry = {
    ...raw,
    corrections: [...raw.corrections, buildAmendCorrection(fields, TEST_DEVICE_ID, reason, author)],
  };
  await putEntry(next);
  await enqueueEntryForSync(next.id);
  return next;
}

async function retract(entryId: string, reason?: string, author?: CorrectionAuthor): Promise<LogEntry> {
  const raw = await getEntry(entryId);
  if (!raw) throw new Error(`retract(): entry ${entryId} not found locally`);
  // Mirrors state/store.ts's retractEntry exactly.
  const next: LogEntry = {
    ...raw,
    corrections: [...raw.corrections, buildRetractCorrection(TEST_DEVICE_ID, reason, author)],
  };
  await putEntry(next);
  await enqueueEntryForSync(next.id);
  return next;
}

function audioBlobFor(text: string, type = "audio/webm;codecs=opus"): Blob {
  return new Blob([text], { type });
}

const HUMAN: CorrectionAuthor = { kind: "human" };
const MODEL_WHISPER: CorrectionAuthor = { kind: "model", engine: "whisper-1" };

// ===========================================================================
// 1-3. THE MAIN DRILL: populate device A with a realistic mix, lose the
// device, recover on device B, assert byte-for-byte fidelity.
// ===========================================================================

describe("restore drill: device A populated -> device lost -> device B recovers from the same archive", () => {
  it("recovers every entry, every correction fold, and every verified audio blob on a fresh device with zero prior local state", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // ---- DEVICE A: build a realistic, adversarial mix -------------------

    // 1. Current-shape entry, has audio, amended twice by different author
    //    kinds (human then model-whisper) after the initial model-webspeech
    //    transcript correction from capture.
    const eCurrentAudioMultiAmend = await captureEntry({
      audioBlob: audioBlobFor("haul one audio bytes"),
      transcript: { text: "Set twelve pots starboard rail", confidence: 0.9, language: "en", engine: "webspeech" },
    });
    await amend(eCurrentAudioMultiAmend.id, { tags: ["haul", "starboard"] }, "tagged for search", HUMAN);
    await amend(
      eCurrentAudioMultiAmend.id,
      { transcript: { text: "Set twelve crab pots, starboard rail, eighty fathom", confidence: 0.97, language: "en", engine: "whisper-1" } },
      "re-transcribed with Whisper for accuracy",
      MODEL_WHISPER,
    );

    // 2. Current-shape entry, no audio, later retracted (duplicate report).
    const eNoAudioRetracted = await captureEntry({
      audioBlob: null,
      transcript: { text: "Duplicate of previous haul, ignore", confidence: 0.8, language: "en", engine: "webspeech" },
    });
    await retract(eNoAudioRetracted.id, "duplicate entry, superseded", HUMAN);

    // 3. Legacy-shape entry: transcript set directly on the base record, no
    //    corrections at all — pre-dates the transcript-as-correction change.
    const eLegacyNoAudio = newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: null,
      audio: null,
      source: "voice",
    });
    eLegacyNoAudio.transcript = { text: "Legacy entry, transcript on base record", confidence: 0.85, language: "en", engine: "webspeech" };
    eLegacyNoAudio.entities = [{ type: "gear", value: "gillnet", confidence: 0.9 }];
    eLegacyNoAudio.tags = ["legacy"];
    await putEntry(eLegacyNoAudio);
    await enqueueEntryForSync(eLegacyNoAudio.id);

    // 4. Legacy-shape entry WITH audio, later amended (current-style
    //    correction layered on top of a legacy base) — the mixed case.
    const legacyAudioBlob = audioBlobFor("legacy audio bytes");
    const eLegacyWithAudioAmended = newEntrySkeleton({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      gps: null,
      audio: { filename: "legacy_audio.webm", duration_ms: 4200, format: "audio/webm;codecs=opus", size_bytes: legacyAudioBlob.size },
      source: "voice",
    });
    eLegacyWithAudioAmended.transcript = { text: "Legacy with audio", confidence: 0.75, language: "en", engine: "webspeech" };
    await putEntry(eLegacyWithAudioAmended);
    await enqueueEntryForSync(eLegacyWithAudioAmended.id);
    await putAudioBlob(eLegacyWithAudioAmended.id, legacyAudioBlob);
    await enqueueAudioForSync(eLegacyWithAudioAmended.id, legacyAudioBlob);
    await amend(eLegacyWithAudioAmended.id, { tags: ["legacy", "amended"] }, "added tags", HUMAN);

    // 5. Audio-only entry, no transcript at all (silence/no-signal capture)
    //    — buildEntry must not fabricate a correction for an absent
    //    transcript (see entry-builder.ts's comment on this).
    const eSilenceAudioOnly = await captureEntry({ audioBlob: audioBlobFor("silence bytes") });

    // 6. Retracted entry that also has audio — retraction must not hide the
    //    entry from recovery, only mark it retracted.
    const eRetractedWithAudio = await captureEntry({
      audioBlob: audioBlobFor("retracted haul audio"),
      transcript: { text: "Wrong boat logged, retracting", confidence: 0.7, language: "en", engine: "webspeech" },
    });
    await retract(eRetractedWithAudio.id, "wrong vessel", HUMAN);

    const allDeviceAIds = [
      eCurrentAudioMultiAmend.id,
      eNoAudioRetracted.id,
      eLegacyNoAudio.id,
      eLegacyWithAudioAmended.id,
      eSilenceAudioOnly.id,
      eRetractedWithAudio.id,
    ];

    // Snapshot device A's raw + effective state before it's "lost" — this
    // is the ground truth device B must reproduce exactly.
    const deviceARaw = new Map<string, LogEntry>();
    const deviceAEffective = new Map<string, EffectiveLogEntry>();
    for (const id of allDeviceAIds) {
      const raw = await getEntry(id);
      if (!raw) throw new Error(`setup bug: ${id} missing on device A`);
      deviceARaw.set(id, raw);
      deviceAEffective.set(id, applyCorrections(raw));
    }

    // ---- Sync device A the way the real app does: syncNow(), not a
    // hand-rolled push. ------------------------------------------------
    const syncResultA = await syncNow();
    expect(syncResultA.pushed).toBeGreaterThan(0);

    // Sanity: every job actually drained (no leftover failures) and every
    // entry with audio got a verified upload — this is the write-side
    // precondition the restore drill assumes; if this fails, the failure
    // is in the write path this session already audited, not in recovery.
    const jobsAfterA = await allSyncJobs();
    expect(jobsAfterA).toHaveLength(0);
    for (const id of [eCurrentAudioMultiAmend.id, eLegacyWithAudioAmended.id, eSilenceAudioOnly.id, eRetractedWithAudio.id]) {
      expect(await getAudioVerifiedAt(id)).not.toBeNull();
    }

    const sharedAdapter = await buildAdapter(LOCAL_ZIP_CONFIG);
    if (!sharedAdapter) throw new Error("setup bug: no adapter");

    // ---- DEVICE A IS GONE. Fresh, empty local IndexedDB state — device B
    // has zero prior local knowledge, same adapter/manifest device A wrote
    // to (exactly mirrors a phone reinstall pointed at the same bucket). --
    await wipeLocalDeviceState();
    expect(await allEntries()).toHaveLength(0); // confirm the wipe actually took

    await setConfig(LOCAL_ZIP_CONFIG); // user re-selects the same storage backend
    const deviceBAdapter = await buildAdapter(LOCAL_ZIP_CONFIG);
    expect(deviceBAdapter).toBe(sharedAdapter); // same archive, not a fresh empty one

    // ---- Run the actual cold-start recovery path a real fresh install
    // would run. -----------------------------------------------------
    const syncResultB = await syncNow();
    expect(syncResultB.pulled).toBe(allDeviceAIds.length);

    // ---- Assertions: entries, in full ------------------------------------
    const deviceBEntries = await allEntries();
    expect(deviceBEntries).toHaveLength(allDeviceAIds.length);

    for (const id of allDeviceAIds) {
      const pulledRaw = await getEntry(id);
      expect(pulledRaw, `entry ${id} missing on device B`).toBeDefined();
      const pulledEffective = applyCorrections(pulledRaw!);
      // Byte-for-byte identical post-fold effective view.
      expect(pulledEffective).toEqual(deviceAEffective.get(id));
    }

    // Corrections survived, in order, with the right effective result.
    const pulledMultiAmend = await getEntry(eCurrentAudioMultiAmend.id);
    expect(pulledMultiAmend!.corrections).toHaveLength(3); // capture transcript + 2 amends
    expect(pulledMultiAmend!.corrections[0]?.author).toEqual({ kind: "model", engine: "webspeech" });
    expect(pulledMultiAmend!.corrections[1]?.author).toEqual(HUMAN);
    expect(pulledMultiAmend!.corrections[2]?.author).toEqual(MODEL_WHISPER);
    const effectiveMultiAmend = applyCorrections(pulledMultiAmend!);
    expect(effectiveMultiAmend.transcript?.text).toBe("Set twelve crab pots, starboard rail, eighty fathom");
    expect(effectiveMultiAmend.tags).toEqual(["haul", "starboard"]);
    expect(effectiveMultiAmend.amended).toBe(true);

    // Retracted entries are still present and marked retracted, not
    // silently dropped.
    const pulledRetracted = await getEntry(eNoAudioRetracted.id);
    expect(pulledRetracted).toBeDefined();
    expect(applyCorrections(pulledRetracted!).retracted).toBe(true);
    const pulledRetractedWithAudio = await getEntry(eRetractedWithAudio.id);
    expect(applyCorrections(pulledRetractedWithAudio!).retracted).toBe(true);

    // Legacy-shape entries resolve their transcript correctly on the fresh
    // device too (base record, no correction).
    const pulledLegacy = await getEntry(eLegacyNoAudio.id);
    expect(applyCorrections(pulledLegacy!).transcript?.text).toBe("Legacy entry, transcript on base record");
    const pulledLegacyAmended = await getEntry(eLegacyWithAudioAmended.id);
    const effectiveLegacyAmended = applyCorrections(pulledLegacyAmended!);
    expect(effectiveLegacyAmended.transcript?.text).toBe("Legacy with audio"); // from base, untouched by the tags-only amend
    expect(effectiveLegacyAmended.tags).toEqual(["legacy", "amended"]);

    // ---- Assertions: audio, at the adapter/archive level -----------------
    // Every audio blob that was uploaded AND verified before device A was
    // lost is re-fetchable directly from the archive via adapter.readBlob()
    // — the data itself was never lost.
    for (const [id, raw] of deviceARaw) {
      if (!raw.audio) continue;
      const ext = mimeToExt(raw.audio.format);
      const path = audioPath(id, ext);
      const blob = await sharedAdapter.readBlob(path);
      expect(blob.size).toBe(raw.audio.size_bytes);
    }

    // ---- The finding: audio does NOT come back into LOCAL storage on its
    // own. syncNow()/pullRemoteEntries() only ever touch entryStore; no
    // code path in sync-engine.ts (or anywhere else in src/) ever calls
    // adapter.readBlob() to re-hydrate a local audio blob for an entry
    // whose local copy is gone. This is true even though the ROADMAP's
    // audio-retention policy explicitly asserts "evicted audio is
    // re-fetchable from the archive on demand" — the archive-level promise
    // (assertions immediately above) holds, but there is currently no
    // "on demand" fetch implemented anywhere the app would actually call
    // it from (useAudioBlob.ts reads local IndexedDB only, with no
    // fallback). A user recovering on a fresh device would see every
    // entry's text/metadata restored perfectly, and every "audio"
    // indicator would be a dead end.
    for (const [id, raw] of deviceARaw) {
      if (!raw.audio) continue;
      expect(await getAudioBlob(id)).toBeUndefined();
    }
  });
});

// ===========================================================================
// 4. ADVERSARIAL: try to break it.
// ===========================================================================

describe("restore drill, adversarial: a manifest entry whose file is missing/corrupted", () => {
  it("skips the missing entry gracefully and still recovers everything else, without throwing", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const good1 = await captureEntry({ audioBlob: null, transcript: { text: "First good entry", confidence: 0.9, language: "en", engine: "webspeech" } });
    const willGoMissing = await captureEntry({ audioBlob: null, transcript: { text: "This file will vanish from storage", confidence: 0.9, language: "en", engine: "webspeech" } });
    const good2 = await captureEntry({ audioBlob: null, transcript: { text: "Second good entry", confidence: 0.9, language: "en", engine: "webspeech" } });

    await syncNow();

    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;
    // Simulate storage corruption/loss: the manifest still lists this
    // entry's path (refreshManifest() isn't re-run), but the file itself
    // is gone — e.g. a partial/interrupted delete, or bucket-level
    // corruption unrelated to this app.
    await adapter.deleteFile(entryPath(willGoMissing.timestamp, willGoMissing.id));

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const result = await syncNow();
    // Must not throw, and must still recover the two good entries.
    expect(result.pulled).toBe(2);

    expect(await getEntry(good1.id)).toBeDefined();
    expect(await getEntry(good2.id)).toBeDefined();
    expect(await getEntry(willGoMissing.id)).toBeUndefined();
  });

  it("reports the skipped entry in the return value", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const good1 = await captureEntry({ audioBlob: null, transcript: { text: "First good entry", confidence: 0.9, language: "en", engine: "webspeech" } });
    const willGoMissing = await captureEntry({ audioBlob: null, transcript: { text: "This file will vanish from storage", confidence: 0.9, language: "en", engine: "webspeech" } });
    const good2 = await captureEntry({ audioBlob: null, transcript: { text: "Second good entry", confidence: 0.9, language: "en", engine: "webspeech" } });

    await syncNow();

    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;
    const missingPath = entryPath(willGoMissing.timestamp, willGoMissing.id);
    await adapter.deleteFile(missingPath);

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const result = await syncNow();
    expect(result.pulled).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.skippedPaths).toContain(missingPath);
    expect(await getEntry(good1.id)).toBeDefined();
    expect(await getEntry(good2.id)).toBeDefined();
    expect(await getEntry(willGoMissing.id)).toBeUndefined();
  });
});

describe("restore drill, adversarial: audio that was never verified/uploaded before the device was lost", () => {
  it("is genuinely, permanently unrecoverable — the archive never had it in the first place", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // Build the entry, save it, and store its audio locally — but never
    // enqueue/drain the audio upload job at all, simulating the device
    // being lost (killed, reinstalled) between putAudioBlob() and
    // enqueueAudioForSync() in useRecording.ts, or before any sync cycle
    // ever got a turn to drain a queued audio job. pushAllLocalEntries()
    // (not a raw drainQueue()) is what the real app uses to push text and
    // refresh the manifest — using it here (rather than drainQueue alone)
    // avoids a self-inflicted "stale manifest" failure that would hide
    // what this test is actually about.
    const entry2 = await buildEntry({
      deviceId: TEST_DEVICE_ID,
      audioBlob: audioBlobFor("never uploaded 2"),
      gps: null,
      source: "voice",
    });
    await putEntry(entry2);
    await enqueueEntryForSync(entry2.id);
    await putAudioBlob(entry2.id, audioBlobFor("never uploaded 2"));
    // Deliberately no enqueueAudioForSync() call.
    await pushAllLocalEntries(); // pushes the entry text + refreshes the manifest; no audio job exists to drain

    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);
    await syncNow();

    // The entry itself recovers fine — text is never at risk here.
    const pulled = await getEntry(entry2.id);
    expect(pulled).toBeDefined();
    expect(pulled!.audio).not.toBeNull(); // metadata claims audio exists...

    // ...but the bytes were never archived, so they're gone. This is the
    // ROADMAP's own acknowledged, accepted limit ("a different,
    // unfixable-from-here problem the retention policy... is meant to
    // prevent") — asserted here explicitly so it's a locked-in, verified
    // fact rather than an assumption.
    await expect(adapter.readBlob(audioPath(entry2.id, "webm"))).rejects.toThrow();
  });
});

describe("restore drill, adversarial: manifest ambiguity — two files resolving to the same entry id with different content", () => {
  it("does not throw and does not lose the rest of the pull — first-processed file's base fields silently win, second file's differing base fields are discarded with no error", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // A UUID collision "shouldn't be possible," so this is manufactured
    // directly against the adapter to see what pullRemoteEntries() does if
    // it somehow happened (storage-level corruption, a manifest edited by
    // hand, or a future bug that reuses an id).
    const sharedId = crypto.randomUUID();
    const ts = new Date().toISOString();

    const fileA: LogEntry = newEntrySkeleton({ id: sharedId, timestamp: ts, gps: null, audio: null, source: "voice" });
    fileA.transcript = { text: "Version A of a conflicting id", confidence: 0.9, language: "en", engine: "webspeech" };

    const fileB: LogEntry = newEntrySkeleton({ id: sharedId, timestamp: ts, gps: null, audio: null, source: "voice" });
    fileB.transcript = { text: "Version B of a conflicting id — different base transcript", confidence: 0.9, language: "en", engine: "webspeech" };

    const otherGood = await captureEntry({ audioBlob: null, transcript: { text: "Unrelated good entry after the conflict", confidence: 0.9, language: "en", engine: "webspeech" } });
    // otherGood must sort after the conflicting pair in manifest order for
    // this to demonstrate the "kills the rest of the pull" blast radius —
    // pullRemoteEntries() processes manifest.entries in array order.
    await syncNow();

    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;
    const { serializeEntry } = await import("../../src/core/tensor-log/entry-serializer");
    const pathA = `DeckBoss/conflict/${sharedId}-a.md`;
    const pathB = `DeckBoss/conflict/${sharedId}-b.md`;
    await adapter.writeFile(pathA, serializeEntry(fileA));
    await adapter.writeFile(pathB, serializeEntry(fileB));

    const manifest = await adapter.getManifest();
    // Ensure the conflicting pair is ordered before the unrelated good
    // entry that already synced normally, and rewrite the manifest
    // directly (simulating an already-corrupted/hand-edited manifest, not
    // going through refreshManifest()'s normal union logic).
    const goodPath = entryPath(otherGood.timestamp, otherGood.id);
    const rest = manifest.entries.filter((f) => f.path !== goodPath);
    await adapter.writeManifest({
      version: "1.0",
      generatedAt: new Date().toISOString(),
      entries: [
        { path: pathA, size: new Blob([serializeEntry(fileA)]).size, modifiedAt: ts },
        { path: pathB, size: new Blob([serializeEntry(fileB)]).size, modifiedAt: ts },
        ...rest,
        manifest.entries.find((f) => f.path === goodPath)!,
      ],
    });

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // Investigated in depth because it looked, on paper, like it should
    // throw: mergeEntries() (conflict-resolver.ts) always spreads `local`
    // verbatim for every field except `corrections` — so on the second
    // file processed for the same id, `merged` is constructed to be
    // field-for-field identical to what's already stored (`existing`),
    // by construction, regardless of what the second file actually
    // contained. assertWriteIsAdditive()'s core-field check then compares
    // `merged` against `existing` and always finds them equal — it can
    // never observe fileB's differing transcript at all, because
    // mergeEntries() already discarded it before the invariant check ever
    // runs. So this does not throw, and does not touch the rest of the
    // pull — but it does mean the SECOND file's conflicting base fields
    // vanish with zero error, warning, or trace. ARCHITECTURE.md's
    // conflict-resolver.ts already documents the precondition this relies
    // on ("core fields... are assumed identical; if they ever differ
    // that's a bug upstream, not something this function should paper
    // over") — confirmed here: it doesn't paper over it by throwing, it
    // papers over it by silently keeping whichever file the manifest
    // happened to list first. Given real UUIDv4 ids, this path is
    // essentially unreachable; recorded so the actual behavior is known
    // rather than assumed, not because it needs a fix.
    await expect(pullRemoteEntries()).resolves.not.toThrow();
    expect(await getEntry(otherGood.id)).toBeDefined();

    const resolved = await getEntry(sharedId);
    expect(resolved?.transcript?.text).toBe("Version A of a conflicting id");
  });
});

describe("restore drill, adversarial: corrupted manifest.json", () => {
  it("a fresh device's cold-start sync must NOT destructively overwrite an unreadable-but-real manifest with an empty one (the actual bug this drill found)", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const entry = await captureEntry({ audioBlob: null, transcript: { text: "Entry before manifest corruption", confidence: 0.9, language: "en", engine: "webspeech" } });
    await syncNow();

    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;
    // Simulate a partial/interrupted manifest write leaving invalid JSON —
    // realistic for a real network backend (interrupted upload). The .md
    // file itself is untouched; only the discovery index is corrupted.
    await adapter.writeFile(MANIFEST_PATH, "{ not valid json, truncated write");

    // ---- DEVICE B: fresh install, zero local entries, first sync ever
    // attempts to recover from an archive whose manifest happens to be
    // momentarily corrupted. -----------------------------------------
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // CONFIRMED BUG (found by this drill, fixed in sync-engine.ts's
    // refreshManifest()): syncNow() calls pushAllLocalEntries() BEFORE
    // pullRemoteEntries(). pushAllLocalEntries() -> refreshManifest() has
    // its own try/catch around adapter.getManifest() (to tolerate "no
    // manifest yet") — before the fix, that catch fired for THIS corrupted
    // manifest too (JSON.parse failure looks identical to "doesn't exist"
    // from inside the catch), fell through to the union step with
    // remoteFiles=[] AND localFiles=[] (device B has nothing local yet),
    // and WROTE that empty-but-valid manifest back — permanently replacing
    // the real (if momentarily unreadable) index with nothing, before
    // pullRemoteEntries() ever got a chance to run. The three real .md/
    // audio files in storage were never touched, but became permanently
    // undiscoverable. This is a strictly worse outcome than a thrown
    // exception: it's silent, and it destroys data instead of merely
    // failing to read it.
    //
    // Post-fix: a device with nothing local to contribute must not write
    // a manifest at all when it couldn't read the existing one — so the
    // sync attempt now fails loudly (rejects) instead of silently
    // succeeding while destroying the index.
    await expect(syncNow()).rejects.toThrow();

    // The critical property: the manifest itself must be untouched by
    // that failed attempt — still whatever it was (corrupted), not
    // silently replaced by a valid-but-empty one. Confirms no destructive
    // write happened.
    await expect(adapter.readFile(MANIFEST_PATH)).resolves.toBe("{ not valid json, truncated write");

    // And critically: recovery is not permanently lost. Once the manifest
    // is repaired (here: device A, which still has its local copy, syncs
    // again — its refreshManifest() has real local entries to contribute,
    // so it proceeds and writes a correct manifest), a subsequent device B
    // sync recovers the entry normally.
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);
    await putEntry(entry);
    await enqueueEntryForSync(entry.id);
    await syncNow(); // "device A" resyncs, repairing the manifest

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);
    const recovered = await syncNow();
    expect(recovered.pulled).toBe(1);
    expect(await getEntry(entry.id)).toBeDefined();
  });
});

describe("restore drill, fix verification: a stale/incomplete manifest is no longer a single point of failure on a cold-start recovery", () => {
  it("recovers a file that's physically present in storage but missing from the manifest — the zero-local fallback scan engages on a fresh device's first pull", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const listedEntry = await captureEntry({ audioBlob: null, transcript: { text: "Properly listed entry", confidence: 0.9, language: "en", engine: "webspeech" } });
    await syncNow();

    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;
    // Write a second entry's file directly to the adapter's storage
    // WITHOUT updating the manifest — simulates the exact real-backend
    // race this fix is for: entry upload succeeded, manifest write
    // failed. The orphan file is real, parseable data sitting in the
    // archive, but manifest.entries doesn't list it (no writeManifest()
    // call, no refreshManifest()).
    const orphan = newEntrySkeleton({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), gps: null, audio: null, source: "voice" });
    orphan.transcript = { text: "Physically present but not in the manifest", confidence: 0.9, language: "en", engine: "webspeech" };
    const { serializeEntry } = await import("../../src/core/tensor-log/entry-serializer");
    await adapter.writeFile(entryPath(orphan.timestamp, orphan.id), serializeEntry(orphan));
    // Deliberately no writeManifest() call / no refreshManifest() — the
    // orphan file exists in adapter.files but manifest.entries doesn't
    // mention it.

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const result = await syncNow();

    expect(await getEntry(listedEntry.id)).toBeDefined();

    // Previously (the bug this drill found): pullRemoteEntries() only
    // iterated manifest.entries, so the orphan was permanently invisible
    // to every device's pull until some device's push happened to
    // reference it — and refreshManifest()'s union-with-remote fix
    // didn't help, because device B has nothing local to push on its
    // first sync. Now: pullRemoteEntries() snapshots local entry count
    // at the top, sees zero (the cold-start signature), and runs a
    // listFiles(STORAGE_ROOT) fallback scan after the manifest pass to
    // pick up exactly this kind of orphan. The orphan is recovered
    // alongside the manifest-listed entry on the very first cold pull.
    expect(await getEntry(orphan.id)).toBeDefined();
    const pulledOrphan = await getEntry(orphan.id);
    expect(pulledOrphan!.transcript?.text).toBe("Physically present but not in the manifest");

    // The orphan counts toward pulled — one manifest entry + one orphan
    // scanned = two entries recovered on a fresh device's first sync.
    expect(result.pulled).toBe(2);
  });
});

describe("restore drill, fix cost-scope: a normal sync on a device that already has local entries does NOT trigger the fallback scan", () => {
  it("does not call listFiles(STORAGE_ROOT) when the device already has local entries (the scan is scoped to zero-local cold-start only)", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // Device A: populate and sync some entries to a shared archive.
    await captureEntry({ audioBlob: null, transcript: { text: "First entry", confidence: 0.9, language: "en", engine: "webspeech" } });
    await captureEntry({ audioBlob: null, transcript: { text: "Second entry", confidence: 0.9, language: "en", engine: "webspeech" } });
    await syncNow();

    // A normal day-to-day sync on a device that already has local
    // entries — NOT the cold-start recovery case the fallback scan is
    // scoped to. To keep the spy observing only the second sync, attach
    // it AFTER the first sync completes; device A's local state stays
    // in place (no wipe), which is exactly what "a device with local
    // entries" means in production on every reconnect after the first.
    const adapter = (await buildAdapter(LOCAL_ZIP_CONFIG)) as LocalZipAdapter;
    const listFilesSpy = vi.spyOn(adapter, "listFiles");

    await syncNow();

    // The fallback scan calls listFiles(STORAGE_ROOT) (== "DeckBoss").
    // It must NOT have been invoked here — the device has local entries
    // already, so refreshManifest()'s push-time union step covers the
    // multi-device-discovery case for free, and paying for a full
    // directory scan on every normal sync would be the exact "blind
    // always-scan default" the ROADMAP explicitly warns against. The
    // spy check is on the specific scan-triggering prefix, not on
    // listFiles() overall — verifyRemoteBlob() legitimately calls
    // listFiles() for audio paths during the upload path, and that
    // unrelated call site must not be conflated with the scan.
    const coldStartScanCalls = listFilesSpy.mock.calls.filter(([prefix]) => prefix === "DeckBoss");
    expect(coldStartScanCalls).toHaveLength(0);

    // Sanity: the sync itself still works and the entries survived.
    const local = await allEntries();
    expect(local.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// 6. AUDIO REHYDRATION: a fresh device can fetch archived audio on demand
//    when an entry with audio is actually accessed.
// ===========================================================================

describe("restore drill: audio rehydration on demand", () => {
  it("rehydrates a verified archived audio blob into local IndexedDB the first time it is accessed on a fresh device", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    // ---- DEVICE A: capture an entry with audio and sync it to the archive.
    const entry = await captureEntry({
      audioBlob: audioBlobFor("haul one audio bytes"),
      transcript: { text: "Set twelve pots starboard rail", confidence: 0.9, language: "en", engine: "webspeech" },
    });
    const originalBlob = await getAudioBlob(entry.id);
    expect(originalBlob).toBeDefined();

    const syncResultA = await syncNow();
    expect(syncResultA.pushed).toBeGreaterThan(0);
    expect(await getAudioVerifiedAt(entry.id)).not.toBeNull();

    const sharedAdapter = await buildAdapter(LOCAL_ZIP_CONFIG);
    if (!sharedAdapter) throw new Error("setup bug: no adapter");

    // ---- DEVICE B: fresh install, same archive. Text recovers; audio does
    // not come back on its own (this is the gap being fixed).
    await wipeLocalDeviceState();
    expect(await allEntries()).toHaveLength(0);

    await setConfig(LOCAL_ZIP_CONFIG);
    const deviceBAdapter = await buildAdapter(LOCAL_ZIP_CONFIG);
    expect(deviceBAdapter).toBe(sharedAdapter);

    const syncResultB = await syncNow();
    expect(syncResultB.pulled).toBe(1);

    const pulled = await getEntry(entry.id);
    expect(pulled).toBeDefined();
    expect(pulled!.audio).not.toBeNull();

    // Before rehydration: the local audio store is empty, exactly like the
    // existing restore-drill assertion documented.
    expect(await getAudioBlob(entry.id)).toBeUndefined();

    // RED→GREEN: this is the new code path. Before the fix there was no
    // remote fallback anywhere in src/; after the fix, accessing the audio
    // fetches it from the archive, caches it locally, and returns it.
    const rehydrated = await rehydrateAudioForEntry(entry.id);
    expect(rehydrated).toBeDefined();
    expect(rehydrated!.size).toBe(originalBlob!.size);

    // The blob is now cached locally, so a second access is a local read.
    const cached = await getAudioBlob(entry.id);
    expect(cached).toBeDefined();
    expect(cached!.size).toBe(originalBlob!.size);

    // Rehydration is idempotent: calling it again returns the cached blob
    // without touching the network.
    const secondRehydration = await rehydrateAudioForEntry(entry.id);
    expect(secondRehydration).toBeDefined();
    expect(secondRehydration!.size).toBe(originalBlob!.size);
  });

  it("returns undefined for entries that never had audio", async () => {
    clearAdapterCache();
    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);

    const entry = await captureEntry({
      audioBlob: null,
      transcript: { text: "No audio here", confidence: 0.9, language: "en", engine: "webspeech" },
    });
    await syncNow();

    await wipeLocalDeviceState();
    await setConfig(LOCAL_ZIP_CONFIG);
    await syncNow();

    const rehydrated = await rehydrateAudioForEntry(entry.id);
    expect(rehydrated).toBeUndefined();
  });
});
