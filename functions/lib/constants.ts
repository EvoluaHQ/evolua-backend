// for availabel GitHub events

import { Tier } from "./users";

export const SITE_URL = "https://evolua.io";

// TODO: Temporary
export const ANTHROPIC_API_KEY =
  "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";

// see https://docs.github.com/en/rest/using-the-rest-api/github-event-types
export const GH_PR_ACTIONS = [
  "opened",
  "edited",
  "closed",
  "reopened",
  "assigned",
  "unassigned",
  "review_requested",
  "review_request_removed",
  "labeled",
  "unlabeled",
];
export const GH_PR_REVIEW_ACTIONS = ["created"];
export const GH_PR_REVIEW_COMMENT_ACTIONS = ["created"];
export const GH_PR_REVIEW_THREAD_ACTIONS = ["resolved", "unresolved"];
export const GH_INSTALL_ACTIONS = ["added", "removed"];
export const SUBSCRIPTION_TIERS = {
  [Tier.FREE]: {
    maxScans: 5,
    filesPerScan: 10,
    maxFileSize: 500_000, // 500 KB
  },
  [Tier.PRO]: {
    maxScans: 100,
    filesPerScan: 100,
    maxFileSize: 1_000_000, // 1MB
  },
};
