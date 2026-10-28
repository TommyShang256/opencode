# DataAgent V2 HTTP API 与 Postman 示例

> 由 `packages/protocol/openapi.json`（OpenAPI 0.0.1）生成，请勿手工修改接口明细。

导入同目录的 `opencode-v2.postman_collection.json` 后，设置 Collection Variables 中的 `baseUrl`、`username` 和 `password`。

共 **142** 个 HTTP 操作、**32** 个分类。

## health



### `GET /api/health` — Check server health

Report the owning server process and its application status.

Operation ID: `v2.health.get`

响应状态：

- `200`: ServiceHealth
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/health' \
  --user '{{username}}:{{password}}'
```

## server



### `GET /api/server` — Get server information

Return the URLs that can be used to connect to this server.

Operation ID: `v2.server.get`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/server' \
  --user '{{username}}:{{password}}'
```

## location



### `GET /api/location` — Get location

Resolve the requested location or the server default location.

Operation ID: `v2.location.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Location.Info
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/location' \
  --user '{{username}}:{{password}}'
```

## agent



### `GET /api/agent` — List agents

Retrieve currently registered agents.

Operation ID: `v2.agent.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/agent' \
  --user '{{username}}:{{password}}'
```

### `GET /api/agent/{agentID}` — Get agent

Retrieve a single currently registered agent.

Operation ID: `v2.agent.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `agentID` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: AgentNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/agent/{{agentID}}' \
  --user '{{username}}:{{password}}'
```

## plugin

Experimental plugin routes.

### `GET /api/plugin` — List plugins

Retrieve enabled server plugins and their current status.

Operation ID: `v2.plugin.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/plugin' \
  --user '{{username}}:{{password}}'
```

## session

Experimental session routes.

### `GET /api/session` — List sessions

Retrieve sessions in the requested order. Items keep that order across pages; use cursor.next or cursor.previous to move through the ordered list.

Operation ID: `v2.session.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `workspace` | 否 |
| query | `limit` | 否 |
| query | `order` | 否 |
| query | `search` | 否 |
| query | `parentID` | 否 |
| query | `directory` | 否 |
| query | `project` | 否 |
| query | `subpath` | 否 |
| query | `cursor` | 否 |

响应状态：

- `200`: SessionsResponse
- `400`: InvalidCursorError | InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session` — Create session

Create a session at the requested location.

Operation ID: `v2.session.create`

请求体示例：

```json
{}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### `GET /api/session/stats` — Get session statistics

Aggregate local session activity, usage, and tool reliability for a time range.

Operation ID: `v2.session.stats`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `from` | 否 |
| query | `to` | 否 |
| query | `project` | 否 |
| query | `timezone` | 否 |
| query | `tools` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/stats' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/import` — Import session

Import a projected session transcript at the requested location. If parentID is supplied, the parent session must already exist; import parents before children.

Operation ID: `v2.session.import`

请求体示例：

```json
{
  "info": {
    "id": "{{id}}",
    "projectID": "{{projectID}}",
    "cost": 1,
    "tokens": {
      "input": 1,
      "output": 1,
      "reasoning": 1,
      "cache": {
        "read": 1,
        "write": 1
      }
    },
    "time": {
      "created": 1,
      "updated": 1
    },
    "location": {
      "directory": "{{directory}}"
    }
  },
  "messages": [
    {
      "id": "{{id}}",
      "time": {
        "created": 1
      },
      "type": "agent-switched",
      "agent": "example"
    }
  ]
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/import' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "info": {
      "id": "{{id}}",
      "projectID": "{{projectID}}",
      "cost": 1,
      "tokens": {
        "input": 1,
        "output": 1,
        "reasoning": 1,
        "cache": {
          "read": 1,
          "write": 1
        }
      },
      "time": {
        "created": 1,
        "updated": 1
      },
      "location": {
        "directory": "{{directory}}"
      }
    },
    "messages": [
      {
        "id": "{{id}}",
        "time": {
          "created": 1
        },
        "type": "agent-switched",
        "agent": "example"
      }
    ]
  }'
```

### `GET /api/session/{sessionID}/export` — Export session

Export a complete projected session transcript.

Operation ID: `v2.session.export`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| query | `sanitize` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `500`: UnknownError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/export' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/active` — List active sessions

Retrieve foreground Session drains currently owned by this OpenCode process. Sessions absent from the result are inactive.

Operation ID: `v2.session.active`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/active' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}` — Get session

Retrieve a session by ID.

Operation ID: `v2.session.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/session/{sessionID}` — Delete session

Delete a session and its child sessions.

Operation ID: `v2.session.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/session/{{sessionID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/fork` — Fork session

Create a child session by copying projected history through or before a message boundary.

Operation ID: `v2.session.fork`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "boundary": {
    "type": "before",
    "messageID": "{{messageID}}"
  }
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | MessageNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/fork' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "boundary": {
      "type": "before",
      "messageID": "{{messageID}}"
    }
  }'
```

### `POST /api/session/{sessionID}/agent` — Switch session agent

Switch the agent used by subsequent provider turns.

Operation ID: `v2.session.switchAgent`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "agent": "example"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/agent' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "agent": "example"
  }'
```

### `POST /api/session/{sessionID}/model` — Switch session model

Switch the model used by subsequent provider turns.

