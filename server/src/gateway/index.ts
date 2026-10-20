import type { FastifyPluginAsync } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { getRedis, closeRedis } from "./services/redis.js";
import { registerChannelsRoute } from "./routes/channels.js";
import { registerChannelEventsRoute } from "./routes/channel-events.js";
import { registerDeviceEventsRoute } from "./routes/device-events.js";

declare module "fastify" {
  interface FastifyRequest { gatewayRawBody?: Buffer; }
}

export interface GatewayPluginOptions {
  redisUrl: string;
}

const gatewayPlugin: FastifyPluginAsync<GatewayPluginOptions> = async (
  fastify,
  opts
) => {
  const redis = getRedis(opts.redisUrl);
  await fastify.register(rateLimit, {
    global: true, redis, max: 600, timeWindow: "1 minute", skipOnError: false,
    keyGenerator: request => request.socket.remoteAddress ?? "unknown",
  });
  const parseJson = fastify.getDefaultJsonParser("error", "error");
  fastify.removeContentTypeParser("application/json");
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    request.gatewayRawBody = Buffer.from(body);
    parseJson(request, body.toString(), done);
  });

  registerChannelsRoute(fastify, redis);
  registerChannelEventsRoute(fastify, redis);
  registerDeviceEventsRoute(fastify, redis);

  fastify.addHook("onClose", async () => {
    await closeRedis();
  });
};

export default gatewayPlugin;
export { gatewayPlugin };
