import { Octokit } from "@octokit/rest";

/**
 * Create an authenticated Octokit instance using a user's personal access token.
 */
export function createUserOctokit(accessToken: string): Octokit {
  return new Octokit({ auth: accessToken });
}

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
