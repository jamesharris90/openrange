import { useState, useEffect, useMemo } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { authFetch } from '../../utils/api';
import DailyReviewPanel from '../trades/DailyReviewPanel';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarTab({ scope }) {
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth()); // 0-indexed
  const [calData, setCalData] = useState([]);
  const [selectedDate, setSelectedDate] = useState(null);

  const monthStr = `${year}-${String(month + 1).padStart(2, '0')}`;

  useEffect(() => {
    authFetch(`/api/reviews/calendar?scope=${scope}&month=${monthStr}`)
      .then(r => r.json())
      .then(data => setCalData(Array.isArray(data) ? data : []))
      .catch(() => setCalData([]));
  }, [scope, monthStr]);

  const reviewMap = useMemo(() => {
    const map = {};
    for (const r of calData) {
      const day = r.review_date?.slice(0, 10);
      if (day) map[day] = r;
    }
    return map;
  }, [calData]);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };

  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  // Build calendar grid
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const weeks = [];
  let week = new Array(firstDay).fill(null);

  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null);
    weeks.push(week);
  }

  const getDateStr = (day) => `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const getDayClass = (day) => {
    if (!day) return 'calendar-day empty';
    const dateStr = getDateStr(day);
    const review = reviewMap[dateStr];
    if (!review) return 'calendar-day';
    if (review.review_status === 'reviewed') return 'calendar-day reviewed';
    if (review.review_status === 'partial') return 'calendar-day partial';
    return 'calendar-day has-data';
  };

  return (
    <div>
      <div className="calendar-nav">
        <button className="btn-secondary btn-sm" onClick={prevMonth}><ChevronLeft size={16} /></button>
        <span className="calendar-month-label">
          {new Date(year, month).toLocaleString('default', { month: 'long', year: 'numeric' })}
        </span>
        <button className="btn-secondary btn-sm" onClick={nextMonth}><ChevronRight size={16} /></button>
      </div>

      <div className="calendar-grid">
        {DAY_NAMES.map(d => <div key={d} className="calendar-header">{d}</div>)}
        {weeks.flat().map((day, i) => {
          const dateStr = day ? getDateStr(day) : null;
          const review = dateStr ? reviewMap[dateStr] : null;

          return (
            <div key={i} className={getDayClass(day)} onClick={() => day && setSelectedDate(dateStr)}>
              {day && (
                <>
                  <span className="calendar-day-num">{day}</span>
                  {review && review.total_pnl != null && (
                    <span className={`calendar-pnl ${review.total_pnl >= 0 ? 'green' : 'red'}`}>
                      {review.total_pnl >= 0 ? '+' : ''}{(+review.total_pnl).toFixed(0)}
                    </span>
                  )}
                  {review && review.total_trades > 0 && (
                    <span className="calendar-trades">{review.total_trades}t</span>
                  )}
                </>
              )}
            </div>
          );
        })}
      </div>

      {selectedDate && (
        <div className="modal-overlay" onClick={() => setSelectedDate(null)}>
          <div className="modal-card modal-card--wide" onClick={e => e.stopPropagation()}>
            <DailyReviewPanel date={selectedDate} scope={scope} onClose={() => setSelectedDate(null)} />
          </div>
        </div>
      )}
    </div>
  );
}
