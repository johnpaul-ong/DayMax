/** @type {import('next').NextConfig} */

// HTTP security headers.
//
// Two intents bundled here:
//
// 1. Safe, zero-risk drop-ins (X-Frame-Options, X-Content-Type-Options,
//    Referrer-Policy, Permissions-Policy, HSTS). Vercel adds HSTS at the
//    edge already, but pin it here too so a non-Vercel deploy (or a preview
//    domain) still gets it.
//
// 2. A REPORT-ONLY Content Security Policy. Browsers evaluate the policy
//    and log violations to the devtools console, but do NOT block anything.
//    That surfaces exactly which origins an enforcement CSP would need to
//    allowlist — the follow-up task is to iterate on that list and flip
//    Report-Only → enforcing. Landing enforcement CSP cold silently breaks
//    features (fonts, images, external evals), which is why this pass keeps
//    it report-only. No report-uri: the console is enough for local
//    inspection; adding a reporting endpoint is part of the follow-up.
const CSP_REPORT_ONLY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self' https://*.supabase.co https://api.chess.com https://lichess.org",
  "font-src 'self' data:",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "Content-Security-Policy-Report-Only", value: CSP_REPORT_ONLY },
];

const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
