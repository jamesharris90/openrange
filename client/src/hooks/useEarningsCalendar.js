import { useState, useMemo, useEffect } from 'react';
import useApi from './useApi';
import { getMondayInZone, formatDateUtc, addDaysInUtc, formatDateInZone } from '../utils/formatters';

export default function useEarningsCalendar() {
  const [timeZone, setTimeZone] = useState('America/New_York');
  const [weekStart, setWeekStart] = useState(() => getMondayInZone(new Date(), 'America/New_York'));
  const [selectedDay, setSelectedDay] = useState(null);

  useEffect(() => {
    setWeekStart(getMondayInZone(new Date(), timeZone));
    setSelectedDay(null);
  }, [timeZone]);

  const from = formatDateUtc(weekStart);
  const friday = addDaysInUtc(weekStart, 4);
  const to = formatDateUtc(friday);

  const todayKey = formatDateInZone(new Date(), timeZone);

  const { data, loading, error } = useApi(`/api/earnings/calendar?from=${from}&to=${to}`);

  const earnings = data?.earnings || [];

  // Day counts for badges
  const dayCounts = useMemo(() => {
    const counts = {};
    for (let i = 0; i < 5; i++) {
      const d = addDaysInUtc(weekStart, i);
      const key = formatDateUtc(d);
      counts[key] = earnings.filter(e => e.date === key).length;
    }
    return counts;
  }, [earnings, weekStart]);

  // Get days array
  const days = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 5; i++) {
      const d = addDaysInUtc(weekStart, i);
      const key = formatDateUtc(d);
      const zoned = formatDateInZone(d, timeZone);
      const dayNum = Number(zoned.split('-')[2]);
      const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone }).format(d);
      arr.push({ date: d, key, count: dayCounts[key] || 0, dayNum, dayName });
    }
    return arr;
  }, [weekStart, dayCounts, timeZone]);

  // Filtered by selected day
  const filtered = useMemo(() => {
    if (!selectedDay) return earnings;
    return earnings.filter(e => e.date === selectedDay);
  }, [earnings, selectedDay]);

  const prevWeek = () => {
    setWeekStart(addDaysInUtc(weekStart, -7));
    setSelectedDay(null);
  };

  const nextWeek = () => {
    setWeekStart(addDaysInUtc(weekStart, 7));
    setSelectedDay(null);
  };

  const thisWeek = () => {
    setWeekStart(getMondayInZone(new Date(), timeZone));
    setSelectedDay(null);
  };

  return {
    earnings: filtered,
    allEarnings: earnings,
    days,
    selectedDay,
    setSelectedDay,
    weekStart,
    from,
    to,
    timeZone,
    setTimeZone,
    todayKey,
    loading,
    error,
    prevWeek,
    nextWeek,
    thisWeek,
  };
}
