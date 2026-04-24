import { and, eq } from "drizzle-orm"
import { ulid } from "ulid"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppBindings } from "../env.js"
import {
  fetchGithubRepositoryPermission,
  listGithubUserInstallationRepositories,
  listGithubUserInstallations,
  refreshGithubOAuthToken,
  type GithubAuthenticatedUser,
  type GithubInstallationRepository,
  type GithubUserAccessToken,
  type GithubUserInstallation,
} from "../github-api.js"
import { decryptSecret, encryptSecret } from "../security/encryption.js"

type AppDb = ReturnType<typeof getDb>
const GITHUB_USER_TOKEN_REFRESH_SKEW_MS = 5 * 60 * 1000

export interface CurrentUserRow {
  avatarUrl: string | null
  createdAt: string
  githubUserId: number
  id: string
  login: string
  name: string | null
  updatedAt: string
}

export async function upsertUserWithGithubToken(
  env: AppBindings,
  githubUser: GithubAuthenticatedUser,
  githubToken: GithubUserAccessToken,
) {
  const db = getDb(env)
  const timestamp = new Date().toISOString()
  const existingUser = await selectOne(
    db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.githubUserId, githubUser.githubUserId))
      .limit(1),
  )
  const userId = existingUser?.id ?? ulid()

  if (existingUser) {
    await db
      .update(schema.users)
      .set({
        avatarUrl: githubUser.avatarUrl,
        login: githubUser.login,
        name: githubUser.name,
        updatedAt: timestamp,
      })
      .where(eq(schema.users.id, userId))
  } else {
    await db.insert(schema.users).values({
      id: userId,
      avatarUrl: githubUser.avatarUrl,
      createdAt: timestamp,
      githubUserId: githubUser.githubUserId,
      login: githubUser.login,
      name: githubUser.name,
      updatedAt: timestamp,
    })
  }

  await upsertUserGithubToken(db, env, userId, githubToken, timestamp)

  return {
    ...githubUser,
    id: userId,
  }
}

export async function getUserGithubAccessToken(env: AppBindings, userId: string) {
  const db = getDb(env)
  const tokenRow = await selectOne(
    db
      .select({
        accessTokenExpiresAt: schema.githubUserTokens.accessTokenExpiresAt,
        encryptedAccessToken: schema.githubUserTokens.encryptedAccessToken,
        encryptedRefreshToken: schema.githubUserTokens.encryptedRefreshToken,
        refreshTokenExpiresAt: schema.githubUserTokens.refreshTokenExpiresAt,
      })
      .from(schema.githubUserTokens)
      .where(eq(schema.githubUserTokens.userId, userId))
      .limit(1),
  )

  if (!tokenRow) {
    throw new Error("The current user does not have a stored GitHub access token.")
  }

  if (!shouldRefreshGithubUserToken(tokenRow.accessTokenExpiresAt)) {
    return decryptSecret(env, tokenRow.encryptedAccessToken)
  }

  if (!tokenRow.encryptedRefreshToken) {
    throw new Error("The current GitHub access token has expired. Sign in again.")
  }

  if (isExpiredOrExpiring(tokenRow.refreshTokenExpiresAt)) {
    throw new Error("The current GitHub refresh token has expired. Sign in again.")
  }

  const refreshToken = await decryptSecret(env, tokenRow.encryptedRefreshToken)
  const refreshedToken = await refreshGithubOAuthToken(env, refreshToken)
  await upsertUserGithubToken(db, env, userId, refreshedToken, new Date().toISOString())

  return refreshedToken.accessToken
}

export async function requireRepositoryAdminForUser(
  env: AppBindings,
  user: CurrentUserRow,
  owner: string,
  repositoryName: string,
) {
  const accessToken = await getUserGithubAccessToken(env, user.id)
  await requireRepositoryAdminWithAccessToken(accessToken, user, owner, repositoryName)
}

