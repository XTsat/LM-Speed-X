import { toPng } from "dom-to-image-more";
import { toast } from "sonner";

const PIXEL_RATIO = 2;

export const handleToImage = async (id: string, name = "lm-speed-test"): Promise<void> => {
  const node = document.getElementById(id);
  if (!node) {
    toast.error("Please wait for the test to complete");
    return;
  }

  const options: Record<string, unknown> = {
    quality: 1,
    pixelRatio: PIXEL_RATIO,
    width: node.scrollWidth,
    height: node.scrollHeight,
    style: {
      transform: "scale(1)",
      transformOrigin: "top left",
    },
    // 浏览器扩展/CDN 注入的样式表读取 cssRules 会抛 SecurityError 并写进控制台，导出时统一跳过
    loadExternalStyleSheet: () => false,
  };

  try {
    // 不传 bgcolor，PNG 保留透明背景与面板自身的圆角
    const dataUrl = await toPng(node, options);
    const link = document.createElement("a");
    link.download = `${name}-${new Date().toISOString().split("T")[0]}.png`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("Failed to generate image:", error);
    toast.error("Failed to generate image");
  }
};
