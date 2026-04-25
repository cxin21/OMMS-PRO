请分析以下对话，提取用户的 Persona（用户画像）信息。

对话内容：
{{conversationText}}

请提取以下信息：
1. 基本信息：姓名、年龄、性别、职业、地点（如果提到）
2. 性格特征：使用大五人格模型（开放性、尽责性、外向性、宜人性、神经质）
3. 兴趣和爱好：用户表现出的兴趣爱好
4. 沟通风格：正式程度、直接程度、细节偏好等
5. 价值观：用户表现出的价值观
6. 目标：用户提到的短期或长期目标
7. 背景故事：用户的背景信息（如果有）

返回格式（JSON）：
{
  "name": "姓名（可选）",
  "age": "年龄（可选）",
  "gender": "性别（可选）",
  "occupation": "职业（可选）",
  "location": "地点（可选）",
  "personalityTraits": [
    {
      "trait": "特征名称",
      "description": "特征描述",
      "confidence": 0.0-1.0,
      "evidence": ["证据文本"],
      "category": "openness|conscientiousness|extraversion|agreeableness|neuroticism"
    }
  ],
  "interests": [
    {
      "name": "兴趣名称",
      "category": "兴趣分类",
      "level": "casual|interested|passionate|expert",
      "confidence": 0.0-1.0,
      "firstObserved": 时间戳，
      "lastObserved": 时间戳，
      "frequency": 出现次数
    }
  ],
  "communicationStyle": {
    "formality": "very-informal|informal|neutral|formal|very-formal",
    "directness": "very-indirect|indirect|neutral|direct|very-direct",
    "detailPreference": "minimal|summary|moderate|detailed|comprehensive",
    "tone": ["语气特征"]
  },
  "values": ["价值观 1", "价值观 2"],
  "goals": ["目标 1", "目标 2"],
  "background": "背景故事（可选）",
  "confidence": 0.0-1.0,
  "sources": ["conversation"]
}
{{existingPersona}}
