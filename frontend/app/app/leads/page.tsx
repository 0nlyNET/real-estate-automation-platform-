"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { PageShell } from "@/app/app/_components/PageShell"
import { apiFetch } from "@/lib/api"
import { fetchMe } from "@/lib/me"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

type LeadRow = {
  id: string
  fullName?: string
  full_name?: string
  phone?: string
  email?: string
  stage?: string
  temperature?: string
  createdAt?: string
}

export default function LeadsPage() {
  const [loading, setLoading] = useState(true)
  const [leads, setLeads] = useState<LeadRow[]>([])
  const [q, setQ] = useState("")
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    async function load() {
      try {
        setLoading(true)
        setErr(null)
        const me = await fetchMe()
        if (!me?.tenantId) throw new Error("Missing tenant")
        const rows = await apiFetch("/leads")
        if (!mounted) return
        setLeads(Array.isArray(rows) ? rows : (rows?.items || []))
      } catch (e: any) {
        if (!mounted) return
        setErr(e?.message || "Failed to load leads")
      } finally {
        if (mounted) setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [])

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase()
    if (!t) return leads
    return leads.filter((l) => {
      const name = String(l.fullName || l.full_name || "").toLowerCase()
      const phone = String(l.phone || "").toLowerCase()
      const email = String(l.email || "").toLowerCase()
      return name.includes(t) || phone.includes(t) || email.includes(t)
    })
  }, [leads, q])

  return (
    <PageShell title="Leads" subtitle="Capture, qualify, assign, and follow up fast.">
      <div className="flex items-center gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, phone, or email" />
        <Button variant="outline" onClick={() => setQ("")}>Clear</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All leads</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <div className="text-sm text-muted-foreground">Loading...</div> : null}
          {err ? <div className="text-sm text-red-500">{err}</div> : null}
          {!loading && !err && filtered.length === 0 ? (
            <div className="text-sm text-muted-foreground">No leads yet.</div>
          ) : null}

          <div className="divide-y rounded border">
            {filtered.map((l) => (
              <div key={l.id} className="flex items-center justify-between p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {l.fullName || l.full_name || "Unnamed lead"}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {l.phone || "No phone"}{" "}
                    {l.email ? <span className="ml-2">{l.email}</span> : null}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs rounded bg-muted px-2 py-1">{l.stage || "new"}</span>
                  <Link href={`/app/leads/${l.id}`}>
                    <Button size="sm" variant="outline">Open</Button>
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </PageShell>
  )
}
