# OpenCode V2 Postman 接口清单

本目录由 `packages/protocol/openapi.json` 生成，包含 116 个 V2 API operation，按 28 个领域分类。

Server 的构建、启动、配置和认证方法请参阅 [OpenCode V2 Server 构建与调测手册](../opencode-server.md)。

## 导入

在 Postman 中依次导入：

1. `opencode-v2.postman_collection.json`
2. `opencode-v2-local.postman_environment.json`
3. 选择环境 **OpenCode V2 Local**，将 `password` 改成启动 Server 时使用的 `OPENCODE_PASSWORD`
4. 检查 `baseUrl` 和 `directory` 是否符合本机环境

## 启动 Server

```sh
OPENCODE_CONFIG=/absolute/path/to/opencode.jsonc \
OPENCODE_CONFIG_PROJECT_DISABLE=true \
OPENCODE_PASSWORD='replace-with-a-secret' \
bun dev serve --hostname 127.0.0.1 --port 4096
```

Collection 使用集合级 HTTP Basic Auth，用户名固定为 `opencode`，密码读取 `{{password}}`。

## 推荐调测顺序

1. 调用 `v2.health.get` 验证地址和认证。
2. 调用 `v2.location.get` 验证 `directory`。Location 类接口默认启用 `location[directory]` 查询参数。
3. 调用 `v2.model.list`、`v2.provider.list` 和 `v2.agent.list` 检查运行配置。
4. 调用 `v2.session.create`。成功后 Collection 会自动写入环境变量 `sessionId`。
5. 调用 `v2.session.prompt`，再通过 `v2.session.log` 或 `v2.message.list` 查看结果。

可选查询参数在 Collection 中保留但默认禁用，需要时可在 Postman Params 面板启用。创建 Session、PTY 和 Shell 的请求会自动回填对应 ID。

> [!WARNING]
> Collection 包含删除、停止、执行命令、修改凭据和迁移等有副作用的接口。不要直接使用 Collection Runner 全量运行；请逐个确认请求后发送。

## 重新生成

```sh
bun run generate:postman
```

## 01 服务健康（2）

| 方法 | 路径                | Operation ID     | 说明                    |
| ---- | ------------------- | ---------------- | ----------------------- |
| GET  | `/api/health`       | `v2.health.get`  | Check server health     |
| POST | `/api/service/stop` | `v2.health.stop` | Stop the managed server |

## 02 服务器信息（1）

| 方法 | 路径          | Operation ID    | 说明                   |
| ---- | ------------- | --------------- | ---------------------- |
| GET  | `/api/server` | `v2.server.get` | Get server information |

## 03 位置与工作区（1）

| 方法 | 路径            | Operation ID      | 说明         |
| ---- | --------------- | ----------------- | ------------ |
| GET  | `/api/location` | `v2.location.get` | Get location |

## 04 Agent（2）

| 方法 | 路径                   | Operation ID    | 说明        |
| ---- | ---------------------- | --------------- | ----------- |
| GET  | `/api/agent`           | `v2.agent.list` | List agents |
| GET  | `/api/agent/{agentID}` | `v2.agent.get`  | Get agent   |

## 05 插件（1）

| 方法 | 路径          | Operation ID     | 说明         |
| ---- | ------------- | ---------------- | ------------ |
| GET  | `/api/plugin` | `v2.plugin.list` | List plugins |

## 06 会话与消息（36）

