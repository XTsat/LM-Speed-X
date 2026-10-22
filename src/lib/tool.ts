import { toPng } from "dom-to-image-more";
import { toast } from "sonner";

const PIXEL_RATIO = 2;

const roundRectPath = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  radius: number
) => {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(width - r, 0);
  ctx.quadraticCurveTo(width, 0, width, r);
  ctx.lineTo(width, height - r);
  ctx.quadraticCurveTo(width, height, width - r, height);
  ctx.lineTo(r, height);
  ctx.quadraticCurveTo(0, height, 0, height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode captured image"));
    image.src = src;
  });

/** 面板四个角里最大的圆角（CSS px）；四个角都是 0 说明本来就没有圆角，不需要裁切 */
const readRadius = (node: HTMLElement): number => {
  const style = getComputedStyle(node);
  return Math.max(
    Number.parseFloat(style.borderTopLeftRadius) || 0,
    Number.parseFloat(style.borderTopRightRadius) || 0,
    Number.parseFloat(style.borderBottomLeftRadius) || 0,
    Number.parseFloat(style.borderBottomRightRadius) || 0
  );
};

export const handleToImage = async (id: string, name = "lm-speed-x"): Promise<void> => {
  const node = document.getElementById(id);
  if (!node) {
    toast.error("Please wait for the test to complete");
    return;
  }

  const background = getComputedStyle(node).backgroundColor;

  const options: Record<string, unknown> = {
    quality: 1,
    pixelRatio: PIXEL_RATIO,
    // 圆角边缘的合成像素会与底色混合：垫上面板自身底色，边缘就不会混出白边
    ...(background && background !== "rgba(0, 0, 0, 0)" ? { bgcolor: background } : {}),
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
    const raw = await toPng(node, options);
    const image = await loadImage(raw);

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");

    // dom-to-image 把克隆画进 SVG 再栅格化，圆角之外的抗锯齿像素可能混进不透明颜色（表现为四角白点），
    // 所以这里按面板自身的圆角重新 clip 一次：画布本身透明，圆角外不落笔，四角自然是纯 alpha=0
    const radius = readRadius(node) * PIXEL_RATIO;
    if (radius > 0) {
      ctx.save();
      roundRectPath(ctx, canvas.width, canvas.height, radius);
      ctx.clip();
    }
    ctx.drawImage(image, 0, 0);
    if (radius > 0) ctx.restore();

    const link = document.createElement("a");
    link.download = `${name}-${new Date().toISOString().split("T")[0]}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    console.error("Failed to generate image:", error);
    toast.error("Failed to generate image");
  }
};
