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

type InstallEnvironment =
	| 'in-app'
	| 'ios-safari'
	| 'ios-other'
	| 'safari-desktop'
	| 'firefox'
	| 'android'
	| 'chromium'

interface InstallState {
	installed: boolean
	/** 浏览器是否已派发 beforeinstallprompt（即它自己会显示地址栏图标 / 菜单安装项） */
	installable: boolean
}

const INITIAL_STATE: InstallState = { installed: false, installable: false }
let state = INITIAL_STATE
const subscribers = new Set<() => void>()

function setState(next: InstallState) {
	state = next
	subscribers.forEach((notifySubscriber) => notifySubscriber())
}

function subscribe(notifySubscriber: () => void) {
	subscribers.add(notifySubscriber)
	return () => {
		subscribers.delete(notifySubscriber)
	}
}

function getSnapshot() {
	return state
}

function getServerSnapshot() {
	return INITIAL_STATE
}

/**
 * 浏览器只在可安装时派发一次 beforeinstallprompt,且时机不确定。
 * 这里不调用 preventDefault()——安装入口（地址栏图标、浏览器菜单安装项）留给浏览器自己展示,
 * 页面只把它当作「当前可安装」的信号,用来给出准确指引。
 */
function bindInstallListeners() {
	if (typeof window === 'undefined') return

	// 已从桌面 / 主屏幕启动时无需再提示安装;iOS 用 navigator.standalone 标记
	const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true
	if (window.matchMedia('(display-mode: standalone)').matches || iosStandalone) {
		setState({ installed: true, installable: false })
		return
	}

	window.addEventListener('beforeinstallprompt', () => {
		setState({ installed: false, installable: true })
	})
	window.addEventListener('appinstalled', () => {
		setState({ installed: true, installable: false })
	})
}

bindInstallListeners()

/**
 * 判断当前环境属于哪类安装路径。只有 Chromium 系浏览器会派发安装事件,
 * 其余环境（iOS、Firefox、App 内置浏览器）需要给出各自的安装方式。
 */
function detectEnvironment(): InstallEnvironment {
	const ua = navigator.userAgent

	// 微信 / QQ / 钉钉等内置浏览器既没有安装入口,也不注册 Service Worker
	if (
		/MicroMessenger|QQ\/|DingTalk|Weibo|AlipayClient|Alipay|FBAN|FBAV|Instagram|Line\/|Snapchat|Quark|baiduboxapp|MiuiBrowser|HeyTapBrowser/i.test(
			ua,
		)
	) {
		return 'in-app'
	}
	if (/Firefox|FxiOS/i.test(ua)) return 'firefox'

	const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
	if (isIOS) return /CriOS|EdgiOS|OPiOS|GSA\//.test(ua) ? 'ios-other' : 'ios-safari'
	if (/Android/i.test(ua)) return 'android'
	if (/Safari/i.test(ua) && !/Chrome|Chromium|Edg|OPR/i.test(ua)) return 'safari-desktop'
	return 'chromium'
}

/**
 * 应用内安装说明。安装入口归浏览器所有（地址栏图标或浏览器菜单）,
 * 这里按当前浏览器告诉用户入口在哪;拿不到安装事件时说明浏览器当前没有提供入口。
 */
export function InstallPrompt({
	className,
	size = 'sm',
}: {
	className?: string
	size?: ButtonProps['size']
}) {
	const t = useTranslations('Header')
	const { installed, installable } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
	const [isGuideOpen, setIsGuideOpen] = useState(false)
	const [isInsecureContext, setIsInsecureContext] = useState(false)
	const [environment, setEnvironment] = useState<InstallEnvironment | null>(null)

	useEffect(() => {
		setIsInsecureContext(!window.isSecureContext)
		setEnvironment(detectEnvironment())
	}, [])

	if (installed) return null

	const guideText = (() => {
		switch (environment) {
			case 'in-app':
				return t('installInApp')
			case 'ios-safari':
				return t('installSafari')
			case 'ios-other':
				return t('installIosOther')
			case 'safari-desktop':
				return t('installSafariDesktop')
			case 'firefox':
				return t('installFirefox')
			case 'android':
				return t('installAndroid')
			default:
				return t('installChrome')
		}
	})()

	return (
		<>
			<Button variant="outline" size={size} className={className} onClick={() => setIsGuideOpen(true)}>
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
							{isInsecureContext
								? t('installInsecure')
								: installable
									? t('installBrowserReady')
									: t('installManual')}
						</DialogDescription>
					</DialogHeader>
					{!isInsecureContext && <p className="text-sm text-muted-foreground">{guideText}</p>}
					<DialogFooter>
						<Button onClick={() => setIsGuideOpen(false)}>{t('installClose')}</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</>
	)
}
