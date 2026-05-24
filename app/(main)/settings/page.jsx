"use client";

import { useEffect, useMemo, useState } from "react";
import { BarLoader } from "react-spinners";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useConvexMutation, useConvexQuery } from "@/hooks/use-convex-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CheckCircle2,
  MessageSquare,
  Phone,
  Smartphone,
  UserCircle2,
  XCircle,
} from "lucide-react";

const NO_GROUP_VALUE = "__none__";
const BOT_NUMBER = process.env.NEXT_PUBLIC_TWILIO_WHATSAPP_NUMBER?.replace("whatsapp:", "") || "+1 415 523 8886";

export default function SettingsPage() {
  const { data: currentUser, isLoading: isUserLoading } = useConvexQuery(
    api.users.getCurrentUser
  );
  const { data: groups, isLoading: areGroupsLoading } = useConvexQuery(
    api.dashboard.getUserGroups
  );
  const updatePhone = useConvexMutation(api.users.updatePhone);
  const removePhone = useConvexMutation(api.users.removePhone);
  const updateDefaultWhatsAppGroup = useConvexMutation(
    api.users.updateDefaultWhatsAppGroup
  );
  const [phoneInput, setPhoneInput] = useState("");

  const linkedPhone = currentUser?.phone;
  const isPhoneLinked = Boolean(linkedPhone);
  const defaultGroupValue =
    currentUser?.defaultWhatsAppGroupId ?? NO_GROUP_VALUE;
  const sortedGroups = useMemo(
    () =>
      [...(groups ?? [])].sort((a, b) =>
        String(a.name).localeCompare(String(b.name))
      ),
    [groups]
  );

  useEffect(() => {
    if (!linkedPhone) {
      setPhoneInput("");
    }
  }, [linkedPhone]);

  const handleLinkPhone = async (event) => {
    event.preventDefault();

    const phone = normalizePhone(phoneInput);
    if (!isValidPhone(phone)) {
      toast.error("Enter a phone number with country code, like +919876543210.");
      return;
    }

    try {
      await updatePhone.mutate({ phone });
      toast.success("WhatsApp number linked");
      setPhoneInput("");
    } catch (error) {
      toast.error("Failed to link WhatsApp: " + error.message);
    }
  };

  const handleRemovePhone = async () => {
    const confirmed = window.confirm(
      "Remove your linked WhatsApp number? WhatsApp commands will stop working."
    );
    if (!confirmed) return;

    try {
      await removePhone.mutate({});
      toast.success("WhatsApp number removed");
    } catch (error) {
      toast.error("Failed to remove WhatsApp number: " + error.message);
    }
  };

  const handleDefaultGroupChange = async (value) => {
    try {
      if (value === NO_GROUP_VALUE) {
        await updateDefaultWhatsAppGroup.mutate({});
      } else {
        await updateDefaultWhatsAppGroup.mutate({ groupId: value });
      }

      toast.success("Default WhatsApp group updated");
    } catch (error) {
      toast.error("Failed to update default group: " + error.message);
    }
  };

  if (isUserLoading) {
    return (
      <div className="mx-auto max-w-4xl py-6">
        <BarLoader width="100%" color="#36d7b7" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 py-6">
      <div>
        <h1 className="text-5xl gradient-title">Settings</h1>
        <p className="mt-1 text-muted-foreground">
          Manage your account and integrations
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700">
              <MessageSquare className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>WhatsApp Integration</CardTitle>
              <CardDescription>
                Link your WhatsApp number to add expenses and check balances via
                chat
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Phone className="h-4 w-4 text-muted-foreground" />
              <h2 className="font-semibold">Phone Number</h2>
            </div>

            {isPhoneLinked ? (
              <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <Badge
                    variant="secondary"
                    className="bg-green-100 text-green-700"
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    Connected
                  </Badge>
                  <p className="truncate font-medium">{linkedPhone}</p>
                  <p className="text-sm text-muted-foreground">
                    This number can message the Splitr WhatsApp bot.
                  </p>
                </div>

                <Button
                  variant="outline"
                  onClick={handleRemovePhone}
                  disabled={removePhone.isLoading}
                >
                  <XCircle className="h-4 w-4" />
                  {removePhone.isLoading ? "Removing..." : "Remove"}
                </Button>
              </div>
            ) : (
              <form onSubmit={handleLinkPhone} className="space-y-3">
                <div className="space-y-2">
                  <Label htmlFor="whatsapp-phone">WhatsApp number</Label>
                  <Input
                    id="whatsapp-phone"
                    type="tel"
                    value={phoneInput}
                    onChange={(event) => setPhoneInput(event.target.value)}
                    placeholder="+91 98765 43210"
                  />
                  <p className="text-sm text-muted-foreground">
                    Enter your number with country code (e.g., +91 for India)
                  </p>
                </div>

                <Button type="submit" disabled={updatePhone.isLoading}>
                  <Smartphone className="h-4 w-4" />
                  {updatePhone.isLoading ? "Linking..." : "Link WhatsApp"}
                </Button>
              </form>
            )}
          </section>

          {isPhoneLinked && (
            <section className="space-y-3 border-t pt-6">
              <div>
                <h2 className="font-semibold">Default WhatsApp Group</h2>
                <p className="text-sm text-muted-foreground">
                  Expenses sent via WhatsApp will be added to this group by
                  default
                </p>
              </div>

              {areGroupsLoading ? (
                <BarLoader width="100%" color="#36d7b7" />
              ) : (
                <Select
                  value={defaultGroupValue}
                  onValueChange={handleDefaultGroupChange}
                  disabled={updateDefaultWhatsAppGroup.isLoading}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Choose a default group" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_GROUP_VALUE}>
                      No default group (individual expenses)
                    </SelectItem>
                    {sortedGroups.map((group) => (
                      <SelectItem key={group.id ?? group._id} value={group.id}>
                        {group.name} - {getMemberCount(group)} members
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </section>
          )}

          <section className="rounded-lg border bg-muted/30 p-4">
            <h2 className="mb-3 font-semibold">How It Works</h2>
            <ol className="space-y-2 text-sm text-muted-foreground">
              <li>1. Link your WhatsApp number above.</li>
              <li>2. Save the Splitr bot number: {BOT_NUMBER}</li>
              <li>3. Send a message like "paid 200 for milk" to add expenses.</li>
              <li>4. Type "balance" to check who owes you.</li>
              <li>5. Type "help" for all available commands.</li>
            </ol>
          </section>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <UserCircle2 className="h-5 w-5" />
            </div>
            <div>
              <CardTitle>Account Info</CardTitle>
              <CardDescription>Your Splitr account details</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <ReadOnlyField label="Name" value={currentUser?.name} />
          <ReadOnlyField label="Email" value={currentUser?.email} />
        </CardContent>
      </Card>
    </div>
  );
}

function ReadOnlyField({ label, value }) {
  return (
    <div className="space-y-1 rounded-lg border bg-muted/20 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate text-sm font-medium">{value || "Not available"}</p>
    </div>
  );
}

function normalizePhone(phone) {
  return phone.replace(/[\s\-()]/g, "").trim();
}

function isValidPhone(phone) {
  return phone.startsWith("+") && phone.replace(/\D/g, "").length >= 10;
}

function getMemberCount(group) {
  if (Array.isArray(group.members)) return group.members.length;
  return group.memberCount ?? 0;
}
