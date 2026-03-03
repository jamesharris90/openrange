import React, { useCallback, useState } from 'react';
import html2canvas from 'html2canvas';
import { authFetch } from '../../utils/api';
import type { CockpitMetadata } from '../../hooks/useCockpitData';

type GPTCoachPanelProps = {
  metadata: CockpitMetadata;
};

export default function GPTCoachPanel({ metadata }: GPTCoachPanelProps) {
  const [status, setStatus] = useState<string>('Ready');
  const [resultPreview, setResultPreview] = useState<string>('No analysis yet.');

  const handleScreenshot = useCallback(async () => {
    try {
      setStatus('Capturing…');
      const root = document.querySelector('#cockpit-root') as HTMLElement | null;
      if (!root) throw new Error('Cockpit root not found');

      const canvas = await html2canvas(root, { backgroundColor: '#0f172a', scale: 2 });
      const screenshotBase64 = canvas.toDataURL('image/png');

      setStatus('Uploading…');
      const response = await authFetch('/api/gpt/analyse-cockpit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ screenshotBase64, metadata }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.detail || payload?.error || 'Request failed');
      }

      setStatus('Submitted');
      setResultPreview(payload?.message || 'Submitted successfully');
    } catch (error) {
      setStatus('Failed');
      setResultPreview(error instanceof Error ? error.message : 'Unexpected error');
    }
  }, [metadata]);

  return (
    <div className="h-full rounded-lg border border-[var(--border-color)] bg-[var(--bg-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">GPT Coaching</div>
        <button type="button" onClick={handleScreenshot} className="rounded bg-[var(--accent-blue)] px-2 py-1 text-xs font-semibold text-white">Screenshot</button>
      </div>
      <div className="mb-2 rounded bg-[var(--bg-input)] px-2 py-1 text-xs text-[var(--text-secondary)]">Status: {status}</div>
      <div className="h-[calc(100%-56px)] overflow-auto rounded border border-[var(--border-color)] bg-[var(--bg-input)] p-2 text-xs text-[var(--text-secondary)]">
        {resultPreview}
      </div>
    </div>
  );
}