Operation ID: `v2.session.switchModel`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "model": {
    "id": "{{id}}",
    "providerID": "{{providerID}}"
  }
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/model' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "model": {
      "id": "{{id}}",
      "providerID": "{{providerID}}"
    }
  }'
```

### `POST /api/session/{sessionID}/rename` — Rename session

Update the session title.

Operation ID: `v2.session.rename`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "title": "example"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/rename' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "title": "example"
  }'
```

### `POST /api/session/{sessionID}/move` — Move session

Move a session to another project directory, optionally transferring local changes.

Operation ID: `v2.session.move`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "directory": "{{directory}}"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/move' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "directory": "{{directory}}"
  }'
```

### `POST /api/session/{sessionID}/prompt` — Send message

Durably admit one session input and schedule agent-loop execution unless resume is false.

Operation ID: `v2.session.prompt`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "text": "Hello from Postman"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/prompt' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "text": "Hello from Postman"
  }'
```

### `POST /api/session/{sessionID}/client-tool-results` — Submit client tool results

Complete waiting client-owned native tool calls and resume session execution.

Operation ID: `v2.session.clientToolResults`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "results": [
    {
      "toolCallId": "{{toolCallId}}",
      "status": "completed",
      "output": {}
    }
  ]
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError | SessionBusyError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/client-tool-results' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "results": [
      {
        "toolCallId": "{{toolCallId}}",
        "status": "completed",
        "output": {}
      }
    ]
  }'
```

### `POST /api/session/{sessionID}/command` — Run command

Execute a slash command callback immediately.

Operation ID: `v2.session.command`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "command": "example",
  "text": "Hello from Postman"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | CommandNotFoundError
- `500`: CommandExecutionError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/command' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "command": "example",
    "text": "Hello from Postman"
  }'
```

### `POST /api/session/{sessionID}/skill` — Activate skill

Activate a skill for a session by appending a skill message and resuming execution.

Operation ID: `v2.session.skill`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "skill": "example"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | SkillNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/skill' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "skill": "example"
  }'
```

### `POST /api/session/{sessionID}/synthetic` — Add synthetic message

Durably admit synthetic session input and schedule execution unless resume is false.

Operation ID: `v2.session.synthetic`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "text": "Hello from Postman"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/synthetic' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "text": "Hello from Postman"
  }'
```

### `POST /api/session/{sessionID}/shell` — Run shell command

Execute one shell command in the session's working directory. Emits a shell.started event before execution and a shell.ended event with the merged output after.

Operation ID: `v2.session.shell`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "command": "example"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/shell' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "command": "example"
  }'
```

### `POST /api/session/{sessionID}/compact` — Compact session

Durably admit a session compaction request. Steers by default: it runs at the next step boundary instead of waiting behind queued prompts.

Operation ID: `v2.session.compact`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/compact' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### `POST /api/session/{sessionID}/wait` — Wait for session

Wait for a session agent loop to become idle.

Operation ID: `v2.session.wait`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/wait' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/revert/stage` — Stage session revert

Stage or move a reversible session boundary and optionally apply its file changes.

Operation ID: `v2.session.revert.stage`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "messageID": "{{messageID}}"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: MessageNotFoundError | SessionNotFoundError
- `409`: SessionBusyError
- `500`: UnknownError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/revert/stage' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "messageID": "{{messageID}}"
  }'
```

### `POST /api/session/{sessionID}/revert/clear` — Clear staged revert

Operation ID: `v2.session.revert.clear`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: SessionBusyError
- `500`: UnknownError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/revert/clear' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/revert/commit` — Commit staged revert

Operation ID: `v2.session.revert.commit`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: SessionBusyError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/revert/commit' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/context` — Get session context

Retrieve the active context messages for a session (all messages after the last compaction).

Operation ID: `v2.session.context`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `500`: UnknownError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/context' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/context/clear` — Clear session context

Create an empty context boundary in an idle session while retaining its identity, instructions and full transcript. Pending input or a staged revert conflicts.

Operation ID: `session.clearContext`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: SessionBusyError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/context/clear' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/inbox` — List session inbox

List durable enqueued session work not yet delivered, ordered by enqueue sequence. Includes user, synthetic, compaction, and move items.

Operation ID: `v2.session.inbox.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/inbox' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/session/{sessionID}/inbox/{inboxID}` — Cancel inbox input

Cancel an inbox item that has not yet been delivered.

Operation ID: `v2.session.inbox.cancel`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `inboxID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/session/{{sessionID}}/inbox/{{inboxID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/inbox/{inboxID}/steer` — Steer queued item

Change a queued inbox item to steer delivery and wake session execution.

Operation ID: `v2.session.inbox.steer`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `inboxID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/inbox/{{inboxID}}/steer' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/inbox/{inboxID}/queue` — Queue steered item

Change a steered inbox item to queued delivery.

Operation ID: `v2.session.inbox.queue`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `inboxID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/inbox/{{inboxID}}/queue' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/instructions/entries` — List instruction entries

List API-managed instruction entries attached to the session.

Operation ID: `v2.session.instructions.entry.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/instructions/entries' \
  --user '{{username}}:{{password}}'
```

### `PUT /api/session/{sessionID}/instructions/entries/{key}` — Put instruction entry

Attach or replace one durable instruction entry. Changes announce as updates at the next step boundary.

Operation ID: `v2.session.instructions.entry.put`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `key` | 是 |

