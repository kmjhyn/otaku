const app = document.querySelector("#app");

const statusOptions = [
  ["watched", "assets/status/watched-black.png", "assets/status/watched-white.png", "시청 완료"],
  ["watching", "assets/status/watching-black.png", "assets/status/watching-white.png", "시청 중"],
  ["dislike", "assets/status/dislike-black.png", "assets/status/dislike-white.png", "별로예요"],
  ["blank", "?", "?", "미선택"],
];

let state = {
  user: JSON.parse(localStorage.getItem("otakuUser") || "null"),
  app: null,
  view: "home",
  activeGroup: null,
  groupDetail: null,
  tab: 0,
  modal: null,
  error: "",
  notice: "",
  touchStartX: 0,
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[char]);
}

async function api(path, body = {}) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, userId: state.user?.id }),
  });
  const payload = await response.json();
  if (!response.ok || payload.error) {
    throw new Error(payload.error || "문제가 발생했어요.");
  }
  return payload;
}

async function refresh() {
  if (!state.user) {
    render();
    return;
  }
  try {
    state.app = await api("/api/state");
    state.user = state.app.user;
    localStorage.setItem("otakuUser", JSON.stringify(state.user));
  } catch {
    localStorage.removeItem("otakuUser");
    state.user = null;
    state.app = null;
  }
  render();
}

function setError(message) {
  state.error = message;
  state.notice = "";
  render();
}

function setNotice(message) {
  state.notice = message;
  state.error = "";
  render();
}

function render() {
  if (!state.user) {
    renderLogin();
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <h1 class="brand-title">OTAKU</h1>
          <p class="brand-subtitle user-title"><strong>${esc(state.user.nickname)}</strong> 징키스칸</p>
        </div>
        <div class="actions">
          ${state.view === "group" ? `<button class="button secondary" data-action="home">뒤로</button>` : ""}
          <button class="button icon" data-action="open-add" title="콘텐츠 추가">＋</button>
          <button class="button secondary" data-action="logout">로그아웃</button>
        </div>
      </header>
      <main class="page">
        ${renderMessages()}
        ${renderNotifications()}
        ${state.view === "group" ? renderGroup() : renderHome()}
      </main>
      ${renderModal()}
    </div>
  `;
  bindActions();
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-wrap">
      <form class="login-panel" data-form="login">
        <h1>OTAKU</h1>
        <p>징기스칸이 되어보자</p>
        <label class="field">
          <span>이름</span>
          <input name="nickname" autocomplete="username" required>
        </label>
        <label class="field">
          <span>비밀번호</span>
          <input name="password" type="password" autocomplete="current-password" required>
        </label>
        <div class="actions">
          <button class="button" name="mode" value="login">로그인</button>
          <button class="button secondary" name="mode" value="signup">이름 만들기</button>
        </div>
        ${renderMessages()}
      </form>
    </section>
  `;

  document.querySelector("[data-form='login']").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const submitter = event.submitter?.value || "login";
    try {
      const payload = await api(`/api/${submitter}`, {
        nickname: form.get("nickname"),
        password: form.get("password"),
      });
      state.user = payload.user;
      localStorage.setItem("otakuUser", JSON.stringify(state.user));
      state.error = "";
      await refresh();
    } catch (error) {
      setError(error.message);
    }
  });
}

function renderMessages() {
  return `
    ${state.error ? `<div class="error">${esc(state.error)}</div>` : ""}
    ${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}
  `;
}

function renderNotifications() {
  const notes = state.app?.notifications || [];
  if (!notes.length) return "";
  return `
    <div class="notification-stack">
      ${notes.map((note) => `
        <div class="notification">
          <span>${esc(note.message)}</span>
          <button class="link-button" data-action="clear-notes">확인</button>
        </div>
      `).join("")}
    </div>
  `;
}

