import { Job } from "bullmq";

import {
  docsSources,
  topLevelDocsPrefixes,
  type JobPayloadMap
} from "@ton-audit/shared";

import { db } from "../db";
import { recordJobEvent } from "../job-events";
import { normalizeDocsSourceUrl } from "./docs-sources";
import type { EnqueueJob } from "./types";

const additionalSources = [
  "https://raw.githubusercontent.com/ton-org/blueprint/develop/README.md",
  "https://raw.githubusercontent.com/ton-org/create-ton/main/README.md"
];

function extractSitemapUrls(xml: string) {
  const matches = [...xml.matchAll(/<loc>(.*?)<\/loc>/g)];
  return matches.map((match) => match[1]?.trim() ?? "").filter(Boolean);
}

function isAllowedTonDocsUrl(url: URL) {
  if (url.hostname !== "docs.ton.org") {
    return false;
  }

  return topLevelDocsPrefixes.some((prefix) => url.pathname.startsWith(prefix));
}

export function createDocsCrawlProcessor(deps: { enqueueJob: EnqueueJob }) {
  return async function docsCrawl(job: Job<JobPayloadMap["docs-crawl"]>) {
    await recordJobEvent({
      queue: "docs-crawl",
      jobId: String(job.id),
      event: "started",
      payload: { data: job.data }
    });

    const response = await fetch(job.data.seedSitemapUrl);
    if (!response.ok) {
      throw new Error(`Unable to fetch sitemap: ${response.status}`);
    }

    const sitemap = await response.text();
    const discovered = extractSitemapUrls(sitemap);

    const filtered = discovered.filter((urlString) => {
      try {
        return isAllowedTonDocsUrl(new URL(urlString));
      } catch {
        return false;
      }
    });

    const sourceUrls = [...new Set([...filtered, ...additionalSources].map(normalizeDocsSourceUrl))];
    let queued = 0;

    for (const sourceUrl of sourceUrls) {
      const [source] = await db
        .insert(docsSources)
        .values({
          sourceUrl,
          sourceType:
            sourceUrl.includes("github.com") || sourceUrl.includes("raw.githubusercontent.com")
              ? "github"
              : "web",
          checksum: "pending",
          title: null
        })
        .onConflictDoUpdate({
          target: [docsSources.sourceUrl],
          set: {
            updatedAt: new Date()
          }
        })
        .returning({ id: docsSources.id });

      if (!source) {
        continue;
      }

      queued += 1;
      await deps.enqueueJob("docs-index", { sourceId: source.id }, `docs-index:${source.id}`);
    }

    await recordJobEvent({
      queue: "docs-crawl",
      jobId: String(job.id),
      event: "completed",
      payload: {
        discovered: sourceUrls.length,
        queued
      }
    });

    return { discovered: sourceUrls.length, queued };
  };
}
