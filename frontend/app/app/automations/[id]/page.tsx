"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { apiFetch } from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type Step = {
  id: string;
  channel: "sms" | "email";
  template: string;
  offsetMinutes: number;
};

type Sequence = {
  id: string;
  name: string;
  description: string | null;
  active: boolean;
  leadType: string | null;
  temperature: string | null;
  steps: Step[];
};

export default function AutomationEditorPage() {
  const { toast } = useToast();
  const params = useParams();
  const router = useRouter();
  const id = String((params as any)?.id || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seq, setSeq] = useState<Sequence | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [active, setActive] = useState(true);
  const [leadType, setLeadType] = useState<string>("any");
  const [temperature, setTemperature] = useState<string>("any");

  const [newChannel, setNewChannel] = useState<"sms" | "email">("sms");
  const [newOffset, setNewOffset] = useState<string>("0");
  const [newTemplate, setNewTemplate] = useState<string>(
    "Hey {{firstName}}, just checking in. Are you still looking to buy in the next 0-3 months?",
  );

  async function load() {
    setLoading(true);
    try {
      const d = await apiFetch<Sequence>(`/sequences/${id}`);
      if (!d) throw new Error("Not found");
      setSeq(d);
      setName(d.name || "");
      setDescription(d.description || "");
      setActive(!!d.active);
      setLeadType(d.leadType || "any");
      setTemperature(d.temperature || "any");
    } catch (e: any) {
      toast({ title: "Failed to load automation", description: e?.message || "" });
      setSeq(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!id) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const steps = useMemo(() => (seq?.steps || []).slice().sort((a, b) => a.offsetMinutes - b.offsetMinutes), [seq]);

  async function saveMeta() {
    setSaving(true);
    try {
      await apiFetch(`/sequences/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name,
          description: description.trim() ? description.trim() : null,
          active,
          leadType: leadType === "any" ? null : leadType,
          temperature: temperature === "any" ? null : temperature,
        }),
      });
      toast({ title: "Saved" });
      await load();
    } catch (e: any) {
      toast({ title: "Save failed", description: e?.message || "" });
    } finally {
      setSaving(false);
    }
  }

  async function addStep() {
    try {
      const offsetMinutes = Number(newOffset);
      await apiFetch(`/sequences/${id}/steps`, {
        method: "POST",
        body: JSON.stringify({ channel: newChannel, template: newTemplate, offsetMinutes: Number.isFinite(offsetMinutes) ? offsetMinutes : 0 }),
      });
      toast({ title: "Step added" });
      setNewOffset("0");
      await load();
    } catch (e: any) {
      toast({ title: "Add step failed", description: e?.message || "" });
    }
  }

  async function updateStep(stepId: string, patch: Partial<Step>) {
    try {
      await apiFetch(`/sequences/${id}/steps/${stepId}`, { method: "PATCH", body: JSON.stringify(patch) });
      await load();
    } catch (e: any) {
      toast({ title: "Update step failed", description: e?.message || "" });
    }
  }

  async function deleteStep(stepId: string) {
    if (!confirm("Delete this step?")) return;
    try {
      await apiFetch(`/sequences/${id}/steps/${stepId}`, { method: "DELETE" });
      toast({ title: "Step deleted" });
      await load();
    } catch (e: any) {
      toast({ title: "Delete failed", description: e?.message || "" });
    }
  }

  return (
    <AppShell>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-muted-foreground">
              <Link className="hover:underline" href="/app/automations">
                Automations
              </Link>
              <span className="mx-2">/</span>
              <span>Edit</span>
            </div>
            <h1 className="text-2xl font-bold">{seq?.name || "Automation"}</h1>
            <p className="text-muted-foreground">Edit the sequence steps, delays, and activation.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => router.push("/app/automations")}>
              Back
            </Button>
            <Button onClick={saveMeta} disabled={saving || loading}>
              Save
            </Button>
          </div>
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-12 text-sm text-muted-foreground">Loading...</CardContent>
          </Card>
        ) : !seq ? (
          <Card>
            <CardContent className="py-12 text-sm text-muted-foreground">Not found.</CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Settings</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Active</Label>
                  <div className="flex items-center gap-3">
                    <Switch checked={active} onCheckedChange={(v) => setActive(!!v)} />
                    <span className="text-sm text-muted-foreground">{active ? "Enabled" : "Disabled"}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Lead type</Label>
                  <Select value={leadType} onValueChange={setLeadType}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="buyer">Buyer</SelectItem>
                      <SelectItem value="seller">Seller</SelectItem>
                      <SelectItem value="renter">Renter</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Temperature</Label>
                  <Select value={temperature} onValueChange={setTemperature}>
                    <SelectTrigger>
                      <SelectValue placeholder="Any" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="any">Any</SelectItem>
                      <SelectItem value="hot">Hot</SelectItem>
                      <SelectItem value="warm">Warm</SelectItem>
                      <SelectItem value="cold">Cold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 space-y-2">
                  <Label>Description</Label>
                  <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Steps</CardTitle>
              </CardHeader>
              <CardContent>
                {steps.length === 0 ? (
                  <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
                    No steps yet. Add one below.
                  </div>
                ) : (
                  <div className="rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Delay (min)</TableHead>
                          <TableHead>Channel</TableHead>
                          <TableHead>Message</TableHead>
                          <TableHead className="w-[140px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {steps.map((s) => (
                          <TableRow key={s.id}>
                            <TableCell className="align-top">
                              <Input
                                className="h-9 w-[120px]"
                                value={String(s.offsetMinutes)}
                                onChange={(e) => updateStep(s.id, { offsetMinutes: Number(e.target.value) })}
                              />
                            </TableCell>
                            <TableCell className="align-top">
                              <Select value={s.channel} onValueChange={(v) => updateStep(s.id, { channel: v as any })}>
                                <SelectTrigger className="h-9 w-[120px]">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="sms">SMS</SelectItem>
                                  <SelectItem value="email">Email</SelectItem>
                                </SelectContent>
                              </Select>
                            </TableCell>
                            <TableCell>
                              <Textarea
                                value={s.template}
                                onChange={(e) => updateStep(s.id, { template: e.target.value })}
                                rows={3}
                              />
                            </TableCell>
                            <TableCell className="align-top">
                              <Button variant="destructive" size="sm" onClick={() => deleteStep(s.id)}>
                                Delete
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label>Delay (minutes)</Label>
                    <Input value={newOffset} onChange={(e) => setNewOffset(e.target.value)} placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label>Channel</Label>
                    <Select value={newChannel} onValueChange={(v) => setNewChannel(v as any)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="md:col-span-3 space-y-2">
                    <Label>Message template</Label>
                    <Textarea value={newTemplate} onChange={(e) => setNewTemplate(e.target.value)} rows={4} />
                  </div>
                  <div className="md:col-span-3">
                    <Button onClick={addStep}>Add step</Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </AppShell>
  );
}
