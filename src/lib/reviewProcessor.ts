import { prisma } from "@/lib/prisma";
import { callGrok } from "@/lib/grok";
import {
  getPRFiles,
  postReviewComments,
  parseRepoFullName,
  buildDiffPositionMap,
  buildAnnotatedDiff,
} from "@/lib/github";
import type { PullRequestWebhookPayload } from "@/types/review";
import { Severity } from "@prisma/client";

// ---------------------------------------------------------------------------
// System prompt — instructs the LLM to use diff line numbers only
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You are a senior software engineer performing a code review. Analyze the provided annotated git diff and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

The diff is annotated with line numbers in the format "   42: +code here" or "   42:  context line".
The number before the colon is the exact file line number you MUST use in your "line" field.
Lines marked "DEL:" are deletions from the old file — you CANNOT comment on those. Only reference lines that have a number prefix.

The JSON must have exactly this shape:
{
  "summary": "2-3 sentence assessment of the overall PR quality and main concerns",
  "score": <integer 0-100 representing code quality>,
  "comments": [
    {
      "path": "exact/file/path.ts",
      "line": <the line number shown in the annotated diff — MUST be a number that appears in the diff>,
      "severity": "CRITICAL" | "WARNING" | "SUGGESTION",
      "comment": "Specific, actionable feedback explaining the issue and how to fix it"
    }
  ]
}

CRITICAL RULES:
- The "path" must EXACTLY match one of the "=== filename ===" headers in the diff.
- The "line" must be a number that appears as a prefix in the annotated diff for that file.
- Do NOT invent line numbers. Only use numbers you see in the diff.
- If you cannot find a suitable line number, omit the comment entirely.

Scoring guide: 90-100 = excellent, 70-89 = good with minor issues, 50-69 = needs work, below 50 = significant problems.
Focus only on: security vulnerabilities, logic bugs, unhandled errors, performance issues, missing null checks.
Ignore: code style, naming preferences, formatting.
Maximum 8 comments. If the code is clean, return an empty comments array.`;

// ---------------------------------------------------------------------------
// Response types from Grok
// ---------------------------------------------------------------------------

interface GrokComment {
  path: string;
  line: number;
  severity: string;
  comment: string;
}

interface GrokReviewResponse {
  summary: string;
  score: number;
  comments: GrokComment[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip accidental markdown code fences that Grok sometimes wraps around JSON.
 * Handles ```json ... ```, ``` ... ```, or bare JSON.
 */
function stripCodeFences(raw: string): string {
  let cleaned = raw.trim();

  // Remove opening fence: ```json or ```
  if (cleaned.startsWith("```")) {
    const firstNewline = cleaned.indexOf("\n");
    if (firstNewline !== -1) {
      cleaned = cleaned.slice(firstNewline + 1);
    }
  }

  // Remove closing fence
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3);
  }

  return cleaned.trim();
}

/**
 * Validate and coerce the severity string to a Prisma Severity enum value.
 */
function parseSeverity(raw: string): Severity {
  const upper = raw?.toUpperCase?.() ?? "";
  if (upper === "CRITICAL") return Severity.CRITICAL;
  if (upper === "WARNING") return Severity.WARNING;
  return Severity.SUGGESTION;
}

// ---------------------------------------------------------------------------
// Main review processor
// ---------------------------------------------------------------------------

/**
 * Full AI review pipeline:
 *   1. Fetch PR files via GitHub App installation auth
 *   2. Build annotated diff with line numbers + position map
 *   3. Call Grok for analysis (LLM sees exact line numbers)
 *   4. Parse the JSON response
 *   5. Map LLM line numbers → GitHub diff positions
 *   6. Persist Review + ReviewComment records in the DB
 *   7. Post the review back to GitHub with correct positions
 */
