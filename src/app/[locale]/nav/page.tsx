'use client';

import { useState, useEffect } from "react";
import { Link } from "@/i18n/routing";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getProvider } from "@/lib/info";
import { Button } from "@/components/ui/button";
import { getProviders, getTestResults } from "@/lib/local-storage";
import { useTranslations } from "next-intl";

interface Provider {
  baseUrl: string;
}

export default function NavPage() {
  const t = useTranslations('Nav');
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);

  const getHostFromBaseUrl = (baseUrl: string) => {
    return baseUrl.includes("http") ? new URL(baseUrl).host : baseUrl;
  };

  const loadProviders = () => {
    // 从 localStorage 获取 providers
    const localProviders = getProviders();
    
    // 从测试结果中提取 baseUrl
    const testResults = getTestResults();
    const baseUrls = new Set<string>();
    
    testResults.forEach(result => {
      baseUrls.add(result.baseUrl);
    });
    
    // 合并来源
    const allHosts = new Set<string>();
    localProviders.forEach(host => {
      allHosts.add(host);
    });
    
    baseUrls.forEach(baseUrl => {
      allHosts.add(getHostFromBaseUrl(baseUrl));
    });
    
    // 转换为 Provider 数组
    const providerList: Provider[] = Array.from(allHosts).map(host => ({
      baseUrl: host.includes("http") ? host : `https://${host}`
    }));
    
    setProviders(providerList);
    setLoading(false);
  };

  useEffect(() => {
    loadProviders();

    // 监听自定义事件，用于同一页面内的数据更新通知
    const handleTestCompleted = () => {
      loadProviders();
    };

    window.addEventListener('lm-speed-test-completed', handleTestCompleted);

    return () => {
      window.removeEventListener('lm-speed-test-completed', handleTestCompleted);
    };
  }, []);
  


  return (
    <div className="container mx-auto py-8 px-4">
      <h1 className="text-3xl font-bold mb-6">{t('title')}</h1>
      <p className="mb-8 text-gray-600">
        {t('subtitle')}
      </p>

      {loading && (
        <div className="flex justify-center">
          <div className="bg-white dark:bg-gray-100 shadow overflow-hidden rounded-lg p-4 text-center text-gray-500">
            {t('loading')}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {providers.map((provider, index) => {
          const host = getHostFromBaseUrl(provider.baseUrl);
          const providerInfo = getProvider(host);

          return (
            <Card key={index} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <CardTitle>{providerInfo?.name || host}</CardTitle>
                <CardDescription>
                  {providerInfo?.url ? (
                    <a
                      href={providerInfo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-600 hover:text-blue-800 transition-colors dark:text-blue-400 dark:hover:text-blue-300"
                    >
                      {providerInfo.url}
                    </a>
                  ) : (
                    host
                  )}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild>
                  <Link href={`/provider/${host}`}>{t('viewResults')}</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
