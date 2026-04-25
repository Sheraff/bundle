import { and, sql } from "drizzle-orm"

import { schema } from "./index.js"

export function repositoryRouteMatch(owner: string, repo: string) {
  return and(
    sql`lower(${schema.repositories.owner}) = ${owner.toLowerCase()}`,
    sql`lower(${schema.repositories.name}) = ${repo.toLowerCase()}`,
  )
}