| 方法   | 路径                                                  | Operation ID                           | 说明                               |
| ------ | ----------------------------------------------------- | -------------------------------------- | ---------------------------------- |
| GET    | `/api/session`                                        | `v2.session.list`                      | List sessions                      |
| POST   | `/api/session`                                        | `v2.session.create`                    | Create session                     |
| POST   | `/api/session/import`                                 | `v2.session.import`                    | Import session                     |
| GET    | `/api/session/{sessionID}/export`                     | `v2.session.export`                    | Export session                     |
| GET    | `/api/session/active`                                 | `v2.session.active`                    | List active sessions               |
| GET    | `/api/session/{sessionID}`                            | `v2.session.get`                       | Get session                        |
| DELETE | `/api/session/{sessionID}`                            | `v2.session.remove`                    | Delete session                     |
| POST   | `/api/session/{sessionID}/fork`                       | `v2.session.fork`                      | Fork session                       |
| POST   | `/api/session/{sessionID}/agent`                      | `v2.session.switchAgent`               | Switch session agent               |
| POST   | `/api/session/{sessionID}/model`                      | `v2.session.switchModel`               | Switch session model               |
| POST   | `/api/session/{sessionID}/rename`                     | `v2.session.rename`                    | Rename session                     |
| POST   | `/api/session/{sessionID}/move`                       | `v2.session.move`                      | Move session                       |
| POST   | `/api/session/{sessionID}/prompt`                     | `v2.session.prompt`                    | Send message                       |
| POST   | `/api/session/{sessionID}/command`                    | `v2.session.command`                   | Run command                        |
| POST   | `/api/session/{sessionID}/skill`                      | `v2.session.skill`                     | Activate skill                     |
| POST   | `/api/session/{sessionID}/synthetic`                  | `v2.session.synthetic`                 | Add synthetic message              |
| POST   | `/api/session/{sessionID}/shell`                      | `v2.session.shell`                     | Run shell command                  |
| POST   | `/api/session/{sessionID}/compact`                    | `v2.session.compact`                   | Compact session                    |
| POST   | `/api/session/{sessionID}/wait`                       | `v2.session.wait`                      | Wait for session                   |
| POST   | `/api/session/{sessionID}/revert/stage`               | `v2.session.revert.stage`              | Stage session revert               |
| POST   | `/api/session/{sessionID}/revert/clear`               | `v2.session.revert.clear`              | Clear staged revert                |
| POST   | `/api/session/{sessionID}/revert/commit`              | `v2.session.revert.commit`             | Commit staged revert               |
| GET    | `/api/session/{sessionID}/context`                    | `v2.session.context`                   | Get session context                |
| GET    | `/api/session/{sessionID}/inbox`                      | `v2.session.inbox.list`                | List session inbox                 |
| DELETE | `/api/session/{sessionID}/inbox/{inboxID}`            | `v2.session.inbox.cancel`              | Cancel inbox input                 |
| POST   | `/api/session/{sessionID}/inbox/{inboxID}/steer`      | `v2.session.inbox.steer`               | Steer queued item                  |
| POST   | `/api/session/{sessionID}/inbox/{inboxID}/queue`      | `v2.session.inbox.queue`               | Queue steered item                 |
| GET    | `/api/session/{sessionID}/instructions/entries`       | `v2.session.instructions.entry.list`   | List instruction entries           |
| PUT    | `/api/session/{sessionID}/instructions/entries/{key}` | `v2.session.instructions.entry.put`    | Put instruction entry              |
| DELETE | `/api/session/{sessionID}/instructions/entries/{key}` | `v2.session.instructions.entry.remove` | Remove instruction entry           |
| POST   | `/api/session/{sessionID}/generate`                   | `v2.session.generate`                  | Generate text from session context |
| GET    | `/api/experimental/session/{sessionID}/log`           | `v2.session.log`                       | Read the session log               |
| POST   | `/api/session/{sessionID}/interrupt`                  | `v2.session.interrupt`                 | Interrupt session execution        |
| POST   | `/api/session/{sessionID}/background`                 | `v2.session.background`                | Background blocking session tools  |
| GET    | `/api/session/{sessionID}/message/{messageID}`        | `v2.session.message`                   | Get session message                |
| GET    | `/api/session/{sessionID}/message`                    | `v2.message.list`                      | Get session messages               |

## 07 模型（2）

| 方法 | 路径                 | Operation ID       | 说明              |
| ---- | -------------------- | ------------------ | ----------------- |
| GET  | `/api/model`         | `v2.model.list`    | List models       |
| GET  | `/api/model/default` | `v2.model.default` | Get default model |

## 08 文本生成（1）

| 方法 | 路径            | Operation ID       | 说明          |
| ---- | --------------- | ------------------ | ------------- |
| POST | `/api/generate` | `v2.generate.text` | Generate text |

## 09 Provider（2）

| 方法 | 路径                         | Operation ID       | 说明           |
| ---- | ---------------------------- | ------------------ | -------------- |
| GET  | `/api/provider`              | `v2.provider.list` | List providers |
| GET  | `/api/provider/{providerID}` | `v2.provider.get`  | Get provider   |

## 10 集成与认证（11）

| 方法   | 路径                                                                  | Operation ID                                | 说明                       |
| ------ | --------------------------------------------------------------------- | ------------------------------------------- | -------------------------- |
| GET    | `/api/integration`                                                    | `v2.integration.list`                       | List integrations          |
| GET    | `/api/integration/{integrationID}`                                    | `v2.integration.get`                        | Get integration            |
| POST   | `/api/experimental/integration/wellknown`                             | `v2.experimental.integration.wellknown.add` | Add wellknown integration  |
| POST   | `/api/integration/{integrationID}/connect/key`                        | `v2.integration.connect.key`                | Connect with key           |
| POST   | `/api/integration/{integrationID}/connect/oauth`                      | `v2.integration.oauth.connect`              | Begin OAuth connection     |
| GET    | `/api/integration/{integrationID}/connect/oauth/{attemptID}`          | `v2.integration.oauth.status`               | Get OAuth attempt status   |
| DELETE | `/api/integration/{integrationID}/connect/oauth/{attemptID}`          | `v2.integration.oauth.cancel`               | Cancel OAuth connection    |
| POST   | `/api/integration/{integrationID}/connect/oauth/{attemptID}/complete` | `v2.integration.oauth.complete`             | Complete OAuth connection  |
| POST   | `/api/integration/{integrationID}/connect/command`                    | `v2.integration.command.connect`            | Begin command connection   |
| GET    | `/api/integration/{integrationID}/connect/command/{attemptID}`        | `v2.integration.command.status`             | Get command attempt status |
| DELETE | `/api/integration/{integrationID}/connect/command/{attemptID}`        | `v2.integration.command.cancel`             | Cancel command connection  |

