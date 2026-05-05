import { NextRequest } from 'next/server'

import { backendGet } from '@/app/api/_lib/proxy'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  return backendGet(request, '/api/calendar/events', { timeoutMs: 45000 })
}