async function requireRepositoryAdminWithAccessToken(
  accessToken: string,
  user: CurrentUserRow,
  owner: string,
  repositoryName: string,
) {
  const permission = await fetchGithubRepositoryPermission(
    accessToken,
    owner,
    repositoryName,
    user.login,
  )

  if (permission !== "admin") {
    throw new OnboardingAuthorizationError("Repository admin permission is required.")
  }
}

async function requireInstallationWithAccessToken(accessToken: string, installationId: number) {
  const installations = await listGithubUserInstallations(accessToken)
  const installation = installations.find(
    (candidate) => candidate.installationId === installationId,
  )

  if (!installation) {
    throw new OnboardingAuthorizationError(
      "The GitHub App installation is not accessible to the current user.",
    )
  }

  return installation
}

export async function syncInstallationForUser(
  env: AppBindings,
  user: CurrentUserRow,
  installationId: number,
) {
  const accessToken = await getUserGithubAccessToken(env, user.id)
  const installation = await requireInstallationWithAccessToken(accessToken, installationId)

  const repositories = await listGithubUserInstallationRepositories(accessToken, installationId)
  await persistInstallation(env, installation, repositories)

  return {
    installation,
    repositories,
  }
}

export async function listStoredInstallationsForUser(env: AppBindings, user: CurrentUserRow) {
  const accessToken = await getUserGithubAccessToken(env, user.id)
  const installations = await listGithubUserInstallations(accessToken)

  for (const installation of installations) {
    const repositories = await listGithubUserInstallationRepositories(
      accessToken,
      installation.installationId,
    )
    await persistInstallation(env, installation, repositories)
  }

  return installations
}

export async function enableRepositoryForUser(
  env: AppBindings,
  user: CurrentUserRow,
  installationId: number,
  owner: string,
  repositoryName: string,
) {
  const db = getDb(env)
  const accessToken = await getUserGithubAccessToken(env, user.id)
  await requireRepositoryAdminWithAccessToken(accessToken, user, owner, repositoryName)

  const installationRepository = await selectOne(
    db
      .select()
      .from(schema.githubInstallationRepositories)
      .where(
        and(
          eq(schema.githubInstallationRepositories.installationId, installationId),
          eq(schema.githubInstallationRepositories.owner, owner),
          eq(schema.githubInstallationRepositories.name, repositoryName),
          eq(schema.githubInstallationRepositories.accessStatus, "active"),
        ),
      )
      .limit(1),
  )

  if (!installationRepository) {
    throw new OnboardingAuthorizationError(
      "The GitHub App installation does not have access to this repository.",
    )
  }

  const installation = await selectOne(
    db
      .select()
      .from(schema.githubAppInstallations)
      .where(
        eq(schema.githubAppInstallations.installationId, installationRepository.installationId),
      )
      .limit(1),
  )

  if (!installation || installation.deletedAt || installation.suspendedAt) {
    throw new OnboardingAuthorizationError("The GitHub App installation is not active.")
  }

  const timestamp = new Date().toISOString()
  const currentRepositories = await listGithubUserInstallationRepositories(
    accessToken,
    installation.installationId,
  )
  const currentRepository = currentRepositories.find(
    (repository) => repository.githubRepoId === installationRepository.githubRepoId,
  )

  if (!currentRepository) {
    await markInstallationRepositoryRemoved(
      db,
      installation.installationId,
      installationRepository.githubRepoId,
      timestamp,
    )
    throw new OnboardingAuthorizationError(
      "The GitHub App installation does not have access to this repository.",
    )
  }

  await upsertInstallationRepository(db, installation.installationId, currentRepository, timestamp)

  if (currentRepository.private) {
    await syncStoredRepositoryMetadata(
      db,
      installation.accountId,
      installation.installationId,
      currentRepository,
      timestamp,
    )
    throw new OnboardingAuthorizationError("Private repositories are not supported in V1.")
  }

  const existingRepository = await selectOne(
    db
      .select({ id: schema.repositories.id })
      .from(schema.repositories)
      .where(eq(schema.repositories.githubRepoId, currentRepository.githubRepoId))
      .limit(1),
  )

  if (existingRepository) {
    await db
      .update(schema.repositories)
      .set({
        accountId: installation.accountId,
        deletedAt: null,
        disabledAt: null,
        enabled: 1,
        installationId: installation.installationId,
        name: currentRepository.name,
        owner: currentRepository.owner.login,
        updatedAt: timestamp,
        visibility: "public",
      })
      .where(eq(schema.repositories.id, existingRepository.id))

    return existingRepository.id
  }

  const repositoryId = ulid()

  await db.insert(schema.repositories).values({
    id: repositoryId,
    accountId: installation.accountId,
    createdAt: timestamp,
    disabledAt: null,
    enabled: 1,
    githubRepoId: currentRepository.githubRepoId,
    installationId: installation.installationId,
    name: currentRepository.name,
    owner: currentRepository.owner.login,
    updatedAt: timestamp,
    visibility: "public",
  })

  return repositoryId
}

