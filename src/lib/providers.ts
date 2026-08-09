export interface ProviderInfo {
  id: string
  name: string
}

/** Common LLM API provider base URLs used across the app */
export const COMMON_PROVIDERS: ProviderInfo[] = [
  // ==================== 国际服务商 ====================
  { id: 'https://api.openai.com/v1', name: 'OpenAI' },
  { id: 'https://api.groq.com/openai/v1', name: 'Groq' },
  { id: 'https://api.mistral.ai/v1', name: 'Mistral' },
  { id: 'https://api.x.ai/v1', name: 'xAI (Grok)' },
  { id: 'https://api.together.xyz/v1', name: 'Together AI' },
  { id: 'https://api.fireworks.ai/inference/v1', name: 'Fireworks AI' },
  { id: 'https://api.cerebras.ai/v1', name: 'Cerebras' },
  { id: 'https://api.aimlapi.com/v1', name: 'AIML' },
  { id: 'https://api.venice.ai/api/v1', name: 'Venice AI' },
  { id: 'https://api.langdock.com/openai/us/v1', name: 'Langdock' },
  { id: 'https://models.github.ai/inference', name: 'GitHub Models' },
  { id: 'https://openrouter.ai/api/v1', name: 'OpenRouter' },
  { id: 'https://ai-gateway.vercel.sh/v1', name: 'Vercel AI Gateway' },

  // ==================== 国内服务商 ====================
  { id: 'https://api.deepseek.com/v1', name: 'DeepSeek' },
  { id: 'https://api.moonshot.cn/v1', name: 'Moonshot (月之暗面)' },
  { id: 'https://api.minimaxi.com/v1', name: 'MiniMax' },
  { id: 'https://api.siliconflow.cn/v1', name: '硅基流动 (SiliconFlow)' },
  { id: 'https://api.lingyiwanwu.com/v1', name: '零一万物 (01.AI)' },
  { id: 'https://api.stepfun.com/v1', name: '阶跃星辰 (StepFun)' },
  { id: 'https://open.bigmodel.cn/api/paas/v4', name: '智谱AI (ChatGLM)' },
  { id: 'https://dashscope.aliyuncs.com/compatible-mode/v1', name: '阿里云百炼 (通义千问) - 国内' },
  { id: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', name: '阿里云百炼 (通义千问) - 新加坡' },
  { id: 'https://dashscope-us.aliyuncs.com/compatible-mode/v1', name: '阿里云百炼 (通义千问) - 美国' },
  { id: 'https://coding.dashscope.aliyuncs.com/v1', name: '阿里云百炼 Coding Plan' },
  { id: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', name: '阿里云百炼 Token Plan' },
  { id: 'https://spark-api-open.xf-yun.com/v1', name: '讯飞星火 (Spark) V1' },
  { id: 'https://spark-api-open.xf-yun.com/x2', name: '讯飞星火 (Spark) X2' },
  { id: 'https://ark.cn-beijing.volces.com/api/v3', name: '火山方舟 (豆包)' },
  { id: 'https://api.hunyuan.cloud.tencent.com/v1', name: '腾讯混元' },
  { id: 'https://qianfan.baidubce.com/v2', name: '百度千帆 (文心一言)' },

  // ==================== 云平台聚合服务 ====================
  { id: 'https://api.modelarts-maas.com/openai/v1', name: '华为云 MaaS' },
  { id: 'https://api-ap-southeast-1.modelarts-maas.com/openai/v1', name: '华为云 MaaS (亚太)' },
  { id: 'https://models.inference.ai.azure.com', name: 'Azure AI Models' },

  // ==================== 本地/自托管 ====================
  { id: 'http://localhost:4000', name: 'LiteLLM (本地)' },
  { id: 'http://localhost:8000/v1', name: 'vLLM (本地)' },
  { id: 'http://localhost:8080', name: 'LocalAI (本地)' },
  { id: 'http://localhost:5000/v1', name: 'Ollama (本地)' },
]
