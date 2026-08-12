[中文](README_zh.md) | English

# LM Speed - Simple LLM Speed Analysis Tool

Portal: <https://lm-speed-x.xtsat.cc.cd>

Provides precise and reliable OpenAI API performance testing solutions for AI application developers. Through multi-dimensional real-time data analysis, it helps users quickly identify performance bottlenecks and optimize model calling strategies. It also offers an intuitive ranking feature, allowing users to easily compare and select the most suitable models and service providers.

## Features

- ⚡ **Real-time Speed Testing**: Test any OpenAI-compatible API (DeepSeek, SiliconFlow, Tencent Cloud, etc.) with your own `baseUrl`, `apiKey` and `modelId`. Five built-in prompts run through streaming with live progress, measuring first token latency, tokens per second (TPoS) and total response time.
- 📊 **Stability Testing**: Run configurable iterations (default 10) and get a complete statistical profile — mean, median, standard deviation, variance, min and max for latency, TPoS, output tokens and total time.
- 🚦 **Concurrency Stress Testing**: Test with multiple concurrency levels (e.g. 1 / 5 / 10 / 20), measuring success rate, RPS, average latency, p99 latency and average TPoS per level, and automatically recommending the best-performing configuration.
- 🛜 **Connectivity Checking**: Batch-verify model reachability before testing — including latency, retries, tier restrictions and content validity — so you can fix configuration issues upfront.
- 🧠 **Model Authenticity Verification**: Detect disguised proxy models that swap real reasoning models for generic AI. Three built-in checks: PONG response detection, self-identification check, and arithmetic reasoning verification.
- 🏆 **Ranking & Comparison**: All local test results are aggregated into a leaderboard with time-range filters, model/provider quick badges, custom search, metric-based sorting (TPoS / latency), and fully customizable table columns.
- 📤 **Data Import & Export**: Export rankings as JSON or save test reports as PNG images with one click; import JSON data back to merge results.
- 🔗 **Quick Start via URL**: Pre-fill the test form with `baseUrl`, `apiKey` and `modelId` URL parameters, or generate a shareable auto-test link — no manual form filling required.
- 🖥️ **LAN / Private API Support**: Direct browser-side streaming to local or intranet endpoints, bypassing server-side proxy restrictions.
- 🌐 **Bilingual & Local-First**: Full Chinese and English UI, no backend database required — all test results are stored in your browser's localStorage.

## Comparison with the Original

LM Speed X is a fork of the original [nexmoe/lm-speed](https://github.com/nexmoe/lm-speed) project. Both share the same core speed-testing experience; LM Speed X focuses on a simpler deployment model — it ships as a single web page with no database dependency, making it lighter and easier to deploy:

| Feature | LM Speed (Original) | LM Speed X |
|---|---|---|
| Real-time speed testing (first-token latency / TPoS) | ✅ | ✅ |
| URL parameter quick start | ✅ | ✅ (adds `autoTest`) |
| Leaderboard | ✅ | ✅ (local data, filterable/sortable) |
| Bilingual UI | ✅ | ✅ |
| Stability testing (multi-round statistics) | — | ✅ |
| Concurrency stress testing (multi-level) | — | ✅ |
| Connectivity check (batch model reachability) | — | ✅ |
| Model authenticity verification | — | ✅ |
| Custom request headers | — | ✅ |
| Data import / export (JSON) | — | ✅ |
| Report export as PNG image | — | ✅ |
| Shareable quick-test link | — | ✅ |
| LAN / private API direct testing | — | ✅ |
| Database dependency | Requires a database | **None** — single-page deployment, more lightweight |
| Changelog page | — | ✅ |

## Screenshots

### Speed Test

![Speed Test](docs/screenshots/speed-test.png)

### Stability Test

![Stability Test](docs/screenshots/stability-test.png)

### Concurrency Test

![Concurrency Test](docs/screenshots/concurrency-test.png)

### Connectivity Check & Model Verification

![Connectivity Check & Model Verification](docs/screenshots/connectivity-check.png)

### Ranking

![Ranking](docs/screenshots/ranking.png)

## More

### Quick Start

#### Manual Build & Deployment

1. Clone the repository

```bash
git clone https://github.com/XTsat/LM-Speed-X.git
cd LM-Speed-X
```

2. Install dependencies

```bash
pnpm install
```

3. Build the project

```bash
pnpm build
```

4. Start the service

```bash
pnpm start
```

The app runs at `http://localhost:3000` by default.

> **For development**, run `pnpm dev` instead — it starts the dev server with hot reload.
>
> **No configuration required**: the project has no database or external services, so no environment variables are needed — clone, install, build and start.

### URL Parameters Usage

LM Speed supports quick test initiation through URL parameters without manual form filling:

```
https://lm-speed-x.xtsat.cc.cd/?baseUrl=YOUR_BASE_URL&apiKey=YOUR_API_KEY&modelId=YOUR_MODEL_ID
```

Parameter Description:

- `baseUrl`: The base URL of the API service, e.g., `https://api.deepseek.com/v1`
- `apiKey`: Your API key
- `modelId`: The model ID to test
- `autoTest`: Set to `true` to start the test automatically after the page loads

Example:

```
https://lm-speed-x.xtsat.cc.cd/zh-CN?baseUrl=https://api.deepseek.com/v1&apiKey=sk-xxx&modelId=deepseek-chat&autoTest=true
```

Notes:

1. For security reasons, it's recommended not to pass API keys directly in URLs, but rather use the form for manual input
2. If the URL contains special characters, make sure to URL encode them

### Tech Stack

- **Frontend**:
  - Next.js 16
  - React 19
  - TypeScript
  - TailwindCSS
  - Radix UI Components
  - SWR for data fetching
  - next-intl for internationalization
  - next-themes for dark mode

- **Backend**:
  - Next.js API Routes
  - OpenAI SDK
  - tiktoken for token counting

- **Development**:
  - ESLint
  - TypeScript

- **Deployment**:
  - Single-page deployment (`pnpm build && pnpm start`)
  - Docker

> **No database required**: Test results are stored in the browser's localStorage, so the app runs without any backend database.

### Contributing

Issues and Pull Requests are welcome! Before submitting a PR, please ensure:

1. Code follows project coding standards (see [AGENTS.md](AGENTS.md))
2. Necessary tests are added
3. Related documentation is updated

### License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details
