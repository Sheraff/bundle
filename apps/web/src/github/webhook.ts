import { verify } from "@octokit/webhooks-methods"
import { and, eq, inArray } from "drizzle-orm"
import type { Hono } from "hono"
import { ulid } from "ulid"
import * as v from "valibot"

import { getDb, schema } from "../db/index.js"
import { selectOne } from "../db/select-one.js"
import type { AppEnv } from "../env.js"
import { formatIssues } from "../shared/format-issues.js"

type AppDb = ReturnType<typeof getDb>

interface WebhookRepository {
  githubRepoId: number
  name: string
  owner: string
  private: boolean
}

interface WebhookAccount {
  accountType: string
  avatarUrl: string | null
  githubAccountId: number
  login: string
}

export function registerGithubWebhookRoutes(app: Hono<AppEnv>) {
  app.post("/api/v1/github/webhooks", async (c) => {
    const rawBody = await c.req.text()
    const signature = c.req.header("x-hub-signature-256")

    if (!(await verifyGithubWebhookSignature(c.env, rawBody, signature))) {
      return c.json(
        { error: { code: "invalid_signature", message: "The webhook signature is invalid." } },
        401,
      )
    }

    const eventName = c.req.header("x-github-event")
    const parsedPayload = parseWebhookPayload(rawBody)

    if (!parsedPayload.success) {
      return c.json(
        {
          error: {
            code: "invalid_webhook_payload",
            message: parsedPayload.message,
          },
        },
        400,
      )
    }

    const payload = parsedPayload.output

    switch (eventName) {
      case "installation":
        await handleInstallationWebhook(c.env, payload)
        break
      case "installation_repositories":
        await handleInstallationRepositoriesWebhook(c.env, payload)
        break
      case "repository":
        await handleRepositoryWebhook(c.env, payload)
        break
      default:
        break
    }

    return c.json({ ok: true })
  })
}

export async function verifyGithubWebhookSignature(
  env: Pick<AppEnv["Bindings"], "GITHUB_WEBHOOK_SECRET">,
  rawBody: string,
  signatureHeader?: string,
) {
  if (!env.GITHUB_WEBHOOK_SECRET || !signatureHeader?.startsWith("sha256=")) {
    return false
  }

  try {
    return await verify(env.GITHUB_WEBHOOK_SECRET, rawBody, signatureHeader)
  } catch {
    return false
  }
}

const githubWebhookAccountSchema = v.object({
  avatar_url: v.optional(v.nullable(v.string())),
  id: v.optional(v.number()),
  login: v.optional(v.string()),
  type: v.optional(v.string()),
})
const githubWebhookInstallationSchema = v.object({
  account: v.optional(v.nullable(githubWebhookAccountSchema)),
  id: v.optional(v.number()),
  permissions: v.optional(v.record(v.string(), v.unknown())),
  suspended_at: v.optional(v.nullable(v.string())),
  target_type: v.optional(v.string()),
})
const githubWebhookRepositorySchema = v.object({
  full_name: v.optional(v.string()),
  id: v.optional(v.number()),
  name: v.optional(v.string()),
  owner: v.optional(v.nullable(v.object({ login: v.optional(v.string()) }))),
  private: v.optional(v.boolean()),
})
const githubWebhookPayloadSchema = v.object({
  action: v.optional(v.string()),
  installation: v.optional(githubWebhookInstallationSchema),
  repositories: v.optional(v.array(githubWebhookRepositorySchema)),
  repositories_added: v.optional(v.array(githubWebhookRepositorySchema)),
  repositories_removed: v.optional(v.array(v.object({ id: v.optional(v.number()) }))),
  repository: v.optional(githubWebhookRepositorySchema),
})

type GithubWebhookAccount = v.InferOutput<typeof githubWebhookAccountSchema>
type GithubWebhookInstallation = v.InferOutput<typeof githubWebhookInstallationSchema>
type GithubWebhookPayload = v.InferOutput<typeof githubWebhookPayloadSchema>

function parseWebhookPayload(rawBody: string) {
  let payload: unknown

  try {
    payload = JSON.parse(rawBody)
  } catch {
    return {
      success: false as const,
      message: "The webhook payload must be valid JSON.",
    }
  }

  const payloadResult = v.safeParse(githubWebhookPayloadSchema, payload)

  if (!payloadResult.success) {
    return {
      success: false as const,
      message: formatIssues(payloadResult.issues),
    }
  }

  return {
    success: true as const,
    output: payloadResult.output,
  }
}

