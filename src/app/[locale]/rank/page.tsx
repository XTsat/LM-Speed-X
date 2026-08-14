'use client'

import { useState, useEffect } from 'react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { Settings2, RefreshCw, Download, Upload, Trash2 } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Checkbox } from '@/components/ui/checkbox'
import { getProvider, getModel, getModelByName } from '@/lib/info'
import { Link } from '@/i18n/routing'

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import Image from 'next/image'
import { getTestResults, deleteTestResult, type SpeedTestResult as LocalSpeedTestResult } from '@/lib/local-storage'

type RankingResult = {
	model: string
	baseUrl: string
	maxTokensPerSecond: number
	minTokensPerSecond: number
	avgTokensPerSecond: number
	avgTokensPerSecondTotal: number
	maxFirstTokenLatency: number
	minFirstTokenLatency: number
	avgFirstTokenLatency: number
	totalTests: number
}

// localStorage
function getTimeRangeThreshold(timeRange: string): Date {
	const now = new Date()
	switch (timeRange) {
		case 'day':
			return new Date(now.getTime() - 24 * 60 * 60 * 1000)
		case 'week':
			return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
		case 'month':
			return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
		default:
			return new Date(0) // 返回 epoch 开始时间
	}
}

// 从 localStorage 生成排名数据
function getLocalRankingResults(timeRange: string = 'all'): RankingResult[] {
	const localResults = getTestResults()
	if (localResults.length === 0) return []

	// 获取时间范围阈值
	const threshold = getTimeRangeThreshold(timeRange)

	// 按时间范围筛选
	const filteredResults = localResults.filter(test => {
		const testTimestamp = new Date(test.timestamp)
		return testTimestamp >= threshold
	})

	if (filteredResults.length === 0) return []

	// 按 model + baseUrl 分组
	const grouped: Record<string, {
		baseUrl: string
		model: string
		tokensPerSecond: number[]
		tokensPerSecondTotal: number[]
		firstTokenLatency: number[]
	}> = {}

	filteredResults.forEach(test => {
		test.results.forEach(result => {
			const key = `${result.model}-${test.baseUrl}`
			if (!grouped[key]) {
				grouped[key] = {
					baseUrl: test.baseUrl,
					model: result.model,
					tokensPerSecond: [],
					tokensPerSecondTotal: [],
					firstTokenLatency: []
				}
			}
			grouped[key].tokensPerSecond.push(result.tokensPerSecond)
			grouped[key].tokensPerSecondTotal.push(result.tokensPerSecondTotal)
			grouped[key].firstTokenLatency.push(result.firstTokenLatency)
		})
	})

	return Object.values(grouped).map(g => ({
		model: g.model,
		baseUrl: g.baseUrl,
		maxTokensPerSecond: Math.max(...g.tokensPerSecond),
		minTokensPerSecond: Math.min(...g.tokensPerSecond),
		avgTokensPerSecond: g.tokensPerSecond.reduce((a, b) => a + b, 0) / g.tokensPerSecond.length,
		avgTokensPerSecondTotal: g.tokensPerSecondTotal.reduce((a, b) => a + b, 0) / g.tokensPerSecondTotal.length,
		maxFirstTokenLatency: Math.max(...g.firstTokenLatency),
		minFirstTokenLatency: Math.min(...g.firstTokenLatency),
		avgFirstTokenLatency: g.firstTokenLatency.reduce((a, b) => a + b, 0) / g.firstTokenLatency.length,
		totalTests: g.tokensPerSecond.length
	}))
}

