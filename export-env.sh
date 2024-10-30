#!/bin/bash

# Ensure AWS CLI is installed
if ! command -v aws &> /dev/null
then
    echo "aws CLI is not installed or not in the PATH. Please install it and try again."
    exit 1
fi

# Ensure jq is installed
if ! command -v jq &> /dev/null
then
    echo "jq is not installed or not in the PATH. Please install it and try again."
    exit 1
fi

# Get CloudFormation stack name and region as arguments
STAGE_NAME=$1
REGION=$2
OUTPUT_FILE=$3

if [ -z "$STAGE_NAME" ] || [ -z "$REGION" ]
then
    echo "Usage: $0 <STAGE_NAME> <REGION> <Optional: OUTPUT_FILE>"
    exit 1
fi

if [ -z "$OUTPUT_FILE" ]
then
    OUTPUT_FILE=".env"
fi

echo "Running..."

# Create or overwrite the output file
> $OUTPUT_FILE

# Capture the outputs of the data stack, that's all we need (for now)
STACK_NAME="EvoluaDataStack-$STAGE_NAME"

# Iterate through the outputs of the CloudFormation stack
for OUTPUT_KEY in $(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" | jq -r '.Stacks[0].Outputs[].OutputKey')
do
    OUTPUT_VALUE=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" | jq -r --arg OUTPUT_KEY "$OUTPUT_KEY" '.Stacks[0].Outputs[] | select(.OutputKey==$OUTPUT_KEY) .OutputValue')
    
    # Check if the key already exists in the output file
    if ! grep -q "^$OUTPUT_KEY=" $OUTPUT_FILE; then
        echo "$OUTPUT_KEY=$OUTPUT_VALUE" >> $OUTPUT_FILE
    fi
done

echo "$OUTPUT_FILE file has been created/updated with environment variables from Lambda functions and CloudFormation stack outputs."