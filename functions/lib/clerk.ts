import { createClerkClient, ClerkClient } from '@clerk/backend'

let clerkClient: ClerkClient

export const initClerk = (secretKey: string) => {
  clerkClient = createClerkClient({
    secretKey
  })
}

export type UserMetadata = {
  githubAccessToken?: string
  githubRefreshToken?: string
  githubTokenExpiresAt?: number
}

export const getUserMetadata = async (clerkUserId: string): Promise<UserMetadata> => {
  const clerkUser = await clerkClient.users.getUser(clerkUserId)
  return clerkUser.privateMetadata as UserMetadata
}

export async function disableOrgCreation(userId: string): Promise<void> {
  await clerkClient.users.updateUser(userId, {
    createOrganizationEnabled: false,
    createOrganizationsLimit: 0,
  });
}
