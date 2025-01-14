import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { idempotencyTableName, documentClient } from './dynamodb-helper';

const IDEMPOTENCY_TABLE = idempotencyTableName();

const getResult = async (id: string) => {
  const result = await documentClient.send(new GetCommand({
    TableName: IDEMPOTENCY_TABLE,
    Key: { id }
  }));

  if (!result.Item) {
    return null;
  } else {
    return JSON.parse(result.Item.result);
  }
}

const putResult = async (id: string, result: any) => {
  // set expiration to 1 hour from now (in seconds)
  const expiration = Math.floor(Date.now() / 1000) + 60 * 60

  await documentClient.send(new PutCommand({
    TableName: IDEMPOTENCY_TABLE,
    Item: { 
      id,
      expiration,
      result: JSON.stringify(result)
    }
  }));
}

export const executeIdempotently = async <T>(uniqId: string, f: () => Promise<T>): Promise<T> => {
  const result = await getResult(uniqId);

  if (result) {
    return result;
  }

  const newResult = await f();

  await putResult(uniqId, newResult);  
  return newResult;
}
