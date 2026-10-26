export interface CuratedSkillEntry {
    source: string
    target: string
    description?: string
}

export interface FrameworkMapSource {
    root: string
    target: string
}

const cyberstrikeWeb = (name: string): CuratedSkillEntry => ({
    source: `.cyberstrike/skill/${name}/SKILL.md`,
    target: `${name}/SKILL.md`,
})

const cyberstrikeStandalone = (name: string): CuratedSkillEntry => ({
    source: `.cyberstrike/skill/${name}/SKILL.md`,
    target: `${name}/SKILL.md`,
})

const wstg = (name: string): CuratedSkillEntry => ({
    source: `.cyberstrike/skill/WEB/OWASP_WSTG_4.2/${name}/SKILL.md`,
    target: `${name}/SKILL.md`,
})

export const CURATED_SKILL_MANIFEST: CuratedSkillEntry[] = [
    wstg("wstg-recon-config"),
    wstg("wstg-injection"),
    wstg("wstg-auth-session"),
    wstg("wstg-logic-client-api"),
    cyberstrikeWeb("attack-ssrf"),
    cyberstrikeWeb("attack-ssti"),
    cyberstrikeWeb("attack-jwt"),
    cyberstrikeWeb("attack-xxe"),
    cyberstrikeWeb("attack-cors"),
    cyberstrikeWeb("attack-graphql"),
    cyberstrikeWeb("attack-host-header"),
    cyberstrikeWeb("attack-request-smuggling"),
    cyberstrikeWeb("attack-race-condition"),
    cyberstrikeWeb("attack-websocket"),
    cyberstrikeWeb("attack-idor-automation"),
    cyberstrikeWeb("attack-open-redirect"),
    cyberstrikeWeb("attack-prototype-pollution"),
    cyberstrikeWeb("attack-cache-poison"),
    cyberstrikeWeb("attack-rate-limit-bypass"),
    cyberstrikeWeb("attack-subdomain-takeover"),
    cyberstrikeStandalone("cloud-assessment"),
    cyberstrikeStandalone("aws-postexploit"),
    cyberstrikeStandalone("azure-postexploit"),
    cyberstrikeStandalone("gcp-postexploit"),
    cyberstrikeStandalone("k8s-assessment"),
    cyberstrikeStandalone("k8s-postexploit"),
    cyberstrikeStandalone("ci-assessment"),
    cyberstrikeStandalone("cicd-attacks"),
    cyberstrikeStandalone("llm-security"),
    cyberstrikeStandalone("ebpf-attacks"),
    cyberstrikeStandalone("recon-methodology"),
    cyberstrikeStandalone("windows-postexploit"),
    cyberstrikeStandalone("linux-postexploit"),
    cyberstrikeStandalone("ad-security"),
    cyberstrikeStandalone("kerberos-attacks"),
]

export const FRAMEWORK_MAP_SOURCES: FrameworkMapSource[] = [
    { root: ".cyberstrike/skill/mitre_attack", target: "frameworks-mitreattack.json" },
    { root: ".cyberstrike/skill/NIST", target: "frameworks-nist.json" },
    { root: ".cyberstrike/skill/CIS_benchmarks", target: "frameworks-cis.json" },
]
