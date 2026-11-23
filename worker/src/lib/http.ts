import type { Context } from "hono";
import type { ZodTypeAny, z } from "zod";
import type { AppEnv } from "../env";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, details?: unknown) => new ApiError(400, msg, "bad_request", details);
export const notFound = (msg = "Not found") => new ApiError(404, msg, "not_found");
export const conflict = (msg: string, code = "conflict", details?: unknown) => new ApiError(409, msg, code, details);
export const forbidden = (msg = "Forbidden") => new ApiError(403, msg, "forbidden");

/** Parse + validate a JSON body with zod. */
export async function parseBody<S extends ZodTypeAny>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON");
  }
  return parseWith(schema, raw);
}

export function parseWith<S extends ZodTypeAny>(schema: S, raw: unknown): z.infer<S> {
  const res = schema.safeParse(raw);
  if (!res.success) {
    const issues = res.error.issues.map((i) => ({ path: i.path.join("."), message: i.message }));
    const first = issues[0];
    throw new ApiError(400, first ? `${first.path ? first.path + ": " : ""}${first.message}` : "Validation failed", "validation_error", issues);
  }
  return res.data;
}

export function parseId(v: string | undefined, label = "id"): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw badRequest(`Invalid ${label}`);
  return n;
}

export const nowIso = () => new Date().toISOString();

export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header("CF-Connecting-IP") ?? null;
}
