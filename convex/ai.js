"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { api, internal } from "./_generated/api";
import {
  generateGeminiVisionText,
  generateGroqText,
} from "./aiProviders.js";

const ALLOWED_CATEGORY_IDS = [
  "foodDrink",
  "coffee",
  "groceries",
  "shopping",
  "travel",
  "transportation",
  "housing",
  "entertainment",
  "tickets",
  "utilities",
  "water",
  "education",
  "health",
  "personal",
  "gifts",
  "technology",
  "bills",
  "baby",
  "music",
  "books",
  "other",
  "general",
];

const ALLOWED_SPLIT_TYPES = ["equal", "percentage", "exact"];
const HIGH_CONFIDENCE_THRESHOLD = 0.85;
const TOLERANCE = 0.01;

const CATEGORY_BY_LOWER_ID = Object.fromEntries(
  ALLOWED_CATEGORY_IDS.map((categoryId) => [categoryId.toLowerCase(), categoryId])
);

const CATEGORY_ALIASES = {
  "food & drink": "foodDrink",
  food: "foodDrink",
  drink: "foodDrink",
  drinks: "foodDrink",
  restaurant: "foodDrink",
  restaurants: "foodDrink",
  meal: "foodDrink",
  meals: "foodDrink",
  cab: "transportation",
  taxi: "transportation",
  fuel: "transportation",
  gas: "transportation",
  rent: "housing",
  home: "housing",
  movie: "entertainment",
  movies: "entertainment",
  ticket: "tickets",
  bill: "bills",
  fees: "bills",
  fee: "bills",
  medical: "health",
  healthcare: "health",
  kid: "baby",
  kids: "baby",
  misc: "other",
  miscellaneous: "other",
};

export const parseNaturalLanguageExpense = action({
  args: {
    naturalLanguageInput: v.string(),
    groupId: v.optional(v.id("groups")),
    autoCreate: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const warnings = [];

    try {
      const input = args.naturalLanguageInput.trim();
      if (!input) {
        return failure("Please enter an expense description.", warnings);
      }

      const currentUser = await ctx.runQuery(internal.users.getCurrentUser);
      const participantContext = await buildParticipantContext(ctx, {
        currentUser,
        groupId: args.groupId,
      });

      if (!participantContext.success) {
        return failure(participantContext.error, participantContext.warnings, {
          sourceInput: input,
        });
      }

      warnings.push(...participantContext.warnings);

      const prompt = buildExpensePrompt({
        input,
        currentUser,
        participants: participantContext.participants,
        group: participantContext.group,
      });

      const modelText = await generateGroqText(prompt);
      const parsed = parseJsonFromModel(modelText);

      if (!parsed.success) {
        return failure(parsed.error, warnings, {
          groupContext: buildGroupContext(participantContext.group),
          sourceInput: input,
        });
      }

      const normalized = normalizeExpensePayload({
        parsedExpense: parsed.value,
        currentUser,
        participants: participantContext.participants,
        groupId: args.groupId,
        warnings,
      });

      if (!normalized.success) {
        return failure(normalized.error, normalized.warnings, {
          groupContext: buildGroupContext(participantContext.group),
          sourceInput: input,
        });
      }

      const displayContext = buildDisplayContext({
        normalized,
        participantContext,
        sourceInput: input,
      });

      let createdExpenseId;
      const canAutoCreate =
        args.autoCreate === true &&
        normalized.confidence >= HIGH_CONFIDENCE_THRESHOLD &&
        !normalized.requiresConfirmation &&
        normalized.warnings.length === 0;

      if (canAutoCreate) {
        try {
          createdExpenseId = await ctx.runMutation(
            api.expenses.createExpense,
            normalized.createExpenseArgs
          );
        } catch (error) {
          return {
            success: false,
            error: `Could not create expense: ${getErrorMessage(error)}`,
            warnings: normalized.warnings,
            requiresConfirmation: true,
            parsedPreview: normalized.parsedPreview,
            createExpenseArgs: normalized.createExpenseArgs,
            ...displayContext,
          };
        }
      }

      return {
        success: true,
        confidence: normalized.confidence,
        requiresConfirmation: normalized.requiresConfirmation,
        warnings: normalized.warnings,
        parsedPreview: normalized.parsedPreview,
        createExpenseArgs: normalized.createExpenseArgs,
        ...displayContext,
        ...(createdExpenseId ? { createdExpenseId } : {}),
      };
    } catch (error) {
      return failure(
        `Could not parse expense: ${getErrorMessage(error)}`,
        warnings
      );
    }
  },
});

