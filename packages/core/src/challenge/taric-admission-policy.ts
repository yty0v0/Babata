export const TARIC_DEFAULT_ADMISSION_POLICY = {
  policy_id: "taric-admission",
  version: "1.0.0",
  hard_gates: ["schema", "scope", "evidence", "freshness", "independence"],
  risk_profiles: {
    informational: { risk_class: "informational", min_independent_reviews: 1, strong_independence: false, max_evidence_age_days: null },
    low: { risk_class: "low", min_independent_reviews: 1, strong_independence: false, max_evidence_age_days: 180 },
    medium: { risk_class: "medium", min_independent_reviews: 1, strong_independence: false, max_evidence_age_days: 90 },
    high: { risk_class: "high", min_independent_reviews: 2, strong_independence: true, max_evidence_age_days: 30 },
    critical: { risk_class: "critical", min_independent_reviews: 2, strong_independence: true, max_evidence_age_days: 14 },
  },
} as const

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

export function taricDefaultAdmissionPolicyDigest(): string {
  const { policy_id, version, hard_gates, risk_profiles } = TARIC_DEFAULT_ADMISSION_POLICY
  const hash = new Bun.CryptoHasher("sha256")
  hash.update(canonicalJson({ policy_id, version, hard_gates: [...hard_gates], risk_profiles }))
  return `sha256:${hash.digest("hex")}`
}
