/**
 * marketSession.ts
 *
 * Time-aware market session engine for OpenRange Terminal.
 * Determines current US market phase, countdown to next event,
 * and UK window status — purely from the user's clock.
 *
 * No API calls. No React. Pure utility.
 */

"use client";

import { useEffect, useState } from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type MarketPhase =
  | "overnight"
  | "premarket"
  | "opening"
  | "morning"
  | "midday"
  | "afternoon"
  | "powerhour"
  | "afterhours"
  | "closed"
  | "weekend";

export type MarketSession = {
  phase: MarketPhase;
  label: string;
  nextEvent: string;
  countdown: string;
  orbWindow: boolean;  // 09:30–10:00 ET
  ukWindow: boolean;   // 14:30–16:00 UK (09:30–10:30 ET in BST)
  et: string;          // "8:15 AM"
  uk: string;          // "1:15 PM"
  date: string;        // "Monday, Apr 7"
  isOpen: boolean;
  isPremarket: boolean;
};

// ── DST helpers ───────────────────────────────────────────────────────────────

/** Is US Eastern Daylight Time (UTC-4) currently in effect? */
function isEasternDST(date: Date): boolean {
  const year = date.getUTCFullYear();

  // DST starts: 2nd Sunday of March at 02:00 ET (07:00 UTC in EST → 07:00 UTC)
  const marchFirst = new Date(Date.UTC(year, 2, 1));
  const marchFirstDay = marchFirst.getUTCDay(); // 0=Sun
  const daysToFirstSunday = (7 - marchFirstDay) % 7;
  const secondSunMarch = new Date(Date.UTC(year, 2, 1 + daysToFirstSunday + 7));
  secondSunMarch.setUTCHours(7, 0, 0, 0); // 02:00 EST = 07:00 UTC

  // DST ends: 1st Sunday of November at 02:00 ET (06:00 UTC in EDT)
  const novFirst = new Date(Date.UTC(year, 10, 1));
  const novFirstDay = novFirst.getUTCDay();
  const daysToFirstSunNov = (7 - novFirstDay) % 7;
  const firstSunNov = new Date(Date.UTC(year, 10, 1 + daysToFirstSunNov));
  firstSunNov.setUTCHours(6, 0, 0, 0); // 02:00 EDT = 06:00 UTC

  return date >= secondSunMarch && date < firstSunNov;
}

/** Is UK British Summer Time (UTC+1) currently in effect? */
function isUKBST(date: Date): boolean {
  const year = date.getUTCFullYear();

  // BST starts: last Sunday of March at 01:00 UTC
  const marchLast = new Date(Date.UTC(year, 3, 0)); // last day of March
  const marchLastDay = marchLast.getUTCDay();
  const lastSunMarch = new Date(Date.UTC(year, 2, 31 - marchLastDay));
  lastSunMarch.setUTCHours(1, 0, 0, 0);

  // BST ends: last Sunday of October at 01:00 UTC
  const octLast = new Date(Date.UTC(year, 10, 0)); // last day of October
  const octLastDay = octLast.getUTCDay();
  const lastSunOct = new Date(Date.UTC(year, 9, 31 - octLastDay));
  lastSunOct.setUTCHours(1, 0, 0, 0);

  return date >= lastSunMarch && date < lastSunOct;
}

// ── Time extraction ───────────────────────────────────────────────────────────

type ClockTime = { hours: number; minutes: number; totalMinutes: number };

