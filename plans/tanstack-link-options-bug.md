# TanStack Router `linkOptions` — function-form `search` widens `prev` to global

## TL;DR

`linkOptions({ from, to, search: (prev) => ... })` does not contextually type
`prev` from the `from` route. `prev` is widened to the **global merged search
schema** (every field from every route, all optional), even when `from` is a
literal route path. Direct `<Link from={...} search={(prev) => ...} />` does
type `prev` correctly. The bug is specific to the `linkOptions` helper.

## Versions

- `@tanstack/react-router` 1.168.10
- `@tanstack/router-core` 1.168.9
- `@tanstack/react-start` 1.167.16
- TypeScript 6.0.2 (also reproduces on stable 5.x)

## How to reproduce

Two registered routes with overlapping search schemas, where one route has a
**required** field the other doesn't:

```ts
// /r/$owner/$repo/index.tsx
const repositoryOverviewSearchSchema = v.strictObject({
  branch: v.optional(nonEmptyStringSchema),
  lens: v.optional(nonEmptyStringSchema, DEFAULT_LENS_SLUG),
  metric: v.optional(nonEmptyStringSchema),
})

// /r/$owner/$repo/compare.tsx
const comparePageSearchSchema = v.strictObject({
  base: gitShaSchema,        // required string
  head: gitShaSchema,        // required string
  pr: v.optional(positiveIntegerSchema),
  scenario: v.optional(scenarioSlugSchema),
  // ...
  metric: v.optional(nonEmptyStringSchema),
})
```

The router is registered properly with router-core:

```ts
declare module "@tanstack/router-core" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
```

`Route.useSearch()` on the compare route correctly returns `{ base: string,
head: string, ... }` (verified by assignment).

### Failing case

```tsx
import { linkOptions } from "@tanstack/react-router"
import { Route } from "./routes/r.$owner.$repo.compare.tsx"

const opts = linkOptions({
  from: Route.fullPath,   // literal "/r/$owner/$repo/compare"
  to: ".",                // or Route.path — same result
  search: (prev) => ({ ...prev, metric: "raw" }),
})
```

TS error:

```
Type '(prev: { scenario?: string; branch?: string; metric?: string; lens?: string;
  env?: string; entrypoint?: string; tab?: string; pr?: number;
  base?: string; head?: string; }) => { ... }' is not assignable to type
  '... | ParamsReducerFn<RouterCore<...>, "SEARCH", "/r/$owner/$repo/compare", ".">'.
  Call signature return types '{ metric: string; scenario?: string; ...; base?: string; head?: string }'
  and '{ base: string; head: string; pr?: number; ... }' are incompatible.
  The types of 'base' are incompatible between these types.
    Type 'string | undefined' is not assignable to type 'string'.
      Type 'undefined' is not assignable to type 'string'.
```

Notice that:
- `prev` includes `branch?: string` — a field that exists on the `index`
  route's schema but **not** on `compare`'s. So `prev` is the *global* merged
  search across the entire route tree, not the from-route-specific search.
- `prev.base` and `prev.head` are typed as `string | undefined` even though
  the compare schema declares them as required.
