# DataAgent V2 Server 构建与验证

本仓库的统一 Server 构建入口是：

```bash
bun run build:server
```

它只编译当前机器的 HTTP/SSE Server，不包含 TUI、通用 CLI 命令图或 Web UI。构建结束后，脚本会把产物复制到仓库外的临时目录，启动该二进制，并通过真实 HTTP 请求检查 Basic Auth 和 `GET /api/health`。

成功日志类似：

```text
verified .../packages/server/dist/server-linux-x64/bin/opencode2-server via http://127.0.0.1:<port>/api/health
```

没有出现 `verified` 时，不能把本次构建视为已验证。

## Huawei 内网一键入口

为兼容原来的内网构建习惯，仓库保留一个薄包装脚本。可以在仓库父目录直接执行：

```bash
sh -x opencode-huawei-v2/huawei_build/build_v1.sh
```

它等价于使用 Huawei Registry、hoisted linker 和 `--ignore-scripts` 调用统一的 `build:server`，默认只生成 standalone Server。

需要把 Node.js、Python runtime 一起打成 tar.gz 时：

```bash
sh -x opencode-huawei-v2/huawei_build/build_v1.sh package
```

`package` 模式默认读取 `/srv/datacube/opencode-huawei-v2/packages/server/runtime-cache`；若目录不存在，则自动把 `/srv/datacube/runtime-cache.zip` 解压到该共享 cache 的父目录。这个绝对路径只用于复用 runtime cache，不是源码 checkout 位置；源码和构建产物位置始终由脚本自身所在仓库决定。也可以通过 `OPENCODE_RUNTIME_CACHE_DIR` 或 `OPENCODE_RUNTIME_CACHE_ZIP` 指定其他位置。该包装脚本不会删除 `bun.lock` 或 `node_modules`，实际构建与验证仍由统一入口完成。

Huawei 包装脚本保持原内网产物契约：构建 channel 默认为 `next`，版本包含当前提交短号（源码包没有 `.git` 时使用 `archive`）；普通模式额外生成 `packages/server/dist/cubecode-server`；`package` 模式额外生成 `packages/server/dist/cubecode2-server.tar.gz`，包内入口仍为 `bin/cubecode-server`。这些是统一 `opencode2-server` 产物的兼容命名，不会触发第二次编译。上述 channel 和版本仍可通过同名环境变量显式覆盖。

## 首次安装依赖

Bun 版本以根目录 `package.json` 的 `packageManager` 为准。默认构建假定依赖已经安装；首次拉取或 lockfile 变化后，可以把安装和构建放在同一入口中：

```bash
bun run build:server --install
```

`--install` 不直接使用 monorepo 的共享 `bun.lock`。共享 lockfile 即使带 workspace filter，也可能让安装器解析未选 workspace 的 GitHub tarball，这会让不能访问 GitHub 的内网构建因 App-only `ghostty-web` 失败。

统一入口会自动创建临时 Server-only workspace，只复制 Server 及其依赖包，并使用 `packages/server/bun.standalone.lock` 做 frozen install。`@opencode-ai/script` 是 Server 的构建期依赖；CLI、TUI、App、Desktop 和 `ghostty-web` 都不在该 workspace 或 lockfile 中。临时目录中的安装、编译、健康验证结束后，只把 `packages/server/dist` 拷回当前 checkout，不修改主仓 `package.json`、`bun.lock` 或现有 `node_modules`。当前 3.5 GiB 服务器还必须通过主机提供的保护器执行：

```bash
/home/ubuntu/.local/bin/safe-build -- bun run build:server --install
```

日常源码修改后的构建：

```bash
/home/ubuntu/.local/bin/safe-build -- bun run build:server
```

## 公司内网 Registry

内网 Registry 不写死在 `bunfig.toml`，避免外部机器无法安装依赖。公司编译机显式传入：

```bash
bun run build:server \
  --install \
  --registry=http://mirrors.tools.huawei.com/npm/ \
  --linker=hoisted \
  --ignore-scripts
```

也可以使用环境变量，命令主体保持一致：

```bash
OPENCODE_BUILD_REGISTRY=http://mirrors.tools.huawei.com/npm/ \
OPENCODE_BUILD_LINKER=hoisted \
bun run build:server --install --ignore-scripts
```

`--ignore-scripts` 只在公司环境确实要求禁止依赖脚本时使用。构建不会删除 `bun.lock`、不会清空 `patchedDependencies`，也不会修改仓库 workspace 列表。

内网镜像必须完整同步 Server workspace 所需的包和当前平台可选包；App-only GitHub 依赖不再参与解析。

