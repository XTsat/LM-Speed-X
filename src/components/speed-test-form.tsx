'use client'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { speedTestSchema, modelSchema, type SpeedTestInput } from '@/lib/schema'
import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { type SpeedTestResult } from '@/lib/types'
import { Button } from './ui/button'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { handleToImage } from '@/lib/tool'
import { copyToClipboard } from '@/lib/clipboard'
import { ResultsList } from './results-list'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import { Input } from './ui/input'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from './ui/command'
import { Check, ChevronDown, ChevronsUpDown, ClipboardPaste, Copy, Link, Plus, SlidersHorizontal, Trash2, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { saveTestResult } from '@/lib/local-storage'
import { isLocalUrl, fetchModelsDirect, runBrowserStreamedChat } from '@/lib/browser-llm'
import { COMMON_PROVIDERS } from '@/lib/providers'
import { ConnectivityCheck } from './connectivity-check'

// 生成唯一测试 ID（比 Date.now() 更安全，避免同毫秒内重复）
function generateTestId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

type SpeedTestResultCard = SpeedTestResult & {
	status?: 'pending' | 'running' | 'completed'
}

export function SpeedTestForm() {
	const t = useTranslations('SpeedTest')
	const tRank = useTranslations('rank')
	const [loading, setLoading] = useState(false)
	const [results, setResults] = useState<SpeedTestResultCard[] | null>(null)
	const [progress, setProgress] = useState<number>(0)
	const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
	const [streamContents, setStreamContents] = useState<{
		[key: number]: string
	}>({})
	const [models, setModels] = useState<Array<{ id: string; latencyMs?: number | null; status?: 'ok' | 'validation_failed' | 'unreachable' }>>([])
	const [isFechingModel, setIsFechingModel] = useState(false)
	const [baseUrlOpen, setBaseUrlOpen] = useState(false)
	const [configRefreshKey, setConfigRefreshKey] = useState(0)
	// 自定义请求头状态 - 使用JSON字符串格式
	const [customHeadersJson, setCustomHeadersJson] = useState('')
	const [showCustomHeaders, setShowCustomHeaders] = useState(false)
	const [useBrowserDirect, setUseBrowserDirect] = useState(false)
	const [commonBaseUrls, setCommonBaseUrls] = useState(() => [...COMMON_PROVIDERS])

	const contentRef = useRef<{ [key: number]: string }>({})
	const [autoTestLink, setAutoTestLink] = useState(true)

	const TEST_PROMPTS = useMemo(() => [
		'Explain the concept of quantum computing in simple terms.',
		'Write a short story about a robot learning to paint.',
		'What are the main differences between REST and GraphQL?',
		'Describe the taste of your favorite food.',
		'How does photosynthesis work?',
	], [])

	const {
		register,
		handleSubmit,
		watch,
		formState: { errors },
		getValues,
		setValue,
	} = useForm<SpeedTestInput>({
		resolver: zodResolver(speedTestSchema),
	})

	const [rememberApiKey, setRememberApiKey] = useState(true)
	const [rememberApiKeyLoaded, setRememberApiKeyLoaded] = useState(false)
	const [hydrated, setHydrated] = useState(false)

	// Sync form values to localStorage on change so StabilityTest block always has latest config
	const watchBaseUrl = watch('baseUrl')
	const watchApiKey = watch('apiKey')
	const watchModelId = watch('modelId')
	useEffect(() => { if (watchBaseUrl) localStorage.setItem('speedtest_baseUrl', watchBaseUrl) }, [watchBaseUrl])
	useEffect(() => { if (watchApiKey) localStorage.setItem('speedtest_apiKey', watchApiKey) }, [watchApiKey])
	useEffect(() => { if (watchModelId) localStorage.setItem('speedtest_modelId', watchModelId) }, [watchModelId])

	useEffect(() => {
		setHydrated(true)
	}, [])

	// 自动添加当前页面域名到基础 URL 候选列表
	useEffect(() => {
		const origin = window.location.origin
		if (origin && !commonBaseUrls.some(url => url.id === origin)) {
			setCommonBaseUrls(prev => [...prev, { id: origin, name: t('form.currentSite', { origin }) }])
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	// Function to parse URL parameters
	const getUrlParams = () => {
		if (typeof window !== 'undefined') {
			const searchParams = new URLSearchParams(window.location.search);
			return {
				baseUrl: searchParams.get('baseUrl'),
				apiKey: searchParams.get('apiKey'),
				modelId: searchParams.get('modelId'),
				autoTest: searchParams.get('autoTest') === 'true',
			};
		}
		return { baseUrl: null, apiKey: null, modelId: null, autoTest: false };
	};

	const fetchModels = async (baseUrl?: string, apiKey?: string) => {
		setIsFechingModel(true)
		baseUrl = baseUrl?.trim() ?? ''
		apiKey = apiKey ?? ''
		try {
			if (rememberApiKey) {
				localStorage.setItem('speedtest_apiKey', apiKey)
			}
			modelSchema.parse({ baseUrl, apiKey })
			localStorage.setItem('speedtest_baseUrl', baseUrl)
			if (useBrowserDirect) {
				const directModels = await fetchModelsDirect(baseUrl, apiKey)
				const uniqueModels = directModels.filter(
					(m: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === m.id) === i
				)
				setModels(prev => {
					const existingIds = new Set(prev.map(m => m.id))
					const newModels = uniqueModels.filter((m: any) => !existingIds.has(m.id))
					return [...prev, ...newModels]
				})
				setIsFechingModel(false)
				return
			}
			const response = await fetch('/api/model', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ baseUrl, apiKey }),
			})

			if (!response.ok) {
				let errorMsg = `Failed to fetch models (${response.status})`
				try {
					const errorData = await response.json()
					if (errorData.error) {
						errorMsg = errorData.error
					}
				} catch {
					// could not parse response body
				}
				throw new Error(errorMsg)
			}

			const data = await response.json()
			if (data.models) {
				// 去重（API 可能返回重复的模型 ID）
				const uniqueModels = data.models.filter(
					(m: any, i: number, arr: any[]) => arr.findIndex((x: any) => x.id === m.id) === i
				)
				setModels(prev => {
					const existingIds = new Set(prev.map(m => m.id))
					const newModels = uniqueModels.filter((m: any) => !existingIds.has(m.id))
					return [...prev, ...newModels]
				})
			}
		} catch (error) {
			if (error instanceof z.ZodError) {
				// 添加更好的 null 检查
				if (error.issues && error.issues.length > 0) {
					toast.error(error.issues[0].message)
				} else {
					toast.error('Validation error')
				}
			} else {
				console.error('Error fetching models:', error)
				toast.error(error instanceof Error ? error.message : 'Failed to fetch models')
			}
		}
		setIsFechingModel(false)
	}

	const onSubmit = async (data: SpeedTestInput) => {
		try {
			setLoading(true)
			contentRef.current = {}

			const initialResults = TEST_PROMPTS.map((prompt) => ({
				prompt,
				model: data.modelId,
				firstTokenLatency: 0,
				tokensPerSecond: 0,
				tokensPerSecondTotal: 0,
				outputToken: 0,
				totalTime: 0,
				outputTime: 0,
				status: 'pending' as const,
			}))
			setResults(initialResults)
			setProgress(0)
			setStreamContents({})
		data.baseUrl = data.baseUrl.trim()
		localStorage.setItem('speedtest_baseUrl', data.baseUrl)
		localStorage.setItem('speedtest_modelId', data.modelId)
		if (rememberApiKey) {
			localStorage.setItem('speedtest_apiKey', data.apiKey)
		} else {
		localStorage.removeItem('speedtest_apiKey')
			}

			if (useBrowserDirect) {
				// Parse custom headers
				let customHeaders: Record<string, string> | undefined
				if (customHeadersJson.trim()) {
					try {
						customHeaders = JSON.parse(customHeadersJson)
					} catch (e) {
						toast.error(t('form.customHeaders.invalid'))
						return
					}
				}

				// 流式内容 UI 同步定时器（browser-direct 模式）
				const updateTimer = window.setInterval(() => {
					setStreamContents({ ...contentRef.current })
				}, 16) as unknown as number

				try {
					const allResults: Array<{
						prompt: string; model: string; firstTokenLatency: number;
						tokensPerSecond: number; tokensPerSecondTotal: number;
						outputToken: number; outputTime: number; totalTime: number;
						content: string; index: number;
					}> = []

					for (let i = 0; i < TEST_PROMPTS.length; i++) {
						const prompt = TEST_PROMPTS[i]
						
						// Emit start (mimic server SSE format)
						setResults((prev) => {
							if (!prev) return prev
							const newResults = [...prev]
							newResults[i] = { ...newResults[i], status: 'running' as const }
							return newResults
						})
						setExpandedIndex(i)
						contentRef.current[i] = ''
						setTimeout(() => {
							document.querySelector(`#content-${i}`)?.scrollIntoView({
								behavior: 'smooth', block: 'center',
							})
						}, 300)

						const result = await runBrowserStreamedChat(
							data.baseUrl,
							data.apiKey,
							data.modelId,
							[{ role: 'user', content: prompt }],
							i,
							prompt,
							{
								onContent: (contentData) => {
									contentRef.current[i] = (contentRef.current[i] || '') + contentData.content
									setResults((prev) => {
										if (!prev) return prev
										const newResults = [...prev]
										newResults[i] = {
											...newResults[i],
											tokensPerSecond: contentData.currentSpeed,
											tokensPerSecondTotal: contentData.currentTotalSpeed,
											outputToken: contentData.currentTokens,
											outputTime: contentData.elapsedTime,
										}
										return newResults
									})
								},
							}
						)

						allResults.push(result)

						setResults((prev) => {
							if (!prev) return prev
							const newResults = [...prev]
							newResults[i] = { ...result, status: 'completed' as const }
							return newResults
						})
						setProgress(((i + 1) / TEST_PROMPTS.length) * 100)
					}

					// Save to localStorage
					const testResultToSave = {
						id: generateTestId(),
						timestamp: new Date().toISOString(),
						baseUrl: data.baseUrl,
						results: allResults.map((r, index) => ({
							prompt: r.prompt, model: r.model,
							firstTokenLatency: r.firstTokenLatency,
							tokensPerSecond: r.tokensPerSecond,
							tokensPerSecondTotal: r.tokensPerSecondTotal,
							outputToken: r.outputToken, totalTime: r.totalTime,
							outputTime: r.outputTime,
							content: contentRef.current[index] || '',
						})),
					}
					saveTestResult(testResultToSave)
					toast.success(t('form.resultSaved'))
					window.dispatchEvent(new Event('lm-speed-test-completed'))
					setTimeout(() => setExpandedIndex(null), 1000)
					setTimeout(() => {
						document.querySelector('#summary')?.scrollIntoView({
							behavior: 'smooth', block: 'center',
						})
					}, 300)
				} catch (error) {
					console.error('Browser direct test error:', error)
					toast.error(error instanceof Error ? error.message : 'An error occurred', { duration: 30000 })
				} finally {
					if (updateTimer !== undefined) clearInterval(updateTimer)
				}
			} else {
			// 解析自定义请求头
		let customHeaders: Record<string, string> | undefined
		if (customHeadersJson.trim()) {
			try {
				customHeaders = JSON.parse(customHeadersJson)
			} catch (e) {
				toast.error(t('form.customHeaders.invalid'))
				return
			}
		}

		const requestData = {
			...data,
			...(customHeaders && Object.keys(customHeaders).length > 0 ? { customHeaders } : {})
		}

		const response = await fetch('/api/speed/test', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(requestData),
		})

		// 添加更详细的错误处理
		if (!response.ok) {
			let errorMsg = `Failed to perform speed test (${response.status})`;
			try {
				const errorData = await response.json();
				if (errorData?.error) {
					errorMsg = errorData.error;
				}
			} catch (e) {
				// 如果无法解析 JSON，使用默认错误消息
			}
			throw new Error(errorMsg);
		}

			if (!response.body) {
				throw new Error('No response body from server');
			}

			const reader = response.body.getReader()
			const decoder = new TextDecoder()
			let buffer = ''

			// 流式内容 UI 同步定时器（服务端代理模式）
			const updateTimer = window.setInterval(() => {
				setStreamContents({ ...contentRef.current })
			}, 16) as unknown as number

			try {
				while (true) {
					const { value, done } = await reader.read()
					if (done) break

					buffer += decoder.decode(value, { stream: true })
					const lines = buffer.split('\n')
					buffer = lines.pop() || ''

					for (const line of lines) {
						if (!line.trim()) continue
						try {
							const message = JSON.parse(line)

							switch (message.type) {
								case 'start':
									setResults((prev) => {
										if (!prev) return prev
										const newResults = [...prev]
										newResults[message.data.index] = {
											...newResults[message.data.index],
											status: 'running',
										}
										return newResults
									})
									setExpandedIndex(message.data.index)
									contentRef.current[message.data.index] = ''
									console.log(
										`#content-${message.data.index}`,
										document.querySelector(`#content-${message.data.index}`)
									)
									setTimeout(() => {
										document
											.querySelector(`#content-${message.data.index}`)
											?.scrollIntoView({
												behavior: 'smooth',
												block: 'center',
											})
									}, 300)

									break
								case 'content':
									contentRef.current[message.data.index] =
										(contentRef.current[message.data.index] || '') + message.data.content
									setResults((prev) => {
										if (!prev) return prev
										const newResults = [...prev]
										newResults[message.data.index] = {
											...newResults[message.data.index],
											tokensPerSecond: message.data.currentSpeed,
											tokensPerSecondTotal: message.data.currentTotalSpeed,
											outputToken: message.data.currentTokens,
											outputTime: message.data.elapsedTime,
										}
										return newResults
									})
									break
								case 'result':
									setResults((prev) => {
										if (!prev) return prev
										const newResults = [...prev]
										newResults[message.data.index] = {
											...message.data,
											status: 'completed',
										}
										return newResults
									})
									setProgress(((message.data.index + 1) / TEST_PROMPTS.length) * 100)
									break
								case 'error':
									throw new Error(message.error)
								case 'complete':
									// 保存测试结果到 localStorage
									if (message.data && message.data.length > 0) {
										const testResultToSave = {
											id: generateTestId(),
											timestamp: new Date().toISOString(),
											baseUrl: data.baseUrl,
											results: message.data.map((r: SpeedTestResultCard, index: number) => ({
												prompt: r.prompt,
												model: r.model,
												firstTokenLatency: r.firstTokenLatency,
												tokensPerSecond: r.tokensPerSecond,
												tokensPerSecondTotal: r.tokensPerSecondTotal,
												outputToken: r.outputToken,
												totalTime: r.totalTime,
												outputTime: r.outputTime,
												content: contentRef.current[index] || ''
											}))
										}
										saveTestResult(testResultToSave)
										toast.success(t('form.resultSaved'))
										
										// 发送自定义事件通知其他页面更新数据
										window.dispatchEvent(new Event('lm-speed-test-completed'))
									}
									setTimeout(() => setExpandedIndex(null), 1000)
									setTimeout(() => {
										document.querySelector(`#summary`)?.scrollIntoView({
											behavior: 'smooth',
											block: 'center',
										})
									}, 300)
									break
							}
						} catch (error) {
							console.error('Error parsing stream:', error)
							toast.error(error instanceof Error ? error.message : 'An error occurred', {
								duration: 30000,
							})
						}
					}
				}
			} finally {
			if (updateTimer !== undefined) {
				clearInterval(updateTimer)
			}
			}
			}
			} catch (error) {
				console.error('Error:', error)
			toast.error(error instanceof Error ? error.message : 'An error occurred', { duration: 30000 })
		} finally {
			setLoading(false)
		}
	}


	
	useEffect(() => {
		// Restore rememberApiKey from localStorage (can't use useState initializer due to SSR hydration)
		let storedRemember: string | null = null;
		if (!rememberApiKeyLoaded) {
			storedRemember = localStorage.getItem('speedtest_rememberApiKey');
			if (storedRemember !== null) {
				setRememberApiKey(storedRemember === 'true');
			}
			setRememberApiKeyLoaded(true);
		} else {
			// Already loaded — read current value for the condition below
			storedRemember = localStorage.getItem('speedtest_rememberApiKey');
		}

		const savedBaseUrl = localStorage.getItem('speedtest_baseUrl')
		const savedModelId = localStorage.getItem('speedtest_modelId')
		const savedApiKey = localStorage.getItem('speedtest_apiKey')
		
		// Check URL parameters first
		const urlParams = getUrlParams();
		
		if (urlParams.baseUrl) {
			setValue('baseUrl', urlParams.baseUrl);
		} else if (savedBaseUrl) {
			setValue('baseUrl', savedBaseUrl);
		}
		
		if (urlParams.modelId) {
			setValue('modelId', urlParams.modelId);
			setModels(prev => {
				if (!prev.some(m => m.id === urlParams.modelId)) {
					return [...prev, { id: urlParams.modelId! }];
				}
				return prev;
			});
		} else if (savedModelId) {
			setValue('modelId', savedModelId);
			setModels(prev => {
				if (!prev.some(m => m.id === savedModelId)) {
					return [...prev, { id: savedModelId }];
				}
				return prev;
			});
		}
		
		if (urlParams.apiKey) {
			setValue('apiKey', urlParams.apiKey);
		} else if (savedApiKey && storedRemember !== 'false') {
			setValue('apiKey', savedApiKey);
		} else if (storedRemember === 'false' && savedApiKey) {
			// User chose not to remember — clean up stale API key from localStorage
			localStorage.removeItem('speedtest_apiKey');
		}
		
		// Only auto-start when autoTest=true AND all three params are present.
		if (urlParams.autoTest && urlParams.baseUrl && urlParams.apiKey && urlParams.modelId) {
			const doSubmit = handleSubmit(onSubmit);
			setTimeout(() => {
				doSubmit();
			}, 500);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
		}, [setValue])

		// Auto-detect local/private IP base URLs and enable browser-direct mode
		useEffect(() => {
			if (watchBaseUrl) {
				setUseBrowserDirect(isLocalUrl(watchBaseUrl))
			} else {
				setUseBrowserDirect(false)
			}
		}, [watchBaseUrl])

	const [open, setOpen] = useState(false)
	const [modelSearch, setModelSearch] = useState('')
	const [baseUrlSearch, setBaseUrlSearch] = useState('')

	// 打开基础 URL 下拉时自动填入当前已选的 base URL
	useEffect(() => {
		if (baseUrlOpen && !baseUrlSearch) {
			const currentBaseUrl = getValues('baseUrl')
			if (currentBaseUrl) {
				setBaseUrlSearch(currentBaseUrl)
			}
		}
	}, [baseUrlOpen])

	return (
		<div className="container mx-auto px-4 sm:px-0">
			<div className="bg-gray-50 p-4 sm:p-6 rounded-lg">
				<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
					<div className="space-y-2">
						<label className="text-sm text-gray-600">{t('form.baseUrl.label')}</label>
						<div className="flex flex-row gap-2">
							<div className="relative w-full">
								<Popover open={baseUrlOpen} onOpenChange={setBaseUrlOpen}>
									<PopoverTrigger asChild>
										<Button
											key={configRefreshKey}
											variant="outline"
											role="combobox"
											aria-expanded={baseUrlOpen}
											className="w-full justify-between bg-transparent border-2"
										>
											{getValues('baseUrl')
												? commonBaseUrls.find((url) => url.id === getValues('baseUrl'))?.name || getValues('baseUrl')
												: t('form.baseUrl.placeholder')}
											<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent align="start" className="w-[500px] p-0">
										<Command>
											<div className="border-b">
												<CommandInput placeholder={t('form.search')} onValueChange={setBaseUrlSearch} />
											</div>
											<div className="flex gap-2 p-2 border-b">
												<Input
													value={baseUrlSearch}
													onChange={(e) => setBaseUrlSearch(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === 'Enter') {
															e.preventDefault()
															e.stopPropagation()
															const customUrl = baseUrlSearch.trim()
															if (customUrl) {
																if (!commonBaseUrls.some(url => url.id === customUrl)) {
																	setCommonBaseUrls(prev => [...prev, { id: customUrl, name: customUrl }])
																}
																setValue('baseUrl', customUrl)
																setBaseUrlSearch('')
															}
														}
													}}
													placeholder={t('form.customBaseUrl')}
													className="h-8 text-sm"
												/>
												<Button
													type="button"
													size="sm"
													className="shrink-0"
													onClick={() => {
														const customUrl = baseUrlSearch.trim()
														if (customUrl) {
															if (!commonBaseUrls.some(url => url.id === customUrl)) {
																setCommonBaseUrls(prev => [...prev, { id: customUrl, name: customUrl }])
															}
															setValue('baseUrl', customUrl)
															setBaseUrlSearch('')
														}
													}}
												>
													{t('form.add')}
												</Button>
											</div>
											<CommandList>
												<CommandEmpty>{t('form.noBaseUrl')}</CommandEmpty>
												<CommandGroup>
													{commonBaseUrls.map((url) => (
														<CommandItem
															key={url.id}
															value={`${url.name} ${url.id}`}
															onSelect={(currentValue) => {
																// Extract the URL from the combined value
																const selectedUrl = currentValue.split(' ').pop() || currentValue
																setValue('baseUrl', selectedUrl)
																setBaseUrlOpen(false)
																// Save to localStorage when a URL is selected
																localStorage.setItem('speedtest_baseUrl', selectedUrl)
															}}
														>
															<Check
																className={cn(
																	'mr-2 h-4 w-4',
																	getValues('baseUrl') === url.id
																		? 'opacity-100'
																		: 'opacity-0'
																)}
															/>
															<div className="flex flex-col">
																<span className="font-medium">{url.name}</span>
																<span className="text-sm text-gray-500">{url.id}</span>
															</div>
														</CommandItem>
													))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
							</div>
						</div>

						{errors.baseUrl && <p className="text-rose-400 text-sm">{errors.baseUrl.message}</p>}
					</div>

					<div className="space-y-2">
						<label className="text-sm text-gray-600">{t('form.apiKey.label')}</label>
						<Input
							{...register('apiKey')}
							type="password"
							className="w-full p-2 border-2 rounded-md bg-transparent text-gray-700"
						/>
						{errors.apiKey && <p className="text-rose-400 text-sm">{errors.apiKey.message}</p>}
						<div className="flex flex-row justify-between gap-1">
							<p className="text-xs text-gray-500">{t('form.apiKey.disclaimer')}</p>
							<div className="flex items-center gap-2 cursor-pointer select-none" onClick={() => { const next = !rememberApiKey; setRememberApiKey(next); localStorage.setItem('speedtest_rememberApiKey', String(next)); }}>
								<div className={`h-4 w-4 shrink-0 rounded-sm border border-primary flex items-center justify-center ${rememberApiKey ? 'bg-primary text-primary-foreground' : ''}`}>
									<Check className={`h-3 w-3 ${hydrated && !rememberApiKey ? 'invisible' : ''}`} />
								</div>
								<span className="text-xs text-gray-500">
									{t('form.apiKey.remember')}
								</span>
							</div>
						</div>
					</div>

					<div className="space-y-2">
						<label className="text-sm text-gray-600">{t('form.modelId.label')}</label>
						<div className="flex flex-row gap-2">
							<div className="relative w-full">
								<Popover open={open} onOpenChange={setOpen}>
									<PopoverTrigger asChild>
										<Button
											variant="outline"
											role="combobox"
											aria-expanded={open}
											className="w-full justify-between bg-transparent border-2"
											onClick={() => {
												if (!isFechingModel) {
													fetchModels(getValues('baseUrl'), getValues('apiKey'))
												}
											}}
										>
											{getValues('modelId')
												? models.find((model) => model.id === getValues('modelId'))
														?.id
												: t('form.modelId.placeholder')}
											<ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
										</Button>
									</PopoverTrigger>
									<PopoverContent align="start" className="w-[500px] p-0">
										<Command>
											<div className="border-b">
												<CommandInput placeholder={t('form.search')} onValueChange={setModelSearch} />
											</div>
											<div className="flex gap-2 p-2 border-b">
												<Input
													value={modelSearch}
													onChange={(e) => setModelSearch(e.target.value)}
													onKeyDown={(e) => {
														if (e.key === 'Enter') {
															e.preventDefault()
															e.stopPropagation()
															const ids = modelSearch.split(',').map(s => s.trim()).filter(Boolean)
															for (const id of ids) {
																if (!models.some(m => m.id === id)) {
																	setModels((prev) => [...prev, { id }])
																}
															}
															if (ids.length > 0) {
																setValue('modelId', ids[ids.length - 1])
																setModelSearch('')
															}
														}
													}}
													placeholder={t('form.customModelPlaceholder')}
													className="h-8 text-sm"
												/>
												<Button
													type="button"
													size="sm"
													className="shrink-0"
													onClick={() => {
														const ids = modelSearch
															.split(',')
															.map(s => s.trim())
															.filter(Boolean)
														for (const id of ids) {
															if (!models.some(m => m.id === id)) {
																setModels((prev) => [...prev, { id }])
															}
														}
														if (ids.length > 0) {
															setValue('modelId', ids[ids.length - 1])
															setModelSearch('')
														}
													}}
												>
													{t('form.add')}
												</Button>
											</div>
											<CommandList>
												<CommandEmpty>{t('form.noFramework')}</CommandEmpty>
												<CommandGroup>
								{Array.from(new Map(models.map(m => [m.id, m])).values())
									.sort((a, b) => {
										const order = { ok: 0, validation_failed: 1, unreachable: 2, undefined: 3 }
										const aOrd = order[a.status ?? 'undefined']
										const bOrd = order[b.status ?? 'undefined']
										if (aOrd !== bOrd) return aOrd - bOrd
										return (a.latencyMs ?? 0) - (b.latencyMs ?? 0)
									})
									.map((model) => (
										<CommandItem
											key={model.id}
											value={model.id}
											onSelect={(currentValue) => {
												setValue('modelId', currentValue)
												setOpen(false)
											}}
										>
											<Check
												className={cn(
													'mr-2 h-4 w-4',
													getValues('modelId') === model.id
														? 'opacity-100'
														: 'opacity-0'
												)}
											/>
										<span className="flex-1 truncate">{model.id}</span>
										{model.status === 'ok' && model.latencyMs != null && (
											<span className="ml-2 text-xs text-green-600 dark:text-green-400 shrink-0">
												{model.latencyMs}ms
											</span>
										)}
										{model.status === 'validation_failed' && (
											<span className="ml-2 text-xs text-amber-600 dark:text-amber-400 shrink-0 font-medium">
												{t('form.modelStatus.validationFailed')}
											</span>
										)}
										{model.status === 'unreachable' && (
											<span className="ml-2 text-xs text-red-500 dark:text-red-400 shrink-0">
												{t('form.modelStatus.unreachable')}
											</span>
										)}
										</CommandItem>
									))}
												</CommandGroup>
											</CommandList>
										</Command>
									</PopoverContent>
								</Popover>
							</div>
						</div>

						{errors.modelId && <p className="text-rose-400 text-sm">{errors.modelId.message}</p>}
					</div>

				<ConnectivityCheck
					baseUrl={watchBaseUrl || ''}
					apiKey={watchApiKey || ''}
					onModelsFound={(found) => {
					setModels(prev => {
						const updated = prev.map(m => {
							const f = found.find(x => x.id === m.id)
							return f ? { ...m, latencyMs: f.latencyMs, status: f.status } : m
						})
						const existingIds = new Set(updated.map(m => m.id))
						const newModels = found.filter(m => !existingIds.has(m.id))
						return [...updated, ...newModels]
					})
				}} />

					{/* 自定义请求头区域 */}
					<div className="border border-input rounded-md">
						<button
							type="button"
							onClick={() => setShowCustomHeaders(!showCustomHeaders)}
							className="flex items-center justify-between w-full px-4 py-2 text-sm hover:bg-muted/50 transition-colors rounded-md"
						>
							<div className="flex items-center gap-2">
								<SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
								<span className="font-medium">{t('form.extraSettings')}</span>
							</div>
							<ChevronDown
								className={cn(
									'ml-2 h-4 w-4 shrink-0 opacity-50 transition-transform',
									!showCustomHeaders && 'rotate-90',
								)}
							/>
						</button>
						{showCustomHeaders && (
							<div className="px-3 pb-3 pt-3 space-y-3 border-t border-input/60">
								<div className="flex items-center gap-2">
									<Checkbox
										id="browser-direct"
										checked={useBrowserDirect}
										onCheckedChange={(checked) => setUseBrowserDirect(!!checked)}
									/>
									<label htmlFor="browser-direct" className="text-sm text-gray-600 cursor-pointer select-none">
										{t('form.browserDirect.label')}
									</label>
								</div>
								<div>
									<label className="text-sm text-gray-600 mb-1 block">{t('form.customHeaders.label') || '自定义请求头'}</label>
									<textarea
									value={customHeadersJson}
									onChange={(e) => setCustomHeadersJson(e.target.value)}
									placeholder={`{\"X-Custom-Auth\": \"your-token\"}`}
									className="w-full h-24 p-2 text-sm font-mono border rounded-md bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
								/>
								<p className="text-xs text-gray-400 mt-1">{t('form.customHeaders.help') || t('form.customHeaders.example')}</p>
								</div>
							</div>
						)}
					</div>

					<div className="flex gap-2">
						<Button
							type="button"
							variant="outline"
							className="flex-1"
							onClick={async () => {
							const config = {
										baseUrl: getValues('baseUrl'),
										apiKey: getValues('apiKey'),
										modelId: getValues('modelId'),
										rememberApiKey,
										customHeadersJson,
									};
await copyToClipboard(JSON.stringify(config, null, 2));
									toast.success(t('form.configCopied'), {
										description: t('form.apiKeyWarning'),
									});
							}}
						>
							<Copy className="mr-1 h-4 w-4" />
							{t('form.exportConfig')}
						</Button>
						<Button
							type="button"
							variant="outline"
							className="flex-1"
						onClick={async () => {
								try {
									const text = await navigator.clipboard.readText();
									const config = JSON.parse(text);

									// 支持 newapi 一键导入格式：{_type: "newapi_channel_conn", key: "sk-...", url: "http://..."}
									if (config._type === 'newapi_channel_conn') {
										const baseUrl = config.url;
										const apiKey = config.key;

										if (baseUrl) {
											setValue('baseUrl', baseUrl, { shouldDirty: true });
											if (!commonBaseUrls.some(url => url.id === baseUrl)) {
												setCommonBaseUrls(prev => [...prev, { id: baseUrl, name: baseUrl }]);
											}
										}
										if (apiKey) setValue('apiKey', apiKey, { shouldDirty: true });

										// 强制刷新UI显示
										setConfigRefreshKey(prev => prev + 1);
										toast.success(t('form.configImported'), {
											description: t('form.apiKeyWarning'),
										});
										return;
									}

									if (config.baseUrl) {
										setValue('baseUrl', config.baseUrl, { shouldDirty: true });
										// 如果导入的URL不在列表中，自动添加
										if (!commonBaseUrls.some(url => url.id === config.baseUrl)) {
											setCommonBaseUrls(prev => [...prev, { id: config.baseUrl, name: config.baseUrl }]);
										}
									}
									if (config.apiKey) setValue('apiKey', config.apiKey, { shouldDirty: true });
									if (config.modelId) {
										setValue('modelId', config.modelId, { shouldDirty: true });
										// 如果导入的模型ID不在列表中，自动添加
										if (!models.some(m => m.id === config.modelId)) {
											setModels(prev => [...prev, { id: config.modelId }]);
										}
									}
									if (typeof config.rememberApiKey === 'boolean') {
											setRememberApiKey(config.rememberApiKey);
										}
										if (config.customHeadersJson !== undefined) {
											setCustomHeadersJson(config.customHeadersJson);
										}
										// 强制刷新UI显示
										setConfigRefreshKey(prev => prev + 1);
									toast.success(t('form.configImported'), {
										description: t('form.apiKeyWarning'),
									});
								} catch (err) {
									toast.error(t('form.configImportError'));
								}
							}}
						>
							<ClipboardPaste className="mr-1 h-4 w-4" />
							{t('form.importConfig')}
						</Button>
						<Button
							type="button"
							variant="outline"
							className="flex-1"
							onClick={async () => {
								const baseUrl = getValues('baseUrl') || '';
								const apiKey = getValues('apiKey') || '';
								const modelId = getValues('modelId') || '';
								const origin = typeof window !== 'undefined' ? window.location.origin : 'https://lm-speed-x.xtsat.cc.cd';
								const url = new URL(origin);
								url.searchParams.set('baseUrl', baseUrl);
								url.searchParams.set('apiKey', apiKey);
								url.searchParams.set('modelId', modelId);
								// Toggle between auto-test and plain link on each click
								const withAutoTest = autoTestLink;
								if (withAutoTest) {
									url.searchParams.set('autoTest', 'true');
								}
								setAutoTestLink(!autoTestLink);
								try {
									await copyToClipboard(url.toString());
									toast.success(withAutoTest ? t('form.linkCopiedAutoTest') : t('form.linkCopiedNormal'), {
										description: t('form.apiKeyWarning'),
										duration: 8000,
									});
								} catch {
									toast.error(t('form.configImportError'));
								}
							}}
						>
							<Link className="mr-1 h-4 w-4" />
							{t('form.generateLink')}
						</Button>
					</div>

					<Button
						type="submit"
						disabled={loading || models.length === 0}
						className="w-full py-2 shadow-none transition-colors"
					>
						{loading ? (
							<div className="flex items-center justify-center space-x-2">
								<span>{t('form.submit.running')}</span>
								<span>{progress.toFixed(0)}%</span>
							</div>
						) : (
							t('form.submit.default')
						)}
					</Button>
				</form>
			</div>

			{results && (
				<>
					<div className="flex justify-center gap-4 mt-8">
						<Button className="rounded-full" onClick={() => handleToImage('summary')}>
							{t('form.downloadSummary')}
						</Button>
						<Button
							variant="outline"
							className="rounded-full"
							onClick={() => handleToImage('result')}
						>
							{t('form.downloadFullReport')}
						</Button>
					</div>
					<div id="result" className="my-8">
						{results.every((result) => result.status === 'completed') && (
							<div id="summary" className="mb-8 pt-6 px-6 pb-2 bg-[#17181C] rounded-lg">
								<h3 className="text-lg font-semibold text-white mb-1 flex items-center gap-2">
									<Zap className="w-5 h-5" />
									<span>LM Speed X {t('results.summary.title')}</span>
								</h3>
								<div className="text-sm font-normal mb-4">
									<span className="text-gray-400 mr-2">{tRank('table.model')}:</span>
									<span className="text-white mr-8">{results[0].model}</span>
									<span className="text-gray-400 mr-2">{tRank('table.baseUrl')}:</span>
									<span className="text-white">{(() => {
										try {
											return new URL(getValues('baseUrl')).host
										} catch {
											return getValues('baseUrl')
										}
									})()}</span>
								</div>
								<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
									<div>
										<p className="text-sm text-gray-400">{tRank('table.avgLatency')}</p>
										<p className="text-2xl font-medium text-white">
											{(
												results.reduce((acc, cur) => acc + cur.firstTokenLatency, 0) /
												results.length /
												1000
											).toFixed(2)}
											s
										</p>
										<div className="mt-4">
											<p className="text-sm text-gray-400">
												{t('results.summary.maxFirstTokenLatency')}
											</p>
											<p className="text-base text-white">
												{(
													Math.max(...results.map((r) => r.firstTokenLatency)) /
													1000
												).toFixed(2)}
												s
											</p>
										</div>
										<div className="mt-2">
											<p className="text-sm text-gray-400">
												{t('results.summary.minFirstTokenLatency')}
											</p>
											<p className="text-base text-white">
												{(
													Math.min(...results.map((r) => r.firstTokenLatency)) /
													1000
												).toFixed(2)}
												s
											</p>
										</div>
									</div>
									<div>
										<p className="text-sm text-gray-400">{tRank('table.avgTotalTime')}</p>
										<p className="text-2xl font-medium text-white">
											{(
												results.reduce((acc, cur) => acc + cur.totalTime, 0) /
												results.length /
												1000
											).toFixed(2)}
											s
										</p>
										<div className="mt-4">
											<p className="text-sm text-gray-400">
												{t('results.summary.maxTotalTime')}
											</p>
											<p className="text-base text-white">
												{(
													Math.max(...results.map((r) => r.totalTime)) / 1000
												).toFixed(2)}
												s
											</p>
										</div>
										<div className="mt-2">
											<p className="text-sm text-gray-400">
												{t('results.summary.minTotalTime')}
											</p>
											<p className="text-base text-white">
												{(
													Math.min(...results.map((r) => r.totalTime)) / 1000
												).toFixed(2)}
												s
											</p>
										</div>
									</div>
									<div>
										<p className="text-sm text-gray-400">{tRank('table.avgTokens')}</p>
										<p className="text-2xl font-medium text-white">
											{(
												results.reduce((acc, cur) => acc + cur.tokensPerSecond, 0) /
												results.length
											).toFixed(2)}{' '}
											t/s
										</p>
										<div className="mt-4">
											<p className="text-sm text-gray-400">
												{t('results.summary.maxTokensPerSecond')}
											</p>
											<p className="text-base text-white">
												{Math.max(...results.map((r) => r.tokensPerSecond)).toFixed(
													2
												)}{' '}
												t/s
											</p>
										</div>
										<div className="mt-2">
											<p className="text-sm text-gray-400">
												{t('results.summary.minTokensPerSecond')}
											</p>
											<p className="text-base text-white">
												{Math.min(...results.map((r) => r.tokensPerSecond)).toFixed(
													2
												)}{' '}
												t/s
											</p>
										</div>
									</div>
								</div>
								<a href="https://lm-speed-x.xtsat.cc.cd" target="_blank" rel="noopener noreferrer" className="block mt-1 text-right text-xs text-gray-600 hover:text-gray-400 transition-colors">lm-speed-x.xtsat.cc.cd</a>
							</div>
						)}
						<ResultsList
							results={results}
							streamContents={streamContents}
							expandedIndex={expandedIndex}
							onToggle={(index) => setExpandedIndex(expandedIndex === index ? null : index)}
						/>
					</div>
				</>
			)}
		</div>
	)
}