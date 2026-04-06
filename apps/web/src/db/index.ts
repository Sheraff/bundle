import { drizzle } from 'drizzle-orm/d1'

import type { AppBindings } from '../env.js'
import * as schema from './schema.js'

export function getDb(env: AppBindings) {
  return drizzle(env.DB, { schema })
}

export { schema }
