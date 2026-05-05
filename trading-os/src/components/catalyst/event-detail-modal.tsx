'use client'

import { cn } from '@/lib/utils'
import type { CatalystEvent } from '@/lib/calendar-types'
import { TIER_CONFIG } from '@/lib/calendar-types'
import { TierDot } from './event-badge'
import { X, Calendar, Clock, TrendingUp, Zap, Flame, ExternalLink, Bell, BellOff, Star } from 'lucide-react'
import { useState, useEffect, useRef } from 'react'

interface EventDetailModalProps {
  event: CatalystEvent | null
  onClose: () => void
}

export function EventDetailModal({ event, onClose }: EventDetailModalProps) {
  const [alertEnabled, setAlertEnabled] = useState(false)
  const [isWatchlisted, setIsWatchlisted] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  
  // Sync watchlist state with event
  useEffect(() => {
    if (event) {
      setIsWatchlisted(event.isWatchlist || false)
    }
  }, [event])
  
  // Trap focus inside modal
  useEffect(() => {
    if (event) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          onClose()
        }
      }
      document.addEventListener('keydown', handleKeyDown)
      modalRef.current?.focus()
      return () => document.removeEventListener('keydown', handleKeyDown)
    }
  }, [event, onClose])
  
  if (!event) return null
  
  const hasUnusualMove = event.impliedMove && event.avgHistoricalMove && 
    event.impliedMove > event.avgHistoricalMove * 1.5
  const hasSmartMoney = event.smartMoneyConcentration && event.smartMoneyConcentration >= 3
  const eventDate = new Date(event.date)
  const daysUntil = Math.ceil((eventDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  const tierConfig = TIER_CONFIG[event.tier]

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
    >
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      
      {/* Modal */}
      <div 
        ref={modalRef}
        tabIndex={-1}
        className={cn(
          'relative bg-panel border border-border rounded-xl max-w-md w-full shadow-2xl',
          'animate-in fade-in zoom-in-95 duration-200',
          'focus:outline-none'
        )}
      >
        {/* Header */}
        <div className="flex items-start justify-between p-4 border-b border-border">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <TierDot tier={event.tier} size="lg" />
              <h2 id="modal-title" className="text-2xl font-mono font-bold">{event.symbol}</h2>
              {isWatchlisted && (
                <span className="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded font-medium">
                  WATCHLIST
                </span>
              )}
            </div>
            <p className="text-muted-foreground">{event.title}</p>
          </div>
          <button
            onClick={onClose}
            className={cn(
              'p-1.5 rounded-lg hover:bg-secondary transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950'
            )}
            aria-label="Close modal"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Tier Badge */}
          <div className={cn(
            'inline-flex items-center gap-2 px-3 py-1.5 rounded-lg',
            event.tier === 1 && 'bg-[oklch(0.65_0.25_25/0.15)] text-[oklch(0.75_0.22_25)]',
            event.tier === 2 && 'bg-[oklch(0.7_0.18_55/0.15)] text-[oklch(0.8_0.16_55)]',
            event.tier === 3 && 'bg-[oklch(0.8_0.15_90/0.12)] text-[oklch(0.85_0.13_90)]',
            event.tier === 4 && 'bg-[oklch(0.7_0.18_145/0.12)] text-[oklch(0.75_0.16_145)]',
          )}>
            <span className="text-xs font-semibold uppercase tracking-wider">
              {event.category.replace(/_/g, ' ')}
            </span>
            <span className="text-[10px] opacity-70">
              {tierConfig.label} - T{event.tier}
            </span>
          </div>
          
          {/* Date & Time */}
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Calendar size={14} aria-hidden="true" />
              <span className="font-mono">
                {eventDate.toLocaleDateString('en-GB', {
                  weekday: 'short',
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                })}
              </span>
            </div>
            {event.time && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock size={14} aria-hidden="true" />
                <span className="font-mono">{event.time}</span>
              </div>
            )}
            <div className={cn(
              'px-2 py-0.5 rounded text-xs font-mono font-medium',
              daysUntil <= 0 ? 'bg-primary text-primary-foreground' :
              daysUntil <= 2 ? 'bg-[oklch(0.65_0.25_25/0.2)] text-[oklch(0.75_0.22_25)]' :
              'bg-secondary text-muted-foreground'
            )}>
              {daysUntil <= 0 ? 'TODAY' : daysUntil === 1 ? 'TOMORROW' : `${daysUntil}d`}
            </div>
          </div>
          
          {/* Description */}
          {event.description && (
            <p className="text-sm text-muted-foreground leading-relaxed">
              {event.description}
            </p>
          )}
          
          {/* Metrics - Visual implied vs avg move */}
          {(event.impliedMove || hasSmartMoney) && (
            <div className="grid grid-cols-2 gap-3">
              {event.impliedMove && (
                <div className={cn(
                  'p-3 rounded-lg border',
                  hasUnusualMove 
                    ? 'bg-[oklch(0.85_0.18_90/0.1)] border-[oklch(0.85_0.18_90/0.2)]'
                    : 'bg-secondary/50 border-border'
                )}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {hasUnusualMove ? (
                      <Zap size={14} className="text-[oklch(0.85_0.18_90)]" fill="currentColor" aria-hidden="true" />
                    ) : (
                      <TrendingUp size={14} className="text-muted-foreground" aria-hidden="true" />
                    )}
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Implied Move
                    </span>
                  </div>
                  <div className={cn(
                    'text-xl font-mono font-bold',
                    hasUnusualMove ? 'text-[oklch(0.85_0.18_90)]' : 'text-foreground'
                  )}>
                    {event.impliedMove.toFixed(1)}%
                  </div>
                  
                  {/* Visual bar comparison */}
                  {event.avgHistoricalMove && (
                    <div className="mt-2 space-y-1">
                      <div className="relative h-2 bg-muted/30 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            'absolute left-0 top-0 h-full rounded-full transition-all',
                            hasUnusualMove ? 'bg-[oklch(0.85_0.18_90)]' : 'bg-muted-foreground/60'
                          )}
                          style={{ width: `${Math.min((event.impliedMove / (event.avgHistoricalMove * 2)) * 100, 100)}%` }}
                        />
                      </div>
                      <div className="relative h-1 bg-muted/20 rounded-full overflow-hidden">
                        <div 
                          className="absolute left-0 top-0 h-full rounded-full bg-muted-foreground/30"
                          style={{ width: `${Math.min((event.avgHistoricalMove / (event.impliedMove * 1.2)) * 100, 100)}%` }}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        vs {event.avgHistoricalMove.toFixed(1)}% avg ({(event.impliedMove / event.avgHistoricalMove).toFixed(1)}x)
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {hasSmartMoney && (
                <div className="p-3 rounded-lg border bg-[oklch(0.7_0.18_55/0.1)] border-[oklch(0.7_0.18_55/0.2)]">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Flame size={14} className="text-[oklch(0.7_0.18_55)]" fill="currentColor" aria-hidden="true" />
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                      Smart Money
                    </span>
                  </div>
                  <div className="text-xl font-mono font-bold text-[oklch(0.7_0.18_55)]">
                    {event.smartMoneyConcentration}x
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    concentration signal
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-border">
            <button
              onClick={() => setIsWatchlisted(!isWatchlisted)}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg transition-colors text-sm font-medium',
                'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
                isWatchlisted 
                  ? 'bg-primary text-primary-foreground' 
                  : 'bg-secondary hover:bg-secondary/80 text-foreground'
              )}
              aria-pressed={isWatchlisted}
            >
              <Star size={16} className={isWatchlisted ? 'fill-current' : ''} aria-hidden="true" />
              {isWatchlisted ? 'Watching' : 'Watch'}
            </button>
            <button
              onClick={() => setAlertEnabled(!alertEnabled)}
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg transition-colors text-sm font-medium',
                'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950',
                alertEnabled 
                  ? 'bg-amber-500/20 text-amber-400' 
                  : 'bg-secondary hover:bg-secondary/80 text-foreground'
              )}
              aria-pressed={alertEnabled}
            >
              {alertEnabled ? <Bell size={16} aria-hidden="true" /> : <BellOff size={16} aria-hidden="true" />}
              {alertEnabled ? 'Alert On' : 'Alert'}
            </button>
            <button 
              className={cn(
                'flex items-center justify-center gap-2 py-2.5 px-4 rounded-lg transition-colors text-sm font-medium',
                'bg-secondary hover:bg-secondary/80',
                'focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 focus:ring-offset-slate-950'
              )}
            >
              <ExternalLink size={16} aria-hidden="true" />
              Research
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
