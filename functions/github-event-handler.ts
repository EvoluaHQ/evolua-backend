// Import necessary modules and types
import { EventBridgeEvent, APIGatewayProxyResult } from "aws-lambda";
import { ulid } from "ulid";
import { publishEvent, saveEvent } from "./lib/events";
import { commentOnPR, printPRFilesAndContents } from "./lib/github-helper";

// Define the structure of the event detail for GitHub events
interface GitHubEventDetail {
  metadata: {
    eventId: string;
    version: string;
    timestamp: string;
    type: string;
  };
  data: any;
}

// Define the specific event type you expect
type MyEventType = "clerk:webhook" | "github:pull_request";

// Handler for EventBridge events
export const handler = async (
  event: EventBridgeEvent<MyEventType, GitHubEventDetail>
): Promise<APIGatewayProxyResult> => {
  const detail = event.detail;

  try {
    // Generate a unique event ID
    const eventId = ulid();

    // Publish and save the event using your events library
    await publishEvent(eventId, detail.metadata.type, "webhook", detail.data);
    await saveEvent(
      "default-tenant",
      eventId,
      detail.metadata.type,
      "webhook",
      detail.data
    );

    // If the event is a GitHub pull request event, handle it accordingly
    if (event["detail-type"] === "github:pull_request") {
      const body = detail.data;

      // Extract necessary information from the received body
      const repoOwner = body.repository.owner.login;
      const repo = body.repository.name;
      const pullNumber = body.pull_request.number;

      // Fetch PR files and their contents
      const prFiles = await printPRFilesAndContents(
        repoOwner,
        repo,
        pullNumber
      );
      console.log("PR Files and Contents:", prFiles);

      // Comment on the pull request
      await commentOnPR(
        repoOwner,
        repo,
        pullNumber,
        "Automated comment from Lambda function."
      );

      console.log("Successfully commented on the pull request.");
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Event processed successfully.",
      }),
    };
  } catch (err) {
    console.error("Error processing event:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "An error occurred while processing the event.",
        error: err instanceof Error ? err.message : "Unknown error",
      }),
    };
  }
};
