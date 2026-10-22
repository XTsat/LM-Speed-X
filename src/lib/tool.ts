import { toPng } from "dom-to-image-more";
import { toast } from "sonner";

export const handleToImage = async (id: string): Promise<void> => {
  const node = document.getElementById(id);
  if (!node) {
    toast.error("Please wait for the test to complete");
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

  try {
    const dataUrl = await toPng(node, options);
    const link = document.createElement("a");
    link.download = `lm-speed-test-${
      new Date().toISOString().split("T")[0]
    }.png`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("Failed to generate image:", error);
    toast.error("Failed to generate image");
  }
};
