'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ChangelogEntry {
  version: string
  date: string
  changes: string[]
  types: ('feature' | 'improvement' | 'fix' | 'original')[]
  commit?: string
  basedOnCommit?: string
}

export default function ChangelogPage() {
  const t = useTranslations('Changelog')

  const entries: ChangelogEntry[] = [
    {
      version: '0.6.1',
      date: '2026-08-11',
      types: ['improvement'],
      commit: '4be28e694e11186bf10e31a66dd9a93e94585425',
      changes: [
        t('entries.v0_6_1.urlFix'),
        t('entries.v0_6_1.intranetImprove'),
        t('entries.v0_6_1.connStatus'),
      ],
    },
    {
      version: '0.6.0',
      date: '2026-08-09',
      types: ['improvement', 'feature'],
      commit: 'f4bd9c285bd9e88fbe96a71047ced1e6da2311d9',
      changes: [
        t('entries.v0_6_0.uiOptimization'),
        t('entries.v0_6_0.summaryPanel'),
        t('entries.v0_6_0.connectivityTest'),
        t('entries.v0_6_0.changelog'),
      ],
    },
    {
      version: '0.5.1',
      date: '2026-08-08',
      types: ['improvement'],
      commit: '9a712822cb1dd9ce3b0069165e110c690a1fcbf5',
      changes: [
        t('entries.v0_5_1.localNetwork'),
      ],
    },
    {
      version: '0.5.0',
      date: '2026-08-02',
      types: ['feature'],
      commit: '7f86e2c649467dc8d6123348c83c8053e2d8b296',
      changes: [
        t('entries.v0_5_0.shareLink'),
        t('entries.v0_5_0.concurrencyOpt'),
      ],
    },
    {
      version: '0.4.0',
      date: '2026-07-06',
      types: ['feature'],
      commit: '7d029290f53f4b9f7d233227acf3a77da789c9d1',
      changes: [
        t('entries.v0_4_0.concurrency'),
        t('entries.v0_4_0.stability'),
        t('entries.v0_4_0.customHeaders'),
      ],
    },
    {
      version: '0.3.0',
      date: '2026-05-27',
      types: ['feature'],
      commit: '0f9aa17b65690698be0d8d6472265f0b99f3eb79',
      changes: [
        t('entries.v0_3_0.rename'),
        t('entries.v0_3_0.importExport'),
      ],
    },
    {
      version: '0.2.1',
      date: '2026-05-26',
      types: ['feature'],
      commit: 'a53bbdb98cd4b7d5eeab01783c56f2f123de6978',
      changes: [
        t('entries.v0_2_1.quickSelect'),
      ],
    },
    {
      version: '0.2.0',
      date: '2026-05-25',
      types: ['improvement'],
      commit: 'bf8763e8cf4291f3fa59c37e50b019503cc5a30f',
      changes: [
        t('entries.v0_2_0.localStorage'),
      ],
    },
    {
      version: '0.1.0',
      date: '2025-03-31',
      types: ['original'],
      basedOnCommit: 'a5d7dc8fd84a5dca55085fae25fa3981ee0731e1',
      changes: [
        t('entries.v0_1_0.realtime'),
        t('entries.v0_1_0.streaming'),
        t('entries.v0_1_0.ranking'),
        t('entries.v0_1_0.export'),
      ],
    },
  ]

  const typeBadge = (type: ChangelogEntry['type']) => {
    switch (type) {
      case 'feature':
        return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{t('feature')}</Badge>
      case 'improvement':
        return <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">{t('improvement')}</Badge>
      case 'fix':
        return <Badge className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">{t('fix')}</Badge>
      case 'original':
        return <Badge className="bg-purple-100 text-purple-800 hover:bg-purple-100">{t('original')}</Badge>
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="pb-16">
        <h1 className="text-3xl font-bold text-center">{t('title')}</h1>
        <p className="mt-2 text-center text-gray-500">{t('subtitle')}</p>
      </div>

      <div className="space-y-6">
        {entries.map((entry, index) => (
          <Card key={index}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl">v{entry.version}</CardTitle>
                <div className="flex items-center gap-2">
                  {entry.types.map((t, i) => (
                    <span key={i}>{typeBadge(t)}</span>
                  ))}
                  <span className="text-sm text-gray-500">{entry.date}</span>
                </div>
              </div>
              <CardDescription>
                {entry.basedOnCommit ? (
                  <span>
                    {t('version')} {entry.version}{' '}
                    <a
                      href={`https://github.com/nexmoe/lm-speed/commit/${entry.basedOnCommit}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:text-blue-800 underline"
                    >
                      {entry.basedOnCommit.slice(0, 7)}
                    </a>
                  </span>
                ) : entry.commit ? (
                  <span>
                    {t('version')} {entry.version}{' '}
                    <a
                      href={`https://github.com/XTsat/LM-Speed-X/commit/${entry.commit}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:text-blue-800 underline"
                    >
                      {entry.commit.slice(0, 7)}
                    </a>
                  </span>
                ) : (
                  <span>{t('version')} {entry.version}</span>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {entry.changes.length > 0 ? (
                <ul className="space-y-2">
                  {entry.changes.map((change, changeIndex) => (
                    <li key={changeIndex} className="flex items-start gap-2 text-gray-600">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                      {change}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-gray-400">{t('noDetails')}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
