'use client'

import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import type { CatalystEvent } from '@/lib/calendar-types'
import { TIER_CONFIG } from '@/lib/calendar-types'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface CalendarHeatmapProps {
  events: CatalystEvent[]
  onDayClick?: (date: Date, events: CatalystEvent[]) => void
}

function getMonthDays(year: number, month: number) {
  const firstDay = new Date(year, month, 1)
  const lastDay = new Date(year, month + 1, 0)
  const daysInMonth = lastDay.getDate()
  const startDayOfWeek = firstDay.getDay() || 7 // Convert Sunday (0) to 7
  
  const days: (Date | null)[] = []
  
  for (let i = 1; i < startDayOfWeek; i++) {
    days.push(null)
  }
  
  for (let i = 1; i <= daysInMonth; i++) {
    days.push(new Date(year, month, i))
  }
  
  return days
}

function calculateHeatIntensity(events: CatalystEvent[]): number {
  if (events.length === 0) return 0
  
  const weightedSum = events.reduce((sum, event) => {
    return sum + TIER_CONFIG[event.tier].weight
  }, 0)
  
  return Math.min(weightedSum / 4, 1)
}

// Density thresholds for data-driven legend
const DENSITY_THRESHOLDS = {
  none: { min: 0, max: 0, label: 'None (0)' },
  low: { min: 1, max: 2, label: 'Low (1-2)' },
  medium: { min: 3, max: 5, label: 'Medium (3-5)' },
  high: { min: 6, max: Infinity, label: 'High (6+)' },
}

function getDensityLevel(count: number): keyof typeof DENSITY_THRESHOLDS {
  if (count === 0) return 'none'
  if (count <= 2) return 'low'
  if (count <= 5) return 'medium'
  return 'high'
}

