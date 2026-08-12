'use client'

import { useTranslations } from 'next-intl'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'

interface ChangelogEntry {
  version: string
  date: string
  changes: { text: string; sub?: string[] }[]
  types: ('feature' | 'improvement' | 'fix' | 'original')[]
  tag?: string
  basedOnCommit?: string
}

export default function ChangelogPage() {
  const t = useTranslations('Changelog')

  const entries: ChangelogEntry[] = [
    {
      version: '0.7.1',
      date: '2026-08-12',
      types: ['improvement', 'fix'],
      tag: 'v0.7.1',
      changes: [
        { text: t('entries.v0_7_1.projectCleanup') },
        { text: t('entries.v0_7_1.projectInfo') },
        { text: t('entries.v0_7_1.connectivitySort') },
      ],
    },
    {
      version: '0.7.0',
      date: '2026-08-12',
      types: ['feature'],
      tag: 'v0.7.0',
      changes: [
        {
          text: t('entries.v0_7_0.modelVerify'),
          sub: [
            t('entries.v0_7_0.verifyRepeat'),
            t('entries.v0_7_0.verifySelf'),
            t('entries.v0_7_0.verifyMath'),
          ],
        },
      ],
    },
    {
      version: '0.6.1',
      date: '2026-08-11',
      types: ['improvement'],
      tag: 'v0.6.1',
      changes: [
        { text: t('entries.v0_6_1.urlFix') },
        { text: t('entries.v0_6_1.intranetImprove') },
        { text: t('entries.v0_6_1.connStatus') },
      ],
    },
    {
      version: '0.6.0',
      date: '2026-08-09',
      types: ['improvement', 'feature'],
      tag: 'v0.6.0',
      changes: [
        { text: t('entries.v0_6_0.uiOptimization') },
        { text: t('entries.v0_6_0.summaryPanel') },
        { text: t('entries.v0_6_0.connectivityTest') },
        { text: t('entries.v0_6_0.changelog') },
      ],
    },
    {
      version: '0.5.1',
      date: '2026-08-08',
      types: ['improvement'],
      tag: 'v0.5.1',
      changes: [
        { text: t('entries.v0_5_1.localNetwork') },
      ],
    },
    {
      version: '0.5.0',
      date: '2026-08-02',
      types: ['feature'],
      tag: 'v0.5.0',
      changes: [
        { text: t('entries.v0_5_0.shareLink') },
        { text: t('entries.v0_5_0.concurrencyOpt') },
      ],
    },
    {
      version: '0.4.0',
      date: '2026-07-06',
      types: ['feature'],
      tag: 'v0.4.0',
      changes: [
        { text: t('entries.v0_4_0.concurrency') },
        { text: t('entries.v0_4_0.stability') },
        { text: t('entries.v0_4_0.customHeaders') },
      ],
    },
    {
      version: '0.3.0',
      date: '2026-05-27',
      types: ['feature'],
      tag: 'v0.3.0',
      changes: [
        { text: t('entries.v0_3_0.rename') },
        { text: t('entries.v0_3_0.importExport') },
      ],
    },
    {
      version: '0.2.1',
      date: '2026-05-26',
      types: ['feature'],
      tag: 'v0.2.1',
      changes: [
        { text: t('entries.v0_2_1.quickSelect') },
      ],
    },
    {
      version: '0.2.0',
      date: '2026-05-25',
      types: ['improvement'],
      tag: 'v0.2.0',
      changes: [
        { text: t('entries.v0_2_0.localStorage') },
      ],
    },
    {
      version: '0.1.0',
      date: '2025-03-31',
      types: ['original'],
      basedOnCommit: 'a5d7dc8fd84a5dca55085fae25fa3981ee0731e1',
      changes: [
        { text: t('entries.v0_1_0.realtime') },
        { text: t('entries.v0_1_0.streaming') },
        { text: t('entries.v0_1_0.ranking') },
        { text: t('entries.v0_1_0.export') },
      ],
    },
  ]

  const typeBadge = (type: ChangelogEntry['types'][number]) => {
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
                ) : entry.tag ? (
                  <span>
                    <a
                      href={`https://github.com/XTsat/LM-Speed-X/releases/tag/${entry.tag}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-blue-600 hover:text-blue-800 underline"
                    >
                      {t('version')} {entry.version}
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
                    <li key={changeIndex}>
                      <div className="flex items-start gap-2 text-gray-600">
                        <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gray-400" />
                        {change.text}
                      </div>
                      {change.sub && (
                        <ul className="mt-1 ml-5 space-y-1">
                          {change.sub.map((sub, subIndex) => (
                            <li key={subIndex} className="flex items-start gap-2 text-sm text-gray-500">
                              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray-300" />
                              {sub}
                            </li>
                          ))}
                        </ul>
                      )}
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
