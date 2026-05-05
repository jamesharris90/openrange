'use client'

import { cn } from '@/lib/utils'
import type { CatalystEvent, EventTier } from '@/lib/calendar-types'
import { Zap, Flame, AlertTriangle } from 'lucide-react'

interface EventBadgeProps {
  event: CatalystEvent
  size?: 'sm' | 'md' | 'lg'
  showSymbol?: boolean
  onClick?: () => void
}

const tierStyles: Record<EventTier, string> = {
  1: 'bg-[oklch(0.65_0.25_25/0.15)] text-[oklch(0.75_0.22_25)] border-[oklch(0.65_0.25_25/0.3)]',
  2: 'bg-[oklch(0.7_0.18_55/0.15)] text-[oklch(0.8_0.16_55)] border-[oklch(0.7_0.18_55/0.3)]',
  3: 'bg-[oklch(0.8_0.15_90/0.12)] text-[oklch(0.85_0.13_90)] border-[oklch(0.8_0.15_90/0.25)]',
  4: 'bg-[oklch(0.7_0.18_145/0.12)] text-[oklch(0.75_0.16_145)] border-[oklch(0.7_0.18_145/0.25)]',
}

const tierDotStyles: Record<EventTier, string> = {
  1: 'bg-[oklch(0.65_0.25_25)]',
  2: 'bg-[oklch(0.7_0.18_55)]',
  3: 'bg-[oklch(0.8_0.15_90)]',
  4: 'bg-[oklch(0.7_0.18_145)]',
}

export function EventBadge({ event, size = 'md', showSymbol = true, onClick }: EventBadgeProps) {
  const hasUnusualMove = event.impliedMove && event.avgHistoricalMove && 
    event.impliedMove > event.avgHistoricalMove * 1.5
  const hasSmartMoney = event.smartMoneyConcentration && event.smartMoneyConcentration >= 3
  const isImminent = (new Date(event.date).getTime() - Date.now()) < 24 * 60 * 60 * 1000
  
  const sizeClasses = {
    sm: 'text-[10px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2 py-1 gap-1.5',
    lg: 'text-sm px-2.5 py-1.5 gap-2',
  }
  
  const dotSizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }
  
  const iconSizes = {
    sm: 10,
    md: 12,
    lg: 14,
  }

  return (
    <button
      onClick={onClick}
      className={cn(
        'inline-flex items-center rounded border font-mono transition-all',
        'hover:scale-105 hover:brightness-110 cursor-pointer',
        tierStyles[event.tier],
        sizeClasses[size],
      )}
    >
      <span className={cn('rounded-full shrink-0', tierDotStyles[event.tier], dotSizes[size])} />
      
      {showSymbol && (
        <span className="font-semibold tracking-tight">{event.symbol}</span>
      )}
      
      <span className="truncate max-w-[120px] opacity-80">
        {event.category.replace(/_/g, ' ')}
      </span>
      
      {event.time && (
        <span className="opacity-60 text-[0.9em]">{event.time}</span>
      )}
      
      <span className="flex items-center gap-0.5 shrink-0">
        {hasUnusualMove && (
          <Zap 
            size={iconSizes[size]} 
            className="text-[oklch(0.85_0.18_90)]" 
            fill="currentColor"
          />
        )}
        {hasSmartMoney && (
          <Flame 
            size={iconSizes[size]} 
            className="text-[oklch(0.7_0.18_55)]" 
            fill="currentColor"
          />
        )}
        {isImminent && event.isWatchlist && (
          <AlertTriangle 
            size={iconSizes[size]} 
            className="text-[oklch(0.65_0.25_25)]" 
          />
        )}
      </span>
    </button>
  )
}

export function TierDot({ tier, size = 'md' }: { tier: EventTier; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = {
    sm: 'w-1.5 h-1.5',
    md: 'w-2 h-2',
    lg: 'w-2.5 h-2.5',
  }
  
  return (
    <span className={cn('rounded-full shrink-0', tierDotStyles[tier], sizes[size])} />
  )
}
