"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useConvexMutation, useConvexQuery } from "@/hooks/use-convex-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getCategoryById, getCategoryIcon } from "@/lib/expense-categories";
import { format } from "date-fns";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  Sparkles,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { GroupSelector } from "./group-selector";

const EXAMPLES = [
  "Ram paid 300 for pizza for Ram, Laxman and Ravan",
  "I paid 1200 for groceries yesterday split with Neha",
  "Dinner last night 800 split equally",
];

export function AiExpenseAssistant({ type = "individual", onSuccess }) {
  const [input, setInput] = useState("");
  const [selectedGroup, setSelectedGroup] = useState(null);
  const [parseResult, setParseResult] = useState(null);
  const [receiptResult, setReceiptResult] = useState(null);
  const [receiptError, setReceiptError] = useState("");
  const [receiptPreviewUrl, setReceiptPreviewUrl] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isScanningReceipt, setIsScanningReceipt] = useState(false);

  const parseExpense = useAction(api.ai.parseNaturalLanguageExpense);
  const parseReceiptImage = useAction(api.ai.parseReceiptImage);
  const generateUploadUrl = useConvexMutation(api.storage.generateUploadUrl);
  const createExpense = useConvexMutation(api.expenses.createExpense);
  const { data: currentUser } = useConvexQuery(api.users.getCurrentUser);
  const fileInputRef = useRef(null);
  const receiptPreviewUrlRef = useRef("");

  const trimmedInput = input.trim();
  const requiresGroup = type === "group";

  const handleGroupChange = useCallback((group) => {
    setSelectedGroup((current) => (current?.id === group.id ? current : group));
    setParseResult(null);
  }, []);

  const clearReceiptState = useCallback(() => {
    setReceiptResult(null);
    setReceiptError("");
    setReceiptPreviewUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      receiptPreviewUrlRef.current = "";
      return "";
    });
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  useEffect(() => {
    return () => {
      if (receiptPreviewUrlRef.current) {
        URL.revokeObjectURL(receiptPreviewUrlRef.current);
      }
    };
  }, []);

  const handleReceiptButtonClick = () => {
    fileInputRef.current?.click();
  };

  const handleReceiptFileChange = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }

    const nextPreviewUrl = URL.createObjectURL(file);
    setReceiptPreviewUrl((currentUrl) => {
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      receiptPreviewUrlRef.current = nextPreviewUrl;
      return nextPreviewUrl;
    });
    setReceiptResult(null);
    setReceiptError("");
    setParseResult(null);
    setIsScanningReceipt(true);

    try {
      const uploadUrl = await generateUploadUrl.mutate();
      const uploadResponse = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        throw new Error("Receipt upload failed.");
      }

      const { storageId } = await uploadResponse.json();
      const result = await parseReceiptImage({ storageId });

      if (!result.success) {
        setReceiptError(result.error || "Could not scan that receipt.");
        toast.error(result.error || "Could not scan that receipt.");
        return;
      }

      setReceiptResult(result);
      setInput(result.naturalLanguageSummary);
      toast.success("Receipt extracted. Review the text, then parse it.");
    } catch (error) {
      setReceiptError(error.message);
      toast.error("Receipt scan failed: " + error.message);
    } finally {
      setIsScanningReceipt(false);
    }
  };

  const handleParse = async (event) => {
    event.preventDefault();

    if (!trimmedInput) return;

    if (requiresGroup && !selectedGroup?.id) {
      toast.error("Select a group first");
      return;
    }

    setIsParsing(true);

    try {
      const result = await parseExpense({
        naturalLanguageInput: trimmedInput,
        ...(requiresGroup ? { groupId: selectedGroup.id } : {}),
      });

      setParseResult(result);

      if (result.success) {
        toast.success("Expense parsed. Review it before creating.");
      } else {
        toast.error(result.error || "Could not parse that expense.");
      }
    } catch (error) {
      toast.error("Failed to parse expense: " + error.message);
      setParseResult({
        success: false,
        error: error.message,
        warnings: [],
        requiresConfirmation: true,
        sourceInput: trimmedInput,
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreate = async () => {
    if (!parseResult?.success || !parseResult.createExpenseArgs) return;

    if (type === "individual" && !currentUser?._id) {
      toast.error("Still loading your account. Try again in a moment.");
      return;
    }

    setIsCreating(true);

    try {
      await createExpense.mutate(parseResult.createExpenseArgs);
      toast.success("Expense created successfully!");

      const nextId =
        type === "group"
          ? parseResult.createExpenseArgs.groupId || parseResult.groupContext?.id
          : getOtherParticipantId(parseResult, currentUser?._id);

      setInput("");
      setParseResult(null);

      if (nextId && onSuccess) {
        onSuccess(nextId);
      }
    } catch (error) {
      toast.error("Failed to create expense: " + error.message);
    } finally {
      setIsCreating(false);
    }
  };

  const canCreate = parseResult?.success && parseResult.createExpenseArgs;

  return (
    <section className="space-y-5">
      <form onSubmit={handleParse} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`ai-expense-${type}`}>Quick add with AI</Label>
          <Textarea
            id={`ai-expense-${type}`}
            value={input}
            onChange={(event) => {
              const nextValue = event.target.value;
              setInput(nextValue);
              setParseResult(null);
              if (!nextValue.trim()) {
                clearReceiptState();
              }
            }}
            placeholder="Describe your expense in plain English..."
            className="min-h-28 resize-y"
          />
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          className="hidden"
          onChange={handleReceiptFileChange}
        />

        {(receiptPreviewUrl || receiptResult || receiptError) && (
          <ReceiptExtractionPanel
            previewUrl={receiptPreviewUrl}
            result={receiptResult}
            error={receiptError}
            isLoading={isScanningReceipt}
            onClear={clearReceiptState}
          />
        )}

        <div className="space-y-2 text-sm text-muted-foreground">
          {EXAMPLES.map((example) => (
            <p key={example}>- {example}</p>
          ))}
        </div>

        {requiresGroup && (
          <div className="space-y-2">
            <Label>Group</Label>
            <GroupSelector onChange={handleGroupChange} />
            {!selectedGroup && (
              <p className="text-xs text-amber-600">
                Select a group first.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            type="submit"
            disabled={!trimmedInput || isParsing || isScanningReceipt}
          >
            {isParsing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isParsing ? "Parsing..." : "Parse with AI"}
          </Button>

          <Button
            type="button"
            variant="outline"
            onClick={handleReceiptButtonClick}
            disabled={isParsing || isCreating || isScanningReceipt}
          >
            {isScanningReceipt ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {isScanningReceipt ? "Scanning..." : "Scan Receipt"}
          </Button>

          {parseResult && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setParseResult(null)}
              disabled={isParsing || isCreating}
            >
              Clear preview
            </Button>
          )}
        </div>
      </form>

      {parseResult && (
        <AiExpensePreview
          result={parseResult}
          onCreate={handleCreate}
          canCreate={Boolean(canCreate)}
          isCreating={isCreating}
        />
      )}
    </section>
  );
}

function ReceiptExtractionPanel({
  previewUrl,
  result,
  error,
  isLoading,
  onClear,
}) {
  const items = result?.extracted?.items ?? [];

  return (
    <div className="rounded-lg border bg-muted/20 p-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {previewUrl && (
          <img
            src={previewUrl}
            alt="Receipt preview"
            className="h-24 w-24 rounded-md border object-cover"
          />
        )}

        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            {isLoading ? (
              <Badge variant="outline">
                <Loader2 className="h-3 w-3 animate-spin" />
                Scanning receipt
              </Badge>
            ) : result?.success ? (
              <Badge variant="secondary">
                <CheckCircle2 className="h-3 w-3" />
                Receipt extracted
              </Badge>
            ) : error ? (
              <Badge variant="outline">
                <AlertTriangle className="h-3 w-3" />
                Scan failed
              </Badge>
            ) : null}

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClear}
              disabled={isLoading}
            >
              Clear receipt
            </Button>
          </div>

          {result?.extracted && (
            <div className="space-y-1 text-sm">
              <p className="font-medium">
                {result.extracted.description} - ₹
                {formatMoney(result.extracted.amount)}
              </p>
              <p className="text-muted-foreground">
                {getCategoryById(result.extracted.category).name}
                {result.extracted.rawDateText
                  ? ` - ${result.extracted.rawDateText}`
                  : ""}
              </p>
              {result.warnings?.length > 0 && (
                <p className="text-xs text-amber-700">
                  {result.warnings.join(" ")}
                </p>
              )}
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          {items.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                View extracted items ({items.length})
              </summary>
              <div className="mt-2 space-y-1">
                {items.map((item) => (
                  <div
                    key={`${item.name}-${item.amount}`}
                    className="flex justify-between gap-3"
                  >
                    <span className="truncate">{item.name}</span>
                    <span className="font-medium">
                      ₹{formatMoney(item.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function AiExpensePreview({ result, onCreate, canCreate, isCreating }) {
  const preview = result.parsedPreview;
  const createArgs = result.createExpenseArgs;
  const category = getCategoryById(preview?.category);
  const CategoryIcon = getCategoryIcon(category.id);
  const { data: currentUser } = useConvexQuery(api.users.getCurrentUser);
  const splitLookup = useMemo(() => {
    const map = new Map();
    createArgs?.splits?.forEach((split) => {
      map.set(split.userId, split);
    });
    return map;
  }, [createArgs?.splits]);

  return (
    <div className="rounded-lg border bg-muted/20 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {result.success ? (
              <CheckCircle2 className="h-4 w-4 text-green-600" />
            ) : (
              <XCircle className="h-4 w-4 text-red-600" />
            )}
            <h3 className="font-medium">
              {result.success ? "Parsed expense" : "Could not parse expense"}
            </h3>
          </div>
          {result.sourceInput && (
            <p className="text-sm text-muted-foreground">
              "{result.sourceInput}"
            </p>
          )}
        </div>

        {typeof result.confidence === "number" && (
          <Badge variant={result.requiresConfirmation ? "outline" : "secondary"}>
            {Math.round(result.confidence * 100)}% confidence
          </Badge>
        )}
      </div>

      {result.error && (
        <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
          {result.error}
        </p>
      )}

      {result.warnings?.length > 0 && (
        <div className="mt-3 space-y-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {result.warnings.map((warning) => (
            <div key={warning} className="flex gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <PreviewRow label="Description" value={preview.description} />
            <PreviewRow
              label="Amount"
              value={`₹${preview.amount.toFixed(2)}`}
            />
            <PreviewRow
              label="Date"
              value={format(new Date(preview.date), "MMM d, yyyy")}
            />
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Category</span>
              <span className="flex items-center gap-2 font-medium">
                <CategoryIcon className="h-4 w-4 text-primary" />
                {category.name}
              </span>
            </div>
            <PreviewRow
              label="Split"
              value={formatSplitType(preview.splitType)}
            />
            {result.groupContext && (
              <PreviewRow label="Group" value={result.groupContext.name} />
            )}
          </div>

          <div className="space-y-4">
            {result.resolvedPayer && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Paid by</p>
                <PersonLine
                  person={result.resolvedPayer}
                  currentUserId={currentUser?._id}
                />
              </div>
            )}

            {result.resolvedParticipants?.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Participants</p>
                <div className="flex flex-col gap-2">
                  {result.resolvedParticipants.map((person) => {
                    const split = splitLookup.get(person.userId);
                    return (
                      <div
                        key={person.userId}
                        className="flex items-center justify-between gap-3"
                      >
                        <PersonLine
                          person={person}
                          compact
                          currentUserId={currentUser?._id}
                        />
                        {split && (
                          <Badge
                            variant={split.paid ? "outline" : "secondary"}
                          >
                            ₹{split.amount.toFixed(2)}
                          </Badge>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {canCreate && (
        <div className="mt-5 flex justify-end">
          <Button onClick={onCreate} disabled={isCreating}>
            {isCreating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            {isCreating ? "Creating..." : "Confirm and create"}
          </Button>
        </div>
      )}
    </div>
  );
}

function PreviewRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function PersonLine({ person, compact = false, currentUserId }) {
  const isCurrentUser = person.userId === currentUserId;
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Avatar className={compact ? "h-7 w-7" : "h-8 w-8"}>
        <AvatarImage src={person.imageUrl} />
        <AvatarFallback>{person.name?.charAt(0) || "?"}</AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {isCurrentUser ? "You" : person.name}
        </p>
        {!compact && person.email && (
          <p className="truncate text-xs text-muted-foreground">
            {person.email}
          </p>
        )}
      </div>
    </div>
  );
}

function formatSplitType(splitType) {
  if (splitType === "percentage") return "Percentage";
  if (splitType === "exact") return "Exact amounts";
  return "Equal";
}

function formatMoney(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function getOtherParticipantId(result, currentUserId) {
  return (
    result.resolvedParticipants?.find(
      (participant) => participant.userId !== currentUserId
    )?.userId ??
    result.parsedPreview?.participantUserIds?.find(
      (userId) => userId !== currentUserId
    )
  );
}
