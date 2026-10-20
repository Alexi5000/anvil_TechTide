/**
 * Helper functions for gateway channel webhook management and identity loading.
 *
 * Extracted from service.ts to keep file sizes under the 250-line limit.
 */

import { appData } from "@/lib/app-data-store";
import { fetch } from "@tauri-apps/plugin-http";
import { GATEWAY_BASE_URL } from "@/lib/constants";
import { loadGatewayToken } from "./auth";
import { logger } from "@/lib/logger-client";
import { GhCli } from "@/lib/gh-cli/client";
import type { GatewayChannelMetadata } from "./types";

/**
 * Create a GitHub webhook for a gateway channel.
 * Returns updated metadata with webhookId if successful.
 */
export async function createGitHubWebhook(
  metadata: GatewayChannelMetadata,
  repoRootPath: string,
): Promise<GatewayChannelMetadata> {
  const tag = `[createGitHubWebhook channel=${metadata.id}]`;

  try {
    const ghCli = new GhCli(repoRootPath);
    const isAvailable = await ghCli.isAvailable();
    if (!isAvailable) {
      logger.warn(`${tag} gh CLI not available or not authenticated — skipping`);
      return metadata;
    }

    const response = await fetch(`${GATEWAY_BASE_URL}/gateway/channels`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await loadGatewayToken()}` },
      body: JSON.stringify({ deviceId: await loadDeviceId(), type: "github", label: metadata.label }),
    });
    if (!response.ok) throw new Error("Gateway authorization failed");
    const registration = await response.json() as { channelId: string; webhookSecret?: string };
    if (registration.channelId !== metadata.id || !registration.webhookSecret) throw new Error("Gateway signing configuration unavailable");

    // Check if a webhook already exists for this URL
    const existing = await ghCli.listWebhooks();

    const match = existing.find(
      (wh) => wh.config.url === metadata.webhookUrl,
    );
    if (match) {
      logger.info(`${tag} Webhook already exists (id=${match.id})`);
      await ghCli.updateWebhookSecret(match.id, registration.webhookSecret);
      return { ...metadata, webhookId: match.id, webhookAuthVersion: 1 };
    }

    const result = await ghCli.createWebhook(metadata.webhookUrl, registration.webhookSecret);
    logger.info(`${tag} Created webhook id=${result.id}`);
    return { ...metadata, webhookId: result.id, webhookAuthVersion: 1 };
  } catch (e) {
    logger.error(`${tag} Webhook creation failed:`, e);
    return metadata;
  }
}

/**
 * Load the device ID from the identity file on disk.
 */
export async function loadDeviceId(): Promise<string> {
  const raw = await appData.readJson<{ device_id?: string }>("settings/app-config.json");
  if (!raw?.device_id) {
    throw new Error("App config not found or missing device_id (settings/app-config.json)");
  }
  return raw.device_id;
}