async function handleInstallationWebhook(env: AppEnv["Bindings"], payload: GithubWebhookPayload) {
  const installationId = payload.installation?.id

  if (!installationId) {
    return
  }

  const timestamp = new Date().toISOString()
  const db = getDb(env)

  if (payload.action === "created") {
    await persistCreatedInstallationWebhook(db, payload, installationId, timestamp)
    return
  }

  if (payload.action === "deleted") {
    await db
      .update(schema.githubAppInstallations)
      .set({ deletedAt: timestamp, updatedAt: timestamp })
      .where(eq(schema.githubAppInstallations.installationId, installationId))
    await db
      .update(schema.githubInstallationRepositories)
      .set({ accessStatus: "removed", updatedAt: timestamp })
      .where(eq(schema.githubInstallationRepositories.installationId, installationId))
    await db
      .update(schema.repositories)
      .set({ disabledAt: timestamp, enabled: 0, updatedAt: timestamp })
      .where(eq(schema.repositories.installationId, installationId))
    return
  }

  if (payload.action === "suspend") {
    await db
      .update(schema.githubAppInstallations)
      .set({ suspendedAt: timestamp, updatedAt: timestamp })
      .where(eq(schema.githubAppInstallations.installationId, installationId))
    return
  }

  if (payload.action === "unsuspend") {
    await db
      .update(schema.githubAppInstallations)
      .set({ suspendedAt: null, updatedAt: timestamp })
      .where(eq(schema.githubAppInstallations.installationId, installationId))
  }
}

async function handleInstallationRepositoriesWebhook(
  env: AppEnv["Bindings"],
  payload: GithubWebhookPayload,
) {
  const installationId = payload.installation?.id

  if (!installationId) {
    return
  }

  const timestamp = new Date().toISOString()
  const db = getDb(env)
  const installation = await selectOne(
    db
      .select({ accountId: schema.githubAppInstallations.accountId })
      .from(schema.githubAppInstallations)
      .where(eq(schema.githubAppInstallations.installationId, installationId))
      .limit(1),
  )
  const addedRepositories = parseWebhookRepositories(payload.repositories_added ?? [])
  const removedRepoIds = (payload.repositories_removed ?? [])
    .map((repository) => repository.id)
    .filter((id): id is number => typeof id === "number")

  for (const repository of addedRepositories) {
    await upsertWebhookInstallationRepository(db, installationId, repository, timestamp)
    await syncWebhookRepositoryMetadata(
      db,
      installationId,
      installation?.accountId ?? null,
      repository,
      timestamp,
    )
  }

  if (removedRepoIds.length > 0) {
    await db
      .update(schema.githubInstallationRepositories)
      .set({ accessStatus: "removed", updatedAt: timestamp })
      .where(
        and(
          eq(schema.githubInstallationRepositories.installationId, installationId),
          inArray(schema.githubInstallationRepositories.githubRepoId, removedRepoIds),
        ),
      )
    await db
      .update(schema.repositories)
      .set({ disabledAt: timestamp, enabled: 0, updatedAt: timestamp })
      .where(
        and(
          eq(schema.repositories.installationId, installationId),
          inArray(schema.repositories.githubRepoId, removedRepoIds),
        ),
      )
  }
}

async function handleRepositoryWebhook(env: AppEnv["Bindings"], payload: GithubWebhookPayload) {
  const repository = payload.repository
  const installationId = payload.installation?.id

  if (!repository?.id) {
    return
  }

  const timestamp = new Date().toISOString()
  const db = getDb(env)

  if (payload.action === "deleted" || payload.action === "transferred") {
    await db
      .update(schema.repositories)
      .set({ deletedAt: timestamp, disabledAt: timestamp, enabled: 0, updatedAt: timestamp })
      .where(repositoryWebhookPredicate(repository.id, installationId))
    await db
      .update(schema.githubInstallationRepositories)
      .set({ accessStatus: "removed", updatedAt: timestamp })
      .where(installationRepositoryWebhookPredicate(repository.id, installationId))
    return
  }

  const webhookRepository =
    typeof repository.name === "string" && typeof repository.owner?.login === "string"
      ? {
          githubRepoId: repository.id,
          name: repository.name,
          owner: repository.owner.login,
          private: repository.private ?? false,
        }
      : null
  const updates = {
    ...(repository.owner?.login ? { owner: repository.owner.login } : {}),
    ...(repository.name ? { name: repository.name } : {}),
    ...(typeof repository.private === "boolean"
      ? { visibility: repository.private ? "private" : "public" }
      : {}),
    updatedAt: timestamp,
  }

  await db
    .update(schema.repositories)
    .set({
      ...updates,
      ...(repository.private ? { disabledAt: timestamp, enabled: 0 } : {}),
    })
    .where(repositoryWebhookPredicate(repository.id, installationId))

  if (webhookRepository) {
    await db
      .update(schema.githubInstallationRepositories)
      .set({
        name: webhookRepository.name,
        owner: webhookRepository.owner,
        private: webhookRepository.private ? 1 : 0,
        updatedAt: timestamp,
      })
      .where(installationRepositoryWebhookPredicate(webhookRepository.githubRepoId, installationId))
  }
}

function repositoryWebhookPredicate(githubRepoId: number, installationId?: number) {
  return installationId
    ? and(
        eq(schema.repositories.githubRepoId, githubRepoId),
        eq(schema.repositories.installationId, installationId),
      )
    : eq(schema.repositories.githubRepoId, githubRepoId)
}

function installationRepositoryWebhookPredicate(githubRepoId: number, installationId?: number) {
  return installationId
    ? and(
        eq(schema.githubInstallationRepositories.githubRepoId, githubRepoId),
        eq(schema.githubInstallationRepositories.installationId, installationId),
      )
    : eq(schema.githubInstallationRepositories.githubRepoId, githubRepoId)
}

