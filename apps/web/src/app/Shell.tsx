import { Activity, LayoutDashboard, LogOut, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

export function Shell({ demoMode, onLogout }: { demoMode: boolean; onLogout: () => Promise<void> }) {
  return (
    <div className="app-shell">
      {demoMode ? <div className="demo-banner" role="status">Fixture demo mode · loopback access only</div> : null}
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><Activity size={18} /></span><span>LabDeck</span></div>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end><LayoutDashboard aria-hidden="true" size={17} />Overview</NavLink>
          <NavLink to="/settings"><Settings aria-hidden="true" size={17} />Settings</NavLink>
        </nav>
        <button className="quiet-button" type="button" onClick={() => { void onLogout(); }}><LogOut aria-hidden="true" size={16} />Sign out</button>
      </aside>
      <div className="content"><Outlet /></div>
    </div>
  );
}