- The expected return type `{ base: string; head: string; ... }` is correct
  (compare's strict schema) — so the destination is being inferred properly,
  only the source `prev` is wrong.
- The `ParamsReducerFn` generic in the error has `"/r/$owner/$repo/compare"`
  in the `TFrom` slot, confirming `from` was inferred as a literal — yet
  `prev` wasn't narrowed accordingly.

### Working case (direct `<Link>`)

```tsx
<Link
  from={Route.fullPath}
  to="."
  search={(prev) => ({ ...prev, metric: "raw" })}
>
  raw
</Link>
```

Typechecks. `prev` is narrowed to the compare route's full search schema,
where `prev.base: string` is non-optional. The `<Link>` component's contextual
typing handles function-form `search` correctly; only the `linkOptions` helper
fails.

### Working case (explicit `prev` annotation)

```tsx
type CompareSearch = ReturnType<typeof Route.useSearch>

linkOptions({
  from: Route.fullPath,
  to: ".",
  search: (prev: CompareSearch) => ({ ...prev, metric: "raw" }),
})
```

Typechecks, but defeats the point of the helper — the user has to manually
restate the route's search type.

### Working case (object-form `search`)

```tsx
const search = Route.useSearch()
linkOptions({
  from: Route.fullPath,
  to: ".",
  search: { ...search, metric: "raw" },
})
```

Typechecks. Object-form `search` doesn't trigger the `prev`-typing path.

## What the user sees

A user wires up filter chips, tabs, or any URL-state UI by mapping options to
`linkOptions` calls so they can pass typed bundles to a list component:

```tsx
options={data.branchOptions.map((branch) => ({
  label: branch,
  linkProps: linkOptions({
    from: Route.fullPath,
    to: ".",
    search: (prev) => ({ ...prev, branch }),   // ← TS error
  }),
}))}
```

On any route with one or more required search fields (e.g. `base: string`),
TS reports that the function returns `string | undefined` where `string` is
required. The error message:

1. Surfaces fields from *other routes* (`branch?: string` appears in `prev`
   for the compare route, even though compare has no `branch`), which is
   confusing — it looks like the route hierarchy is wrong.
2. Suggests the route's `validateSearch` is the problem, because the destination
   shape (correct, strict) and the source shape (wrong, loose) don't match.
3. Pushes the user toward unsound workarounds: `as never` casts, making the
   schema fields optional and adding runtime null checks, or wrapping
   `linkOptions` in a helper that re-states `prev`'s type.

The same code with direct `<Link>` works, which makes the difference feel
arbitrary.

## Where the bug is in the library code

In `@tanstack/react-router/dist/esm/typePrimitives.d.ts`:

```ts
export type ValidateLinkOptions<
  TRouter extends AnyRouter = RegisteredRouter,
  TOptions = unknown,
  TDefaultFrom extends string = string,
  TComp = "a",
> = Constrain<
  TOptions,
  LinkComponentProps<
    TComp,
    TRouter,
    InferFrom<TOptions, TDefaultFrom>,
    InferTo<TOptions>,
    InferMaskFrom<TOptions>,
    InferMaskTo<TOptions>
  >
>
```

`linkOptions` calls into `Constrain<TOptions, LinkComponentProps<...>>`. From
`@tanstack/router-core/dist/esm/utils.d.ts`:

```ts
export type Constrain<T, TConstraint, TDefault = TConstraint> =
  (T extends TConstraint ? T : never) | TDefault
```

This produces a **union**: the narrowed input `TOptions` *or* the broad
`LinkComponentProps<...>` default. When TypeScript contextually types the
caller's `(prev) => ...` against this union, it picks contextual types from
both branches. The fallback `LinkComponentProps<..., TFrom = string, ...>`
has `TFrom` defaulted to broad `string`, which routes through:

```ts
type ResolveFromParams<TRouter, TParamVariant, TFrom> =
  string extends TFrom
    ? ResolveFromAllParams<TRouter, TParamVariant>           // global merge
    : RouteByPath<TRouter['routeTree'], TFrom>['types']
        [ResolveFromParamType<TParamVariant>]
```

Because `string extends TFrom` is true on the fallback branch, `prev` resolves
to `ResolveFromAllParams<TRouter, 'SEARCH'>` — i.e.
`FullSearchSchema<TRouter['routeTree']>`, the union/merge across every
registered route. That's why we see fields like `branch` show up in `prev`
for the compare route.

`<Link>` doesn't go through `Constrain` the same way — it's a generic
component whose contextual type is just `LinkComponentProps<..., InferFrom,
InferTo, ...>` without the union fallback, so `TFrom` is the literal and
`prev` narrows correctly.

## Suggested fixes (library side)

Either of these would close the gap:

1. Drop the `| TDefault` fallback in the `Constrain` used by
   `ValidateLinkOptions`, so the contextual type is a single
   `LinkComponentProps<..., InferFrom, ...>` rather than a union.
2. Have `ValidateLinkOptions` use `ConstrainLiteral` (which uses intersection
   instead of union) for the function-form `search`/`params` reducers.
3. Make `ResolveFromParams<TRouter, TParamVariant, TFrom>` narrow on
   `TFrom extends string` (a path literal that *is* `string`-typed but
   constructed from a registered path) by checking against the route tree's
   known paths rather than `string extends TFrom`.

## Workaround in this repo

We don't use `linkOptions` for the URL-state selector components. Each call
site writes `<Link>` elements directly:

```tsx
<LinkSelector
  label="Branch"
  options={data.branchOptions.map((branch) => (
    <Link key={branch} to="." search={(prev) => ({ ...prev, branch })}>
      {branch}
    </Link>
  ))}
/>
```

`LinkSelector`/`MetricSelector`/`TabSelector` accept `ReactElement[]` and just
render the list shell. JSX type-checking on each `<Link>` validates `to`,
`search`, and `params` against the registered route tree, with `prev`
correctly narrowed to the current route's search schema.
