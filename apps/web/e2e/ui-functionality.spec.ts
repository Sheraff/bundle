import { expect, test as base, type Page } from "@playwright/test"

const test = base.extend<{ consoleProblems: string[] }>({
  consoleProblems: async ({ page }, use) => {
    const consoleProblems: string[] = []
    page.on("console", (message) => {
      if (message.type() === "error" && !message.text().includes("favicon.ico")) {
        consoleProblems.push(message.text())
      }
    })
    page.on("pageerror", (error) => consoleProblems.push(error.message))

    await use(consoleProblems)

    expect(consoleProblems).toEqual([])
  },
})

test("homepage, repository overview, and history are navigable", async ({ page, consoleProblems: _consoleProblems }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Chunk Scope" })).toBeVisible()
  await expect(page.getByText("Quick Start")).toBeVisible()

  await page.goto("/r/acme/widget?lens=entry-js-direct-css&metric=gzip")
  await expect(page.getByRole("heading", { name: "Trend" })).toBeVisible()
  await expect(page.getByRole("link", { name: "Open repository history" })).toBeVisible()

  await page.getByRole("link", { name: "Open repository history" }).click()
  await expect(page.getByRole("heading", { name: "Repository History" })).toBeVisible()
  await expect(page.getByRole("heading", { name: "Compare Builder" })).toBeVisible()
  await page.getByRole("button", { name: "Open compare" }).click()
  await expect(page.getByRole("heading", { name: "Compare", exact: true })).toBeVisible()
  await expect(page.getByText("Invalid type")).toHaveCount(0)
})

test("scenario history exposes treemap-capable series and renders visual tabs", async ({ page, consoleProblems: _consoleProblems }) => {
  await page.goto("/r/acme/widget/scenarios/fixture-app-cost?branch=main&env=all&entrypoint=all&lens=entry-js-direct-css&metric=gzip")
  const treemapHref = await page
    .getByRole("link", { name: "Open treemap for default / src/main.ts / entry-js-direct-css" })
    .getAttribute("href")
  expect(treemapHref).toContain("env=default")
  await page.goto(treemapHref!)
  await expect(page.getByRole("heading", { name: "Detail Tabs" })).toBeVisible()
  await expect(page.getByLabel("Detail tabs").getByRole("link", { name: "treemap" })).toBeVisible()
  await expect(page.locator('svg[aria-label="Bundle composition treemap"]')).toBeVisible()
  await expectTreemapToFill(page, { expectParentCells: true })

  await page.getByLabel("Detail tabs").getByRole("link", { name: "graph" }).click()
  await expect(page).toHaveURL(/env=default/)
  await expect(page).toHaveURL(/tab=graph/)
  await expect(page.locator('svg[aria-label="Chunk dependency graph"]')).toBeVisible()

  await page.getByLabel("Detail tabs").getByRole("link", { name: "waterfall" }).click()
  await expect(page).toHaveURL(/env=default/)
  await expect(page).toHaveURL(/tab=waterfall/)
  await expect(page.locator('svg[aria-label="Build-time dependency waterfall"]')).toBeVisible()
})

test("compare detail tabs preserve selected series and render visualizations", async ({ page, consoleProblems: _consoleProblems }) => {
  await page.goto('/r/acme/widget/compare?base="0123456789abcdef0123456789abcdef01234567"&head="1111111111111111111111111111111111111111"&scenario=fixture-app-cost&env=default&entrypoint=src%2Fmain.ts&lens=entry-js-direct-css&metric=gzip&tab=treemap')
  await expect(page.locator('svg[aria-label="Bundle composition treemap"]')).toBeVisible()
  await expectTreemapToFill(page)

  await page.getByLabel("Detail tabs").getByRole("link", { name: "graph" }).click()
  await expect(page).toHaveURL(/env=default/)
  await expect(page).toHaveURL(/tab=graph/)
  await expect(page.locator('svg[aria-label="Chunk dependency graph"]')).toBeVisible()

  await page.getByLabel("Detail tabs").getByRole("link", { name: "waterfall" }).click()
  await expect(page).toHaveURL(/env=default/)
  await expect(page).toHaveURL(/tab=waterfall/)
  await expect(page.locator('svg[aria-label="Build-time dependency waterfall"]')).toBeVisible()
})

async function expectTreemapToFill(page: Page, options: { expectParentCells?: boolean } = {}) {
  const metrics = await page.locator('svg[aria-label="Bundle composition treemap"]').evaluate((svg) => {
    const viewBox = svg.getAttribute("viewBox")?.split(/\s+/).map(Number) ?? []
    const viewArea = (viewBox[2] ?? 0) * (viewBox[3] ?? 0)
    const rectArea = [...svg.querySelectorAll("g > rect")].reduce((sum, rect) => {
      return sum + Number(rect.getAttribute("width")) * Number(rect.getAttribute("height"))
    }, 0)

    return {
      coverage: viewArea > 0 ? rectArea / viewArea : 0,
      parentCellCount: [...svg.querySelectorAll("g > title")].filter((title) => title.textContent?.includes("including children")).length,
      textCount: svg.querySelectorAll("text").length,
    }
  })

  expect(metrics.coverage).toBeGreaterThan(0.9)
  if (options.expectParentCells) expect(metrics.parentCellCount).toBeGreaterThan(0)
  expect(metrics.textCount).toBeGreaterThan(0)
}