function DayCell({ 
  date, 
  events,
  isToday,
  onClick 
}: { 
  date: Date | null
  events: CatalystEvent[]
  isToday: boolean
  onClick?: () => void 
}) {
  if (!date) {
    return <div className="aspect-square" aria-hidden="true" />
  }
  
  const intensity = calculateHeatIntensity(events)
  const hasTier1 = events.some(e => e.tier === 1)
  const hasTier2 = events.some(e => e.tier === 2)
  const densityLevel = getDensityLevel(events.length)
  
  void densityLevel

  let bgColor = 'bg-secondary/30'
  if (intensity > 0) {
    if (hasTier1) {
      bgColor = intensity > 0.5 
        ? 'bg-[oklch(0.65_0.25_25/0.6)]' 
        : 'bg-[oklch(0.65_0.25_25/0.3)]'
    } else if (hasTier2) {
      bgColor = intensity > 0.5 
        ? 'bg-[oklch(0.7_0.18_55/0.5)]' 
        : 'bg-[oklch(0.7_0.18_55/0.25)]'
    } else {
      bgColor = intensity > 0.5 
        ? 'bg-[oklch(0.8_0.15_90/0.4)]' 
        : 'bg-[oklch(0.8_0.15_90/0.2)]'
    }
  }
  
  const cell = (
    <button
      onClick={onClick}
      className={cn(
        'aspect-square rounded-md flex flex-col items-center justify-center transition-all',
        'hover:ring-1 hover:ring-primary/50 cursor-pointer',
        'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
        bgColor,
        isToday && 'ring-2 ring-primary',
      )}
      aria-label={`${date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}: ${events.length} event${events.length !== 1 ? 's' : ''}`}
    >
      <span className={cn(
        'text-sm font-mono',
        isToday ? 'text-primary font-semibold' : 'text-foreground',
        events.length === 0 && 'text-muted-foreground/50'
      )}>
        {date.getDate()}
      </span>
      {/* Number badge for accessibility (non-color indicator) */}
      {events.length > 0 && (
        <span className="text-[10px] text-muted-foreground font-mono" aria-hidden="true">
          {events.length}
        </span>
      )}
    </button>
  )
  
  if (events.length === 0) {
    return cell
  }
  
  return (
    <TooltipProvider delayDuration={100}>
      <Tooltip>
        <TooltipTrigger asChild>
          {cell}
        </TooltipTrigger>
        <TooltipContent 
          side="top" 
          className="max-w-[300px] border border-border bg-panel text-foreground"
        >
          <div className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground">
              {date.toLocaleDateString('en-GB', { 
                weekday: 'long',
                day: 'numeric', 
                month: 'long' 
              })}
            </div>
            <div className="space-y-1.5">
              {events.slice(0, 5).map(event => (
                <div key={event.id} className="flex items-center gap-2 text-xs">
                  <div className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    event.tier === 1 && 'bg-[oklch(0.65_0.25_25)]',
                    event.tier === 2 && 'bg-[oklch(0.7_0.18_55)]',
                    event.tier === 3 && 'bg-[oklch(0.8_0.15_90)]',
                    event.tier === 4 && 'bg-[oklch(0.7_0.18_145)]',
                  )} aria-hidden="true" />
                  <span className="font-mono font-medium">{event.symbol}</span>
                  <span className="text-[10px] text-muted-foreground/60">T{event.tier}</span>
                  <span className="text-muted-foreground truncate">{event.title}</span>
                </div>
              ))}
              {events.length > 5 && (
                <div className="text-xs text-muted-foreground">
                  +{events.length - 5} more
                </div>
              )}
            </div>
          </div>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function CalendarHeatmap({ events, onDayClick }: CalendarHeatmapProps) {
  const today = new Date()
  const [currentMonth, setCurrentMonth] = useState(today.getMonth())
  const [currentYear, setCurrentYear] = useState(today.getFullYear())
  
  const { days, monthLabel, monthEventCount } = useMemo(() => {
    const daysArray = getMonthDays(currentYear, currentMonth)
    const label = new Date(currentYear, currentMonth).toLocaleDateString('en-GB', {
      month: 'long',
      year: 'numeric',
    })
    
    // Count events in this month
    const count = events.filter(e => {
      const d = new Date(e.date)
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear
    }).length
    
    return { days: daysArray, monthLabel: label, monthEventCount: count }
  }, [currentYear, currentMonth, events])
  
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CatalystEvent[]>()
    events.forEach(event => {
      const eventDate = new Date(event.date)
      const key = `${eventDate.getFullYear()}-${eventDate.getMonth()}-${eventDate.getDate()}`
      if (!map.has(key)) {
        map.set(key, [])
      }
      map.get(key)!.push(event)
    })
    return map
  }, [events])
  
  const getEventsForDate = (date: Date | null) => {
    if (!date) return []
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`
    return eventsByDate.get(key) || []
  }
  
  const goToPrevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(currentYear - 1)
    } else {
      setCurrentMonth(currentMonth - 1)
    }
  }
  
  const goToNextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(currentYear + 1)
    } else {
      setCurrentMonth(currentMonth + 1)
    }
  }
  
  const goToToday = () => {
    setCurrentMonth(today.getMonth())
    setCurrentYear(today.getFullYear())
  }
  
  const weekDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  
  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">Calendar Density</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={goToPrevMonth}
            className={cn(
              'p-1.5 rounded hover:bg-secondary transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950'
            )}
            aria-label="Previous month"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={goToToday}
            className={cn(
              'text-xs text-muted-foreground font-mono min-w-[120px] text-center hover:text-foreground transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 rounded'
            )}
          >
            {monthLabel}
          </button>
          <button
            onClick={goToNextMonth}
            className={cn(
              'p-1.5 rounded hover:bg-secondary transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950'
            )}
            aria-label="Next month"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>
      
      {/* Empty state for month with no events */}
      {monthEventCount === 0 && (
        <div className="text-center py-6 text-muted-foreground">
          <p className="text-sm">No scheduled catalysts this month</p>
        </div>
      )}
      
      {/* Calendar Grid */}
      <div className="space-y-2">
        {/* Weekday Headers */}
        <div className="grid grid-cols-7 gap-1" role="row">
          {weekDays.map(day => (
            <div 
              key={day}
              role="columnheader"
              className="text-center text-xs text-muted-foreground font-mono py-1"
            >
              {day}
            </div>
          ))}
        </div>
        
        {/* Day Cells */}
        <div className="grid grid-cols-7 gap-1" role="grid" aria-label="Calendar">
          {days.map((date, i) => {
            const dayEvents = getEventsForDate(date)
            const isToday = date?.toDateString() === today.toDateString()
            return (
              <DayCell
                key={i}
                date={date}
                events={dayEvents}
                isToday={isToday}
                onClick={() => date && onDayClick?.(date, dayEvents)}
              />
            )
          })}
        </div>
      </div>
      
      {/* Data-driven Legend */}
      <div className="flex flex-wrap items-center gap-4 pt-2 border-t border-border text-xs text-muted-foreground">
        <span>Intensity:</span>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-secondary/30" aria-hidden="true" />
          <span>{DENSITY_THRESHOLDS.none.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-[oklch(0.8_0.15_90/0.3)]" aria-hidden="true" />
          <span>{DENSITY_THRESHOLDS.low.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-[oklch(0.7_0.18_55/0.4)]" aria-hidden="true" />
          <span>{DENSITY_THRESHOLDS.medium.label}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-4 h-4 rounded bg-[oklch(0.65_0.25_25/0.6)]" aria-hidden="true" />
          <span>{DENSITY_THRESHOLDS.high.label}</span>
        </div>
      </div>
    </div>
  )
}