export const parseReceiptImage = action({
  args: {
    storageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    const warnings = [];

    try {
      await ctx.runQuery(internal.users.getCurrentUser);

      const imageUrl = await ctx.storage.getUrl(args.storageId);
      if (!imageUrl) {
        return failure("Receipt image not found.", warnings);
      }

      const imageResponse = await fetch(imageUrl);
      if (!imageResponse.ok) {
        return failure("Could not download the receipt image.", warnings);
      }

      const mimeType = normalizeImageMimeType(
        imageResponse.headers.get("content-type")
      );
      const imageBuffer = await imageResponse.arrayBuffer();
      const imageBase64 = Buffer.from(imageBuffer).toString("base64");
      const modelText = await generateGeminiVisionText({
        prompt: buildReceiptPrompt(),
        imageBase64,
        mimeType,
      });
      const parsed = parseJsonFromModel(modelText);

      if (!parsed.success) {
        return failure(parsed.error, warnings);
      }

      return normalizeReceiptExtraction(parsed.value, warnings);
    } catch (error) {
      return failure(
        `Could not scan receipt: ${getErrorMessage(error)}`,
        warnings
      );
    }
  },
});

async function buildParticipantContext(ctx, { currentUser, groupId }) {
  const warnings = [];
  const participantMap = new Map();
  addParticipant(participantMap, currentUser);

  if (groupId) {
    try {
      const data = await ctx.runQuery(api.groups.getGroupOrMembers, {
        groupId,
      });
      const selectedGroup = data.selectedGroup;

      if (!selectedGroup) {
        return {
          success: false,
          error: "Group not found or you are not a member.",
          warnings,
        };
      }

      selectedGroup.members.forEach((member) =>
        addParticipant(participantMap, member)
      );

      return {
        success: true,
        participants: [...participantMap.values()],
        group: selectedGroup,
        warnings,
      };
    } catch (error) {
      return {
        success: false,
        error: getErrorMessage(error),
        warnings,
      };
    }
  }

  try {
    const contacts = await ctx.runQuery(api.contacts.getAllContacts);
    contacts.users.forEach((user) => addParticipant(participantMap, user));
  } catch (error) {
    warnings.push(
      `Could not load all individual contacts: ${getErrorMessage(error)}`
    );
  }

  return {
    success: true,
    participants: [...participantMap.values()],
    group: null,
    warnings,
  };
}

function addParticipant(participantMap, user) {
  const id = user.id ?? user._id;

  if (!id || participantMap.has(id)) {
    return;
  }

  participantMap.set(id, {
    userId: id,
    name: user.name ?? "Unknown",
    email: user.email ?? "",
    imageUrl: user.imageUrl,
  });
}

function buildDisplayContext({ normalized, participantContext, sourceInput }) {
  const participantLookup = new Map(
    participantContext.participants.map((participant) => [
      participant.userId,
      participant,
    ])
  );
  const participantUserIds =
    normalized.parsedPreview?.participantUserIds ??
    normalized.createExpenseArgs?.splits?.map((split) => split.userId) ??
    [];
  const paidByUserId =
    normalized.parsedPreview?.paidByUserId ??
    normalized.createExpenseArgs?.paidByUserId;

  return {
    resolvedPayer: resolveParticipantForDisplay(
      participantLookup,
      paidByUserId
    ),
    resolvedParticipants: participantUserIds.map((userId) =>
      resolveParticipantForDisplay(participantLookup, userId)
    ),
    groupContext: buildGroupContext(participantContext.group),
    sourceInput,
  };
}

function resolveParticipantForDisplay(participantLookup, userId) {
  const participant = participantLookup.get(userId);

  return {
    userId,
    name: participant?.name ?? "Unknown",
    email: participant?.email ?? "",
    imageUrl: participant?.imageUrl,
  };
}

function buildGroupContext(group) {
  if (!group) {
    return null;
  }

  return {
    id: group.id,
    name: group.name,
  };
}

