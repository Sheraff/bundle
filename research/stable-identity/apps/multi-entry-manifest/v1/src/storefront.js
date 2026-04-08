import "./styles/storefront.css"
import badgeUrl from "./assets/storefront-badge.svg"
import { renderScaffold } from "./shared/platform.js"

renderScaffold({
  mountId: "storefront-fixture",
  title: "Storefront entry",
  summary: "A multi-entry fixture with a shared shell chunk and dynamic route chunks.",
  badgeUrl,
  loadRoute: () => import("./routes/catalog.js").then((module) => module.renderCatalog),
})
