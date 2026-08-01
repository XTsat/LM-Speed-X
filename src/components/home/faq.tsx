'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { ChevronDown } from 'lucide-react'

interface FAQItem {
	question: string
	answer: string
}

export function FAQ() {
	const t = useTranslations('FAQ')
	const [expandedIndex, setExpandedIndex] = useState<number | null>(null)

	const faqKeys = ['performance', 'comparison', 'monitoring', 'dataStorage', 'urlParams', 'providerSupport'] as const
	const faqItems: FAQItem[] = faqKeys.map((key) => ({
		question: t(`questions.${key}.question`),
		answer: t(`questions.${key}.answer`),
	}))

	return (
		<div className="mx-auto max-w-7xl px-6 lg:px-8 ">
			<div className="bg-[#0B0B0B] p-16 rounded-3xl mx-auto max-w-6xl grid grid-cols-1 md:grid-cols-12 gap-8">
				<div className="md:col-span-4">
					<h2 className="text-2xl font-bold mb-2 text-white">{t('title')}</h2>
					<p className="text-gray-400">{t('subtitle')}</p>
				</div>
				<div className="md:col-span-8 space-y-4">
					{faqItems.map((item, index) => (
						<div
							key={index}
							className="bg-[#131415] rounded-lg shadow-sm overflow-hidden transition-all duration-200"
						>
							<button
								className="w-full px-6 py-4 text-left flex justify-between items-center "
								onClick={() => setExpandedIndex(expandedIndex === index ? null : index)}
							>
								<span className="font-medium text-white">{item.question}</span>
								<ChevronDown
									className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${expandedIndex === index ? 'rotate-180' : ''}`}
								/>
							</button>
							{expandedIndex === index && (
								<div className="px-6 pb-4">
									<p className="text-gray-400">{item.answer}</p>
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</div>
	)
}