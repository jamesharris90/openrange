import { ChevronLeft, ChevronRight } from 'lucide-react';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function WeekSelector({ days, selectedDay, onSelectDay, onPrev, onNext, onToday, todayKey }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* Week nav arrows + "This Week" */}
      <div className="flex items-center gap-1">
        <button
          onClick={onPrev}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Previous week"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          onClick={onToday}
          className="h-8 px-3 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[11px] font-semibold text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors whitespace-nowrap"
        >
          This Week
        </button>
        <button
          onClick={onNext}
          className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors"
          title="Next week"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day pills */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {days.map((day, i) => {
          const isSelected = selectedDay === day.key;
          const isToday = todayKey ? day.key === todayKey : day.key === new Date().toISOString().split('T')[0];
          const name = day.dayName || DAY_NAMES[i] || 'Day';
          const num = day.dayNum != null ? day.dayNum : (day.date ? day.date.getDate() : '');

          return (
            <button
              key={day.key}
              onClick={() => onSelectDay(isSelected ? null : day.key)}
              className={`
                relative flex flex-col items-center px-3 py-1.5 rounded-xl border text-center
                transition-all duration-150 min-w-[52px]
                ${isSelected
                  ? 'bg-[var(--accent-blue)] border-[var(--accent-blue)] text-white shadow-sm'
                  : isToday
                    ? 'border-[var(--accent-blue)] bg-transparent text-[var(--accent-blue)] hover:bg-[var(--accent-blue)]/10'
                    : 'border-[var(--border-color)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                }
              `}
            >
              <span className="text-[10px] font-semibold uppercase tracking-wide leading-none mb-0.5">
                {name}
              </span>
              <span className="text-[15px] font-bold leading-none tabular-nums">
                {num}
              </span>
              {day.count > 0 && (
                <span className={`
                  absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[9px] font-bold
                  flex items-center justify-center leading-none
                  ${isSelected ? 'bg-white text-[var(--accent-blue)]' : 'bg-[var(--accent-blue)] text-white'}
                `}>
                  {day.count}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
