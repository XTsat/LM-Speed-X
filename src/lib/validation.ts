/**
 * Shared model authenticity validation challenges.
 * Pure logic — safe to import from both server routes and client components.
 */

/** Validation challenge definitions */
export const VALIDATION_CHALLENGES = {
  repeat: {
    prompt: 'Reply with exactly the word "PONG" and nothing else. Do not add any other text.',
    validate: (content: string) => {
      const cleaned = content.trim().toLowerCase()
      return cleaned.includes('pong') && cleaned.length <= 10
    },
  },
  self: {
    prompt: 'State your exact model name and nothing else. Do not add explanations.',
    validate: (content: string) => {
      const lower = content.trim().toLowerCase()
      if (lower.length < 3) return false
      const errorSignals = ['error', 'overloaded', 'unavailable', 'try again', 'rate limit', 'quota', 'billing']
      if (errorSignals.some((s) => lower.includes(s))) return false
      const genericTemplates = [
        'how can i assist', 'how may i help', 'i am an ai assistant',
        'i am a large language model', 'i am here to help', 'what can i help you with',
      ]
      if (genericTemplates.some((s) => lower.includes(s))) return false
      return true
    },
  },
  math: {
    prompt: 'Calculate 173 + 289. Reply with only the number, no explanation.',
    validate: (content: string) => {
      const cleaned = content.trim().replace(/[^\d]/g, '')
      return cleaned === '462'
    },
  },
  vision: {
    prompt: 'What color is the circle in this image? Reply with one word only.',
    imageUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAS1SURBVHhe7Z2rUxxBEIf5S3A4HA6HwyFxOBwOh8OhcDgcDofDIXE4HEkqIa8iIQl5kspjU9+lrnKZ4+6657Hbu9u/qp+hCmZ3v53pnp6ZZa5ymdJc+ANXs3IgxuRAjMmBGJMDMSYHYkwOxJgciDE5EGNqLZBvFxfV1/Pzqf59fx/+mnmZB8JD/Xx6Wt3u7VUv1terp8vL1dX8vNhPlpYGv/d2d7f6dHJS/by5CZswJZNAflxfV7f7+9XztbWxB5zD16urA0D3l5dh043LDJBfd3fVh6OjwcMKH2BJP1tZqd4dHJjpOY0DYUh6f3hYPV5cHHtYdfrRwsKgV/JiNKlGgTCma2NCaRNzeEGaUiNAyIDqHpq05kUhmahbtQJhnCbjCW/esnlxvl9dhbdSTLUBIaOxNjxJTXz7cnYW3lIR1QKErk/QDG+0ba4jthQHwk2EN9Zmv9nZKVoBKAaEi77Z3h67oS6YOFgqPS4CBBhtC95aEw9LTCaLAHm9tTV2A100pZ3cw1d2IJQhwgvvsnn5ciorELKp8IL7YF7CXMoGhHlGF1LbWOea1WcBQnBr66Qvl3kZc5TzswAptW7RNvNSpgb5ZCB9jRuTnDqbTwZivWpbtynfp/SSJCCs8IUX5J4frP/HKhoIbwFvQ3gx7r8BPnYWHw2ka0XD3GYTRYyigEC/6TVw645Ng6OA9K08EmtK9VpFAWHrTNi4e9yMItqMSw2Ebhg27J5sbUlFDYSULmzUPdnaarAaiE8EdWbY0kgFhGXLsEH3bGuyLRWQj8fHY425Z5stqlKpgJDGhY25Z/vlxkb4KCdKBcTL7HGmxCSVCojPzuMt3TYkBkK5JGzELTdH8CQSA+EPho245ebohURiIBwhCBtxy02GKpEYiKe8aZamvg6kJmcH4su1ac4OxHtImh2IMWcH4vuv0syQL5EYiKe9ac6e9nISNWzELbf00KgYCOrz7vZUS/dpqYD4amGcNauGKiB9OaqW2yxbSKUC4rsV46zZxagC4oE9ztKAjlRAUN9PSmlNIqTZLKcG0tWPAZQy5/U1UgOh+4WNuidbOkMfSg0E+bkQmRmupGvpQ0UBIWsIG3eP+9XmZvjoZioKiG+4llm70RpFAUHeS6Y7pnegaCDUZry2Ndma/byjigaCvJc87NjegZKA+EnccaecwEVJQJDXt/63pm71kJKBeC/559TegZKBIJZ3PcDLt4tOUxYgqO/7tlI+pzGqbEBQX7OulKwqVFYgiNNC4QV32ZzZ15TXZyk7EIppffmwAGvl/POZnMoOBHGRXT9tRRJDMpNbRYAglnu72lN42UrAQMWAIIavrn3hmpcs9zA1qqJAhurKcWqyKe2Ck1a1AEFtn6eklkSkqg0IYtxtW7AneOeYgUtVKxBEl+esRBtKLfSK1NqUVrUDGYobtRpbiBUlA/c0NQZkKNJjHkD4UJowGaH0gH8pNQ5kKOJLU5u5KffEbEgoITNAhiLGcNqo9PyFoxUsrtUdI2bJHJBRUbRjpyTBNfVLRAAgZpExlZ5LpMg0kIdEsGV441O1ZGvTDMw6/ylkDrUOSNflQIzJgRiTAzEmB2JMDsSYHIgxORBjciDG9AexZZYl3G+hFAAAAABJRU5ErkJggg==',
    validate: (content: string) => {
      const lower = content.trim().toLowerCase()
      // Strip thinking/chain-of-thought wrappers: <think>…</think>, <thinking>…</thinking>, 思考/分析/推理 lines
      const cleaned = lower
        .replace(/<think(ing)?>[\s\S]*?<\/think(ing)?>/g, '')
        .replace(/^.*?(思考|分析|推理).*?$/gm, '')
        .trim()
      // Error / refusal signals (EN + ZH) — e.g. "I'm a text model, cannot see the image"
      const errorSignals = [
        'cannot see', 'unable to', 'no image', 'invalid image', 'not supported',
        'vision model', 'error', 'unavailable',
        '看不到', '无法看到', '无法识别', '无法处理', '无法访问', '无法查看',
        '不能识别', '不能看到', '看不到图片',
        '不支持', '没有图片', '无效图片', '文本模型', '仅文本', '纯文本',
        '不可用',
      ]
      if (errorSignals.some((s) => cleaned.includes(s))) return false
      // The answer to the color question sits at the END of the response.
      // Inspect the last 150 chars so verbose / thinking models aren't wrongly rejected.
      const tail = cleaned.slice(-150)
      return tail.includes('red') || tail.includes('红') || tail.includes('赤')
    },
  },
} as const

/** Content part for multimodal (vision) messages */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail?: 'low' | 'high' | 'auto' } }

/** Build the user message content — plain string for text-only challenges, array for vision */
export function buildProbeContent(
  challenge: (typeof VALIDATION_CHALLENGES)[keyof typeof VALIDATION_CHALLENGES] | null,
): string | ContentPart[] {
  if (!challenge) return 'Hi'
  if ('imageUrl' in challenge) {
    return [
      { type: 'text', text: challenge.prompt },
      { type: 'image_url', image_url: { url: challenge.imageUrl, detail: 'low' } },
    ]
  }
  return challenge.prompt
}

export type ValidationLevel = keyof typeof VALIDATION_CHALLENGES | null