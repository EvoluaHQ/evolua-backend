#!/usr/bin/env node

/**
 * This script uploads the Evolua configuration schema to a public URL
 * so it can be referenced in evolua.yml files.
 *
 * Usage:
 *   node scripts/publish-schema.js
 */

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

// Path to the schema file
const schemaPath = path.resolve(
  __dirname,
  "../schema/evolua-config-schema.json"
);

// Check if the schema file exists
if (!fs.existsSync(schemaPath)) {
  console.error("Error: Schema file not found at", schemaPath);
  process.exit(1);
}

// Read the schema file
const schema = fs.readFileSync(schemaPath, "utf8");

console.log("Schema file loaded successfully");
console.log("Schema size:", Buffer.byteLength(schema, "utf8"), "bytes");

// Upload the schema file to S3 (example - adjust for your infrastructure)
try {
  console.log("Uploading schema to S3...");

  // Example using AWS CLI - replace with your actual deployment method
  execSync(`aws s3 cp ${schemaPath} s3://YOUR-BUCKET-NAME/schema/evolua-config-schema.json \
    --content-type application/json \
    --cache-control "max-age=3600" \
    --acl public-read`);

  console.log("Invalidating CloudFront cache...");

  // Example CloudFront invalidation - replace with your actual distribution ID
  execSync(`aws cloudfront create-invalidation \
    --distribution-id YOUR-DISTRIBUTION-ID \
    --paths "/schema/evolua-config-schema.json"`);

  console.log("Schema published successfully!");
  console.log("URL: https://evolua.io/schema/evolua-config-schema.json");
} catch (error) {
  console.error("Error publishing schema:", error.message);
  process.exit(1);
}
