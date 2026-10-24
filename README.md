# 어전 · eojeon

**Claude Code를 어전회의로. 교지를 내리면 AI 신하들이 일하고, 윤허를 청한다.**

브라우저에 픽셀 아트 조선 궁궐(어전)과 **내 Claude Code 터미널**을 함께 띄우는 로컬 웹 앱입니다.
사용자는 임금, 명령은 **교지**, 권한 승인은 **윤허**, 결과 보고는 **상소**입니다. Claude Code 본체는 영의정, 서브에이전트는 각 관청의 신하로 나타납니다.

> Claude Code 비공식 도구입니다. Anthropic 과 관계가 없습니다. *Unofficial — not affiliated with Anthropic.*

![demo](docs/screenshot-working.png)

## 무엇이 되나요

- **진짜 Claude Code 그대로**: 화면 아래 터미널은 내 PC의 `claude` 를 PTY 로 띄운 것입니다. 슬래시 명령, 채팅, 권한 창, `/resume`, 모델 전환 등 CLI 에서 되는 건 다 됩니다.
- **시작 옵션**: 작업 폴더 선택, 새 조회, 이어서(`--continue`), 지난 세션 이어받기(`--resume <id>` — 최신순 목록, 제목·첫 메시지 40자·시각), Claude Code 자체 세션 고르기(`--resume`).
- **궁궐 장면**
  - 교지 반포(프롬프트 입력) → 임금이 두루마리를 들고, 교지가 펼쳐지고, 사관이 적습니다.
  - 도구 사용 → 담당 신하가 책상에서 붓질하며 말풍선(`Bash: npm test`, `Edit: src/App.jsx` …).
  - 서브에이전트 시작 → 그 관직의 신하가 문으로 입궐해 자기 책상으로. 끝나면 두루마리를 들고 영의정께 보고하고 퇴궐.
  - 권한 요청 → 어좌 앞에 "윤허를 청하옵니다" 패널과 **윤허 / 불허 / 보류** 도장 버튼. 버튼은 터미널 권한 창에 실제 키를 보냅니다(윤허=`1`, 불허=`Esc`, 보류=터미널로 포커스만).
  - 일을 마침(Stop) → 영의정이 어좌 앞에서 "상소 완료".
  - 도구 실패 → 숨기지 않고 먹물 얼룩 말풍선으로.
- **사관 일지**: 오른쪽에 모든 사건을 시각과 한 줄로 기록.
- **교지 쓰기 입력창**: 한글 입력이 편한 별도 입력창. Enter 를 누르면 터미널에 그대로 들어갑니다.

## 요구 사항

