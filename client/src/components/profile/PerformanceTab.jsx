import { useState } from 'react';
import JournalTab from './JournalTab';
import AnalyticsTab from './AnalyticsTab';
import CalendarTab from './CalendarTab';

const SUB_TABS = [
  { key: 'journal', label: 'Journal' },
  { key: 'analytics', label: 'Analytics' },
  { key: 'calendar', label: 'Calendar' },
];

export default function PerformanceTab() {
  const [subTab, setSubTab] = useState('journal');
  const [scope, setScope] = useState('demo');

  return (
    <div className="performance-tab">
      <div className="performance-controls">
        <div className="performance-sub-tabs">
          {SUB_TABS.map(t => (
            <button key={t.key} className={`profile-tab${subTab === t.key ? ' active' : ''}`} onClick={() => setSubTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="scope-toggle">
          <button className={`scope-btn${scope === 'user' ? ' active' : ''}`} onClick={() => setScope('user')}>Live</button>
          <button className={`scope-btn${scope === 'demo' ? ' active' : ''}`} onClick={() => setScope('demo')}>Demo</button>
        </div>
      </div>

      {subTab === 'journal' && <JournalTab scope={scope} />}
      {subTab === 'analytics' && <AnalyticsTab scope={scope} />}
      {subTab === 'calendar' && <CalendarTab scope={scope} />}
    </div>
  );
}