export class OnboardingAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "OnboardingAuthorizationError"
  }
}

async function upsertUserGithubToken(
  db: AppDb,
  env: Pick<AppBindings, "AUTH_ENCRYPTION_KEY">,
  userId: string,
  githubToken: GithubUserAccessToken,
  timestamp: string,
) {
  const encryptedAccessToken = await encryptSecret(env, githubToken.accessToken)
  const encryptedRefreshToken = githubToken.refreshToken
    ? await encryptSecret(env, githubToken.refreshToken)
    : null

  await db
    .insert(schema.githubUserTokens)
    .values({
      userId,
      accessTokenExpiresAt: githubToken.accessTokenExpiresAt,
      encryptedAccessToken,
      encryptedRefreshToken,
      refreshTokenExpiresAt: githubToken.refreshTokenExpiresAt,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    .onConflictDoUpdate({
      target: schema.githubUserTokens.userId,
      set: {
        accessTokenExpiresAt: githubToken.accessTokenExpiresAt,
        encryptedAccessToken,
        encryptedRefreshToken,
        refreshTokenExpiresAt: githubToken.refreshTokenExpiresAt,
        updatedAt: timestamp,
      },
    })
}

function shouldRefreshGithubUserToken(accessTokenExpiresAt: string | null) {
  return accessTokenExpiresAt ? isExpiredOrExpiring(accessTokenExpiresAt) : false
}

function isExpiredOrExpiring(expiresAt: string | null) {
  if (!expiresAt) {
    return false
  }

  const expiresAtMs = Date.parse(expiresAt)

  return (
    !Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now() + GITHUB_USER_TOKEN_REFRESH_SKEW_MS
  )
}

async function persistInstallation(
  env: AppBindings,
  installation: GithubUserInstallation,
  repositories: GithubInstallationRepository[],
) {
  const db = getDb(env)
  const timestamp = new Date().toISOString()
  const accountId = await upsertGithubAccount(db, installation.account, timestamp)
  const existingInstallation = await selectOne(
    db
      .select({ id: schema.githubAppInstallations.id })
      .from(schema.githubAppInstallations)
      .where(eq(schema.githubAppInstallations.installationId, installation.installationId))
      .limit(1),
  )
  const installationRowId = existingInstallation?.id ?? ulid()

  if (existingInstallation) {
    await db
      .update(schema.githubAppInstallations)
      .set({
        accountId,
        deletedAt: null,
        permissionsJson: JSON.stringify(installation.permissions),
        suspendedAt: installation.suspendedAt,
        targetType: installation.targetType,
        updatedAt: timestamp,
      })
      .where(eq(schema.githubAppInstallations.id, installationRowId))
  } else {
    await db.insert(schema.githubAppInstallations).values({
      id: installationRowId,
      accountId,
      createdAt: timestamp,
      deletedAt: null,
      installationId: installation.installationId,
      permissionsJson: JSON.stringify(installation.permissions),
      suspendedAt: installation.suspendedAt,
      targetType: installation.targetType,
      updatedAt: timestamp,
    })
  }

  for (const repository of repositories) {
    await upsertInstallationRepository(db, installation.installationId, repository, timestamp)
    await syncStoredRepositoryMetadata(
      db,
      accountId,
      installation.installationId,
      repository,
      timestamp,
    )
  }
}

async function upsertGithubAccount(
  db: AppDb,
  account: GithubUserInstallation["account"],
  timestamp: string,
) {
  const existingAccount = await selectOne(
    db
      .select({ id: schema.githubAccounts.id })
      .from(schema.githubAccounts)
      .where(eq(schema.githubAccounts.githubAccountId, account.githubAccountId))
      .limit(1),
  )

  if (existingAccount) {
    await db
      .update(schema.githubAccounts)
      .set({
        accountType: account.type,
        avatarUrl: account.avatarUrl,
        login: account.login,
        updatedAt: timestamp,
      })
      .where(eq(schema.githubAccounts.id, existingAccount.id))

    return existingAccount.id
  }

  const accountId = ulid()

  await db.insert(schema.githubAccounts).values({
    id: accountId,
    accountType: account.type,
    avatarUrl: account.avatarUrl,
    createdAt: timestamp,
    githubAccountId: account.githubAccountId,
    login: account.login,
    updatedAt: timestamp,
  })

  return accountId
}

async function upsertInstallationRepository(
  db: AppDb,
  installationId: number,
  repository: GithubInstallationRepository,
  timestamp: string,
) {
  const existingRepository = await selectOne(
    db
      .select({ id: schema.githubInstallationRepositories.id })
      .from(schema.githubInstallationRepositories)
      .where(
        and(
          eq(schema.githubInstallationRepositories.installationId, installationId),
          eq(schema.githubInstallationRepositories.githubRepoId, repository.githubRepoId),
        ),
      )
      .limit(1),
  )

  if (existingRepository) {
    await db
      .update(schema.githubInstallationRepositories)
      .set({
        accessStatus: "active",
        name: repository.name,
        owner: repository.owner.login,
        private: repository.private ? 1 : 0,
        updatedAt: timestamp,
      })
      .where(eq(schema.githubInstallationRepositories.id, existingRepository.id))
    return
  }

  await db.insert(schema.githubInstallationRepositories).values({
    id: ulid(),
    accessStatus: "active",
    createdAt: timestamp,
    githubRepoId: repository.githubRepoId,
    installationId,
    name: repository.name,
    owner: repository.owner.login,
    private: repository.private ? 1 : 0,
    updatedAt: timestamp,
  })
}

async function syncStoredRepositoryMetadata(
  db: AppDb,
  accountId: string,
  installationId: number,
  repository: GithubInstallationRepository,
  timestamp: string,
) {
  const updates = {
    accountId,
    installationId,
    name: repository.name,
    owner: repository.owner.login,
    updatedAt: timestamp,
    visibility: repository.private ? "private" : "public",
  }

  await db
    .update(schema.repositories)
    .set(
      repository.private
        ? {
            ...updates,
            disabledAt: timestamp,
            enabled: 0,
          }
        : updates,
    )
    .where(eq(schema.repositories.githubRepoId, repository.githubRepoId))
}

async function markInstallationRepositoryRemoved(
  db: AppDb,
  installationId: number,
  githubRepoId: number,
  timestamp: string,
) {
  await db
    .update(schema.githubInstallationRepositories)
    .set({ accessStatus: "removed", updatedAt: timestamp })
    .where(
      and(
        eq(schema.githubInstallationRepositories.installationId, installationId),
        eq(schema.githubInstallationRepositories.githubRepoId, githubRepoId),
      ),
    )

  await db
    .update(schema.repositories)
    .set({ disabledAt: timestamp, enabled: 0, updatedAt: timestamp })
    .where(
      and(
        eq(schema.repositories.installationId, installationId),
        eq(schema.repositories.githubRepoId, githubRepoId),
      ),
    )
}
