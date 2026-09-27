# Security Hardening Patterns

> Source: `Backend/core/security.py`, `Backend/credentials/manager.py`
> Commit: `e5191fa` — feat(auth): CSRF protection, SSRF validation, secret detection

---

## 1. XSS Sanitization — Regex Fix

**Bug:** The old regex used two separate patterns joined with `|<|>`. This caused the replace function's `match.group(2)` to throw `IndexError` when the second alternative fired, because group 2 didn't exist.

```python
# BEFORE (broken)
protected_tag_regex = r'(</?(?:code|pre|br)\s*/?>)'
return re.sub(f'{protected_tag_regex}|<|>', replace, text)
# Problem: when bare < or > matched, group(2) didn't exist → crash

# AFTER (fixed)
protected_tag_regex = r'(</?(?:code|pre|br)\s*/?>)|([<>])'
# Now group(1) = protected tag, group(2) = bare bracket
# Only one regex, both alternatives always define their groups
```

**Lesson:** When combining alternatives in regex, keep them in a single pattern so all groups are always defined. Never reference `match.group(N)` unless you know that group participates in the current match.

---

## 2. Regex Literal Braces — Python f-string Pitfall

```python
# BEFORE (broken) — double braces in f-string become single braces
(r'(?i)(password|passwd|pwd)["\']?\s*[:=]\s*["\']?([^\s"\']{{8,}})', 'PASSWORD'),
#                                                              ^^^^^ wrong — {8,} needed

# AFTER (fixed) — raw string, no f-string, no escaping needed
(r'(?i)(password|passwd|pwd)["\']?\s*[:=]\s*["\']?([^\s"\']{8,})', 'PASSWORD'),
```

**Lesson:** In Python raw strings (`r"..."`), `{8,}` is the regex quantifier. In f-strings, `{{8,}}` would produce the literal text `{8,}` — not the quantifier. Never mix f-string formatting with regex quantifier syntax.

---

## 3. Credential Cache — LRU + TTL Eviction

**Problem:** An unbounded in-memory dict cache grows forever in a long-running Django process. If you cache 10,000 credentials, you're holding decrypted secrets in memory indefinitely.

```python
MAX_CACHE_SIZE = 1000

def _evict_cache(self) -> None:
    now = timezone.now()
    # Step 1: Remove expired entries (TTL = 5 min)
    expired_keys = [k for k, (_, cached_at) in self._cache.items()
                    if now - cached_at >= self._cache_ttl]
    for k in expired_keys:
        del self._cache[k]
    
    # Step 2: If still over limit, evict oldest (LRU-style by insertion time)
    if len(self._cache) >= MAX_CACHE_SIZE:
        sorted_keys = sorted(self._cache.keys(), key=lambda k: self._cache[k][1])
        excess = len(self._cache) - MAX_CACHE_SIZE + 1
        for k in sorted_keys[:excess]:
            del self._cache[k]
```

**Why this pattern:**
- TTL eviction removes stale credentials (rotated keys, revoked access)
- Size limit prevents memory exhaustion (DoS vector)
- Together they form a "bounded TTL cache" — the standard pattern for caching sensitive data

**Production alternative:** Use Django's cache framework (`django.core.cache`) with Redis — it handles TTL, eviction, and works across multiple worker processes.

---

## 4. Credential Audit Logging

Every credential access gets logged:

```python
await sync_to_async(CredentialAuditLog.objects.create)(
    credential=credential,
    user_id=user_id,
    action='accessed',
)
```

**Why this matters for interviews:**
- Compliance: SOC2, HIPAA, PCI-DSS all require credential access audit trails
- Incident response: When a credential is leaked, you need to know who accessed it and when
- The `try/except` around it ensures a logging failure never breaks the actual credential fetch — audit logging is best-effort, not mission-critical

---

## 5. SSRF (Server-Side Request Forgery) Prevention

SSRF is when a user causes your server to make HTTP requests to internal endpoints (e.g., AWS metadata at `169.254.169.254`, Redis, PostgreSQL).

**Prevention pattern used:**
```python
# Validate URL before fetching
def _validate_url_for_ssrf(url: str) -> bool:
    parsed = urlparse(url)
    host = parsed.hostname
    # Block private IP ranges
    try:
        ip = ipaddress.ip_address(socket.gethostbyname(host))
        return not (ip.is_private or ip.is_loopback or ip.is_link_local)
    except Exception:
        return False
```

**Private ranges to block:** `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.0.0/16` (link-local/AWS metadata)

---

## 6. Path Traversal Protection

For file uploads/attachments:

```python
# Block paths with ../ sequences
if '..' in os.path.normpath(filename):
    raise SecurityError("Path traversal detected")

# Resolve to absolute and verify it's under the expected directory
safe_dir = os.path.abspath(UPLOAD_DIR)
target = os.path.abspath(os.path.join(safe_dir, filename))
if not target.startswith(safe_dir):
    raise SecurityError("Path traversal detected")
```

---

## OWASP Top 10 Quick Reference (Interview)

| Rank | Vulnerability | Mitigation in this codebase |
|------|--------------|----------------------------|
| A01 | Broken Access Control | User-scoped QuerySets (`filter(user=request.user)`) |
| A02 | Cryptographic Failures | AES encryption for credentials, HTTPS-only cookies |
| A03 | Injection | RestrictedPython sandbox, parameterized ORM queries |
| A05 | Security Misconfiguration | `secure=not DEBUG` on cookies, env var secrets |
| A07 | Auth Failures | HttpOnly JWT cookies, token expiry, social auth |
| A09 | Security Logging | CredentialAuditLog, violation logging in InputSanitizer |
| A10 | SSRF | IP range blocking before outbound HTTP |
