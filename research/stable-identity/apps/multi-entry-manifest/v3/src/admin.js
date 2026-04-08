import "./styles/admin.css"
import badgeUrl from "./assets/admin-badge.svg"
import { renderScaffold } from "./shared/platform.js"

renderScaffold({
  mountId: "admin-fixture",
  title: "Admin entry",
  summary: "The merge should be reported as merge lineage, not as an unrelated add/remove pair.",
  badgeUrl,
  loadRoute: () => import("./routes/audit.js").then((module) => module.renderAudit),
})
