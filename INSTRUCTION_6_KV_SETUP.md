# ☁️ Vercel KV 数据库设置指南

> 如果公网注册报「服务器内部错误」，通常是因为 **KV 数据库未创建** 或 **环境变量未注入**。

## 1️⃣ 诊断结果（已执行）

| 检查项 | 结果 |
|--------|------|
| 代码使用 `@vercel/kv` 读取的环境变量 | `KV_REST_API_URL`, `KV_REST_API_TOKEN` |
| 当前 Vercel 项目中是否存在 KV 环境变量 | ❌ **不存在**（只有 9 个其他变量） |
| 本地 `.env.local` 是否存在 KV 变量 | ❌ 不存在 |
| 代码修复：无 KV 时自动 fallback 到内存 | ✅ 已推送（不会再报 500，但数据不跨实例共享） |

## 2️⃣ Vercel Dashboard 操作（必须，建议优先）

### 方式 A：通过 Vercel Dashboard 创建（推荐）

1. 打开 [Vercel Dashboard](https://vercel.com/zhaos-projects16/cloud-family/stores)
2. 点击 **Storage** → **Create Database**
3. 选择 **KV (Upstash)**
4. 选择最近的区域（如 **Tokyo**）
5. 点击 **Create**
6. 创建完成后，点击 **Connect to Project**
7. 选择 `cloud-family` 项目
8. Vercel 会自动注入以下环境变量：
   - `KV_REST_API_URL`
   - `KV_REST_API_TOKEN`
   - `KV_REST_API_READ_ONLY_TOKEN`
   - `KV_URL`
9. 重新部署项目即可生效

> ⚡ **整个流程约 2 分钟，之后注册功能即可正常使用。**

### 方式 B：通过 CLI（如方式 A 不可用）

```bash
# 1. 登录
npx vercel login

# 2. 打开 Upstash 集成页面
npx vercel integration open upstash

# 3. 在浏览器中完成创建并关联项目
```

## 3️⃣ 代码已做的修复

| 文件 | 改动 |
|------|------|
| `src/lib/kvClient.ts` | **新增** — 自动检测 KV 环境变量，有则用 `@vercel/kv`，无则用内存 Map fallback |
| `src/lib/verifyCode.ts` | 改为使用 `kvClient` 的统一客户端，不再直接引用 `@vercel/kv` |
| `src/lib/userStore.ts` | 同上 |
| `src/lib/familyStore.ts` | 同上 |

**核心逻辑：**
```
有 KV_REST_API_URL + KV_REST_API_TOKEN → @vercel/kv（生产环境）
否则 → 内存 Map 存储（本地开发 / 未配置 KV）
```

## 4️⃣ 需要管理员操作的清单

- [ ] 创建 KV 数据库（步骤见第 2 节）
- [ ] 关联到 `cloud-family` 项目
- [ ] （可选）在本地 `.env.local` 中添加 KV 变量以支持本地 KV 调试
- [ ] 重新部署到 Vercel
- [ ] 验证注册流程不再报错

---

> 创建 KV 后，之前用内存方式存储的数据（如验证码、用户记录）不会迁移到 KV 中，但这些数据都是临时性的，用户重新注册即可。