function getEasternTime(utcDate: Date): ClockTime {
  const offsetHours = isEasternDST(utcDate) ? -4 : -5;
  const etMs = utcDate.getTime() + offsetHours * 3600_000;
  const et = new Date(etMs);
  const hours = et.getUTCHours();
  const minutes = et.getUTCMinutes();
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

function getUKTime(utcDate: Date): ClockTime {
  const offsetHours = isUKBST(utcDate) ? 1 : 0;
  const ukMs = utcDate.getTime() + offsetHours * 3600_000;
  const uk = new Date(ukMs);
  const hours = uk.getUTCHours();
  const minutes = uk.getUTCMinutes();
  return { hours, minutes, totalMinutes: hours * 60 + minutes };
}

// ── Formatting ────────────────────────────────────────────────────────────────

function formatTime({ hours, minutes }: ClockTime): string {
  const h12 = hours % 12 || 12;
  const ampm = hours < 12 ? "AM" : "PM";
  const mm = String(minutes).padStart(2, "0");
  return `${h12}:${mm} ${ampm}`;
}

function formatDate(utcDate: Date): string {
  // Build ET date by applying the ET offset
  const isEDT = isEasternDST(utcDate);
  const offsetHours = isEDT ? -4 : -5;
  const etMs = utcDate.getTime() + offsetHours * 3600_000;
  const et = new Date(etMs);

  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dayName = days[et.getUTCDay()];
  const month = months[et.getUTCMonth()];
  const day = et.getUTCDate();
  return `${dayName}, ${month} ${day}`;
}

function formatCountdown(minutesUntil: number): string {
  if (minutesUntil <= 0) return "Now";
  const h = Math.floor(minutesUntil / 60);
  const m = minutesUntil % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Phase detection ───────────────────────────────────────────────────────────

// All times in total minutes from midnight ET
const PHASES: Array<{
  phase: MarketPhase;
  label: string;
  start: number;
  end: number;
  nextEvent: string;
  nextAt: number;
}> = [
  { phase: "overnight",  label: "OVERNIGHT",   start: 0,    end: 240,  nextEvent: "Pre-market opens",       nextAt: 240  },
  { phase: "premarket",  label: "PRE-MARKET",   start: 240,  end: 570,  nextEvent: "Regular session opens",  nextAt: 570  },
  { phase: "opening",    label: "OPENING BELL", start: 570,  end: 600,  nextEvent: "Opening range closes",   nextAt: 600  },
  { phase: "morning",    label: "MORNING",      start: 600,  end: 690,  nextEvent: "Midday session begins",  nextAt: 690  },
  { phase: "midday",     label: "MID-DAY",      start: 690,  end: 810,  nextEvent: "Afternoon session",      nextAt: 810  },
  { phase: "afternoon",  label: "AFTERNOON",    start: 810,  end: 900,  nextEvent: "Power hour begins",      nextAt: 900  },
  { phase: "powerhour",  label: "POWER HOUR",   start: 900,  end: 960,  nextEvent: "Market closes",          nextAt: 960  },
  { phase: "afterhours", label: "AFTER-HOURS",  start: 960,  end: 1200, nextEvent: "Extended session ends",  nextAt: 1200 },
  { phase: "closed",     label: "CLOSED",       start: 1200, end: 1440, nextEvent: "Pre-market opens",       nextAt: 240  }, // wraps to next day
];

// ── Main function ─────────────────────────────────────────────────────────────

export function getMarketSession(now: Date = new Date()): MarketSession {
  const et = getEasternTime(now);
  const uk = getUKTime(now);

  // Weekend check (ET day)
  const isEDT = isEasternDST(now);
  const offsetHours = isEDT ? -4 : -5;
  const etDate = new Date(now.getTime() + offsetHours * 3600_000);
  const etDayOfWeek = etDate.getUTCDay(); // 0=Sun, 6=Sat

  if (etDayOfWeek === 0 || etDayOfWeek === 6) {
    // Weekend — next event is Monday pre-market (4:00 AM ET)
    const daysUntilMon = etDayOfWeek === 6 ? 2 : 1;
    const minutesUntilMon =
      daysUntilMon * 1440 - et.totalMinutes + 240; // 240 = 4:00 AM
    return {
      phase: "weekend",
      label: "WEEKEND",
      nextEvent: "Pre-market opens Monday",
      countdown: formatCountdown(minutesUntilMon),
      orbWindow: false,
      ukWindow: false,
      et: formatTime(et),
      uk: formatTime(uk),
      date: formatDate(now),
      isOpen: false,
      isPremarket: false,
    };
  }

  // Find current phase
  const tm = et.totalMinutes;
  const phaseInfo =
    PHASES.find((p) => tm >= p.start && tm < p.end) || PHASES[PHASES.length - 1];

  const minutesUntilNext =
    phaseInfo.nextAt > tm
      ? phaseInfo.nextAt - tm
      : phaseInfo.nextAt + 1440 - tm; // wraps to next day

  // ORB window: 09:30–10:00 ET
  const orbWindow = tm >= 570 && tm < 600;

  // UK prime window: 14:30–16:00 UK time
  const ukTm = uk.totalMinutes;
  const ukWindow = ukTm >= 870 && ukTm < 960;

  return {
    phase: phaseInfo.phase,
    label: phaseInfo.label,
    nextEvent: phaseInfo.nextEvent,
    countdown: formatCountdown(minutesUntilNext),
    orbWindow,
    ukWindow,
    et: formatTime(et),
    uk: formatTime(uk),
    date: formatDate(now),
    isOpen: phaseInfo.phase === "opening" || phaseInfo.phase === "morning" ||
            phaseInfo.phase === "midday"  || phaseInfo.phase === "afternoon" ||
            phaseInfo.phase === "powerhour",
    isPremarket: phaseInfo.phase === "premarket",
  };
}

// ── React hook ────────────────────────────────────────────────────────────────

export function useMarketClock(): MarketSession {
  const [session, setSession] = useState<MarketSession>(() => getMarketSession());

  useEffect(() => {
    const tick = () => setSession(getMarketSession());
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  return session;
}
