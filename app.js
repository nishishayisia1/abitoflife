const $ = id => document.getElementById(id);
const dbName = "abitoflife-records-v1";
const dateFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
const timeFmt = new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
const dayFmt = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" });
const timeline = $("timeline");
let selected = [], records = [], shown = 20, busy = false, imageUrls = [];

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("moments", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function readAll() {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction("moments", "readonly");
      const request = tx.objectStore("moments").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}
async function saveAll(moments) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("moments", "readwrite");
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error("写入已取消"));
      for (const moment of moments) tx.objectStore("moments").put(moment);
    });
  } finally { db.close(); }
}
function showError(message) { $("error").textContent = message; $("error").hidden = !message; }
function status(message) { $("storage-status").textContent = message; }
function updateButton() { $("publish").disabled = busy || (!$("content").value.trim() && !selected.length); }
function node(tag, className, content) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = content;
  return element;
}
function preview() {
  const box = $("selected-photos");
  box.replaceChildren();
  selected.forEach((file, index) => {
    const wrap = node("div", "selected-photo", "");
    const image = document.createElement("img");
    const url = URL.createObjectURL(file);
    image.src = url;
    image.alt = "待保存照片 " + (index + 1);
    image.onload = () => URL.revokeObjectURL(url);
    const remove = node("button", "", "×");
    remove.type = "button";
    remove.setAttribute("aria-label", "移除照片");
    remove.onclick = () => { selected.splice(index, 1); preview(); updateButton(); };
    wrap.append(image, remove);
    box.append(wrap);
  });
}
function render() {
  imageUrls.forEach(url => URL.revokeObjectURL(url));
  imageUrls = [];
  timeline.replaceChildren();
  const visible = records.slice(0, shown);
  $("more").hidden = records.length <= shown;
  if (!records.length) {
    const empty = node("div", "empty", "");
    empty.innerHTML = "<div>✳</div><h3>从这一刻开始</h3><p>写下第一句话，或留下一张照片。<br>以后回头看，这就是故事的开头。</p>";
    timeline.append(empty);
    return;
  }
  let lastDay = "";
  for (const moment of visible) {
    const date = new Date(moment.createdAt);
    const day = dayFmt.format(date);
    if (day !== lastDay) {
      const divider = node("div", "date-divider", "");
      divider.append(node("span", "", dateFmt.format(date)), document.createElement("div"));
      timeline.append(divider);
      lastDay = day;
    }
    const article = node("article", "moment", "");
    const line = node("div", "moment-line", "");
    const main = node("div", "moment-main", "");
    const meta = node("div", "moment-meta", "");
    const time = node("time", "", timeFmt.format(date));
    time.dateTime = date.toISOString();
    meta.append(node("strong", "", "我的片刻"), time);
    main.append(meta);
    if (moment.content) main.append(node("p", "moment-text", moment.content));
    if (moment.photos?.length) {
      const grid = node("div", "photo-grid count-" + Math.min(moment.photos.length, 3), "");
      for (const photo of moment.photos) {
        const url = URL.createObjectURL(photo);
        imageUrls.push(url);
        const link = document.createElement("a");
        link.href = url;
        link.target = "_blank";
        link.rel = "noreferrer";
        const image = document.createElement("img");
        image.src = url;
        image.alt = "生活记录照片";
        image.loading = "lazy";
        link.append(image);
        grid.append(link);
      }
      main.append(grid);
    }
    main.append(node("div", "moment-bottom", "✦  这一刻已收藏"));
    line.append(node("div", "moment-avatar", "A"), main);
    article.append(line);
    timeline.append(article);
  }
}
async function refresh() {
  records = (await readAll()).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
  render();
}
function bytesToBase64(bytes) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 0x8000) value += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(value);
}
async function encodePhoto(blob) {
  return { type: blob.type, data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())) };
}
function decodePhoto(photo) {
  if (!photo || typeof photo.data !== "string" || !/^image\//.test(photo.type)) throw new Error("备份中有无效照片");
  const binary = atob(photo.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: photo.type });
}
$("content").addEventListener("input", updateButton);
$("file").addEventListener("change", event => {
  const files = [...event.target.files];
  event.target.value = "";
  if (files.some(file => !file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)) {
    showError("请选择不超过 20 MB 的照片");
    return;
  }
  selected = [...selected, ...files].slice(0, 9);
  preview();
  updateButton();
});
$("publish").addEventListener("click", async () => {
  if (busy) return;
  busy = true; updateButton(); showError("");
  try {
    const moment = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      content: $("content").value.trim(),
      photos: selected.map(file => new Blob([file], { type: file.type }))
    };
    await saveAll([moment]);
    $("content").value = ""; selected = []; preview(); shown = 20;
    await refresh();
    status("已保存到这台设备 · " + timeFmt.format(moment.createdAt));
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) { showError("保存失败：" + error.message); }
  finally { busy = false; updateButton(); }
});
$("more").addEventListener("click", () => { shown += 20; render(); });
$("export").addEventListener("click", async () => {
  showError(""); status("正在制作备份…");
  try {
    const moments = await readAll();
    const encoded = [];
    for (const moment of moments) encoded.push({
      id: moment.id, createdAt: moment.createdAt, content: moment.content,
      photos: await Promise.all(moment.photos.map(encodePhoto))
    });
    const backup = new Blob([JSON.stringify({ app: "AbitofLife", version: 1, exportedAt: new Date().toISOString(), moments: encoded })], { type: "application/json" });
    const url = URL.createObjectURL(backup);
    const link = document.createElement("a");
    link.href = url;
    link.download = "AbitofLife-backup-" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status("备份已导出 · 请把文件另存到电脑");
  } catch (error) { showError("导出失败：" + error.message); status(""); }
});
$("import").addEventListener("click", () => $("backup-file").click());
$("backup-file").addEventListener("change", async event => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  showError("");
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== "AbitofLife" || data.version !== 1 || !Array.isArray(data.moments)) throw new Error("不是有效的 AbitofLife 备份");
    const moments = data.moments.map(moment => {
      if (typeof moment.id !== "string" || !Number.isFinite(moment.createdAt) || typeof moment.content !== "string" || !Array.isArray(moment.photos)) throw new Error("备份内容格式不正确");
      return { id: moment.id, createdAt: moment.createdAt, content: moment.content, photos: moment.photos.map(decodePhoto) };
    });
    if (!confirm("将导入 " + moments.length + " 条记录；同一编号的记录会被备份内容覆盖。继续吗？")) return;
    await saveAll(moments);
    shown = 20; await refresh();
    status("已导入 " + moments.length + " 条记录");
  } catch (error) { showError("导入失败：" + error.message); }
});
$("today").textContent = "今天 · " + dateFmt.format(Date.now());
try { await refresh(); status("本地记录已读取"); }
catch (error) { showError("无法读取本地记录：" + error.message); }
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
