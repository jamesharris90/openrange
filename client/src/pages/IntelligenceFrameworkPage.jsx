import { useEffect, useState } from 'react';
import Card from '../components/shared/Card';
import { apiJSON } from '../config/api';

export default function IntelligenceFrameworkPage() {
  const [scoring, setScoring] = useState(null);
  const [filters, setFilters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let canceled = false;

    async function load() {
      try {
        const [rulesPayload, filterPayload] = await Promise.all([
          apiJSON('/api/scoring-rules'),
          apiJSON('/api/filters'),
        ]);

        if (!canceled) {
          setScoring(rulesPayload || {});
          setFilters(Array.isArray(filterPayload?.filters) ? filterPayload.filters : []);
          setError('');
        }
      } catch (err) {
        if (!canceled) {
          setError(err?.message || 'Unable to load intelligence framework');
        }
      } finally {
        if (!canceled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      canceled = true;
    };
  }, []);

  return (
    <div className="page-container space-y-4">
      <div className="page-header">
        <h2 className="m-0">Intelligence Framework</h2>
        <p className="muted mt-1">Single source of truth for scoring and filter definitions.</p>
      </div>

      {loading && <Card>Loading framework configuration…</Card>}
      {!!error && <Card><div className="alert alert-warning">{error}</div></Card>}

      {!loading && !error && (
        <>
          <Card>
            <h3 className="mb-3 text-lg font-semibold">Strategy Scoring Rules</h3>
            <pre className="overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
              {JSON.stringify(scoring?.strategy || {}, null, 2)}
            </pre>
          </Card>

          <Card>
            <h3 className="mb-3 text-lg font-semibold">Grading System</h3>
            <pre className="overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
              {JSON.stringify(scoring?.grading || {}, null, 2)}
            </pre>
          </Card>

          <Card>
            <h3 className="mb-3 text-lg font-semibold">Catalyst Scoring</h3>
            <pre className="overflow-x-auto rounded border border-gray-200 bg-gray-50 p-3 text-xs dark:border-gray-700 dark:bg-gray-900">
              {JSON.stringify(scoring?.catalyst_scores || {}, null, 2)}
            </pre>
          </Card>

          <Card>
            <h3 className="mb-3 text-lg font-semibold">Filter Registry</h3>
            <ul className="list-disc pl-5 text-sm text-gray-700 dark:text-gray-300">
              {filters.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}
