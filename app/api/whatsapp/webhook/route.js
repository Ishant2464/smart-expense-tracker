import { ConvexHttpClient } from "convex/browser";
import twilio from "twilio";
import { api } from "@/convex/_generated/api";

export async function POST(request) {
  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);
  const formData = Object.fromEntries(params.entries());
  const body = formData.Body ?? "";
  const from = formData.From ?? "";
  const phone = stripWhatsAppPrefix(from);
  const fallbackReply =
    "Sorry, Splitr could not process that message right now. Please try again later.";

  console.info("WhatsApp webhook received", {
    from: phone || "unknown",
    body: body.slice(0, 80),
  });

  try {
    if (!isValidTwilioRequest(request, formData)) {
      return new Response("Forbidden", { status: 403 });
    }

    const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
    if (!convexUrl) {
      throw new Error("NEXT_PUBLIC_CONVEX_URL is not configured.");
    }

    const convex = new ConvexHttpClient(convexUrl);
    const result = await convex.action(api.whatsapp.processWhatsAppMessage, {
      fromPhone: phone,
      messageBody: body,
    });
    const reply = result?.reply || fallbackReply;

    await sendWhatsAppReply({ to: from, body: reply });
    console.info("WhatsApp reply sent", { to: phone || "unknown" });

    return new Response("", { status: 200 });
  } catch (error) {
    console.error("WhatsApp webhook failed:", error);

    try {
      if (from) {
        await sendWhatsAppReply({ to: from, body: fallbackReply });
      }
    } catch (sendError) {
      console.error("Failed to send WhatsApp fallback reply:", sendError);
    }

    return new Response("", { status: 200 });
  }
}

function isValidTwilioRequest(request, formData) {
  if (process.env.NODE_ENV === "development") {
    return true;
  }

  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const signature = request.headers.get("x-twilio-signature");

  if (!authToken || !signature) {
    return false;
  }

  return twilio.validateRequest(authToken, signature, request.url, formData);
}

async function sendWhatsAppReply({ to, body }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = normalizeWhatsAppNumber(process.env.TWILIO_WHATSAPP_NUMBER);

  if (!accountSid || !authToken || !from) {
    throw new Error("Twilio WhatsApp environment variables are not configured.");
  }

  const client = twilio(accountSid, authToken);

  await client.messages.create({
    from,
    to: normalizeWhatsAppNumber(to),
    body: truncateWhatsAppBody(body),
  });
}

function normalizeWhatsAppNumber(value) {
  if (!value) return "";
  return value.startsWith("whatsapp:") ? value : `whatsapp:${value}`;
}

function stripWhatsAppPrefix(value) {
  return String(value ?? "").replace(/^whatsapp:/i, "");
}

function truncateWhatsAppBody(body) {
  const text = String(body ?? "");
  return text.length > 1500 ? `${text.slice(0, 1497)}...` : text;
}
