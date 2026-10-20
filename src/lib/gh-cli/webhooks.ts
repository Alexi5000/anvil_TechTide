/**
 * Webhook CRUD operations via gh CLI.
 * Uses the GitHub REST API through `gh api`.
 */

import { execGhJson, execGh } from "./executor";
import { execGhJsonInput } from "./secure-input";
import { getRepoSlug } from "./pr-queries";
import { z } from "zod";

const WebhookSchema = z.object({
  id: z.number(),
  config: z.object({
    url: z.string(),
  }),
});

const CreateWebhookResponseSchema = z.object({
  id: z.number(),
});

/**
 * Create a webhook for a repository via the GitHub API.
 * One webhook per repo, shared across all PRs.
 *
 * Events subscribed: pull_request, issue_comment, check_run, check_suite,
 * pull_request_review
 *
 * Sends signing secrets through stdin, never process arguments.
 */
export async function createWebhook(
  cwd: string,
  webhookUrl: string,
  secret: string,
): Promise<{ id: number }> {
  const repoSlug = await getRepoSlug(cwd);

  const result = await execGhJsonInput(
    ["api", `repos/${repoSlug}/hooks`, "--method", "POST"],
    cwd,
    {
      name: "web", active: true,
      config: { url: webhookUrl, content_type: "json", secret },
      events: ["pull_request", "issue_comment", "check_run", "check_suite", "pull_request_review"],
    },
  );

  return CreateWebhookResponseSchema.parse(result);
}

/**
 * Delete a webhook for a repository.
 */
export async function deleteWebhook(
  cwd: string,
  hookId: number,
): Promise<void> {
  const repoSlug = await getRepoSlug(cwd);
  await execGh(
    ["api", `repos/${repoSlug}/hooks/${hookId}`, "--method", "DELETE"],
    cwd,
  );
}

/**
 * List existing webhooks to check if one already exists for our gateway.
 */
export async function listWebhooks(
  cwd: string,
): Promise<Array<{ id: number; config: { url: string } }>> {
  const repoSlug = await getRepoSlug(cwd);
  const raw = await execGhJson<unknown[]>(
    ["api", `repos/${repoSlug}/hooks`],
    cwd,
  );
  return z.array(WebhookSchema).parse(raw);
}

export async function updateWebhookSecret(cwd: string, hookId: number, secret: string): Promise<void> {
  const repoSlug = await getRepoSlug(cwd);
  await execGhJsonInput(["api", `repos/${repoSlug}/hooks/${hookId}`, "--method", "PATCH"], cwd, { config: { secret } });
}
