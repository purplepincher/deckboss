import { useEffect, useState } from "react";
import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import { useDeckBossStore } from "./state/store";
import { verifyStoreIntegrity } from "./core/storage/local-db";
import { requestPersistentStorage } from "./core/storage/persistence";
import { OfflineBanner } from "./ui/screens/OfflineBanner";
import { RecordScreen } from "./ui/screens/RecordScreen";
import { TimelineScreen } from "./ui/screens/TimelineScreen";
import { EntryDetailScreen } from "./ui/screens/EntryDetailScreen";
import { SettingsScreen } from "./ui/screens/SettingsScreen";

type BootState = { status: "checking" } | { status: "ok" } | { status: "failed"; stores: string[] };

/**
 * Blocks on a store-integrity check before rendering the app. This exists
 * because of a real shipped bug where three of four IndexedDB stores
 * silently never got created — the app "worked" (rendered, took taps) while
 * quietly failing every write. That failure mode is worse than an obvious
 * crash: a fisherman could record a season of notes into a black hole and
 * not find out until they went looking for one. Failing loudly here, once,
 * at launch, is cheap insurance against that repeating in some new form.
 */
export function App() {
  const [boot, setBoot] = useState<BootState>({ status: "checking" });

  useEffect(() => {
    // Fire-and-forget: a "no" here doesn't block boot (it's best-effort and
    // the browser gets to say no), but we want to have asked as early as
    // possible in the origin's lifetime.
    void requestPersistentStorage();
    void verifyStoreIntegrity().then((result) => {
      setBoot(result.ok ? { status: "ok" } : { status: "failed", stores: result.failedStores });
    });
  }, []);

  if (boot.status === "checking") return null;

  if (boot.status === "failed") {
    return (
      <div className="app-shell" style={{ padding: 24, justifyContent: "center", display: "flex" }}>
        <div>
          <h2 style={{ color: "var(--accent-text)" }}>DeckBoss can't start safely</h2>
          <p>
            This device's local storage ({boot.stores.join(", ")}) isn't responding correctly.
            To protect your existing entries from a partial write, the app is refusing to
            run rather than risk silently losing data.
          </p>
          <p>
            Try reloading the page. If this keeps happening, your entries may still be
            recoverable — check Settings → Export ZIP from a browser tab where the app
            last worked, or open an issue at{" "}
            <a href="https://github.com/purplepincher/deckboss/issues" style={{ color: "var(--accent-text)" }}>
              github.com/purplepincher/deckboss
            </a>
            .
          </p>
        </div>
      </div>
    );
  }

  return <AppShell />;
}

function AppShell() {
  const loadEntries = useDeckBossStore((s) => s.loadEntries);
  const loadConfig = useDeckBossStore((s) => s.loadConfig);

  useEffect(() => {
    void loadEntries();
    void loadConfig();
  }, [loadEntries, loadConfig]);

  return (
    <HashRouter>
      <div className="app-shell">
        <OfflineBanner />
        <div className="screen" style={{ padding: 0 }}>
          <Routes>
            <Route path="/" element={<RecordScreen />} />
            <Route path="/timeline" element={<div className="screen"><TimelineScreen /></div>} />
            <Route path="/entry/:id" element={<EntryDetailScreen />} />
            <Route path="/settings" element={<SettingsScreen />} />
          </Routes>
        </div>
        <nav className="bottom-nav">
          <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
            Record
          </NavLink>
          <NavLink to="/timeline" className={({ isActive }) => (isActive ? "active" : "")}>
            Log
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => (isActive ? "active" : "")}>
            Settings
          </NavLink>
        </nav>
      </div>
    </HashRouter>
  );
}
