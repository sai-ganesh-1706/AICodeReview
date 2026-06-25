import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import type { PullRequestWebhookPayload } from "@/types/review";
import { prisma } from "@/lib/prisma";
import { processReview } from "@/lib/reviewProcessor";

// On Vercel Hobby plan, the function runs up to 60s.
// We now await processReview before returning so Vercel doesn't kill it early.
export const maxDuration = 60;

/**
 * Verify the X-Hub-Signature-256 header against the raw request body.
 */
function verifySignature(
  payload: string,
  signature: string | null,
  secret: string
): boolean {
  if (!signature) return false;

  const expected = `sha256=${createHmac("sha256", secret)
    .update(payload)
    .digest("hex")}`;

  try {
    return timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Installation event types (GitHub webhook payloads)
// ---------------------------------------------------------------------------

interface InstallationPayload {
  action: string;
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
    };
  };
  repositories?: Array<{
    id: number;
    full_name: string;
  }>;
  sender: {
    login: string;
    id: number;
  };
}

interface InstallationRepositoriesPayload {
  action: string; // "added" | "removed"
  installation: {
    id: number;
    account: {
      login: string;
      id: number;
    };
  };
  repositories_added: Array<{
    id: number;
    full_name: string;
  }>;
  repositories_removed: Array<{
    id: number;
    full_name: string;
  }>;
  sender: {
    login: string;
    id: number;
  };
}

// ---------------------------------------------------------------------------
// Handlers for each event type
// ---------------------------------------------------------------------------

/**
 * Handle `installation.created` — register all repositories included in the
 * installation. Links them to the user who triggered the install (by their
 * GitHub account ID, looked up via the sender field).
 */
async function handleInstallationCreated(
  payload: InstallationPayload
): Promise<void> {
  const installationId = payload.installation.id;
  const senderGithubId = payload.sender.id;
  const repos = payload.repositories ?? [];

  console.log(
    `[Webhook] installation.created — installationId=${installationId}, ` +
      `sender=${payload.sender.login}, repos=${repos.length}`
  );

  // Find the user in our DB by their GitHub ID
  const user = await prisma.user.findUnique({
    where: { githubId: senderGithubId },
  });

  if (!user) {
    console.warn(
      `[Webhook] Sender ${payload.sender.login} (githubId=${senderGithubId}) ` +
        `not found in DB — they haven't signed in to ReviewAI yet. ` +
        `Repos will be created when they sign in or when a PR arrives.`
    );
    return;
  }

  // Upsert each repository
  for (const repo of repos) {
    await prisma.repository.upsert({
      where: {
        userId_repoFullName: {
          userId: user.id,
          repoFullName: repo.full_name,
        },
      },
      update: {
        installationId,
        active: true,
      },
      create: {
        userId: user.id,
        repoFullName: repo.full_name,
        installationId,
        active: true,
      },
    });
    console.log(
      `[Webhook] Registered repository: ${repo.full_name} (installationId=${installationId})`
    );
  }
}

/**
 * Handle `installation_repositories.added` — register newly added repos.
 * Handle `installation_repositories.removed` — deactivate removed repos.
 */
async function handleInstallationRepositories(
  payload: InstallationRepositoriesPayload
): Promise<void> {
  const installationId = payload.installation.id;
  const senderGithubId = payload.sender.id;

  console.log(
    `[Webhook] installation_repositories.${payload.action} — ` +
      `added=${payload.repositories_added.length}, ` +
      `removed=${payload.repositories_removed.length}`
  );

  const user = await prisma.user.findUnique({
    where: { githubId: senderGithubId },
  });

  if (!user) {
    console.warn(
      `[Webhook] Sender ${payload.sender.login} (githubId=${senderGithubId}) ` +
        `not found in DB — skipping repository update.`
    );
    return;
  }

  // Add new repositories
  for (const repo of payload.repositories_added) {
    await prisma.repository.upsert({
      where: {
        userId_repoFullName: {
          userId: user.id,
          repoFullName: repo.full_name,
        },
      },
      update: {
        installationId,
        active: true,
      },
      create: {
        userId: user.id,
        repoFullName: repo.full_name,
        installationId,
        active: true,
      },
    });
    console.log(`[Webhook] Added repository: ${repo.full_name}`);
  }

  // Deactivate removed repositories
  for (const repo of payload.repositories_removed) {
    await prisma.repository.updateMany({
      where: {
        userId: user.id,
        repoFullName: repo.full_name,
      },
      data: { active: false },
    });
    console.log(`[Webhook] Deactivated repository: ${repo.full_name}`);
  }
}

