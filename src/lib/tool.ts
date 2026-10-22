import { toPng } from "dom-to-image-more";
import { toast } from "sonner";

const PIXEL_RATIO = 2;

const roundRect = (
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
  ctx.fill();
};

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode captured image"));
    image.src = src;
  });

/** 面板左上角圆角（CSS px），转换失败时退回 0（即不裁切） */
const readRadius = (node: HTMLElement): number => {
  const value = Number.parseFloat(getComputedStyle(node).borderTopLeftRadius);
  return Number.isFinite(value) ? value : 0;
};

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
    // 不传 bgcolor，PNG 默认透明；圆角之外的像素下面再按面板圆角裁一次
    const raw = await toPng(node, options);
    const image = await loadImage(raw);

    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas is unavailable");

    ctx.drawImage(image, 0, 0);
    // dom-to-image 克隆时圆角外的抗锯齿像素会混进不透明颜色（表现为四角白点），
    // 这里用面板自身的圆角重做一次 alpha 裁切，保证四角是纯透明
    ctx.globalCompositeOperation = "destination-in";
    roundRect(ctx, canvas.width, canvas.height, readRadius(node) * PIXEL_RATIO);

    const link = document.createElement("a");
    link.download = `${name}-${new Date().toISOString().split("T")[0]}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  } catch (error) {
    console.error("Failed to generate image:", error);
    toast.error("Failed to generate image");
  }
};
