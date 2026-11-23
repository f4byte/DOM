// Turn a ReportDTO into plain text, rich HTML (for pasting into mail/chat/docs) and a PDF.
// Exporting or copying never changes the report's status — only "Submit" does.
import { formatDuration, to12h, utcIsoToLocalTime } from "@shared/time";
import type { ReportContent, ReportDTO, ReportTaskItem } from "@shared/types";
import { ATTENDANCE_LABEL } from "@/components/badges";
import { dateLong } from "@/lib/format";

const TECH_LABEL: Record<keyof ReportContent["technical"], string> = {
  frontend: "Frontend",
  backend: "Backend",
  database: "Database",
  api: "API / Integration",
  testing: "Testing & Debugging",
  deployment: "Deployment",
  other: "Other",
};
const TECH_KEYS = Object.keys(TECH_LABEL) as (keyof ReportContent["technical"])[];

export const reportFileName = (r: ReportDTO, ext: string) => `daily-report-${r.reportDate}${r.revision > 1 ? `-r${r.revision}` : ""}.${ext}`;
export const shareUrl = (r: Pick<ReportDTO, "shareToken">) => `${window.location.origin}/r/${r.shareToken}`;

const clockText = (iso: string | null) => (iso ? to12h(utcIsoToLocalTime(iso)) : "—");

function attendanceLine(r: ReportDTO): string | null {
  const a = r.header.attendance;
  if (!a) return null;
  const parts = [`${ATTENDANCE_LABEL[a.status]}`, `In ${clockText(a.loginAt)}`, `Out ${clockText(a.logoutAt)}`, `Worked ${formatDuration(a.workedMinutes)}`];
  if (a.lateMinutes > 0) parts.push(`Late ${formatDuration(a.lateMinutes)}`);
  if (a.earlyDepartureMinutes > 0) parts.push(`Left early ${formatDuration(a.earlyDepartureMinutes)}`);
  if (a.overtimeMinutes > 0) parts.push(`Overtime ${formatDuration(a.overtimeMinutes)}`);
  return parts.join(" · ");
}

function itemMeta(i: ReportTaskItem): string {
  const m: string[] = [];
  if (i.code) m.push(i.code);
  if (i.status) m.push(i.status);
  if (i.progress != null) m.push(`${i.progress}%`);
  if (i.timeSpentMinutes) m.push(formatDuration(i.timeSpentMinutes));
  return m.join(" · ");
}

/* ------------------------------------------------------------------ plain text */

export function reportToText(r: ReportDTO): string {
  const c = r.content;
  const out: string[] = [];
  const h = r.header;
  out.push(`DAILY PROGRESS REPORT — ${dateLong(r.reportDate)}${r.revision > 1 ? ` (Revision ${r.revision})` : ""}`);
  out.push(`Name: ${h.employeeName}`, `Role: ${h.employmentType}`, `Mentor / Team Lead: ${h.mentorName}`);
  const att = attendanceLine(r);
  if (att) out.push(`Attendance: ${att}`);
  out.push("");
  if (c.summary.trim()) out.push("SUMMARY", c.summary.trim(), "");

  const taskSection = (title: string, items: ReportTaskItem[], extra?: (i: ReportTaskItem) => string) => {
    if (!items.length) return;
    out.push(title);
    items.forEach((i, n) => {
      out.push(`${n + 1}. ${i.title}${itemMeta(i) ? ` [${itemMeta(i)}]` : ""}`);
      if (i.details.trim()) out.push(`   ${i.details.trim().replace(/\n/g, "\n   ")}`);
      const e = extra?.(i);
      if (e) out.push(`   ${e}`);
    });
    out.push("");
  };
  taskSection("COMPLETED TASKS", c.completed);
  taskSection("IN-PROGRESS TASKS", c.inProgress);
  taskSection("PENDING TASKS", c.pending, (i) => (i.reason?.trim() ? `Reason: ${i.reason.trim()}` : ""));

  const tech = TECH_KEYS.filter((k) => c.technical[k].length);
  if (tech.length) {
    out.push("TECHNICAL WORK");
    for (const k of tech) {
      out.push(`${TECH_LABEL[k]}:`);
      c.technical[k].forEach((l) => out.push(`  - ${l}`));
    }
    out.push("");
  }
  if (c.challenges.length) {
    out.push("CHALLENGES & SOLUTIONS");
    c.challenges.forEach((x, n) => {
      out.push(`${n + 1}. Problem: ${x.problem}`);
      if (x.solution.trim()) out.push(`   Solution: ${x.solution}`);
    });
    out.push("");
  }
  if (c.nextPlan.length) {
    out.push("PLAN FOR NEXT WORKING DAY");
    c.nextPlan.forEach((l) => out.push(`  - ${l}`));
    out.push("");
  }
  return out.join("\n").trim() + "\n";
}