function buildExpensePrompt({ input, currentUser, participants, group }) {
  const participantLines = participants
    .map(
      (participant) =>
        `- name: ${participant.name}; userId: ${participant.userId}; email: ${
          participant.email || "unknown"
        }`
    )
    .join("\n");

  return `
You parse natural-language shared expenses into strict JSON for Splitr, a finance app.

Current user:
- name: ${currentUser.name}
- userId: ${currentUser._id}
- email: ${currentUser.email}

${group ? `Selected group: ${group.name} (${group.id})` : "No group selected."}

Available participants. You may only use these userId values:
${participantLines}

Allowed category IDs:
${ALLOWED_CATEGORY_IDS.join(", ")}

Allowed split types:
${ALLOWED_SPLIT_TYPES.join(", ")}

Rules:
- Return strict JSON only. No markdown, comments, prose, or trailing commas.
- Use participant and payer userId values exactly from the available participants list.
- If the payer is ambiguous, use the current user.
- If participants are ambiguous, include the current user and every participant you can match exactly.
- If the input says "everyone", "all", or similar and a group is selected, use all group members.
- If a person is mentioned but cannot be matched exactly to the participant list, omit them and add a warning.
- categoryId must be one of the allowed category IDs.
- splitType must be "equal", "percentage", or "exact". Default to "equal" if unclear.
- For percentage splits, percentages must total 100.
- For exact splits, exact amounts must total the expense amount.
- Use relativeDate only for phrases from the input, such as "today", "yesterday", or "last night"; otherwise use null.
- confidence must be a number from 0 to 1.

Return this JSON shape:
{
  "description": "short expense description",
  "amount": 0,
  "categoryId": "other",
  "paidByUserId": "${currentUser._id}",
  "participantUserIds": ["${currentUser._id}"],
  "splitType": "equal",
  "exactAmounts": [{ "userId": "${currentUser._id}", "amount": 0 }],
  "percentages": [{ "userId": "${currentUser._id}", "percentage": 100 }],
  "relativeDate": null,
  "confidence": 0,
  "warnings": []
}

Natural-language input:
${input}
  `.trim();
}

function buildReceiptPrompt() {
  return `
Extract expense details from this receipt or payment screenshot for Splitr, a finance app.

Allowed category IDs:
${ALLOWED_CATEGORY_IDS.join(", ")}

Rules:
- Return strict JSON only. No markdown, comments, prose, or trailing commas.
- If this is a UPI/payment screenshot, use the paid amount and recipient or merchant as the description.
- If this is a receipt, use the merchant/vendor name or a short purchase description.
- amount must be the final total paid, not subtotal, tax, discount, balance, or item count.
- categoryId must be one of the allowed category IDs.
- rawDateText should be the date text visible in the image, an ISO date if confidently inferred, or null.
- Include itemized items only if they are clearly readable.
- confidence must be a number from 0 to 1.
- Add warnings for unclear amount, unclear date, unreadable merchant, or uncertain category.

Return this JSON shape:
{
  "description": "merchant or short expense description",
  "amount": 0,
  "categoryId": "other",
  "rawDateText": null,
  "items": [{ "name": "item name", "amount": 0 }],
  "confidence": 0,
  "warnings": []
}
  `.trim();
}

function normalizeReceiptExtraction(receipt, warnings) {
  const localWarnings = [
    ...warnings,
    ...normalizeWarnings(receipt?.warnings),
  ];
  const description = normalizeReceiptDescription(receipt);
  const amount = normalizeAmount(receipt?.amount ?? receipt?.totalAmount);

  if (!description) {
    return failure("Could not identify a receipt description.", localWarnings);
  }

  if (amount === null) {
    return failure("Could not identify a valid receipt total.", localWarnings);
  }

  const category = normalizeCategory(
    receipt?.categoryId ?? receipt?.category,
    localWarnings
  );
  const rawDateText = normalizeReceiptRawDate(
    receipt?.rawDateText ?? receipt?.dateText ?? receipt?.date
  );
  const date = normalizeReceiptDate(rawDateText, localWarnings);
  const items = normalizeReceiptItems(receipt?.items, localWarnings);
  const confidence = normalizeConfidence(
    receipt?.confidence,
    localWarnings,
    false
  );
  const extracted = {
    description,
    amount,
    category,
    date,
    rawDateText,
    items,
  };

  return {
    success: true,
    extracted,
    confidence,
    warnings: uniqueStrings(localWarnings),
    naturalLanguageSummary: buildReceiptNaturalLanguageSummary(extracted),
  };
}

