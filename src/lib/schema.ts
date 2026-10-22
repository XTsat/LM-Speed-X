import { z } from 'zod';
import { normalizeApiBaseUrl } from '@/lib/api-path';

/**
 * baseUrl 字段按「自动补全 API 地址」开关校验：关闭时只做 trim，
 * 因此用户必须自己填完整 URL（不再替他补协议、剥离端点）。
 */
const apiBaseUrlField = (autoCompleteBaseUrl: boolean) =>
  z
    .string()
    .transform((v) => normalizeApiBaseUrl(v, autoCompleteBaseUrl))
    .pipe(z.string().url('Please enter a valid URL'));

export function makeSpeedTestSchema(autoCompleteBaseUrl = true) {
  return z.object({
    baseUrl: apiBaseUrlField(autoCompleteBaseUrl),
    apiKey: z.string().min(1, 'API Key is required'),
    modelId: z.string().min(1, 'Model ID is required'),
    // 测试次数，必须为正整数且不超过 100 次
    count: z.number()
      .int('Count must be an integer')
      .positive('Count must be a positive number')
      .max(20, 'Maximum count is 20')
      .optional(),
    // 自定义请求头（用于绕过 CF 等验证）
    customHeaders: z.record(z.string(), z.string()).optional(),
  });
}

export function makeModelSchema(autoCompleteBaseUrl = true) {
  return z.object({
    baseUrl: apiBaseUrlField(autoCompleteBaseUrl),
    apiKey: z.string().min(1, 'API Key is required'),
  });
}

export const speedTestSchema = makeSpeedTestSchema();
export const modelSchema = makeModelSchema();

export type SpeedTestInput = z.infer<typeof speedTestSchema>;
