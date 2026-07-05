'use client'

import { SpeedTestForm } from '@/components/speed-test-form'
import { ProductFeatures } from '@/components/home/product-features'
import { RecentTests } from '@/components/recent-tests'
import { StabilityTest } from '@/components/stability-test'
import { FAQ } from '@/components/home/faq'
import { useTranslations } from 'next-intl'

export default function Home() {
	const t = useTranslations('HomePage')

	return (
		<div className="min-h-screen">
			<main className="space-y-48">
				<div className="max-w-4xl mx-auto">
					<h1 className="text-3xl font-bold text-center">{t('title')}</h1>
					<p className="my-2 max-w-4xl mx-auto text-lg text-center leading-6 text-gray-600">
						{t('subtitle')}
					</p>
					<p className="my-2 max-w-4xl mx-auto text-lg text-center leading-6 text-gray-600">
						{t('subtitle2')}
					</p>
					<SpeedTestForm />
				</div>
				<div className="max-w-4xl mx-auto">
					<StabilityTest />
				</div>
				<RecentTests />
				<ProductFeatures />
				<FAQ />
			</main>
		</div>
	)
}
