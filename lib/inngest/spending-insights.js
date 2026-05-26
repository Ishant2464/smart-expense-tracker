import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { inngest } from "./client";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);

export const spendingInsights = inngest.createFunction(
  {
    name: "Generate Spending Insights",
    id: "generate-spending-insights",
    triggers: [{ cron: "0 8 1 * *" }],
  },
  async ({ step }) => {
    const users = await step.run("Fetch users with expenses", async () => {
      return await convex.query(api.inngest.getUsersWithExpenses);
    });

    const results = [];

    for (const user of users) {
      try {
        const insightsData = await step.run(`Analytics ${user._id}`, () =>
          convex.query(api.insights.getUserInsightsDataForInngest, {
            userId: user._id,
          })
        );

        if (insightsData.currentMonthSpending.transactionCount === 0) {
          results.push({ userId: user._id, skipped: true });
          continue;
        }

        const summaryResult = await step.run(`AI summary ${user._id}`, () =>
          convex.action(api.insights.generateInsightsSummary, {
            insightsData,
          })
        );

        const html = buildInsightsEmail({
          user,
          insightsData,
          summary: summaryResult.summary,
        });

        await step.run(`Email ${user._id}`, () =>
          convex.action(api.email.sendEmail, {
            to: user.email,
            subject: `Your ${insightsData.period.month} Splitr Spending Insights`,
            html,
            apiKey: process.env.RESEND_API_KEY,
          })
        );

        results.push({ userId: user._id, success: true });
      } catch (err) {
        results.push({
          userId: user._id,
          success: false,
          error: err.message,
        });
      }
    }

    return {
      processed: results.length,
      success: results.filter((result) => result.success).length,
      skipped: results.filter((result) => result.skipped).length,
      failed: results.filter((result) => result.success === false).length,
    };
  }
);

function buildInsightsEmail({ user, insightsData, summary }) {
  const current = insightsData.currentMonthSpending;
  const change = insightsData.monthOverMonthChange.totalChangePercent;
  const topCategory = current.byCategory[0];

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
      <h1>${escapeHtml(insightsData.period.month)} Spending Insights</h1>
      <p>Hi ${escapeHtml(user.name)}, here is your AI-powered Splitr analysis for this month.</p>

      <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin:20px 0;">
        ${statBox("Total spent", formatCurrency(current.total))}
        ${statBox("Transactions", String(current.transactionCount))}
        ${statBox("Top category", topCategory ? `${escapeHtml(topCategory.category)} (${formatCurrency(topCategory.amount)})` : "None")}
        ${statBox("Month-over-month", `${change >= 0 ? "+" : ""}${change.toFixed(1)}%`)}
      </div>

      ${buildAnomalyHtml(insightsData.anomalies)}

      <div style="margin-top:20px;padding:16px;border:1px solid #e5e7eb;border-radius:8px;">
        ${formatSummaryAsHtml(summary)}
      </div>

      <p style="margin-top:24px;color:#6b7280;font-size:13px;">
        Open Splitr to explore category breakdowns, top expenses, and more detailed recommendations.
      </p>
    </div>
  `;
}

function statBox(label, value) {
  return `
    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;background:#f9fafb;">
      <div style="font-size:12px;color:#6b7280;">${label}</div>
      <div style="font-size:18px;font-weight:700;">${value}</div>
    </div>
  `;
}

function buildAnomalyHtml(anomalies) {
  if (!anomalies.length) return "";

  const rows = anomalies
    .map(
      (anomaly) => `
        <li>
          <strong>${escapeHtml(anomaly.category)}</strong>: ${formatCurrency(
            anomaly.currentAmount
          )} vs ${formatCurrency(anomaly.threeMonthAverage)} average (${anomaly.multiplier.toFixed(1)}x)
        </li>
      `
    )
    .join("");

  return `
    <div style="margin-top:20px;padding:14px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#92400e;">
      <strong>Anomaly alerts</strong>
      <ul>${rows}</ul>
    </div>
  `;
}

function formatSummaryAsHtml(summary) {
  return escapeHtml(summary)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function formatCurrency(amount) {
  return `₹${Number(amount ?? 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