仓库固定 Bun 1.4.0。该版本已在 Huawei 编译机上通过最小 registry 探针和完整 package 构建；Huawei 与通用构建因此共用同一套 Bun frozen Server-only 安装，不维护第二套 npm manifest、lockfile 或补丁流程。

若内网镜像仍返回模糊安装错误，可临时设置 `OPENCODE_BUILD_VERBOSE=1` 重跑同一条 Huawei 命令。该开关只增加 Bun 安装诊断，不改变依赖范围或产物；分享日志前仍应脱敏 registry URL 中可能存在的认证信息。

当 Server 依赖图、workspace manifest、catalog、override 或 dependency patch 变化时，在可访问依赖源的开发机更新并提交专用 lockfile：

```bash
bun run build:server:lock
```

随后必须再次运行 `bun run build:server --install`。专用 lockfile 与主 `bun.lock` 各自服务不同的安装入口，不要互相覆盖。

不支持 AVX2 的 x64 目标机可构建 baseline 产物：

```bash
bun run build:server --baseline
```

## 产物

默认产物位置：

```text
packages/server/dist/server-<os>-<arch>/bin/opencode2-server
```

例如 Linux x64：

```text
packages/server/dist/server-linux-x64/bin/opencode2-server
```

baseline 产物目录会增加 `-baseline` 后缀。Windows 可执行文件名增加 `.exe`。

产物是包含 Bun runtime、当前平台 watcher 和 PTY 绑定的单文件程序；运行时不依赖 Bun、源码目录或 `node_modules`。

如果内网交付环境还要求自带供 Agent shell 使用的 Node.js 和 Python，可在 Linux/macOS 构建机提供 runtime cache 后使用同一入口打包：

```bash
bun run build:server \
  --package-runtime \
  --runtime-cache=/path/to/runtime-cache
```

cache 下支持 `node`/`node-*` 和 `python`/`python-*` 目录，分别必须包含 `bin/node` 以及 `bin/python3`（或 `bin/python`）。也可用 `--node-runtime`、`--python-runtime` 或对应的 `OPENCODE_BUILD_NODE_RUNTIME`、`OPENCODE_BUILD_PYTHON_RUNTIME` 环境变量直接指定目录。

产物为同一目标目录中的：

```text
opencode2-server-runtime.tar.gz
```

包内包含 Server 二进制、完整 Node/Python runtime 目录和 `setup.sh`。runtime cache 是外部可重建制品，不提交到 Git；缺少任一 runtime 时命令会明确失败，不会生成残缺包。该打包选项当前只支持 Unix 构建机。

## 运行产物

```bash
OPENCODE_PASSWORD='your-secure-password' \
OPENCODE_APP_NAME='dataagent' \
OPENCODE_LOG_PREFIX='dataagent' \
OPENCODE_DB='/var/lib/dataagent/opencode.db' \
OPENCODE_DISABLE_MODELS_FETCH='1' \
OPENCODE_WORKSPACE_ONLY='true' \
./packages/server/dist/server-linux-x64/bin/opencode2-server \
  --hostname 127.0.0.1 \
  --port 4096
```

健康检查：

```bash
curl -u opencode:your-secure-password http://127.0.0.1:4096/api/health
```

`OPENCODE_APP_NAME` 控制 XDG 数据、缓存、配置和状态子目录；`OPENCODE_LOG_PREFIX` 控制日志文件前缀。未设置时保持 `opencode` 兼容默认值。

`OPENCODE_WORKSPACE_ONLY=true` 会过滤继承给 Agent shell 的服务端环境变量，并通过 Linux bubblewrap 只写挂载当前 workspace。该模式要求运行机器预装 `/usr/bin/bwrap`；Node/Python runtime 包不会复制操作系统级 sandbox 工具。未启用时保持 OpenCode 默认 shell 行为。

## 验证范围

`build:server` 自动验证：

- 当前源码能够编译成当前平台的 server-only 单文件产物；
- watcher 和 PTY 平台产物由构建脚本嵌入；
- 产物能在仓库外启动；
- 未认证的 health 请求返回 `401`；
- 正确 Basic Auth 请求返回成功；
- health 响应包含 `healthy: true` 和本次构建版本。

业务行为仍需运行对应包的定向测试。测试和 typecheck 不允许从仓库根目录执行，例如：

```bash
cd packages/core
bun test test/mcp.test.ts test/plugin/skill.test.ts test/plugin/system-prompt.test.ts
bun typecheck

cd ../server
bun test test/fetch.test.ts
bun typecheck
```

在低内存服务器上，这些命令都必须分别通过 `safe-build` 串行运行。

公开 Protocol 或 Server `HttpApi` 变化后，需要重新生成 OpenAPI 和客户端：

```bash
cd packages/protocol
bun run generate

cd ../client
bun run generate
```

不要直接编辑生成的客户端文件。
