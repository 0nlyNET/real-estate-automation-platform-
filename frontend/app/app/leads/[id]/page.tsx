"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api";
import { useToast } from "@/hooks/use-toast";

type Lead = {
  id: string;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  stage: string;
  temperature: string;
  score: number;
  source: string | null;
  propertyInterest: string | null;
  budgetRange: string | null;
  preferredAreas: string[] | null;
  timeline: string | null;
  buyOrRent: string | null;
  preapproved: string | null;
  bestTimeToTalk: string | null;
  tags: string[] | null;
  assignedToUserId: string | null;
  firstContactSentAt: string | null;
  firstResponseTimeSec: number | null;
};

type User = { id: string; email: string; role: string; teamId: string | null; isActive: boolean };

type Enrollment = {
  id: string;
  status: string;
  currentStepIndex: number;
  nextRunAt: string | null;
  stoppedReason: string | null;
  sequence: { id: string; name: string } | null;
};

function fmtSeconds(sec: number | null) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  const m = Math.round(sec / 60);
  return `${m}m`;
}

export default function LeadDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [lead, setLead] = useState<Lead | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [saving, setSaving] = useState(false);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);

  const tagsText = useMemo(() => (lead?.tags || []).join(", "), [lead?.tags]);

  async function load() {
    if (!id) return;
    setLoading(true);
    try {
      const [l, m, en] = await Promise.all([
        apiFetch<Lead>(`/leads/${id}`),
        apiFetch<any>("/me").catch(() => null),
        apiFetch<Enrollment[]>(`/leads/${id}/enrollments`).catch(() => [] as any),
      ]);
      setLead(l);
      setEnrollments(Array.isArray(en) ? en : []);

      const role = String(m?.role || "agent").toLowerCase();
      if (role === "owner" || role === "admin") {
        const roster = await apiFetch<User[]>("/users").catch(() => []);
        setUsers(Array.isArray(roster) ? roster.filter((u) => u.isActive) : []);
      } else {
        setUsers([]);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  async function savePatch(patch: any) {
    if (!lead) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Lead>(`/leads/${lead.id}`, { method: "PATCH", body: patch });
      setLead(updated);
      toast({ title: "Saved" });
    } catch (e: any) {
      toast({ title: "Save failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function assignToUser(userId: string | null) {
    if (!lead) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Lead>(`/leads/${lead.id}/assign`, {
        method: "POST",
        body: { assignedToUserId: userId, assignedToTeamId: null, assignedTo: null },
      });
      setLead(updated);
      toast({ title: "Assigned" });
    } catch (e: any) {
      toast({ title: "Assign failed", description: String(e?.message || e), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function enrollmentAction(enrollmentId: string, action: "pause" | "resume" | "stop") {
    if (!lead) return;
    try {
      await apiFetch(`/leads/${lead.id}/enrollments/${enrollmentId}/${action}`, {
        method: "POST",
        body: action === "stop" ? { reason: "manual" } : {},
      });
      const en = await apiFetch<Enrollment[]>(`/leads/${lead.id}/enrollments`).catch(() => [] as any);
      setEnrollments(Array.isArray(en) ? en : []);
      toast({ title: "Updated" });
    } catch (e: any) {
      toast({ title: "Update failed", description: String(e?.message || e), variant: "destructive" });
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={lead?.fullName || (loading ? "Loading…" : "Lead")}
          subtitle="Qualify, assign, and move the lead through your pipeline."
          actions={
            <div className="flex gap-2">
              <Button asChild variant="outline" className="h-9">
                <Link href="/app/leads">Back</Link>
              </Button>
              <Button asChild className="h-9">
                <Link href={`/app/inbox?leadId=${lead?.id || ""}`}>Message</Link>
              </Button>
            </div>
          }
        />

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle>Lead profile</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {loading || !lead ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : (
                <>
                  <div className="grid gap-3 md:grid-cols-2">
                    <div>
                      <div className="text-sm text-muted-foreground">Email</div>
                      <div className="text-sm">{lead.email || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Phone</div>
                      <div className="text-sm">{lead.phone || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Source</div>
                      <div className="text-sm">{lead.source || "—"}</div>
                    </div>
                    <div>
                      <div className="text-sm text-muted-foreground">Response time</div>
                      <div className="text-sm">{fmtSeconds(lead.firstResponseTimeSec)}</div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Stage</Label>
                      <Select value={lead.stage} onValueChange={(v) => savePatch({ stage: v })} disabled={saving}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {[
                            "new",
                            "contacted",
                            "qualified",
                            "appointment_set",
                            "showing_scheduled",
                            "offer_out",
                            "under_contract",
                            "closed",
                            "nurture",
                            "lost",
                          ].map((s) => (
                            <SelectItem key={s} value={s}>
                              {s.replaceAll("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Temperature</Label>
                      <Select value={lead.temperature} onValueChange={(v) => savePatch({ temperature: v })} disabled={saving}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {["hot", "warm", "cold"].map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Timeline</Label>
                      <Input
                        value={lead.timeline || ""}
                        placeholder="0-3 months, 3-6, 6+"
                        onChange={(e) => setLead({ ...lead, timeline: e.target.value })}
                        onBlur={() => savePatch({ timeline: lead.timeline || null })}
                        disabled={saving}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Best time to talk</Label>
                      <Input
                        value={lead.bestTimeToTalk || ""}
                        placeholder="Morning, afternoon, evenings"
                        onChange={(e) => setLead({ ...lead, bestTimeToTalk: e.target.value })}
                        onBlur={() => savePatch({ bestTimeToTalk: lead.bestTimeToTalk || null })}
                        disabled={saving}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Buy / Rent / Sell</Label>
                      <Select
                        value={lead.buyOrRent || "unspecified"}
                        onValueChange={(v) => savePatch({ buyOrRent: v === "unspecified" ? null : v })}
                        disabled={saving}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unspecified">Unspecified</SelectItem>
                          <SelectItem value="buy">Buy</SelectItem>
                          <SelectItem value="rent">Rent</SelectItem>
                          <SelectItem value="sell">Sell</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Pre-approved</Label>
                      <Select
                        value={lead.preapproved || "unspecified"}
                        onValueChange={(v) => savePatch({ preapproved: v === "unspecified" ? null : v })}
                        disabled={saving}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="unspecified">Unspecified</SelectItem>
                          <SelectItem value="yes">Yes</SelectItem>
                          <SelectItem value="no">No</SelectItem>
                          <SelectItem value="unsure">Unsure</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Tags</Label>
                    <Input
                      value={tagsText}
                      placeholder="hot, cash, queens"
                      onChange={(e) =>
                        setLead({
                          ...lead,
                          tags: e.target.value
                            .split(",")
                            .map((x) => x.trim())
                            .filter(Boolean),
                        })
                      }
                      onBlur={() => savePatch({ tags: lead.tags || null })}
                      disabled={saving}
                    />
                    <div className="flex flex-wrap gap-2">
                      {(lead.tags || []).slice(0, 10).map((t) => (
                        <Badge key={t} variant="secondary">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Assignment</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {!lead ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : users.length === 0 ? (
                <div className="text-sm text-muted-foreground">Assignment is available on Teams and Brokerages for admins.</div>
              ) : (
                <div className="space-y-2">
                  <Label>Assigned agent</Label>
                  <Select value={lead.assignedToUserId || "unassigned"} onValueChange={(v) => assignToUser(v === "unassigned" ? null : v)} disabled={saving}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          {u.email} ({u.role})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="rounded-lg border p-3">
                <div className="text-sm font-medium">Next actions</div>
                <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
                  <li>Use Inbox to respond fast. Sequences stop automatically when a lead replies.</li>
                  <li>Move to Appointment Set when they book.</li>
                  <li>Keep Nurture for long-timeline leads.</li>
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Automations</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {loading ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : enrollments.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No active enrollments for this lead.
                </div>
              ) : (
                <div className="space-y-2">
                  {enrollments.map((e) => (
                    <div key={e.id} className="rounded-lg border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="font-medium truncate">{e.sequence?.name || "Automation"}</div>
                          <div className="text-xs text-muted-foreground">
                            Status: {e.status} · Step: {e.currentStepIndex + 1} · Next run: {e.nextRunAt ? new Date(e.nextRunAt).toLocaleString() : "—"}
                          </div>
                          {e.stoppedReason ? <div className="text-xs text-muted-foreground">Reason: {e.stoppedReason}</div> : null}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {e.status === "active" ? (
                            <Button size="sm" variant="outline" onClick={() => enrollmentAction(e.id, "pause")}>Pause</Button>
                          ) : e.status === "paused" ? (
                            <Button size="sm" variant="outline" onClick={() => enrollmentAction(e.id, "resume")}>Resume</Button>
                          ) : null}
                          {e.status !== "stopped" ? (
                            <Button size="sm" variant="destructive" onClick={() => enrollmentAction(e.id, "stop")}>Stop</Button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Tip: When the lead replies, RealtyTechAI stops active sequences automatically.
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
