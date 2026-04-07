import { uploadScenarioRunEnvelopeV1Schema } from '@workspace/contracts'
import type { Context, Hono } from 'hono'
import * as v from 'valibot'

import type { AppEnv } from '../env.js'
import { formatIssues } from '../shared/format-issues.js'
import { acceptUpload } from '../uploads/accept-upload.js'

export function registerUploadRoutes(app: Hono<AppEnv>) {
  app.post('/api/v1/uploads/scenario-runs', async (c) => {
    const uploadToken = readBearerToken(c.req.header('authorization'))

    if (!uploadToken || uploadToken !== c.env.BUNDLE_UPLOAD_TOKEN) {
      return jsonError(c, 401, 'unauthorized', 'The upload token is missing or invalid.')
    }

    const rawRequestBody = await c.req.text()
    const parsedRequestBody = parseJsonBody(rawRequestBody)

    if (!parsedRequestBody.success) {
      return jsonError(c, 400, 'invalid_json', 'The upload body must be valid JSON.')
    }

    const envelopeResult = v.safeParse(
      uploadScenarioRunEnvelopeV1Schema,
      parsedRequestBody.output,
    )

    if (!envelopeResult.success) {
      return jsonError(
        c,
        400,
        'invalid_upload_envelope',
        formatIssues(envelopeResult.issues),
      )
    }

    const result = await acceptUpload(c.env, envelopeResult.output, rawRequestBody)

    if (!result.ok) {
      return jsonError(c, 503, result.code, result.message)
    }

    return c.json(result.response, 202)
  })
}

function parseJsonBody(rawRequestBody: string) {
  try {
    return {
      success: true as const,
      output: JSON.parse(rawRequestBody) as unknown,
    }
  } catch {
    return {
      success: false as const,
    }
  }
}

export function readBearerToken(authorizationHeader?: string) {
  if (!authorizationHeader) {
    return null
  }

  const [scheme, token] = authorizationHeader.trim().split(/\s+/, 2)

  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null
  }

  return token
}

function jsonError(
  c: Context<AppEnv>,
  status: 400 | 401 | 500 | 503,
  code: string,
  message: string,
) {
  return c.json(
    {
      error: {
        code,
        message,
      },
    },
    status,
  )
}
