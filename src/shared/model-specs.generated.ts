/**
 * ⚠️ 自动生成（scripts/migrate-pi-ai-catalog.cjs，2026-09-28 一次性）；请勿手改。
 *
 * 数据来源：@earendil-works/pi-ai（MIT）dist/providers/data/*.json 的 openai-completions 条目。
 * 用途：
 *   ① PI_AI_MODEL_SPECS —— presetModelDefaults 在 NF 手写字面量**缺省时**补全规格（字面量优先）；
 *   ② PI_AI_PROVIDER_PRESETS —— 并入 BUILTIN_PRESETS 的新供应商（OpenAI 兼容 + key 鉴权）。
 * 刷新：node scripts/migrate-pi-ai-catalog.cjs --source <deepseek-harness 仓库根>
 */
import type { ProviderPreset } from './provider-presets'

/** provider → modelId → 规格（contextWindow/maxTokens） */
export const PI_AI_MODEL_SPECS: Record<string, Record<string, { contextWindow?: number; maxTokens?: number }>> = {
  "deepseek": {
    "deepseek-v4-flash": {
      "contextWindow": 1000000,
      "maxTokens": 384000
    },
    "deepseek-v4-flash-vision-exp": {
      "contextWindow": 1000000,
      "maxTokens": 384000
    },
    "deepseek-v4-pro": {
      "contextWindow": 1000000,
      "maxTokens": 384000
    }
  },
  "anthropic": {
    "claude-fable-5": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-fable-5-1": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-haiku-4-5": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "claude-haiku-4-5-20251001": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "claude-opus-4-5": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "claude-opus-4-5-20251101": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "claude-opus-4-6": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-opus-4-7": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-opus-4-8": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-opus-5": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-sonnet-4-5": {
      "contextWindow": 1000000,
      "maxTokens": 64000
    },
    "claude-sonnet-4-5-20250929": {
      "contextWindow": 1000000,
      "maxTokens": 64000
    },
    "claude-sonnet-4-6": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "claude-sonnet-5": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    }
  },
  "moonshot": {
    "kimi-k2-0711-preview": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "kimi-k2-0905-preview": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2-thinking": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2-thinking-turbo": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2-turbo-preview": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2.5": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2.6": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2.7-code": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k2.7-code-highspeed": {
      "contextWindow": 262144,
      "maxTokens": 262144
    },
    "kimi-k3": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    }
  },
  "bigmodel": {
    "glm-4.7": {
      "contextWindow": 204800,
      "maxTokens": 131072
    },
    "glm-5-turbo": {
      "contextWindow": 200000,
      "maxTokens": 131072
    },
    "glm-5.2": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "glm-5.2-highspeed": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "glm-5.3": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "glm-5.3-flash": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "glm-5.3-highspeed": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    }
  },
  "xiaomi": {
    "mimo-v2.5": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "mimo-v2.5-pro": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "mimo-v2.5-pro-ultraspeed": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    }
  },
  "groq": {
    "llama-3.1-8b-instant": {
      "contextWindow": 131072,
      "maxTokens": 131072
    },
    "llama-3.3-70b-versatile": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "openai/gpt-oss-120b": {
      "contextWindow": 131072,
      "maxTokens": 65536
    },
    "openai/gpt-oss-20b": {
      "contextWindow": 131072,
      "maxTokens": 65536
    },
    "openai/gpt-oss-safeguard-20b": {
      "contextWindow": 131072,
      "maxTokens": 65536
    },
    "qwen/qwen3.6-27b": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "qwen/qwen3.8-27b": {
      "contextWindow": 131042,
      "maxTokens": 16384
    }
  },
  "openrouter": {
    "aion-labs/aion-2.0": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "aion-labs/aion-3.0": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "aion-labs/aion-3.0-mini": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "amazon/nova-2-lite-v1": {
      "contextWindow": 1000000,
      "maxTokens": 65535
    },
    "amazon/nova-lite-v1": {
      "contextWindow": 300000,
      "maxTokens": 5120
    },
    "amazon/nova-micro-v1": {
      "contextWindow": 128000,
      "maxTokens": 5120
    },
    "amazon/nova-premier-v1": {
      "contextWindow": 1000000,
      "maxTokens": 32000
    },
    "amazon/nova-pro-v1": {
      "contextWindow": 300000,
      "maxTokens": 5120
    },
    "anthropic/claude-fable-5.1:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-fable-5:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-haiku-4.5:batch": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "anthropic/claude-opus-4.1:batch": {
      "contextWindow": 200000,
      "maxTokens": 32000
    },
    "anthropic/claude-opus-4.5:batch": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "anthropic/claude-opus-4.6:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-opus-4.7:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-opus-4.8:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-opus-5:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-sonnet-4.5:batch": {
      "contextWindow": 1000000,
      "maxTokens": 64000
    },
    "anthropic/claude-sonnet-4.6:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-sonnet-5:batch": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "arcee-ai/trinity-large-thinking": {
      "contextWindow": 262144,
      "maxTokens": 80000
    },
    "auto": {
      "contextWindow": 2000000,
      "maxTokens": 30000
    },
    "bytedance-seed/seed-1.6": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "bytedance-seed/seed-1.6-flash": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "bytedance-seed/seed-2-1-turbo": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "bytedance-seed/seed-2.0-code": {
      "contextWindow": 262144,
      "maxTokens": 131072
    },
    "bytedance-seed/seed-2.0-lite": {
      "contextWindow": 262144,
      "maxTokens": 131072
    },
    "bytedance-seed/seed-2.0-mini": {
      "contextWindow": 262144,
      "maxTokens": 131072
    },
    "cohere/command-r-08-2024": {
      "contextWindow": 128000,
      "maxTokens": 4000
    },
    "cohere/command-r-plus-08-2024": {
      "contextWindow": 128000,
      "maxTokens": 4000
    },
    "cohere/north-mini-code:free": {
      "contextWindow": 256000,
      "maxTokens": 64000
    },
    "deepseek/deepseek-chat": {
      "contextWindow": 163840,
      "maxTokens": 16384
    },
    "deepseek/deepseek-chat-v3-0324": {
      "contextWindow": 163840,
      "maxTokens": 147456
    },
    "deepseek/deepseek-chat-v3.1": {
      "contextWindow": 161000,
      "maxTokens": 144900
    },
    "deepseek/deepseek-r1": {
      "contextWindow": 64000,
      "maxTokens": 16000
    },
    "deepseek/deepseek-r1-0528": {
      "contextWindow": 163840,
      "maxTokens": 32768
    },
    "deepseek/deepseek-v3.1-terminus": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "deepseek/deepseek-v3.2": {
      "contextWindow": 163840,
      "maxTokens": 65536
    },
    "deepseek/deepseek-v3.2-exp": {
      "contextWindow": 163840,
      "maxTokens": 65536
    },
    "deepseek/deepseek-v4-flash": {
      "contextWindow": 1024000,
      "maxTokens": 384000
    },
    "deepseek/deepseek-v4-flash-0731": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "deepseek/deepseek-v4-flash-0731:batch": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "deepseek/deepseek-v4-flash-vision-exp": {
      "contextWindow": 1048576,
      "maxTokens": 384000
    },
    "deepseek/deepseek-v4-pro": {
      "contextWindow": 1024000,
      "maxTokens": 384000
    },
    "deepseek/deepseek-v4-pro-0813": {
      "contextWindow": 1024000,
      "maxTokens": 384000
    },
    "deepseek/deepseek-v4-pro-0813:batch": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "dots-studio/dots-3-note-preview:free": {
      "contextWindow": 512000,
      "maxTokens": 460800
    },
    "google/gemini-2.5-flash": {
      "contextWindow": 1048576,
      "maxTokens": 65535
    },
    "google/gemini-2.5-flash-lite": {
      "contextWindow": 1048576,
      "maxTokens": 65535
    },
    "google/gemini-2.5-flash-lite:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65535
    },
    "google/gemini-2.5-flash:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65535
    },
    "google/gemini-2.5-pro": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-2.5-pro-preview": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-2.5-pro-preview-05-06": {
      "contextWindow": 1048576,
      "maxTokens": 65535
    },
    "google/gemini-2.5-pro:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3-flash-preview": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3-flash-preview:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3-pro-image": {
      "contextWindow": 65536,
      "maxTokens": 32768
    },
    "google/gemini-3.1-flash-lite": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.1-flash-lite-preview": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.1-flash-lite:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.1-pro-preview": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.1-pro-preview-customtools": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.1-pro-preview:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.5-flash": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.5-flash-lite": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.5-flash-lite:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.5-flash:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.6-flash": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.6-flash:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.7-flash": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.7-flash:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.8-flash": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemini-3.8-flash:batch": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "google/gemma-3-12b-it": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "google/gemma-3-27b-it": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "google/gemma-4-26b-a4b-it": {
      "contextWindow": 262144,
      "maxTokens": 16384
    },
    "google/gemma-4-26b-a4b-it:free": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "google/gemma-4-31b-it": {
      "contextWindow": 262144,
      "maxTokens": 16384
    },
    "google/gemma-4-31b-it:batch": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "google/gemma-4-31b-it:free": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "ibm-granite/granite-4.2-8b": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "inception/mercury-2": {
      "contextWindow": 128000,
      "maxTokens": 50000
    },
    "inception/mercury-2.5-preview": {
      "contextWindow": 260000,
      "maxTokens": 65536
    },
    "inclusionai/ling-3.0-flash": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "inclusionai/ling-3.0-flash-fin": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "inclusionai/ling-3.0-flash-fin:free": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "inclusionai/ling-3.0-flash-sante:free": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "kwaipilot/kat-coder-pro-v2": {
      "contextWindow": 262144,
      "maxTokens": 144000
    },
    "kwaipilot/kat-coder-pro-v2.5": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "liquid/lfm-2.5-2.6b:free": {
      "contextWindow": 65536,
      "maxTokens": 8192
    },
    "meituan/longcat-2.0": {
      "contextWindow": 1048756,
      "maxTokens": 262144
    },
    "meta-llama/llama-3.1-70b-instruct": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "meta-llama/llama-3.1-8b-instruct": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "meta-llama/llama-3.3-70b-instruct": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "meta-llama/llama-4-maverick": {
      "contextWindow": 128000,
      "maxTokens": 115200
    },
    "meta-llama/llama-4-scout": {
      "contextWindow": 327680,
      "maxTokens": 16384
    },
    "meta/muse-glimmer-30b": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "meta/muse-glimmer-30b:batch": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "meta/muse-spark-1.1": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "meta/muse-spark-1.2": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "meta/muse-spark-1.2-contributor": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "meta/muse-spark-1.3": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "meta/muse-spark-1.3-contributor": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "minimax/minimax-m1": {
      "contextWindow": 1000000,
      "maxTokens": 40000
    },
    "minimax/minimax-m2": {
      "contextWindow": 204800,
      "maxTokens": 131072
    },
    "minimax/minimax-m2.1": {
      "contextWindow": 204800,
      "maxTokens": 131072
    },
    "minimax/minimax-m2.5": {
      "contextWindow": 200000,
      "maxTokens": 128000
    },
    "minimax/minimax-m2.7": {
      "contextWindow": 204800,
      "maxTokens": 131072
    },
    "minimax/minimax-m2.7:free": {
      "contextWindow": 196608,
      "maxTokens": 176947
    },
    "minimax/minimax-m3": {
      "contextWindow": 524288,
      "maxTokens": 512000
    },
    "minimax/minimax-m3:batch": {
      "contextWindow": 524288,
      "maxTokens": 471859
    },
    "minimax/minimax-m3:free": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "mistralai/codestral-2508": {
      "contextWindow": 256000,
      "maxTokens": 204800
    },
    "mistralai/devstral-2512": {
      "contextWindow": 262144,
      "maxTokens": 209715
    },
    "mistralai/ministral-14b-2512": {
      "contextWindow": 262144,
      "maxTokens": 209715
    },
    "mistralai/ministral-3b-2512": {
      "contextWindow": 131072,
      "maxTokens": 104857
    },
    "mistralai/ministral-8b-2512": {
      "contextWindow": 262144,
      "maxTokens": 209715
    },
    "mistralai/mistral-large": {
      "contextWindow": 128000,
      "maxTokens": 102400
    },
    "mistralai/mistral-large-2407": {
      "contextWindow": 131072,
      "maxTokens": 104857
    },
    "mistralai/mistral-large-2512": {
      "contextWindow": 262144,
      "maxTokens": 209715
    },
    "mistralai/mistral-medium-3": {
      "contextWindow": 131072,
      "maxTokens": 104857
    },
    "mistralai/mistral-medium-3-5": {
      "contextWindow": 262144,
      "maxTokens": 209715
    },
    "mistralai/mistral-medium-3-5:batch": {
      "contextWindow": 32768,
      "maxTokens": 26214
    },
    "mistralai/mistral-medium-3.1": {
      "contextWindow": 131072,
      "maxTokens": 104857
    },
    "mistralai/mistral-nemo": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "mistralai/mistral-saba": {
      "contextWindow": 32768,
      "maxTokens": 26214
    },
    "mistralai/mistral-small-2603": {
      "contextWindow": 262144,
      "maxTokens": 209715
    },
    "mistralai/mistral-small-3.2-24b-instruct": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "mistralai/mixtral-8x22b-instruct": {
      "contextWindow": 65536,
      "maxTokens": 52428
    },
    "mistralai/voxtral-small-24b-2507": {
      "contextWindow": 32768,
      "maxTokens": 26214
    },
    "moonshotai/kimi-k2": {
      "contextWindow": 131072,
      "maxTokens": 100352
    },
    "moonshotai/kimi-k2-0905": {
      "contextWindow": 262144,
      "maxTokens": 100352
    },
    "moonshotai/kimi-k2-thinking": {
      "contextWindow": 262144,
      "maxTokens": 100352
    },
    "moonshotai/kimi-k2.5": {
      "contextWindow": 262144,
      "maxTokens": 4096
    },
    "moonshotai/kimi-k2.6": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "moonshotai/kimi-k2.7-code": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "moonshotai/kimi-k3": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "moonshotai/kimi-k3:batch": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "nex-agi/nex-n2-mini": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "nex-agi/nex-n2-pro": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "nvidia/nemotron-3-nano-30b-a3b": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free": {
      "contextWindow": 256000,
      "maxTokens": 65536
    },
    "nvidia/nemotron-3-super-120b-a12b": {
      "contextWindow": 262144,
      "maxTokens": 16384
    },
    "nvidia/nemotron-3-super-120b-a12b:free": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "nvidia/nemotron-3-ultra-550b-a55b": {
      "contextWindow": 256000,
      "maxTokens": 32768
    },
    "nvidia/nemotron-3-ultra-550b-a55b:free": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "nvidia/nemotron-3.5-lightning": {
      "contextWindow": 262144,
      "maxTokens": 131072
    },
    "nvidia/nemotron-3.5-lightning:free": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "openai/gpt-3.5-turbo": {
      "contextWindow": 16385,
      "maxTokens": 4096
    },
    "openai/gpt-3.5-turbo-0613": {
      "contextWindow": 4095,
      "maxTokens": 3685
    },
    "openai/gpt-3.5-turbo-16k": {
      "contextWindow": 16385,
      "maxTokens": 4096
    },
    "openai/gpt-3.5-turbo:batch": {
      "contextWindow": 16385,
      "maxTokens": 4096
    },
    "openai/gpt-4": {
      "contextWindow": 8191,
      "maxTokens": 4096
    },
    "openai/gpt-4-turbo": {
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    "openai/gpt-4-turbo-preview": {
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    "openai/gpt-4-turbo:batch": {
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    "openai/gpt-4.1": {
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    "openai/gpt-4.1-mini": {
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    "openai/gpt-4.1-mini:batch": {
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    "openai/gpt-4.1-nano": {
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    "openai/gpt-4.1-nano:batch": {
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    "openai/gpt-4.1:batch": {
      "contextWindow": 1047576,
      "maxTokens": 32768
    },
    "openai/gpt-4o": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-4o-2024-05-13": {
      "contextWindow": 128000,
      "maxTokens": 4096
    },
    "openai/gpt-4o-2024-08-06": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-4o-2024-11-20": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-4o-mini": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-4o-mini-2024-07-18": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-4o-mini:batch": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-4o:batch": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-5": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5-mini": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5-mini:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5-nano": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5-nano:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5-pro": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5-pro:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.1": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.1-codex": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.1-codex-max": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.1-codex-mini": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.1:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.2": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.2-chat": {
      "contextWindow": 128000,
      "maxTokens": 32000
    },
    "openai/gpt-5.2-codex": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.2-pro": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.2-pro:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.2:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.3-codex": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4-mini": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4-mini:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4-nano": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4-nano:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4-pro": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4-pro:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.4:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.5": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.5-pro": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.5-pro:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.5:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-luna": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-luna-pro": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-luna-pro:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-luna:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-sol": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-sol-pro": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-sol-pro:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-sol:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-terra": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-terra-pro": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-terra-pro:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5.6-terra:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-5:batch": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-6-astra": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-6-astra-pro": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-6-astra-pro:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-6-astra:batch": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "openai/gpt-audio": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-audio-mini": {
      "contextWindow": 128000,
      "maxTokens": 16384
    },
    "openai/gpt-chat-latest": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "openai/gpt-oss-120b": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "openai/gpt-oss-120b:batch": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "openai/gpt-oss-20b": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "openai/gpt-oss-safeguard-20b": {
      "contextWindow": 131072,
      "maxTokens": 65536
    },
    "openai/o1": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o3": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o3-mini": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o3-mini-high": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o3-mini:batch": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o3-pro": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o3:batch": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o4-mini": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o4-mini-high": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openai/o4-mini:batch": {
      "contextWindow": 200000,
      "maxTokens": 100000
    },
    "openrouter/auto": {
      "contextWindow": 2000000,
      "maxTokens": 4096
    },
    "openrouter/auto-beta": {
      "contextWindow": 2000000,
      "maxTokens": 4096
    },
    "openrouter/free": {
      "contextWindow": 200000,
      "maxTokens": 4096
    },
    "openrouter/fusion": {
      "contextWindow": 1000000,
      "maxTokens": 30000
    },
    "poolside/laguna-s-2.1": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "poolside/laguna-s-2.1:free": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "poolside/laguna-xs-2.1": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "poolside/laguna-xs-2.1:free": {
      "contextWindow": 262144,
      "maxTokens": 32768
    },
    "qwen/qwen-2.5-72b-instruct": {
      "contextWindow": 32768,
      "maxTokens": 16384
    },
    "qwen/qwen-2.5-7b-instruct": {
      "contextWindow": 32768,
      "maxTokens": 29491
    },
    "qwen/qwen-plus": {
      "contextWindow": 1000000,
      "maxTokens": 32768
    },
    "qwen/qwen-plus-2025-07-28": {
      "contextWindow": 1000000,
      "maxTokens": 32768
    },
    "qwen/qwen3-14b": {
      "contextWindow": 40960,
      "maxTokens": 16384
    },
    "qwen/qwen3-235b-a22b": {
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    "qwen/qwen3-235b-a22b-2507": {
      "contextWindow": 262144,
      "maxTokens": 16384
    },
    "qwen/qwen3-235b-a22b-thinking-2507": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "qwen/qwen3-30b-a3b": {
      "contextWindow": 40960,
      "maxTokens": 16384
    },
    "qwen/qwen3-30b-a3b-instruct-2507": {
      "contextWindow": 128000,
      "maxTokens": 32000
    },
    "qwen/qwen3-30b-a3b-thinking-2507": {
      "contextWindow": 81920,
      "maxTokens": 32768
    },
    "qwen/qwen3-32b": {
      "contextWindow": 40960,
      "maxTokens": 16384
    },
    "qwen/qwen3-8b": {
      "contextWindow": 131072,
      "maxTokens": 8192
    },
    "qwen/qwen3-coder": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "qwen/qwen3-coder-30b-a3b-instruct": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3-coder-flash": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3-coder-next": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3-coder-plus": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3-max": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "qwen/qwen3-max-thinking": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "qwen/qwen3-next-80b-a3b-instruct": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3-next-80b-a3b-thinking": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3-vl-235b-a22b-instruct": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3-vl-235b-a22b-thinking": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3-vl-30b-a3b-instruct": {
      "contextWindow": 262144,
      "maxTokens": 16384
    },
    "qwen/qwen3-vl-30b-a3b-thinking": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3-vl-32b-instruct": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3-vl-8b-instruct": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3-vl-8b-thinking": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "qwen/qwen3.5-122b-a10b": {
      "contextWindow": 262144,
      "maxTokens": 81920
    },
    "qwen/qwen3.5-27b": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "qwen/qwen3.5-35b-a3b": {
      "contextWindow": 262144,
      "maxTokens": 16384
    },
    "qwen/qwen3.5-397b-a17b": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3.5-9b": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3.5-9b:batch": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3.5-flash-02-23": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3.5-plus-02-15": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3.5-plus-20260420": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3.6-27b": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "qwen/qwen3.6-35b-a3b": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "qwen/qwen3.6-flash": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3.6-max-preview": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "qwen/qwen3.6-plus": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3.7-flash": {
      "contextWindow": 1000000,
      "maxTokens": 65536
    },
    "qwen/qwen3.7-max": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "qwen/qwen3.7-plus": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "qwen/qwen3.8-2.4t-a95b": {
      "contextWindow": 1000000,
      "maxTokens": 262144
    },
    "qwen/qwen3.8-2.4t-a95b:batch": {
      "contextWindow": 1010000,
      "maxTokens": 909000
    },
    "qwen/qwen3.8-27b": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "qwen/qwen3.8-flash": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "qwen/qwen3.8-max-0902": {
      "contextWindow": 1000000,
      "maxTokens": 131072
    },
    "rekaai/reka-edge": {
      "contextWindow": 16384,
      "maxTokens": 14745
    },
    "relace/relace-search": {
      "contextWindow": 256000,
      "maxTokens": 128000
    },
    "sakana/fugu-ultra": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "sakana/sakana-namazu": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "sao10k/l3.1-euryale-70b": {
      "contextWindow": 131072,
      "maxTokens": 16384
    },
    "stepfun/step-3.5-flash": {
      "contextWindow": 262144,
      "maxTokens": 65536
    },
    "stepfun/step-3.7-flash": {
      "contextWindow": 256000,
      "maxTokens": 230400
    },
    "tencent/hy3": {
      "contextWindow": 262144,
      "maxTokens": 128000
    },
    "tencent/hy3-preview": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "tencent/hy4-preview": {
      "contextWindow": 1048576,
      "maxTokens": 64000
    },
    "thedrummer/unslopnemo-12b": {
      "contextWindow": 32768,
      "maxTokens": 26214
    },
    "thinkingmachines/inkling": {
      "contextWindow": 524288,
      "maxTokens": 471859
    },
    "thinkingmachines/inkling-small": {
      "contextWindow": 524288,
      "maxTokens": 262144
    },
    "thinkingmachines/inkling-small:batch": {
      "contextWindow": 524288,
      "maxTokens": 471859
    },
    "thinkingmachines/inkling-small:free": {
      "contextWindow": 1048576,
      "maxTokens": 262144
    },
    "thinkingmachines/inkling:batch": {
      "contextWindow": 524288,
      "maxTokens": 471859
    },
    "thinkingmachines/inkling:free": {
      "contextWindow": 1048576,
      "maxTokens": 262144
    },
    "upstage/solar-pro-3": {
      "contextWindow": 131072,
      "maxTokens": 117964
    },
    "upstage/solar-pro4": {
      "contextWindow": 524288,
      "maxTokens": 131072
    },
    "x-ai/grok-4.20": {
      "contextWindow": 2000000,
      "maxTokens": 1800000
    },
    "x-ai/grok-4.3": {
      "contextWindow": 1000000,
      "maxTokens": 900000
    },
    "x-ai/grok-4.3:batch": {
      "contextWindow": 1000000,
      "maxTokens": 900000
    },
    "x-ai/grok-4.5": {
      "contextWindow": 500000,
      "maxTokens": 450000
    },
    "x-ai/grok-4.6": {
      "contextWindow": 500000,
      "maxTokens": 450000
    },
    "x-ai/grok-build-0.1": {
      "contextWindow": 256000,
      "maxTokens": 230400
    },
    "xiaomi/mimo-v2.5": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "xiaomi/mimo-v2.5-pro": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "z-ai/glm-4.5": {
      "contextWindow": 131072,
      "maxTokens": 98304
    },
    "z-ai/glm-4.5-air": {
      "contextWindow": 131072,
      "maxTokens": 98304
    },
    "z-ai/glm-4.5v": {
      "contextWindow": 65536,
      "maxTokens": 16384
    },
    "z-ai/glm-4.6": {
      "contextWindow": 204800,
      "maxTokens": 131072
    },
    "z-ai/glm-4.6v": {
      "contextWindow": 131072,
      "maxTokens": 32768
    },
    "z-ai/glm-4.7": {
      "contextWindow": 202752,
      "maxTokens": 131072
    },
    "z-ai/glm-4.7-flash": {
      "contextWindow": 202752,
      "maxTokens": 16384
    },
    "z-ai/glm-5": {
      "contextWindow": 198000,
      "maxTokens": 128000
    },
    "z-ai/glm-5-turbo": {
      "contextWindow": 202752,
      "maxTokens": 131072
    },
    "z-ai/glm-5.1": {
      "contextWindow": 200000,
      "maxTokens": 128000
    },
    "z-ai/glm-5.2": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "z-ai/glm-5.2:free": {
      "contextWindow": 256000,
      "maxTokens": 230400
    },
    "z-ai/glm-5.3": {
      "contextWindow": 1048576,
      "maxTokens": 262144
    },
    "z-ai/glm-5.3-flash": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "z-ai/glm-5.3-flash:batch": {
      "contextWindow": 1048575,
      "maxTokens": 943717
    },
    "z-ai/glm-5v-turbo": {
      "contextWindow": 202752,
      "maxTokens": 131072
    },
    "~anthropic/claude-fable-latest": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "~anthropic/claude-haiku-latest": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "~anthropic/claude-opus-latest": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "~anthropic/claude-sonnet-latest": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "~deepseek/deepseek-v4-flash-latest": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "~google/gemini-flash-latest": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "~google/gemini-pro-latest": {
      "contextWindow": 1048576,
      "maxTokens": 65536
    },
    "~moonshotai/kimi-latest": {
      "contextWindow": 1048576,
      "maxTokens": 131072
    },
    "~openai/gpt-latest": {
      "contextWindow": 1050000,
      "maxTokens": 128000
    },
    "~openai/gpt-mini-latest": {
      "contextWindow": 400000,
      "maxTokens": 128000
    },
    "~x-ai/grok-latest": {
      "contextWindow": 500000,
      "maxTokens": 450000
    },
    "~z-ai/glm-flash-latest": {
      "contextWindow": 1048576,
      "maxTokens": 943718
    },
    "~z-ai/glm-latest": {
      "contextWindow": 262144,
      "maxTokens": 235929
    },
    "anthropic/claude-3-haiku": {
      "contextWindow": 200000,
      "maxTokens": 4096
    },
    "anthropic/claude-fable-5": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-fable-5.1": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-haiku-4.5": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "anthropic/claude-opus-4": {
      "contextWindow": 200000,
      "maxTokens": 32000
    },
    "anthropic/claude-opus-4.1": {
      "contextWindow": 200000,
      "maxTokens": 32000
    },
    "anthropic/claude-opus-4.5": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "anthropic/claude-opus-4.6": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-opus-4.7": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-opus-4.8": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-opus-5": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-sonnet-4": {
      "contextWindow": 200000,
      "maxTokens": 64000
    },
    "anthropic/claude-sonnet-4.5": {
      "contextWindow": 1000000,
      "maxTokens": 64000
    },
    "anthropic/claude-sonnet-4.6": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    },
    "anthropic/claude-sonnet-5": {
      "contextWindow": 1000000,
      "maxTokens": 128000
    }
  }
}

/** 新增供应商（并入 BUILTIN_PRESETS） */
export const PI_AI_PROVIDER_PRESETS: ProviderPreset[] = [
  {
    "provider": "minimax-cn",
    "displayName": "MiniMax",
    "baseUrl": "https://api.minimaxi.com/anthropic",
    "protocol": "anthropic",
    "models": [
      {
        "name": "MiniMax-M2.7",
        "maxTokens": 131072,
        "contextWindow": 204800
      },
      {
        "name": "MiniMax-M2.7-highspeed",
        "maxTokens": 131072,
        "contextWindow": 204800
      },
      {
        "name": "MiniMax-M3",
        "maxTokens": 512000,
        "contextWindow": 1048576
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "zai-coding-cn",
    "displayName": "智谱（编程套餐）",
    "baseUrl": "https://open.bigmodel.cn/api/coding/paas/v4",
    "protocol": "openai",
    "models": [
      {
        "name": "glm-4.6v",
        "maxTokens": 32768,
        "contextWindow": 128000
      },
      {
        "name": "glm-4.7",
        "maxTokens": 131072,
        "contextWindow": 204800
      },
      {
        "name": "glm-5-turbo",
        "maxTokens": 131072,
        "contextWindow": 200000
      },
      {
        "name": "glm-5.1",
        "maxTokens": 131072,
        "contextWindow": 200000
      },
      {
        "name": "glm-5.2",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "glm-5.2-highspeed",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "glm-5.3",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "glm-5.3-flash",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "glm-5.3-highspeed",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "glm-5v-turbo",
        "maxTokens": 131072,
        "contextWindow": 200000
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "kimi-coding",
    "displayName": "Kimi（编程套餐）",
    "baseUrl": "https://api.kimi.com/coding",
    "protocol": "anthropic",
    "models": [
      {
        "name": "k3",
        "maxTokens": 131072,
        "contextWindow": 1048576
      },
      {
        "name": "k3-256k",
        "maxTokens": 131072,
        "contextWindow": 262144
      },
      {
        "name": "kimi-for-coding",
        "maxTokens": 32768,
        "contextWindow": 262144
      },
      {
        "name": "kimi-for-coding-highspeed",
        "maxTokens": 32768,
        "contextWindow": 262144
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "qwen-token-plan-cn",
    "displayName": "通义千问（Token 套餐）",
    "baseUrl": "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    "protocol": "openai",
    "models": [
      {
        "name": "MiniMax-M2.5",
        "maxTokens": 32768,
        "contextWindow": 196608
      },
      {
        "name": "deepseek-v3.2",
        "maxTokens": 65536,
        "contextWindow": 131072
      },
      {
        "name": "deepseek-v4-flash",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "deepseek-v4-flash-0731",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "deepseek-v4-pro",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "deepseek-v4-pro-0813",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "glm-5",
        "maxTokens": 16384,
        "contextWindow": 202752
      },
      {
        "name": "glm-5.1",
        "maxTokens": 128000,
        "contextWindow": 202752
      },
      {
        "name": "glm-5.2",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "kimi-k2.5",
        "maxTokens": 98304,
        "contextWindow": 262144
      },
      {
        "name": "kimi-k2.6",
        "maxTokens": 262144
      },
      {
        "name": "kimi-k2.7-code",
        "maxTokens": 262144
      },
      {
        "name": "qwen3.6-flash",
        "maxTokens": 65536,
        "contextWindow": 1000000
      },
      {
        "name": "qwen3.6-plus",
        "maxTokens": 65536,
        "contextWindow": 1000000
      },
      {
        "name": "qwen3.7-max",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "qwen3.7-plus",
        "maxTokens": 65536,
        "contextWindow": 1000000
      },
      {
        "name": "qwen3.8-flash",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "qwen3.8-max",
        "maxTokens": 131072,
        "contextWindow": 1000000
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "xiaomi-token-plan-cn",
    "displayName": "小米 MiMo（订阅套餐）",
    "baseUrl": "https://token-plan-cn.xiaomimimo.com/v1",
    "protocol": "openai",
    "models": [
      {
        "name": "mimo-v2.5",
        "maxTokens": 131072,
        "contextWindow": 1048576
      },
      {
        "name": "mimo-v2.5-pro",
        "maxTokens": 131072,
        "contextWindow": 1048576
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "cerebras",
    "displayName": "Cerebras",
    "baseUrl": "https://api.cerebras.ai/v1",
    "protocol": "openai",
    "models": [
      {
        "name": "gemma-4-31b",
        "maxTokens": 40960,
        "contextWindow": 131072
      },
      {
        "name": "gpt-oss-120b",
        "maxTokens": 40960,
        "contextWindow": 131072
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "together",
    "displayName": "Together AI",
    "baseUrl": "https://api.together.ai/v1",
    "protocol": "openai",
    "models": [
      {
        "name": "MiniMaxAI/MiniMax-M2.7",
        "maxTokens": 131072,
        "contextWindow": 202752
      },
      {
        "name": "MiniMaxAI/MiniMax-M3",
        "maxTokens": 250000,
        "contextWindow": 524288
      },
      {
        "name": "Qwen/Qwen2.5-7B-Instruct-Turbo",
        "maxTokens": 32768
      },
      {
        "name": "Qwen/Qwen3.5-9B",
        "maxTokens": 65536,
        "contextWindow": 262144
      },
      {
        "name": "Qwen/Qwen3.6-Plus",
        "maxTokens": 500000,
        "contextWindow": 1000000
      },
      {
        "name": "Qwen/Qwen3.7-Max",
        "maxTokens": 500000,
        "contextWindow": 1000000
      },
      {
        "name": "deepseek-ai/DeepSeek-V4-Flash-0731",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "deepseek-ai/DeepSeek-V4-Pro",
        "maxTokens": 384000,
        "contextWindow": 512000
      },
      {
        "name": "deepseek-ai/DeepSeek-V4-Pro-0813",
        "maxTokens": 384000,
        "contextWindow": 1048576
      },
      {
        "name": "google/gemma-4-31B-it",
        "maxTokens": 131072,
        "contextWindow": 262144
      },
      {
        "name": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
        "maxTokens": 131072
      },
      {
        "name": "moonshotai/Kimi-K2.6",
        "maxTokens": 131000,
        "contextWindow": 262144
      },
      {
        "name": "moonshotai/Kimi-K2.7-Code",
        "maxTokens": 131072,
        "contextWindow": 262144
      },
      {
        "name": "moonshotai/Kimi-K3",
        "maxTokens": 131072,
        "contextWindow": 1048576
      },
      {
        "name": "nvidia/nemotron-3-ultra-550b-a55b",
        "maxTokens": 512300
      },
      {
        "name": "openai/gpt-oss-120b",
        "maxTokens": 131072
      },
      {
        "name": "openai/gpt-oss-20b",
        "maxTokens": 131072
      },
      {
        "name": "thinkingmachines/Inkling",
        "maxTokens": 131072,
        "contextWindow": 524288
      },
      {
        "name": "zai-org/GLM-5.2",
        "maxTokens": 164000,
        "contextWindow": 512000
      },
      {
        "name": "zai-org/GLM-5.3",
        "maxTokens": 262144,
        "contextWindow": 1048576
      },
      {
        "name": "zai-org/GLM-5.3-Flash",
        "maxTokens": 400000,
        "contextWindow": 1048575
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "fireworks",
    "displayName": "Fireworks AI",
    "baseUrl": "https://api.fireworks.ai/inference/v1",
    "protocol": "openai",
    "models": [
      {
        "name": "accounts/fireworks/models/glm-5p2",
        "maxTokens": 131072,
        "contextWindow": 1048575
      },
      {
        "name": "accounts/fireworks/models/glm-5p3",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "accounts/fireworks/models/glm-5p3-flash",
        "maxTokens": 131072,
        "contextWindow": 1000000
      },
      {
        "name": "accounts/fireworks/models/kimi-k3",
        "maxTokens": 131072,
        "contextWindow": 1048576
      },
      {
        "name": "accounts/fireworks/routers/glm-5p2-fast",
        "maxTokens": 131072,
        "contextWindow": 1048575
      },
      {
        "name": "accounts/fireworks/routers/kimi-k3-fast",
        "maxTokens": 131072,
        "contextWindow": 1048576
      }
    ],
    "embeddingModels": []
  },
  {
    "provider": "nvidia",
    "displayName": "NVIDIA NIM",
    "baseUrl": "https://integrate.api.nvidia.com/v1",
    "protocol": "openai",
    "models": [
      {
        "name": "deepseek-ai/deepseek-v4-flash-0731",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "deepseek-ai/deepseek-v4-pro-0813",
        "maxTokens": 384000,
        "contextWindow": 1000000
      },
      {
        "name": "google/gemma-3-12b-it",
        "maxTokens": 16384,
        "contextWindow": 131072
      },
      {
        "name": "google/gemma-3-4b-it",
        "maxTokens": 16384,
        "contextWindow": 131072
      },
      {
        "name": "meta/llama-3.2-11b-vision-instruct",
        "maxTokens": 4096,
        "contextWindow": 128000
      },
      {
        "name": "meta/llama-3.2-90b-vision-instruct",
        "maxTokens": 8192,
        "contextWindow": 128000
      },
      {
        "name": "meta/muse-glimmer-30b",
        "maxTokens": 131072
      },
      {
        "name": "minimaxai/minimax-m3",
        "maxTokens": 16384,
        "contextWindow": 1000000
      },
      {
        "name": "mistralai/mistral-7b-instruct-v0.3",
        "maxTokens": 65536
      },
      {
        "name": "moonshotai/kimi-k2.6",
        "maxTokens": 262144
      },
      {
        "name": "moonshotai/kimi-k3",
        "maxTokens": 131072,
        "contextWindow": 1048576
      },
      {
        "name": "nvidia/cosmos-reason2-8b",
        "maxTokens": 16384,
        "contextWindow": 131072
      },
      {
        "name": "nvidia/llama-3.1-nemotron-70b-instruct",
        "maxTokens": 8192,
        "contextWindow": 128000
      },
      {
        "name": "nvidia/llama-3.1-nemotron-ultra-253b-v1",
        "maxTokens": 16384,
        "contextWindow": 128000
      },
      {
        "name": "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
        "maxTokens": 65536,
        "contextWindow": 256000
      },
      {
        "name": "nvidia/nemotron-3-super-120b-a12b",
        "maxTokens": 262144
      },
      {
        "name": "nvidia/nemotron-3-ultra-550b-a55b",
        "maxTokens": 65536,
        "contextWindow": 1000000
      },
      {
        "name": "nvidia/nemotron-3.5-lightning-30b-a3b",
        "maxTokens": 262144
      },
      {
        "name": "openai/gpt-oss-20b",
        "maxTokens": 32768,
        "contextWindow": 131072
      },
      {
        "name": "poolside/laguna-xs-2.1",
        "maxTokens": 16384,
        "contextWindow": 262144
      }
    ],
    "embeddingModels": []
  }
]
