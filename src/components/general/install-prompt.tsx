'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import { Download } from 'lucide-react'
import { Button, type ButtonProps } from '@/components/ui/button'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'

// Chromium 专有事件,lib.dom 中没有类型定义
interface BeforeInstallPromptEvent extends Event {
	readonly platforms: string[]
	readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
	prompt: () => Promise<void>
}

// 事件在页面加载时只触发一次,而 Header 里桌面与移动端各渲染一个按钮
// (移动端菜单是条件渲染,打开时才挂载)。用模块级状态共享,避免后挂载的实例错过事件。
let deferredPrompt: BeforeInstallPromptEvent | null = null
let isInstalled = false
let listenersBound = false
const subscribers = new Set<() => void>()

function notify() {
	subscribers.forEach((notifySubscriber) => notifySubscriber())
}

function bindWindowListeners() {
	if (listenersBound || typeof window === 'undefined') return
	listenersBound = true

	// 已从桌面/主屏幕启动(独立窗口)时无需再提示安装;iOS 用 navigator.standalone 标记
	const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
	if (window.matchMedia('(display-mode: standalone)').matches || iosStandalone) {
		isInstalled = true
		return
	}

	window.addEventListener('beforeinstallprompt', (event) => {
		// 拦住浏览器自带的安装提示,改由页面按钮在用户点击时触发
		event.preventDefault()
		deferredPrompt = event as BeforeInstallPromptEvent
		notify()
	})
	window.addEventListener('appinstalled', () => {
		deferredPrompt = null
		isInstalled = true
		notify()
	})
}

function subscribe(notifySubscriber: () => void) {
	subscribers.add(notifySubscriber)
	return () => {
		subscribers.delete(notifySubscriber)
	}
}

function getSnapshot() {
	return deferredPrompt
}

function getServerSnapshot() {
	return null
}

/**
 * 应用内安装入口。浏览器判定可安装时点击唤起原生安装框;
 * 拿不到安装事件时(HTTP 非安全上下文、iOS / Firefox、事件尚未触发)
 * 退化为说明对话框,告诉用户该走哪条手动安装路径。
 */
export function InstallPrompt({
	className,
	size = 'sm',
}: {
	className?: string
	size?: ButtonProps['size']
}) {
	const t = useTranslations('Header')
	const prompt = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
	const [isGuideOpen, setIsGuideOpen] = useState(false)
	const [isInsecureContext, setIsInsecureContext] = useState(false)

	useEffect(() => {
		bindWindowListeners()
		setIsInsecureContext(!window.isSecureContext)
		// 事件可能在首次挂载前就已触发,重新通知一次让本实例同步到共享状态
		notify()
	}, [])

	const handleInstall = async () => {
		if (!prompt) {
			setIsGuideOpen(true)
			return
		}
		try {
			await prompt.prompt()
			await prompt.userChoice
			deferredPrompt = null
			notify()
		} catch {
			// 事件已失效(如被浏览器回收)时退回手动指引
			setIsGuideOpen(true)
		}
	}

	if (isInstalled) return null

	return (
		<>
			<Button variant="outline" size={size} className={className} onClick={handleInstall}>
				<Download className="h-4 w-4" />
				{t('install')}
			</Button>
			<Dialog open={isGuideOpen} onOpenChange={setIsGuideOpen}>
				<DialogContent className="max-w-md">
					<DialogHeader>
						<DialogTitle className="flex items-center gap-2">
							<Download className="h-5 w-5 text-muted-foreground" />
							{t('install')}
						</DialogTitle>
						<DialogDescription>
							{isInsecureContext ? t('installInsecure') : t('installManual')}
						</DialogDescription>
					</DialogHeader>
					{!isInsecureContext && (
						<ul className="space-y-2 text-sm text-muted-foreground">
							<li>{t('installChrome')}</li>
							<li>{t('installSafari')}</li>
						</ul>
					)}
					<DialogFooter>
						<Button onClick={() => setIsGuideOpen(false)}>{t('installClose')}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
