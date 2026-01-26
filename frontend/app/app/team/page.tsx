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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

type Team = { id: string; name: string }
type UserRow = { id: string; email: string; role?: string }

export default function TeamPage() {
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const [hasTeams, setHasTeams] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [tenantId, setTenantId] = useState<string | null>(null)

  const [teams, setTeams] = useState<Team[]>([])
  const [teamName, setTeamName] = useState("")
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)

  const [users, setUsers] = useState<UserRow[]>([])
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("agent")

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        setErr(null)

        const { me, planName } = await fetchMeWithPlan()
        if (!mounted) return

        setTenantId(me?.tenantId || null)
        setHasTeams(canUseTeams(planName))
        setIsAdmin(isAdminRole(me?.role))

        if (!canUseTeams(planName)) {
          setTeams([])
          setUsers([])
          return
        }

        const ts = await apiFetch("/teams")
        const teamItems = Array.isArray(ts) ? ts : (ts?.items || [])
        setTeams(teamItems)
        const first = teamItems?.[0]?.id || null
        setSelectedTeamId(first)

        const us = await apiFetch("/users")
        setUsers(Array.isArray(us) ? us : (us?.items || []))
      } catch (e: any) {
        if (!mounted) return
        setErr(e?.message || "Failed to load team")
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
      const ts = await apiFetch("/teams")
      const teamItems = Array.isArray(ts) ? ts : (ts?.items || [])
      setTeams(teamItems)
      if (!selectedTeamId && teamItems?.[0]?.id) setSelectedTeamId(teamItems[0].id)

      const us = await apiFetch("/users")
      setUsers(Array.isArray(us) ? us : (us?.items || []))
    } catch (e: any) {
      setErr(e?.message || "Refresh failed")
    }
  }

  async function createTeam() {
    const name = teamName.trim()
    if (!name) return
    setTeamName("")
    try {
      await apiFetch("/teams", { method: "POST", body: { name } })
      await refresh()
    } catch (e: any) {
      setErr(e?.message || "Create team failed")
    }
  }

  async function invite() {
    const email = inviteEmail.trim()
    if (!email) return
    setInviteEmail("")
    try {
      await apiFetch("/users", {
        method: "POST",
        body: { email, role: inviteRole, teamId: selectedTeamId },
      })
      await refresh()
    } catch (e: any) {
      setErr(e?.message || "Invite failed")
    }
  }

  if (!hasTeams) {
    return (
      <PageShell title="Team" subtitle="Invite users, manage roles, and build a team workspace.">
        <LockedFeature
          title="Team management"
          requiredLabel="Teams"
          description="Team management requires the Teams plan. Upgrade to invite users, assign roles, and enable routing."
        />
      </PageShell>
    )
  }

  return (
    <PageShell title="Team" subtitle="Manage teams, seats, and roles.">
      {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
      {err ? <div className="text-sm text-red-500">{err}</div> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Teams</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isAdmin ? (
              <div className="text-sm text-muted-foreground">Only Owner/Admin can create teams.</div>
            ) : (
              <div className="flex gap-2">
                <Input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="New team name" />
                <Button onClick={createTeam}>Create</Button>
              </div>
            )}

            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">Active team</div>
              <Select value={selectedTeamId || ""} onValueChange={(v) => setSelectedTeamId(v || null)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a team" />
                </SelectTrigger>
                <SelectContent>
                  {teams.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invite user</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {!isAdmin ? (
              <div className="text-sm text-muted-foreground">Only Owner/Admin can invite users.</div>
            ) : (
              <>
                <Input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} placeholder="Email address" />
                <div className="flex gap-2">
                  <Select value={inviteRole} onValueChange={setInviteRole}>
                    <SelectTrigger>
                      <SelectValue placeholder="Role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agent">Agent</SelectItem>
                      <SelectItem value="tc">Transaction Coordinator</SelectItem>
                      <SelectItem value="read_only">Read only</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <Button onClick={invite}>Send invite</Button>
                </div>
                <div className="text-xs text-muted-foreground">
                  Invites will be associated to the selected team when supported by backend.
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="divide-y rounded border">
            {users.map((u) => (
              <div key={u.id} className="flex items-center justify-between p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{u.email}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.role || "agent"}</div>
                </div>
              </div>
            ))}
            {users.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No users found.</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}
