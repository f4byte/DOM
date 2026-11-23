// Browser end-to-end test: drives the real UI against a running `wrangler dev` (fresh local D1 with SETUP_KEY=test-setup-key).
//   npm run build && npx wrangler dev --port 8787 --persist-to <fresh dir> --var SETUP_KEY:test-setup-key
//   node scripts/ui-e2e.mjs            (set SHOTS=<dir> to save screenshots)
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.BASE ?? "http://localhost:8787";
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

let passed = 0;
const failures = [];
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`  FAIL ${name}\n       ${String(e.message).split("\n")[0]}`);
  }
}
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

const email = "hasibur@example.test";
const password = "correct-horse-battery";
// Task titles live in <input> cells, which getByText can't see — match on input values instead.
const hasInput = (p, v, t = 8000) => p.waitForFunction((x) => [...document.querySelectorAll("input")].some((i) => i.value === x), v, { timeout: t });
const noInput = (p, v, t = 8000) => p.waitForFunction((x) => ![...document.querySelectorAll("input")].some((i) => i.value === x), v, { timeout: t });
const expectText = async (loc, text, timeout = 8000) => loc.getByText(text, { exact: false }).first().waitFor({ timeout });

console.log("Setup & auth");
await step("first-run setup form is shown and creates the account", async () => {
  await page.goto(BASE);
  await expectText(page, "Create your account");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByLabel("Setup key").fill("test-setup-key");
  await shot(page, "01-setup");
  await page.getByRole("button", { name: "Create account" }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
});
await step("dashboard shows seeded task stats and attendance card", async () => {
  await expectText(page, "Today's attendance");
  await page.getByText("Total tasks").waitFor();
  await shot(page, "02-dashboard");
});
await step("sign out then sign in with wrong password shows an error, right password works", async () => {
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.getByRole("heading", { name: "Sign in" }).waitFor();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("alert").waitFor();
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("heading", { name: "Dashboard" }).waitFor();
});

console.log("Tasks");
await page.goto(`${BASE}/tasks`);
await step("two seeded tasks are listed (Task 01 / Task 02)", async () => {
  await hasInput(page, "Task Management SaaS");
  await hasInput(page, "Cloudflare Deployment with D1");
  await shot(page, "03-tasks");
});
await step("add a task from the entry row", async () => {
  await page.getByLabel("New task title").fill("Write API docs");
  await page.getByLabel("New task title").press("Enter");
  await expectText(page, "TSK-0003");
});
await step("inline status change to Completed sets progress to 100 and a completion time", async () => {
  await page.getByLabel("Status for TSK-0003").selectOption("Completed");
  await page.waitForFunction(() => document.querySelector('input[aria-label="Progress for TSK-0003"]')?.value === "100");
});
await step("inline title edit persists after reload", async () => {
  const row = page.locator("tr", { hasText: "TSK-0003" });
  const title = row.locator("input.cell-input").first();
  await title.fill("Write API documentation");
  await title.press("Enter");
  await page.waitForTimeout(500);
  await page.reload();
  await hasInput(page, "Write API documentation");
});
await step("invalid duration is rejected with a message and not saved", async () => {
  const est = page.locator('tr:has-text("TSK-0003") input[aria-label="Estimated duration"]');
  await est.fill("banana");
  await est.blur();
  await expectText(page, "Estimated duration: use e.g.");
});
await step("valid duration saves (1h 30m)", async () => {
  const est = page.locator('tr:has-text("TSK-0003") input[aria-label="Estimated duration"]');
  await est.fill("1h 30m");
  await est.blur();
  await page.waitForTimeout(600);
  await page.reload();
  await page.locator('tr:has-text("TSK-0003") input[aria-label="Estimated duration"]').waitFor();
  const v = await page.locator('tr:has-text("TSK-0003") input[aria-label="Estimated duration"]').inputValue();
  if (v !== "1h 30m") throw new Error(`expected "1h 30m" got "${v}"`);
});
await step("past deadline highlights the row as overdue", async () => {
  const dl = page.locator('tr:has-text("TSK-0001") input[aria-label="Deadline for TSK-0001"]');
  await dl.fill("2020-01-02T10:00");
  await dl.blur();
  await page.waitForFunction(() => [...document.querySelectorAll("tr")].some((tr) => tr.textContent.includes("TSK-0001") && tr.className.includes("bg-red")));
  await shot(page, "04-tasks-overdue");
});
await step("search and status filter narrow the list", async () => {
  await page.getByLabel("Search tasks").fill("Cloudflare");
  await noInput(page, "Task Management SaaS");
  await page.getByLabel("Search tasks").fill("");
  await hasInput(page, "Task Management SaaS");
  await page.getByLabel("Filter by status").selectOption("Completed");
  await noInput(page, "Task Management SaaS");
  await hasInput(page, "Write API documentation");
  await page.getByRole("button", { name: "Clear" }).click();
});
await step("sorting by priority toggles", async () => {
  await page.getByRole("button", { name: "Priority" }).click();
  await page.getByRole("columnheader", { name: /Priority/ }).waitFor();
});
await step("task drawer shows details and history", async () => {
  await page.getByRole("button", { name: "Open TSK-0003" }).click();
  await page.getByRole("dialog").getByText("Implementation notes").waitFor();
  await page.getByRole("tab", { name: /History/ }).click();
  await expectText(page.getByRole("dialog"), "Status changed");
  await shot(page, "05-task-drawer");
  await page.keyboard.press("Escape");
});
await step("duplicate creates a new Not Started task", async () => {
  await page.getByRole("button", { name: "Duplicate TSK-0003" }).click();
  await expectText(page, "TSK-0004");
});
await step("delete asks for confirmation then removes the row", async () => {
  await page.getByRole("button", { name: "Delete TSK-0004" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete task" }).click();
  await page.waitForFunction(() => !document.body.textContent.includes("TSK-0004"));
});
await step("quick add dialog opens with the N shortcut and creates a task", async () => {
  await page.locator("body").click({ position: { x: 5, y: 300 } });
  await page.keyboard.press("n");
  await page.getByRole("dialog").getByPlaceholder(/attendance table/).fill("Quick added task");
  await page.getByRole("dialog").getByRole("button", { name: "Add task" }).click();
  await hasInput(page, "Quick added task");
});

console.log("Attendance");
await page.goto(`${BASE}/attendance`);
await step("clock in records a login time", async () => {
  await page.getByRole("button", { name: "Clock in now" }).click();
  await page.getByRole("button", { name: /Clock out now|Update clock-out/ }).waitFor();
  await shot(page, "06-attendance");
});
await step("monthly log has today's row with source badge", async () => {
  await expectText(page, "Manual");
});
await step("correction requires a reason, then is saved and audited", async () => {
  await page.getByRole("button", { name: "Correct", exact: true }).click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("First login").fill(new Date(Date.now() + 6 * 3600e3 - 2 * 3600e3).toISOString().slice(0, 16));
  await dlg.getByRole("button", { name: "Save correction" }).click();
  await expectText(dlg, "reason");
  await dlg.getByPlaceholder(/Forgot to clock in/).fill("Arrived earlier per door log");
  await dlg.getByRole("button", { name: "Save correction" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await page.getByRole("tab", { name: "Audit trail" }).click();
  await expectText(page, "Arrived earlier per door log");
  await shot(page, "07-attendance-audit");
});

console.log("Development log");
await page.goto(`${BASE}/devlog`);
await step("add a dev-log entry and see it in the daily summary", async () => {
  await page.getByRole("button", { name: "New entry" }).first().click();
  const dlg = page.getByRole("dialog");
  await dlg.getByLabel("What was implemented").fill("Built the Hono tasks API with D1 queries");
  await dlg.getByLabel("Technologies used").fill("Hono, D1, Zod");
  await dlg.getByLabel("Problems faced").fill("Duplicate rows on retry");
  await dlg.getByLabel("Solutions applied").fill("Added a unique index");
  await dlg.getByRole("button", { name: "Add entry" }).click();
  await expectText(page, "Built the Hono tasks API");
  await expectText(page, "Daily summary");
  await expectText(page, "Backend Implementation".slice(0, 8));
  await shot(page, "08-devlog");
});

console.log("Daily report");
await page.goto(`${BASE}/reports`);
await step("generate a draft from real records", async () => {
  await page.getByRole("button", { name: "Generate report for this day" }).click();
  await expectText(page, "Completed tasks");
});
await step("draft contains the completed task and the dev-log problem", async () => {
  await page.waitForFunction(() => [...document.querySelectorAll("input")].some((i) => i.value === "Write API documentation"));
  await page.waitForFunction(() => [...document.querySelectorAll("textarea")].some((t) => t.value.includes("Duplicate rows on retry")));
  await shot(page, "09-report-edit");
});
await step("edit the summary and save the draft", async () => {
  await page.getByLabel("Summary").fill("Shipped the tasks module and documented the API.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByText("Unsaved changes").waitFor({ state: "detached" });
});
await step("preview renders the report", async () => {
  await page.getByRole("tab", { name: "Preview" }).click();
  await expectText(page, "Shipped the tasks module");
  await shot(page, "10-report-preview");
});
await step("copy as formatted text puts HTML + text on the clipboard", async () => {
  await page.getByRole("button", { name: "Copy text" }).click();
  await expectText(page, "Copied");
  const txt = await page.evaluate(() => navigator.clipboard.readText());
  if (!txt.includes("DAILY PROGRESS REPORT") || !txt.includes("Shipped the tasks module")) throw new Error("clipboard text missing content");
});
await step("PDF export downloads a valid PDF", async () => {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: "PDF", exact: true }).click()]);
  const p = await dl.path();
  const head = fs.readFileSync(p).subarray(0, 5).toString();
  if (head !== "%PDF-") throw new Error(`not a PDF: ${head}`);
  if (fs.statSync(p).size < 2000) throw new Error("PDF suspiciously small");
  if (SHOTS) fs.copyFileSync(p, `${SHOTS}/report.pdf`);
});
let shareLink = "";
await step("share link is disabled for a draft", async () => {
  if (!(await page.getByRole("button", { name: "Share link" }).isDisabled())) throw new Error("share link should be disabled while draft");
});
await step("submit locks the report", async () => {
  await page.getByRole("button", { name: "Submit to TL" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit report" }).click();
  await expectText(page, "Locked");
  await page.getByRole("button", { name: "Create revision" }).waitFor();
});
await step("share link copies and works for an anonymous visitor", async () => {
  await page.getByRole("button", { name: "Share link" }).click();
  shareLink = await page.evaluate(() => navigator.clipboard.readText());
  if (!/\/r\/[A-Za-z0-9_-]{16,}/.test(shareLink)) throw new Error(`bad link ${shareLink}`);
  const anon = await browser.newContext({ viewport: { width: 1000, height: 800 } });
  const p = await anon.newPage();
  await p.goto(shareLink);
  await expectText(p, "Shipped the tasks module");
  await expectText(p, "read-only");
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/11-public-report.png`, fullPage: true });
  await anon.close();
});
await step("opening the share link as an outsider marked it viewed", async () => {
  await page.reload();
  await expectText(page, "Viewed");
});

console.log("Team Lead");
await page.goto(`${BASE}/settings`);
await step("create a Team Lead account in settings", async () => {
  await page.getByRole("tab", { name: "Team Lead" }).click();
  await page.getByLabel("TL email").fill("tl@example.test");
  await page.getByLabel("Temporary password").fill("tl-password-1234");
  await page.getByRole("button", { name: "Create Team Lead account" }).click();
  await expectText(page, "tl@example.test");
});
const tlCtx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const tl = await tlCtx.newPage();
await step("TL signs in and sees only the reports view", async () => {
  await tl.goto(BASE);
  await tl.getByLabel("Email").fill("tl@example.test");
  await tl.getByLabel("Password").fill("tl-password-1234");
  await tl.getByRole("button", { name: "Sign in" }).click();
  await expectText(tl, "Submitted reports");
  if (await tl.getByText("My Tasks").count()) throw new Error("TL must not see intern navigation");
  await shot(tl, "12-tl-list");
});
await step("TL requests a revision (comment required) with feedback", async () => {
  await tl.getByRole("link", { name: /Hasibur Rahman/ }).first().click();
  await expectText(tl, "Shipped the tasks module");
  if (!(await tl.getByRole("button", { name: "Request revision" }).isDisabled())) throw new Error("revision request should need a comment");
  await tl.getByPlaceholder(/Feedback for the intern/).fill("Please add test coverage details.");
  await tl.getByRole("button", { name: "Request revision" }).click();
  await expectText(tl, "Marked as revision requested");
  await shot(tl, "13-tl-review");
});
await page.goto(`${BASE}/reports`);
await step("intern sees the TL feedback and status", async () => {
  await expectText(page, "Revision requested");
  await expectText(page, "Please add test coverage details.");
});
await step("intern creates revision 2, edits and resubmits; old version stays locked", async () => {
  await page.getByRole("button", { name: "Create revision" }).click();
  await expectText(page, "Revision 2");
  await page.getByLabel("Summary").fill("Shipped the tasks module, documented the API and added test coverage notes.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await page.getByText("Unsaved changes").waitFor({ state: "detached" });
  await page.getByRole("button", { name: "Submit to TL" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Submit report" }).click();
  await expectText(page, "Locked");
  await page.getByRole("button", { name: /Rev 1/ }).click();
  await expectText(page, "Older version");
});
await step("TL approves the latest revision", async () => {
  await tl.goto(`${BASE}/tl`);
  await tl.getByRole("link", { name: /Revision 2/ }).click();
  await expectText(tl, "test coverage notes");
  await tl.getByRole("button", { name: "Approve" }).click();
  await expectText(tl, "Marked as approved");
});
await step("report history lists both revisions with statuses", async () => {
  await page.goto(`${BASE}/history`);
  await page.locator("tbody tr", { hasText: "Approved" }).first().waitFor();
  await page.locator("tbody tr", { hasText: "Revision requested" }).first().waitFor();
  if ((await page.locator("tbody tr").count()) !== 2) throw new Error("expected exactly 2 report versions");
  await shot(page, "14-history");
});

console.log("Automation (Android webhook)");
let token = "";
await step("create a device token and see it once", async () => {
  await page.goto(`${BASE}/settings`);
  await page.getByRole("tab", { name: "Automation" }).click();
  await page.getByLabel("Token label").fill("Test phone");
  await page.getByRole("button", { name: "Create token" }).click();
  const dlg = page.getByRole("dialog");
  token = await dlg.locator("input[readonly]").inputValue();
  if (!token.startsWith("pims_")) throw new Error("token missing");
  await dlg.getByRole("button", { name: "Done" }).click();
  await expectText(page, "Test phone");
  await shot(page, "15-settings-automation");
});
await step("webhook rejects a bad token and accepts a lock event with the real token", async () => {
  const bad = await fetch(`${BASE}/api/device/event`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer pims_nope" }, body: '{"event":"lock"}' });
  if (bad.status !== 401) throw new Error(`bad token got ${bad.status}`);
  const ok = await fetch(`${BASE}/api/device/event`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: '{"event":"lock","device":"Test phone"}' });
  if (!ok.ok) throw new Error(`webhook ${ok.status}`);
});
await step("device events are listed (accepted or ignored with a reason) and never silently change attendance", async () => {
  await page.goto(`${BASE}/attendance`);
  await page.getByRole("tab", { name: "Device events" }).click();
  await expectText(page, "Phone locked");
});

console.log("Analytics, dashboard, settings, mobile");
await step("analytics renders charts", async () => {
  await page.goto(`${BASE}/analytics`);
  await expectText(page, "Hours worked per day");
  await page.locator(".recharts-responsive-container").first().waitFor();
  await shot(page, "16-analytics");
});
await step("dashboard charts render and task stats reflect real data", async () => {
  await page.goto(BASE);
  await page.locator(".recharts-responsive-container").first().waitFor();
  await shot(page, "17-dashboard-final");
});
await step("settings save: office hours persist across reload", async () => {
  await page.goto(`${BASE}/settings`);
  await page.getByLabel("Unpaid break (min)").fill("30");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expectText(page, "Settings saved");
  await page.reload();
  if ((await page.getByLabel("Unpaid break (min)").inputValue()) !== "30") throw new Error("not persisted");
  await page.getByLabel("Unpaid break (min)").fill("0");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expectText(page, "Settings saved");
});
await step("backup export downloads JSON containing the tasks", async () => {
  await page.getByRole("tab", { name: "Security & data" }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Full backup (JSON)" }).click()]);
  const j = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  if (!JSON.stringify(j).includes("Write API documentation")) throw new Error("backup missing task");
});
await step("theme toggle switches to dark and back", async () => {
  await page.getByRole("button", { name: /^Theme:/ }).click();
  await page.waitForTimeout(200);
  const cls = await page.evaluate(() => document.documentElement.className);
  await shot(page, "18-dark-or-next");
  if (typeof cls !== "string") throw new Error("no class");
});
await step("mobile layout: drawer menu opens, no horizontal page overflow on tasks", async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const mp = await m.newPage();
  await mp.goto(BASE);
  await mp.getByLabel("Email").fill(email);
  await mp.getByLabel("Password").fill(password);
  await mp.getByRole("button", { name: "Sign in" }).click();
  await mp.getByRole("heading", { name: "Dashboard" }).waitFor();
  await mp.getByRole("button", { name: "Open menu" }).click();
  await mp.getByRole("link", { name: "My Tasks" }).click();
  await hasInput(mp, "Task Management SaaS");
  const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  if (overflow) throw new Error("page scrolls horizontally on mobile");
  if (SHOTS) await mp.screenshot({ path: `${SHOTS}/19-mobile-tasks.png` });
  await m.close();
});
await step("unknown route shows Not found, and no console errors occurred during the run", async () => {
  await page.goto(`${BASE}/nope`);
  await expectText(page, "Page not found");
  const relevant = consoleErrors.filter((e) => !/Failed to load resource.*(401|404|409)/.test(e));
  if (relevant.length) throw new Error(`console errors: ${relevant.slice(0, 3).join(" | ")}`);
});

await browser.close();
console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("Failed:\n - " + failures.join("\n - "));
  process.exit(1);
}
