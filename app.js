const state = {
  meta: null,
  allCases: [],
  cases: [],
  persona: "",
  query: "",
  current: null,
  editor: null,
  shapes: null,
  shapeQuery: "",
  focus: null,
  focusQuery: "",
  interpretations: null,
};

const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]);
const safeUrl = (value) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
};

let publicSnapshot;
async function api(path, options = {}) {
  if (options.method && options.method !== "GET") {
    throw new Error("公开浏览版只供阅读；请在本地数据库中编辑。");
  }
  if (!publicSnapshot) {
    const response = await fetch("./snapshot.json");
    if (!response.ok) throw new Error("无法读取公开旅程数据");
    publicSnapshot = await response.json();
  }
  const url = new URL(path, location.href);
  if (url.pathname === "/api/meta") return publicSnapshot.meta;
  if (url.pathname === "/api/shapes") return publicSnapshot.shapes;
  if (url.pathname === "/api/focus") return publicSnapshot.focus;
  if (url.pathname === "/api/interpretations") return publicSnapshot.interpretations;
  if (url.pathname === "/api/cases") {
    const keyword = (url.searchParams.get("q") || "").toLocaleLowerCase();
    const persona = url.searchParams.get("persona") || "";
    return publicSnapshot.cases.filter((item) => {
      if (persona && item.persona_id !== persona) return false;
      if (!keyword) return true;
      const events = publicSnapshot.details[item.case_id]?.events || [];
      const text = [item.case_id, item.chapter_title, item.chapter_summary,
        item.scene, ...events.map((event) => event.description)].join(" ").toLocaleLowerCase();
      return text.includes(keyword);
    });
  }
  const match = /^\/api\/cases\/([A-Za-z0-9-]+)$/.exec(url.pathname);
  if (match) {
    const detail = publicSnapshot.details[match[1]];
    if (detail) return detail;
    throw new Error("案例不存在");
  }
  throw new Error("公开浏览版没有此接口");
}

let toastTimer;
function toast(message) {
  const target = el("toast");
  target.textContent = message;
  target.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { target.hidden = true; }, 3500);
}

function sourceOptions(selected = "") {
  return (state.meta?.sources || []).map((source) =>
    `<option value="${escapeHtml(source.source_id)}" ${selected === source.source_id ? "selected" : ""}>${escapeHtml(source.source_id)} · ${escapeHtml(source.source_name)}</option>`
  ).join("");
}

function renderNavigation() {
  const counts = Object.fromEntries(state.meta.personas.map((persona) => [persona.persona_id, 0]));
  state.allCases.forEach((item) => { counts[item.persona_id] = (counts[item.persona_id] || 0) + 1; });
  el("personaNav").innerHTML = state.meta.personas.map((persona) => `
    <button type="button" class="persona-button ${state.persona === persona.persona_id ? "active" : ""}"
      data-persona="${escapeHtml(persona.persona_id)}" aria-pressed="${state.persona === persona.persona_id}">
      <span class="persona-code">${escapeHtml(persona.persona_id)}</span>
      <span class="persona-name">${escapeHtml(persona.persona_name)} · ${counts[persona.persona_id]}</span>
    </button>`).join("");
  el("totalCount").textContent = state.meta.case_count;
  el("eventCount").textContent = state.meta.event_count;
}

function focusMarkup(profile, { compact = false } = {}) {
  if (!profile?.items?.length) {
    return `<div class="focus-empty">叙事关注对象待编码</div>`;
  }
  const items = profile.items;
  const coverage = profile.coded_events === profile.total_events
    ? "全部行动已编码"
    : `已编码 ${profile.coded_events}/${profile.total_events} 个行动 · 有内容待复核`;
  return `<div class="focus-profile ${compact ? "focus-compact" : ""}">
    <div class="focus-profile-head"><strong>叙事关注对象</strong><span>${escapeHtml(coverage)}</span></div>
    <div class="focus-share-bar" role="img" aria-label="${escapeHtml(items.map((item) => `${item.name} ${item.share}%`).join("，"))}">
      ${items.map((item) => `<span class="focus-segment focus-${escapeHtml(item.id)}" style="width:${Number(item.share)}%"></span>`).join("")}
    </div>
    <div class="focus-tags">${items.map((item) => `<span class="focus-tag"><i class="focus-dot focus-${escapeHtml(item.id)}"></i><span>${escapeHtml(item.name)}</span><b>${Number(item.share).toFixed(1)}%</b></span>`).join("")}</div>
  </div>`;
}

function interpretationMarkup(profile, { compact = false } = {}) {
  if (!profile) return "";
  const concern = `<span class="interpretation-chip"><b>核心关切</b>${escapeHtml(profile.关切判断)}</span>`;
  const meaning = `<span class="interpretation-chip meaning-chip"><b>${profile.赋义 === "not_applicable" ? "作者赋义" : "赋义方式"}</b>${escapeHtml(profile.赋义判断)}</span>`;
  return `<div class="interpretation-profile ${compact ? "interpretation-compact" : ""}">${concern}${meaning}</div>`;
}

