import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface ReviewCommentInput {
  path: string;
  line: number;
  severity: string;
  comment: string;
}

/**
 * Maps (filename, newSideLine) → GitHub diff position.
 * The diff position is a 1-indexed offset within the file's patch.
 */
export type DiffPositionMap = Map<string, Map<number, number>>;

// ---------------------------------------------------------------------------
// Octokit factories
// ---------------------------------------------------------------------------

/**
 * Create an authenticated Octokit instance using a user's personal access token.
 */
export function createUserOctokit(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}

/**
 * Create an Octokit instance authenticated as a GitHub App installation.
 * The private key is stored with escaped \n characters in GITHUB_PRIVATE_KEY.
 */
async function createInstallationOctokit(installationId: number): Promise<Octokit> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_PRIVATE_KEY
    ?.replace(/\\n/g, "\n")
    .trim();

  if (!appId || !privateKey) {
    throw new Error(
      "GITHUB_APP_ID and GITHUB_PRIVATE_KEY must be set in environment variables"
    );
  }

  console.log("Key line count:", privateKey.split("\n").length);
  console.log("Has real newlines:", privateKey.includes("\n"));

  try {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId: Number(appId),
        privateKey,
        installationId,
      },
    });

    await octokit.auth({ type: "installation" });
    console.log("[ReviewAI] Auth success ✅");
    return octokit;

  } catch (err: unknown) {
    console.error("[ReviewAI] Auth FAILED ❌:", err instanceof Error ? err.message : String(err));
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Ignored file patterns
// ---------------------------------------------------------------------------

const IGNORED_FILE_PATTERNS = [
  /\.lock$/,
  /\.min\.js$/,
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
];

const MAX_TOTAL_PATCH_LENGTH = 12_000;

// ---------------------------------------------------------------------------
// PR file fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch the changed files for a pull request, authenticated as a GitHub App
 * installation. Filters out binary files, lockfiles, and files without patches.
 * Caps total patch length at 12 000 characters.
 */
export async function getPRFiles(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number
): Promise<{ files: PRFile[]; truncated: boolean }> {
  const octokit = await createInstallationOctokit(installationId); // ✅ fixed: await added

  const { data } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });

  // Filter out files without patches, binary files, and lockfiles
  const filtered = data.filter((file) => {
    if (!file.patch) return false;
    if (IGNORED_FILE_PATTERNS.some((p) => p.test(file.filename))) return false;
    return true;
  });

  // Cap total patch length at MAX_TOTAL_PATCH_LENGTH
  const result: PRFile[] = [];
  let totalLength = 0;
  let truncated = false;

  for (const file of filtered) {
    const patch = file.patch!;
    if (totalLength + patch.length > MAX_TOTAL_PATCH_LENGTH) {
      truncated = true;
      break;
    }
    totalLength += patch.length;
    result.push({
      filename: file.filename,
      status: file.status,
      additions: file.additions,
      deletions: file.deletions,
      patch,
    });
  }

  return { files: result, truncated };
}

// ---------------------------------------------------------------------------
// Diff position mapping — the core fix for 422 errors
// ---------------------------------------------------------------------------

/**
 * Parse a GitHub unified-diff patch string for a single file and build a map
 * from new-side line number → diff position (1-indexed offset within the patch).
 *
 * GitHub's "position" for review comments is defined as:
 *   The 1-based line offset within the diff. The first line of the patch
 *   (the @@ hunk header) is position 1.
 *
 * We only map lines that are context lines (start with ' ') or additions
 * (start with '+'), because those are the lines that exist on the new
 * (HEAD/RIGHT) side and can receive inline comments.
 */
