import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createHmac, randomUUID } from "node:crypto";
import { startTestServer, stopTestServer, gatewayFetch, getTestApp } from "./setup.js";
import type { Redis } from "ioredis";

let baseUrl: string;
let redis: Redis;
beforeAll(async () => {
  const ctx = await startTestServer();
  if (!ctx.redis) throw new Error("Security regressions require isolated local Redis");
  baseUrl = ctx.baseUrl;
  redis = ctx.redis;
});
afterAll(stopTestServer);

describe("gateway authorization boundaries", () => {
  it("denies anonymous registration and stream reads before ACK deletion", async () => {
    const deviceId = randomUUID();
    const registration = await fetch(`${baseUrl}/gateway/channels`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceId, type: "github", label: "private" }),
    });
    expect(registration.status).toBe(401);
    const key = `gateway:events:${deviceId}`;
    await redis.xadd(key, "*", "synthetic", "private");
    const stream = await fetch(`${baseUrl}/gateway/devices/${deviceId}/events`, { headers: { "Last-Event-ID": "9999999999999-0" } });
    expect(stream.status).toBe(401);
    expect(await redis.xlen(key)).toBe(1);
  });

  it("rate limits authorization attempts despite forged forwarding headers", async () => {
    const app = getTestApp();
    const deviceId = randomUUID();
    for (let i = 0; i < 61; i++) {
      const response = await app.inject({
        method: "POST", url: "/gateway/channels", remoteAddress: "203.0.113.45",
        headers: { "x-forwarded-for": `192.0.2.${i}`, "content-type": "application/json" },
        payload: JSON.stringify({ deviceId, type: "github", label: "limited" }),
      });
      expect(response.statusCode).toBe(i < 60 ? 401 : 429);
    }
  });

  it("binds each token to its own device", async () => {
    const deviceId = randomUUID();
    await gatewayFetch(`${baseUrl}/gateway/channels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, type: "github", label: "own" }) });
    const token = JSON.parse(process.env.ANVIL_GATEWAY_DEVICE_TOKENS!)[deviceId];
    const other = randomUUID();
    const response = await fetch(`${baseUrl}/gateway/channels`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ deviceId: other, type: "github", label: "other" }) });
    expect(response.status).toBe(401);
    expect((await fetch(`${baseUrl}/gateway/devices/${other}/events`, { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
  });

  it("requires exact raw-body signatures and atomically deduplicates concurrent delivery", async () => {
    const deviceId = randomUUID();
    const registration = await gatewayFetch(`${baseUrl}/gateway/channels`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ deviceId, type: "github", label: "signed" }) });
    const channel = await registration.json() as { channelId: string; webhookSecret: string };
    const url = `${baseUrl}/gateway/channels/${channel.channelId}/events`;
    const body = '{ "action": "opened" }';
    const headers = { "Content-Type": "application/json", "X-GitHub-Event": "pull_request", "X-GitHub-Delivery": randomUUID(), "X-Hub-Signature-256": `sha256=${createHmac("sha256", channel.webhookSecret).update(body).digest("hex")}` };
    expect((await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body })).status).toBe(401);
    expect((await fetch(url, { method: "POST", headers, body: '{"action":"opened"}' })).status).toBe(401);
    const results = await Promise.all(Array.from({ length: 4 }, () => fetch(url, { method: "POST", headers, body })));
    expect(results.filter(response => response.status === 201)).toHaveLength(1);
    expect(results.filter(response => response.status === 200)).toHaveLength(3);
    expect(await redis.xlen(`gateway:events:${deviceId}`)).toBe(1);
    const replay = await fetch(url, { method: "POST", headers: { ...headers, "X-GitHub-Delivery": randomUUID() }, body });
    expect(replay.status).toBe(200);
    expect(await redis.xlen(`gateway:events:${deviceId}`)).toBe(1);
  });
});