function normalizeReceiptDescription(receipt) {
  const description =
    receipt?.description ??
    receipt?.merchant ??
    receipt?.vendor ??
    receipt?.recipient ??
    receipt?.payee;

  if (typeof description !== "string") {
    return "";
  }

  return description.trim().slice(0, 120);
}

function normalizeReceiptRawDate(rawDateText) {
  if (rawDateText === null || rawDateText === undefined) {
    return null;
  }

  if (typeof rawDateText !== "string") {
    return String(rawDateText).trim() || null;
  }

  return rawDateText.trim() || null;
}

function normalizeReceiptDate(rawDateText, warnings) {
  if (!rawDateText) {
    return null;
  }

  const normalized = rawDateText.trim().toLowerCase();

  if (
    ["today", "tonight", "yesterday", "last night", "yesterday night"].includes(
      normalized
    )
  ) {
    return normalizeDate(normalized, warnings);
  }

  const parsedTimestamp = Date.parse(rawDateText);

  if (Number.isFinite(parsedTimestamp)) {
    return parsedTimestamp;
  }

  warnings.push(
    `The receipt date "${rawDateText}" could not be normalized to a timestamp.`
  );
  return null;
}

function normalizeReceiptItems(items, warnings) {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  const normalizedItems = items
    .map((item) => {
      const name = typeof item?.name === "string" ? item.name.trim() : "";
      const amount = normalizeAmount(item?.amount);

      if (!name || amount === null) {
        return null;
      }

      return {
        name: name.slice(0, 80),
        amount: roundCurrency(amount),
      };
    })
    .filter(Boolean)
    .slice(0, 12);

  if (normalizedItems.length === 0 && items.length > 0) {
    warnings.push("Itemized receipt rows were unreadable and were skipped.");
  }

  return normalizedItems.length > 0 ? normalizedItems : null;
}

function buildReceiptNaturalLanguageSummary(extracted) {
  const category = getReceiptCategoryLabel(extracted.category);
  const dateText = extracted.rawDateText ? ` on ${extracted.rawDateText}` : "";

  return `${extracted.description} ${category} for ₹${formatReceiptAmount(
    extracted.amount
  )}${dateText}`;
}

function getReceiptCategoryLabel(categoryId) {
  if (categoryId === "other" || categoryId === "general") {
    return "expense";
  }

  return categoryId.replace(/([A-Z])/g, " $1").toLowerCase();
}

