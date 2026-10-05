export function redact(text: string, preserveLines = false): string {
  const mask = (value: string, label = '[REDACTED]') => preserveLines ? value.split(/\r?\n/).map(() => label).join('\n') : label;
  return text
    .replace(/-----BEGIN [^\r\n]*PRIVATE KEY-----[\s\S]*?(?:-----END [^\r\n]*PRIVATE KEY-----|$)/g, value => mask(value, '[REDACTED PRIVATE KEY]'))
    .replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|_authToken|password|secret)\s*["']?\s*[:=]\s*)("(?:\\[\s\S]|[^"\\])*(?:"|$)|'(?:\\[\s\S]|[^'\\])*(?:'|$)|[^\s,"'}]+)/gi,
      (_match, prefix: string, value: string) => prefix + mask(value))
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|glpat-[A-Za-z0-9_-]{12,}|xox[abp]-[A-Za-z0-9-]{12,}|npm_[A-Za-z0-9]{12,}|AIza[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g, '[REDACTED TOKEN]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED TOKEN]')
    .replace(/\bBearer[ \t]+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [REDACTED]');
}

export function safeError(error: unknown): string {
  return redact(error instanceof Error ? error.message : 'Unknown failure').slice(0, 500);
}
