"use strict";

const PROVIDER_LOGO_DOMAINS = Object.freeze({
  "01-ai": "01.ai", ai21: "ai21.com", alibaba: "alibabagroup.com", allenai: "allenai.org",
  amazon: "aboutamazon.com", anthropic: "anthropic.com", arcee: "arcee.ai", "arcee-ai": "arcee.ai",
  baichuan: "baichuan-ai.com", baidu: "baidu.com", "black-forest-labs": "blackforestlabs.ai",
  bytedance: "bytedance.com", "bytedance-seed": "bytedance.com", cohere: "cohere.com",
  cognitivecomputations: "cognitivecomputations.com", databricks: "databricks.com",
  deepcogito: "deepcogito.com", deepseek: "deepseek.com", eleutherai: "eleuther.ai",
  google: "google.com", gryphe: "gryphe.com", huggingface: "huggingface.co", ibm: "ibm.com",
  inclusionai: "inclusion.ai", inflection: "inflection.ai", internlm: "internlm.org",
  liquid: "liquid.ai", meta: "meta.com", "meta-llama": "meta.com", microsoft: "microsoft.com",
  minimax: "minimax.io", minimaxai: "minimax.io", mistral: "mistral.ai", mistralai: "mistral.ai",
  moonshot: "moonshot.ai", moonshotai: "moonshot.ai", morph: "morphllm.com",
  nous: "nousresearch.com", nousresearch: "nousresearch.com", nvidia: "nvidia.com",
  openai: "openai.com", perplexity: "perplexity.ai", phind: "phind.com",
  "particle-ai": "particle.network", "prime-intellect": "primeintellect.ai", qwen: "qwen.ai",
  reka: "reka.ai", recursive: "recursive.ai", sao10k: "sao10k.com", snowflake: "snowflake.com",
  sophosympatheia: "huggingface.co", stepfun: "stepfun.com", tencent: "tencent.com",
  "the-drummer": "thedrummer.ai", thudm: "tsinghua.edu.cn", tngtech: "tngtech.com",
  undi95: "huggingface.co", upstage: "upstage.ai", writer: "writer.com", "x-ai": "x.ai",
  "z-ai": "z.ai"
});

function resolveProviderLogoDomain(slug) {
  return typeof slug === "string" ? (PROVIDER_LOGO_DOMAINS[slug.toLowerCase()] || null) : null;
}

async function serveProviderLogo(res, slug, fetchImpl = fetch) {
  const domain = resolveProviderLogoDomain(slug);
  if (!domain) return false;

  let upstream;
  try {
    upstream = await fetchImpl("https://www.google.com/s2/favicons?domain=" + encodeURIComponent(domain) + "&sz=64", {
      headers: { Accept: "image/avif,image/webp,image/png,image/*;q=0.8" },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
    res.end();
    return true;
  }

  const contentType = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!upstream.ok || !contentType.startsWith("image/")) {
    res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
    res.end();
    return true;
  }

  let bytes;
  try { bytes = Buffer.from(await upstream.arrayBuffer()); }
  catch {
    res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
    res.end();
    return true;
  }
  if (!bytes.length || bytes.length > 65536) {
    res.writeHead(502, { "Cache-Control": "public, max-age=60", "X-Content-Type-Options": "nosniff" });
    res.end();
    return true;
  }

  res.writeHead(200, {
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "cross-origin"
  });
  res.end(bytes);
  return true;
}

module.exports = { resolveProviderLogoDomain, serveProviderLogo };
