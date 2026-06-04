# 账号与密钥

## API 密钥

本项目需要 LLM API 密钥。将 `.env.example` 复制为 `.env` 并填入：

### Anthropic API（主要）
- 注册地址：https://console.anthropic.com/
- 密钥格式：`sk-ant-api03-xxx...`
- 环境变量：`ANTHROPIC_API_KEY`

### OpenAI API（可选）
- 注册地址：https://platform.openai.com/
- 密钥格式：`sk-xxx...`
- 环境变量：`OPENAI_API_KEY`

## 注意事项

- `.env` 文件已加入 `.gitignore`，不会被提交到仓库
- API 调用会产生费用，开发时注意用量
- 可以通过设置 `ANTHROPIC_BASE_URL` 使用代理或本地模型
