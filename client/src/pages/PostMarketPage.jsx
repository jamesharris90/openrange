import { useState, useCallback } from 'react';
import { PlusCircle, BookOpen, Upload } from 'lucide-react';
import TradeEntryPanel from '../components/trades/TradeEntryPanel';
import DailySummaryCard from '../components/trades/DailySummaryCard';
import DailyReviewPanel from '../components/trades/DailyReviewPanel';
import TradeUploadPanel from '../components/trades/TradeUploadPanel';

export default function PostMarketPage() {
  const [showTradeEntry, setShowTradeEntry] = useState(true);
  const [showReview, setShowReview] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const today = new Date().toISOString().slice(0, 10);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <div className="page-container">
      <div className="panel" style={{ marginBottom: 12 }}>
        <div className="page-header-row">
          <div>
            <h2 style={{ margin: 0 }}>Post-Market</h2>
            <p className="muted" style={{ marginTop: 4 }}>Review your day, log trades, and prepare for tomorrow.</p>
          </div>
          <div className="page-actions">
            <button className={`btn-primary btn-sm${showTradeEntry ? ' active' : ''}`} onClick={() => setShowTradeEntry(v => !v)}>
              <PlusCircle size={16} /> Log Trade
            </button>
            <button className={`btn-secondary btn-sm${showUpload ? ' active' : ''}`} onClick={() => setShowUpload(v => !v)}>
              <Upload size={16} /> Import PDF
            </button>
            <button className={`btn-secondary btn-sm${showReview ? ' active' : ''}`} onClick={() => setShowReview(v => !v)}>
              <BookOpen size={16} /> Daily Review
            </button>
          </div>
        </div>
      </div>

      {showTradeEntry && (
        <TradeEntryPanel onSaved={refresh} onClose={() => setShowTradeEntry(false)} />
      )}

      {showUpload && (
        <TradeUploadPanel onSaved={refresh} onClose={() => setShowUpload(false)} />
      )}

      <DailySummaryCard refreshKey={refreshKey} />

      {showReview && (
        <DailyReviewPanel date={today} onClose={() => setShowReview(false)} />
      )}
    </div>
  );
}