请求体示例：

```json
{
  "value": {}
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `413`: InstructionEntryValueTooLargeError

```bash
curl --request PUT \
  --url '{{baseUrl}}/api/session/{{sessionID}}/instructions/entries/{{key}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "value": {}
  }'
```

### `DELETE /api/session/{sessionID}/instructions/entries/{key}` — Remove instruction entry

Remove one instruction entry; the removal is announced to the model at the next step boundary.

Operation ID: `v2.session.instructions.entry.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `key` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/session/{{sessionID}}/instructions/entries/{{key}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/generate` — Generate text from session context

Generate transient text from the current session context without mutating session history.

Operation ID: `v2.session.generate`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "prompt": "Hello from Postman"
}
```

响应状态：

- `200`: SessionGenerateResponse
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/generate' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "prompt": "Hello from Postman"
  }'
```

### `GET /api/experimental/session/{sessionID}/log` — Read the session log

Experimental durable session event log. Reads events after an exclusive aggregate sequence and continues with live events when follow=true.

Operation ID: `v2.session.log`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| query | `after` | 否 |
| query | `follow` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/session/{{sessionID}}/log' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/interrupt` — Interrupt session execution

Interrupt active execution owned by this OpenCode process. Returns interrupted=true when an active execution was interrupted and false for the idle no-op. When continue=true, execution resumes pending steering input and next-in-line control items (manual compaction, moves) while queued prompts remain parked.

Operation ID: `v2.session.interrupt`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| query | `continue` | 否 |

响应状态：

- `200`: SessionInterruptResponse
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/interrupt' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/background` — Background blocking session tools

Move active foreground backgroundable tools for this session into background observation. Idle requests are a no-op.

Operation ID: `v2.session.background`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/background' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/message/{messageID}` — Get session message

Retrieve one projected message owned by the Session.

Operation ID: `v2.session.message`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `messageID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | MessageNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/message/{{messageID}}' \
  --user '{{username}}:{{password}}'
```

### `PATCH /api/session/{sessionID}/message/{messageID}` — Update assistant message content

Replace the content of a completed assistant message in an idle session.

Operation ID: `v2.session.messageUpdate`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `messageID` | 是 |

请求体示例：

```json
{
  "content": [
    {
      "type": "text",
      "text": "Hello from Postman"
    }
  ]
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | MessageNotFoundError
- `409`: SessionBusyError | ConflictError

```bash
curl --request PATCH \
  --url '{{baseUrl}}/api/session/{{sessionID}}/message/{{messageID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "content": [
      {
        "type": "text",
        "text": "Hello from Postman"
      }
    ]
  }'
```

### `PUT /api/session/{sessionID}/environment` — Set session environment

Replace the process environment used by local shell commands for this session.

Operation ID: `v2.session.environment`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "variables": {}
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request PUT \
  --url '{{baseUrl}}/api/session/{{sessionID}}/environment' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "variables": {}
  }'
```

### `POST /api/session/{sessionID}/view` — View session

Mark the idle transition observed by the viewer as viewed.

Operation ID: `v2.session.view`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "idle": 1
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/view' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "idle": 1
  }'
```

### `GET /api/session/{sessionID}/message` — Get session messages

Retrieve projected messages for a session. Items keep the requested order across pages; use cursor.next or cursor.previous to move through the ordered timeline.

Operation ID: `v2.message.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| query | `limit` | 否 |
| query | `order` | 否 |
| query | `cursor` | 否 |

响应状态：

- `200`: SessionMessagesResponse
- `400`: InvalidCursorError | InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `500`: UnknownError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/message' \
  --user '{{username}}:{{password}}'
```

## model

Experimental model routes.

### `GET /api/model` — List models

Retrieve the current snapshot of available models ordered by release date. The snapshot may precede initial plugin settlement.

Operation ID: `v2.model.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/model' \
  --user '{{username}}:{{password}}'
```

### `GET /api/model/default` — Get default model

Retrieve the model used when a session has no explicit model selection.

Operation ID: `v2.model.default`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/model/default' \
  --user '{{username}}:{{password}}'
```

## generate

Experimental one-shot generation routes.

### `POST /api/generate` — Generate text

Run one stateless model generation using the server's base configuration and return the assistant text. Uses the base configuration's default model when none is specified.

Operation ID: `v2.generate.text`

请求体示例：

```json
{
  "prompt": "Hello from Postman"
}
```

响应状态：

- `200`: GenerateTextResponse
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/generate' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "prompt": "Hello from Postman"
  }'
```

## provider

Experimental provider routes.

### `GET /api/provider` — List providers

Retrieve active AI providers so clients can show provider availability and configuration.

Operation ID: `v2.provider.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/provider' \
  --user '{{username}}:{{password}}'
```

### `GET /api/provider/{providerID}` — Get provider

Retrieve a single AI provider so clients can inspect its availability and endpoint settings.

Operation ID: `v2.provider.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `providerID` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ProviderNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/provider/{{providerID}}' \
  --user '{{username}}:{{password}}'
```

## integration

Integration discovery and authentication routes.

### `GET /api/integration` — List integrations

Retrieve available integrations and their authentication methods.

Operation ID: `v2.integration.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/integration' \
  --user '{{username}}:{{password}}'
