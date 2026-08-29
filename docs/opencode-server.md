# OpenCode V2 Server 构建与调测手册

本文说明如何从 OpenCode V2 代码仓安装依赖、使用指定配置文件和固定密码启动独立 Server，并通过 HTTP、CLI 或 Postman 调测接口。

## 环境要求

- Bun 1.3.14，与根目录 `package.json` 的 `packageManager` 保持一致。
- Node.js 22 或更高版本，用于部分原生依赖的安装脚本。
- 在代码仓根目录执行下列开发命令。

确认环境：

```sh
bun --version
node --version
```

首次使用时安装依赖：

```sh
bun install --frozen-lockfile
```

## 配置文件

OpenCode 不要求必须存在配置文件；没有配置文件时会使用内置默认值。配置文件支持 JSON 和 JSONC。

默认会加载全局配置：

```text
~/.config/opencode/opencode.json
~/.config/opencode/opencode.jsonc
```

从项目目录启动时，Server 还会向上发现项目中的：

```text
opencode.json
opencode.jsonc
.opencode/opencode.json
.opencode/opencode.jsonc
```

本仓库可参考的项目配置位于 [`.opencode/opencode.jsonc`](../.opencode/opencode.jsonc)。它用于 OpenCode 自身开发，不是通用生产配置。

使用 `OPENCODE_CONFIG` 指定额外的配置文件：

```sh
export OPENCODE_CONFIG=/absolute/path/to/opencode.jsonc
```

该变量可以使用绝对路径，也可以使用相对于 Server 启动目录的路径。指定文件会在全局配置之后参与合并。

默认情况下，项目配置发现仍然启用，项目中的匹配配置可能覆盖指定文件。若希望以指定文件为主要配置并禁用项目配置发现，请同时设置：

```sh
export OPENCODE_CONFIG_PROJECT_DISABLE=true
```

## 设置 Server 密码

V2 Server 使用 HTTP Basic Auth：

- 用户名固定为 `opencode`。
- 密码通过 `OPENCODE_PASSWORD` 设置。

```sh
export OPENCODE_PASSWORD='replace-with-a-secret'
```

若没有显式设置密码，前台 Server 会在启动时生成并输出随机密码。需要 Postman 或其他客户端稳定重连时，应显式设置固定密码。

不要将真实密码写入代码仓、配置示例或 Postman Collection。Postman Environment 中的 `password` 应设置为 Secret 类型。

## 从代码仓启动

在仓库根目录运行：

```sh
OPENCODE_CONFIG=/absolute/path/to/opencode.jsonc \
OPENCODE_CONFIG_PROJECT_DISABLE=true \
OPENCODE_PASSWORD='replace-with-a-secret' \
bun dev serve --hostname 127.0.0.1 --port 4096
```

启动成功后会输出：

```text
server listening on http://127.0.0.1:4096
```

`bun dev serve` 启动的是前台独立 Server，不是共享后台服务。关闭当前终端或按 `Ctrl+C` 即可终止。

## 使用安装版启动

若已安装 `opencode2`：

```sh
OPENCODE_CONFIG=/absolute/path/to/opencode.jsonc \
OPENCODE_CONFIG_PROJECT_DISABLE=true \
OPENCODE_PASSWORD='replace-with-a-secret' \
opencode2 serve --hostname 127.0.0.1 --port 4096
```

## HTTP 调测

健康检查：

```sh
curl --user "opencode:$OPENCODE_PASSWORD" \
  http://127.0.0.1:4096/api/health
```

获取 OpenAPI：

```sh
curl --user "opencode:$OPENCODE_PASSWORD" \
  http://127.0.0.1:4096/openapi.json
```

未携带认证信息时，Server 应返回 `401 Unauthorized`。

## CLI 调测

CLI 可以使用 OpenAPI operation ID 定位接口：

```sh
OPENCODE_PASSWORD='replace-with-a-secret' \
bun dev api --server http://127.0.0.1:4096 v2.health.get
```

也可以直接指定 HTTP 方法和路径：

```sh
OPENCODE_PASSWORD='replace-with-a-secret' \
bun dev api --server http://127.0.0.1:4096 GET /api/server
```

使用安装版时，将 `bun dev` 换成 `opencode2`。

## Postman 调测

Postman 文件统一存放在 [`docs/postman`](postman/)：

- `opencode-v2.postman_collection.json`：完整 V2 API Collection。
- `opencode-v2-local.postman_environment.json`：本地调测 Environment。
- `README.md`：116 个接口的分类清单和推荐调测顺序。

导入后选择 **OpenCode V2 Local** 环境，并检查：

```text
baseUrl  = http://127.0.0.1:4096
username = opencode
password = 启动 Server 时使用的 OPENCODE_PASSWORD
directory = 待调测项目的绝对路径
```

推荐先依次调用：

1. `v2.health.get`
2. `v2.location.get`
3. `v2.model.list`
4. `v2.provider.list`
5. `v2.agent.list`
6. `v2.session.create`
7. `v2.session.prompt`

Collection 会在创建 Session、PTY 和 Shell 后自动回填相应环境变量。

## 重新生成 Postman 文件

Protocol 或 Server API 发生变化后，在仓库根目录运行：

```sh
bun run generate:postman
```

生成器读取 `packages/protocol/openapi.json`，并覆盖更新 `docs/postman` 下的 Collection、Environment 和接口清单。

## 网络安全

除非 Server 必须接受远程连接，否则应保留 `127.0.0.1` 回环地址。绑定到 `0.0.0.0` 或其他网络接口会暴露能够读取源代码、管理凭据和执行工具的 API，必须额外配置网络隔离、访问控制和安全的凭据管理。