function parseWebhookRepositories(
  repositories: NonNullable<GithubWebhookPayload["repositories_added"]>,
  fallbackOwner?: string,
) {
  return repositories.flatMap((repository): WebhookRepository[] => {
    const owner = repository.owner?.login ?? parseRepositoryOwnerFromFullName(repository.full_name)
    const name = repository.name ?? parseRepositoryNameFromFullName(repository.full_name)

    if (typeof repository.id !== "number" || !name) {
      return []
    }

    const resolvedOwner = owner ?? fallbackOwner

    if (!resolvedOwner) {
      return []
    }

    return [
      {
        githubRepoId: repository.id,
        name,
        owner: resolvedOwner,
        private: repository.private ?? false,
      },
    ]
  })
}

async function persistCreatedInstallationWebhook(
  db: AppDb,
  payload: GithubWebhookPayload,
  installationId: number,
  timestamp: string,
) {
  const account = parseWebhookAccount(
    payload.installation?.account,
    payload.installation?.target_type,
  )

  if (!account || !payload.installation) {
    return
  }

  const accountId = await upsertWebhookGithubAccount(db, account, timestamp)
  await upsertWebhookInstallation(
    db,
    payload.installation,
    installationId,
    accountId,
    account,
    timestamp,
  )

  const repositories = parseWebhookRepositories(payload.repositories ?? [], account.login)

  for (const repository of repositories) {
    await upsertWebhookInstallationRepository(db, installationId, repository, timestamp)
    await syncWebhookRepositoryMetadata(db, installationId, accountId, repository, timestamp)
  }
}

function parseWebhookAccount(
  account: GithubWebhookAccount | null | undefined,
  fallbackAccountType?: string,
): WebhookAccount | null {
  if (typeof account?.id !== "number" || typeof account.login !== "string") {
    return null
  }

  const accountType =
    typeof account.type === "string" ? account.type : (fallbackAccountType ?? "User")

  return {
    accountType,
    avatarUrl: account.avatar_url ?? null,
    githubAccountId: account.id,
    login: account.login,
  }
}

function parseRepositoryOwnerFromFullName(fullName: string | undefined) {
  const parts = parseRepositoryFullName(fullName)

  return parts?.owner ?? null
}

function parseRepositoryNameFromFullName(fullName: string | undefined) {
  const parts = parseRepositoryFullName(fullName)

  return parts?.name ?? null
}

function parseRepositoryFullName(fullName: string | undefined) {
  if (!fullName) {
    return null
  }

  const separatorIndex = fullName.indexOf("/")

  if (separatorIndex <= 0 || separatorIndex === fullName.length - 1) {
    return null
  }

  return {
    name: fullName.slice(separatorIndex + 1),
    owner: fullName.slice(0, separatorIndex),
  }
}

async function upsertWebhookGithubAccount(db: AppDb, account: WebhookAccount, timestamp: string) {
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
        accountType: account.accountType,
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
    accountType: account.accountType,
    avatarUrl: account.avatarUrl,
    createdAt: timestamp,
    githubAccountId: account.githubAccountId,
    login: account.login,
    updatedAt: timestamp,
  })

  return accountId
}

async function upsertWebhookInstallation(
  db: AppDb,
  installation: GithubWebhookInstallation,
  installationId: number,
  accountId: string,
  account: WebhookAccount,
  timestamp: string,
) {
  const existingInstallation = await selectOne(
    db
      .select({ id: schema.githubAppInstallations.id })
      .from(schema.githubAppInstallations)
      .where(eq(schema.githubAppInstallations.installationId, installationId))
      .limit(1),
  )
  const installationRowId = existingInstallation?.id ?? ulid()
  const values = {
    accountId,
    deletedAt: null,
    permissionsJson: JSON.stringify(installation.permissions ?? {}),
    suspendedAt: installation.suspended_at ?? null,
    targetType: installation.target_type ?? account.accountType,
    updatedAt: timestamp,
  }

  if (existingInstallation) {
    await db
      .update(schema.githubAppInstallations)
      .set(values)
      .where(eq(schema.githubAppInstallations.id, installationRowId))
    return
  }

  await db.insert(schema.githubAppInstallations).values({
    ...values,
    id: installationRowId,
    createdAt: timestamp,
    installationId,
  })
}

async function upsertWebhookInstallationRepository(
  db: AppDb,
  installationId: number,
  repository: WebhookRepository,
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
        owner: repository.owner,
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
    owner: repository.owner,
    private: repository.private ? 1 : 0,
    updatedAt: timestamp,
  })
}

async function syncWebhookRepositoryMetadata(
  db: AppDb,
  installationId: number,
  accountId: string | null,
  repository: WebhookRepository,
  timestamp: string,
) {
  const updates = {
    ...(accountId ? { accountId } : {}),
    installationId,
    name: repository.name,
    owner: repository.owner,
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
    .where(
      and(
        eq(schema.repositories.githubRepoId, repository.githubRepoId),
        eq(schema.repositories.installationId, installationId),
      ),
    )
}
