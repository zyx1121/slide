// The import report in the member's words: what was left out of a .pptx,
// with counts.

const NAMES: Record<string, string> = {
  table: "表格",
  "chart or diagram": "圖表或 SmartArt",
  freeform: "自由曲線",
  "picture format": "不支援格式的圖片（如 EMF、SVG、TIFF）",
  "picture crop": "裁切過的圖片（放入了完整圖片）",
  "linked picture": "連結到外部的圖片",
  "turned group": "旋轉過的群組（內容已放入，但沒有旋轉）",
  "embedded content": "內嵌內容",
  "over 1000 shapes": "超過 1,000 個形狀的部分",
  "over 500 slides": "超過 500 頁的部分",
  "repeated slide": "重複列出的投影片",
  "text over the limit":
    "超過字數上限的文字（每個框 5,000 字、每頁 20,000 字）",
};

/** A sentence for the editor after an import, or null when nothing was left out. */
export function describeSkipped(
  skipped: Record<string, number>
): string | null {
  const parts: string[] = [];
  let shapes = 0;
  let placeholders = 0;
  for (const [kind, count] of Object.entries(skipped)) {
    if (!Number.isSafeInteger(count) || count <= 0) continue;
    if (kind.startsWith("shape (")) shapes += count;
    else if (kind.startsWith("placeholder")) placeholders += count;
    else if (NAMES[kind]) parts.push(`${NAMES[kind]} ${count} 個`);
  }
  if (shapes) parts.push(`其他形狀 ${shapes} 個（文字已放入文字方塊）`);
  if (placeholders) parts.push(`空白的版面配置區 ${placeholders} 個`);
  return parts.length > 0 ? `匯入完成。沒有放入：${parts.join("、")}。` : null;
}
