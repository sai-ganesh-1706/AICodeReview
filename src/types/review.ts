import { Severity } from "@prisma/client";

/** Shape of a single file-level review comment from Grok */
export interface ReviewCommentData {
  filePath: string;
  lineNumber: number;
  severity: Severity;
  comment: string;
}

/** Complete review result returned by the AI analysis */
export interface ReviewResult {
  summary: string;
  score: number; // 0-100
  comments: ReviewCommentData[];
}

/** Webhook payload shape for pull_request events (subset) */
export interface PullRequestWebhookPayload {
  action: string;
  repository: {
    full_name: string;
  };
  pull_request: {
    number: number;
    title: string;
    html_url: string;
    head: {
      sha: string;
    };
  };
  installation?: {
    id: number;
  };
}

/** Dashboard review item for display */
export interface ReviewListItem {
  id: string;
  prNumber: number;
  prTitle: string;
  prUrl: string;
  summary: string;
  score: number;
  createdAt: string;
  commentsCount: number;
  repository: {
    repoFullName: string;
  };
}
