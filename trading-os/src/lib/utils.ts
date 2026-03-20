import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { toFixedSafe } from "@/lib/number"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPct(value: number) {
  const sign = value > 0 ? "+" : ""
  return `${sign}${toFixedSafe(value, 2)}%`
}

export function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value)
}
