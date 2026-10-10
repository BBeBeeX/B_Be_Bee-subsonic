# B_Be_Bee-subsonic（Subsonic 兼容服务器音乐源）

对接任何 **Subsonic / Navidrome / Airsonic** 兼容服务器的音乐源。
纯 JSON 规则文档：没有 `source.js`，全部端点用字符串模板 + JSONPath 表达。

## 参数与凭据说明

本源由 B_Be_Bee 播放器及统一配置 UI（Group 4）消费，参数配置规范如下：

- **服务器地址 (`host`)**：配置为 `sourceUrl`（例如 `https://music.example.org`）。
- **认证凭据 (`user` 与 `password`)**：通过 `loginUi` 表单输入，并保存至安全凭据库（Secure Credential Store）。
  - `loginUi` 声明结构：
    ```json
    "loginUi": [
      { "id": "user", "label": "Username", "type": "text" },
      { "id": "password", "label": "Password", "type": "password" }
    ]
    ```
- **重要说明**：host 配置为 sourceUrl，凭据 user 和 password 通过 loginUi 输入并保存至安全凭据库。同时保留了 `variableComment: "username:password"` 作为备用兼容。
- Navidrome 用户注意：Subsonic 协议的密码参数是可逆编码而非哈希，BBeBee 走 `f=json` 的 REST 参数携带。请使用服务器为应用单独生成的用户/密码，不要复用主账号。

## 核心字段说明

| 字段 | 值 / 示例 | 说明 |
|---|---|---|
| `sourceUrl` | `https://music.example.org` | 服务器基址（host 映射项） |
| `loginUi` | `[{ id: "user", ... }, { id: "password", ... }]` | 用户名与密码凭据输入界面规范 |
| `searchUrl` | `/rest/search3?...` | 歌曲搜索端点，`songCount=50`，客户端标识 `c=BBeBee` |
| `exploreUrl` | JSON 数组 | 两个发现栏目：Recently added / Alphabetical |
| `ruleExplore` | `$.subsonic-response.albumList2.album[*]` | 行类型 `=album`，`childUrl` 指向 `getAlbum` |
| `ruleStream.url` | `/rest/stream?id={{track.id}}...` | 服务端转码/原文件音频流 |
| `ruleLyric.lyric` | `/rest/getLyrics?...` | Subsonic 内置歌词（建议搭配 LRCLIB 歌词源） |
| `concurrentRate` | `5/1000` | 限速配置：每秒最多 5 次请求 |

## 目录结构

```
.
├── .github/workflows/
│   └── validate.yml   # GitHub Actions CI 自动化门禁
├── scripts/
│   ├── compile.mjs    # 单文件 index.json 编译器
│   └── validate.mjs   # 源码可读性、字节复现、Schema 门禁及负向测试
├── src/
│   └── source.json    # 音乐源源码与规则定义
├── index.json         # 编译产物（单文件，2 空格缩进，稳定排序）
├── package.json
└── README.md
```

## 构建方法

使用 Node.js 运行构建脚本，将 `src/source.json`（若存在 `src/source.js` 会自动内联至 `doc.jsLib`）编译为仓库根目录下的单文件 `index.json`：

```bash
node scripts/compile.mjs
# 或使用 npm 脚本
npm run compile
```

编译输出格式规范：2 空格缩进，稳定键顺序，末尾保留单个换行。

## 校验方法

运行验证门禁：

```bash
node scripts/validate.mjs
# 或使用 npm 脚本
npm run validate
```

验证项包括：
1. **源码可读性门禁**：拒绝混淆代码、大单行 blob、`eval` / 动态 `Function`，要求包含清晰可读注释与格式化结构；
2. **逐字节复现门禁**：重新在内存中编译源码，与磁盘上的 `index.json` 进行逐字节（byte-for-byte）比对，确保完全一致；
3. **JSON 格式与 Schema 校验**：验证根目录 `index.json` 符合 `SourceDocument` 契约，包括 `sourceUrl`、`loginUi`（`user` 与 `password` 字段）、`ruleStream` 等必填字段。

### 运行内置负向测试

```bash
node scripts/validate.mjs --test
# 或使用 npm 脚本
npm run test
```

负向测试会自动注入混淆特征样本、单行 blob 样本、缺失注释样本、逐字节篡改样本、缺失必填字段样本，验证校验门禁能够准确识别错误并退出非零状态码。

## 测试与调试

1. 启动 Navidrome（`docker run -p 4533:4533 navidrome/navidrome`）或连接现有 Subsonic 服务器；
2. 将 `sourceUrl` 配置为服务器实际地址；
3. 在客户端中通过 `loginUi` 输入用户名与密码凭据；
4. 验证：搜索歌曲能出列表；Explore 栏目能浏览专辑并展开曲目；音频流正常播放；歌词接口正常返回。

## 已知限制

- 未实现 Subsonic 的 starred / rating / playlist 写操作（`ruleLibrary` 缺席）；
- 服务器必须开启 REST API（Navidrome 默认开启）。
