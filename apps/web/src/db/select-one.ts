export async function selectOne<T>(query: Promise<T[]>) {
  const [row] = await query
  return row ?? null
}
