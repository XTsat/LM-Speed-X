import { RecentTests } from '@/components/recent-tests'
import { getProvider } from '@/lib/info'

export default async function ProviderPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params
	const provider = getProvider(id)

	return (
		<div className="max-w-2xl mx-auto p-4 space-y-8">
			{provider && (
				<div className="bg-white dark:bg-gray-100 rounded-lg shadow-sm p-6 mb-12">
					<h1 className="text-3xl font-bold mb-2">{provider.name}</h1>
					<a
						href={provider.url}
						target="_blank"
						rel="noopener noreferrer"
						className="text-blue-600 hover:text-blue-800 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
					>
						{provider.url}
					</a>
				</div>
			)}

			<RecentTests host={id} />
		</div>
	)
}
