import { load } from "cheerio";

function htmlToText(rawHtml: string) {
  const $ = load(rawHtml);
  $("script,style,noscript").remove();
  return $("body").text().replace(/\s+/g, " ").trim();
}

function markdownToText(markdown: string) {
  return markdown
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`{1,3}/g, "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/\r?\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeDocsSourceUrl(sourceUrl: string) {
  try {
    const url = new URL(sourceUrl);
    if (url.hostname !== "github.com") {
      return sourceUrl;
    }

    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length >= 5 && parts[2] === "blob") {
      const [owner, repo, , branch, ...pathParts] = parts;
      return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathParts.join("/")}`;
    }

    return sourceUrl;
  } catch {
    return sourceUrl;
  }
}

export function toIndexableText(params: { sourceType: string; body: string }) {
  if (params.sourceType === "github") {
    return markdownToText(params.body);
  }

  return htmlToText(params.body);
}
