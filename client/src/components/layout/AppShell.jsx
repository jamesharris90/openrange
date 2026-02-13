import Sidebar from './Sidebar';
import TopBar from './TopBar';
import MarketClockBar from './MarketClockBar';

export default function AppShell({ children }) {
  return (
    <div className="app-container">
      <Sidebar />
      <div className="main-content">
        <MarketClockBar />
        <TopBar />
        <div style={{ padding: 'var(--spacing-lg)', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