## 11 MCP（6）

| 方法   | 路径                           | Operation ID              | 说明                  |
| ------ | ------------------------------ | ------------------------- | --------------------- |
| GET    | `/api/mcp`                     | `v2.mcp.list`             | List MCP servers      |
| PUT    | `/api/mcp/{server}`            | `v2.mcp.add`              | Add MCP server        |
| DELETE | `/api/mcp/{server}`            | `v2.mcp.remove`           | Remove MCP server     |
| POST   | `/api/mcp/{server}/connect`    | `v2.mcp.connect`          | Connect MCP server    |
| POST   | `/api/mcp/{server}/disconnect` | `v2.mcp.disconnect`       | Disconnect MCP server |
| GET    | `/api/mcp/resource`            | `v2.mcp.resource.catalog` | List MCP resources    |

## 12 凭据（2）

| 方法   | 路径                             | Operation ID           | 说明              |
| ------ | -------------------------------- | ---------------------- | ----------------- |
| PATCH  | `/api/credential/{credentialID}` | `v2.credential.update` | Update credential |
| DELETE | `/api/credential/{credentialID}` | `v2.credential.remove` | Remove credential |

## 13 项目（2）

| 方法 | 路径                   | Operation ID         | 说明                |
| ---- | ---------------------- | -------------------- | ------------------- |
| GET  | `/api/project`         | `v2.project.list`    | List projects       |
| GET  | `/api/project/current` | `v2.project.current` | Get current project |

## 14 交互表单（7）

| 方法 | 路径                                            | Operation ID             | 说明                       |
| ---- | ----------------------------------------------- | ------------------------ | -------------------------- |
| GET  | `/api/form/request`                             | `v2.form.request.list`   | List pending form requests |
| GET  | `/api/session/{sessionID}/form`                 | `v2.session.form.list`   | List session forms         |
| POST | `/api/session/{sessionID}/form`                 | `v2.session.form.create` | Create session form        |
| GET  | `/api/session/{sessionID}/form/{formID}`        | `v2.session.form.get`    | Get session form           |
| GET  | `/api/session/{sessionID}/form/{formID}/state`  | `v2.session.form.state`  | Get form state             |
| POST | `/api/session/{sessionID}/form/{formID}/reply`  | `v2.session.form.reply`  | Reply to form              |
| POST | `/api/session/{sessionID}/form/{formID}/cancel` | `v2.session.form.cancel` | Cancel form                |

## 15 权限（7）

| 方法   | 路径                                                    | Operation ID                   | 说明                                |
| ------ | ------------------------------------------------------- | ------------------------------ | ----------------------------------- |
| GET    | `/api/permission/request`                               | `v2.permission.request.list`   | List pending permission requests    |
| GET    | `/api/permission/saved`                                 | `v2.permission.saved.list`     | List saved permissions              |
| DELETE | `/api/permission/saved/{id}`                            | `v2.permission.saved.remove`   | Remove saved permission             |
| POST   | `/api/session/{sessionID}/permission`                   | `v2.session.permission.create` | Create permission request           |
| GET    | `/api/session/{sessionID}/permission`                   | `v2.session.permission.list`   | List session permission requests    |
| GET    | `/api/session/{sessionID}/permission/{requestID}`       | `v2.session.permission.get`    | Get permission request              |
| POST   | `/api/session/{sessionID}/permission/{requestID}/reply` | `v2.session.permission.reply`  | Reply to pending permission request |

## 16 文件系统（3）

| 方法 | 路径             | Operation ID | 说明           |
| ---- | ---------------- | ------------ | -------------- |
| GET  | `/api/fs/read/*` | `v2.fs.read` | Read file      |
| GET  | `/api/fs/list`   | `v2.fs.list` | List directory |
| GET  | `/api/fs/find`   | `v2.fs.find` | Find files     |

## 17 命令（1）

