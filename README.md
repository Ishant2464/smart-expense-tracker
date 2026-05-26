# 🧾 Splitr — AI-Powered Expense Management Platform

<div align="center">

**The smartest way to split expenses with friends**

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org/)
[![Convex](https://img.shields.io/badge/Convex-Real--time_Backend-orange)](https://www.convex.dev/)
[![Groq](https://img.shields.io/badge/Groq-Text_AI-orange)](https://groq.com/)
[![Gemini](https://img.shields.io/badge/Gemini-Vision-blue?logo=google)](https://ai.google.dev/)
[![Clerk](https://img.shields.io/badge/Clerk-Auth-purple)](https://clerk.com/)
[![Twilio](https://img.shields.io/badge/Twilio-WhatsApp-red?logo=twilio)](https://www.twilio.com/)
[![Inngest](https://img.shields.io/badge/Inngest-Cron_Jobs-green)](https://www.inngest.com/)

</div>

---

## 📖 Overview

Splitr is a full-stack, AI-native expense management platform that goes far beyond simple bill splitting. It features a **multi-tool AI agent** that can create expenses, check balances, and send reminders through natural conversation — via both an in-app chat interface and **WhatsApp integration**. Users can describe expenses in plain English, scan receipts with OCR, and receive AI-powered spending insights with anomaly detection.

### What makes Splitr different?

| Traditional Expense Trackers | Splitr |
|------------------------------|--------|
| Manual form entry | Natural language: *"Ram paid 300 for pizza for Ram, Laxman and Ravan"* |
| Open the app every time | WhatsApp bot: text your expenses without opening the browser |
| Basic totals and lists | AI anomaly detection, spending forecasts, personalized recommendations |
| Single-purpose API calls | Multi-tool AI agent that chains database operations autonomously |
| Static receipt entry | Multimodal OCR: snap a receipt photo, AI extracts everything |

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                          CLIENT LAYER                               │
│                                                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐              │
│  │  Next.js 15  │  │  Chat Panel  │  │  WhatsApp    │              │
│  │  App Router  │  │  (Floating)  │  │  (Twilio)    │              │
│  │              │  │              │  │              │              │
│  │  • Dashboard │  │  • Threads   │  │  • Webhook   │              │
│  │  • Expenses  │  │  • Messages  │  │  • Intent    │              │
│  │  • Groups    │  │  • Tool UX   │  │    Detection │              │
│  │  • Insights  │  │              │  │  • Replies   │              │
│  │  • Settings  │  │              │  │              │              │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘              │
│         │                 │                 │                       │
│         │    Clerk Auth   │   Convex React  │  Twilio SDK          │
└─────────┼─────────────────┼─────────────────┼───────────────────────┘
          │                 │                 │
          ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CONVEX BACKEND                               │
│                    (Real-time Serverless)                            │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                    AI LAYER                                  │    │
│  │                                                              │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐    │    │
│  │  │  ai.js      │  │  agent.js   │  │  insights.js     │    │    │
│  │  │             │  │             │  │                  │    │    │
│  │  │ • NLP Parse │  │ • Agent     │  │ • Pre-compute    │    │    │
│  │  │ • Receipt   │  │   Loop      │  │   Analytics      │    │    │
│  │  │   OCR       │  │ • Tool      │  │ • Anomaly        │    │    │
│  │  │ • Validate  │  │   Dispatch  │  │   Detection      │    │    │
│  │  │ • Normalize │  │ • History   │  │ • Projections    │    │    │
│  │  └──────┬──────┘  └──────┬──────┘  └────────┬─────────┘    │    │
│  │         │                │                   │              │    │
│  │         ▼                ▼                   ▼              │    │
│  │  ┌──────────────────────────────────────────────────┐      │    │
│  │  │       Groq Text API + Gemini Vision API            │      │    │
│  │  │    (Text + Vision + Structured Output)            │      │    │
│  │  └──────────────────────────────────────────────────┘      │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                  AGENT TOOLS                                 │    │
│  │  agentTools.js                                               │    │
│  │                                                              │    │
│  │  getMyBalances    │ getMyGroups      │ addExpense            │    │
│  │  getMonthlySpend  │ getGroupDetails  │ sendPaymentReminder   │    │
│  │  getRecentExpenses│ getExpensesWith  │                       │    │
│  │                   │ Person           │                       │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                 DATA LAYER                                   │    │
│  │                                                              │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────┐   │    │
│  │  │  users   │ │ expenses │ │ groups   │ │ settlements  │   │    │
│  │  │          │ │          │ │          │ │              │   │    │
│  │  │ • name   │ │ • amount │ │ • name   │ │ • amount     │   │    │
│  │  │ • email  │ │ • splits │ │ • members│ │ • payer      │   │    │
│  │  │ • phone  │ │ • category│ │ • roles │ │ • receiver   │   │    │
│  │  │ • waGroup│ │ • payer  │ │          │ │ • groupId    │   │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────┘   │    │
│  │                                                              │    │
│  │  ┌──────────────┐ ┌──────────────┐                          │    │
│  │  │ chatThreads  │ │ chatMessages │                          │    │
│  │  │              │ │              │                          │    │
│  │  │ • userId     │ │ • role       │                          │    │
│  │  │ • title      │ │ • content    │                          │    │
│  │  │ • lastMsg    │ │ • toolName   │                          │    │
│  │  └──────────────┘ └──────────────┘                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │               WHATSAPP LAYER                                 │    │
│  │  whatsapp.js                                                 │    │
│  │                                                              │    │
│  │  processWhatsAppMessage                                      │    │
│  │  ├── Intent Detection (regex-based)                          │    │
│  │  ├── BALANCE → getBalancesForWhatsApp                        │    │
│  │  ├── SUMMARY → getMonthlySpendingForWhatsApp                 │    │
│  │  ├── GROUPS  → getGroupsForWhatsApp                          │    │
│  │  ├── RECENT  → getRecentExpensesForWhatsApp                  │    │
│  │  ├── HELP    → static help text                              │    │
│  │  └── EXPENSE → Groq parse → createExpenseForWhatsApp         │    │
│  └─────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────┘
          │                                    │
          ▼                                    ▼
┌──────────────────┐              ┌──────────────────────┐
│   Inngest Crons  │              │    External Services  │
│                  │              │                      │
│ • Monthly AI     │              │ • Twilio WhatsApp    │
│   Insights Email │              │ • Resend Email       │
│ • Daily Payment  │              │ • Clerk Auth         │
│   Reminders      │              │ • Groq + Gemini APIs │
└──────────────────┘              └──────────────────────┘
```

---

## ✨ Features

### 🧠 1. Natural Language Expense Parsing
Type expenses in plain English — the AI handles the rest.

- *"Ram paid 300 for pizza for Ram, Laxman and Ravan"* → Parsed, validated, split, and created
- Confidence scoring with preview-first UX
- Participant resolution against real contacts/group members
- Supports equal, percentage, and exact splits
- Category auto-detection from 22 predefined categories

### 📸 2. Receipt & Screenshot OCR
Snap a photo, AI extracts everything.

- Upload receipt photos or UPI payment screenshots
- Gemini vision extracts: amount, merchant, category, date, itemized breakdown
- Auto-fills the NLP input for participant resolution
- Supports JPEG, PNG, WebP, HEIC formats

### 🤖 3. Multi-Tool AI Agent (Chat Interface)
A genuine agentic workflow — not just a chatbot.

- Floating chat panel accessible from every page
- 8 registered tools the agent can call autonomously:
  - `getMyBalances`, `getMyMonthlySpending`, `getMyGroups`
  - `getGroupDetails`, `getRecentExpenses`, `getExpensesWithPerson`
  - `addExpense`, `sendPaymentReminder`
- Multi-step execution: *"Add dinner 500 split with Arjun and show me my balance"* → chains 2 tools
- Persistent conversation threads with full history
- Real-time message updates via Convex subscriptions
- Tool call/result indicators in the chat UI

### 💬 4. WhatsApp Bot Integration
Track expenses without opening the app.

- Link your WhatsApp number in Settings
- Send messages to the Splitr bot:
  - `"paid 200 for milk"` → expense created and split
  - `"balance"` → who owes you, who you owe
  - `"summary"` → monthly spending overview
  - `"groups"` → list groups with balances
  - `"recent"` → last 5 expenses
  - `"help"` → command reference
- Set a default group for automatic splitting (perfect for flatmates!)
- Twilio webhook with signature validation

### 📊 5. Smart AI Insights & Anomaly Detection
Pre-computed analytics + AI interpretation.

- **Server-side pre-computation**: category breakdowns, month-over-month deltas, 3-month rolling averages
- **Anomaly detection**: flags categories at 1.5x (warning) and 2x (alert) their 3-month average
- **Month-end projection**: estimates total based on current spending pace
- **AI interpretation**: Groq analyzes pre-computed data (doesn't do math)
- **In-app dashboard**: stat cards, progress bars, comparison tables, top expenses
- **Monthly email reports**: automated via Inngest cron with rich HTML templates
- **Enhanced payment reminders**: total owed, debt count, oldest debt age

### 🏗️ Core Platform
- **Real-time reactive UI** via Convex subscriptions
- **Multi-method splitting**: equal, percentage, exact — with floating-point tolerance validation
- **Production-grade ledger**: pair-wise debt netting against settlements
- **Group management**: create groups, manage members, track group balances
- **1:1 expense tracking**: direct expenses between two people
- **Settlement recording**: log payments to settle debts
- **Clerk authentication**: secure sign-in/sign-up with protected routes
- **Responsive design**: works on desktop and mobile

---

## 🛠️ Tech Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | Next.js 15 (App Router, Turbopack) | React framework with file-based routing |
| **UI** | Tailwind CSS 4 + shadcn/ui + Radix | Component library with consistent design system |
| **Auth** | Clerk | Authentication, user management, protected routes |
| **Backend** | Convex | Real-time serverless database + functions |
| **AI** | Groq + Gemini Vision | NLP parsing, receipt OCR, agent responses, insights |
| **WhatsApp** | Twilio | WhatsApp Business API integration |
| **Email** | Resend | Transactional emails (insights, reminders) |
| **Cron Jobs** | Inngest | Scheduled functions (monthly insights, daily reminders) |
| **Charts** | Recharts | Dashboard expense visualization |
| **Forms** | React Hook Form + Zod | Form validation and handling |

---

## 📁 Project Structure

```
splitr/
├── app/
│   ├── (auth)/                    # Auth pages (sign-in, sign-up)
│   ├── (main)/                    # Protected app pages
│   │   ├── contacts/              # Contacts & group management
│   │   ├── dashboard/             # Main dashboard with charts
│   │   ├── expenses/new/          # Expense creation (AI + manual)
│   │   │   └── components/
│   │   │       ├── ai-expense-assistant.jsx  # NLP + Receipt OCR UI
│   │   │       ├── expense-form.jsx          # Manual form
│   │   │       └── ...                       # Selectors, splits
│   │   ├── groups/[id]/           # Group detail pages
│   │   ├── insights/              # AI Insights dashboard
│   │   ├── person/[id]/           # 1:1 expense pages
│   │   ├── settings/              # WhatsApp settings
│   │   ├── settlements/           # Settlement recording
│   │   └── layout.jsx             # Authenticated layout + ChatPanel
│   ├── api/
│   │   ├── inngest/route.js       # Inngest webhook
│   │   └── whatsapp/webhook/route.js  # Twilio webhook
│   ├── layout.js                  # Root layout (Clerk, Convex, Header)
│   └── page.jsx                   # Landing page
├── components/
│   ├── chat/                      # AI Chat Panel
│   │   ├── chat-panel.jsx         # Floating drawer + FAB
│   │   ├── chat-thread.jsx        # Message list + input
│   │   ├── chat-message.jsx       # Message rendering (4 roles)
│   │   └── thread-list.jsx        # Thread management
│   ├── ui/                        # shadcn components
│   ├── header.jsx                 # Navigation header
│   ├── expense-list.jsx           # Expense display
│   ├── settlement-list.jsx        # Settlement display
│   ├── group-balances.jsx         # Group balance display
│   └── group-members.jsx          # Group member list
├── convex/
│   ├── schema.js                  # Database schema (6 tables)
│   ├── ai.js                      # NLP parsing + Receipt OCR + upload
│   ├── agent.js                   # AI agent loop (sendMessage)
│   ├── agentTools.js              # 8 tool definitions + executors
│   ├── chat.js                    # Chat thread/message CRUD
│   ├── whatsapp.js                # WhatsApp message processing
│   ├── insights.js                # Pre-computed analytics + AI summary
│   ├── users.js                   # User management + phone linking
│   ├── expenses.js                # Expense CRUD
│   ├── settlements.js             # Settlement CRUD
│   ├── groups.js                  # Group management
│   ├── contacts.js                # Contact queries
│   ├── dashboard.js               # Dashboard queries
│   ├── inngest.js                 # Inngest helper queries
│   ├── email.js                   # Email sending action
│   └── auth.config.js             # Clerk JWT config
├── hooks/
│   ├── use-convex-query.js        # Custom Convex hooks
│   └── use-store-user.jsx         # User store hook
├── lib/
│   ├── expense-categories.js      # 22 category definitions
│   ├── inngest/
│   │   ├── client.js              # Inngest + Resend clients
│   │   ├── spending-insights.js   # Monthly AI insights cron
│   │   └── payment-reminders.js   # Daily payment reminders cron
│   ├── landing.js                 # Landing page data
│   └── utils.js                   # Tailwind utilities
├── middleware.js                   # Clerk route protection
├── package.json
└── next.config.mjs
```

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn
- Accounts on: [Convex](https://convex.dev), [Clerk](https://clerk.com), [Groq](https://console.groq.com), [Google AI Studio](https://ai.google.dev), [Twilio](https://twilio.com) (optional), [Resend](https://resend.com), [Inngest](https://inngest.com)

### 1. Clone and Install

```bash
git clone https://github.com/Ishant2464/smart-expense-tracker.git
cd smart-expense-tracker
npm install
```

### 2. Environment Variables

Create a `.env.local` file:

```env
# Convex
NEXT_PUBLIC_CONVEX_URL=your_convex_url

# Clerk
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_publishable_key
CLERK_SECRET_KEY=your_clerk_secret_key
CLERK_JWT_ISSUER_DOMAIN=your_clerk_jwt_issuer

# Groq text AI
GROQ_API_KEY=your_groq_api_key
GROQ_TEXT_MODEL=llama-3.1-8b-instant,llama-3.3-70b-versatile,meta-llama/llama-4-scout-17b-16e-instruct

# Gemini vision OCR
GEMINI_API_KEY=your_gemini_api_key
GEMINI_VISION_MODEL=gemini-2.5-flash,gemini-2.5-flash-lite,gemini-flash-lite-latest

# Resend (Email)
RESEND_API_KEY=your_resend_api_key

# Twilio WhatsApp (Optional — for WhatsApp feature)
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# Inngest
INNGEST_EVENT_KEY=your_inngest_event_key
INNGEST_SIGNING_KEY=your_inngest_signing_key
```

Set `GROQ_API_KEY`, `GEMINI_API_KEY`, model variables, and `RESEND_API_KEY` in your **Convex dashboard** environment variables as well.

### 3. Initialize Convex

```bash
npx convex dev
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 5. Set Up Twilio WhatsApp (Optional)

1. Create a [Twilio account](https://www.twilio.com/try-twilio)
2. Set up the [WhatsApp Sandbox](https://www.twilio.com/console/sms/whatsapp/sandbox)
3. Configure the webhook URL: `https://your-domain.com/api/whatsapp/webhook`
4. Join the sandbox from your WhatsApp by sending the join code
5. Link your phone number in the app's Settings page

### 6. Set Up Inngest (Optional)

1. Create an [Inngest account](https://www.inngest.com)
2. Connect your app via the Inngest dev server
3. The crons will run automatically:
   - Monthly spending insights: 1st of every month at 08:00 UTC
   - Daily payment reminders: every day at 10:00 UTC

---

## 📊 Database Schema

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User accounts | name, email, phone?, defaultWhatsAppGroupId? |
| `expenses` | Expense records | description, amount, splits[], category, paidByUserId, groupId? |
| `settlements` | Payment records | amount, paidByUserId, receivedByUserId, groupId? |
| `groups` | Expense groups | name, members[], createdBy |
| `chatThreads` | AI chat threads | userId, title, lastMessageAt |
| `chatMessages` | Chat messages | threadId, role, content, toolName?, toolResult? |

---

## 🤖 AI Agent Tools

| Tool | Description |
|------|-------------|
| `getMyBalances` | Overall balance: who you owe, who owes you |
| `getMyMonthlySpending` | Monthly spending breakdown for the year |
| `getMyGroups` | All groups with balances |
| `getGroupDetails` | Detailed group info: members, expenses, settlements |
| `getRecentExpenses` | Recent expenses with optional category filter |
| `getExpensesWithPerson` | Expenses and balance with a specific person |
| `addExpense` | Parse natural language and create an expense |
| `sendPaymentReminder` | Email a payment reminder to someone who owes you |

---

## 📱 WhatsApp Commands

| Command | Action |
|---------|--------|
| `paid 200 for milk` | Creates an expense, auto-splits with default group |
| `balance` | Shows who owes you and who you owe |
| `summary` | Monthly spending overview |
| `groups` | Lists your groups with balances |
| `recent` | Shows last 5 expenses |
| `help` | Shows available commands |

---

## 🔒 Security

- **Clerk authentication** on all protected routes
- **Convex auth context** propagated through all queries/mutations
- **Thread ownership** verification on all chat operations
- **Group membership** verification on all group operations
- **Twilio webhook signature** validation in production
- **Phone uniqueness** enforcement for WhatsApp linking
- **Preview-first** expense creation — AI never blindly writes to DB

---

## 📄 License

This project is for educational and portfolio purposes.

---

<div align="center">
  Built with ❤️ using Next.js, Convex, Groq, and Gemini Vision
</div>
