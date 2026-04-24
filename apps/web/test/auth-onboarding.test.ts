import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test"
import { env, exports } from "cloudflare:workers"
import { uploadScenarioRunAcceptedResponseV1Schema } from "@workspace/contracts"
import { ulid } from "ulid"
import { describe, expect, it, vi } from "vitest"
import * as v from "valibot"

import { normalizeRedirectTo } from "../src/api/auth.js"
import { createSessionSetCookieHeader } from "../src/auth/session.js"
import { listGithubUserInstallationRepositories } from "../src/github-api.js"
import {
  enableRepositoryForUser,
  getUserGithubAccessToken,
  requireRepositoryAdminForUser,
  syncInstallationForUser,
  type CurrentUserRow,
  upsertUserWithGithubToken,
} from "../src/github/onboarding.js"
import { base64UrlEncodeBytes, base64UrlEncodeJson } from "../src/security/base64url.js"
import { buildEnvelope } from "./support/builders.js"

const sha = "0123456789abcdef0123456789abcdef01234567"

describe("GitHub auth and onboarding endpoints", () => {
  it("normalizes OAuth redirect targets against the app origin", () => {
    expect(normalizeRedirectTo("/\\evil.com", "https://bundle.test")).toBe("/app")
    expect(normalizeRedirectTo("https://evil.com/app", "https://bundle.test")).toBe("/app")
    expect(
      normalizeRedirectTo("https://bundle.test/app?tab=setup#top", "https://bundle.test"),
    ).toBe("/app?tab=setup#top")
  })

  it("rejects malformed GitHub setup installation ids", async () => {
    const { cookie } = await seedSignedInUser("admin")
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("GitHub should not be called for malformed setup ids")
    })

    vi.stubGlobal("fetch", fetchMock)

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/setup?installation_id=456abc", {
        headers: { cookie },
      }),
    )

    expect(response.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("exchanges a GitHub Actions OIDC token for a scoped upload token", async () => {
    await seedEnabledRepository()
    const { jwt, publicJwk } = await createGithubOidcJwt()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        expect(toRequestUrl(input)).toBe(
          "https://token.actions.githubusercontent.com/.well-known/jwks",
        )
        return Response.json({ keys: [publicJwk] })
      }),
    )

    const exchangeResponse = await fetchWorker(
      new Request("https://bundle.test/api/v1/uploads/github-actions/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: jwt }),
      }),
    )
    const exchangeBody = (await exchangeResponse.json()) as {
      installationId?: number
      token?: string
    }

    expect(exchangeResponse.status).toBe(200)
    expect(exchangeBody.installationId).toBe(456)
    expect(exchangeBody.token).toEqual(expect.any(String))

    const uploadResponse = await fetchWorker(
      new Request("https://bundle.test/api/v1/uploads/scenario-runs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${exchangeBody.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(
          buildEnvelope({
            ci: {
              provider: "github-actions",
              workflowRunId: "999",
              workflowRunAttempt: 2,
              job: "build",
              actionVersion: "v1",
            },
            git: {
              branch: "main",
              commitSha: sha,
            },
          }),
        ),
      }),
    )
    const uploadBody = await uploadResponse.json()

    expect(uploadResponse.status).toBe(202)
    expect(v.safeParse(uploadScenarioRunAcceptedResponseV1Schema, uploadBody).success).toBe(true)
  })

  it("rejects OIDC exchange for a disabled repository", async () => {
    await seedEnabledRepository({ enabled: false })
    const { jwt, publicJwk } = await createGithubOidcJwt()
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => Response.json({ keys: [publicJwk] })),
    )

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/uploads/github-actions/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: jwt }),
      }),
    )

    expect(response.status).toBe(403)
  })

  it("returns an auth error for malformed OIDC JWTs", async () => {
    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/uploads/github-actions/token", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: "abc.def.ghi" }),
      }),
    )
    const responseBody = (await response.json()) as {
      error?: { code?: string }
    }

    expect(response.status).toBe(401)
    expect(responseBody.error?.code).toBe("invalid_oidc_token")
  })

  it("refreshes expiring GitHub App user tokens", async () => {
    const { user } = await seedSignedInUser("admin", {
      accessToken: "old-user-token",
      accessTokenExpiresAt: new Date(Date.now() - 60_000).toISOString(),
      refreshToken: "refresh-token",
      refreshTokenExpiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    })

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://github.com/login/oauth/access_token") {
          return Response.json(
            {
              access_token: "new-user-token",
              expires_in: 3600,
              refresh_token: "new-refresh-token",
              refresh_token_expires_in: 7200,
              token_type: "bearer",
            },
            {
              headers: {
                date: new Date().toUTCString(),
              },
            },
          )
        }

        expect(url).toBe("https://api.github.com/repos/acme/widget/collaborators/admin/permission")
        return Response.json({ permission: "admin" })
      }),
    )

    await requireRepositoryAdminForUser(env, user, "acme", "widget")

    expect(await getUserGithubAccessToken(env, user.id)).toBe("new-user-token")
  })

  it("validates GitHub webhook signatures and disables removed installations", async () => {
    await seedEnabledRepository()
    await seedInstallationRepository(123, "widget")
    const body = JSON.stringify({
      action: "deleted",
      installation: {
        id: 456,
      },
    })

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation",
          "x-hub-signature-256": await signWebhookBody(body),
        },
        body,
      }),
    )
    const repository = await env.DB.prepare(
      "SELECT enabled, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ disabled_at: string | null; enabled: number }>()
    const installationRepository = await env.DB.prepare(
      "SELECT access_status FROM github_installation_repositories WHERE github_repo_id = 123",
    ).first<{ access_status: string }>()

    expect(response.status).toBe(200)
    expect(repository?.enabled).toBe(0)
    expect(repository?.disabled_at).toEqual(expect.any(String))
    expect(installationRepository?.access_status).toBe("removed")
  })

  it("preserves enabled repositories across installation suspension", async () => {
    await seedEnabledRepository()
    const suspendBody = JSON.stringify({
      action: "suspend",
      installation: {
        id: 456,
      },
    })

    const suspendResponse = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation",
          "x-hub-signature-256": await signWebhookBody(suspendBody),
        },
        body: suspendBody,
      }),
    )
    const suspendedRepository = await env.DB.prepare(
      "SELECT enabled, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ disabled_at: string | null; enabled: number }>()
    const suspendedInstallation = await env.DB.prepare(
      "SELECT suspended_at FROM github_app_installations WHERE installation_id = 456",
    ).first<{ suspended_at: string | null }>()

    expect(suspendResponse.status).toBe(200)
    expect(suspendedRepository).toMatchObject({
      disabled_at: null,
      enabled: 1,
    })
    expect(suspendedInstallation?.suspended_at).toEqual(expect.any(String))

    const unsuspendBody = JSON.stringify({
      action: "unsuspend",
      installation: {
        id: 456,
      },
    })
    const unsuspendResponse = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation",
          "x-hub-signature-256": await signWebhookBody(unsuspendBody),
        },
        body: unsuspendBody,
      }),
    )
    const unsuspendedRepository = await env.DB.prepare(
      "SELECT enabled, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ disabled_at: string | null; enabled: number }>()
    const unsuspendedInstallation = await env.DB.prepare(
      "SELECT suspended_at FROM github_app_installations WHERE installation_id = 456",
    ).first<{ suspended_at: string | null }>()

    expect(unsuspendResponse.status).toBe(200)
    expect(unsuspendedRepository).toMatchObject({
      disabled_at: null,
      enabled: 1,
    })
    expect(unsuspendedInstallation?.suspended_at).toBeNull()
  })

  it("marks repository access removed when repositories are deleted", async () => {
    await seedEnabledRepository()
    await seedInstallationRepository(123, "widget")
    const body = JSON.stringify({
      action: "deleted",
      installation: {
        id: 456,
      },
      repository: {
        id: 123,
      },
    })

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "repository",
          "x-hub-signature-256": await signWebhookBody(body),
        },
        body,
      }),
    )
    const repository = await env.DB.prepare(
      "SELECT enabled, deleted_at, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ deleted_at: string | null; disabled_at: string | null; enabled: number }>()
    const installationRepository = await env.DB.prepare(
      "SELECT access_status FROM github_installation_repositories WHERE installation_id = 456 AND github_repo_id = 123",
    ).first<{ access_status: string }>()

    expect(response.status).toBe(200)
    expect(repository?.enabled).toBe(0)
    expect(repository?.deleted_at).toEqual(expect.any(String))
    expect(repository?.disabled_at).toEqual(expect.any(String))
    expect(installationRepository?.access_status).toBe("removed")
  })

  it("persists installations created from webhooks", async () => {
    const body = JSON.stringify({
      action: "created",
      installation: {
        account: {
          avatar_url: "https://avatars.test/octo.png",
          id: 2,
          login: "octo-org",
          type: "Organization",
        },
        id: 789,
        permissions: {
          checks: "write",
          contents: "read",
        },
        suspended_at: null,
        target_type: "Organization",
      },
      repositories: [
        {
          full_name: "octo-org/dashboard",
          id: 222,
          name: "dashboard",
          private: false,
        },
      ],
    })

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation",
          "x-hub-signature-256": await signWebhookBody(body),
        },
        body,
      }),
    )
    const installation = await env.DB.prepare(
      `SELECT
        github_app_installations.deleted_at AS deleted_at,
        github_app_installations.target_type AS target_type,
        github_accounts.login AS account_login
      FROM github_app_installations
      INNER JOIN github_accounts
        ON github_accounts.id = github_app_installations.account_id
      WHERE github_app_installations.installation_id = 789`,
    ).first<{ account_login: string; deleted_at: string | null; target_type: string }>()
    const installationRepository = await env.DB.prepare(
      `SELECT access_status, installation_id, owner, name
      FROM github_installation_repositories
      WHERE github_repo_id = 222`,
    ).first<{ access_status: string; installation_id: number; name: string; owner: string }>()

    expect(response.status).toBe(200)
    expect(installation).toMatchObject({
      account_login: "octo-org",
      deleted_at: null,
      target_type: "Organization",
    })
    expect(installationRepository).toMatchObject({
      access_status: "active",
      installation_id: 789,
      name: "dashboard",
      owner: "octo-org",
    })
  })

  it("requires GitHub admin permission to view repository settings", async () => {
    await seedEnabledRepository()
    const { cookie } = await seedSignedInUser("viewer")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        expect(toRequestUrl(input)).toBe(
          "https://api.github.com/repos/acme/widget/collaborators/viewer/permission",
        )
        return Response.json({ permission: "read" })
      }),
    )

    const response = await fetchWorker(
      new Request("https://bundle.test/r/acme/widget/settings", {
        headers: { cookie },
      }),
    )

    expect(response.status).toBe(404)
  })

  it("does not duplicate repository settings permission checks", async () => {
    await seedEnabledRepository()
    const { cookie } = await seedSignedInUser("admin")
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      expect(toRequestUrl(input)).toBe(
        "https://api.github.com/repos/acme/widget/collaborators/admin/permission",
      )
      return Response.json({ permission: "admin" })
    })

    vi.stubGlobal("fetch", fetchMock)

    const response = await fetchWorker(
      new Request("https://bundle.test/r/acme/widget/settings", {
        headers: { cookie },
      }),
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("returns forbidden for inaccessible installation admin pages", async () => {
    const { cookie } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        expect(toRequestUrl(input)).toBe("https://api.github.com/user/installations?per_page=100")
        return Response.json({ installations: [] })
      }),
    )

    const response = await fetchWorker(
      new Request("https://bundle.test/app/installations/456", {
        headers: { cookie },
      }),
    )

    expect(response.status).toBe(404)
  })

  it("does not render repositories from other installations as enabled", async () => {
    await seedEnabledRepository()
    await seedInstallation(789)
    await seedInstallationRepository(123, "widget", { installationId: 456 })
    await env.DB.prepare(
      "UPDATE repositories SET installation_id = 789 WHERE github_repo_id = 123",
    ).run()
    const { cookie } = await seedSignedInUser("admin")
    const requestCounts = new Map<string, number>()

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)
        requestCounts.set(url, (requestCounts.get(url) ?? 0) + 1)

        if (url === "https://api.github.com/user/installations?per_page=100") {
          return Response.json({
            installations: [
              {
                account: {
                  id: 1,
                  login: "acme",
                  type: "Organization",
                },
                id: 456,
                permissions: {},
                suspended_at: null,
                target_type: "Organization",
              },
            ],
          })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({ repositories: [] })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    const response = await fetchWorker(
      new Request("https://bundle.test/app/installations/456", {
        headers: { cookie },
      }),
    )
    const responseBody = await response.text()

    expect(response.status).toBe(200)
    expect(responseBody).not.toContain("<td>Enabled</td>")
    expect(responseBody).not.toContain("Settings")
    expect(requestCounts.get("https://api.github.com/user/installations?per_page=100")).toBe(1)
  })

  it("refreshes repository visibility before enabling", async () => {
    await seedEnabledRepository({ enabled: false })
    await seedInstallationRepository(123, "widget")
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/repos/acme/widget/collaborators/admin/permission") {
          return Response.json({ permission: "admin" })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({
            repositories: [githubRepository(123, "widget", { private: true })],
          })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await expect(enableRepositoryForUser(env, user, 456, "acme", "widget")).rejects.toThrow(
      /private repositories/i,
    )
    const repository = await env.DB.prepare(
      "SELECT enabled FROM repositories WHERE github_repo_id = 123",
    ).first<{ enabled: number }>()
    const installationRepository = await env.DB.prepare(
      "SELECT private FROM github_installation_repositories WHERE github_repo_id = 123",
    ).first<{ private: number }>()

    expect(repository?.enabled).toBe(0)
    expect(installationRepository?.private).toBe(1)
  })

  it("disables already-enabled repositories that turn private during enable refresh", async () => {
    await seedEnabledRepository()
    await seedInstallationRepository(123, "widget")
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/repos/acme/widget/collaborators/admin/permission") {
          return Response.json({ permission: "admin" })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({
            repositories: [githubRepository(123, "widget", { private: true })],
          })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await expect(enableRepositoryForUser(env, user, 456, "acme", "widget")).rejects.toThrow(
      /private repositories/i,
    )
    const repository = await env.DB.prepare(
      "SELECT enabled, disabled_at, visibility FROM repositories WHERE github_repo_id = 123",
    ).first<{ disabled_at: string | null; enabled: number; visibility: string }>()

    expect(repository?.enabled).toBe(0)
    expect(repository?.visibility).toBe("private")
    expect(repository?.disabled_at).toEqual(expect.any(String))
  })

  it("clears deleted state when re-enabling repositories", async () => {
    await seedEnabledRepository({ enabled: false })
    await seedInstallationRepository(123, "widget")
    await env.DB.prepare(
      "UPDATE repositories SET deleted_at = '2026-01-01T00:00:00.000Z', disabled_at = '2026-01-01T00:00:00.000Z' WHERE github_repo_id = 123",
    ).run()
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/repos/acme/widget/collaborators/admin/permission") {
          return Response.json({ permission: "admin" })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({
            repositories: [githubRepository(123, "widget")],
          })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await enableRepositoryForUser(env, user, 456, "acme", "widget")
    const repository = await env.DB.prepare(
      "SELECT enabled, deleted_at, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ deleted_at: string | null; disabled_at: string | null; enabled: number }>()

    expect(repository).toMatchObject({
      deleted_at: null,
      disabled_at: null,
      enabled: 1,
    })
  })

  it("enables repositories from the selected installation", async () => {
    await seedEnabledRepository({ enabled: false })
    await seedInstallation(789)
    await seedInstallationRepository(123, "widget", { installationId: 456 })
    await seedInstallationRepository(123, "widget", { installationId: 789 })
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/repos/acme/widget/collaborators/admin/permission") {
          return Response.json({ permission: "admin" })
        }

        if (url === "https://api.github.com/user/installations/789/repositories?per_page=100") {
          return Response.json({
            repositories: [githubRepository(123, "widget")],
          })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await enableRepositoryForUser(env, user, 789, "acme", "widget")
    const repository = await env.DB.prepare(
      "SELECT enabled, installation_id FROM repositories WHERE github_repo_id = 123",
    ).first<{ enabled: number; installation_id: number }>()

    expect(repository).toMatchObject({
      enabled: 1,
      installation_id: 789,
    })
  })

  it("paginates GitHub installation repositories", async () => {
    const fetchMock = vi.fn<typeof fetch>(async (input) => {
      const url = toRequestUrl(input)

      if (url.endsWith("page=2")) {
        return Response.json({
          repositories: [githubRepository(124, "api")],
        })
      }

      expect(url).toBe("https://api.github.com/user/installations/456/repositories?per_page=100")
      return new Response(
        JSON.stringify({
          repositories: [githubRepository(123, "widget")],
        }),
        {
          headers: {
            "content-type": "application/json",
            link: '<https://api.github.com/user/installations/456/repositories?per_page=100&page=2>; rel="next"',
          },
        },
      )
    })
    vi.stubGlobal("fetch", fetchMock)

    const repositories = await listGithubUserInstallationRepositories("token", 456)

    expect(repositories.map((repository) => repository.githubRepoId)).toEqual([123, 124])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("does not remove repositories missing from user-scoped installation sync", async () => {
    await seedEnabledRepository()
    await seedInstallationRepository(123, "widget")
    await seedInstallationRepository(999, "legacy")
    await seedRepositoryRow(999, "legacy")
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/user/installations?per_page=100") {
          return Response.json({
            installations: [
              {
                account: {
                  id: 1,
                  login: "acme",
                  type: "Organization",
                },
                id: 456,
                permissions: {},
                suspended_at: null,
                target_type: "Organization",
              },
            ],
          })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({
            repositories: [githubRepository(123, "widget")],
          })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await syncInstallationForUser(env, user, 456)

    const installationRepository = await env.DB.prepare(
      "SELECT access_status FROM github_installation_repositories WHERE github_repo_id = 999",
    ).first<{ access_status: string }>()
    const repository = await env.DB.prepare(
      "SELECT enabled, disabled_at FROM repositories WHERE github_repo_id = 999",
    ).first<{ disabled_at: string | null; enabled: number }>()

    expect(installationRepository?.access_status).toBe("active")
    expect(repository?.enabled).toBe(1)
    expect(repository?.disabled_at).toBeNull()
  })

  it("marks the selected repository removed when enable refresh cannot see it", async () => {
    await seedEnabledRepository({ enabled: false })
    await seedInstallationRepository(123, "widget")
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/repos/acme/widget/collaborators/admin/permission") {
          return Response.json({ permission: "admin" })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({ repositories: [] })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await expect(enableRepositoryForUser(env, user, 456, "acme", "widget")).rejects.toThrow(
      /does not have access/i,
    )
    const installationRepository = await env.DB.prepare(
      "SELECT access_status FROM github_installation_repositories WHERE github_repo_id = 123",
    ).first<{ access_status: string }>()
    const repository = await env.DB.prepare(
      "SELECT enabled, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ disabled_at: string | null; enabled: number }>()

    expect(installationRepository?.access_status).toBe("removed")
    expect(repository?.enabled).toBe(0)
    expect(repository?.disabled_at).toEqual(expect.any(String))
  })

  it("syncs enabled repository metadata from installation refreshes", async () => {
    await seedEnabledRepository()
    await seedInstallationRepository(123, "widget")
    const { user } = await seedSignedInUser("admin")

    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (input) => {
        const url = toRequestUrl(input)

        if (url === "https://api.github.com/user/installations?per_page=100") {
          return Response.json({
            installations: [
              {
                account: {
                  id: 1,
                  login: "acme",
                  type: "Organization",
                },
                id: 456,
                permissions: {},
                suspended_at: null,
                target_type: "Organization",
              },
            ],
          })
        }

        if (url === "https://api.github.com/user/installations/456/repositories?per_page=100") {
          return Response.json({
            repositories: [githubRepository(123, "widget-next", { private: true })],
          })
        }

        throw new Error(`Unexpected GitHub API request: ${url}`)
      }),
    )

    await syncInstallationForUser(env, user, 456)

    const repository = await env.DB.prepare(
      "SELECT name, visibility, enabled, disabled_at FROM repositories WHERE github_repo_id = 123",
    ).first<{ disabled_at: string | null; enabled: number; name: string; visibility: string }>()

    expect(repository?.name).toBe("widget-next")
    expect(repository?.visibility).toBe("private")
    expect(repository?.enabled).toBe(0)
    expect(repository?.disabled_at).toEqual(expect.any(String))
  })

  it("persists repositories added by installation repository webhooks", async () => {
    await seedEnabledRepository()
    const body = JSON.stringify({
      action: "added",
      installation: {
        id: 456,
      },
      repositories_added: [
        {
          full_name: "acme/api",
          id: 124,
          name: "api",
          private: false,
        },
      ],
    })

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation_repositories",
          "x-hub-signature-256": await signWebhookBody(body),
        },
        body,
      }),
    )
    const installationRepository = await env.DB.prepare(
      "SELECT access_status, owner, name FROM github_installation_repositories WHERE github_repo_id = 124",
    ).first<{ access_status: string; name: string; owner: string }>()

    expect(response.status).toBe(200)
    expect(installationRepository).toMatchObject({
      access_status: "active",
      name: "api",
      owner: "acme",
    })
  })

  it("scopes repository removal webhooks to the emitting installation", async () => {
    await seedEnabledRepository()
    await seedInstallation(789)
    await seedInstallationRepository(123, "widget", { installationId: 456 })
    await seedInstallationRepository(123, "widget", { installationId: 789 })

    await env.DB.prepare(
      "UPDATE repositories SET installation_id = 789 WHERE github_repo_id = 123",
    ).run()

    const body = JSON.stringify({
      action: "removed",
      installation: {
        id: 456,
      },
      repositories_removed: [
        {
          id: 123,
        },
      ],
    })

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "installation_repositories",
          "x-hub-signature-256": await signWebhookBody(body),
        },
        body,
      }),
    )
    const oldInstallationRepository = await env.DB.prepare(
      "SELECT access_status FROM github_installation_repositories WHERE installation_id = 456 AND github_repo_id = 123",
    ).first<{ access_status: string }>()
    const newInstallationRepository = await env.DB.prepare(
      "SELECT access_status FROM github_installation_repositories WHERE installation_id = 789 AND github_repo_id = 123",
    ).first<{ access_status: string }>()
    const repository = await env.DB.prepare(
      "SELECT enabled, installation_id FROM repositories WHERE github_repo_id = 123",
    ).first<{ enabled: number; installation_id: number }>()

    expect(response.status).toBe(200)
    expect(oldInstallationRepository?.access_status).toBe("removed")
    expect(newInstallationRepository?.access_status).toBe("active")
    expect(repository).toMatchObject({
      enabled: 1,
      installation_id: 789,
    })
  })

  it("scopes repository metadata webhooks to the emitting installation", async () => {
    await seedEnabledRepository()
    await seedInstallation(789)
    await seedInstallationRepository(123, "widget", { installationId: 456 })
    await seedInstallationRepository(123, "widget", { installationId: 789 })

    await env.DB.prepare(
      "UPDATE repositories SET installation_id = 789 WHERE github_repo_id = 123",
    ).run()

    const body = JSON.stringify({
      action: "edited",
      installation: {
        id: 456,
      },
      repository: {
        id: 123,
        name: "widget-legacy",
        owner: {
          login: "legacy",
        },
        private: true,
      },
    })

    const response = await fetchWorker(
      new Request("https://bundle.test/api/v1/github/webhooks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-github-event": "repository",
          "x-hub-signature-256": await signWebhookBody(body),
        },
        body,
      }),
    )
    const repository = await env.DB.prepare(
      "SELECT enabled, installation_id, owner, name, visibility FROM repositories WHERE github_repo_id = 123",
    ).first<{
      enabled: number
      installation_id: number
      name: string
      owner: string
      visibility: string
    }>()
    const oldInstallationRepository = await env.DB.prepare(
      "SELECT owner, name, private FROM github_installation_repositories WHERE installation_id = 456 AND github_repo_id = 123",
    ).first<{ name: string; owner: string; private: number }>()
    const currentInstallationRepository = await env.DB.prepare(
      "SELECT owner, name, private FROM github_installation_repositories WHERE installation_id = 789 AND github_repo_id = 123",
    ).first<{ name: string; owner: string; private: number }>()

    expect(response.status).toBe(200)
    expect(repository).toMatchObject({
      enabled: 1,
      installation_id: 789,
      name: "widget",
      owner: "acme",
      visibility: "public",
    })
    expect(oldInstallationRepository).toMatchObject({
      name: "widget-legacy",
      owner: "legacy",
      private: 1,
    })
    expect(currentInstallationRepository).toMatchObject({
      name: "widget",
      owner: "acme",
      private: 0,
    })
  })
})