export default function RankPage() {
	const t = useTranslations('rank')
	const [filters, setFilters] = useState<{
		searchModel: string;
		baseUrl: string;
		timeRange: string;
		metric: string;
		listModel: string[];
		listBaseHost: string[];
	}>({
		searchModel: '',
		baseUrl: '',
		timeRange: 'all',
		metric: 'tokensPerSecond',
		listModel: [],
		listBaseHost: [],
	})

	const [badgeIndex, setBadgeIndex] = useState(0)

	const badges = [
		{
			name: 'All',
			searchModel: '',
		},
		{
			name: 'DeepSeek',
			searchModel: 'deepseek',
		},
		{
			name: 'Gemini',
			searchModel: 'gemini',
		},
		{
			name: 'Qwen',
			searchModel: 'qwen',
		},
		{
			name: 'GPT',
			searchModel: 'gpt',
		},
	]

	const handleChangeBadge = (index: number) => {
		setBadgeIndex(index)
		setFilters({
			...filters,
			searchModel: badges[index].searchModel || '',
			listModel: [],
		})
	}

	const [visibleColumns, setVisibleColumns] = useState({
		model: true,
		baseUrl: true,
		avgTokens: true,
		maxMinTokens: true,
		totalAvgTokens: false,
		avgLatency: true,
		maxMinLatency: false,
		totalTests: true,
		delete: false,
	})

	const toggleColumn = (columnId: keyof typeof visibleColumns) => {
		setVisibleColumns((prev) => ({
			...prev,
			[columnId]: !prev[columnId],
		}))
	}

	const [localResults, setLocalResults] = useState<RankingResult[]>([])

	const loadLocalResults = (timeRange: string = 'all') => {
		const localData = getLocalRankingResults(timeRange)
		setLocalResults(localData)
	}

	useEffect(() => {
		// 从 localStorage 获取数据
		loadLocalResults(filters.timeRange)

		// 监听 localStorage 变化
		const handleStorageChange = (e: StorageEvent) => {
			if (e.key === 'lm-speed-test-results') {
				loadLocalResults(filters.timeRange)
			}
		}

		// 监听自定义事件，用于同一页面内的数据更新通知
		const handleTestCompleted = () => {
			loadLocalResults(filters.timeRange)
		}

		window.addEventListener('storage', handleStorageChange)
		window.addEventListener('lm-speed-test-completed', handleTestCompleted)

		return () => {
			window.removeEventListener('storage', handleStorageChange)
			window.removeEventListener('lm-speed-test-completed', handleTestCompleted)
		}
	}, [filters.timeRange])

	// 添加一个刷新按钮的点击处理
	const handleRefresh = () => {
		loadLocalResults(filters.timeRange)
	}

	// 导出排行榜数据为JSON文件
	const handleExport = () => {
		const exportData = {
			exportTime: new Date().toISOString(),
			timeRange: filters.timeRange,
			metric: filters.metric,
			results: sortedResults
		}
		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `lm-speed-rankings-${new Date().toISOString().slice(0, 10)}.json`
		document.body.appendChild(a)
		a.click()
		document.body.removeChild(a)
		URL.revokeObjectURL(url)
	}

	// 导入JSON文件
	const handleImport = (event: React.ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		const reader = new FileReader()
		reader.onload = (e) => {
			try {
				const data = JSON.parse(e.target?.result as string)
				if (!data.results || !Array.isArray(data.results)) {
					alert(t('importInvalidFormat'))
					return
				}
				// 将导入的数据转换为SpeedTestResult格式并保存
				const existingResults = getTestResults()
				const newResults: LocalSpeedTestResult[] = []
				data.results.forEach((result: RankingResult, index: number) => {
					// 每个排名结果导入为一条记录（不按 totalTests 复制多条相同记录，避免数据膨胀）
					newResults.push({
						id: `imported-${Date.now()}-${index}`,
						timestamp: new Date().toISOString(),
						baseUrl: result.baseUrl,
						results: [{
							prompt: 'imported',
							model: result.model,
							firstTokenLatency: result.avgFirstTokenLatency,
							tokensPerSecond: result.avgTokensPerSecond,
							tokensPerSecondTotal: result.avgTokensPerSecondTotal,
							outputToken: 0,
							totalTime: 0,
							outputTime: 0,
							content: ''
						}]
					})
				})
				const mergedResults = [...existingResults, ...newResults]
				localStorage.setItem('lm-speed-test-results', JSON.stringify(mergedResults))
				loadLocalResults(filters.timeRange)
				// 触发自定义事件通知数据更新
				window.dispatchEvent(new Event('lm-speed-test-completed'))
				alert(t('importSuccess', { count: newResults.length }))
			} catch {
				alert(t('importError'))
			}
		}
		reader.readAsText(file)
		// 重置input值以便可以再次选择同一文件
		event.target.value = ''
	}

	// 删除单条测试记录（通过model和baseUrl匹配），默认删除5条
	const handleDelete = (result: RankingResult, deleteCount: number = 5) => {
		const existingResults = getTestResults()
		let deleted = 0
		for (let i = 0; i < deleteCount && deleted < deleteCount; i++) {
			const indexToDelete = existingResults.findIndex(
				r => r.baseUrl === result.baseUrl && r.results.some(r2 => r2.model === result.model)
			)
			if (indexToDelete !== -1) {
				deleteTestResult(existingResults[indexToDelete].id)
				existingResults.splice(indexToDelete, 1)
				deleted++
			} else {
				break
			}
		}
		if (deleted > 0) {
			loadLocalResults(filters.timeRange)
			window.dispatchEvent(new Event('lm-speed-test-completed'))
		}
	}

	// 对本地数据应用筛选条件
	const rawResults = localResults.filter(result => {
		// 根据 searchModel 筛选（模糊匹配）
		if (filters.searchModel && !result.model.toLowerCase().includes(filters.searchModel.toLowerCase())) {
			return false
		}
		// 根据 listModel 筛选（精确匹配）
		if (filters.listModel.length > 0 && !filters.listModel.includes(result.model)) {
			return false
		}
		return true
	})
	
	// 根据选择的指标对数据进行排序
	const sortedResults = [...rawResults].sort((a, b) => {
		if (filters.metric === 'tokensPerSecond') {
			// 按 tokensPerSecond 降序排序（越高越好）
			return b.avgTokensPerSecond - a.avgTokensPerSecond
		} else {
			// 按 firstTokenLatency 升序排序（越低越好）
			return a.avgFirstTokenLatency - b.avgFirstTokenLatency
		}
	})
	
	const data = { results: sortedResults }
	const loading = false

	const formatNumber = (num: number) => num?.toFixed(2)
	// 获取域名，处理无效 URL 情况（localStorage 数据可能损坏）
	const getHost = (baseUrl: string) => {
		try {
			return new URL(baseUrl).host
		} catch {
			return baseUrl
		}
	}

	// 获取最大值，处理空数组情况
	const getMaxValue = (values: number[]) => {
		if (values.length === 0) return 1
		return Math.max(...values)
	}

	return (
		<div className="max-w-7xl mx-auto">
			<div className="max-w-4xl mx-auto pb-16">
				<h1 className="text-3xl font-bold text-center">{t('title')}</h1>
			</div>
			<div className="space-y-4">
				<div className="mb-6 flex flex-col md:flex-row gap-4 items-start md:items-center md:justify-between">
					<div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
						<Select
							value={filters.timeRange}
							onValueChange={(value: string) => setFilters({ ...filters, timeRange: value })}
						>
							<SelectTrigger className="w-full md:w-[180px] bg-transparent">
								<SelectValue placeholder={t('timeRange.label')} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="all">{t('timeRange.all')}</SelectItem>
								<SelectItem value="day">{t('timeRange.day')}</SelectItem>
								<SelectItem value="week">{t('timeRange.week')}</SelectItem>
								<SelectItem value="month">{t('timeRange.month')}</SelectItem>
							</SelectContent>
						</Select>
					</div>

					<div className="flex flex-wrap md:flex-row items-center gap-2">
						{badges.map((badge, index) => (
							<Badge
								key={index}
								onClick={() => handleChangeBadge(index)}
								variant={badgeIndex === index ? 'default' : 'outline'}
								className="cursor-pointer py-2 px-4 font-normal"
							>
								{badge.name}
							</Badge>
						))}
						<Input
							placeholder={t('customFilter')}
							value={filters.searchModel}
							onChange={(e) => {
								setFilters({ ...filters, searchModel: e.target.value })
								setBadgeIndex(-1) // 清除选中的标签
							}}
							className="w-40 md:w-48"
						/>
					</div>

					<div className="flex gap-4 w-full md:w-auto">
						<Select
							value={filters.metric}
							onValueChange={(value: string) => setFilters({ ...filters, metric: value })}
						>
							<SelectTrigger className="w-full md:w-[132px] bg-transparent">
								<SelectValue placeholder={t('metric.label')} />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="tokensPerSecond">{t('table.avgTokens')}</SelectItem>
								<SelectItem value="firstTokenLatency">{t('table.avgLatency')}</SelectItem>
							</SelectContent>
						</Select>

						<Button
								variant="outline"
								size="icon"
								onClick={handleRefresh}
							>
								<RefreshCw className="h-4 w-4" />
							</Button>
						<Button
								variant="outline"
								size="icon"
								onClick={handleExport}
								title={t('export')}
							>
								<Download className="h-4 w-4" />
							</Button>
						<label>
							<Button
								variant="outline"
								size="icon"
								asChild
								className="cursor-pointer"
								title={t('import')}
							>
								<span>
									<Upload className="h-4 w-4" />
								</span>
							</Button>
							<input
								type="file"
								accept=".json"
								onChange={handleImport}
								className="hidden"
							/>
						</label>
						<Popover>
							<PopoverTrigger asChild>
								<Button variant="outline" size="icon">
									<Settings2 className="h-4 w-4" />
								</Button>
							</PopoverTrigger>
							<PopoverContent className="w-80">
								<div className="grid gap-4">
									<div className="space-y-2">
										<h4 className="font-medium leading-none">{t('columnSettings')}</h4>
										<p className="text-sm text-muted-foreground">
											{t('columnSettingsDesc')}
										</p>
									</div>
									<div className="grid gap-2">
										{Object.entries(visibleColumns)
											.filter(([key]) => key !== 'delete')
											.map(([key, value]) => (
											<div key={key} className="flex items-center space-x-2">
												<Checkbox
													id={key}
													checked={value}
													onCheckedChange={() =>
														toggleColumn(key as keyof typeof visibleColumns)
													}
												/>
												<label
													htmlFor={key}
													className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
												>
													{t(`table.${key}`)}
												</label>
											</div>
										))}
										<div className="flex items-center space-x-2">
											<Checkbox
												id="delete"
												checked={visibleColumns.delete}
												onCheckedChange={() =>
													toggleColumn('delete')
												}
											/>
											<label
												htmlFor="delete"
												className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
											>
												{t('delete')}
											</label>
										</div>
									</div>
								</div>
							</PopoverContent>
						</Popover>
					</div>
				</div>

				<div id="ranking" className="overflow-x-auto border rounded-md relative">
					<div className="fixed inset-0 pointer-events-none select-none z-10 overflow-hidden">
						<div className="absolute inset-0 flex items-center justify-center opacity-[0.03] -rotate-12">
							<div className="whitespace-nowrap text-4xl font-bold">
								{Array(5).fill('LM Speed X').join('     ')}
							</div>
						</div>
					</div>
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead className="w-[40px]">#</TableHead>
								{visibleColumns.model && (
									<TableHead className="min-w-[150px]">{t('table.model')}</TableHead>
								)}
								{visibleColumns.avgTokens && (
									<TableHead className="min-w-[180px]">{t('table.avgTokens')}</TableHead>
								)}
								{visibleColumns.maxMinTokens && (
									<TableHead className="min-w-[120px]">{t('table.maxMinTokens')}</TableHead>
								)}
								{visibleColumns.totalAvgTokens && (
									<TableHead className="min-w-[150px]">
										{t('table.totalAvgTokens')}
									</TableHead>
								)}
								{visibleColumns.avgLatency && (
									<TableHead className="min-w-[150px]">{t('table.avgLatency')}</TableHead>
								)}
								{visibleColumns.maxMinLatency && (
									<TableHead className="min-w-[120px]">
										{t('table.maxMinLatency')}
									</TableHead>
								)}
								{visibleColumns.totalTests && (
									<TableHead className="min-w-[100px]">{t('table.totalTests')}</TableHead>
								)}
								{visibleColumns.delete && (
									<TableHead className="w-[60px]"></TableHead>
								)}
							</TableRow>
						</TableHeader>
						<TableBody>
							{loading ? (
								<TableRow>
									<TableCell colSpan={10} className="text-center h-32 md:h-64">
										{t('table.loading')}
									</TableCell>
								</TableRow>
							) : data?.results.length === 0 ? (
								<TableRow>
									<TableCell colSpan={10} className="text-center h-32 md:h-64">
										{t('table.noResults')}
									</TableCell>
								</TableRow>
							) : (
								data?.results.map((result, index) => (
									<TableRow key={index}>
										<TableCell>{index + 1}</TableCell>
										{visibleColumns.model && (
											<TableCell>
												<div className="flex flex-col">
													{getModel(result.model) ? (
														<TooltipProvider delayDuration={100}>
															<Tooltip>
																<TooltipTrigger asChild>
																	<div className="flex flex-row items-center gap-1 w-fit">
																		{getModel(result.model)?.name}{' '}
																		{getModel(result.model)
																			?.parameters && (
																			<Badge
																				variant="secondary"
																				className="py-0.5"
																			>
																				{
																					getModel(result.model)
																						?.parameters
																				}
																				B
																			</Badge>
																		)}
																	</div>
																</TooltipTrigger>
																<TooltipContent>
																	<p>{result.model}</p>
																</TooltipContent>
															</Tooltip>
														</TooltipProvider>
													) : (
														result.model
													)}
													{visibleColumns.baseUrl && (
														<>
															<Link
																href={`/provider/${getHost(result.baseUrl)}`}
															>
																<div className="text-gray-500">
																	{getProvider(result.baseUrl) ? (
																		<div className="flex flex-row gap-1 items-center">
																			<Image
																				className="block w-4 h-4"
																				width="16"
																				height="16"
																				src={`https://unavatar.io/google/${getHost(
																					getProvider(
																						result.baseUrl
																					)?.url || result.baseUrl
																				)}`}
																				alt={
																					getProvider(
																						result.baseUrl
																					)?.name || ''
																				}
																			/>
																			{
																				getProvider(result.baseUrl)
																					?.name
																			}
																		</div>
																	) : (
																		getHost(result.baseUrl)
																	)}
																</div>
															</Link>
														</>
													)}
												</div>
											</TableCell>
										)}

										{visibleColumns.avgTokens && (
											<TableCell>
												<div className="flex flex-col md:flex-row items-start md:items-center gap-2">
													<div className="w-full md:w-32 h-2 bg-gray-200 rounded-full overflow-hidden">
														<div
															className="h-full bg-primary"
															style={{
																width: `${
																	(result.avgTokensPerSecond /
																		getMaxValue(
																			data?.results.map(
																				(r) => r.avgTokensPerSecond
																			) || []
																		)) *
																	100
																}%`,
															}}
														/>
													</div>
													<span className="whitespace-nowrap">
														{formatNumber(result.avgTokensPerSecond)}
													</span>
												</div>
											</TableCell>
										)}
										{visibleColumns.maxMinTokens && (
											<TableCell className="whitespace-nowrap">
												{formatNumber(result.maxTokensPerSecond)}/
												{formatNumber(result.minTokensPerSecond)}
											</TableCell>
										)}
										{visibleColumns.totalAvgTokens && (
											<TableCell>
												<div className="flex flex-col md:flex-row items-start md:items-center gap-2">
													<div className="w-full md:w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
														<div
															className="h-full bg-primary"
															style={{
																width: `${
																	(result.avgTokensPerSecondTotal /
																		getMaxValue(
																			data?.results.map(
																				(r) =>
																					r.avgTokensPerSecondTotal
																			) || []
																		)) *
																	100
																}%`,
															}}
														/>
													</div>
													<span className="whitespace-nowrap">
														{formatNumber(result.avgTokensPerSecondTotal)}
													</span>
												</div>
											</TableCell>
										)}
										{visibleColumns.avgLatency && (
											<TableCell>
												<div className="flex flex-col md:flex-row items-start md:items-center gap-2">
													<div className="w-full md:w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
														<div
															className="h-full bg-primary"
															style={{
																width: `${
																	(result.avgFirstTokenLatency /
																		getMaxValue(
																			data?.results.map(
																				(r) => r.avgFirstTokenLatency
																			) || []
																		)) *
																	100
																}%`,
															}}
														/>
													</div>
													<span className="whitespace-nowrap">
														{formatNumber(result.avgFirstTokenLatency / 1000)}s
													</span>
												</div>
											</TableCell>
										)}
										{visibleColumns.maxMinLatency && (
											<TableCell className="whitespace-nowrap">
												{formatNumber(result.maxFirstTokenLatency / 1000)}/
												{formatNumber(result.minFirstTokenLatency / 1000)}s
											</TableCell>
										)}
										{visibleColumns.totalTests && (
											<TableCell>{result.totalTests}</TableCell>
										)}
										{visibleColumns.delete && (
											<TableCell>
												<Button
													variant="ghost"
													size="icon"
													onClick={() => handleDelete(result)}
													className="text-red-500 hover:text-red-700"
												>
													<Trash2 className="h-4 w-4" />
												</Button>
											</TableCell>
										)}
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</div>
			</div>
		</div>
	)
}