function renderList() {
  const persona = state.meta.personas.find((item) => item.persona_id === state.persona);
  el("listTitle").textContent = persona ? persona.persona_name : "旅程目录";
  el("resultCount").textContent = `${state.cases.length} 条旅程`;
  el("breadcrumb").textContent = persona ? persona.scene : "全部旅程";
  if (!state.cases.length) {
    el("caseList").innerHTML = `<div class="empty-state"><h3>这里还没有匹配的旅程</h3><p>试试其他关键词，或选择左侧的场景。</p></div>`;
    return;
  }
  el("caseList").innerHTML = state.cases.map((item) => `
    <a class="case-card" href="#case/${escapeHtml(item.case_id)}" aria-label="查看${escapeHtml(item.chapter_title)}">
      <div class="card-top"><span class="case-code">${escapeHtml(item.case_id)}${item.has_narrative_version ? " · 双版本对比" : ""}</span><span class="case-persona">${escapeHtml(item.source_type === "公开资料约束的模拟案例" ? "模拟案例" : item.persona_name)}</span></div>
      <h3>${escapeHtml(item.chapter_title)}</h3>
      <p>${escapeHtml(item.chapter_summary)}</p>
      ${interpretationMarkup(item.interpretation_profile, { compact: true })}
      ${focusMarkup(item.focus_profile, { compact: true })}
      <div class="card-bottom"><span>${escapeHtml(item.scene)}</span><strong>${item.event_count} 个行动节点 <span class="card-arrow" aria-hidden="true">↗</span></strong></div>
    </a>`).join("");
}

async function loadList(refreshMeta = false) {
  if (refreshMeta || !state.meta) {
    const [meta, allCases] = await Promise.all([api("/api/meta"), api("/api/cases")]);
    state.meta = meta;
    state.allCases = allCases;
  }
  const params = new URLSearchParams();
  if (state.query) params.set("q", state.query);
  if (state.persona) params.set("persona", state.persona);
  state.cases = params.size ? await api(`/api/cases?${params}`) : state.allCases;
  renderNavigation();
  renderList();
}

