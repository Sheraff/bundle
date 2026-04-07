import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: RootComponent,
  errorComponent: RootErrorComponent,
  notFoundComponent: RootNotFoundComponent,
})

function RootComponent() {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bundle</title>
        <HeadContent />
      </head>
      <body>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}

function RootErrorComponent(props: { error: Error }) {
  return (
    <main>
      <h1>Application Error</h1>
      <p>{props.error.message}</p>
    </main>
  )
}

function RootNotFoundComponent() {
  return (
    <main>
      <h1>Not Found</h1>
      <p>The requested page does not exist.</p>
    </main>
  )
}
