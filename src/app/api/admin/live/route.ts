import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/admin-auth';
import { liveCounters } from '@/lib/admin-stats';

// «Активные сейчас» для автообновления — только под сессией владельца
export async function GET() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return NextResponse.json(await liveCounters());
}