function evidenceMarkup(event) {
  const url = safeUrl(event.source_url);
  const evidenceTypes = {
    source_observed: "作者报告已发生",
    planned: "仅为计划",
    recommended: "仅为建议",
    ai_synthesized: "资料约束的模拟",
  };
  const source = url
    ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.source_name || event.source_id)}</a>`
    : escapeHtml(event.source_name || event.source_id || "未设置来源");
  return `<div class="evidence" hidden>
    <p><strong>证据性质：</strong>${escapeHtml(evidenceTypes[event.support_type] || event.support_type || "未标注")}</p>
    <p><strong>${event.support_type === "ai_synthesized" ? "来源与模拟边界" : "支持的说法"}：</strong>${escapeHtml(event.supported_claim || "未填写")}</p>
    <p><strong>原文定位：</strong>${escapeHtml(event.source_anchor || "未填写")}</p>
    <p><strong>来源：</strong>${source}</p>
    <p><strong>审核：</strong>${escapeHtml(event.review_status || "待人工审核")}</p>
  </div>`;
}

function eventMarkup(event, index, list, versionKey = "") {
  const optimized = Boolean(versionKey);
  const id = optimized ? event.narrative_event_id : event.event_id;
  const actionPrefix = optimized ? "narrative-event" : "event";
  return `<article class="timeline-event">
    <div class="event-time">${escapeHtml(event.time_label)}</div>
    <span class="event-node" aria-hidden="true"></span>
    <div class="event-card">
      <div class="event-role"><span>${escapeHtml(event.narrative_role || `行动 ${event.position}`)}</span><span class="event-actions"><button type="button" data-action="move-${actionPrefix}" data-direction="up" data-id="${id}" aria-label="上移此行动" ${index === 0 ? "disabled" : ""}>↑</button><button type="button" data-action="move-${actionPrefix}" data-direction="down" data-id="${id}" aria-label="下移此行动" ${index === list.length - 1 ? "disabled" : ""}>↓</button><button type="button" data-action="edit-${actionPrefix}" data-id="${id}" aria-label="编辑此行动">编辑</button><button type="button" data-action="delete-${actionPrefix}" data-id="${id}" aria-label="删除此行动">删除</button></span></div>
      <h3>${escapeHtml(event.description)}</h3>
      ${event.uncertainty_note ? `<p class="event-note">${escapeHtml(event.uncertainty_note)}</p>` : ""}
      <button class="evidence-toggle" type="button" aria-expanded="false">查看来源与证据 ↘</button>
      ${evidenceMarkup(event)}
    </div>
  </article>`;
}

function narrativeMarkup(version) {
  const events = version.events || [];
  return `<div class="narrative-head">
      <span class="eyebrow">${escapeHtml(version.version_name)} · 行动时间线</span>
      <button type="button" class="inline-edit" data-action="edit-narrative" data-key="${escapeHtml(version.version_key)}">编辑版本说明</button>
    </div>
    <h2>${escapeHtml(version.title)}</h2>
    ${version.dek ? `<p class="narrative-dek">${escapeHtml(version.dek)}</p>` : ""}
    <div class="section-heading narrative-event-heading"><h3>行动时间线</h3><span>${events.length} 个行动节点</span></div>
    <div class="timeline optimized-timeline">${events.map((event, index, list) => eventMarkup(event, index, list, version.version_key)).join("")}</div>
    <button type="button" class="add-event-button" data-action="add-narrative-event" data-key="${escapeHtml(version.version_key)}">＋ 添加优化节点</button>
    <details class="narrative-note"><summary>查看叙事依据与边界</summary><p>${escapeHtml(version.editor_note || "暂无说明")}</p></details>`;
}

function renderDetail(item) {
  const sourceUrl = safeUrl(item.source_url);
  const sourceLink = sourceUrl
    ? `<a href="${escapeHtml(sourceUrl)}" target="_blank" rel="noopener noreferrer">阅读原文 ↗</a>`
    : "来源链接未设置";
  const audit = item.audit || {};
  const version = item.narrative_versions?.find((entry) => entry.version_key === "narrative-v1") || item.narrative_versions?.[0];
  const timelineContent = `
    <div class="section-heading"><h2>行动时间线</h2><span>${item.events.length} 个行动节点</span></div>
    <div class="timeline">${item.events.map(eventMarkup).join("")}</div>
    <button type="button" class="add-event-button" data-action="add-event">＋ 添加行动节点</button>`;
  const asideContent = `
    <section class="info-card interpretation-detail-card"><h3>这一天在意什么，怎样回望</h3>
      ${interpretationMarkup(item.interpretation_profile)}
      ${item.interpretation_profile ? `<dl>
        <div><dt>关切依据与性质</dt><dd>${escapeHtml(item.interpretation_profile.关切依据)}<br>${escapeHtml(item.interpretation_profile.关切性质)}</dd></div>
        <div><dt>赋义依据与性质</dt><dd>${escapeHtml(item.interpretation_profile.赋义依据)}<br>${escapeHtml(item.interpretation_profile.赋义性质)}</dd></div>
        <div><dt>备选读法与边界</dt><dd>${escapeHtml(item.interpretation_profile.备选读法)}</dd></div>
      </dl>` : `<p>此案例尚未进行关切与赋义分析。</p>`}
      <a href="#interpretations" class="focus-method-link">查看类型目录与编码规则 ↗</a>
    </section>
    <section class="info-card focus-detail-card"><h3>叙事关注对象</h3>
      ${focusMarkup(item.focus_profile)}
      <p class="focus-method-short">百分比按原始时间轴的行动描述文字估算；同一行动涉及多个对象时等分。它不代表游玩时间。</p>
      <a href="#focus" class="focus-method-link">查看对象总表与编码规则 ↗</a>
    </section>
    <section class="info-card"><h3>旅程档案</h3><dl>
      <div><dt>场景</dt><dd>${escapeHtml(item.scene)}</dd></div>
      <div><dt>状态</dt><dd><span class="status-chip">${escapeHtml(item.case_status)}</span></dd></div>
      <div><dt>案例性质</dt><dd>${escapeHtml(item.source_type)}</dd></div>
      <div><dt>案例说明</dt><dd>${escapeHtml(item.notes || "暂无说明")}</dd></div>
    </dl></section>
    <section class="info-card"><h3>主要来源</h3><dl>
      <div><dt>来源编号</dt><dd>${escapeHtml(item.source_id)}</dd></div>
      <div><dt>标题</dt><dd>${escapeHtml(item.source_name || "未填写")}</dd></div>
      <div><dt>作者 / 发布方</dt><dd>${escapeHtml(item.publisher_author || "未填写")}</dd></div>
      <div><dt>发表日期 / 版本</dt><dd>${escapeHtml(item.source_date_version || "未填写")}</dd></div>
      <div><dt>使用限制</dt><dd>${escapeHtml(item.limitations || "未填写")}</dd></div>
      <div><dt>原文</dt><dd>${sourceLink}</dd></div>
    </dl><button type="button" class="inline-edit" data-action="edit-source">编辑来源信息</button></section>
    <section class="info-card"><h3>生成与审核边界</h3><dl>
      <div><dt>生成方式</dt><dd>${escapeHtml(audit.generation_method || "新建案例；待补充")}</dd></div>
      <div><dt>可生成边界</dt><dd>${escapeHtml(audit.simulation_boundary || "请核对每个行动与原文的关系")}</dd></div>
      <div><dt>审核状态</dt><dd>${escapeHtml(audit.review_status || "待审核")}</dd></div>
      <div><dt>审核备注</dt><dd>${escapeHtml(audit.review_notes || "暂无")}</dd></div>
    </dl></section>`;
  const detailBody = version ? `
    <div class="comparison-intro"><div><span class="eyebrow">同一段经历 · 两条时间线</span><p>两版都按行动顺序展开，可逐节点比较时间、选择和证据。</p></div><span class="comparison-count">原始 ${item.events.length} 节点 · 优化 ${(version.events || []).length} 节点</span></div>
    <div class="comparison-grid">
      <section class="comparison-panel original-panel" aria-label="原始行动时间线"><span class="comparison-label">原始版</span>${timelineContent}</section>
      <section class="comparison-panel revised-panel" aria-label="优化后的行动时间线"><span class="comparison-label revised-label">优化版</span>${narrativeMarkup(version)}</section>
    </div>
    <aside class="detail-aside comparison-aside" aria-label="案例补充信息">${asideContent}</aside>` : `
    <div class="detail-grid"><div>${timelineContent}</div><aside class="detail-aside" aria-label="案例补充信息">${asideContent}</aside></div>`;
  el("breadcrumb").textContent = `${item.persona_name} / ${item.case_id}`;
  el("detail").innerHTML = `
    <button class="back-button" type="button" data-action="back">← 返回旅程目录</button>
    <div class="detail-header">
      <div class="detail-kicker"><span>${escapeHtml(item.case_id)}</span><span class="divider"></span><span>${escapeHtml(item.persona_name)}</span><span class="divider"></span><span>${escapeHtml(item.source_type === "公开资料约束的模拟案例" ? "模拟案例 · 时间为模拟" : item.case_status)}</span></div>
      <h1>${escapeHtml(item.chapter_title)}</h1>
      <p>${escapeHtml(item.chapter_summary)}</p>
      <div class="detail-header-actions">
        <button type="button" class="outline-light" data-action="edit-case">编辑旅程</button>
        <button type="button" class="outline-light danger" data-action="delete-case">删除旅程</button>
      </div>
    </div>
    ${detailBody}`;
}

async function showCase(caseId) {
  const item = await api(`/api/cases/${encodeURIComponent(caseId)}`);
  state.current = item;
  el("overview").hidden = true;
  el("detail").hidden = false;
  el("shapeLibrary").hidden = true;
  el("focusLibrary").hidden = true;
  el("interpretationLibrary").hidden = true;
  renderDetail(item);
  window.scrollTo({ top: 0, behavior: "instant" });
}

function shapeCard(item) {
  const cases = (item.已观察案例 || []).map((id) =>
    `<a href="#case/${escapeHtml(id)}" class="shape-case-link">${escapeHtml(id)} ↗</a>`
  ).join("");
  const parts = item.组成?.length ? `<p class="shape-structure">${item.组成.map(escapeHtml).join(" ＋ ")}</p>`
    : item.结构 ? `<p class="shape-structure">${escapeHtml(item.结构)}</p>` : "";
  return `<article class="shape-card">
    <div class="shape-card-top"><span class="shape-code">${escapeHtml(item.编号)}</span><span class="shape-count">${(item.已观察案例 || []).length ? "真实案例观察" : "保留未知"}</span></div>
    <h3>${escapeHtml(item.名称)}</h3>
    ${parts}
    <p class="shape-description">${escapeHtml(item.说明 || "这一组合可由各层形状组成；具体节点、时长和触发须逐案核对。")}</p>
    ${item.时间层提醒 ? `<p class="shape-reminder">${escapeHtml(item.时间层提醒)}</p>` : ""}
    ${cases ? `<div class="shape-cases"><span>查看案例</span>${cases}</div>` : ""}
  </article>`;
}

function renderShapeLibrary() {
  const query = state.shapeQuery.toLocaleLowerCase();
  const groups = state.shapes?.维度 || [];
  const layerMarkup = groups.map((group) => {
    const items = group.取值.filter((item) =>
      !query || `${item.编号} ${item.名称} ${item.说明 || ""} ${(item.已观察案例 || []).join(" ")}`.toLocaleLowerCase().includes(query)
    );
    if (!items.length) return "";
    return `<section class="shape-group"><div class="shape-group-head"><h2>${escapeHtml(group.名称)}</h2><span>${items.length} 项</span></div>
      <div class="shape-grid">${items.map(shapeCard).join("")}</div></section>`;
  }).join("");
  el("shapeLibrary").innerHTML = `
    <div class="shape-hero"><span class="eyebrow">单日旅程 · 试行版 V0.1</span><h1>行动形状库</h1>
      <p>用四层结构描述一天怎样展开：路径骨架、停留节奏、实际调整与同行组织。每条旅程可以组合多个形状；具体原因和时刻仍回到原文核对。</p>
      <div class="shape-formula"><span>路径骨架</span><b>＋</b><span>停留节奏</span><b>＋</b><span>实际调整</span><b>＋</b><span>同行组织</span></div>
      <p class="shape-boundary">来自 22 条公开作者自述的初步试编码。案例链接展示观察实例，不表示这种形状的常见程度；3 条家庭模拟案例未参加归纳。</p>
    </div>
    <div class="shape-toolbar"><div><h2>形状目录</h2><p>选择形状后，可进入对应的真实旅程时间线。</p></div>
      <label class="search-field"><span class="sr-only">搜索行动形状</span><input id="shapeSearch" type="search" value="${escapeHtml(state.shapeQuery)}" placeholder="搜索形状、编号或案例"></label></div>
    ${layerMarkup || `<div class="empty-state"><h3>没有匹配的形状</h3><p>试试其他关键词。</p></div>`}
    <section class="shape-gaps"><h2>下一轮要找的行动形状</h2><p>这些是待找真实旅记的候选，不计入已观察类型。</p>
      <div>${(state.shapes?.待找真实旅记的候选 || []).map((gap) => `<span>${escapeHtml(gap)}</span>`).join("")}</div></section>`;
  el("shapeSearch").addEventListener("input", (event) => {
    const position = event.target.selectionStart;
    state.shapeQuery = event.target.value.trim();
    renderShapeLibrary();
    const input = el("shapeSearch");
    input.focus();
    input.setSelectionRange(position, position);
  });
}

async function showShapeLibrary() {
  if (!state.shapes) state.shapes = await api("/api/shapes");
  state.current = null;
  el("overview").hidden = true;
  el("detail").hidden = true;
  el("shapeLibrary").hidden = false;
  el("focusLibrary").hidden = true;
  el("interpretationLibrary").hidden = true;
  el("breadcrumb").textContent = "行动形状库";
  el("shapeLibraryLink").classList.add("active");
  renderShapeLibrary();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderFocusLibrary() {
  const query = state.focusQuery.toLocaleLowerCase();
  const objects = (state.focus?.objects || []).filter((item) =>
    !query || `${item.name} ${item.definition} ${item.boundary} ${item.cases.map((row) => `${row.case_id} ${row.title}`).join(" ")}`
      .toLocaleLowerCase().includes(query)
  );
  const cards = objects.map((item) => {
    const cases = item.cases.map((row) => `
      <a class="focus-case-link" href="#case/${escapeHtml(row.case_id)}">
        <span>${escapeHtml(row.case_id)} · ${escapeHtml(row.title)}</span>
        <strong>${Number(row.share).toFixed(1)}%${row.source_type === "公开资料约束的模拟案例" ? " · 模拟" : ""}</strong>
      </a>`).join("");
    return `<article class="focus-object-card">
      <div class="focus-object-top"><span class="focus-object-icon focus-${escapeHtml(item.id)}"></span><span>${item.case_count} 条案例 · 其中真实整理 ${item.real_case_count} 条</span></div>
      <h3>${escapeHtml(item.name)}</h3>
      <p>${escapeHtml(item.definition)}</p>
      <p class="focus-object-boundary"><strong>不计入：</strong>${escapeHtml(item.boundary)}</p>
      <details><summary>查看涉及的 ${item.case_count} 条旅程</summary><div class="focus-case-list">${cases}</div></details>
    </article>`;
  }).join("");
  el("focusLibrary").innerHTML = `
    <div class="focus-hero"><span class="eyebrow">${state.focus.case_count} 条旅程 · 逐行动阅读</span><h1>叙事关注对象总表</h1>
      <p>看一篇旅程具体在写谁、看什么、与什么发生关系。对象可以同时出现；类别来自本库 25 条时间轴的归纳，不从画像或目的地直接推断。</p>
      <div class="focus-stats"><span><strong>${state.focus.objects.length}</strong> 类关注对象</span><span><strong>${state.focus.coded_events}</strong> / ${state.focus.total_events} 个行动已编码</span><span><strong>${state.focus.case_count}</strong> 条旅程</span></div>
    </div>
    <section class="focus-method"><h2>占比怎样读</h2><p>${escapeHtml(state.focus.method)}</p>
      <details><summary>展开编码边界</summary><ul>${state.focus.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></details></section>
    <div class="focus-toolbar"><div><h2>对象目录</h2><span>${objects.length} / ${state.focus.objects.length} 类</span></div>
      <label class="search-field"><span class="sr-only">搜索叙事关注对象</span><input id="focusSearch" type="search" value="${escapeHtml(state.focusQuery)}" placeholder="搜索对象、解释或案例编号"></label></div>
    <div class="focus-object-grid">${cards || `<div class="empty-state"><h3>没有匹配的对象</h3><p>试试其他关键词。</p></div>`}</div>`;
  el("focusSearch").addEventListener("input", (event) => {
    const position = event.target.selectionStart;
    state.focusQuery = event.target.value.trim();
    renderFocusLibrary();
    const input = el("focusSearch");
    input.focus();
    input.setSelectionRange(position, position);
  });
}

async function showFocusLibrary() {
  state.focus = await api("/api/focus");
  state.current = null;
  el("overview").hidden = true;
  el("detail").hidden = true;
  el("shapeLibrary").hidden = true;
  el("focusLibrary").hidden = false;
  el("interpretationLibrary").hidden = true;
  el("breadcrumb").textContent = "叙事关注对象总表";
  el("focusLibraryLink").classList.add("active");
  renderFocusLibrary();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function renderInterpretationLibrary() {
  const data = state.interpretations;
  const group = (title, items, note) => `<section class="interpretation-group">
    <div class="shape-group-head"><h2>${escapeHtml(title)}</h2><span>${items.length} 种当前取值</span></div>
    <p class="interpretation-group-note">${escapeHtml(note)}</p>
    <div class="interpretation-grid">${items.map((item) => `<article class="interpretation-type">
      <div class="interpretation-type-top"><h3>${escapeHtml(item.名称)}</h3><span>${item.案例.length} 例主标签</span></div>
      <p>${escapeHtml(item.定义)}</p>
      <div class="interpretation-case-links">${item.案例.map((row) => `<a href="#case/${escapeHtml(row.id)}">${escapeHtml(row.id)} ↗</a>`).join("") || "本库暂无主标签案例"}</div>
    </article>`).join("")}</div>
  </section>`;
  el("interpretationLibrary").innerHTML = `<div class="focus-hero">
    <span class="eyebrow">${data.case_count} 条旅程 · 逐例阅读</span><h1>核心关切与作者赋义方式</h1>
    <p>核心关切回答“这一天主要在意什么”；赋义方式回答“作者后来怎样解释或评价”。前者可由多项行动归纳，后者必须核对作者表述。两者都不是叙述篇幅百分比。</p>
  </div><section class="focus-method"><h2>怎样编码</h2><p>${escapeHtml(data.method)}</p>
    <details><summary>展开证据边界</summary><ul>${data.rules.map((rule) => `<li>${escapeHtml(rule)}</li>`).join("")}</ul></details></section>
    ${group("核心关切", data.concerns, "每例一个主要关切；次要关切和逐例依据在案例详情中。")}
    ${group("作者赋义方式", data.meanings, "标签描述本日可支持的评价方式，不代表作者的长期改变。")}`;
}

async function showInterpretationLibrary() {
  state.interpretations = await api("/api/interpretations");
  state.current = null;
  el("overview").hidden = true;
  el("detail").hidden = true;
  el("shapeLibrary").hidden = true;
  el("focusLibrary").hidden = true;
  el("interpretationLibrary").hidden = false;
  el("breadcrumb").textContent = "关切与赋义方式";
  el("interpretationLibraryLink").classList.add("active");
  renderInterpretationLibrary();
  window.scrollTo({ top: 0, behavior: "instant" });
}

async function route() {
  el("shapeLibraryLink").classList.remove("active");
  el("focusLibraryLink").classList.remove("active");
  el("interpretationLibraryLink").classList.remove("active");
  if (location.hash === "#shapes") {
    await showShapeLibrary();
    return;
  }
  if (location.hash === "#focus") {
    await showFocusLibrary();
    return;
  }
  if (location.hash === "#interpretations") {
    await showInterpretationLibrary();
    return;
  }
  const match = /^#case\/([A-Za-z0-9-]+)$/.exec(location.hash);
  if (match) {
    try { await showCase(match[1]); }
    catch (error) { toast(error.message); location.hash = ""; }
  } else {
    state.current = null;
    el("detail").hidden = true;
    el("shapeLibrary").hidden = true;
    el("focusLibrary").hidden = true;
    el("interpretationLibrary").hidden = true;
    el("overview").hidden = false;
    renderList();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
}

function field(name, label, value = "", { required = false, full = false, type = "text", hint = "" } = {}) {
  const content = type === "textarea"
    ? `<textarea name="${name}" ${required ? "required" : ""}>${escapeHtml(value)}</textarea>`
    : `<input name="${name}" type="${type}" value="${escapeHtml(value)}" ${required ? "required" : ""}>`;
  return `<label class="${full ? "full" : ""}">${label}${content}${hint ? `<span class="field-hint">${hint}</span>` : ""}</label>`;
}

function select(name, label, options, selected = "", { required = false, full = false, hint = "" } = {}) {
  return `<label class="${full ? "full" : ""}">${label}<select name="${name}" ${required ? "required" : ""}>${options}</select>${hint ? `<span class="field-hint">${hint}</span>` : ""}</label>`;
}

function option(value, label, selected) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function openEditor(mode, item = {}) {
  state.editor = { mode, item };
  const titles = {
    "new-case": "新建旅程", "edit-case": "编辑旅程",
    "new-event": "添加行动节点", "edit-event": "编辑行动节点",
    "new-source": "添加资料来源", "edit-source": "编辑资料来源",
    "edit-narrative": "编辑优化版说明",
    "new-narrative-event": "添加优化版行动节点", "edit-narrative-event": "编辑优化版行动节点",
  };
  el("dialogTitle").textContent = titles[mode];
  el("dialogEyebrow").textContent = mode.includes("source") ? "来源台账" : mode.includes("event") ? "时间线行动" : mode.includes("narrative") ? "叙事版本" : "旅程案例";
  let fields = "";
  if (mode.endsWith("case")) {
    if (mode === "new-case") {
      fields += select("persona_id", "画像场景", state.meta.personas.map((persona) => option(persona.persona_id, `${persona.persona_id} · ${persona.persona_name}`, state.persona)).join(""), state.persona, { required: true });
    } else {
      fields += `<label>画像场景<input value="${escapeHtml(item.persona_name)}" disabled></label>`;
      fields += select("case_status", "案例状态", ["草稿", "待审核", "已审核"].map((status) => option(status, status, item.case_status)).join(""), item.case_status);
    }
    fields += field("scene", "旅行场景", item.scene || "", { required: true });
    fields += select("source_id", "主要来源", sourceOptions(item.source_id), item.source_id, { required: true, full: true, hint: "先添加来源，再创建案例。只串联同一日行动；具体行动还需分别填写证据锚点。" });
    fields += field("chapter_title", "旅程标题", item.chapter_title || "", { required: true, full: true });
    fields += field("chapter_summary", "旅程概述", item.chapter_summary || "", { required: true, full: true, type: "textarea" });
    fields += field("notes", "案例说明", item.notes || "", { full: true, type: "textarea" });
  } else if (mode.endsWith("event")) {
    fields += field("time_label", "时间表达", item.time_label || "", { required: true, hint: "按原文精度写，例如“午后”“随后”或“约 14:00”。" });
    fields += field("narrative_role", "叙事作用", item.narrative_role || "", { hint: "如：遇阻、调整、转场、结果。" });
    fields += field("description", "具体行动", item.description || "", { required: true, full: true, type: "textarea" });
    fields += field("uncertainty_note", "不确定性 / 备注", item.uncertainty_note || "", { full: true, type: "textarea" });
    fields += select("source_id", "对应来源", sourceOptions(item.source_id || state.current?.source_id), item.source_id, { required: true, full: true });
    fields += select("support_type", "证据性质", [
      option("source_observed", "来源中报告发生", item.support_type || "source_observed"),
      option("planned", "仅为计划", item.support_type),
      option("recommended", "仅为建议", item.support_type),
      option("ai_synthesized", "AI 合成", item.support_type),
    ].join(""), item.support_type);
    fields += field("source_anchor", "原文定位 / 锚点", item.source_anchor || "", { full: true, hint: "标出可回查的位置，避免把建议或背景介绍写成已发生的行动。" });
    if (mode === "edit-event" || mode.includes("narrative-event")) {
      fields += field("supported_claim", "来源支持的说法", item.supported_claim || "", { required: true, full: true, type: "textarea" });
    }
    if (mode === "edit-event" || mode === "edit-narrative-event") {
      fields += select("review_status", "审核状态", ["待人工审核", "已审核"].map((status) => option(status, status, item.review_status)).join(""), item.review_status);
    }
  } else if (mode === "edit-narrative") {
    fields += field("title", "叙事标题", item.title || "", { required: true, full: true });
    fields += field("dek", "版本说明", item.dek || "", { full: true, type: "textarea" });
    fields += field("editor_note", "叙事依据与边界", item.editor_note || "", { full: true, type: "textarea" });
  } else {
    fields += field("source_name", "来源标题", item.source_name || "", { required: true, full: true });
    fields += field("source_url", "原文链接", item.source_url || "", { required: true, full: true, type: "url" });
    fields += field("publisher_author", "作者 / 发布方", item.publisher_author || "");
    fields += field("source_date_version", "发表日期 / 版本", item.source_date_version || "");
    fields += field("accessed_at", "访问日期", item.accessed_at || "");
    fields += field("license", "使用许可 / 版权说明", item.license || "");
    fields += field("source_role", "来源在案例中的作用", item.source_role || "", { full: true });
    fields += field("usable_content", "可使用的信息", item.usable_content || "", { full: true, type: "textarea" });
    fields += field("limitations", "使用限制与缺口", item.limitations || "", { full: true, type: "textarea" });
  }
  el("formFields").innerHTML = fields;
  el("formDialog").showModal();
  el("formFields").querySelector("input:not([disabled]), textarea, select")?.focus();
}

async function saveEditor(event) {
  event.preventDefault();
  if (!el("editorForm").reportValidity()) return;
  const { mode, item } = state.editor;
  const data = Object.fromEntries(new FormData(el("editorForm")));
  const submit = el("editorForm").querySelector("button[type=submit]");
  submit.disabled = true;
  try {
    let result;
    if (mode === "new-case") result = await api("/api/cases", { method: "POST", body: JSON.stringify(data) });
    if (mode === "edit-case") result = await api(`/api/cases/${item.case_id}`, { method: "PATCH", body: JSON.stringify(data) });
    if (mode === "new-event") result = await api(`/api/cases/${state.current.case_id}/events`, { method: "POST", body: JSON.stringify(data) });
    if (mode === "edit-event") result = await api(`/api/events/${item.event_id}`, { method: "PATCH", body: JSON.stringify(data) });
    if (mode === "new-source") result = await api("/api/sources", { method: "POST", body: JSON.stringify(data) });
    if (mode === "edit-source") result = await api(`/api/sources/${item.source_id}`, { method: "PATCH", body: JSON.stringify(data) });
    if (mode === "edit-narrative") result = await api(`/api/cases/${state.current.case_id}/narratives/${item.version_key}`, { method: "PATCH", body: JSON.stringify(data) });
    if (mode === "new-narrative-event") result = await api(`/api/cases/${state.current.case_id}/narratives/${item.version_key}/events`, { method: "POST", body: JSON.stringify(data) });
    if (mode === "edit-narrative-event") result = await api(`/api/narrative-events/${item.narrative_event_id}`, { method: "PATCH", body: JSON.stringify(data) });
    el("formDialog").close();
    await loadList(true);
    if (mode === "new-case") location.hash = `#case/${result.case_id}`;
    else if (state.current) await showCase(state.current.case_id);
    toast("已保存到本地数据库");
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function handleDetailClick(event) {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.classList.contains("evidence-toggle")) {
    const panel = target.nextElementSibling;
    panel.hidden = !panel.hidden;
    target.setAttribute("aria-expanded", String(!panel.hidden));
    target.textContent = panel.hidden ? "查看来源与证据 ↘" : "收起来源与证据 ↗";
    return;
  }
  const action = target.dataset.action;
  if (action === "back") location.hash = "";
  if (action === "edit-case") openEditor("edit-case", state.current);
  if (action === "edit-narrative") {
    const version = state.current.narrative_versions?.find((entry) => entry.version_key === target.dataset.key);
    if (version) openEditor("edit-narrative", version);
  }
  if (action === "add-event") openEditor("new-event");
  if (action === "add-narrative-event") openEditor("new-narrative-event", { version_key: target.dataset.key });
  if (action === "edit-source") {
    const source = state.meta.sources.find((item) => item.source_id === state.current.source_id);
    if (source) openEditor("edit-source", source);
  }
  if (action === "edit-event") {
    const item = state.current.events.find((row) => row.event_id === Number(target.dataset.id));
    if (item) openEditor("edit-event", item);
  }
  if (action === "edit-narrative-event") {
    const item = state.current.narrative_versions?.flatMap((version) => version.events || [])
      .find((row) => row.narrative_event_id === Number(target.dataset.id));
    if (item) openEditor("edit-narrative-event", item);
  }
  if (action === "move-event") {
    try {
      await api(`/api/events/${target.dataset.id}/move`, { method: "PATCH", body: JSON.stringify({ direction: target.dataset.direction }) });
      await showCase(state.current.case_id);
      toast("行动顺序已更新");
    } catch (error) { toast(error.message); }
  }
  if (action === "move-narrative-event") {
    try {
      await api(`/api/narrative-events/${target.dataset.id}/move`, { method: "PATCH", body: JSON.stringify({ direction: target.dataset.direction }) });
      await showCase(state.current.case_id);
      toast("优化版行动顺序已更新");
    } catch (error) { toast(error.message); }
  }
  if (action === "delete-event") {
    const item = state.current.events.find((row) => row.event_id === Number(target.dataset.id));
    if (item && confirm(`确定删除行动“${item.description}”吗？此操作无法撤销。`)) {
      try {
        await api(`/api/events/${item.event_id}`, { method: "DELETE" });
        await loadList(true);
        await showCase(state.current.case_id);
        toast("行动节点已删除");
      } catch (error) { toast(error.message); }
    }
  }
  if (action === "delete-narrative-event") {
    const item = state.current.narrative_versions?.flatMap((version) => version.events || [])
      .find((row) => row.narrative_event_id === Number(target.dataset.id));
    if (item && confirm(`确定删除优化版行动“${item.description}”吗？此操作无法撤销。`)) {
      try {
        await api(`/api/narrative-events/${item.narrative_event_id}`, { method: "DELETE" });
        await showCase(state.current.case_id);
        toast("优化版行动节点已删除");
      } catch (error) { toast(error.message); }
    }
  }
  if (action === "delete-case" && confirm(`确定删除“${state.current.chapter_title}”及其全部行动节点吗？此操作无法撤销。`)) {
    try {
      await api(`/api/cases/${state.current.case_id}`, { method: "DELETE" });
      location.hash = "";
      await loadList(true);
      await route();
      toast("旅程已删除");
    } catch (error) { toast(error.message); }
  }
}

