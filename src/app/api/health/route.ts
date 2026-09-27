import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { redis } from '@/lib/redis';

export const dynamic = 'force-dynamic';

export async function GET() {
  const services = {
    database: 'unknown',
    redis: 'unknown',
  };

  let isHealthy = true;

  // 1. Verify Supabase Connection
  const isSupabasePlaceholder = process.env.NEXT_PUBLIC_SUPABASE_URL?.includes('placeholder');
  if (isSupabasePlaceholder) {
    services.database = 'mocked (placeholder url configured)';
  } else {
    try {
      const { error } = await supabaseAdmin.from('tenants').select('id').limit(1);
      if (error) throw error;
      services.database = 'healthy';
    } catch (err: any) {
      services.database = `unhealthy: ${err.message}`;
      isHealthy = false;
    }
  }

  // 2. Verify Upstash Redis Connection
  const isRedisPlaceholder = !process.env.UPSTASH_REDIS_REST_URL;
  if (isRedisPlaceholder) {
    services.redis = 'mocked (no credentials configured)';
  } else {
    try {
      const ping = await redis.ping();
      if (ping === 'PONG' || ping === 'OK') {
        services.redis = 'healthy';
      } else {
        throw new Error(`Unexpected ping response: ${ping}`);
      }
    } catch (err: any) {
      services.redis = `unhealthy: ${err.message}`;
      isHealthy = false;
    }
  }

  return NextResponse.json(
    {
      status: isHealthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      services,
    },
    {
      status: isHealthy ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    }
  );
}
