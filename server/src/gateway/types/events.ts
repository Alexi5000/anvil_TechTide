import { z } from "zod";

export const GatewayEventSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  channelId: z.string(),
  payload: z.record(z.string(), z.unknown()),
  receivedAt: z.number(),
});

export type GatewayEvent = z.infer<typeof GatewayEventSchema>;
