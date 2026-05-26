"use client";

import { useCallback, useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";

export function SplitSelector({
  type,
  amount,
  participants,
  paidByUserId,
  onSplitsChange,
}) {
  const { user } = useUser();
  const [splits, setSplits] = useState([]);
  const [totalPercentage, setTotalPercentage] = useState(0);
  const [totalAmount, setTotalAmount] = useState(0);

  const applySplits = useCallback((nextSplits) => {
    setSplits(nextSplits);

    const nextTotalAmount = nextSplits.reduce(
      (sum, split) => sum + split.amount,
      0
    );
    const nextTotalPercentage = nextSplits.reduce(
      (sum, split) => sum + split.percentage,
      0
    );

    setTotalAmount(nextTotalAmount);
    setTotalPercentage(nextTotalPercentage);

    if (onSplitsChange) {
      onSplitsChange(nextSplits);
    }
  }, [onSplitsChange]);

  // Calculate splits when inputs change
  useEffect(() => {
    if (!amount || amount <= 0 || participants.length === 0) {
      return;
    }

    let newSplits = [];

    if (type === "equal") {
      // Equal splits
      const shareAmounts = distributeAmount(amount, participants.length);
      newSplits = participants.map((participant, index) => ({
        userId: participant.id,
        name: participant.name,
        email: participant.email,
        imageUrl: participant.imageUrl,
        amount: shareAmounts[index],
        percentage: amount > 0 ? (shareAmounts[index] / amount) * 100 : 0,
        paid: participant.id === paidByUserId,
      }));
    } else if (type === "percentage") {
      // Initialize percentage splits evenly
      const percentages = distributePercentage(100, participants.length);
      newSplits = participants.map((participant, index) => ({
        userId: participant.id,
        name: participant.name,
        email: participant.email,
        imageUrl: participant.imageUrl,
        amount: 0,
        percentage: percentages[index],
        paid: participant.id === paidByUserId,
      }));
      newSplits = withAmountsFromPercentages(newSplits, amount);
    } else if (type === "exact") {
      // Initialize exact splits evenly
      const amounts = distributeAmount(amount, participants.length);
      newSplits = participants.map((participant, index) => ({
        userId: participant.id,
        name: participant.name,
        email: participant.email,
        imageUrl: participant.imageUrl,
        amount: amounts[index],
        percentage: amount > 0 ? (amounts[index] / amount) * 100 : 0,
        paid: participant.id === paidByUserId,
      }));
    }

    applySplits(newSplits);
  }, [type, amount, participants, paidByUserId, applySplits]);

  const updatePercentageSplit = (userId, newPercentage) => {
    if (!splits.length || amount <= 0) return;

    const selectedPercentage = clamp(roundTo(Number(newPercentage) || 0, 1), 0, 100);
    const otherSplits = splits.filter((split) => split.userId !== userId);
    const remainingPercentages = distributePercentage(
      100 - selectedPercentage,
      otherSplits.length
    );
    let otherIndex = 0;

    const updatedSplits = splits.map((split) => {
      if (split.userId === userId) {
        return {
          ...split,
          percentage: selectedPercentage,
        };
      }

      const percentage = remainingPercentages[otherIndex++] ?? 0;
      return {
        ...split,
        percentage,
      };
    });

    applySplits(withAmountsFromPercentages(updatedSplits, amount));
  };

  const updateExactSplit = (userId, newAmount) => {
    if (!splits.length || amount <= 0) return;

    const selectedAmount = clamp(
      roundCurrency(parseFloat(newAmount) || 0),
      0,
      amount
    );
    const otherSplits = splits.filter((split) => split.userId !== userId);
    const remainingAmounts = distributeAmount(
      amount - selectedAmount,
      otherSplits.length
    );
    let otherIndex = 0;

    const updatedSplits = splits.map((split) => {
      if (split.userId === userId) {
        return {
          ...split,
          amount: selectedAmount,
          percentage: amount > 0 ? (selectedAmount / amount) * 100 : 0,
        };
      }

      const nextAmount = remainingAmounts[otherIndex++] ?? 0;
      return {
        ...split,
        amount: nextAmount,
        percentage: amount > 0 ? (nextAmount / amount) * 100 : 0,
      };
    });

    applySplits(updatedSplits);
  };

  // Check if totals are valid
  const isPercentageValid = Math.abs(totalPercentage - 100) < 0.01;
  const isAmountValid = Math.abs(totalAmount - amount) < 0.01;

  return (
    <div className="space-y-4 mt-4">
      {splits.map((split) => (
        <div
          key={split.userId}
          className="flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-2 min-w-[120px]">
            <Avatar className="h-7 w-7">
              <AvatarImage src={split.imageUrl} />
              <AvatarFallback>{split.name?.charAt(0) || "?"}</AvatarFallback>
            </Avatar>
            <span className="text-sm">
              {split.userId === user?.id ? "You" : split.name}
            </span>
          </div>

          {type === "equal" && (
            <div className="text-right text-sm">
              ₹{split.amount.toFixed(2)} ({split.percentage.toFixed(1)}%)
            </div>
          )}

          {type === "percentage" && (
            <div className="flex items-center gap-4 flex-1">
              <Slider
                value={[split.percentage]}
                min={0}
                max={100}
                step={1}
                onValueChange={(values) =>
                  updatePercentageSplit(split.userId, values[0])
                }
                className="flex-1"
              />
              <div className="flex gap-1 items-center min-w-[100px]">
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={split.percentage.toFixed(1)}
                  onChange={(e) =>
                    updatePercentageSplit(
                      split.userId,
                      parseFloat(e.target.value) || 0
                    )
                  }
                  className="w-16 h-8"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <span className="text-sm ml-1">₹{split.amount.toFixed(2)}</span>
              </div>
            </div>
          )}

          {type === "exact" && (
            <div className="flex items-center gap-2 flex-1">
              <div className="flex-1"></div>
              <div className="flex gap-1 items-center">
                <span className="text-sm text-muted-foreground">₹</span>
                <Input
                  type="number"
                  min="0"
                  max={amount}
                  step="0.01"
                  value={split.amount.toFixed(2)}
                  onChange={(e) =>
                    updateExactSplit(split.userId, e.target.value)
                  }
                  className="w-24 h-8"
                />
                <span className="text-sm text-muted-foreground ml-1">
                  ({split.percentage.toFixed(1)}%)
                </span>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Total row */}
      <div className="flex justify-between border-t pt-3 mt-3">
        <span className="font-medium">Total</span>
        <div className="text-right">
          <span
            className={`font-medium ${!isAmountValid ? "text-amber-600" : ""}`}
          >
            ₹{totalAmount.toFixed(2)}
          </span>
          {type !== "equal" && (
            <span
              className={`text-sm ml-2 ${!isPercentageValid ? "text-amber-600" : ""}`}
            >
              ({totalPercentage.toFixed(1)}%)
            </span>
          )}
        </div>
      </div>

      {/* Validation warnings */}
      {type === "percentage" && !isPercentageValid && (
        <div className="text-sm text-amber-600 mt-2">
          The percentages should add up to 100%.
        </div>
      )}

      {type === "exact" && !isAmountValid && (
        <div className="text-sm text-amber-600 mt-2">
          The sum of all splits (₹{totalAmount.toFixed(2)}) should equal the
          total amount (₹{amount.toFixed(2)}).
        </div>
      )}
    </div>
  );
}

function distributeAmount(totalAmount, count) {
  if (count <= 0) return [];

  const totalCents = Math.round((Number(totalAmount) || 0) * 100);
  const baseCents = Math.floor(totalCents / count);
  const remainderCents = totalCents - baseCents * count;

  return Array.from({ length: count }, (_, index) =>
    (baseCents + (index < remainderCents ? 1 : 0)) / 100
  );
}

function distributePercentage(totalPercentage, count) {
  if (count <= 0) return [];

  const totalTenths = Math.round((Number(totalPercentage) || 0) * 10);
  const baseTenths = Math.floor(totalTenths / count);
  const remainderTenths = totalTenths - baseTenths * count;

  return Array.from({ length: count }, (_, index) =>
    (baseTenths + (index < remainderTenths ? 1 : 0)) / 10
  );
}

function withAmountsFromPercentages(splits, totalAmount) {
  const nextSplits = splits.map((split) => ({
    ...split,
    amount: roundCurrency((totalAmount * split.percentage) / 100),
  }));
  const currentTotal = nextSplits.reduce((sum, split) => sum + split.amount, 0);
  const difference = roundCurrency(totalAmount - currentTotal);

  if (nextSplits.length > 0 && Math.abs(difference) > 0) {
    const lastIndex = nextSplits.length - 1;
    nextSplits[lastIndex] = {
      ...nextSplits[lastIndex],
      amount: roundCurrency(nextSplits[lastIndex].amount + difference),
    };
  }

  return nextSplits;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCurrency(value) {
  return roundTo(value, 2);
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}
