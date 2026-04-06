import type { AppBindings } from './env.js'

declare global {
  namespace Cloudflare {
    interface Env extends AppBindings {}
  }
}

export {}
