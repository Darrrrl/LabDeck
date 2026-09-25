import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { OverviewPage } from '../features/overview/OverviewPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { SystemPage } from '../features/system/SystemPage.js';
import { StoragePage } from '../features/storage/StoragePage.js';
import { EventsPage } from '../features/events/EventsPage.js';
import { MediaPage } from '../features/media/MediaPage.js';
import { DownloadsPage } from '../features/downloads/DownloadsPage.js';
import { ContainersPage } from '../features/containers/ContainersPage.js';
import { NetworkPage } from '../features/network/NetworkPage.js';
import { deleteSession, getSession } from './api.js';
import { Login } from './Login.js';
import { Shell } from './Shell.js';
import { WallboardPage } from '../features/wallboard/WallboardPage.js';

export function App() {
  const queryClient = useQueryClient();
  const session = useQuery({ queryKey: ['session'], queryFn: getSession, retry: false, staleTime: 0 });
  if (session.isPending) return <main className="boot-state"><p>Opening LabDeck…</p></main>;
  if (session.isError) return <main className="boot-state"><p role="alert">LabDeck is unavailable.</p></main>;
  if (!session.data.authenticated) return <><DemoBanner active={session.data.demoMode} /><Login csrfToken={session.data.csrfToken} onSuccess={async () => { await queryClient.invalidateQueries({ queryKey: ['session'] }); }} /></>;
  return <BrowserRouter>
    <a className="skip-link" href="#main-content">Skip to content</a>
    <Routes>
      <Route element={<Shell demoMode={session.data.demoMode} onLogout={async () => { await deleteSession(session.data.csrfToken); queryClient.clear(); }} />}>
        <Route index element={<OverviewPage />} />
        <Route path="wallboard" element={<WallboardPage />} />
        <Route path="system" element={<SystemPage />} />
        <Route path="storage" element={<StoragePage />} />
        <Route path="media" element={<MediaPage />} />
        <Route path="downloads" element={<DownloadsPage />} />
        <Route path="containers" element={<ContainersPage />} />
        <Route path="network" element={<NetworkPage />} />
        <Route path="events" element={<EventsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<OverviewPage />} />
      </Route>
    </Routes>
  </BrowserRouter>;
}

function DemoBanner({ active }: { active: boolean }) {
  return active ? <div className="demo-banner" role="status">Fixture demo mode · loopback access only</div> : null;
}
