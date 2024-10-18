import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "@octokit/rest";

// Replace with your actual GitHub App ID
const appId = 1021917;

// The private key content, usually read from a file or stored in AWS Secrets Manager
const privateKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEAt8oGcqD/Md7X8zDh7xP/QyB1ShzkV5tzHlD2WZWqsmTPI5Ta
+S5VDTHROoEQEEB83FWvR6/BIUslYaVKdFuBFCqIr3MD876qDCTfMkee4dr/ktiO
0XYy5jm5vT4bT1HwKLyer+eJz+28D6uXTIYpMCiKQZK6E2mB47am5iPxyx9Vl6LT
pswATdCo7jXT+L5wvDEcMC63MvdOogQHlliUJh4nTbxZLLTRzXAkj879hfZP5mc9
5TReoeqGVoGwHGcV1sjFuruUV5AbSstCwjp8Wdjea/+31kKj0NdLsNMPE6ne3OrN
xcPuVWI/lvRTrA88XnNfM7qCYFfagxfmEhjo3wIDAQABAoIBAQCdQGQn7AytlOfc
knSd5NRBkSIJ2ZKeSslCpS9DE0XMAWkiHpkFH1lyQq+siQU/go3S0BV7Fqv+WpeP
Zqe/yxM0N/hfdd9pzDce0OWP1avhv0lxUY1RNvrx9W4wt1USlx8PG+QCye8mU1jX
Z4+60AepxuYUmQBQ37NdLMi8nQCjM6V4hOcOdA+CiIMtcYxfVB6cRxoFzxy7lFiW
vJbnZlVXDD+Zevt3cl1Q15+kI2bR692GsZ0W1NPM8xfY8ijYAX0DyV1ShWIw/7Xg
RCmH8DOInQ42j7je0GY2hzLSiShgMrmo6QxdpUgMJk8fx6Zk+eKM1BhLE7bSC2Yd
ZeeshEjxAoGBAO3q5211FMNKRZLJacpUU4Il6ufPUXMaRuqwh0dVTzaaajA0nrgE
GUyG9u0JCFvsyu6hfZ/XQ9ZlSbN/C7H/9xYRkjFU4YgA6oyopeaAqiBViaOzu/7G
VxvDrs2SQ2Y+aFClzLCbmSIJOCSw7Tea2ziCt2Z+sW+5bmZ11h9dOh1rAoGBAMXB
9ZwkUNiG2mXbElrPnPy86G4UsKjcVrT+DhZihc47TJMGn4wXiKAh79nffrsj5kov
GmB3GWq+0fGRC1GMKQxWb8wa94c8tzijwwzRWQLQfVO0EI55RkJqbpC4UuPSJYZP
SJpROvYAHMuymYC44TgepqCzAiSfXBlMFfiMsetdAoGBAIapXJAhorzefv6ULeKt
VA7oM0s9ltZVWype/FKtwIYhZFUgk22INGGSSpTjde3B2yKyGQ6touHotox4LkBz
poDBNUPizTxTeG5gznXnAWQHxj3370JHNOqsGXaVgLyQOi7biT209DnFiheKZNoC
Nm6H3hKPRxL7m7c2nxllhQ09AoGAKkBAa3XO2BQnwS9HAqPs1Iq/1hURkWJSHCVT
eTDfiapdt+PoXpQAmsXlatU3TGBlKWBa8FVB1u6iCEyG8ItTkdE93Yu9auVr9+v1
Fl37+H/25tVH3EjI3BPFP6JCA264mbOCvYWxZTGs9VBZP4lAhS73Rso4IP7zPGxn
HU1iDfkCgYBmNMKn8cKo87eMzOJEpFtQ5HXzt7weF7K3wV3AxjZSS7KPR1doZwoy
+YOqAgadNN6lLTBfb/9GhwacqBwjjJt5Pc+z8xaEeE9eDlKMwQmAYgyQO5cBZ5Gl
B0rsEinGVHOGn2MAzhd/jXgsEgwVVRGkEN5nHZk5WWgbac8kem+Sgg==
-----END RSA PRIVATE KEY-----`;

// Function to get Installation ID
export async function getInstallationId() {
  try {
    const octokit = new Octokit({
      authStrategy: createAppAuth,
      auth: {
        appId,
        privateKey,
      },
    });

    const { data: installations } = await octokit.rest.apps.listInstallations();
    installations.forEach((installation) => {
      console.log(`Installation ID: ${installation.id}`);
      console.log(`Account: ${installation.account?.login}`);
    });

    return installations[0]?.id;
  } catch (err) {
    console.error("Error fetching installation ID:", err);
    throw new Error("Error fetching installation ID");
  }
}

// Function to comment on a PR
export async function commentOnPR(
  owner: string,
  repo: string,
  pullNumber: number,
  commentBody: string
) {
  try {
    const installationId = await getInstallationId();
    const auth = createAppAuth({
      appId,
      privateKey,
      installationId,
    });

    // Get installation access token
    const installationAuth = await auth({ type: "installation" });
    const octokit = new Octokit({
      auth: installationAuth.token,
    });

    // Add a comment to the pull request
    const { data: comment } = await octokit.rest.issues.createComment({
      owner,
      repo,
      issue_number: pullNumber, // Pull requests are issues in the GitHub API
      body: commentBody,
    });

    console.log("Comment added:", comment);
  } catch (err) {
    console.error("Error adding comment to PR:", err);
  }
}

export async function printPRFilesAndContents(
  owner: string,
  repo: string,
  pullNumber: number
): Promise<string> {
  try {
    console.log("TEST --------------------------");
    let myfiles = {};
    const installationId = await getInstallationId();
    if (!installationId) {
      throw new Error("Installation ID not found.");
    }

    const auth = createAppAuth({
      appId,
      privateKey,
      installationId,
    });

    // Get installation access token
    const installationAuth = await auth({ type: "installation" });
    const octokit = new Octokit({
      auth: installationAuth.token,
    });

    // Get the Pull Request details
    const { data: pullRequest } = await octokit.rest.pulls.get({
      owner,
      repo,
      pull_number: pullNumber,
    });

    const headSha = pullRequest.head.sha;
    console.log(`PR Head SHA: ${headSha}`);

    // List files in the Pull Request
    const perPage = 100; // Maximum allowed per page
    let page = 1;
    let files: Octokit.PullsListFilesResponseItem[] = [];
    let response;

    do {
      response = await octokit.rest.pulls.listFiles({
        owner,
        repo,
        pull_number: pullNumber,
        per_page: perPage,
        page,
      });
      files = files.concat(response.data);
      page++;
    } while (response.data.length === perPage);

    console.log(`Total files in PR #${pullNumber}: ${files.length}`);

    for (const file of files) {
      const filePath = file.filename;
      console.log(`\nFile: ${filePath}`);

      try {
        // Get the file content at the head SHA
        const { data: contentData } = await octokit.rest.repos.getContent({
          owner,
          repo,
          path: filePath,
          ref: headSha,
        });

        if (Array.isArray(contentData)) {
          console.log("Directory contents, skipping...");
          continue;
        }

        if (contentData.type === "file" && contentData.content) {
          // Decode the base64 content
          const buffer = Buffer.from(contentData.content, "base64");
          const content = buffer.toString("utf-8");
          console.log(`Content of ${filePath}:\n${content}`);

          myfiles = { ...myfiles, [filePath]: content };
        } else {
          console.log(`Skipping ${filePath}, not a file.`);
        }
      } catch (fileErr: any) {
        if (fileErr.status === 404) {
          console.warn(`File not found: ${filePath} at SHA: ${headSha}`);
        } else {
          console.error(`Error fetching content for ${filePath}:`, fileErr);
        }
      }
    }

    console.log("PROMPT >>>>>> ", JSON.stringify(myfiles));

    return JSON.stringify(myfiles);
  } catch (err) {
    console.error("Error printing PR files and contents:", err);
    return "";
  }
}
