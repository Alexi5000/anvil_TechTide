import { beforeEach, expect, it, vi } from "vitest";
import type { GatewayChannelMetadata } from "../types";
const mocks = vi.hoisted(() => ({ fetch: vi.fn(), readText: vi.fn(), readJson: vi.fn(), create: vi.fn(), update: vi.fn(), list: vi.fn() }));
vi.mock("@tauri-apps/plugin-http", () => ({ fetch: mocks.fetch }));
vi.mock("@/lib/app-data-store", () => ({ appData: { readText: mocks.readText, readJson: mocks.readJson } }));
vi.mock("@/lib/logger-client", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/gh-cli/client", () => ({ GhCli: class { isAvailable = async () => true; createWebhook = mocks.create; updateWebhookSecret = mocks.update; listWebhooks = mocks.list; } }));
import { createGitHubWebhook } from "../webhook-helpers";

const metadata: GatewayChannelMetadata = { id: "c", type: "github", label: "repo", active: false, webhookUrl: "https://gateway.example/gateway/channels/c/events", repoId: null, webhookId: null, createdAt: 0, updatedAt: 0 };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.readText.mockResolvedValue("t".repeat(64));
  mocks.readJson.mockResolvedValue({ device_id: "device" });
  mocks.fetch.mockResolvedValue({ ok: true, json: async () => ({ channelId: "c", webhookSecret: "signing-secret" }) });
  mocks.create.mockResolvedValue({ id: 42 });
  mocks.list.mockResolvedValue([]);
});

it("authenticates registration and provisions the returned signing secret", async () => {
  const result = await createGitHubWebhook(metadata, "/repo");
  expect(mocks.fetch.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${"t".repeat(64)}`);
  expect(mocks.create).toHaveBeenCalledWith(metadata.webhookUrl, "signing-secret");
  expect(result.webhookAuthVersion).toBe(1);
  expect(result).not.toHaveProperty("webhookSecret");
});

it("upgrades an existing unsigned hook instead of silently accepting it", async () => {
  mocks.list.mockResolvedValue([{ id: 5, config: { url: metadata.webhookUrl } }]);
  const result = await createGitHubWebhook(metadata, "/repo");
  expect(mocks.update).toHaveBeenCalledWith(5, "signing-secret");
  expect(mocks.create).not.toHaveBeenCalled();
  expect(result.webhookAuthVersion).toBe(1);
});

it("does not create an unsigned hook when provisioning fails", async () => {
  mocks.readText.mockResolvedValue(null);
  const result = await createGitHubWebhook(metadata, "/repo");
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(mocks.create).not.toHaveBeenCalled();
  expect(result.webhookAuthVersion).toBeUndefined();
});