export function parsePatchPositions(patch: string): Map<number, number> {
  const lineToPosition = new Map<number, number>();
  const lines = patch.split("\n");

  let position = 0; // 1-indexed position within the diff
  let newLine = 0;  // current line number on the new (HEAD) side

  for (const line of lines) {
    position++; // every line in the patch increments position

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunkMatch) {
      newLine = parseInt(hunkMatch[1], 10);
      // Don't map the hunk header itself — it's not a commentable line
      continue;
    }

    if (line.startsWith("-")) {
      // Deletion: exists only on the old side. Don't increment newLine.
      continue;
    }

    if (line.startsWith("+")) {
      // Addition: new-side line. Map it.
      lineToPosition.set(newLine, position);
      newLine++;
      continue;
    }

    // Context line (starts with ' ' or is empty): exists on both sides.
    lineToPosition.set(newLine, position);
    newLine++;
  }

  return lineToPosition;
}

/**
 * Build a DiffPositionMap for all files in the PR.
 * Keys are filenames, values are maps of (newSideLine → diffPosition).
 */
export function buildDiffPositionMap(files: PRFile[]): DiffPositionMap {
  const map: DiffPositionMap = new Map();
  for (const file of files) {
    map.set(file.filename, parsePatchPositions(file.patch));
  }
  return map;
}

// ---------------------------------------------------------------------------
// Annotated diff builder — makes LLM output map-able to diff positions
// ---------------------------------------------------------------------------

/**
 * Build an annotated diff string where each line is prefixed with its
 * actual file line number (new side). This way the LLM sees exactly
 * which lines it can reference, and its "line" values will match
 * keys in our DiffPositionMap.
 *
 * Example output:
 *   === src/lib/github.ts ===
 *   @@ -10,5 +10,7 @@
 *    10:  import { Octokit } from "@octokit/rest";
 *    11:  import { createAppAuth } from "@octokit/auth-app";
 *   +12:  import { foo } from "bar";
 *    13:
 */
export function buildAnnotatedDiff(files: PRFile[]): string {
  const parts: string[] = [];

  for (const file of files) {
    const lines = file.patch.split("\n");
    const annotated: string[] = [];
    let newLine = 0;

    for (const line of lines) {
      // Hunk header
      const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunkMatch) {
        newLine = parseInt(hunkMatch[1], 10);
        annotated.push(line); // keep hunk header as-is
        continue;
      }

      if (line.startsWith("-")) {
        // Deletion — no new-side line number
        annotated.push(`   DEL: ${line}`);
        continue;
      }

      if (line.startsWith("+")) {
        // Addition
        annotated.push(`   ${newLine}: ${line}`);
        newLine++;
        continue;
      }

      // Context line
      annotated.push(`   ${newLine}: ${line}`);
      newLine++;
    }

    parts.push(`=== ${file.filename} ===\n${annotated.join("\n")}`);
  }

  return parts.join("\n\n");
}

// ---------------------------------------------------------------------------
// Post review comments back to GitHub
// ---------------------------------------------------------------------------

/**
 * Post a PR review with inline comments via the GitHub App installation.
 *
 * Uses the DiffPositionMap to resolve LLM line numbers → GitHub diff
 * positions. Comments that can't be resolved are appended to the review
 * body as fallback text.
 *
 * Uses event: "COMMENT" (never APPROVE or REQUEST_CHANGES).
 */
