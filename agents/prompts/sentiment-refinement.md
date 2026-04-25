## 任务
分析以下内容的情感倾向和强度。

## 待分析内容
"{{content}}"

## 初步分析结果（参考）
- 主要情感：{{primary}}
- 强度：{{intensity}}
- 检测到的情感词：{{emotions}}

## 情感分类标准
- **positive**：积极正面，如开心、满意、感激、兴奋
- **negative**：消极负面，如难过、生气、失望、焦虑
- **neutral**：中性，无明显情感倾向

## 强度定义
- 0.0-0.3：轻微情感
- 0.3-0.6：中等情感
- 0.6-0.8：强烈情感
- 0.8-1.0：极度强烈情感

## 细粒度情感标签（可选，最多3个）
joy, gratitude, frustration, anger, sadness, anxiety, surprise, confusion, satisfaction, excitement, fear, disgust

## 输出格式
严格遵循以下 JSON 格式：
{
  "primary": "positive或negative或neutral",
  "intensity": 0.0到1.0之间的数字,
  "emotions": ["情感标签1", "情感标签2"],
  "confidence": 0.0到1.0之间的数字
}

直接输出 JSON，不要有前缀或后缀文字。
