import type { NextConfig } from "next";

function deriveLspConnectSources(rawUrl?: string) {
  if (!rawUrl) {
    return [];
  }

  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = new URL(trimmed);
    const sources = new Set<string>();

    sources.add(`${parsed.protocol}//${parsed.host}`);
    if (parsed.protocol === "ws:") {
      sources.add(`http://${parsed.host}`);
    } else if (parsed.protocol === "wss:") {
      sources.add(`https://${parsed.host}`);
    }

    const fallbackHost = parsed.hostname === "localhost"
      ? "127.0.0.1"
      : parsed.hostname === "127.0.0.1"
        ? "localhost"
        : null;

    if (fallbackHost) {
      const fallback = new URL(trimmed);
      fallback.hostname = fallbackHost;
      sources.add(`${fallback.protocol}//${fallback.host}`);
      if (fallback.protocol === "ws:") {
        sources.add(`http://${fallback.host}`);
      } else if (fallback.protocol === "wss:") {
        sources.add(`https://${fallback.host}`);
      }
    }

    return [...sources];
  } catch {
    return [];
  }
}

const connectSrc = [
  "'self'",
  "https:",
  "wss:",
  ...(process.env.NODE_ENV === "production" ? [] : ["http:", "ws:"]),
  ...deriveLspConnectSources(process.env.NEXT_PUBLIC_TON_LSP_WS_URL)
];

const securityHeaders = [
  {
    key: "X-DNS-Prefetch-Control",
    value: "on"
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload"
  },
  {
    key: "X-Frame-Options",
    value: "SAMEORIGIN"
  },
  {
    key: "X-Content-Type-Options",
    value: "nosniff"
  },
  {
    key: "Referrer-Policy",
    value: "strict-origin-when-cross-origin"
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()"
  },
  {
    // CSP: allow same-origin + configured LSP endpoint.
    // 'unsafe-inline' is required by Monaco Editor for styles; can be tightened
    // once Monaco supports nonces.
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-eval' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https:",
      "font-src 'self'",
      `connect-src ${connectSrc.join(" ")}`,
      "worker-src 'self' blob:",
      "frame-ancestors 'self'"
    ].join("; ")
  }
];

const nextConfig: NextConfig = {
  transpilePackages: ["@ton-audit/shared"],
  experimental: {
    authInterrupts: true
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders
      }
    ];
  }
};

export default nextConfig;