async function fetchWorker(request: Request) {
  const executionContext = createExecutionContext()
  const worker = (
    exports as unknown as {
      default: {
        fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
      }
    }
  ).default

  const response = await worker.fetch(request, env, executionContext)
  await waitOnExecutionContext(executionContext)
  return response
}

function toRequestUrl(input: Parameters<typeof fetch>[0]) {
  if (typeof input === "string") {
    return input
  }

  return input instanceof URL ? input.toString() : input.url
}

async function seedEnabledRepository(options: { enabled?: boolean } = {}) {
  const timestamp = new Date().toISOString()
  const accountId = ulid()

  await env.DB.prepare(
    `INSERT INTO github_accounts (
      id, github_account_id, login, account_type, created_at, updated_at
    ) VALUES (?, 1, 'acme', 'Organization', ?, ?)`,
  )
    .bind(accountId, timestamp, timestamp)
    .run()

  await env.DB.prepare(
    `INSERT INTO github_app_installations (
      id, installation_id, account_id, target_type, permissions_json, created_at, updated_at
    ) VALUES (?, 456, ?, 'Organization', '{}', ?, ?)`,
  )
    .bind(ulid(), accountId, timestamp, timestamp)
    .run()

  await env.DB.prepare(
    `INSERT INTO repositories (
      id,
      github_repo_id,
      account_id,
      owner,
      name,
      installation_id,
      enabled,
      visibility,
      created_at,
      updated_at
    ) VALUES (?, 123, ?, 'acme', 'widget', 456, ?, 'public', ?, ?)`,
  )
    .bind(ulid(), accountId, options.enabled === false ? 0 : 1, timestamp, timestamp)
    .run()
}

