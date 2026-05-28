"use client";

import Link from "next/link";
import { ArrowRightLeft, CheckCircle2 } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { useConvexQuery } from "@/hooks/use-convex-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";

export function SmartSettlementSuggestions({ groupId, suggestions }) {
  const { data: currentUser } = useConvexQuery(api.users.getCurrentUser);

  if (!suggestions?.length) {
    return (
      <div className="flex items-center gap-2 rounded-lg border bg-muted/20 p-4 text-sm text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        This group is already optimized and settled.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border bg-muted/20 p-4">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2 text-primary">
            <ArrowRightLeft className="h-4 w-4" />
          </div>
          <div>
            <h3 className="font-semibold">Smart settlement plan</h3>
            <p className="text-sm text-muted-foreground">
              Settle the group with {suggestions.length} payment
              {suggestions.length === 1 ? "" : "s"} instead of paying everyone
              separately.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        {suggestions.map((suggestion) => {
          const action = getSuggestionAction(suggestion, currentUser?._id, groupId);

          return (
            <div
              key={`${suggestion.from}-${suggestion.to}-${suggestion.amount}`}
              className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="flex min-w-0 items-center gap-3">
                <PersonAvatar
                  name={suggestion.fromName}
                  imageUrl={suggestion.fromImageUrl}
                />
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {formatName(suggestion.fromName, suggestion.from, currentUser?._id)} pays {formatName(suggestion.toName, suggestion.to, currentUser?._id)}
                  </p>
                  <p className="text-muted-foreground">
                    ₹{suggestion.amount.toFixed(2)}
                  </p>
                </div>
              </div>

              {action ? (
                <Button asChild size="sm" variant="outline">
                  <Link href={action.href}>{action.label}</Link>
                </Button>
              ) : (
                <span className="text-xs text-muted-foreground">
                  Ask either person to record this payment.
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PersonAvatar({ name, imageUrl }) {
  return (
    <Avatar className="h-9 w-9">
      <AvatarImage src={imageUrl} />
      <AvatarFallback>{name?.charAt(0) ?? "?"}</AvatarFallback>
    </Avatar>
  );
}

function getSuggestionAction(suggestion, currentUserId, groupId) {
  if (!currentUserId) return null;

  if (suggestion.from === currentUserId) {
    return {
      label: "Record payment",
      href: buildSettlementHref({
        groupId,
        memberId: suggestion.to,
        amount: suggestion.amount,
        paymentType: "youPaid",
      }),
    };
  }

  if (suggestion.to === currentUserId) {
    return {
      label: "Record received",
      href: buildSettlementHref({
        groupId,
        memberId: suggestion.from,
        amount: suggestion.amount,
        paymentType: "theyPaid",
      }),
    };
  }

  return null;
}

function buildSettlementHref({ groupId, memberId, amount, paymentType }) {
  const params = new URLSearchParams({
    memberId,
    amount: amount.toFixed(2),
    paymentType,
  });

  return `/settlements/group/${groupId}?${params.toString()}`;
}

function formatName(name, userId, currentUserId) {
  return userId === currentUserId ? "You" : name;
}
