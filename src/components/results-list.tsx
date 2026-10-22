"use client";
import { type SpeedTestResult } from "@/lib/types";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { copyToClipboard } from "@/lib/clipboard";
import { COLLAPSE_BAR_CLASS, COLLAPSE_ITEM_CLASS, CollapsiblePanel } from "./collapsible-panel";
import { ResultBody } from "./result-body";

type SpeedTestResultCard = SpeedTestResult & {
  status?: "pending" | "running" | "completed";
};

interface Props {
  results: SpeedTestResultCard[];
  expandedIndex: number | null;
  streamContents: {
    [key: number]: string;
  };
  onToggle?: (index: number) => void;
  /** 导出整份报告图片时需要临时展开所有请求，否则截图里只有折叠条 */
  forceExpanded?: boolean;
}

export function ResultsList({ results, expandedIndex, streamContents, onToggle, forceExpanded = false }: Props) {
  const t = useTranslations("SpeedTest");
  const tRank = useTranslations("rank");
  // 明细默认展开、每条请求默认折叠：请求数固定为 5，折叠到单行后页面才不至于过长
  const [detailsOpen, setDetailsOpen] = useState(true);

  return (
    <CollapsiblePanel
      open={forceExpanded || detailsOpen}
      onToggle={() => setDetailsOpen(!detailsOpen)}
      headerClassName={COLLAPSE_BAR_CLASS}
      header={
        <span>
          {t("results.title")}
          <span className="ml-2 text-sm font-normal text-gray-500">
            ({results.length})
          </span>
        </span>
      }
      bodyClassName="mt-4"
    >
      <div className="space-y-6">
        {results.map((result, index) => {
          // 正在跑的请求由表单侧自动展开（expandedIndex），收起后仍可再点开
          const open = forceExpanded || expandedIndex === index;
          const itemClass =
            result.status === "pending"
              ? "p-4 rounded-lg bg-gray-100 border border-gray-200"
              : result.status === "running"
                ? "p-4 rounded-lg bg-blue-50 dark:bg-blue-500/15"
                : COLLAPSE_ITEM_CLASS;
          return (
          <CollapsiblePanel
            key={index}
            open={open}
            disabled={result.status === "pending"}
            onToggle={() => onToggle?.(index)}
            headerClassName={itemClass}
            bodyClassName="mt-4"
            header={
              <div className="flex justify-between items-center">
                <div className="flex-1">
                  <h3 className="text-gray-700 font-medium mb-1">
                    {t("results.prompt")}: {result.prompt}
                  </h3>
                  <p className="text-gray-600 text-sm">
                    {t("results.model")}: {result.model}
                  </p>
                </div>
                <div className="ml-4 flex items-center gap-3">
                  {result.status === "completed" && result.outputToken > 0 && (
                    <span className="text-gray-500 text-xs font-mono">
                      {result.outputToken} · {result.tokensPerSecond.toFixed(2)} t/s
                    </span>
                  )}
                  {result.status === "pending" && (
                    <span className="text-gray-500">
                      {t("results.status.pending")}
                    </span>
                  )}
                  {result.status === "running" && (
                    <span className="text-blue-400">
                      {t("results.status.running")}
                    </span>
                  )}
                  {result.status === "completed" && (
                    <span className="text-green-400">
                      {t("results.status.completed")}
                    </span>
                  )}
                </div>
              </div>
            }
          >
            <ResultBody
              metrics={[
                { label: t("results.metrics.firstTokenLatency"), value: result.status === "completed" ? `${(result.firstTokenLatency / 1000).toFixed(2)} s` : "-" },
                { label: t("results.metrics.totalTime"), value: result.status === "completed" ? `${(result.totalTime / 1000).toFixed(2)} s` : "-" },
                { label: tRank("table.avgTokens"), value: result.status !== "pending" ? `${result.tokensPerSecond.toFixed(2)} t/s` : "-" },
                { label: t("results.metrics.outputToken"), value: result.status !== "pending" ? `${result.outputToken} (${(result.outputTime / 1000).toFixed(2)}s)` : "-" },
              ]}
              outputTitle={`${t("results.output.title")}:`}
              copyLabel={t("results.output.copy")}
              contentId={`content-${index}`}
              onCopy={() => { const text = streamContents[index]; if (text) copyToClipboard(text) }}
              content={streamContents[index] || (result.status === "pending" ? t("results.output.waiting") : t("results.output.loading"))}
            />
          </CollapsiblePanel>
          );
        })}
      </div>
    </CollapsiblePanel>
  );
}
