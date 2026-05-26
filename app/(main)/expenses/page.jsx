"use client";

import Link from "next/link";
import { PlusCircle } from "lucide-react";
import { BarLoader } from "react-spinners";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ExpenseList } from "@/components/expense-list";
import { useConvexQuery } from "@/hooks/use-convex-query";

export default function ExpensesPage() {
  const { data, isLoading } = useConvexQuery(api.expenses.getMyExpenses, {});

  if (isLoading) {
    return (
      <div className="container mx-auto py-12">
        <BarLoader width="100%" color="#36d7b7" />
      </div>
    );
  }

  const expenses = data?.expenses ?? [];
  const individualExpenses = expenses.filter((expense) => !expense.groupId);
  const groupExpenses = expenses.filter((expense) => expense.groupId);
  const userLookupMap = data?.userLookupMap ?? {};

  return (
    <div className="container mx-auto max-w-5xl py-6 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-5xl gradient-title">Expenses</h1>
          <p className="text-muted-foreground">
            View your individual shared expenses and group expenses in one place.
          </p>
        </div>
        <Button asChild>
          <Link href="/expenses/new">
            <PlusCircle className="mr-2 h-4 w-4" />
            Add expense
          </Link>
        </Button>
      </div>

      <Tabs defaultValue="all" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="all">All ({expenses.length})</TabsTrigger>
          <TabsTrigger value="individual">
            Individual ({individualExpenses.length})
          </TabsTrigger>
          <TabsTrigger value="groups">Groups ({groupExpenses.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="all">
          <ExpenseList expenses={expenses} userLookupMap={userLookupMap} />
        </TabsContent>
        <TabsContent value="individual">
          <ExpenseList
            expenses={individualExpenses}
            userLookupMap={userLookupMap}
          />
        </TabsContent>
        <TabsContent value="groups">
          <ExpenseList
            expenses={groupExpenses}
            isGroupExpense
            userLookupMap={userLookupMap}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}