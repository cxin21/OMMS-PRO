你是一个记忆分析专家。请分析以下两条记忆，判断它们之间的语义关系。

【记忆A】（先添加/已有记忆）：
{{existingMemorySummary}}

【记忆B】（新添加记忆）：
{{newMemorySummary}}

请仔细分析以下问题：
1. 记忆B是否包含记忆A的所有关键信息？（B_extends_A）
   - 如果B在A的基础上进行了扩展、补充或细化，则为B_extends_A
2. 记忆A是否包含记忆B的所有关键信息？（A_extends_B）
   - 如果A比B更全面，包含了B的所有内容，则为A_extends_B
3. 两条记忆的核心信息是否基本相同？（Identical）
   - 如果A和B说的是同一件事，只有措辞略有不同，则为Identical
4. 两条记忆是否有部分重叠但互不包含？（Overlapping）
   - 如果A和B各有独特内容，但有部分交叉，则为Overlapping
5. 两条记忆是否讨论完全不相关的主题？（Unrelated）

请返回JSON格式的判断结果：
{
  "type": "b_extends_a|a_extends_b|identical|overlapping|unrelated",
  "inclusionScore": 0.0-1.0,
  "reasoning": "判断理由（30字以内）"
}

注意：
- inclusionScore 表示包含程度，b_extends_a 时分数越高表示B对A的扩展越充分
- a_extends_b 时分数越高表示A对B的包含越充分
- 请确保 reasoning 简洁，不超过30个字