function formatReceiptAmount(amount) {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

function normalizeImageMimeType(contentType) {
  const mimeType = contentType?.split(";")[0]?.trim().toLowerCase();

  if (!mimeType || !mimeType.startsWith("image/")) {
    return "image/jpeg";
  }

  return mimeType === "image/jpg" ? "image/jpeg" : mimeType;
}

function parseJsonFromModel(text) {
  const stripped = stripMarkdownFences(text);
  const jsonText = extractJsonObject(stripped);

  if (!jsonText) {
    return {
      success: false,
      error: "The AI response did not contain valid JSON.",
    };
  }

  try {
    return { success: true, value: JSON.parse(jsonText) };
  } catch (error) {
    return {
      success: false,
      error: `The AI response JSON could not be parsed: ${getErrorMessage(
        error
      )}`,
    };
  }
}

function stripMarkdownFences(text) {
  const trimmed = String(text ?? "").trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function extractJsonObject(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }

  return text.slice(firstBrace, lastBrace + 1);
}

function normalizeExpensePayload({
  parsedExpense,
  currentUser,
  participants,
  groupId,
  warnings,
}) {
  const localWarnings = [
    ...warnings,
    ...normalizeWarnings(parsedExpense.warnings),
  ];
  const participantMap = new Map(
    participants.map((participant) => [participant.userId, participant])
  );
  const allowedUserIds = new Set(participantMap.keys());

  const description = normalizeDescription(parsedExpense.description);
  const amount = normalizeAmount(parsedExpense.amount);

  if (!description) {
    return {
      success: false,
      error: "The expense description is missing.",
      warnings: localWarnings,
    };
  }

  if (amount === null) {
    return {
      success: false,
      error: "The expense amount is missing or invalid.",
      warnings: localWarnings,
    };
  }

  const paidByUserId = normalizePayer({
    paidByUserId: parsedExpense.paidByUserId,
    currentUserId: currentUser._id,
    allowedUserIds,
    warnings: localWarnings,
  });

  const participantUserIds = normalizeParticipantIds({
    participantUserIds: parsedExpense.participantUserIds,
    paidByUserId,
    currentUserId: currentUser._id,
    requireCurrentUser: !groupId,
    allowedUserIds,
    warnings: localWarnings,
  });

  if (participantUserIds.length === 0) {
    return {
      success: false,
      error: "No valid participants could be resolved.",
      warnings: localWarnings,
    };
  }

  if (participantUserIds.length === 1) {
    localWarnings.push(
      "Only one participant was resolved. Please confirm before creating this expense."
    );
  }

  const category = normalizeCategory(parsedExpense.categoryId, localWarnings);
  const requestedSplitType = normalizeSplitType(
    parsedExpense.splitType,
    localWarnings
  );
  const date = normalizeDate(parsedExpense.relativeDate, localWarnings);
  const splitResult = buildSplits({
    amount,
    splitType: requestedSplitType,
    participantUserIds,
    paidByUserId,
    exactAmounts: parsedExpense.exactAmounts,
    percentages: parsedExpense.percentages,
    allowedUserIds,
  });

  localWarnings.push(...splitResult.warnings);

  const confidence = normalizeConfidence(
    parsedExpense.confidence,
    localWarnings,
    splitResult.requiresConfirmation
  );
  const requiresConfirmation =
    localWarnings.length > 0 ||
    splitResult.requiresConfirmation ||
    confidence < HIGH_CONFIDENCE_THRESHOLD ||
    participantUserIds.length < 2;

  const createExpenseArgs = {
    description,
    amount,
    category,
    date,
    paidByUserId,
    splitType: splitResult.splitType,
    splits: splitResult.splits,
    ...(groupId ? { groupId } : {}),
  };

  return {
    success: true,
    confidence,
    requiresConfirmation,
    warnings: uniqueStrings(localWarnings),
    parsedPreview: {
      description,
      amount,
      category,
      splitType: splitResult.splitType,
      date,
      paidByUserId,
      participantUserIds,
    },
    createExpenseArgs,
  };
}

function normalizeDescription(description) {
  if (typeof description !== "string") {
    return "";
  }

  return description.trim().slice(0, 160);
}

function normalizeAmount(amount) {
  const number = Number(amount);

  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }

  return roundCurrency(number);
}

function normalizePayer({
  paidByUserId,
  currentUserId,
  allowedUserIds,
  warnings,
}) {
  if (typeof paidByUserId === "string" && allowedUserIds.has(paidByUserId)) {
    return paidByUserId;
  }

  if (paidByUserId) {
    warnings.push(
      "The payer could not be matched to an allowed participant, so it was set to you."
    );
  }

  return currentUserId;
}

function normalizeParticipantIds({
  participantUserIds,
  paidByUserId,
  currentUserId,
  requireCurrentUser,
  allowedUserIds,
  warnings,
}) {
  const requestedIds = Array.isArray(participantUserIds)
    ? participantUserIds
    : [currentUserId, paidByUserId];
  const dedupedIds = [];
  const seen = new Set();
  const rejectedIds = [];

  for (const id of requestedIds) {
    if (typeof id !== "string" || seen.has(id)) {
      continue;
    }

    seen.add(id);

    if (!allowedUserIds.has(id)) {
      rejectedIds.push(id);
      continue;
    }

    dedupedIds.push(id);
  }

  if (allowedUserIds.has(paidByUserId) && !dedupedIds.includes(paidByUserId)) {
    dedupedIds.push(paidByUserId);
    warnings.push(
      "The payer was added to the participant list because expenses must include the payer."
    );
  }

  if (
    requireCurrentUser &&
    allowedUserIds.has(currentUserId) &&
    !dedupedIds.includes(currentUserId)
  ) {
    dedupedIds.push(currentUserId);
    warnings.push(
      "You were added to the participant list to match the individual expense flow."
    );
  }

  if (rejectedIds.length > 0) {
    warnings.push(
      "Some participants were removed because they are outside the allowed context."
    );
  }

  return dedupedIds;
}

