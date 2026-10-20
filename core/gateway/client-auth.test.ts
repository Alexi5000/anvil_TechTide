import { expect, it, vi } from "vitest";
import { GatewayClient } from "./client";

it("sends a provisioned device token in the header, never the URL", async () => {
  const fetch = vi.fn().mockResolvedValue({ ok: true, body: new ReadableStream({ start(controller) { controller.close(); } }) });
  const client = new GatewayClient({ baseUrl: "https://gateway.example", deviceId: "device", fetch, loadAuthToken: async () => "private-token", loadLastEventId: async () => "1-0", saveLastEventId: async () => {}, onEvent: () => {} });
  await client.connect();
  client.disconnect();
  expect(fetch.mock.calls[0][0]).not.toContain("private-token");
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer private-token");
  expect(fetch.mock.calls[0][1].headers["Last-Event-ID"]).toBe("1-0");
});
