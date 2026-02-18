import { useEffect } from 'react';
import ResearchPanel from './ResearchPanel';

export default function ResearchModal({ symbol, onClose }) {
  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = ''; };
  }, []);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!symbol) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="research-modal" onClick={(e) => e.stopPropagation()}>
        <ResearchPanel symbol={symbol} onClose={onClose} />
      </div>
    </div>
  );
}
