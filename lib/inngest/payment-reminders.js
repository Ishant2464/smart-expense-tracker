import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import { inngest } from "./client";

const convex = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL);

export const paymentReminders = inngest.createFunction(
  { id: "send-payment-reminders", triggers: [{ cron: "0 10 * * *" }] },
  async ({ step }) => {
    const users = await step.run("fetch-debts", () =>
      convex.query(api.inngest.getUsersWithOutstandingDebts)
    );

    const results = await step.run("send-emails", async () => {
      return Promise.all(
        users.map(async (user) => {
          if (!user.debts?.length) return { userId: user._id, skipped: true };

          const totalOwed = user.debts.reduce(
            (sum, debt) => sum + debt.amount,
            0
          );
          const oldestSince = Math.min(...user.debts.map((debt) => debt.since));
          const oldestDays = Math.max(
            0,
            Math.floor((Date.now() - oldestSince) / (1000 * 60 * 60 * 24))
          );
          const rows = user.debts
            .map(
              (debt) => `
                <tr>
                  <td style="padding:8px 10px;">${escapeHtml(debt.name)}</td>
                  <td style="padding:8px 10px;">${formatCurrency(debt.amount)}</td>
                  <td style="padding:8px 10px;">${daysAgo(debt.since)}</td>
                </tr>
              `
            )
            .join("");

          const html = `
            <div style="font-family:Arial,sans-serif;line-height:1.5;color:#111827;">
              <h2>Splitr Payment Reminder</h2>
              <p>
                Hi ${escapeHtml(user.name)}, you have ${user.debts.length} pending
                payment${user.debts.length === 1 ? "" : "s"} totaling
                <strong>${formatCurrency(totalOwed)}</strong>.
                The oldest is from ${oldestDays} day${oldestDays === 1 ? "" : "s"} ago.
              </p>

              <table cellspacing="0" cellpadding="0" border="1" style="border-collapse:collapse;border-color:#e5e7eb;">
                <thead>
                  <tr>
                    <th style="padding:8px 10px;text-align:left;">To</th>
                    <th style="padding:8px 10px;text-align:left;">Amount</th>
                    <th style="padding:8px 10px;text-align:left;">Since</th>
                  </tr>
                </thead>
                <tbody>${rows}</tbody>
              </table>

              <p>Please settle up when you can. Thanks!</p>
            </div>
          `;

          try {
            await convex.action(api.email.sendEmail, {
              to: user.email,
              subject: "You have pending payments on Splitr",
              html,
              apiKey: process.env.RESEND_API_KEY,
            });
            return { userId: user._id, success: true };
          } catch (err) {
            return { userId: user._id, success: false, error: err.message };
          }
        })
      );
    });

    return {
      processed: results.length,
      successes: results.filter((result) => result.success).length,
      failures: results.filter((result) => result.success === false).length,
    };
  }
);

function formatCurrency(amount) {
  return `₹${Number(amount ?? 0).toFixed(2)}`;
}

function daysAgo(timestamp) {
  const days = Math.max(
    0,
    Math.floor((Date.now() - timestamp) / (1000 * 60 * 60 * 24))
  );
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