export async function processReview(
  payload: PullRequestWebhookPayload
): Promise<void> {
  const repoFullName = payload.repository.full_name;
  const prNumber = payload.pull_request.number;
  const prTitle = payload.pull_request.title;
  const prUrl = payload.pull_request.html_url;
  const headSha = payload.pull_request.head.sha;
  const installationId = payload.installation?.id;

  if (!installationId) {
    console.error(
      `[ReviewAI] No installation ID in webhook payload for ${repoFullName}#${prNumber}`
    );
    return;
  }

  const { owner, repo } = parseRepoFullName(repoFullName);

  console.log(
    `[ReviewAI] Starting review for ${repoFullName}#${prNumber} "${prTitle}"`
  );

  // -----------------------------------------------------------------------
  // 1. Fetch PR files
  // -----------------------------------------------------------------------

  const { files, truncated } = await getPRFiles(
    installationId,
    owner,
    repo,
    prNumber
  );

  if (files.length === 0) {
    console.log(
      `[ReviewAI] No reviewable files in ${repoFullName}#${prNumber}, skipping`
    );
    return;
  }

  // -----------------------------------------------------------------------
  // 2. Build annotated diff + position map
  // -----------------------------------------------------------------------

  const positionMap = buildDiffPositionMap(files);
  let annotatedDiff = buildAnnotatedDiff(files);

  if (truncated) {
    annotatedDiff += "\n\n[NOTE: Diff was truncated due to size limits. Some files were omitted from this review.]";
  }

  console.log(
    `[ReviewAI] Built position map for ${positionMap.size} files, ` +
    `annotated diff is ${annotatedDiff.length} chars`
  );

  // -----------------------------------------------------------------------
  // 3. Call Grok with annotated diff
  // -----------------------------------------------------------------------

  const userPrompt = `Here is the annotated diff for PR #${prNumber} titled '${prTitle}':\n\n${annotatedDiff}`;

  console.log(
    `[ReviewAI] Sending ${annotatedDiff.length} chars to Grok for ${repoFullName}#${prNumber}`
  );

  const rawResponse = await callGrok(SYSTEM_PROMPT, userPrompt);

  // -----------------------------------------------------------------------
  // 4. Parse the JSON response
  // -----------------------------------------------------------------------

  const cleanedResponse = stripCodeFences(rawResponse);

  let parsed: GrokReviewResponse;
  try {
    parsed = JSON.parse(cleanedResponse);
  } catch (parseError) {
    console.error(
      `[ReviewAI] Failed to parse Grok response as JSON for ${repoFullName}#${prNumber}:`,
      parseError instanceof Error ? parseError.message : parseError
    );
    console.error("[ReviewAI] Raw response:", rawResponse);
    return;
  }

  // Basic validation
  if (
    typeof parsed.summary !== "string" ||
    typeof parsed.score !== "number" ||
    !Array.isArray(parsed.comments)
  ) {
    console.error(
      `[ReviewAI] Grok response has unexpected shape for ${repoFullName}#${prNumber}:`,
      parsed
    );
    return;
  }

  // Clamp score to 0-100
  const score = Math.max(0, Math.min(100, Math.round(parsed.score)));
  const summary = parsed.summary;
  const comments = parsed.comments.slice(0, 8); // Cap at 8 comments

  // -----------------------------------------------------------------------
  // 5. Validate LLM comments against the position map
  // -----------------------------------------------------------------------

  const validComments: GrokComment[] = [];
  const invalidComments: GrokComment[] = [];

  for (const c of comments) {
    const filePositions = positionMap.get(c.path);
    if (filePositions && filePositions.has(c.line)) {
      validComments.push(c);
    } else {
      invalidComments.push(c);
      console.warn(
        `[ReviewAI] LLM referenced ${c.path}:${c.line} which is not in the diff — will add to fallback`
      );
    }
  }

  console.log(
    `[ReviewAI] Grok returned score ${score} with ${comments.length} comments ` +
    `(${validComments.length} resolved, ${invalidComments.length} fallback) ` +
    `for ${repoFullName}#${prNumber}`
  );

  // -----------------------------------------------------------------------
  // 6. Save to database
  // -----------------------------------------------------------------------

  // Look up the repository record (we need the repo ID for the Review FK)
  const repository = await prisma.repository.findFirst({
    where: { repoFullName, active: true },
  });

  if (!repository) {
    console.error(
      `[ReviewAI] Repository ${repoFullName} not found or inactive in DB — skipping DB save`
    );
    // Still attempt to post the review to GitHub even if DB save fails
  }

  let reviewId: string | undefined;

  if (repository) {
    try {
      const review = await prisma.review.create({
        data: {
          repoId: repository.id,
          prNumber,
          prTitle,
          prUrl,
          summary,
          score,
          rawResponse: parsed as object,
          comments: {
            create: [...validComments, ...invalidComments].map((c) => ({
              filePath: c.path,
              lineNumber: c.line,
              severity: parseSeverity(c.severity),
              comment: c.comment,
            })),
          },
        },
      });
      reviewId = review.id;
      console.log(
        `[ReviewAI] Saved review ${reviewId} to DB for ${repoFullName}#${prNumber}`
      );
    } catch (dbError) {
      console.error(
        `[ReviewAI] Failed to save review to DB for ${repoFullName}#${prNumber}:`,
        dbError instanceof Error ? dbError.message : dbError
      );
    }
  }

  // -----------------------------------------------------------------------
  // 7. Post review to GitHub with correct diff positions
  // -----------------------------------------------------------------------

  try {
    await postReviewComments(
      installationId,
      owner,
      repo,
      prNumber,
      headSha,
      [...validComments, ...invalidComments].map((c) => ({
        path: c.path,
        line: c.line,
        severity: c.severity,
        comment: c.comment,
      })),
      summary,
      score,
      positionMap
    );
    console.log(
      `[ReviewAI] Posted review to GitHub for ${repoFullName}#${prNumber}`
    );
  } catch (postError) {
    console.error(
      `[ReviewAI] Failed to post review to GitHub for ${repoFullName}#${prNumber}:`,
      postError instanceof Error ? postError.message : postError
    );
  }
}
