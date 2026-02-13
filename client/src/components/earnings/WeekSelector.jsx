import { ChevronLeft, ChevronRight } from 'lucide-react';

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

export default function WeekSelector({ days, selectedDay, onSelectDay, onPrev, onNext, onToday, todayKey }) {
  return (
    <div className="week-selector">
      <button className="week-selector__arrow" onClick={onPrev}><ChevronLeft size={20} /></button>
      <button className="week-selector__today" onClick={onToday}>This Week</button>
      <div className="week-selector__days">
        {days.map((day, i) => {
          const isSelected = selectedDay === day.key;
          const isToday = todayKey ? day.key === todayKey : day.key === new Date().toISOString().split('T')[0];
          const name = day.dayName || DAY_NAMES[i] || 'Day';
          const num = day.dayNum != null ? day.dayNum : (day.date ? day.date.getDate() : '');
          return (
            <button
              key={day.key}
              className={`week-selector__day${isSelected ? ' week-selector__day--selected' : ''}${isToday ? ' week-selector__day--today' : ''}`}
              onClick={() => onSelectDay(isSelected ? null : day.key)}
            >
              <span className="week-selector__day-name">{name}</span>
              <span className="week-selector__day-date">{num}</span>
              {day.count > 0 && (
                <span className="week-selector__day-count">{day.count}</span>
              )}
            </button>
          );
        })}
      </div>
      <button className="week-selector__arrow" onClick={onNext}><ChevronRight size={20} /></button>
    </div>
  );
}
