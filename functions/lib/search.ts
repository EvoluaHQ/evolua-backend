export const createNextToken = (searchParams: any) => {
  if (!searchParams) {
    return undefined;
  }

  const token = JSON.stringify(searchParams);
  return Buffer.from(token).toString('base64');
}

export const parseNextToken = (nextToken: string | undefined) => {
  if (!nextToken) {
    return undefined;
  }

  const token = Buffer.from(nextToken, 'base64').toString();
  return JSON.parse(token);
}