function renderHome() {
  const groups = state.app?.groups || [];
  return `
    <div class="toolbar">
      <div>
        <h2 class="brand-title">그룹</h2>
        <p class="brand-subtitle">새 그룹을 만들거나 공유 코드로 참여하세요.</p>
      </div>
      <div class="actions">
        <button class="button" data-action="open-create">새 그룹</button>
        <button class="button secondary" data-action="open-join">그룹 참여</button>
      </div>
    </div>
    ${groups.length ? `
      <div class="group-grid">
        ${groups.map((group) => `
          <article class="group-card">
            <button class="group-open" data-action="open-group" data-group-id="${esc(group.id)}">
              <h2>${esc(group.name)}</h2>
              <p>멤버 ${group.members.length}명</p>
            </button>
            <button class="code" data-action="copy-code" data-code="${esc(group.code)}" title="그룹 코드 복사">${esc(group.code)}</button>
          </article>
        `).join("")}
      </div>
    ` : `
      <div class="empty-state">
        <strong>아직 그룹이 없어요.</strong>
        <span>새 그룹을 만들거나 공유 코드로 참여하세요.</span>
      </div>
    `}
  `;
}

function renderGroup() {
  if (!state.groupDetail) return `<div class="empty-state">그룹을 불러오는 중...</div>`;
  const tabNames = ["점령성공!", "다음 점령지", "신대륙"];
  const rows = filteredRows(state.groupDetail.contents, state.groupDetail.members, state.tab);
  return `
    <div class="toolbar">
      <div>
        <h2 class="brand-title">${esc(state.groupDetail.group.name)}</h2>
        <p class="brand-subtitle">공유 코드 ${esc(state.groupDetail.group.code)}</p>
      </div>
    </div>
    <div class="sheet-tabs">
      ${tabNames.map((name, index) => `
        <button class="${state.tab === index ? "active" : ""}" data-action="tab" data-tab="${index}">${name}</button>
      `).join("")}
    </div>
    <section class="swipe-region" data-action="swipe">
      <div class="sheet-wrap">
        <table class="sheet" style="min-width: ${210 + state.groupDetail.members.length * 34}px">
          <colgroup>
            <col class="title-col">
            ${state.groupDetail.members.map(() => `<col class="user-col">`).join("")}
          </colgroup>
          <thead>
            <tr>
              <th class="content-col">제목</th>
              ${state.groupDetail.members.map((member) => `
                <th class="${member.id === state.user.id ? "current-user-cell" : ""}">${esc(member.nickname)}</th>
              `).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((content) => renderContentRow(content)).join("") : `
              <tr><td colspan="${state.groupDetail.members.length + 1}">아직 이 페이지에 표시할 콘텐츠가 없어요.</td></tr>
            `}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderContentRow(content) {
  const rowClass = state.tab === 0 ? decisionClass(content, state.groupDetail.members) : "";
  return `
    <tr class="${rowClass}">
      <td class="content-col">
        <button class="content-chip" data-action="content-detail" data-content-id="${esc(content.id)}">${esc(content.shortTitle)}</button>
      </td>
      ${state.groupDetail.members.map((member) => renderStatusCell(content, member)).join("")}
    </tr>
  `;
}

function renderStatusCell(content, member) {
  const status = content.statuses[member.id] || "blank";
  const mark = renderStatusMark(status);
  if (member.id !== state.user.id) {
    return `<td class="status-${esc(status)}"><span class="cell-status">${mark}</span></td>`;
  }
  return `
    <td
      class="editable-status-cell current-user-cell status-${esc(status)}"
      data-action="open-status"
      data-content-id="${esc(content.id)}"
      title="내 상태 변경"
    >
      <span class="cell-status">${mark}</span>
    </td>
  `;
}

function statusAsset(status, tone = "black") {
  const option = statusOptions.find(([value]) => value === status);
  if (!option) return "";
  return tone === "white" ? option[2] : option[1];
}

function statusLabel(status) {
  return (statusOptions.find(([value]) => value === status) || [])[3] || "";
}

function statusCellTone(status) {
  return status === "watched" || status === "dislike" ? "white" : "black";
}

function renderStatusMark(status) {
  if (status === "blank") return "";
  return `<img class="status-icon" src="${esc(statusAsset(status, statusCellTone(status)))}" alt="${esc(statusLabel(status))}">`;
}

function filteredRows(contents, members, tab) {
  const rows = contents.filter((content) => {
    const ranks = newWorldRank(content, members);
    if (tab === 0) return ranks.blank === 0;
    if (tab === 1) return ranks.watched < members.length && (content.suggestionCount > 0 || ranks.watching > 0);
    return ranks.blank > 0 && content.suggestionCount === 0 && ranks.watching === 0;
  });

  if (tab === 1) {
    return rows.sort((a, b) => {
      const aRank = newWorldRank(a, members);
      const bRank = newWorldRank(b, members);
      return b.suggestionCount - a.suggestionCount
        || bRank.watching - aRank.watching
        || bRank.watched - aRank.watched
        || a.title.localeCompare(b.title);
    });
  }
  if (tab === 2) {
    return rows.sort((a, b) => {
      const aRank = newWorldRank(a, members);
      const bRank = newWorldRank(b, members);
      return bRank.watched - aRank.watched
        || bRank.dislike - aRank.dislike
        || aRank.watching - bRank.watching
        || a.title.localeCompare(b.title);
    });
  }
  return rows;
}

function newWorldRank(content, members) {
  const statuses = members.map((member) => content.statuses[member.id] || "blank");
  return {
    watched: statuses.filter((status) => status === "watched").length,
    dislike: statuses.filter((status) => status === "dislike").length,
    watching: statuses.filter((status) => status === "watching").length,
    blank: statuses.filter((status) => status === "blank").length,
  };
}

function decisionClass(content, members) {
  const statuses = members.map((member) => content.statuses[member.id] || "blank");
  if (statuses.every((status) => status === "watched" || status === "watching")) return "row-green";
  if (statuses.every((status) => status === "dislike")) return "row-red";
  if (statuses.includes("dislike")) return "row-yellow";
  return "";
}

function renderModal() {
  if (!state.modal) return "";
  const modal = state.modal;
  if (modal.type === "add") return renderAddContentModal();
  if (modal.type === "create") return renderSimpleModal("새 그룹", "그룹 이름", "만들기", "create-group");
  if (modal.type === "join") return renderSimpleModal("그룹 참여", "공유 코드", "참여", "join-group");
  if (modal.type === "detail") return renderDetailModal(modal.content);
  if (modal.type === "confirm-delete") return renderDeleteConfirmModal(modal.content);
  if (modal.type === "status") return renderStatusModal(modal.content);
  return "";
}

function renderSimpleModal(title, label, button, formName) {
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="${formName}">
        <div class="modal-head">
          <button type="button" class="link-button" data-action="close-modal">취소</button>
          <h2>${esc(title)}</h2>
          <button class="button">${esc(button)}</button>
        </div>
        <div class="modal-body">
          <label class="field">
            <span>${esc(label)}</span>
            <input name="value" required autofocus>
          </label>
        </div>
      </form>
    </div>
  `;
}

