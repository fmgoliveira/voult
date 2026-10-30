import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { z } from 'zod';
import type { Config } from './config';
import type { Db } from './db';
import type { Hub } from './hub';

export interface Deps {
  cfg: Config;
  db: Db;
  hub: Hub;
}

export type Env = {
  Variables: { userId: string; deviceId: string };
};

export async function parseBody<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await c.req.json();
  } catch {
    throw new HTTPException(400, { message: 'invalid_json' });
  }
  const r = schema.safeParse(json);
  if (!r.success) throw new HTTPException(400, { message: 'invalid_body' });
  return r.data;
}

/** `If-Match: <rev>`; 0 means "create". */
export function ifMatch(c: Context): number {
  const raw = c.req.header('if-match')?.replace(/"/g, '');
  if (raw === undefined || !/^\d+$/.test(raw)) {
    throw new HTTPException(428, { message: 'if_match_required' });
  }
  return Number(raw);
}