/* ------------------------------------------------------------------ rich HTML (clipboard) */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

export function reportToHtml(r: ReportDTO): string {
  const c = r.content;
  const h = r.header;
  const parts: string[] = [];
  parts.push(`<h2 style="margin:0 0 4px">Daily Progress Report — ${esc(dateLong(r.reportDate))}${r.revision > 1 ? ` (Revision ${r.revision})` : ""}</h2>`);
  parts.push(`<p style="margin:0 0 8px"><b>Name:</b> ${esc(h.employeeName)}<br><b>Role:</b> ${esc(h.employmentType)}<br><b>Mentor / Team Lead:</b> ${esc(h.mentorName)}${attendanceLine(r) ? `<br><b>Attendance:</b> ${esc(attendanceLine(r)!)}` : ""}</p>`);
  if (c.summary.trim()) parts.push(`<h3>Summary</h3><p>${esc(c.summary.trim())}</p>`);
  const taskList = (title: string, items: ReportTaskItem[], withReason = false) => {
    if (!items.length) return;
    parts.push(`<h3>${title}</h3><ol>`);
    for (const i of items) {
      parts.push(`<li><b>${esc(i.title)}</b>${itemMeta(i) ? ` <i>(${esc(itemMeta(i))})</i>` : ""}${i.details.trim() ? `<br>${esc(i.details.trim())}` : ""}${withReason && i.reason?.trim() ? `<br><i>Reason:</i> ${esc(i.reason.trim())}` : ""}</li>`);
    }
    parts.push("</ol>");
  };
  taskList("Completed tasks", c.completed);
  taskList("In-progress tasks", c.inProgress);
  taskList("Pending tasks", c.pending, true);
  const tech = TECH_KEYS.filter((k) => c.technical[k].length);
  if (tech.length) {
    parts.push("<h3>Technical work</h3>");
    for (const k of tech) parts.push(`<p style="margin:4px 0"><b>${TECH_LABEL[k]}</b></p><ul>${c.technical[k].map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
  }
  if (c.challenges.length) {
    parts.push("<h3>Challenges &amp; solutions</h3><ol>");
    for (const x of c.challenges) parts.push(`<li><b>Problem:</b> ${esc(x.problem)}${x.solution.trim() ? `<br><b>Solution:</b> ${esc(x.solution)}` : ""}</li>`);
    parts.push("</ol>");
  }
  if (c.nextPlan.length) parts.push(`<h3>Plan for next working day</h3><ul>${c.nextPlan.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>`);
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45">${parts.join("")}</div>`;
}

/** Copy as formatted text (HTML + plain-text fallback). Returns "rich" or "plain" depending on what the browser allowed. */
export async function copyReport(r: ReportDTO): Promise<"rich" | "plain"> {
  const text = reportToText(r);
  const html = reportToHtml(r);
  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([text], { type: "text/plain" }) })]);
      return "rich";
    } catch {
      /* fall through to plain text */
    }
  }
  await navigator.clipboard.writeText(text);
  return "plain";
}

/* ------------------------------------------------------------------ PDF */

// jsPDF's built-in Helvetica only covers Latin-1; map common punctuation and replace anything else so the file never breaks.
const LATIN_MAP: Record<string, string> = { "’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-", "…": "...", "•": "-", "→": "->", "✓": "v", " ": " " };
const latin = (s: string) =>
  s
    .replace(/[’‘“”–—…•→✓ ]/g, (m) => LATIN_MAP[m])
    .replace(/[^\u0009\u000a -~¡-ÿ]/g, "?");