async function seedInstallation(installationId: number) {
  const timestamp = new Date().toISOString()
  const account = await env.DB.prepare(
    "SELECT id FROM github_accounts WHERE github_account_id = 1",
  ).first<{ id: string }>()

  if (!account) {
    throw new Error("Expected seeded GitHub account.")
  }

  await env.DB.prepare(
    `INSERT INTO github_app_installations (
      id, installation_id, account_id, target_type, permissions_json, created_at, updated_at
    ) VALUES (?, ?, ?, 'Organization', '{}', ?, ?)`,
  )
    .bind(ulid(), installationId, account.id, timestamp, timestamp)
    .run()
}

async function seedSignedInUser(
  login: string,
  githubToken: Parameters<typeof upsertUserWithGithubToken>[2] = {
    accessToken: "user-token",
    accessTokenExpiresAt: null,
    refreshToken: null,
    refreshTokenExpiresAt: null,
  },
) {
  const upsertedUser = await upsertUserWithGithubToken(
    env,
    {
      avatarUrl: null,
      githubUserId: 42,
      login,
      name: null,
    },
    githubToken,
  )
  const cookie = await createSessionSetCookieHeader(env, {
    githubUserId: upsertedUser.githubUserId,
    login: upsertedUser.login,
    userId: upsertedUser.id,
  })
  const user = await env.DB.prepare(
    `SELECT
      id,
      github_user_id AS githubUserId,
      login,
      avatar_url AS avatarUrl,
      name,
      created_at AS createdAt,
      updated_at AS updatedAt
    FROM users
    WHERE id = ?`,
  )
    .bind(upsertedUser.id)
    .first<CurrentUserRow>()

  if (!user) {
    throw new Error("Expected seeded user.")
  }

  return { cookie, user }
}

