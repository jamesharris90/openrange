import { useState, useCallback } from 'react';
import { PlusCircle, BookOpen, Upload } from 'lucide-react';
import TradeEntryPanel from '../components/trades/TradeEntryPanel';
import DailySummaryCard from '../components/trades/DailySummaryCard';
import DailyReviewPanel from '../components/trades/DailyReviewPanel';
import TradeUploadPanel from '../components/trades/TradeUploadPanel';
import { PageContainer, PageHeader } from '../components/layout/PagePrimitives';

export default function PostMarketPage() {
  const [showTradeEntry, setShowTradeEntry] = useState(true);
  const [showReview, setShowReview] = useState(true);
  const [showUpload, setShowUpload] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const today = new Date().toISOString().slice(0, 10);
  const refresh = useCallback(() => setRefreshKey(k => k + 1), []);

  return (
    <PageContainer className="space-y-3">
      <div className="panel">
        <PageHeader
          title="Post-Market"
          subtitle="Review your day, log trades, and prepare for tomorrow."
          actions={(
            <>
            <button className={`btn-primary btn-sm${showTradeEntry ? ' active' : ''}`} onClick={() => setShowTradeEntry(v => !v)}>
              <PlusCircle size={16} /> Log Trade
            </button>
            <button className={`btn-secondary btn-sm${showUpload ? ' active' : ''}`} onClick={() => setShowUpload(v => !v)}>
              <Upload size={16} /> Import PDF
            </button>
            <button className={`btn-secondary btn-sm${showReview ? ' active' : ''}`} onClick={() => setShowReview(v => !v)}>
              <BookOpen size={16} /> Daily Review
            </button>
            </>
          )}
        />
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
    </PageContainer>
  );
}