```

### `GET /api/integration/{integrationID}` — Get integration

Retrieve one integration and its authentication methods.

Operation ID: `v2.integration.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/integration/{{integrationID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/experimental/integration/wellknown` — Add wellknown integration

Discover and persist an experimental wellknown integration source.

Operation ID: `v2.experimental.integration.wellknown.add`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

请求体示例：

```json
{
  "url": "https://example.com"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/experimental/integration/wellknown' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "url": "https://example.com"
  }'
```

### `POST /api/integration/{integrationID}/connect/key` — Connect with key

Run a key authentication method and store the resulting credential.

Operation ID: `v2.integration.connect.key`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "key": "example"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/key' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "key": "example"
  }'
```

### `POST /api/integration/{integrationID}/connect/oauth` — Begin OAuth connection

Start an OAuth attempt and return the authorization details.

Operation ID: `v2.integration.oauth.connect`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "methodID": "{{methodID}}"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/oauth' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "methodID": "{{methodID}}"
  }'
```

### `GET /api/integration/{integrationID}/connect/oauth/{attemptID}` — Get OAuth attempt status

Poll the current status of an OAuth attempt.

Operation ID: `v2.integration.oauth.status`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| path | `attemptID` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/oauth/{{attemptID}}' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/integration/{integrationID}/connect/oauth/{attemptID}` — Cancel OAuth connection

Cancel an OAuth attempt and release its resources.

Operation ID: `v2.integration.oauth.cancel`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| path | `attemptID` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/oauth/{{attemptID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/integration/{integrationID}/connect/oauth/{attemptID}/complete` — Complete OAuth connection

Complete a code-based OAuth attempt and store the resulting credential.

Operation ID: `v2.integration.oauth.complete`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| path | `attemptID` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/oauth/{{attemptID}}/complete' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### `POST /api/integration/{integrationID}/connect/command` — Begin command connection

Start a command authentication attempt.

Operation ID: `v2.integration.command.connect`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "methodID": "{{methodID}}"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/command' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "methodID": "{{methodID}}"
  }'
```

### `GET /api/integration/{integrationID}/connect/command/{attemptID}` — Get command attempt status

Poll the current status and output of a command authentication attempt.

Operation ID: `v2.integration.command.status`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| path | `attemptID` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/command/{{attemptID}}' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/integration/{integrationID}/connect/command/{attemptID}` — Cancel command connection

Cancel a command authentication attempt and terminate its process.

Operation ID: `v2.integration.command.cancel`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `integrationID` | 是 |
| path | `attemptID` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/integration/{{integrationID}}/connect/command/{{attemptID}}' \
  --user '{{username}}:{{password}}'
```

## mcp

MCP server and resource routes.

### `GET /api/mcp` — List MCP servers

Retrieve configured MCP servers and their connection status.

Operation ID: `v2.mcp.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/mcp' \
  --user '{{username}}:{{password}}'
```

### `PUT /api/mcp/{server}` — Add MCP server

Add an MCP server at runtime or replace an existing one, connecting it immediately.

Operation ID: `v2.mcp.add`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `server` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "config": {
    "type": "local",
    "command": [
      "example"
    ]
  }
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request PUT \
  --url '{{baseUrl}}/api/mcp/{{server}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "config": {
      "type": "local",
      "command": [
        "example"
      ]
    }
  }'
```

### `DELETE /api/mcp/{server}` — Remove MCP server

Stop an MCP server and remove it from the runtime set until restart.

Operation ID: `v2.mcp.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `server` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: McpServerNotFoundError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/mcp/{{server}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/mcp/{server}/connect` — Connect MCP server

Connect an MCP server at runtime, overriding a disabled configuration until restart.

Operation ID: `v2.mcp.connect`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `server` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: McpServerNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/mcp/{{server}}/connect' \
  --user '{{username}}:{{password}}'
```

### `POST /api/mcp/{server}/disconnect` — Disconnect MCP server

Disconnect an MCP server at runtime, removing its tools until reconnected.

Operation ID: `v2.mcp.disconnect`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `server` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: McpServerNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/mcp/{{server}}/disconnect' \
  --user '{{username}}:{{password}}'
```

### `GET /api/mcp/resource` — List MCP resources

Retrieve resources and resource templates from connected MCP servers.

Operation ID: `v2.mcp.resource.catalog`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/mcp/resource' \
  --user '{{username}}:{{password}}'
```

### `GET /api/mcp/{server}/tools` — List MCP tools

List the tools exposed by one configured MCP server.

Operation ID: `v2.mcp.tools.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `server` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: McpServerNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/mcp/{{server}}/tools' \
  --user '{{username}}:{{password}}'
```

### `POST /api/mcp/{server}/tool/{tool}/call` — Call MCP tool

Invoke a tool on a connected MCP server (Tool Bridge). Subject to the same permission rules as LLM-invoked MCP tools.

Operation ID: `v2.mcp.tool.call`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `server` | 是 |
| path | `tool` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "arguments": {}
}
```

响应状态：

- `200`: Mcp.ToolCallResult
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `403`: PermissionDeniedError
- `404`: McpServerNotFoundError | SessionNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/mcp/{{server}}/tool/{{tool}}/call' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "arguments": {}
  }'
```

## credential



### `PATCH /api/credential/{credentialID}` — Update credential

Update a stored credential label.

Operation ID: `v2.credential.update`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `credentialID` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "label": "example"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request PATCH \
  --url '{{baseUrl}}/api/credential/{{credentialID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "label": "example"
  }'
```

### `DELETE /api/credential/{credentialID}` — Remove credential

Remove a stored integration credential.

Operation ID: `v2.credential.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `credentialID` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/credential/{{credentialID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/credential/{credentialID}/activate` — Activate credential

Activate a stored integration credential.

Operation ID: `v2.credential.activate`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `credentialID` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/credential/{{credentialID}}/activate' \
  --user '{{username}}:{{password}}'
```

## project

Project routes.

### `GET /api/project` — List projects

List known projects.

Operation ID: `v2.project.list`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/project' \
  --user '{{username}}:{{password}}'
```

### `PATCH /api/project/{projectID}` — Update project

Update project display metadata and workspace commands.

Operation ID: `v2.project.update`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `projectID` | 是 |

请求体示例：

```json
{}
```

响应状态：

- `200`: Project
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ProjectNotFoundError

```bash
curl --request PATCH \
  --url '{{baseUrl}}/api/project/{{projectID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### `GET /api/project/current` — Get current project

Resolve the project for the requested location.

Operation ID: `v2.project.current`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Project.Current
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/project/current' \
  --user '{{username}}:{{password}}'
```

## form

Session form routes.

### `GET /api/form/request` — List pending form requests

Retrieve pending forms for a location.

Operation ID: `v2.form.request.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/form/request' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/form` — List session forms

Retrieve pending forms for a session.

Operation ID: `v2.session.form.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/form' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/form` — Create session form

Create a form for a session.

Operation ID: `v2.session.form.create`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "title": "example",
  "fields": [
    {
      "key": "example",
      "type": "string"
    }
  ]
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/form' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "title": "example",
    "fields": [
      {
        "key": "example",
        "type": "string"
      }
    ]
  }'
```

### `GET /api/session/{sessionID}/form/{formID}` — Get session form

Retrieve a form for a session.

Operation ID: `v2.session.form.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `formID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | FormNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/form/{{formID}}' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/form/{formID}/state` — Get form state

Retrieve the current state for a form.

Operation ID: `v2.session.form.state`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `formID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | FormNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/form/{{formID}}/state' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/form/{formID}/reply` — Reply to form

Submit an answer to a pending form.

Operation ID: `v2.session.form.reply`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `formID` | 是 |

请求体示例：

```json
{
  "answer": {}
}
```

响应状态：

- `204`: <No Content>
- `400`: FormInvalidAnswerError | InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | FormNotFoundError
- `409`: FormAlreadySettledError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/form/{{formID}}/reply' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "answer": {}
  }'
