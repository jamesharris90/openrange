import { useEffect, useMemo, useState } from 'react';
import { apiClient } from '../../api/apiClient';

function statusColor(status) {
  if (status === 'ok') return 'green';
  if (status === 'warning') return 'orange';
  return 'red';
}

function StatusDot({ label, status }) {
  const color = statusColor(String(status || 'unknown').toLowerCase());
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
      <span style={{ width: 10, height: 10, borderRadius: '50%', background: color, display: 'inline-block' }} />
      <strong>{label}:</strong>
      <span>{String(status || 'unknown')}</span>
    </div>
  );
}

export default function SystemDiagnostics() {
  const [health, setHealth] = useState(null);
  const [uiErrors, setUiErrors] = useState([]);
  const [emailHealth, setEmailHealth] = useState(null);
  const [schemaHealth, setSchemaHealth] = useState(null);

  useEffect(() => {
    let active = true;

    async function load() {
      const [platform, ui, email, schema] = await Promise.all([
        apiClient('/api/system/platform-health'),
        apiClient('/api/system/ui-error-log'),
        apiClient('/api/system/email-health'),
        apiClient('/api/system/schema-health'),
      ]);

      if (!active) return;
      setHealth(platform || null);
      setUiErrors(ui || []);
      setEmailHealth(email || null);
      setSchemaHealth(schema || null);
    }

    load();
    const i = setInterval(load, 5000);
    return () => {
      active = false;
      clearInterval(i);
    };
  }, []);

  const sections = useMemo(() => {
    if (!health) return [];
    const providers = health.providers || {};

    return [
      { title: 'SYSTEM STATUS', value: health.scheduler },
      { title: 'PIPELINE', value: health.pipeline },
      { title: 'PROVIDERS', value: Object.keys(providers).length ? 'ok' : 'warning' },
      { title: 'ENGINES', value: Object.keys(health.engines || {}).length ? 'ok' : 'warning' },
      { title: 'EVENT BUS', value: (health.eventBus?.events_per_minute || 0) > 0 ? 'ok' : 'warning' },
      { title: 'TRACE SYSTEM', value: (health.traces?.active || 0) >= 0 ? 'ok' : 'warning' },
      { title: 'CACHE', value: health.cache || 'unknown' },
      { title: 'EMAIL', value: emailHealth?.smtp_status || health.email || 'unknown' },
      { title: 'UI ERRORS', value: uiErrors.length ? 'warning' : 'ok' },
      {
        title: 'DATA FRESHNESS',
        value: health.last_ingestion_time && (Date.now() - new Date(health.last_ingestion_time).getTime()) <= 5 * 60 * 1000
          ? 'ok'
          : 'warning',
      },
    ];
  }, [health, uiErrors, emailHealth]);

  if (!health) return <div style={{ padding: 20 }}>Loading diagnostics...</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>Platform Diagnostics</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        {sections.map((s) => (
          <div key={s.title} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
            <StatusDot label={s.title} status={s.value} />
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Provider Latency</h3>
        <pre>{JSON.stringify(health.providers || {}, null, 2)}</pre>
      </div>

      <div style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>DATABASE HEALTH</h3>
        <StatusDot label="SCHEMA STATUS" status={schemaHealth?.schemaStatus || 'unknown'} />
        <StatusDot label="PIPELINE STATUS" status={health?.pipeline || 'unknown'} />
        <div style={{ marginTop: 10 }}>
          <strong>Table Row Counts</strong>
          <pre>{JSON.stringify(schemaHealth?.rowCounts || {}, null, 2)}</pre>
        </div>
        <div style={{ marginTop: 10 }}>
          <strong>Schema Drift</strong>
          <pre>
            {JSON.stringify({
              missingTables: schemaHealth?.missingTables || [],
              missingColumns: schemaHealth?.missingColumns || {},
              unexpectedTables: schemaHealth?.unexpectedTables || [],
              unexpectedColumns: schemaHealth?.unexpectedColumns || {},
            }, null, 2)}
          </pre>
        </div>
        <div style={{ marginTop: 10 }}>
          <strong>Provider Latency Snapshot</strong>
          <pre>{JSON.stringify(health.providers || {}, null, 2)}</pre>
        </div>
      </div>

      <div style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>Email Health</h3>
        <pre>{JSON.stringify(emailHealth || {}, null, 2)}</pre>
      </div>

      <div style={{ marginTop: 16, border: '1px solid #ddd', borderRadius: 8, padding: 12 }}>
        <h3>UI Error Feed</h3>
        <pre>{JSON.stringify(uiErrors, null, 2)}</pre>
      </div>
    </div>
  );
}
