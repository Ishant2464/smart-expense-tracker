import { v } from "convex/values";
import { action, internalQuery, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { generateGroqText } from "./aiProviders.js";

export const getUserInsightsData = query({
  args: {},
  handler: async (ctx) => {
    const user = await ctx.runQuery(internal.users.getCurrentUser);
    return await computeInsightsForUser(ctx, user._id);
  },
});

export const getUserInsightsDataForInngest = query({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await computeInsightsForUser(ctx, args.userId);
  },
});

export const getUserInsightsDataByUserId = internalQuery({
  args: {
    userId: v.id("users"),
  },
  handler: async (ctx, args) => {
    return await computeInsightsForUser(ctx, args.userId);
  },
});

export const generateInsightsSummary = action({
  args: {
    insightsData: v.any(),
  },
  handler: async (ctx, args) => {
    const prompt = `
You are Splitr's financial insights assistant.

Here is pre-computed spending data. Do NOT recalculate any numbers. Use the exact numbers provided and interpret them.

Pre-computed data:
${JSON.stringify(args.insightsData, null, 2)}

Provide insights in these sections:
**Monthly Overview**
**Spending Patterns**
**Anomalies & Alerts**
**Saving Opportunities**
**Forecast & Recommendations**

Be concise, friendly, and actionable. Use ₹ for currency. Do not use HTML.
    `.trim();

    const summary = await generateGroqText(prompt);

    return {
      success: true,
      summary,
      generatedAt: Date.now(),
    };
  },
});

async function computeInsightsForUser(ctx, userId) {
  const now = new Date();
  const currentMonth = getMonthRange(now, 0);
  const previousMonth = getMonthRange(now, -1);
  const threeMonthRanges = [-1, -2, -3].map((offset) =>
    getMonthRange(now, offset)
  );
  const currentYearStart = new Date(now.getFullYear(), 0, 1).getTime();
  const expenses = await ctx.db.query("expenses").collect();
  const userExpenses = expenses
    .map((expense) => toUserExpense(expense, userId))
    .filter(Boolean);
  const currentExpenses = filterByRange(userExpenses, currentMonth);
  const previousExpenses = filterByRange(userExpenses, previousMonth);
  const threeMonthExpenses = threeMonthRanges.map((range) =>
    filterByRange(userExpenses, range)
  );
  const ytdExpenses = userExpenses.filter(
    (expense) => expense.date >= currentYearStart && expense.date <= now.getTime()
  );

  const currentMonthSpending = buildPeriodSummary(currentExpenses);
  const previousMonthSpending = buildPeriodSummary(previousExpenses);
  const threeMonthAverages = buildThreeMonthAverages(threeMonthExpenses);
  const monthOverMonthChange = buildMonthOverMonthChange(
    currentMonthSpending,
    previousMonthSpending
  );
  const anomalies = buildAnomalies(
    currentMonthSpending.byCategory,
    threeMonthAverages.byCategory
  );
  const daysInMonth = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    0
  ).getDate();
  const daysElapsed = Math.max(1, now.getDate());
  const projected = currentMonthSpending.total / daysElapsed * daysInMonth;
  const ytdTotal = sumAmounts(ytdExpenses);

  return {
    generatedAt: Date.now(),
    period: {
      month: now.toLocaleString("en-US", { month: "long" }),
      year: now.getFullYear(),
    },
    currentMonthSpending,
    previousMonthSpending,
    monthOverMonthChange,
    threeMonthAverages,
    anomalies,
    projectedMonthEnd: {
      projected: roundCurrency(projected),
      daysElapsed,
      daysRemaining: Math.max(0, daysInMonth - daysElapsed),
    },
    topExpenses: currentExpenses
      .slice()
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
      .map((expense) => ({
        description: expense.description,
        amount: roundCurrency(expense.amount),
        category: expense.category,
        date: expense.date,
      })),
    yearToDate: {
      total: roundCurrency(ytdTotal),
      monthlyAverage: roundCurrency(ytdTotal / Math.max(1, now.getMonth() + 1)),
    },
  };
}