let searchTimer;
async function start() {
  await loadList(true);
  await route();
  el("personaNav").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-persona]");
    if (!button) return;
    state.persona = button.dataset.persona;
    if (location.hash) location.hash = "";
    await loadList();
    await route();
  });
  el("clearFilter").addEventListener("click", async () => {
    state.persona = "";
    if (location.hash) location.hash = "";
    await loadList();
    await route();
  });
  el("searchInput").addEventListener("input", (event) => {
    state.query = event.target.value.trim();
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadList().catch((error) => toast(error.message)), 180);
  });
  el("addCaseButton").addEventListener("click", () => openEditor("new-case"));
  el("addSourceButton").addEventListener("click", () => openEditor("new-source"));
  el("closeDialog").addEventListener("click", () => el("formDialog").close());
  el("cancelDialog").addEventListener("click", () => el("formDialog").close());
  el("editorForm").addEventListener("submit", saveEditor);
  el("detail").addEventListener("click", handleDetailClick);
  window.addEventListener("hashchange", () => route().catch((error) => toast(error.message)));
}

start().catch((error) => {
  if (location.hash === "#shapes") {
    el("overview").hidden = true;
    el("detail").hidden = true;
    el("shapeLibrary").hidden = false;
    el("breadcrumb").textContent = "行动形状库";
    el("shapeLibrary").innerHTML = `<div class="empty-state"><h3>暂时无法读取行动形状库</h3><p>${escapeHtml(error.message)}</p></div>`;
  } else if (location.hash === "#focus") {
    el("overview").hidden = true;
    el("detail").hidden = true;
    el("shapeLibrary").hidden = true;
    el("focusLibrary").hidden = false;
    el("breadcrumb").textContent = "叙事关注对象总表";
    el("focusLibrary").innerHTML = `<div class="empty-state"><h3>暂时无法读取叙事关注对象总表</h3><p>${escapeHtml(error.message)}</p></div>`;
  } else if (location.hash === "#interpretations") {
    el("overview").hidden = true;
    el("detail").hidden = true;
    el("shapeLibrary").hidden = true;
    el("focusLibrary").hidden = true;
    el("interpretationLibrary").hidden = false;
    el("breadcrumb").textContent = "关切与赋义方式";
    el("interpretationLibrary").innerHTML = `<div class="empty-state"><h3>暂时无法读取关切与赋义方式</h3><p>${escapeHtml(error.message)}</p></div>`;
  } else {
    el("caseList").innerHTML = `<div class="empty-state"><h3>无法读取旅程数据库</h3><p>${escapeHtml(error.message)}</p></div>`;
  }
  toast(error.message);
});
