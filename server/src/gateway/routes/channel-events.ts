import { randomUUID, createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";
import { ChannelSchema, type Channel } from "../types/channel.js";
import type { GatewayEvent } from "../types/events.js";
import { addSignedEvent } from "../services/event-buffer.js";

const WebhookPayloadSchema = z.record(z.string(), z.unknown());

interface ChannelEventsParams {
  channelId: string;
}

async function lookupChannel(
  redis: Redis,
  channelId: string
): Promise<Channel | null> {
  const raw = await redis.get(`gateway:channel:${channelId}`);
  if (!raw) {
    return null;
  }
  return ChannelSchema.parse(JSON.parse(raw));
}

function buildEventType(
  channelType: string,
  githubEvent: string
): string {
  return `${channelType}.${githubEvent}`;
}

export function registerChannelEventsRoute(
  fastify: FastifyInstance,
  redis: Redis
): void {
  fastify.post<{ Params: ChannelEventsParams }>(
    "/channels/:channelId/events",
    async (request, reply) => {
      const { channelId } = request.params;

      const channel = await lookupChannel(redis, channelId);
      if (!channel) {
        return reply.status(404).send({ error: "Channel not found" });
      }

      const signature = request.headers["x-hub-signature-256"];
      const delivery = request.headers["x-github-delivery"];
      if (!channel.webhookSecret || !request.gatewayRawBody || typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }
      const expected = createHmac("sha256", channel.webhookSecret).update(request.gatewayRawBody).digest();
      if (!timingSafeEqual(Buffer.from(signature.slice(7), "hex"), expected)) {
        return reply.status(401).send({ error: "Invalid webhook signature" });
      }
      if (typeof delivery !== "string" || !/^[a-zA-Z0-9-]{1,128}$/.test(delivery)) {
        return reply.status(400).send({ error: "Missing or invalid delivery ID" });
      }
      const rawHeader = request.headers["x-github-event"];
      const githubEvent = typeof rawHeader === "string" ? rawHeader : "unknown";

      const parsePayload = WebhookPayloadSchema.safeParse(request.body);
      const payload = parsePayload.success
        ? parsePayload.data
        : { raw: request.body };

      const event: GatewayEvent = {
        id: randomUUID(),
        type: buildEventType(channel.type, githubEvent),
        channelId,
        payload,
        receivedAt: Date.now(),
      };

      const inserted = await addSignedEvent(redis, channel.deviceId, event, delivery, expected.toString("hex"));
      if (!inserted) return reply.status(200).send({ duplicate: true });

      return reply.status(201).send({ eventId: event.id });
    }
  );
}
