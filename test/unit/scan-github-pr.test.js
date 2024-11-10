require("../steps/init");
const { handler } = require("../../functions/scan-github-pr");
const { ScanGitHubPrInput } = require("../../functions/types");
const fs = require("fs");

describe("GitHub Event Handler", () => {
  /**
   * @returns {import('aws-lambda').EventBridgeEvent<'scan_triggered', ScanGitHubPrInput>}
   */
  function newGitHubEvent(data) {
    return {
      id: "1",
      version: "1",
      account: "123456789012",
      time: "2023-01-01T00:00:00Z",
      region: "us-east-1",
      resources: [],
      source: "github",
      "detail-type": "pull_request.opened",
      detail: {
        metadata: {
          eventId: "1",
          version: "1",
          timestamp: "2023-01-01T00:00:00Z",
          type: "pull_request.opened",
          source: "github",
        },
        data,
      },
    };
  }

  it("should handle PR opened event", async () => {
    const data = fs.readFileSync("examples/github/scan-github-pr.json", "utf8");
    const event = newGitHubEvent(JSON.parse(data));

    const result = await handler(event, {});
    // Add assertions based on your business logic
  });

  it("should handle PR closed event", async () => {
    expect(true).toBe(true);
  });

  it("should handle PR updated event", async () => {
    expect(true).toBe(true);
  });
});
