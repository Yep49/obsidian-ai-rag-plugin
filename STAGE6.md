# 阶段 6：稳定性与评测实现说明

## ✅ 已实现的功能

### 1. 日志记录服务

**实现位置：** `LoggingService`

**记录内容：**
- 查询文本
- Standalone question
- 召回结果 IDs
- 重排序结果 IDs
- 最终结果 IDs
- 引用 IDs
- 用户纠正（如果有）
- 响应时间

**数据文件：** `query-logs.json`

**限制：** 最多保留 1000 条日志

### 2. 评测指标

**实现位置：** `LoggingService.calculateMetrics()`

**指标定义：**

#### Retrieval Relevance（召回相关性）
```
重排序后保留的比例 = 重排序中保留的召回结果数 / 总召回结果数
```

#### Groundedness（答案基于上下文的程度）
```
引用覆盖率 = 被引用的最终结果数 / 总最终结果数
```

#### Citation Accuracy（引用准确性）
```
引用准确性 = 1 - (用户纠正次数 / 总查询次数)
```

#### Response Time（响应时间）
```
平均响应时间 = 总响应时间 / 总查询次数
```

### 3. 网络容错

**实现位置：** `OpenAiCompatibleHttpClient`

**容错机制：**

#### 自动重试
- 最多重试 3 次
- Rate Limit (429) - 指数退避
- 服务器错误 (5xx) - 固定延迟
- 超时错误 - 固定延迟
- 网络错误 - 固定延迟

#### 超时控制
- 默认超时：30 秒
- 使用 AbortController 实现

#### 指数退避
```
Rate Limit 重试延迟 = 1000ms × (重试次数 + 1)
第1次：1000ms
第2次：2000ms
第3次：3000ms
```

### 4. 错误处理

**友好的错误提示：**
- API 请求失败 → 显示状态码和错误信息
- 超时 → "API request timeout after retries"
- 网络错误 → "Network error: Please check your connection"

**降级策略：**
- 检索失败 → 返回空结果，提示用户
- LLM 调用失败 → 返回原始检索结果
- 重排序失败 → 使用原始排序

### 5. 集成到检索链路

**日志记录点：**
```
Query
  ↓ [记录查询]
Query Analysis
  ↓ [记录 standalone question]
Multi-Recall
  ↓ [记录召回结果]
Fusion
  ↓
Rerank
  ↓ [记录重排序结果]
Compression
  ↓ [记录最终结果]
Generate Answer
  ↓ [记录引用]
End
  ↓ [保存日志]
```

### 6. 命令

#### Show Evaluation Metrics
显示评测指标：
- Retrieval Relevance
- Groundedness
- Citation Accuracy
- Avg Response Time
- Total Queries
- Correction Rate

#### Show Recent Query Logs
显示最近 5 条查询记录

#### Show User Pattern Stats
显示用户模式统计（阶段 5）

## 📊 评测指标解读

### Retrieval Relevance（召回相关性）

**含义：** 召回的结果有多少被重排序保留

**理想值：** 60-80%

**过高（>90%）：** 可能重排序不够激进
**过低（<40%）：** 可能召回质量差或重排序过度

### Groundedness（答案基于上下文）

**含义：** 最终结果有多少被引用

**理想值：** 80-100%

**过低（<60%）：** 可能 LLM 生成了不基于上下文的内容

### Citation Accuracy（引用准确性）

**含义：** 用户纠正的比例（越低越好）

**理想值：** >90%

**过低（<70%）：** 需要优化检索或生成质量

### Response Time（响应时间）

**含义：** 平均响应时间

**理想值：** <5000ms

**过高（>10000ms）：** 需要优化性能

## 🔧 网络容错示例

### Rate Limit 重试
```
请求 → 429 Rate Limit
  ↓
等待 1000ms
  ↓
重试 → 429 Rate Limit
  ↓
等待 2000ms
  ↓
重试 → 200 OK
```

### 超时重试
```
请求 → 30秒超时
  ↓
重试 → 30秒超时
  ↓
重试 → 30秒超时
  ↓
重试 → 30秒超时
  ↓
失败，返回错误
```

### 服务器错误重试
```
请求 → 500 Server Error
  ↓
等待 1000ms
  ↓
重试 → 200 OK
```

## 📈 性能监控

### 查看指标
```
运行命令：Show Evaluation Metrics

输出：
Retrieval Relevance: 75.3%
Groundedness: 92.1%
Citation Accuracy: 88.5%
Avg Response Time: 3245ms
Total Queries: 127
Correction Rate: 11.5%
```

### 查看日志
```
运行命令：Show Recent Query Logs

输出：
Recent Queries:
1. 如何配置 Python 环境？
2. 我的部署流程是什么？
3. API 文档在哪里？
4. 这个错误怎么解决？
5. 上次的配置文件在哪？
```

## ✅ 验收清单

- [x] LoggingService 记录完整链路
- [x] 评测指标计算正确
- [x] 网络容错（重试、超时、指数退避）
- [x] 友好的错误提示
- [x] 集成到检索链路
- [x] 评测命令可用
- [x] 日志命令可用
- [x] README 完整

## 🎯 测试建议

1. **日志测试：** 提问 10 次，检查 query-logs.json 是否记录
2. **指标测试：** 运行 "Show Evaluation Metrics"，查看指标
3. **容错测试：** 断网测试，确认错误提示友好
4. **重试测试：** 模拟 Rate Limit，确认自动重试
5. **超时测试：** 设置短超时，确认超时处理

## 🚀 下一步

阶段 6 完成后：
1. 完整测试所有功能
2. 优化性能瓶颈
3. 准备发布

## 📝 总结

阶段 6 实现了：
- 完整的日志记录
- 科学的评测指标
- 健壮的网络容错
- 友好的错误处理
- 完整的文档

插件现在具备生产级别的稳定性和可观测性！
