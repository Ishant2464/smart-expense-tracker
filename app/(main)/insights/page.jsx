"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { format } from "date-fns";
import {
  AlertTriangle,
  BarChart3,
  CalendarClock,
  RefreshCw,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { BarLoader } from "react-spinners";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useConvexQuery } from "@/hooks/use-convex-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCategoryById, getCategoryIcon } from "@/lib/expense-categories";

export default function InsightsPage() {
  const { data: insightsData, isLoading } = useConvexQuery(
    api.insights.getUserInsightsData
  );
  const generateInsightsSummary = useAction(api.insights.generateInsightsSummary);
  const [summary, setSummary] = useState("");
  const [generatedAt, setGeneratedAt] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const hasGeneratedInitialSummary = useRef(false);

  const generateSummary = useCallback(async () => {
    if (!insightsData) return;

    setIsGenerating(true);
    try {
      const result = await generateInsightsSummary({ insightsData });
      setSummary(result.summary);
      setGeneratedAt(result.generatedAt);
      toast.success("Insights refreshed");
    } catch (error) {
      toast.error("Failed to generate insights: " + error.message);
    } finally {
      setIsGenerating(false);
    }
  }, [generateInsightsSummary, insightsData]);

  useEffect(() => {
    if (!insightsData || hasGeneratedInitialSummary.current) return;
    hasGeneratedInitialSummary.current = true;
    generateSummary();
  }, [generateSummary, insightsData]);

  const significantChanges = useMemo(() => {
    return (
      insightsData?.monthOverMonthChange.categoryChanges
        ?.filter(
          (item) =>
            item.currentAmount > 0 ||
            item.previousAmount > 0 ||
            Math.abs(item.changePercent) >= 20
        )
        .slice(0, 8) ?? []
    );
  }, [insightsData]);

  if (isLoading) {
    return (
      <div className="mx-auto max-w-6xl py-6">
        <BarLoader width="100%" color="#36d7b7" />
      </div>
    );
  }

  if (!insightsData) {
    return (
      <div className="mx-auto max-w-6xl py-6">
        <h1 className="text-5xl gradient-title">Spending Insights</h1>
        <p className="mt-3 text-muted-foreground">
          No spending data is available yet.
        </p>
      </div>
    );
  }

  const current = insightsData.currentMonthSpending;
  const monthChange = insightsData.monthOverMonthChange.totalChangePercent;

  return (
    <div className="mx-auto max-w-6xl space-y-6 py-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-5xl gradient-title">Spending Insights</h1>
          <p className="mt-1 text-muted-foreground">
            AI-powered analysis of your spending patterns
          </p>
        </div>
        <Button onClick={generateSummary} disabled={isGenerating}>
          <RefreshCw className={isGenerating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          {isGenerating ? "Refreshing..." : "Refresh Insights"}
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title="This month"
          value={formatCurrency(current.total)}
          subtitle={`${formatPercent(monthChange)} vs last month`}
          tone={monthChange > 0 ? "red" : "green"}
          Icon={Wallet}
        />
        <StatCard
          title="Transactions"
          value={String(current.transactionCount)}
          subtitle={`Avg ${formatCurrency(current.averageTransaction)}`}
          Icon={BarChart3}
        />
        <StatCard
          title="Projected month-end"
          value={formatCurrency(insightsData.projectedMonthEnd.projected)}
          subtitle={`${insightsData.projectedMonthEnd.daysRemaining} days remaining`}
          Icon={CalendarClock}
        />
        <StatCard
          title="Year to date"
          value={formatCurrency(insightsData.yearToDate.total)}
          subtitle={`Monthly avg ${formatCurrency(insightsData.yearToDate.monthlyAverage)}`}
          Icon={TrendingUp}
        />
      </div>

      {insightsData.anomalies.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xl font-semibold">Anomaly Alerts</h2>
          <div className="grid gap-4 md:grid-cols-2">
            {insightsData.anomalies.map((anomaly) => (
              <AnomalyCard key={anomaly.category} anomaly={anomaly} />
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Category Breakdown</CardTitle>
            <CardDescription>
              Spending by category for {insightsData.period.month}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {current.byCategory.length ? (
              current.byCategory.map((item) => (
                <CategoryRow key={item.category} item={item} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No expenses this month yet.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Month Over Month</CardTitle>
            <CardDescription>
              Categories that changed compared with last month
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {significantChanges.length ? (
              significantChanges.map((item) => (
                <ComparisonRow key={item.category} item={item} />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No significant category changes yet.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <CardTitle>AI Insights</CardTitle>
              <CardDescription>
                Interpreted from the pre-computed analytics above
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={generateSummary}
              disabled={isGenerating}
            >
              <RefreshCw className={isGenerating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
              Regenerate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isGenerating && !summary ? (
            <BarLoader width="100%" color="#36d7b7" />
          ) : summary ? (
            <div className="space-y-3">
              <div className="prose prose-sm max-w-none text-sm leading-relaxed">
                {renderInsightText(summary)}
              </div>
              {generatedAt && (
                <p className="text-xs text-muted-foreground">
                  Generated at {format(new Date(generatedAt), "PPp")}
                </p>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click refresh to generate AI insights.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Top Expenses</CardTitle>
          <CardDescription>Largest expenses this month</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {insightsData.topExpenses.length ? (
            insightsData.topExpenses.map((expense) => (
              <TopExpenseRow
                key={`${expense.description}-${expense.date}-${expense.amount}`}
                expense={expense}
              />
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              No expenses this month yet.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ title, value, subtitle, tone, Icon }) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 pt-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">{title}</p>
          <p className="truncate text-2xl font-bold">{value}</p>
          <p
            className={
              tone === "red"
                ? "text-sm text-red-600"
                : tone === "green"
                  ? "text-sm text-green-600"
                  : "text-sm text-muted-foreground"
            }
          >
            {subtitle}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

function AnomalyCard({ anomaly }) {
  const isAlert = anomaly.severity === "alert";
  const category = getCategoryById(anomaly.category);

  return (
    <Card className={isAlert ? "border-red-300 bg-red-50" : "border-amber-300 bg-amber-50"}>
      <CardContent className="space-y-2 pt-0">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={isAlert ? "h-4 w-4 text-red-700" : "h-4 w-4 text-amber-700"}
            />
            <p className="font-semibold">{category.name}</p>
          </div>
          <Badge variant="outline">{anomaly.multiplier.toFixed(1)}x</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Current: {formatCurrency(anomaly.currentAmount)}. Three-month average:{" "}
          {formatCurrency(anomaly.threeMonthAverage)}.
        </p>
      </CardContent>
    </Card>
  );
}

function CategoryRow({ item }) {
  const category = getCategoryById(item.category);
  const CategoryIcon = getCategoryIcon(category.id);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <CategoryIcon className="h-4 w-4" />
          </div>
          <p className="truncate text-sm font-medium">{category.name}</p>
        </div>
        <div className="text-right">
          <p className="text-sm font-semibold">{formatCurrency(item.amount)}</p>
          <p className="text-xs text-muted-foreground">
            {item.percentage.toFixed(1)}%
          </p>
        </div>
      </div>
      <div className="h-2 rounded-full bg-muted">
        <div
          className="h-2 rounded-full bg-primary"
          style={{ width: `${Math.min(item.percentage, 100)}%` }}
        />
      </div>
    </div>
  );
}

function ComparisonRow({ item }) {
  const category = getCategoryById(item.category);
  const isIncrease = item.changePercent > 0;
  const Icon = isIncrease ? TrendingUp : TrendingDown;

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border p-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{category.name}</p>
        <p className="text-xs text-muted-foreground">
          Last: {formatCurrency(item.previousAmount)} to Current:{" "}
          {formatCurrency(item.currentAmount)}
        </p>
      </div>
      <Badge
        variant="outline"
        className={isIncrease ? "text-red-600" : "text-green-600"}
      >
        <Icon className="h-3 w-3" />
        {formatPercent(item.changePercent)}
      </Badge>
    </div>
  );
}

function TopExpenseRow({ expense }) {
  const category = getCategoryById(expense.category);
  const CategoryIcon = getCategoryIcon(category.id);

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <CategoryIcon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{expense.description}</p>
          <p className="text-xs text-muted-foreground">
            {category.name} - {format(new Date(expense.date), "MMM d")}
          </p>
        </div>
      </div>
      <p className="shrink-0 text-sm font-semibold">
        {formatCurrency(expense.amount)}
      </p>
    </div>
  );
}

function renderInsightText(text) {
  return String(text)
    .split("\n")
    .map((line, index) => (
      <p key={`${line}-${index}`} className="mb-2">
        {renderBoldSegments(line)}
      </p>
    ));
}

function renderBoldSegments(line) {
  return line.split(/(\*\*[^*]+\*\*)/g).map((segment, index) => {
    if (segment.startsWith("**") && segment.endsWith("**")) {
      return (
        <strong key={`${segment}-${index}`} className="font-semibold">
          {segment.slice(2, -2)}
        </strong>
      );
    }

    return <span key={`${segment}-${index}`}>{segment}</span>;
  });
}

function formatCurrency(amount) {
  return `₹${Number(amount ?? 0).toFixed(2)}`;
}

function formatPercent(value) {
  const number = Number(value ?? 0);
  return `${number >= 0 ? "+" : ""}${number.toFixed(1)}%`;
}
