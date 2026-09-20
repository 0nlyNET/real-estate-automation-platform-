export function launchProgress(
  steps: ReadonlyArray<{ status: string }>,
  ready: boolean,
) {
  if (!steps.length) return 0
  const percentage = Math.round(
    (100 * steps.filter((step) => step.status === "Complete").length) /
      steps.length,
  )
  return Math.min(ready ? 100 : 99, percentage)
}

export function unmappedReadinessChecks<T extends { key: string }>(
  checks: readonly T[],
  steps: ReadonlyArray<{ keys: readonly string[] }>,
) {
  const mapped = new Set(steps.flatMap((step) => [...step.keys]))
  return checks.filter((check) => !mapped.has(check.key))
}

export function nextReadinessStep<
  T extends { status: string; keys: readonly string[]; special?: string },
>(steps: readonly T[], testingBlockers: ReadonlyArray<{ key: string }>) {
  const first = steps.find((step) => step.status !== "Complete")
  if (first?.special === "test" && testingBlockers.length) {
    return (
      steps.find(
        (step) =>
          step.status !== "Complete" &&
          testingBlockers.some((item) => step.keys.includes(item.key)),
      ) || first
    )
  }
  return first
}