export async function postReviewComments(
  installationId: number,
  owner: string,
  repo: string,
  prNumber: number,
  headSha: string,
  comments: ReviewCommentInput[],
  summary: string,
  score: number,
  positionMap: DiffPositionMap
): Promise<void> {
  const octokit = await createInstallationOctokit(installationId); // ✅ fixed: await added

  const severityEmoji: Record<string, string> = {
    CRITICAL: "🔴",
    WARNING: "🟡",
    SUGGESTION: "🔵",
  };

  // Build the review body
  let reviewBody =
    `## 🤖 ReviewAI Summary\n\n` +
    `${summary}\n\n` +
    `**Code quality score: ${score}/100**`;

  // Resolve each LLM comment → GitHub diff position
  const resolvedComments: Array<{ path: string; position: number; body: string }> = [];
  const fallbackComments: string[] = [];

  for (const c of comments) {
    const emoji = severityEmoji[c.severity] ?? "💬";
    const body = `${emoji} **${c.severity}**: ${c.comment}`;

    // Look up the diff position for this file + line
    const filePositions = positionMap.get(c.path);
    const diffPosition = filePositions?.get(c.line);

    if (diffPosition !== undefined) {
      resolvedComments.push({
        path: c.path,
        position: diffPosition,
        body,
      });
      console.log(
        `[ReviewAI] Mapped ${c.path}:${c.line} → diff position ${diffPosition}`
      );
    } else {
      // Line not in diff — can't place inline
      console.warn(
        `[ReviewAI] Could not map ${c.path}:${c.line} to a diff position — adding to fallback`
      );
      fallbackComments.push(`**${c.path}:${c.line}** — ${body}`);
    }
  }

  // Append fallback comments to the review body
  if (fallbackComments.length > 0) {
    reviewBody +=
      `\n\n---\n\n` +
      `### Additional comments (line not in diff)\n\n` +
      fallbackComments.join("\n\n");
  }

  if (resolvedComments.length > 0) {
    try {
      // Post the review with all resolved inline comments at once
      await octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: headSha,
        event: "COMMENT",
        body: reviewBody,
        comments: resolvedComments,
      });
      console.log(
        `[ReviewAI] Posted review with ${resolvedComments.length} inline comments for ${owner}/${repo}#${prNumber}`
      );
      return; // Success — done
    } catch (error) {
      console.warn(
        "[ReviewAI] Batch review creation failed, falling back to individual comments:",
        error instanceof Error ? error.message : error
      );

      // Fall back: try posting comments one at a time
      const stillfailed: string[] = [];
      for (const c of resolvedComments) {
        try {
          await octokit.pulls.createReviewComment({
            owner,
            repo,
            pull_number: prNumber,
            commit_id: headSha,
            body: c.body,
            path: c.path,
            position: c.position,
          });
        } catch {
          stillfailed.push(`**${c.path}** — ${c.body}`);
        }
      }

      if (stillfailed.length > 0) {
        reviewBody +=
          `\n\n---\n\n` +
          `### Comments that could not be placed inline\n\n` +
          stillfailed.join("\n\n");
      }
    }
  }

  // Post the summary (+ any failed comments) as a top-level PR comment
  await octokit.issues.createComment({
    owner,
    repo,
    issue_number: prNumber,
    body: reviewBody,
  });
  console.log(
    `[ReviewAI] Posted review as issue comment for ${owner}/${repo}#${prNumber}`
  );
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/**
 * Fetch the diff for a pull request.
 * Returns the raw diff string.
 */
export async function getPullRequestDiff(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  const { data } = await octokit.pulls.get({
    owner,
    repo,
    pull_number: pullNumber,
    mediaType: { format: "diff" },
  });

  // When requesting diff format, data comes back as a string
  return data as unknown as string;
}

/**
 * Fetch the list of files changed in a pull request.
 */
export async function getPullRequestFiles(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number
) {
  const { data } = await octokit.pulls.listFiles({
    owner,
    repo,
    pull_number: pullNumber,
    per_page: 100,
  });

  return data;
}

/**
 * Post a review comment on a pull request.
 */
export async function createReviewComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  body: string,
  path: string,
  line: number
) {
  return octokit.pulls.createReviewComment({
    owner,
    repo,
    pull_number: pullNumber,
    commit_id: commitSha,
    body,
    path,
    line,
    side: "RIGHT",
  });
}

/**
 * Post a general comment (issue comment) on a pull request.
 */
export async function createPRComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  pullNumber: number,
  body: string
) {
  return octokit.issues.createComment({
    owner,
    repo,
    issue_number: pullNumber,
    body,
  });
}

/**
 * Parse "owner/repo" format into separate owner and repo strings.
 */
export function parseRepoFullName(fullName: string): {
  owner: string;
  repo: string;
} {
  const [owner, repo] = fullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repository full name: "${fullName}"`);
  }
  return { owner, repo };
}