```

### `POST /api/session/{sessionID}/form/{formID}/cancel` — Cancel form

Cancel a pending form.

Operation ID: `v2.session.form.cancel`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `formID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | FormNotFoundError
- `409`: FormAlreadySettledError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/form/{{formID}}/cancel' \
  --user '{{username}}:{{password}}'
```

## permission

Experimental permission routes.

### `GET /api/permission/request` — List pending permission requests

Retrieve pending permission requests for a location.

Operation ID: `v2.permission.request.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/permission/request' \
  --user '{{username}}:{{password}}'
```

### `GET /api/permission/saved` — List saved permissions

Retrieve saved permissions, optionally filtered by project.

Operation ID: `v2.permission.saved.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `projectID` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/permission/saved' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/permission/saved/{id}` — Remove saved permission

Remove a saved permission by ID.

Operation ID: `v2.permission.saved.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `id` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/permission/saved/{{id}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/permission` — Create permission request

Evaluate and, when approval is required, create a permission request for a session.

Operation ID: `v2.session.permission.create`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "action": "example",
  "resources": [
    "example"
  ]
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/permission' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "action": "example",
    "resources": [
      "example"
    ]
  }'
```

### `GET /api/session/{sessionID}/permission` — List session permission requests

Retrieve pending permission requests owned by a session.

Operation ID: `v2.session.permission.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/permission' \
  --user '{{username}}:{{password}}'
```

### `GET /api/session/{sessionID}/permission/{requestID}` — Get permission request

Retrieve a pending permission request owned by a session.

Operation ID: `v2.session.permission.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `requestID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | PermissionNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/session/{{sessionID}}/permission/{{requestID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/session/{sessionID}/permission/{requestID}/reply` — Reply to pending permission request

Respond to a pending permission request owned by a session.

Operation ID: `v2.session.permission.reply`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| path | `requestID` | 是 |

请求体示例：

```json
{
  "reply": "once"
}
```

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: SessionNotFoundError | PermissionNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/session/{{sessionID}}/permission/{{requestID}}/reply' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "reply": "once"
  }'