function normalizeWarnings(warnings) {
  if (!Array.isArray(warnings)) {
    return [];
  }

  return warnings
    .filter((warning) => typeof warning === "string")
    .map((warning) => warning.trim())
    .filter(Boolean);
}

function normalizeCategory(categoryId, warnings) {
  if (typeof categoryId !== "string") {
    warnings.push('No category was detected, so "other" was used.');
    return "other";
  }

  const normalizedKey = categoryId.trim().toLowerCase();
  const normalizedCategory =
    CATEGORY_BY_LOWER_ID[normalizedKey] ?? CATEGORY_ALIASES[normalizedKey];

  if (!normalizedCategory) {
    warnings.push(`Invalid category "${categoryId}" was replaced with "other".`);
    return "other";
  }

  return normalizedCategory;
}

function normalizeSplitType(splitType, warnings) {
  if (typeof splitType !== "string") {
    warnings.push('No split type was detected, so "equal" was used.');
    return "equal";
  }

  const normalized = splitType.trim().toLowerCase();

  if (!ALLOWED_SPLIT_TYPES.includes(normalized)) {
    warnings.push(`Invalid split type "${splitType}" was replaced with "equal".`);
    return "equal";
  }

  return normalized;
}

function normalizeDate(relativeDate, warnings) {
  const now = new Date();

  if (relativeDate === null || relativeDate === undefined || relativeDate === "") {
    return now.getTime();
  }

  if (typeof relativeDate !== "string") {
    warnings.push("The expense date was invalid, so today's date was used.");
    return now.getTime();
  }

  const normalized = relativeDate.trim().toLowerCase();

  if (["today", "tonight"].includes(normalized)) {
    return now.getTime();
  }

  if (["yesterday"].includes(normalized)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    return date.getTime();
  }

  if (["last night", "yesterday night"].includes(normalized)) {
    const date = new Date(now);
    date.setDate(date.getDate() - 1);
    date.setHours(21, 0, 0, 0);
    return date.getTime();
  }

  warnings.push(
    `The relative date "${relativeDate}" was not recognized, so today's date was used.`
  );
  return now.getTime();
}

function buildSplits({
  amount,
  splitType,
  participantUserIds,
  paidByUserId,
  exactAmounts,
  percentages,
  allowedUserIds,
}) {
  if (splitType === "percentage") {
    const percentageResult = buildPercentageSplits({
      amount,
      participantUserIds,
      paidByUserId,
      percentages,
      allowedUserIds,
    });

    if (percentageResult.success) {
      return {
        splitType,
        splits: percentageResult.splits,
        warnings: [],
        requiresConfirmation: false,
      };
    }

    return fallbackEqualSplits({
      amount,
      participantUserIds,
      paidByUserId,
      warning:
        "Percentage split details were invalid or incomplete, so an equal split preview was used.",
    });
  }

  if (splitType === "exact") {
    const exactResult = buildExactSplits({
      amount,
      participantUserIds,
      paidByUserId,
      exactAmounts,
      allowedUserIds,
    });

    if (exactResult.success) {
      return {
        splitType,
        splits: exactResult.splits,
        warnings: [],
        requiresConfirmation: false,
      };
    }

    return fallbackEqualSplits({
      amount,
      participantUserIds,
      paidByUserId,
      warning:
        "Exact split details were invalid or incomplete, so an equal split preview was used.",
    });
  }

  return {
    splitType: "equal",
    splits: buildEqualSplits({ amount, participantUserIds, paidByUserId }),
    warnings: [],
    requiresConfirmation: false,
  };
}

