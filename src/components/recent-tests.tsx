"use client";
import { useTranslations } from "next-intl";
import { useState, useEffect } from "react";
import { getRecentTests, type SpeedTestResult } from "@/lib/local-storage";

interface Props {
  host?: string;
}

export function RecentTests(params: Props) {
  const { host } = params;
  const t = useTranslations("RecentTests");
  const tRank = useTranslations("rank");
  const [recentTests, setRecentTests] = useState<SpeedTestResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadRecentTests = () => {
      try {
        setLoading(true);
        const tests = getRecentTests(10);
        
        // 如果指定了 host，则过滤
        const filtered = host 
          ? tests.filter(test => {
              try {
                return new URL(test.baseUrl).host === host;
              } catch {
                return false;
              }
            })
          : tests;
        
        setRecentTests(filtered);
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load recent tests');
        console.error('Error loading recent tests:', err);
      } finally {
        setLoading(false);
      }
    };

    loadRecentTests();

    // 监听测试完成事件
    const handleTestCompleted = () => {
      loadRecentTests();
    };

    window.addEventListener('lm-speed-test-completed', handleTestCompleted);
    return () => window.removeEventListener('lm-speed-test-completed', handleTestCompleted);
  }, [host]);

  if (loading) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-white shadow overflow-hidden rounded-lg p-4 text-center text-gray-500">
          {t('loading')}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-red-50 text-red-500 shadow overflow-hidden rounded-lg p-4 text-center">
          {error}
        </div>
      </div>
    );
  }

  if (recentTests.length === 0) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-gray-50 shadow overflow-hidden rounded-lg p-4 text-center text-gray-500">
          {t('noTests')}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="w-full text-xl text-center font-semibold mb-4">
        {t("recentTests")}
      </h2>
      <div className="bg-white shadow overflow-hidden rounded-lg">
        <ul className="divide-y divide-gray-200">
          {recentTests.map((test) => {
            // 计算平均值
            const avgTokensPerSecond = test.results.length > 0
              ? test.results.reduce((sum, r) => sum + r.tokensPerSecond, 0) / test.results.length
              : 0;
            const avgFirstTokenLatency = test.results.length > 0
              ? test.results.reduce((sum, r) => sum + r.firstTokenLatency, 0) / test.results.length
              : 0;
            
            return (
              <li key={test.id} className="px-4 py-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {test.results[0]?.model || 'Unknown'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {(() => {
                        try {
                          return new URL(test.baseUrl).host;
                        } catch {
                          return test.baseUrl;
                        }
                      })()}
                    </p>
                    <div className="mt-1 text-xs text-gray-400">
                      <span className="mr-4">
                        {tRank("table.avgTokens")}{" "}
                        {avgTokensPerSecond?.toFixed(2)} t/s
                      </span>
                      <span>
                        {tRank("table.avgLatency")}{" "}
                        {avgFirstTokenLatency
                          ? (avgFirstTokenLatency / 1000).toFixed(2)
                          : "-"}
                        s
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-gray-500">
                    {new Date(test.timestamp).toLocaleString()}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}