import { useEffect } from 'react';
import { clearChartSession, saveChartSession } from '../../utils/chartSessionStorage';

function scheduleMidnightReset(onReset: () => void) {
  const now = new Date();
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  const ms = midnight.getTime() - now.getTime();

  const timeoutId = window.setTimeout(() => {
    onReset();
    clearChartSession();
  }, Math.max(ms, 0));

  return () => window.clearTimeout(timeoutId);
}

interface DrawingManagerProps {
  drawingObjects: Array<Record<string, unknown>>;
  onDrawingsChange: (next: Array<Record<string, unknown>>) => void;
}

export default function DrawingManager({ drawingObjects, onDrawingsChange }: DrawingManagerProps) {
  useEffect(() => {
    saveChartSession({ drawingObjects });
  }, [drawingObjects]);

  useEffect(() => scheduleMidnightReset(() => onDrawingsChange([])), [onDrawingsChange]);

  return null;
}
