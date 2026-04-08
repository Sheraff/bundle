import { createRouter } from "@tanstack/react-router"

import type { AppBindings } from "./env.js"
import { routeTree } from "./routeTree.gen.js"

export function getRouter() {
  return createRouter({
    routeTree,
    defaultPreload: "intent",
    scrollRestoration: true,
  })
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
