import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { OverviewPage } from '../features/overview/OverviewPage.js';
import { SettingsPage } from '../features/settings/SettingsPage.js';
import { deleteSession, getSession } from './api.js';
import { Login } from './Login.js';
import { Shell } from './Shell.js';

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
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<OverviewPage />} />
      </Route>
    </Routes>
  </BrowserRouter>;
}

function DemoBanner({ active }: { active: boolean }) {
  return active ? <div className="demo-banner" role="status">Fixture demo mode · loopback access only</div> : null;
}
