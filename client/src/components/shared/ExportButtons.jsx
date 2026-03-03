import React, { useState } from 'react';
import { Download, Copy, Check } from 'lucide-react';

function escapeCsv(val) {
  if (val == null) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildDelimited(data, columns, delimiter) {
  const header = columns.map(c => c.label).join(delimiter);
  const rows = data.map(row =>
    columns.map(c => {
      const val = typeof c.accessor === 'function' ? c.accessor(row) : row[c.key];
      return delimiter === ',' ? escapeCsv(val) : String(val ?? '');
    }).join(delimiter)
  );
  return [header, ...rows].join('\n');
}

function downloadBlob(content, mimeType, filename) {
  const blob = new Blob([content], { type: `${mimeType};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ExportButtons({ data, columns, filename = 'export' }) {
  const [copied, setCopied] = useState(false);

  if (!data || !data.length) return null;

  function handleCSV() {
    const content = buildDelimited(data, columns, ',');
    downloadBlob(content, 'text/csv', `${filename}.csv`);
  }

  function handleTSV() {
    const content = buildDelimited(data, columns, '\t');
    downloadBlob(content, 'text/plain', `${filename}.txt`);
  }

  async function handleCopy() {
    const content = buildDelimited(data, columns, '\t');
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const ta = document.createElement('textarea');
      ta.value = content;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <div className="export-bar">
      <button className="btn-secondary btn-sm" onClick={handleCSV} title="Download CSV">
        <Download size={14} /> CSV
      </button>
      <button className="btn-secondary btn-sm" onClick={handleTSV} title="Download tab-delimited text">
        <Download size={14} /> TSV
      </button>
      <button className="btn-secondary btn-sm" onClick={handleCopy} title="Copy to clipboard">
        {copied ? <><Check size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
      </button>
    </div>
  );
}
