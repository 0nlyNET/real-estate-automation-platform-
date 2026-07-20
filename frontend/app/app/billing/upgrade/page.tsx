import { redirect } from "next/navigation"

export default function LegacyUpgradePage() {
  redirect("/app/billing")
}