```

## filesystem

Experimental location-scoped filesystem routes.

### `GET /api/fs/read/*` — Read file

Serve one file relative to the requested location.

Operation ID: `v2.fs.read`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/fs/read/{{filePath}}' \
  --user '{{username}}:{{password}}'
```

### `GET /api/fs/list` — List directory

List direct children of one directory relative to the requested location.

Operation ID: `v2.fs.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |
| query | `path` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/fs/list' \
  --user '{{username}}:{{password}}'
```

### `GET /api/fs/find` — Find files

Find recursively ranked filesystem entries relative to the requested location.

Operation ID: `v2.fs.find`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |
| query | `query` | 是 |
| query | `type` | 否 |
| query | `limit` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/fs/find?query={{query}}' \
  --user '{{username}}:{{password}}'
```

## command

Experimental command routes.

### `GET /api/command` — List commands

Retrieve currently registered commands.

Operation ID: `v2.command.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/command' \
  --user '{{username}}:{{password}}'
```

## skill

Experimental skill routes.

### `GET /api/skill` — List skills

Retrieve currently registered skills.

Operation ID: `v2.skill.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/skill' \
  --user '{{username}}:{{password}}'
```

## rpc

Plugin RPC routes.

### `POST /api/rpc/{rpcID}/{method}` — Call a plugin RPC

Dispatch a method to the currently registered RPC at the requested location.

Operation ID: `v2.rpc.call`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `rpcID` | 是 |
| path | `method` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{}
```

响应状态：

- `200`: Rpc.Output
- `400`: RpcError | InvalidRequestError
- `401`: UnauthorizedError
- `500`: RpcInternalError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/rpc/{{rpcID}}/{{method}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

## tool

Tool registry inventory routes.

### `GET /api/tool` — List tools

Retrieve every currently registered tool (built-in, plugin-injected, and MCP-aggregated) without permission filtering or CodeMode aggregation.

Operation ID: `v2.tool.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/tool' \
  --user '{{username}}:{{password}}'
```

## event

Experimental event stream routes.

### `GET /api/event` — Subscribe to events

Subscribe to native events and plugin RPC events across all server locations. Volatile by contract: a slow consumer overflows and fails the stream, and events during disconnection are missed.

Operation ID: `v2.event.subscribe`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/event' \
  --user '{{username}}:{{password}}'
```

## pty

Experimental location-scoped PTY routes.

### `GET /api/pty` — List PTY sessions

List PTY sessions for a location, including exited sessions retained until removal.

Operation ID: `v2.pty.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/pty' \
  --user '{{username}}:{{password}}'
```

### `POST /api/pty` — Create PTY session

Create a pseudo-terminal session for a location.

Operation ID: `v2.pty.create`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

请求体示例：

```json
{}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/pty' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### `GET /api/pty/{ptyID}` — Get PTY session

Get one PTY session, including its exit code once exited.

Operation ID: `v2.pty.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/pty/{{ptyID}}' \
  --user '{{username}}:{{password}}'
```

### `PUT /api/pty/{ptyID}` — Update PTY session

Update the title or viewport size of one PTY session.

Operation ID: `v2.pty.update`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError

```bash
curl --request PUT \
  --url '{{baseUrl}}/api/pty/{{ptyID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{}'
```

### `DELETE /api/pty/{ptyID}` — Remove PTY session

Terminate and remove one PTY session.

Operation ID: `v2.pty.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/pty/{{ptyID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/pty/{ptyID}/connect-token` — Create PTY WebSocket token

Create a short-lived single-use ticket for opening a PTY WebSocket connection.

Operation ID: `v2.pty.connect.token`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| header | `x-opencode-ticket` | 否 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `403`: ForbiddenError
- `404`: PtyNotFoundError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/pty/{{ptyID}}/connect-token' \
  --user '{{username}}:{{password}}'
```

### `GET /api/pty/{ptyID}/connect` — Connect to PTY session

Establish a WebSocket connection streaming PTY output and accepting terminal input.

Operation ID: `v2.pty.connect`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| query | `location[directory]` | 否 |
| query | `location[workspace]` | 否 |
| query | `cursor` | 否 |
| query | `ticket` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `403`: ForbiddenError
- `404`: PtyNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/pty/{{ptyID}}/connect' \
  --user '{{username}}:{{password}}'
```

## persistentPty

Prototype persistent PTY routes.

### `GET /api/experimental/session/{sessionID}/terminal/read` — Read the session's most recently controlled terminal

Read the last physical rows without changing selection or taking control. Omitted lines uses the live terminal height; larger counts include retained history. Blank rows are preserved. Screen dimensions and cursor remain relative to the live screen. Returns null when no current terminal exists. Selection is server-local and resets on restart. Experimental: may change without compatibility guarantees.

Operation ID: `server.experimental.persistentPty.read`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |
| query | `lines` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/session/{{sessionID}}/terminal/read' \
  --user '{{username}}:{{password}}'
```

### `GET /api/experimental/session/{sessionID}/terminal` — server.experimental.persistentPty.list

Operation ID: `server.experimental.persistentPty.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/session/{{sessionID}}/terminal' \
  --user '{{username}}:{{password}}'
```

### `POST /api/experimental/session/{sessionID}/terminal` — server.experimental.persistentPty.create

Operation ID: `server.experimental.persistentPty.create`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `sessionID` | 是 |

请求体示例：

```json
{
  "args": [
    "example"
  ],
  "title": "example",
  "env": {}
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/experimental/session/{{sessionID}}/terminal' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "args": [
      "example"
    ],
    "title": "example",
    "env": {}
  }'
```

### `POST /api/experimental/persistent-pty/shutdown` — server.experimental.persistentPty.shutdown

Operation ID: `server.experimental.persistentPty.shutdown`

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/experimental/persistent-pty/shutdown' \
  --user '{{username}}:{{password}}'
```

### `POST /api/experimental/persistent-pty/handoff` — server.experimental.persistentPty.handoff

Operation ID: `server.experimental.persistentPty.handoff`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/experimental/persistent-pty/handoff' \
  --user '{{username}}:{{password}}'
```

### `GET /api/experimental/persistent-pty/{ptyID}` — server.experimental.persistentPty.get

Operation ID: `server.experimental.persistentPty.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/persistent-pty/{{ptyID}}' \
  --user '{{username}}:{{password}}'
```

### `PUT /api/experimental/persistent-pty/{ptyID}` — server.experimental.persistentPty.update

Operation ID: `server.experimental.persistentPty.update`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |

请求体示例：

```json
{
  "size": {
    "cols": 1,
    "rows": 1
  }
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request PUT \
  --url '{{baseUrl}}/api/experimental/persistent-pty/{{ptyID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "size": {
      "cols": 1,
      "rows": 1
    }
  }'
```

### `DELETE /api/experimental/persistent-pty/{ptyID}` — server.experimental.persistentPty.remove

Operation ID: `server.experimental.persistentPty.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/experimental/persistent-pty/{{ptyID}}' \
  --user '{{username}}:{{password}}'
```

### `GET /api/experimental/persistent-pty/{ptyID}/snapshot` — server.experimental.persistentPty.snapshot

Operation ID: `server.experimental.persistentPty.snapshot`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: PtyNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/persistent-pty/{{ptyID}}/snapshot' \
  --user '{{username}}:{{password}}'
```

### `POST /api/experimental/persistent-pty/{ptyID}/connect-token` — server.experimental.persistentPty.connectToken

Operation ID: `server.experimental.persistentPty.connectToken`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| header | `x-opencode-ticket` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `403`: ForbiddenError
- `404`: PtyNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/experimental/persistent-pty/{{ptyID}}/connect-token' \
  --user '{{username}}:{{password}}'
```

### `GET /api/experimental/persistent-pty/{ptyID}/connect` — Connect to a persistent PTY

Stream persistent PTY output through the OpenCode server.

Operation ID: `v2.persistentPty.connect`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `ptyID` | 是 |
| query | `cursor` | 否 |
| query | `role` | 否 |
| query | `attachment_id` | 否 |
| query | `takeover` | 否 |
| query | `input_protocol` | 否 |
| query | `ticket` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `403`: ForbiddenError
- `404`: PtyNotFoundError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/persistent-pty/{{ptyID}}/connect' \
  --user '{{username}}:{{password}}'
```

## shell

Experimental location-scoped shell command routes.

### `GET /api/shell` — List running shell commands

List currently running shell commands for a location. Exited commands are not included.

Operation ID: `v2.shell.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/shell' \
  --user '{{username}}:{{password}}'
```

### `POST /api/shell` — Run shell command

Spawn one non-interactive shell command for a location. Combined stdout/stderr is captured to a file pageable via output.

Operation ID: `v2.shell.create`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

请求体示例：

```json
{
  "command": "example",
  "timeout": 1
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/shell' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "command": "example",
    "timeout": 1
  }'
```

### `GET /api/shell/{id}` — Get shell command

Get one shell command, including its status and exit code once exited.

Operation ID: `v2.shell.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `id` | 是 |
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ShellNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/shell/{{id}}' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/shell/{id}` — Remove shell command

Terminate and remove one shell command and its retained output.

Operation ID: `v2.shell.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `id` | 是 |
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ShellNotFoundError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/shell/{{id}}' \
  --user '{{username}}:{{password}}'
```

### `PATCH /api/shell/{id}/timeout` — Update shell timeout

Replace a running shell command's timeout from now, or clear it with zero.

Operation ID: `v2.shell.timeout`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `id` | 是 |
| query | `location` | 否 |

请求体示例：

```json
{
  "timeout": 1
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ShellNotFoundError

```bash
curl --request PATCH \
  --url '{{baseUrl}}/api/shell/{{id}}/timeout' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "timeout": 1
  }'
```

### `GET /api/shell/{id}/output` — Read shell output

Page through captured combined output by absolute byte cursor.

Operation ID: `v2.shell.output`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `id` | 是 |
| query | `location` | 否 |
| query | `cursor` | 否 |
| query | `limit` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ShellNotFoundError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/shell/{{id}}/output' \
  --user '{{username}}:{{password}}'
```

## reference

Location-scoped project references.

### `GET /api/reference` — List references

List references available in the requested location.

Operation ID: `v2.reference.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/reference' \
  --user '{{username}}:{{password}}'
```

## worktree

Project worktree management routes.

### `GET /api/worktree/{projectID}` — List worktrees

List known local worktrees for a project.

Operation ID: `v2.worktree.list`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `projectID` | 是 |

响应状态：

- `200`: Worktree.List
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/worktree/{{projectID}}' \
  --user '{{username}}:{{password}}'
```

### `POST /api/worktree/{projectID}` — Create worktree

Create a worktree for a project and run its configured setup script.

Operation ID: `v2.worktree.create`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `projectID` | 是 |

请求体示例：

```json
{
  "strategy": "example",
  "directory": "{{directory}}"
}
```

响应状态：

- `200`: Worktree.Info
- `400`: WorktreeError | InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/worktree/{{projectID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "strategy": "example",
    "directory": "{{directory}}"
  }'
```

### `DELETE /api/worktree/{projectID}` — Remove worktree

Remove a managed worktree from a project.

Operation ID: `v2.worktree.remove`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `projectID` | 是 |

请求体示例：

```json
{
  "directory": "{{directory}}",
  "force": false
}
```

响应状态：

- `204`: <No Content>
- `400`: WorktreeError | InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/worktree/{{projectID}}' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "directory": "{{directory}}",
    "force": false
  }'
```

### `POST /api/worktree/{projectID}/refresh` — Refresh worktrees

Reconcile stored worktrees with the project repositories.

Operation ID: `v2.worktree.refresh`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `projectID` | 是 |

响应状态：

- `204`: <No Content>
- `400`: WorktreeError | InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/worktree/{{projectID}}/refresh' \
  --user '{{username}}:{{password}}'
```

## workspace

Workspace lifecycle routes.

### `POST /api/workspace` — Create workspace

Create a logical workspace. A caller-supplied ID is idempotent when retried with the same provider; reusing it with another provider returns a conflict.

Operation ID: `v2.workspace.create`

请求体示例：

```json
{
  "provider": "example"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `404`: ProviderNotFoundError
- `409`: ConflictError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/workspace' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "provider": "example"
  }'
```

### `DELETE /api/workspace/{workspaceID}` — Destroy workspace

Make a workspace not exist. This operation is idempotent: an already-missing workspace succeeds with `destroyed: false`, while a workspace removed by this request returns `destroyed: true`.

Operation ID: `v2.workspace.destroy`

| 位置 | 名称 | 必填 |
|---|---|---:|
| path | `workspaceID` | 是 |

响应状态：

- `200`: Reports whether this request destroyed an existing workspace.
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `500`: UnknownError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/workspace/{{workspaceID}}' \
  --user '{{username}}:{{password}}'
```

## vcs

Location-scoped version control routes.

### `GET /api/vcs` — VCS info

Get current and default branch information for the requested location.

Operation ID: `v2.vcs.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/vcs' \
  --user '{{username}}:{{password}}'
```

### `GET /api/vcs/base` — VCS review base

Infer a local review base from named branch creation history, or the repository default only when currently on that branch. Returns null before the first commit or when the provider lacks base metadata; ambiguous Git history requires an explicit base on diff requests.

Operation ID: `v2.vcs.base`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/vcs/base' \
  --user '{{username}}:{{password}}'
```

### `GET /api/vcs/status` — VCS status

List uncommitted working-copy changes relative to the requested location.

Operation ID: `v2.vcs.status`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/vcs/status' \
  --user '{{username}}:{{password}}'
```

### `GET /api/vcs/branches` — VCS branches

List local and remote branches available at the requested location.

Operation ID: `v2.vcs.branches`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |
| query | `search` | 否 |
| query | `limit` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/vcs/branches' \
  --user '{{username}}:{{password}}'
```

### `GET /api/vcs/diff` — VCS diff

Diff HEAD to the working copy (working), the base merge-base to the working copy (branch), or the base merge-base to HEAD (committed). Omitting base preserves repository-default comparison; supplying it overrides the comparison without saving it.

Operation ID: `v2.vcs.diff`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |
| query | `mode` | 是 |
| query | `base` | 否 |
| query | `context` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/vcs/diff?mode={{mode}}' \
  --user '{{username}}:{{password}}'
```

## debug



### `GET /api/debug/location` — List loaded locations

List locations currently loaded by the server.

Operation ID: `v2.debug.location.list`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/debug/location' \
  --user '{{username}}:{{password}}'
```

### `DELETE /api/debug/location` — Evict a loaded location

Dispose the requested location's cached services so its next use boots them fresh.

Operation ID: `v2.debug.location.evict`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `204`: <No Content>
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request DELETE \
  --url '{{baseUrl}}/api/debug/location' \
  --user '{{username}}:{{password}}'
```

## migration



### `GET /api/experimental/migration/v1` — Get V1 migration status

Return the progress of the V1 to V2 session history migration.

Operation ID: `v2.experimental.migration.v1.status`

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/experimental/migration/v1' \
  --user '{{username}}:{{password}}'
```

## websearch

Location-scoped web search routes.

### `GET /api/websearch/provider` — List web search providers

Return the registered web search providers.

Operation ID: `v2.websearch.providers`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/websearch/provider' \
  --user '{{username}}:{{password}}'
```

### `POST /api/websearch` — Search the web

Run one web search through the selected provider. Specify a provider to override the configured default.

Operation ID: `v2.websearch.query`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

请求体示例：

```json
{
  "query": "Hello from Postman"
}
```

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError
- `503`: ServiceUnavailableError

```bash
curl --request POST \
  --url '{{baseUrl}}/api/websearch' \
  --user '{{username}}:{{password}}' \
  --header 'Content-Type: application/json' \
  --data '{
    "query": "Hello from Postman"
  }'
```

## config

Location-scoped configuration routes.

### `GET /api/config` — Get configuration

Return configuration documents and discovery sources for the requested location, from lowest to highest priority.

Operation ID: `v2.config.get`

| 位置 | 名称 | 必填 |
|---|---|---:|
| query | `location` | 否 |

响应状态：

- `200`: Success
- `400`: InvalidRequestError
- `401`: UnauthorizedError

```bash
curl --request GET \
  --url '{{baseUrl}}/api/config' \
  --user '{{username}}:{{password}}'
```