function renderAddContentModal() {
  const groups = state.app?.groups || [];
  const query = state.modal.title || "";
  return `
    <div class="modal-backdrop">
      <form class="modal" data-form="add-content">
        <div class="modal-head">
          <button type="button" class="link-button" data-action="close-modal">취소</button>
          <h2>콘텐츠 추가</h2>
          <button class="button">저장</button>
        </div>
        <div class="modal-body">
          <label class="field">
            <span>콘텐츠 이름</span>
            <input name="title" value="${esc(query)}" data-action="title-input" required autofocus>
          </label>
          <div class="suggestions" data-suggestions>${renderSuggestions(query)}</div>
          <label class="field">
            <span>공유할 그룹</span>
            <select name="groupId" data-action="group-select" required>
              <option value="">그룹 선택</option>
              ${groups.map((group) => `
                <option value="${esc(group.id)}" ${state.modal.groupId === group.id ? "selected" : ""}>${esc(group.name)}</option>
              `).join("")}
            </select>
          </label>
          <input type="hidden" name="status" value="${esc(state.modal.status || "blank")}">
          <div class="status-grid">
            ${statusOptions.map(([value, blackAsset, whiteAsset, label]) => `
              <button type="button" class="status-choice ${state.modal.status === value ? "active" : ""}" data-action="choose-status" data-status="${value}">
                <strong>${value === "blank" ? "?" : `<img class="status-choice-icon" src="${esc(blackAsset)}" alt="${esc(label)}">`}</strong><span>${label}</span>
              </button>
            `).join("")}
          </div>
          <button type="button" class="conquer-button ${state.modal.suggestion === "yes" ? "active" : ""}" data-action="toggle-add-suggestion">
            ${state.modal.suggestion === "yes" ? "그룹에게 추천!" : "징기스칸 하시겠습니까?"}
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderSuggestions(query) {
  const suggestions = (state.app?.contents || [])
    .filter((content) => content.title.toLowerCase().includes(query.toLowerCase()) && query.trim())
    .slice(0, 5);
  return suggestions.map((content) => `
    <button type="button" class="suggestion" data-action="use-suggestion" data-title="${esc(content.title)}">${esc(content.title)}</button>
  `).join("");
}

function bindSuggestionActions(root = document) {
  root.querySelectorAll("[data-action='use-suggestion']").forEach((node) => {
    node.addEventListener("click", handleAction);
  });
}

function renderDetailModal(content) {
  const blankUsers = state.groupDetail.members.filter((member) => (content.statuses[member.id] || "blank") === "blank");
  const mySuggestion = content.suggestions?.[state.user.id] || "";
  const isOwner = content.createdBy === state.user.id;
  const isEditing = Boolean(state.modal.editing);
  const draftTitle = state.modal.title ?? content.title;
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <button type="button" class="link-button" data-action="close-modal">취소</button>
          <h2>${esc(content.shortTitle)}</h2>
          ${isOwner ? `<button type="button" class="link-button danger-link" data-action="confirm-delete">삭제</button>` : `<span></span>`}
        </div>
        <div class="modal-body">
          <div class="detail-list">
            <div class="content-title-row">
              ${isEditing ? `<input class="content-title-input" value="${esc(draftTitle)}" data-action="edit-title-input" autofocus>` : `<strong>${esc(content.title)}</strong>`}
              ${isOwner ? `<button type="button" class="link-button" data-action="${isEditing ? "save-title" : "start-edit-title"}">${isEditing ? "저장" : "수정"}</button>` : ""}
            </div>
            <span>${esc(content.createdByNickname)}님이 추가함</span>
          </div>
          <div class="conquer-row">
            <span>징기스칸 하시겠습니까?</span>
            <div class="segmented">
              <button class="${mySuggestion === "yes" ? "active" : ""}" data-action="save-suggestion" data-suggestion="yes">YES</button>
              <button class="${mySuggestion === "no" ? "active" : ""}" data-action="save-suggestion" data-suggestion="no">NO</button>
            </div>
          </div>
          ${blankUsers.length ? `
            <div class="nudge-block">
              <p>누구에게 징기스칸 하시겠습니까?</p>
              <div class="nudge-grid">
                ${blankUsers.map((member) => `
                  <button class="button danger" data-action="notify" data-content-id="${esc(content.id)}" data-user-id="${esc(member.id)}">${esc(member.nickname)}</button>
                `).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      </div>
    </div>
  `;
}


function renderDeleteConfirmModal(content) {
  return `
    <div class="modal-backdrop">
      <div class="modal confirm-modal">
        <div class="modal-head">
          <span></span>
          <h2>삭제</h2>
          <span></span>
        </div>
        <div class="modal-body">
          <p class="confirm-text">정말 삭제하시겠습니까?</p>
          <div class="actions confirm-actions">
            <button type="button" class="button danger" data-action="delete-content" data-content-id="${esc(content.id)}">YES</button>
            <button type="button" class="button secondary" data-action="cancel-delete">NO</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderStatusModal(content) {
  const currentStatus = content.statuses[state.user.id] || "blank";
  return `
    <div class="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <button type="button" class="link-button" data-action="close-modal">취소</button>
          <h2>상태 변경</h2>
          <span></span>
        </div>
        <div class="modal-body">
          <div class="detail-list">
            <strong>${esc(content.title)}</strong>
          </div>
          <div class="status-grid">
            ${statusOptions.map(([value, blackAsset, whiteAsset, label]) => `
              <button type="button" class="status-choice ${currentStatus === value ? "active" : ""}" data-action="save-status" data-status="${value}">
                <strong>${value === "blank" ? "?" : `<img class="status-choice-icon" src="${esc(blackAsset)}" alt="${esc(label)}">`}</strong><span>${label}</span>
              </button>
            `).join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}

function bindActions() {
  document.querySelectorAll("[data-action]").forEach((node) => {
    const action = node.dataset.action;
    if (action === "title-input") {
      node.addEventListener("input", () => {
        state.modal.title = node.value;
        const suggestions = document.querySelector("[data-suggestions]");
        if (suggestions) {
          suggestions.innerHTML = renderSuggestions(node.value);
          bindSuggestionActions(suggestions);
        }
      });
      return;
    }
    if (action === "group-select") {
      node.addEventListener("change", () => {
        state.modal.groupId = node.value;
      });
      return;
    }
    if (action === "edit-title-input") {
      node.addEventListener("input", () => {
        state.modal.title = node.value;
      });
      return;
    }
    if (action === "swipe") {
      node.addEventListener("touchstart", (event) => {
        state.touchStartX = event.touches[0].clientX;
      }, { passive: true });
      node.addEventListener("touchend", (event) => {
        const endX = event.changedTouches[0].clientX;
        const delta = endX - state.touchStartX;
        if (Math.abs(delta) > 55) {
          state.tab = delta < 0 ? Math.min(2, state.tab + 1) : Math.max(0, state.tab - 1);
          render();
        }
      }, { passive: true });
      return;
    }
    node.addEventListener("click", handleAction);
  });

  document.querySelectorAll("[data-form]").forEach((form) => {
    form.addEventListener("submit", handleForm);
  });
}

async function handleAction(event) {
  const target = event.currentTarget;
  const action = target.dataset.action;
  if (action === "logout") {
    localStorage.removeItem("otakuUser");
    state = { ...state, user: null, app: null, view: "home", activeGroup: null, groupDetail: null, modal: null };
    render();
  }
  if (action === "home") {
    state.view = "home";
    state.groupDetail = null;
    render();
  }
  if (action === "open-add") {
    state.modal = { type: "add", status: "blank", title: "", suggestion: "" };
    render();
  }
  if (action === "open-create") {
    state.modal = { type: "create" };
    render();
  }
  if (action === "open-join") {
    state.modal = { type: "join" };
    render();
  }
  if (action === "close-modal") {
    state.modal = null;
    render();
  }
  if (action === "choose-status") {
    state.modal.status = target.dataset.status;
    render();
  }
  if (action === "toggle-add-suggestion") {
    state.modal.suggestion = state.modal.suggestion === "yes" ? "" : "yes";
    render();
  }
  if (action === "use-suggestion") {
    state.modal.title = target.dataset.title;
    render();
  }
  if (action === "copy-code") {
    event.stopPropagation();
    await copyText(target.dataset.code);
    setNotice(`그룹 코드 ${target.dataset.code}를 복사했어요.`);
  }
  if (action === "open-group") {
    await openGroup(target.dataset.groupId);
  }
  if (action === "tab") {
    state.tab = Number(target.dataset.tab);
    render();
  }
  if (action === "content-detail") {
    const content = state.groupDetail.contents.find((item) => item.id === target.dataset.contentId);
    state.modal = { type: "detail", content };
    render();
  }
  if (action === "confirm-delete") {
    state.modal = { type: "confirm-delete", content: state.modal.content };
    render();
  }
  if (action === "cancel-delete") {
    state.modal = { type: "detail", content: state.modal.content };
    render();
  }
  if (action === "start-edit-title") {
    state.modal = { ...state.modal, editing: true, title: state.modal.content.title };
    render();
  }
  if (action === "edit-title-input") {
    state.modal.title = target.value;
  }
  if (action === "save-title") {
    try {
      const contentId = state.modal.content.id;
      await api("/api/content/rename", {
        groupId: state.groupDetail.group.id,
        contentId,
        title: state.modal.title,
      });
      await openGroup(state.groupDetail.group.id, false);
      const content = state.groupDetail.contents.find((item) => item.id === contentId);
      state.modal = { type: "detail", content, editing: false };
      setNotice("콘텐츠 이름을 저장했어요.");
    } catch (error) {
      setError(error.message);
    }
  }
  if (action === "delete-content") {
    try {
      const contentId = target.dataset.contentId || state.modal?.content?.id;
      if (!contentId) throw new Error("삭제할 콘텐츠를 찾을 수 없어요.");
      const groupId = state.groupDetail.group.id;
      await api("/api/content/delete", {
        groupId,
        contentId,
      });
      state.modal = null;
      await refresh();
      if (state.view === "group") await openGroup(groupId, false);
      setNotice("콘텐츠를 삭제했어요.");
    } catch (error) {
      setError(error.message);
    }
  }
  if (action === "save-suggestion") {
    try {
      const contentId = state.modal.content.id;
      const nextSuggestion = state.modal.content.suggestions?.[state.user.id] === target.dataset.suggestion ? "" : target.dataset.suggestion;
      await api("/api/content/update-suggestion", {
        groupId: state.groupDetail.group.id,
        contentId,
        suggestion: nextSuggestion,
      });
      await openGroup(state.groupDetail.group.id, false);
      const content = state.groupDetail.contents.find((item) => item.id === contentId);
      state.modal = { type: "detail", content };
      setNotice("징기스칸 선택을 저장했어요.");
    } catch (error) {
      setError(error.message);
    }
  }
  if (action === "open-status") {
    const content = state.groupDetail.contents.find((item) => item.id === target.dataset.contentId);
    state.modal = { type: "status", content };
    render();
  }
  if (action === "save-status") {
    try {
      await api("/api/content/update-status", {
        groupId: state.groupDetail.group.id,
        contentId: state.modal.content.id,
        status: target.dataset.status,
      });
      state.modal = null;
      await openGroup(state.groupDetail.group.id, false);
      state.notice = "";
      state.error = "";
      render();
    } catch (error) {
      setError(error.message);
    }
  }
  if (action === "notify") {
    try {
      await api("/api/notify", {
        groupId: state.groupDetail.group.id,
        contentId: target.dataset.contentId,
        targetUserId: target.dataset.userId,
      });
      state.modal = null;
      await openGroup(state.groupDetail.group.id, false);
      setNotice("알림을 보냈어요.");
    } catch (error) {
      setError(error.message);
    }
  }
  if (action === "clear-notes") {
    state.app = await api("/api/notifications/read");
    render();
  }
}

async function handleForm(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  try {
    if (form.dataset.form === "create-group") {
      state.app = await api("/api/group/create", { name: data.get("value") });
      state.modal = null;
      setNotice("그룹을 만들었어요.");
    }
    if (form.dataset.form === "join-group") {
      state.app = await api("/api/group/join", { code: data.get("value") });
      state.modal = null;
      setNotice("그룹에 참여했어요.");
    }
    if (form.dataset.form === "add-content") {
      state.app = await api("/api/content/add", {
        title: data.get("title"),
        groupId: state.modal.groupId || data.get("groupId"),
        status: state.modal.status || "blank",
        suggestion: state.modal.suggestion || "",
      });
      state.modal = null;
      if (state.view === "group") await openGroup(state.groupDetail.group.id, false);
      setNotice("콘텐츠를 저장했어요.");
    }
  } catch (error) {
    setError(error.message);
  }
}

async function openGroup(groupId, shouldRender = true) {
  state.groupDetail = await api("/api/group/detail", { groupId });
  state.activeGroup = groupId;
  state.view = "group";
  if (shouldRender) render();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

refresh();
