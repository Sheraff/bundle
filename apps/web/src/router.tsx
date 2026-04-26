import { createRouter } from "@tanstack/react-router"
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'

import type { AppBindings } from "./env.js"
import { routeTree } from "./routeTree.gen.js"
import { QueryClient } from "@tanstack/react-query"

export function getRouter() {
  const queryClient = new QueryClient()
  const router = createRouter({
    context: { queryClient },
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  })
  setupRouterSsrQueryIntegration({
    router,
    queryClient,
  })
  return router
}

declare module "@tanstack/router-core" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

declare module "@tanstack/react-start" {
  interface Register {
    server: {
      requestContext: {
        env: AppBindings
        executionContext: ExecutionContext<unknown>
      }
    }
  }
}