/** Build the PDF in the browser. jsPDF is loaded on demand so it doesn't weigh down the main bundle. */
export async function buildReportPdf(r: ReportDTO): Promise<Blob> {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const autoTable = autoTableMod.default;
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 42;
  const c = r.content;
  const h = r.header;
  let y = M;

  const ensure = (need: number) => {
    if (y + need > doc.internal.pageSize.getHeight() - 50) {
      doc.addPage();
      y = M;
    }
  };
  const heading = (t: string) => {
    ensure(36);
    y += 10;
    doc.setFont("helvetica", "bold").setFontSize(11).setTextColor(30, 64, 175);
    doc.text(latin(t.toUpperCase()), M, y);
    doc.setDrawColor(203, 213, 225).line(M, y + 4, W - M, y + 4);
    y += 16;
    doc.setTextColor(20, 20, 20);
  };
  const paragraph = (t: string, indent = 0, size = 10) => {
    doc.setFont("helvetica", "normal").setFontSize(size);
    const lines = doc.splitTextToSize(latin(t), W - 2 * M - indent) as string[];
    for (const l of lines) {
      ensure(14);
      doc.text(l, M + indent, y);
      y += 13;
    }
  };

  doc.setFont("helvetica", "bold").setFontSize(17).setTextColor(15, 23, 42);
  doc.text("Daily Progress Report", M, y + 6);
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(100, 116, 139);
  doc.text(latin(`${dateLong(r.reportDate)}${r.revision > 1 ? `  -  Revision ${r.revision}` : ""}`), W - M, y + 6, { align: "right" });
  y += 20;

  const att = attendanceLine(r);
  autoTable(doc, {
    startY: y,
    theme: "grid",
    body: [
      ["Name", latin(h.employeeName), "Role", latin(h.employmentType)],
      ["Mentor / TL", latin(h.mentorName), "Date", latin(dateLong(r.reportDate))],
      ...(att ? [[{ content: "Attendance", styles: { fontStyle: "bold" as const } }, { content: latin(att), colSpan: 3 }]] : []),
    ],
    styles: { fontSize: 9.5, cellPadding: 5, lineColor: [226, 232, 240], textColor: [30, 41, 59] },
    columnStyles: { 0: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 80 }, 2: { fontStyle: "bold", fillColor: [241, 245, 249], cellWidth: 60 } },
    margin: { left: M, right: M },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  if (c.summary.trim()) {
    heading("Summary");
    paragraph(c.summary.trim());
  }

  const taskTable = (title: string, items: ReportTaskItem[], kind: "done" | "wip" | "pending") => {
    if (!items.length) return;
    heading(title);
    const head = kind === "done" ? ["#", "Task", "Details", "Time"] : kind === "wip" ? ["#", "Task", "Details", "Progress"] : ["#", "Task", "Details", "Reason"];
    autoTable(doc, {
      startY: y,
      head: [head],
      body: items.map((i, n) => [
        String(n + 1),
        latin(`${i.code ? `${i.code}  ` : ""}${i.title}`),
        latin(i.details || "-"),
        kind === "done" ? (i.timeSpentMinutes ? formatDuration(i.timeSpentMinutes) : "-") : kind === "wip" ? (i.progress != null ? `${i.progress}%` : "-") : latin(i.reason || "-"),
      ]),
      theme: "striped",
      headStyles: { fillColor: [30, 64, 175], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4, textColor: [30, 41, 59], overflow: "linebreak" },
      columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 140 }, 3: { cellWidth: kind === "pending" ? 110 : 60 } },
      margin: { left: M, right: M },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  };
  taskTable("Completed tasks", c.completed, "done");
  taskTable("In-progress tasks", c.inProgress, "wip");
  taskTable("Pending tasks", c.pending, "pending");

  const tech = TECH_KEYS.filter((k) => c.technical[k].length);
  if (tech.length) {
    heading("Technical work");
    for (const k of tech) {
      ensure(24);
      doc.setFont("helvetica", "bold").setFontSize(10).text(TECH_LABEL[k], M, y);
      y += 13;
      for (const l of c.technical[k]) paragraph(`-  ${l}`, 8);
      y += 3;
    }
  }
  if (c.challenges.length) {
    heading("Challenges & solutions");
    autoTable(doc, {
      startY: y,
      head: [["#", "Problem", "Solution"]],
      body: c.challenges.map((x, n) => [String(n + 1), latin(x.problem), latin(x.solution || "-")]),
      theme: "striped",
      headStyles: { fillColor: [30, 64, 175], fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 4, textColor: [30, 41, 59] },
      columnStyles: { 0: { cellWidth: 22 } },
      margin: { left: M, right: M },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 4;
  }
  if (c.nextPlan.length) {
    heading("Plan for next working day");
    for (const l of c.nextPlan) paragraph(`-  ${l}`, 8);
  }

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(148, 163, 184);
    doc.text(latin(`${h.employeeName} - Daily report ${r.reportDate}${r.revision > 1 ? ` r${r.revision}` : ""}`), M, doc.internal.pageSize.getHeight() - 24);
    doc.text(`Page ${p} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 24, { align: "right" });
  }
  return doc.output("blob");
}
