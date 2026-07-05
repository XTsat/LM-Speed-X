import { toPng } from "dom-to-image-more";
import { toast } from "sonner";

export const handleToImage = (id: string) => {
  const node = document.getElementById(id);
  if (!node) {
    toast.error("请等待测试完成");
    return;
  }

  const options: Record<string, unknown> = {
    quality: 1,
    pixelRatio: 2,
    width: node.scrollWidth,
    height: node.scrollHeight,
    style: {
      transform: "scale(1)",
      transformOrigin: "top left",
    },
  };

  if (id === "result") {
    options.bgcolor = "#ffffff";
  }

  toPng(node, options)
    .then(function (dataUrl) {
      const link = document.createElement("a");
      link.download = `lm-speed-test-${
        new Date().toISOString().split("T")[0]
      }.png`;
      link.href = dataUrl;
      link.click();
    })
    .catch(function (error) {
      console.error("Failed to generate image:", error);
      toast.error("Failed to generate image");
    });
};