| 方法 | 路径           | Operation ID      | 说明          |
| ---- | -------------- | ----------------- | ------------- |
| GET  | `/api/command` | `v2.command.list` | List commands |

## 18 Skill（1）

| 方法 | 路径         | Operation ID    | 说明        |
| ---- | ------------ | --------------- | ----------- |
| GET  | `/api/skill` | `v2.skill.list` | List skills |

## 19 事件流（1）

| 方法 | 路径         | Operation ID         | 说明                |
| ---- | ------------ | -------------------- | ------------------- |
| GET  | `/api/event` | `v2.event.subscribe` | Subscribe to events |

## 20 PTY 终端（7）

| 方法   | 路径                             | Operation ID           | 说明                       |
| ------ | -------------------------------- | ---------------------- | -------------------------- |
| GET    | `/api/pty`                       | `v2.pty.list`          | List PTY sessions          |
| POST   | `/api/pty`                       | `v2.pty.create`        | Create PTY session         |
| GET    | `/api/pty/{ptyID}`               | `v2.pty.get`           | Get PTY session            |
| PUT    | `/api/pty/{ptyID}`               | `v2.pty.update`        | Update PTY session         |
| DELETE | `/api/pty/{ptyID}`               | `v2.pty.remove`        | Remove PTY session         |
| POST   | `/api/pty/{ptyID}/connect-token` | `v2.pty.connect.token` | Create PTY WebSocket token |
| GET    | `/api/pty/{ptyID}/connect`       | `v2.pty.connect`       | Connect to PTY session     |

## 21 Shell 任务（6）

| 方法   | 路径                      | Operation ID       | 说明                        |
| ------ | ------------------------- | ------------------ | --------------------------- |
| GET    | `/api/shell`              | `v2.shell.list`    | List running shell commands |
| POST   | `/api/shell`              | `v2.shell.create`  | Run shell command           |
| GET    | `/api/shell/{id}`         | `v2.shell.get`     | Get shell command           |
| DELETE | `/api/shell/{id}`         | `v2.shell.remove`  | Remove shell command        |
| PATCH  | `/api/shell/{id}/timeout` | `v2.shell.timeout` | Update shell timeout        |
| GET    | `/api/shell/{id}/output`  | `v2.shell.output`  | Read shell output           |

## 22 引用（1）

| 方法 | 路径             | Operation ID        | 说明            |
| ---- | ---------------- | ------------------- | --------------- |
| GET  | `/api/reference` | `v2.reference.list` | List references |

## 23 Git Worktree（4）

| 方法   | 路径                                                     | Operation ID          | 说明              |
| ------ | -------------------------------------------------------- | --------------------- | ----------------- |
| GET    | `/api/experimental/project/{projectID}/worktree`         | `v2.worktree.list`    | List worktrees    |
| POST   | `/api/experimental/project/{projectID}/worktree`         | `v2.worktree.create`  | Create worktree   |
| DELETE | `/api/experimental/project/{projectID}/worktree`         | `v2.worktree.remove`  | Remove worktree   |
| POST   | `/api/experimental/project/{projectID}/worktree/refresh` | `v2.worktree.refresh` | Refresh worktrees |

## 24 版本控制（3）

| 方法 | 路径              | Operation ID    | 说明       |
| ---- | ----------------- | --------------- | ---------- |
| GET  | `/api/vcs`        | `v2.vcs.get`    | VCS info   |
| GET  | `/api/vcs/status` | `v2.vcs.status` | VCS status |
| GET  | `/api/vcs/diff`   | `v2.vcs.diff`   | VCS diff   |

## 25 网络搜索（2）

| 方法 | 路径                      | Operation ID             | 说明                      |
| ---- | ------------------------- | ------------------------ | ------------------------- |
| GET  | `/api/websearch/provider` | `v2.websearch.providers` | List web search providers |
| POST | `/api/websearch`          | `v2.websearch.query`     | Search the web            |

## 26 配置（1）

| 方法 | 路径          | Operation ID    | 说明              |
| ---- | ------------- | --------------- | ----------------- |
| GET  | `/api/config` | `v2.config.get` | Get configuration |

## 27 调试（2）

| 方法   | 路径                  | Operation ID              | 说明                    |
| ------ | --------------------- | ------------------------- | ----------------------- |
| GET    | `/api/debug/location` | `v2.debug.location.list`  | List loaded locations   |
| DELETE | `/api/debug/location` | `v2.debug.location.evict` | Evict a loaded location |

## 28 数据迁移（1）

| 方法 | 路径                             | Operation ID                          | 说明                    |
| ---- | -------------------------------- | ------------------------------------- | ----------------------- |
| GET  | `/api/experimental/migration/v1` | `v2.experimental.migration.v1.status` | Get V1 migration status |
