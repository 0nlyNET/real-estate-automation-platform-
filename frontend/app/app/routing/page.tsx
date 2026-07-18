"use client"

import { useEffect, useState } from "react"
import { PageShell } from "@/app/app/_components/PageShell"
import { LockedFeature } from "@/app/app/_components/LockedFeature"
import { apiFetch } from "@/lib/api"
import { fetchMeWithPlan } from "@/lib/me"
import { canUseTeams, isAdminRole } from "@/lib/access"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Rule = {
  id: string
  name: string
  isActive: boolean
  priority: number
  conditions: any
  actionType: string
  actionConfig: any
}

type Team = { id: string; name: string }
type User = { id: string; email: string; teamId?: string | null; isActive?: boolean }

export default function RoutingPage() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [hasTeams, setHasTeams] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [rules, setRules] = useState<Rule[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [users, setUsers] = useState<User[]>([])

  const [name, setName] = useState("")
  const [priority, setPriority] = useState("100")
  const [source, setSource] = useState("")
  const [actionType, setActionType] = useState("round_robin_team")
  const [teamId, setTeamId] = useState("")
  const [userId, setUserId] = useState("")
  const [requireOnline, setRequireOnline] = useState(true)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        setErr(null)

        const { me, planName } = await fetchMeWithPlan()
        if (!mounted) return

        setHasTeams(canUseTeams(planName))
        setIsAdmin(isAdminRole(me?.role))

        if (!canUseTeams(planName)) return

        const [rs, teamRows, userRows] = await Promise.all([
          apiFetch("/routing/rules"),
          apiFetch<Team[]>("/teams"),
          apiFetch<User[]>("/users"),
        ])
        setRules(Array.isArray(rs) ? rs : (rs?.items || []))
        setTeams(Array.isArray(teamRows) ? teamRows : [])
        setUsers(Array.isArray(userRows) ? userRows.filter((user) => user.isActive !== false) : [])
      } catch (e: any) {
        if (!mounted) return
        setErr(e?.message || "Failed to load routing")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  async function refresh() {
    try {
      const rs = await apiFetch("/routing/rules")
      setRules(Array.isArray(rs) ? rs : (rs?.items || []))
    } catch (e: any) {
      setErr(e?.message || "Refresh failed")
    }
  }

  async function createRule() {
    if (!isAdmin) return
    const n = name.trim()
    if (!n) return

    const pr = Number(priority || "100")
    const conditions: any = {}
    if (source.trim()) conditions.source = source.trim()

    const actionConfig: any = { requireOnline }
    if (actionType === "round_robin_team") actionConfig.teamId = teamId.trim() || undefined
    if (actionType === "fixed_user") actionConfig.userId = userId.trim() || undefined

    setName("")
    setSource("")
    setTeamId("")
    setUserId("")

    try {
      await apiFetch("/routing/rules", {
        method: "POST",
        body: {
          rule: {
            name: n,
            priority: pr,
            isActive: true,
            conditions,
            actionType,
            actionConfig,
          },
        },
      })
      await refresh()
    } catch (e: any) {
      setErr(e?.message || "Create rule failed")
    }
  }

  async function toggle(rule: Rule) {
    if (!isAdmin) return
    try {
      await apiFetch("/routing/rules", {
        method: "POST",
        body: { rule: { ...rule, isActive: !rule.isActive } },
      })
      await refresh()
    } catch (e: any) {
      setErr(e?.message || "Update failed")
    }
  }

  async function remove(id: string) {
    if (!isAdmin) return
    try {
      await apiFetch(`/routing/rules/${id}`, { method: "DELETE" })
      await refresh()
    } catch (e: any) {
      setErr(e?.message || "Delete failed")
    }
  }

  if (!hasTeams) {
    return (
      <PageShell title="Routing" subtitle="Round robin, fixed assignment, fallback, and audit logs.">
        <LockedFeature
          title="Routing rules"
          requiredLabel="Teams"
          description="Routing rules require the Teams plan. Upgrade to route leads and enforce team inbox visibility."
        />
      </PageShell>
    )
  }

  return (
    <PageShell title="Routing" subtitle="Define assignment rules and keep response time tight.">
      {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
      {err ? <div className="text-sm text-red-500">{err}</div> : null}

      <Card>
        <CardHeader>
          <CardTitle>Create rule</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isAdmin ? (
            <div className="text-sm text-muted-foreground">Only Owner/Admin can manage routing rules.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rule name" />
                <Input value={priority} onChange={(e) => setPriority(e.target.value)} placeholder="Priority (lower runs first)" />
                <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="Condition: source (optional)" />
                <Select value={actionType} onValueChange={setActionType}>
                  <SelectTrigger>
                    <SelectValue placeholder="Action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="round_robin_team">Round robin by team</SelectItem>
                    <SelectItem value="fixed_user">Assign fixed user</SelectItem>
                  </SelectContent>
                </Select>

                {actionType === "round_robin_team" ? (
                  <Select value={teamId} onValueChange={setTeamId}>
                    <SelectTrigger><SelectValue placeholder="Choose a team" /></SelectTrigger>
                    <SelectContent>
                      {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                ) : (
                  <Select value={userId} onValueChange={setUserId}>
                    <SelectTrigger><SelectValue placeholder="Choose a user" /></SelectTrigger>
                    <SelectContent>
                      {users.map((user) => <SelectItem key={user.id} value={user.id}>{user.email}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}

                <div className="flex items-center gap-2">
                  <Switch checked={requireOnline} onCheckedChange={(v) => setRequireOnline(Boolean(v))} />
                  <Label>Require online</Label>
                </div>
              </div>

              <Button onClick={createRule}>Create</Button>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="divide-y rounded border">
            {rules.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs text-muted-foreground truncate">
                    priority {r.priority} | {r.actionType}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => toggle(r)} disabled={!isAdmin}>
                    {r.isActive ? "Disable" : "Enable"}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => remove(r.id)} disabled={!isAdmin}>
                    Delete
                  </Button>
                </div>
              </div>
            ))}
            {rules.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No rules yet.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}
