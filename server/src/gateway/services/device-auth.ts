import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyRequest } from "fastify";

const TokensSchema = z.record(z.string().uuid(), z.string().min(32).max(256));

export function authorizeDevice(request: FastifyRequest, deviceId: string): boolean {
  let tokens: Record<string, string>;
  try {
    tokens = TokensSchema.parse(JSON.parse(process.env.ANVIL_GATEWAY_DEVICE_TOKENS ?? "{}"));
  } catch {
    return false;
  }
  const token = Object.hasOwn(tokens, deviceId) ? tokens[deviceId] : undefined;
  if (!token) return false;
  const actual = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