async function seedInstallationRepository(
  githubRepoId: number,
  name: string,
  options: {
    accessStatus?: string
    installationId?: number
    owner?: string
    private?: boolean
  } = {},
) {
  const timestamp = new Date().toISOString()

  await env.DB.prepare(
    `INSERT INTO github_installation_repositories (
      id,
      installation_id,
      github_repo_id,
      owner,
      name,
      private,
      access_status,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      ulid(),
      options.installationId ?? 456,
      githubRepoId,
      options.owner ?? "acme",
      name,
      options.private ? 1 : 0,
      options.accessStatus ?? "active",
      timestamp,
      timestamp,
    )
    .run()
}

async function seedRepositoryRow(githubRepoId: number, name: string) {
  const timestamp = new Date().toISOString()
  const installation = await env.DB.prepare(
    "SELECT account_id FROM github_app_installations WHERE installation_id = 456",
  ).first<{ account_id: string }>()

  if (!installation) {
    throw new Error("Expected seeded installation.")
  }

  await env.DB.prepare(
    `INSERT INTO repositories (
      id,
      github_repo_id,
      account_id,
      owner,
      name,
      installation_id,
      enabled,
      visibility,
      created_at,
      updated_at
    ) VALUES (?, ?, ?, 'acme', ?, 456, 1, 'public', ?, ?)`,
  )
    .bind(ulid(), githubRepoId, installation.account_id, name, timestamp, timestamp)
    .run()
}

function githubRepository(githubRepoId: number, name: string, options: { private?: boolean } = {}) {
  return {
    id: githubRepoId,
    name,
    owner: {
      id: 1,
      login: "acme",
      type: "Organization",
    },
    permissions: {
      admin: true,
      pull: true,
      push: true,
    },
    private: options.private ?? false,
  }
}

async function createGithubOidcJwt() {
  const keyPair = await crypto.subtle.generateKey(
    {
      hash: "SHA-256",
      modulusLength: 2048,
      name: "RSASSA-PKCS1-v1_5",
      publicExponent: new Uint8Array([1, 0, 1]),
    },
    true,
    ["sign", "verify"],
  )
  const publicJwk = {
    ...((await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as JsonWebKey),
    alg: "RS256",
    kid: "test-key",
    use: "sig",
  }
  const now = Math.floor(Date.now() / 1000)
  const encodedHeader = base64UrlEncodeJson({
    alg: "RS256",
    kid: "test-key",
    typ: "JWT",
    x5t: "test-thumbprint",
  })
  const encodedPayload = base64UrlEncodeJson({
    aud: "https://bundle.test",
    exp: now + 600,
    iat: now - 10,
    iss: "https://token.actions.githubusercontent.com",
    actor: "octocat",
    repository: "acme/widget",
    repository_owner: "acme",
    repository_id: "123",
    repository_visibility: "public",
    run_attempt: "2",
    run_id: "999",
    sha,
    sub: "repo:acme/widget:ref:refs/heads/main",
    workflow_ref: "acme/widget/.github/workflows/bundle.yml@refs/heads/main",
  })
  const signingInput = `${encodedHeader}.${encodedPayload}`
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  )

  return {
    jwt: `${signingInput}.${base64UrlEncodeBytes(new Uint8Array(signature))}`,
    publicJwk,
  }
}

async function signWebhookBody(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.GITHUB_WEBHOOK_SECRET),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))

  return `sha256=${[...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`
}
