"use client";

import { useRouter } from "next/navigation";
import { AiExpenseAssistant } from "./components/ai-expense-assistant";
import { ExpenseForm } from "./components/expense-form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";

export default function NewExpensePage() {
  const router = useRouter();

  return (
    <div className="container max-w-3xl mx-auto py-6">
      <div className="mb-6">
        <h1 className="text-5xl gradient-title">Add a new expense</h1>
        <p className="text-muted-foreground mt-1">
          Record a new expense to split with others
        </p>
      </div>

      <Card>
        <CardContent>
          <Tabs className="pb-3" defaultValue="individual">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="individual">Individual Expense</TabsTrigger>
              <TabsTrigger value="group">Group Expense</TabsTrigger>
            </TabsList>
            <TabsContent value="individual" className="mt-0">
              <div className="space-y-8 pt-6">
                <AiExpenseAssistant
                  type="individual"
                  onSuccess={(id) => router.push(`/person/${id}`)}
                />
                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or add manually</span>
                  </div>
                </div>
                <ExpenseForm
                  type="individual"
                  onSuccess={(id) => router.push(`/person/${id}`)}
                />
              </div>
            </TabsContent>
            <TabsContent value="group" className="mt-0">
              <div className="space-y-8 pt-6">
                <AiExpenseAssistant
                  type="group"
                  onSuccess={(id) => router.push(`/groups/${id}`)}
                />
                <div className="relative py-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-background px-2 text-muted-foreground">or add manually</span>
                  </div>
                </div>
                <ExpenseForm
                  type="group"
                  onSuccess={(id) => router.push(`/groups/${id}`)}
                />
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
