import { Activity, Boxes, Clapperboard, Database, Download, LayoutDashboard, ListTree, LogOut, MonitorCog, Network, Settings } from 'lucide-react';
import { NavLink, Outlet } from 'react-router-dom';

export function Shell({ demoMode, onLogout }: { demoMode: boolean; onLogout: () => Promise<void> }) {
  return (
    <div className="app-shell">
      {demoMode ? <div className="demo-banner" role="status">Fixture demo mode · loopback access only</div> : null}
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark" aria-hidden="true"><Activity size={18} /></span><span>LabDeck</span></div>
        <nav aria-label="Primary navigation">
          <NavLink to="/" end><LayoutDashboard aria-hidden="true" size={17} /><span>Overview</span></NavLink>
          <NavLink to="/system"><MonitorCog aria-hidden="true" size={17} /><span>System</span></NavLink>
          <NavLink to="/storage"><Database aria-hidden="true" size={17} /><span>Storage</span></NavLink>
          <NavLink to="/media"><Clapperboard aria-hidden="true" size={17} /><span>Media</span></NavLink>
          <NavLink to="/downloads"><Download aria-hidden="true" size={17} /><span>Downloads</span></NavLink>
          <NavLink to="/containers"><Boxes aria-hidden="true" size={17} /><span>Containers</span></NavLink>
          <NavLink to="/network"><Network aria-hidden="true" size={17} /><span>Network</span></NavLink>
          <NavLink to="/events"><ListTree aria-hidden="true" size={17} /><span>Events</span></NavLink>
          <NavLink to="/settings"><Settings aria-hidden="true" size={17} /><span>Settings</span></NavLink>
        </nav>
        <button className="quiet-button" type="button" onClick={() => { void onLogout(); }}><LogOut aria-hidden="true" size={16} />Sign out</button>
      </aside>
      <div className="content"><Outlet /></div>
    </div>
  );
}
