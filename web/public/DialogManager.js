function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function asId(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.id != null) return String(value.id);
  return "";
}

function toIdList(values) {
  if (!values) return [];
  const array = Array.isArray(values) ? values : Array.from(values);
  return array
    .map((item) => asId(item))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function renderField(label, value) {
  const safeValue = escapeHtml(String(value ?? "-"));
  return `<div style="display:grid;grid-template-columns:120px 1fr;gap:8px;padding:4px 0;">
    <div style="font-weight:600;color:#374151;">${escapeHtml(label)}</div>
    <div style="color:#111827;word-break:break-word;">${safeValue}</div>
  </div>`;
}

function renderSection(title, bodyHtml) {
  return `<section style="border:1px solid #e5e7eb;border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff;">
    <h4 style="margin:0 0 8px 0;font-size:13px;color:#111827;">${escapeHtml(title)}</h4>
    ${bodyHtml}
  </section>`;
}

function renderTopicDetails(topic) {
  if (!topic || typeof topic !== "object") {
    return renderSection("Topic 信息", "<div style=\"color:#6b7280;\">(未找到 topics.json 对应记录)</div>");
  }

  const standards = Array.isArray(topic.standards) ? topic.standards : [];
  const evidence = Array.isArray(topic.evidence) ? topic.evidence : [];
  const evidenceHtml = evidence.length > 0
    ? `<ul style="margin:4px 0 0 18px;padding:0;">${evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`
    : "<div style=\"color:#6b7280;\">(none)</div>";

  const body = [
    renderField("ID", topic.id ?? "-"),
    renderField("学科", topic.subject ?? "-"),
    renderField("领域", topic.domain ?? "-"),
    renderField("名称", topic.name ?? "-"),
    renderField("类型", topic.type ?? "-"),
    renderField("年龄范围", `${topic.ageRangeStart ?? "-"} - ${topic.ageRangeEnd ?? "-"}`),
    renderField("中心性", topic.centrality ?? "-"),
    renderField("标准数", standards.length),
    renderField("描述", topic.description ?? "-")
  ].join("");

  const evidenceSection = renderSection("证据", evidenceHtml);
  return renderSection("Topic 信息", body) + evidenceSection;
}

function renderNodeDetails(data) {
  if (!data || typeof data !== "object") {
    return renderSection("节点信息", renderField("ID", String(data ?? "(unknown)")));
  }

  const parentIds = toIdList(data.parents);
  const lines = [
    renderField("ID", data.id ?? "(unknown)"),
    renderField("Level", Number.isFinite(data.level) ? data.level : "-"),
    renderField("父节点", parentIds.length > 0 ? parentIds.join(", ") : "(none)"),
    renderField("线束数", Array.isArray(data.bundles) ? data.bundles.length : 0)
  ].join("");

  const topicSection = renderTopicDetails(data.topic);
  return renderSection("节点信息", lines) + topicSection;
}

function renderPathDetails(data) {
  if (!data || typeof data !== "object") {
    return renderSection("路径信息", renderField("ID", String(data ?? "(unknown)")));
  }

  const parentIds = toIdList(data.toword_parents);
  const links = Array.isArray(data.links) ? [...data.links] : [];
  links.sort((a, b) => {
    const ay = Number(a?.yt ?? 0);
    const by = Number(b?.yt ?? 0);
    if (ay !== by) return ay - by;
    return asId(a?.source).localeCompare(asId(b?.source));
  });

  const summary = [
    renderField("ID", data.id ?? "(unknown)"),
    renderField("Level", Number.isFinite(data.level) ? data.level : "-"),
    renderField("Span", Number.isFinite(data.span) ? data.span : "-"),
    renderField("父节点", parentIds.length > 0 ? parentIds.join(", ") : "(none)"),
    renderField("连接数", links.length)
  ].join("");

  const tableRows = links.map((link) => {
    const source = asId(link.source) || "-";
    const target = asId(link.target) || "-";
    return `<tr>
      <td style="padding:4px 6px;border-top:1px solid #e5e7eb;">${escapeHtml(source)}</td>
      <td style="padding:4px 6px;border-top:1px solid #e5e7eb;">${escapeHtml(target)}</td>
    </tr>`;
  }).join("");

  const table = links.length > 0
    ? `<table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #d1d5db;">source</th>
          <th style="text-align:left;padding:4px 6px;border-bottom:1px solid #d1d5db;">target</th>
        </tr>
      </thead>
      <tbody>${tableRows}</tbody>
    </table>`
    : `<div style="color:#6b7280;">(no links)</div>`;

  return renderSection("路径信息", summary) + renderSection("连接明细", table);
}

class DialogManager {
  constructor() {
    this.overlay = null;
    this.panel = null;
    this.titleEl = null;
    this.contentEl = null;
    this.currentDialog = null;
  }

  createContainer() {
    if (this.overlay) return;

    const overlay = document.createElement("div");
    overlay.style.cssText = [
      "position: fixed",
      "top: 0",
      "left: 0",
      "right: 0",
      "bottom: 0",
      "background-color: rgba(0, 0, 0, 0.6)",
      "z-index: 999",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "opacity: 0",
      "transition: opacity 0.2s ease"
    ].join(";");

    const panel = document.createElement("div");
    panel.style.cssText = [
      "background: #fff",
      "width: min(820px, 92vw)",
      "max-height: 82vh",
      "overflow: auto",
      "border-radius: 12px",
      "padding: 14px 16px",
      "box-shadow: 0 12px 32px rgba(0,0,0,0.3)"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;";

    const titleEl = document.createElement("h3");
    titleEl.style.cssText = "margin:0;font-size:16px;";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.textContent = "关闭";
    closeBtn.style.cssText = "border:1px solid #ccc;background:#fff;padding:4px 10px;border-radius:8px;cursor:pointer;";
    closeBtn.addEventListener("click", () => this.close());

    const contentEl = document.createElement("div");

    header.append(titleEl, closeBtn);
    panel.append(header, contentEl);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) this.close();
    });

    this.overlay = overlay;
    this.panel = panel;
    this.titleEl = titleEl;
    this.contentEl = contentEl;

    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      if (this.overlay) this.overlay.style.opacity = "1";
    });
  }

  renderContent(title, payload) {
    this.createContainer();
    if (!this.titleEl || !this.contentEl) return;

    this.titleEl.textContent = title;
    this.contentEl.innerHTML = payload;
  }

  showNodeDialog(nodeIdOrData) {
    const nodeId = typeof nodeIdOrData === "object" ? nodeIdOrData?.id : nodeIdOrData;
    this.currentDialog = {
      type: "node",
      id: nodeId,
      data: typeof nodeIdOrData === "object" ? nodeIdOrData : null
    };

    const content = this.currentDialog.data
      ? renderNodeDetails(this.currentDialog.data)
      : renderSection("节点信息", renderField("ID", nodeId ?? "(unknown)"));
    this.renderContent(`节点: ${nodeId ?? "(unknown)"}`, content);
  }

  showPathDialog(pathIdOrData) {
    const pathId = typeof pathIdOrData === "object" ? pathIdOrData?.id : pathIdOrData;
    this.currentDialog = {
      type: "path",
      id: pathId,
      data: typeof pathIdOrData === "object" ? pathIdOrData : null
    };

    const content = this.currentDialog.data
      ? renderPathDetails(this.currentDialog.data)
      : renderSection("路径信息", renderField("ID", pathId ?? "(unknown)"));
    this.renderContent(`路径: ${pathId ?? "(unknown)"}`, content);
  }

  close() {
    if (!this.overlay) return;

    const overlay = this.overlay;
    overlay.style.opacity = "0";

    setTimeout(() => {
      if (overlay.parentNode) {
        overlay.parentNode.removeChild(overlay);
      }
      if (this.overlay === overlay) {
        this.overlay = null;
        this.panel = null;
        this.titleEl = null;
        this.contentEl = null;
        this.currentDialog = null;
      }
      document.body.style.overflow = "";
    }, 200);
  }

  isOpen() {
    return this.overlay !== null;
  }

  getCurrentDialog() {
    return this.currentDialog;
  }

  switchToNodeDialog(nodeIdOrData) {
    if (this.isOpen()) this.showNodeDialog(nodeIdOrData);
  }

  switchToPathDialog(pathIdOrData) {
    if (this.isOpen()) this.showPathDialog(pathIdOrData);
  }
}

const dialogManager = new DialogManager();

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && dialogManager.isOpen()) {
    dialogManager.close();
  }
});

export {dialogManager, DialogManager};
