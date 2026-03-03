import { useState } from 'react';
import ProfileSettingsTab from '../components/profile/ProfileSettingsTab';
import PerformanceTab from '../components/profile/PerformanceTab';

export default function ProfilePage() {
  const [tab, setTab] = useState('settings');

  return (
    <div className="page-container profile-page">
      <div className="profile-header">
        <h2>Account & Settings</h2>
        <div className="profile-tabs">
          <button className={`profile-tab${tab === 'settings' ? ' active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
          <button className={`profile-tab${tab === 'performance' ? ' active' : ''}`} onClick={() => setTab('performance')}>Performance</button>
        </div>
      </div>
      {tab === 'settings' ? <ProfileSettingsTab /> : <PerformanceTab />}
    </div>
  );
}