- Node.js 20 이상 (22 권장)
- [Claude Code](https://code.claude.com) 설치 및 로그인 (`claude` 가 PATH 에 있어야 함)
- macOS / Linux (Windows 는 아직 시험하지 않았습니다)

## 설치 · 실행

```bash
git clone https://github.com/hiio420pr/eojeon.git
cd eojeon
npm install
npm start          # http://localhost:4747 이 자동으로 열립니다
```

- `npm start -- --cwd ~/my-project` 기본 작업 폴더 지정
- `npm start -- --port 5000 --no-open`
- `COURT_CLAUDE_BIN=/path/to/claude npm start` 다른 claude 실행 파일 사용
- `npm run demo` — claude 없이 녹화된 장면을 반복 재생(홍보 영상·스크린샷용). `?demo=1&stop=15` 처럼 특정 순간에서 멈출 수 있습니다.
- `npm run fake-hooks` — `npm start` 가 떠 있을 때, 가짜 hook 데이터를 실제 hook 스크립트로 흘려보내 화면 반응을 확인합니다(사용량 0).

## 꾸미기 (court.config.json)

이름, 관직 대응(에이전트 종류 → 관직·관복 색·흉배 문양·자리), 임금 곤룡포 색(`king.robe`), 팔레트, 도장 3종, 말투, 권한 버튼 키를 모두 `court.config.json` 에서 바꿉니다. 새로고침하면 반영됩니다.
모르는 에이전트 종류는 마당의 손님 자리에 "관리"로 섭니다.

## 작동 원리

1. 서버(`server/index.js`)가 `node-pty` 로 `claude --settings <임시 settings.json>` 을 띄우고, WebSocket 으로 브라우저의 xterm.js 와 연결합니다.
2. 임시 settings 파일에는 **hooks 만** 들어 있습니다(SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PostToolUseFailure, PermissionRequest, PermissionDenied, SubagentStart, SubagentStop, Notification, Stop, StopFailure, SessionEnd). 사용자의 `~/.claude/settings.json` 은 건드리지 않습니다. 종료하면 임시 파일을 지웁니다.
3. 각 hook 은 `server/hook.js` 를 실행합니다. stdin 의 hook JSON 을 **짧은 표시용 이벤트로 줄인 뒤**(도구 이름, 명령 첫 줄, 파일 상대 경로 정도, 비밀 패턴 가림) `127.0.0.1` 서버로만 보냅니다. 1.5초 안에 무조건 끝나고, 아무것도 출력하지 않고, 항상 exit 0 — Claude Code 를 막거나 결정을 바꾸지 않습니다.
4. 브라우저가 이벤트를 받아 궁궐 장면과 사관 일지를 그립니다.

## 개인정보

- 모든 것이 내 컴퓨터 안에서만 돕니다. 서버는 `127.0.0.1` 에만 열리고, 외부로 보내는 요청이 없습니다(글꼴·xterm 도 npm 에서 받아 로컬로 서빙, CDN 없음).
- 화면으로 가는 이벤트에는 파일 내용·도구 출력·전체 프롬프트가 없습니다. 프롬프트는 앞 60자, 명령은 첫 줄 56자까지만, API 키·토큰·비밀번호 모양의 문자열은 `***` 로 가립니다.
- 다른 웹사이트가 내 터미널에 입력하지 못하도록 Host·Origin 을 검사하고, hook 수신은 실행마다 새로 만든 토큰으로만 받습니다.
- 세션 목록은 `~/.claude/projects/` 의 기록 파일 앞뒤만 읽기 전용으로 읽습니다.

## 그림에 대해

어좌·일월오봉도·품계석·관복은 모두 직접 그린 단순한 도형입니다. 국보 사진이나 실제 어보·옥새 문양을 따라 그리지 않았습니다. 임금은 특정 역사 인물을 닮지 않은 일반 캐릭터입니다.
픽셀 글꼴: [Galmuri](https://github.com/quiple/galmuri) (SIL OFL 1.1).

## 영감

비슷한 생각을 한 프로젝트들입니다(코드는 가져오지 않았습니다).

- [pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents)
- [paulrobello/claude-office](https://github.com/paulrobello/claude-office)
- [YehudaLevi/pixelagents](https://github.com/YehudaLevi/pixelagents)

## 라이선스

MIT. Claude Code 는 Anthropic 의 제품이며, 이 도구는 Anthropic 과 무관한 비공식 도구입니다.

---

## English (short)

**eojeon** turns Claude Code into a Joseon royal court. You are the king: your prompt is a royal decree, permission prompts become petitions for royal assent, and subagents walk in as court officials.

- Runs your **real** `claude` CLI in a PTY, shown in the browser with xterm.js — every slash command, permission prompt and `/resume`/`--continue`/`--resume <id>` works as usual.
- Hooks are injected per run via `claude --settings <temp file>`; your own settings are untouched. The hook script trims each payload to a tiny display event (tool name, first line of a command, relative path; secrets masked) and posts it to `127.0.0.1` only. It always exits 0 within 1.5 s and never blocks Claude Code.
- Permission buttons send the real keys to the terminal (`1` = Yes, `Esc` = No).
- `npm install && npm start` → http://localhost:4747. `npm run demo` replays a scripted session without claude.
- Everything stays local. No telemetry, no CDN. MIT license. Unofficial; not affiliated with Anthropic.
