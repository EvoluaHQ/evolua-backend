const middy = require('@middy/core');
const ssm = require('@middy/ssm');
const github = require('./lib/github-helper');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const bedrockClient = new BedrockRuntimeClient();
const { GitHubEventDetail } = require('./github-pr-opened.event');

const { SSM_STAGE_NAME } = process.env;

/**
 * @param {import('aws-lambda').EventBridgeEvent<'pull_request.opened', GitHubEventDetail>} event
 */
const _handler = async (event, context) => {
  // see examples/github/pr-opened.json for an example event
  const detail = event.detail;
  
  const installationId = detail.data.installation.id;
  const ghAppId = context.GITHUB_APP_ID;
  const ghPrivateKey = context.GITHUB_PRIVATE_KEY;

  await github.init(ghAppId, ghPrivateKey, installationId);
  const prFileContent = await github.fetchPRFiles(
    detail.data.repository.owner.login,
    detail.data.repository.name,
    detail.data.pull_request.number
  );

  const promptTemplate = `Analyze the following source code for potential security vulnerabilities, code quality issues, and best practice violations.
  
List findings in <findings> tag using the following JSON format.
Do not provide any comment besides the findings list.

<JSON format>
{
  "summary": {
    "total_issues": <number>,
    "risk_levels": {
      "critical": <number>,
      "high": <number>,
      "medium": <number>,
      "low": <number>
    }
  },
  "issues": [
    {
      "id": "VULN-001",
      "type": "vulnerability|code_quality|best_practice",
      "risk_level": "critical|high|medium|low",
      "title": "Brief description",
      "location": {
        "line_start": <number>,
        "line_end": <number>
      },
      "description": "Detailed explanation of the issue",
      "impact": "Potential consequences",
      "recommendation": "How to fix",
      "cwe_id": "CWE-XXX (if applicable)"
    }
  ]
}
</JSON format>`;

  const scanResultPromises = prFileContent.map(async (file) => {
    const resp = await bedrockClient.send(new ConverseCommand({
      modelId: "anthropic.claude-instant-v1",
      messages: [{
        role: "user",
        content: [{
          text: `${promptTemplate}

<source code>
${file.content}
</source code>`
        }],
      }]
    }));

    const output = resp.output?.message?.content?.map(msg => msg.text).join('\n\n');

    const findingsRegex = /<findings>([\s\S]*?)<\/findings>/;
    const findings = JSON.parse(output.match(findingsRegex)[1]);
    if (findings.issues.length > 0) {
      console.log(`Found ${findings.issues.length} issues in ${file.path}`);
      
      const issues = findings.issues
        .map(issue => JSON.stringify(issue, null, 2))
        .map(json => `\`\`\`json\n${json}\n\`\`\``) // format as code block in GitHub
        .join('\n\n');
      const comment = `${file.path}: **${findings.issues.length} issues found**\n\n${issues}`;
      await github.commentOnPR(detail.data.pull_request.node_id, comment);
    }    
  });

  const allResults = await Promise.all(scanResultPromises);
};

module.exports.handler = middy(_handler)
.use(ssm({
  cache: true,
  cacheExpiry: 5 * 60 * 1000, // 5 mins
  setToContext: true,
  fetchData: {
    GITHUB_APP_ID: `/evolua/${SSM_STAGE_NAME}/github/app-id`,
    GITHUB_PRIVATE_KEY: `/evolua/${SSM_STAGE_NAME}/github/private-key`
  }
}));