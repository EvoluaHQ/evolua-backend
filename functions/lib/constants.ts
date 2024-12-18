// for availabel GitHub events

export const SITE_URL = "https://evolua.io";

export const SUBSCRIPTION_TIERS = {
  FREE: {
    maxScans: 5,
    filesPerScan: 10,
    maxFileSize: 500_000, // 500 KB
  },
  PRO: {
    maxScans: 9999,
    filesPerScan: 100,
    maxFileSize: 1_000_000, // 1MB
  },
};
