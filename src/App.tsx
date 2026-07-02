import { useEffect } from "react";
import { HashRouter, Routes, Route, NavLink } from "react-router-dom";
import { useDeckBossStore } from "./state/store";
import { OfflineBanner } from "./ui/screens/OfflineBanner";
import { RecordScreen } from "./ui/screens/RecordScreen";
import { TimelineScreen } from "./ui/screens/TimelineScreen";
import { EntryDetailScreen } from "./ui/screens/EntryDetailScreen";
import { SettingsScreen } from "./ui/screens/SettingsScreen";

export function App() {
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