function buildPercentageSplits({
  amount,
  participantUserIds,
  paidByUserId,
  percentages,
  allowedUserIds,
}) {
  if (!Array.isArray(percentages)) {
    return { success: false };
  }

  const percentageMap = new Map();

  for (const entry of percentages) {
    const userId = entry?.userId;
    const percentage = Number(entry?.percentage);

    if (
      typeof userId !== "string" ||
      !allowedUserIds.has(userId) ||
      !participantUserIds.includes(userId) ||
      !Number.isFinite(percentage) ||
      percentage < 0 ||
      percentageMap.has(userId)
    ) {
      return { success: false };
    }

    percentageMap.set(userId, percentage);
  }

  if (
    percentageMap.size !== participantUserIds.length ||
    participantUserIds.some((userId) => !percentageMap.has(userId))
  ) {
    return { success: false };
  }

  const totalPercentage = [...percentageMap.values()].reduce(
    (sum, percentage) => sum + percentage,
    0
  );

  if (Math.abs(totalPercentage - 100) > TOLERANCE) {
    return { success: false };
  }

  const rawAmounts = participantUserIds.map(
    (userId) => (amount * percentageMap.get(userId)) / 100
  );

  return {
    success: true,
    splits: amountsToSplits({
      participantUserIds,
      paidByUserId,
      amounts: normalizeAmountsToTotal(rawAmounts, amount),
    }),
  };
}

function buildExactSplits({
  amount,
  participantUserIds,
  paidByUserId,
  exactAmounts,
  allowedUserIds,
}) {
  if (!Array.isArray(exactAmounts)) {
    return { success: false };
  }

  const amountMap = new Map();

  for (const entry of exactAmounts) {
    const userId = entry?.userId;
    const exactAmount = Number(entry?.amount);

    if (
      typeof userId !== "string" ||
      !allowedUserIds.has(userId) ||
      !participantUserIds.includes(userId) ||
      !Number.isFinite(exactAmount) ||
      exactAmount < 0 ||
      amountMap.has(userId)
    ) {
      return { success: false };
    }

    amountMap.set(userId, exactAmount);
  }

  if (
    amountMap.size !== participantUserIds.length ||
    participantUserIds.some((userId) => !amountMap.has(userId))
  ) {
    return { success: false };
  }

  const rawAmounts = participantUserIds.map((userId) => amountMap.get(userId));
  const totalExactAmount = rawAmounts.reduce((sum, value) => sum + value, 0);

  if (Math.abs(totalExactAmount - amount) > TOLERANCE) {
    return { success: false };
  }

  return {
    success: true,
    splits: amountsToSplits({
      participantUserIds,
      paidByUserId,
      amounts: normalizeAmountsToTotal(rawAmounts, amount),
    }),
  };
}

function fallbackEqualSplits({
  amount,
  participantUserIds,
  paidByUserId,
  warning,
}) {
  return {
    splitType: "equal",
    splits: buildEqualSplits({ amount, participantUserIds, paidByUserId }),
    warnings: [warning],
    requiresConfirmation: true,
  };
}

function buildEqualSplits({ amount, participantUserIds, paidByUserId }) {
  const evenAmount = amount / participantUserIds.length;
  const rawAmounts = participantUserIds.map(() => evenAmount);

  return amountsToSplits({
    participantUserIds,
    paidByUserId,
    amounts: normalizeAmountsToTotal(rawAmounts, amount),
  });
}

function amountsToSplits({ participantUserIds, paidByUserId, amounts }) {
  return participantUserIds.map((userId, index) => ({
    userId,
    amount: amounts[index],
    paid: userId === paidByUserId,
  }));
}

function normalizeAmountsToTotal(amounts, totalAmount) {
  const rounded = amounts.map(roundCurrency);
  const subtotal = rounded.reduce((sum, value) => sum + value, 0);
  const difference = roundCurrency(totalAmount - subtotal);

  if (rounded.length > 0 && Math.abs(difference) > 0) {
    rounded[rounded.length - 1] = roundCurrency(
      rounded[rounded.length - 1] + difference
    );
  }

  return rounded;
}

function normalizeConfidence(confidence, warnings, requiresConfirmation) {
  const number = Number(confidence);
  const baseConfidence = Number.isFinite(number)
    ? Math.min(1, Math.max(0, number))
    : 0.5;
  const warningPenalty = Math.min(warnings.length * 0.08, 0.4);
  const confirmationPenalty = requiresConfirmation ? 0.15 : 0;

  return Math.max(
    0,
    roundTo(baseConfidence - warningPenalty - confirmationPenalty, 2)
  );
}

function roundCurrency(value) {
  return roundTo(value, 2);
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function failure(error, warnings = [], extraFields = {}) {
  return {
    success: false,
    error,
    warnings: uniqueStrings(warnings),
    requiresConfirmation: true,
    ...extraFields,
  };
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