function toUserExpense(expense, userId) {
  const userSplit = expense.splits.find((split) => split.userId === userId);
  const isInvolved = expense.paidByUserId === userId || userSplit;

  if (!isInvolved) return null;

  return {
    description: expense.description,
    amount: roundCurrency(userSplit?.amount ?? 0),
    category: expense.category ?? "other",
    date: expense.date,
  };
}

function getMonthRange(date, offset) {
  const start = new Date(date.getFullYear(), date.getMonth() + offset, 1);
  const end = new Date(date.getFullYear(), date.getMonth() + offset + 1, 1);

  return {
    start: start.getTime(),
    end: end.getTime(),
  };
}

function filterByRange(expenses, range) {
  return expenses.filter(
    (expense) => expense.date >= range.start && expense.date < range.end
  );
}

function buildPeriodSummary(expenses) {
  const total = roundCurrency(sumAmounts(expenses));
  const byCategory = buildCategoryBreakdown(expenses, total);

  return {
    total,
    byCategory,
    transactionCount: expenses.length,
    averageTransaction: roundCurrency(total / Math.max(1, expenses.length)),
  };
}

function buildCategoryBreakdown(expenses, total = sumAmounts(expenses)) {
  const totals = {};

  for (const expense of expenses) {
    totals[expense.category] = (totals[expense.category] ?? 0) + expense.amount;
  }

  return Object.entries(totals)
    .map(([category, amount]) => ({
      category,
      amount: roundCurrency(amount),
      percentage: total > 0 ? roundCurrency((amount / total) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

function buildThreeMonthAverages(monthlyExpenses) {
  const totals = monthlyExpenses.map(sumAmounts);
  const categoryTotals = {};

  for (const expenses of monthlyExpenses) {
    const breakdown = buildCategoryBreakdown(expenses);
    for (const item of breakdown) {
      categoryTotals[item.category] =
        (categoryTotals[item.category] ?? 0) + item.amount;
    }
  }

  return {
    totalAverage: roundCurrency(sumNumbers(totals) / 3),
    byCategory: Object.entries(categoryTotals)
      .map(([category, total]) => ({
        category,
        average: roundCurrency(total / 3),
      }))
      .sort((a, b) => b.average - a.average),
  };
}

function buildMonthOverMonthChange(current, previous) {
  const categories = new Set([
    ...current.byCategory.map((item) => item.category),
    ...previous.byCategory.map((item) => item.category),
  ]);

  return {
    totalChange: roundCurrency(current.total - previous.total),
    totalChangePercent: calculateChangePercent(current.total, previous.total),
    categoryChanges: [...categories]
      .map((category) => {
        const currentAmount =
          current.byCategory.find((item) => item.category === category)
            ?.amount ?? 0;
        const previousAmount =
          previous.byCategory.find((item) => item.category === category)
            ?.amount ?? 0;

        return {
          category,
          currentAmount: roundCurrency(currentAmount),
          previousAmount: roundCurrency(previousAmount),
          changePercent: calculateChangePercent(currentAmount, previousAmount),
        };
      })
      .sort(
        (a, b) =>
          Math.abs(b.currentAmount - b.previousAmount) -
          Math.abs(a.currentAmount - a.previousAmount)
      ),
  };
}

function buildAnomalies(currentCategories, averageCategories) {
  return currentCategories
    .map((current) => {
      const threeMonthAverage =
        averageCategories.find((item) => item.category === current.category)
          ?.average ?? 0;
      if (threeMonthAverage <= 0) return null;

      const multiplier = current.amount / threeMonthAverage;
      if (multiplier <= 1.5) return null;

      return {
        category: current.category,
        currentAmount: roundCurrency(current.amount),
        threeMonthAverage: roundCurrency(threeMonthAverage),
        multiplier: roundCurrency(multiplier),
        severity: multiplier > 2 ? "alert" : "warning",
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.multiplier - a.multiplier);
}

function calculateChangePercent(current, previous) {
  if (previous === 0) {
    if (current === 0) return 0;
    return 100;
  }

  return roundCurrency(((current - previous) / previous) * 100);
}

function sumAmounts(expenses) {
  return roundCurrency(expenses.reduce((sum, expense) => sum + expense.amount, 0));
}

function sumNumbers(numbers) {
  return numbers.reduce((sum, number) => sum + number, 0);
}

function roundCurrency(value) {
  if (!Number.isFinite(Number(value))) return 0;
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