/**
 * Handle `pull_request` — auto-register the repo if missing, then process.
 * This is the fallback path: if the user installed the GitHub App before
 * signing in, or if the installation event was missed, we still create the
 * repository record on the first PR event.
 */
async function handlePullRequest(
  payload: PullRequestWebhookPayload
): Promise<NextResponse> {
  // Only process "opened" or "synchronize" actions
  if (payload.action !== "opened" && payload.action !== "synchronize") {
    return NextResponse.json({ received: true });
  }

  const repoFullName = payload.repository.full_name;
  const installationId = payload.installation?.id;

  if (!installationId) {
    console.warn(
      `[Webhook] PR event for ${repoFullName} has no installation ID — skipping`
    );
    return NextResponse.json({ received: true });
  }

  // Try to find the repo in DB
  let repository = await prisma.repository.findFirst({
    where: { repoFullName, active: true },
  });

  // Auto-create if missing — find a user who owns this repo
  if (!repository) {
    console.log(
      `[Webhook] Repository ${repoFullName} not in DB — attempting auto-registration`
    );

    // Strategy 1: Look for a user whose login matches the repo owner
    const [repoOwner] = repoFullName.split("/");
    let user = await prisma.user.findFirst({
      where: { login: repoOwner },
    });

    // Strategy 2: Find any repo with the same installationId and use its user
    if (!user) {
      const siblingRepo = await prisma.repository.findFirst({
        where: { installationId },
        select: { userId: true },
      });
      if (siblingRepo) {
        user = await prisma.user.findUnique({
          where: { id: siblingRepo.userId },
        });
      }
    }

    // Strategy 3: Use the first user in the DB (for single-user setups)
    if (!user) {
      user = await prisma.user.findFirst();
    }

    if (!user) {
      console.error(
        `[Webhook] No user found to associate with ${repoFullName} — skipping. ` +
          `The user needs to sign in to ReviewAI first.`
      );
      return NextResponse.json({ received: true });
    }

    // Create the repository record
    repository = await prisma.repository.upsert({
      where: {
        userId_repoFullName: {
          userId: user.id,
          repoFullName,
        },
      },
      update: {
        installationId,
        active: true,
      },
      create: {
        userId: user.id,
        repoFullName,
        installationId,
        active: true,
      },
    });

    console.log(
      `[Webhook] Auto-registered repository: ${repoFullName} ` +
        `(userId=${user.id}, installationId=${installationId})`
    );
  }

  // ✅ Fixed: await processReview instead of fire-and-forget.
  // On Vercel Hobby, the function is killed the moment the response is sent,
  // so fire-and-forget (void) means all async work after the return is lost.
  try {
    await processReview(payload);
  } catch (err) {
    console.error(
      `[Webhook] processReview failed for ${repoFullName}#${payload.pull_request.number}:`,
      err
    );
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------
// Main webhook handler
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  console.log("WEBHOOK HIT");
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("GITHUB_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { error: "Webhook secret not configured" },
      { status: 500 }
    );
  }

  // Read the raw body for signature verification
  const rawBody = await request.text();

  // Verify HMAC signature
  const signature = request.headers.get("x-hub-signature-256");
  if (!verifySignature(rawBody, signature, webhookSecret)) {
    console.warn("Webhook signature verification failed");
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 401 }
    );
  }

  const eventType = request.headers.get("x-github-event");

  console.log(`[Webhook] Received event: ${eventType}`);

  // Parse the payload once
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON payload" },
      { status: 400 }
    );
  }

  // -------------------------------------------------------------------------
  // Route by event type
  // -------------------------------------------------------------------------

  // 1. GitHub App installed → register repositories
  if (eventType === "installation") {
    const payload = body as unknown as InstallationPayload;
    if (payload.action === "created") {
      await handleInstallationCreated(payload);
    }
    return NextResponse.json({ received: true });
  }

  // 2. Repos added/removed from an existing installation
  if (eventType === "installation_repositories") {
    const payload = body as unknown as InstallationRepositoriesPayload;
    await handleInstallationRepositories(payload);
    return NextResponse.json({ received: true });
  }

  // 3. Pull request events → the main AI review path
  if (eventType === "pull_request") {
    const payload = body as unknown as PullRequestWebhookPayload;
    return handlePullRequest(payload);
  }

  // 4. Any other event — acknowledge without processing
  console.log(`[Webhook] Ignoring event type: ${eventType}`);
  return NextResponse.json({ received: true });
}