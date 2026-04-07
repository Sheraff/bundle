import {
  createExecutionContext,
  waitOnExecutionContext,
} from 'cloudflare:test'
import { env, exports } from 'cloudflare:workers'
import type { UploadScenarioRunEnvelopeV1 } from '@workspace/contracts'

export async function sendUploadRequest(
  envelope: UploadScenarioRunEnvelopeV1,
  token: string = env.BUNDLE_UPLOAD_TOKEN,
) {
  return sendRawRequest(JSON.stringify(envelope), token)
}

export async function sendRawRequest(
  body: string,
  token: string = env.BUNDLE_UPLOAD_TOKEN,
) {
  return fetchWorker(
    new Request('https://bundle.test/api/v1/uploads/scenario-runs', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body,
    }),
  )
}

export async function fetchPage(url: string) {
  return fetchWorker(new Request(url))
}

export function toRequestUrl(input: Request | string | URL) {
  if (typeof input === 'string') {
    return input
  }

  return input instanceof URL ? input.toString() : input.url
}

async function fetchWorker(request: Request) {
  const executionContext = createExecutionContext()
  const worker = (exports as unknown as {
    default: {
      fetch: (request: Request, env: Cloudflare.Env, ctx: ExecutionContext) => Promise<Response>
    }
  }).default

  const response = await worker.fetch(request, env, executionContext)
  await waitOnExecutionContext(executionContext)
  return response
}
