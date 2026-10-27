// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = 'https://oaykirgacvcirlzuzswg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7eTegj-JaAkkR7tz6miD6A_exl5n2Qi';
const REST_URL = SUPABASE_URL + '/rest/v1/';
const BUCKET = 'resume';
const PUBLIC_FILE_URL = SUPABASE_URL + '/storage/v1/object/public/' + BUCKET + '/';

// 올릴 수 있는 파일 (보관함 규칙과 같게)
const MAX_SIZE = 10 * 1024 * 1024;
const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
const FILE_TYPES = { ...IMAGE_TYPES, 'application/pdf': 'pdf' };

const PROFILE_FIELDS = [
  'name', 'title', 'career_badge', 'email', 'phone', 'location',
  'headline', 'intro', 'education', 'skills', 'experience', 'quote',
];

const $ = (id) => document.getElementById(id);

// 로그인이 끝났을 때 쓰는 표시용 오류
class AuthError extends Error {}

// ===== 로그인 정보 저장 (새로고침해도 로그인 유지) =====
const SESSION_KEY = 'resume_admin_session';
let session = loadSession();
let refreshing = null;

function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)); } catch (e) { return null; }
}
function saveSession(value) {
  session = value;
  try {
    if (value) localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { /* 저장 못 해도 이번 창에서는 동작 */ }
}

// Supabase Auth에 로그인/토큰 새로 받기
async function authToken(grantType, body) {
  const res = await fetch(SUPABASE_URL + '/auth/v1/token?grant_type=' + grantType, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new AuthError(data.error_description || data.msg || data.message || String(res.status));
  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + data.expires_in,
    email: data.user ? data.user.email : '',
  };
}

// 요청에 쓸 토큰 (끝나기 1분 전이면 새로 받는다)
async function getToken() {
  if (!session) throw new AuthError();
  if (session.expires_at - 60 < Date.now() / 1000) {
    if (!refreshing) {
      refreshing = authToken('refresh_token', { refresh_token: session.refresh_token })
        .then(saveSession)
        .catch(() => { saveSession(null); })
        .finally(() => { refreshing = null; });
    }
    await refreshing;
    if (!session) {
      showView('login');
      setStatus('login-status', '로그인이 끝났어요. 다시 로그인해 주세요.', true);
      throw new AuthError();
    }
  }
  return session.access_token;
}

// 로그인 토큰을 붙여서 요청
async function request(url, options = {}) {
  const token = await getToken();
  const res = await fetch(url, {
    ...options,
    headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + token, ...(options.headers || {}) },
  });
  if (res.status === 401) {
    saveSession(null);
    showView('login');
    setStatus('login-status', '로그인이 끝났어요. 다시 로그인해 주세요.', true);
    throw new AuthError();
  }
  return res;
}

// 표에 요청하고 결과(JSON)를 돌려준다
async function db(path, options = {}) {
  const res = await request(REST_URL + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) {
    if (res.status === 403) throw new Error('권한이 없어요. 관리자로 등록되어 있는지 확인해 주세요.');
    throw new Error('저장소 요청이 실패했어요 (' + res.status + ')');
  }
  return text ? JSON.parse(text) : null;
}

// 쓰기·고치기·지우기 (바뀐 줄을 돌려받아 정말 바뀌었는지 확인)
async function dbWrite(path, method, body) {
  const rows = await db(path, {
    method,
    headers: { Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return rows || [];
}

// ===== 파일 올리기 =====
// 문제가 없으면 null, 있으면 안내 문구
function checkFile(file, types) {
  if (!types[file.type]) {
    return types === IMAGE_TYPES
      ? '이미지 파일(PNG·JPG·WEBP·GIF)만 올릴 수 있어요.'
      : '이미지(PNG·JPG·WEBP·GIF)나 PDF 파일만 올릴 수 있어요.';
  }
  if (file.size > MAX_SIZE) return '파일이 10MB보다 커요. 더 작은 파일을 골라 주세요.';
  return null;
}

// 파일 이름을 영어·숫자로 새로 짓는다 (예: projects/1730000000000-a1b2c3d4.png)
function newFilePath(folder, file, types) {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  const random = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return folder + '/' + Date.now() + '-' + random + '.' + types[file.type];
}

async function uploadFile(folder, file, types) {
  const problem = checkFile(file, types);
  if (problem) throw new Error(problem);
  const path = newFilePath(folder, file, types);
  const res = await request(SUPABASE_URL + '/storage/v1/object/' + BUCKET + '/' + path, {
    method: 'POST',
    headers: { 'Content-Type': file.type, 'x-upsert': 'false' },
    body: file,
  });
  if (!res.ok) throw new Error('파일을 올리지 못했어요 (' + res.status + ')');
  return PUBLIC_FILE_URL + path;
}

// 더 이상 쓰지 않는 파일을 보관함에서 지운다 (실패해도 화면에는 영향 없음)
async function removeFiles(urls) {
  const paths = urls
    .filter((u) => u && u.startsWith(PUBLIC_FILE_URL))
    .map((u) => decodeURIComponent(u.slice(PUBLIC_FILE_URL.length)));
  if (paths.length === 0) return;
  try {
    await request(SUPABASE_URL + '/storage/v1/object/' + BUCKET, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefixes: paths }),
    });
  } catch (e) { /* 무시 */ }
}

// ===== 화면 도우미 =====
function showView(name) {
  $('loading-view').hidden = true;
  $('login-view').hidden = name !== 'login';
  $('denied-view').hidden = name !== 'denied';
  $('admin-view').hidden = name !== 'admin';
}

function setStatus(id, message, isError) {
  $(id).textContent = message || '';
  $(id).classList.toggle('is-error', Boolean(isError));
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

function formatDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return '';
  return date.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// 이미지 미리보기 칸 (주소가 없으면 회색 칸)
function setPreview(imgId, emptyId, url) {
  $(imgId).hidden = !url;
  $(emptyId).hidden = Boolean(url);
  if (url) $(imgId).src = url;
  else $(imgId).removeAttribute('src');
}

// 버튼을 여러 번 누르지 않도록 한 번에 하나씩만 실행
let busy = false;
async function run(statusId, task) {
  if (busy) return;
  busy = true;
  document.body.classList.add('is-busy');
  try {
    await task();
  } catch (e) {
    if (!(e instanceof AuthError)) setStatus(statusId, e.message || '문제가 생겼어요.', true);
  } finally {
    busy = false;
    document.body.classList.remove('is-busy');
  }
}

// ===== 로그인 / 로그아웃 =====
async function login() {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  if (!email || !password) return setStatus('login-status', '이메일과 비밀번호를 적어 주세요.', true);

  const btn = $('login-button');
  btn.disabled = true;
  setStatus('login-status', '로그인하는 중…');
  try {
    saveSession(await authToken('password', { email, password }));
    $('login-password').value = '';
    setStatus('login-status', '');
    await enter();
  } catch (e) {
    setStatus('login-status', '이메일이나 비밀번호가 맞지 않아요.', true);
  } finally {
    btn.disabled = false;
  }
}

async function logout() {
  if (session) {
    try {
      await fetch(SUPABASE_URL + '/auth/v1/logout', {
        method: 'POST',
        headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token },
      });
    } catch (e) { /* 무시 */ }
  }
  saveSession(null);
  showView('login');
}

// 로그인한 사람이 관리자인지 확인하고 화면을 연다
async function enter() {
  try {
    const rows = await db('admins?select=user_id');
    if (!rows || rows.length === 0) {
      $('denied-email').textContent = (session.email || '') + ' 계정은 관리자로 등록되어 있지 않아요.';
      showView('denied');
      return;
    }
  } catch (e) {
    if (e instanceof AuthError) return;
    showView('login');
    setStatus('login-status', '관리자 확인에 실패했어요. 잠시 뒤 다시 해 주세요.', true);
    return;
  }
  $('admin-email').textContent = (session.email || '') + ' 로 로그인했어요.';
  showView('admin');
  loadProfile();
  loadProjects();
  loadGuestbook();
}

// ===== 프로필 =====
let profile = null;
let pendingPhoto = null;   // 새로 고른 사진 파일
let removePhoto = false;   // "사진 빼기"를 눌렀는지

async function loadProfile() {
  try {
    const rows = await db('profile?id=eq.1&select=*');
    profile = rows[0] || null;
    PROFILE_FIELDS.forEach((f) => { $('pf-' + f).value = profile ? profile[f] || '' : ''; });
    resetPhotoPicker();
  } catch (e) {
    if (!(e instanceof AuthError)) setStatus('pf-status', '프로필을 불러오지 못했어요.', true);
  }
}

function resetPhotoPicker() {
  pendingPhoto = null;
  removePhoto = false;
  $('pf-photo-file').value = '';
  const url = profile && profile.photo_url;
  setPreview('pf-photo-preview', 'pf-photo-empty', url);
  $('pf-photo-note').textContent = url ? '지금 사진이에요. 바꾸려면 새 파일을 고르세요.' : '사진이 없어요. (이미지, 10MB까지)';
}

$('pf-photo-file').addEventListener('change', () => {
  const file = $('pf-photo-file').files[0];
  if (!file) return;
  const problem = checkFile(file, IMAGE_TYPES);
  if (problem) {
    $('pf-photo-file').value = '';
    $('pf-photo-note').textContent = problem;
    return;
  }
  pendingPhoto = file;
  removePhoto = false;
  setPreview('pf-photo-preview', 'pf-photo-empty', URL.createObjectURL(file));
  $('pf-photo-note').textContent = '"프로필 저장"을 누르면 올라가요: ' + file.name;
});

$('pf-photo-remove').addEventListener('click', () => {
  pendingPhoto = null;
  removePhoto = true;
  $('pf-photo-file').value = '';
  setPreview('pf-photo-preview', 'pf-photo-empty', null);
  $('pf-photo-note').textContent = '"프로필 저장"을 누르면 사진이 빠져요.';
});

$('pf-save').addEventListener('click', () => run('pf-status', async () => {
  setStatus('pf-status', '저장하는 중…');
  const oldPhoto = profile ? profile.photo_url : null;
  let photoUrl = oldPhoto;
  if (pendingPhoto) photoUrl = await uploadFile('profile', pendingPhoto, IMAGE_TYPES);
  else if (removePhoto) photoUrl = null;

  const body = { id: 1, photo_url: photoUrl, updated_at: new Date().toISOString() };
  PROFILE_FIELDS.forEach((f) => { body[f] = $('pf-' + f).value.trim(); });

  // 줄이 있으면 고치고, 없으면 새로 만든다
  const rows = await db('profile?on_conflict=id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(body),
  });
  if (!rows || rows.length === 0) throw new Error('저장되지 않았어요. 권한을 확인해 주세요.');
  profile = rows[0];
  if (oldPhoto && oldPhoto !== photoUrl) removeFiles([oldPhoto]);
  resetPhotoPicker();
  setStatus('pf-status', '저장했어요. 홈페이지에 바로 보여요.');
}));

// ===== 포트폴리오 카드 =====
let projects = [];
let likeCounts = {};

// 카드 하나의 좋아요 수 (Content-Range: 0-0/5 → 5)
async function countLikes(projectId) {
  const res = await request(REST_URL + 'likes?select=id&project_id=eq.' + projectId, {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const total = parseInt((res.headers.get('Content-Range') || '').split('/')[1], 10);
  return isNaN(total) ? 0 : total;
}

async function loadProjects() {
  try {
    projects = await db('projects?select=*&order=sort_order.asc,id.asc');
    const counts = await Promise.all(projects.map((p) => countLikes(p.id)));
    likeCounts = {};
    projects.forEach((p, i) => { likeCounts[p.id] = counts[i]; });
    renderProjects();
    renderLikes();
  } catch (e) {
    if (e instanceof AuthError) return;
    $('pj-list').innerHTML = '<li class="empty">카드를 불러오지 못했어요.</li>';
    $('lk-list').innerHTML = '<li class="empty">좋아요를 불러오지 못했어요.</li>';
  }
}

function projectThumb(p) {
  if (p.thumbnail_url) {
    const img = el('img', 'thumb');
    img.src = p.thumbnail_url;
    img.alt = '';
    return img;
  }
  return el('div', 'thumb');
}

function renderProjects() {
  const list = $('pj-list');
  list.textContent = '';
  if (projects.length === 0) {
    list.innerHTML = '<li class="empty">카드가 없어요. "새 카드 추가"를 눌러 만들어 보세요.</li>';
    return;
  }
  projects.forEach((p, i) => {
    const li = el('li', 'admin-item');
    const info = el('div', 'info');
    info.append(
      el('p', 'meta', [p.number, p.category].filter(Boolean).join(' · ')),
      el('p', 'title', p.title),
      el('p', 'sub', '순서 ' + p.sort_order + ' · ♥ ' + (likeCounts[p.id] || 0) + (p.file_url ? ' · 첨부 있음' : ''))
    );
    const actions = el('div', 'actions');
    const up = button('↑', 'small-button', () => moveProject(i, -1));
    up.disabled = i === 0;
    up.setAttribute('aria-label', '위로');
    const down = button('↓', 'small-button', () => moveProject(i, 1));
    down.disabled = i === projects.length - 1;
    down.setAttribute('aria-label', '아래로');
    actions.append(
      up,
      down,
      button('수정', 'small-button', () => openEditor(p)),
      button('삭제', 'danger-button small', () => deleteProject(p))
    );
    li.append(projectThumb(p), info, actions);
    list.append(li);
  });
}

// 순서 올리기·내리기: 바꾼 뒤 순서를 1, 2, 3… 으로 다시 매긴다
function moveProject(index, step) {
  run('pj-status', async () => {
    const list = [...projects];
    const target = index + step;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target], list[index]];
    const changes = list
      .map((p, i) => ({ p, order: i + 1 }))
      .filter((x) => x.p.sort_order !== x.order);
    await Promise.all(changes.map((x) =>
      dbWrite('projects?id=eq.' + x.p.id, 'PATCH', { sort_order: x.order })));
    await loadProjects();
    setStatus('pj-status', '순서를 바꿨어요.');
  });
}

function deleteProject(p) {
  if (!confirm('"' + p.title + '" 카드를 지울까요?\n이 카드의 좋아요와 올린 파일도 함께 지워져요.')) return;
  run('pj-status', async () => {
    const rows = await dbWrite('projects?id=eq.' + p.id, 'DELETE');
    if (rows.length === 0) throw new Error('지우지 못했어요. 권한을 확인해 주세요.');
    removeFiles([p.thumbnail_url, p.file_url]);
    if (editing && editing.id === p.id) closeEditor();
    await loadProjects();
    setStatus('pj-status', '카드를 지웠어요.');
  });
}

// --- 카드 추가·수정 폼 ---
let editing = null;          // 고치는 중인 카드 (새 카드면 null)
let pendingThumb = null;
let removeThumb = false;
let pendingFile = null;
let removeAttachment = false;

function openEditor(p) {
  editing = p || null;
  pendingThumb = null;
  removeThumb = false;
  pendingFile = null;
  removeAttachment = false;
  $('pj-editor-title').textContent = p ? '카드 수정' : '새 카드';
  $('pj-number').value = p ? p.number : '';
  $('pj-category').value = p ? p.category : '';
  $('pj-title').value = p ? p.title : '';
  $('pj-description').value = p ? p.description : '';
  $('pj-tags').value = p ? (p.tags || []).join(', ') : '';
  const maxOrder = projects.reduce((m, x) => Math.max(m, x.sort_order), 0);
  $('pj-sort').value = p ? p.sort_order : maxOrder + 1;
  $('pj-thumb-file').value = '';
  $('pj-file-file').value = '';
  showThumbState();
  showFileState();
  $('pj-editor').hidden = false;
  setStatus('pj-status', '');
  $('pj-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('pj-title').focus({ preventScroll: true });
}

function closeEditor() {
  editing = null;
  $('pj-editor').hidden = true;
}

function showThumbState() {
  const current = editing && !removeThumb ? editing.thumbnail_url : null;
  if (pendingThumb) {
    setPreview('pj-thumb-preview', 'pj-thumb-empty', URL.createObjectURL(pendingThumb));
    $('pj-thumb-note').textContent = '"카드 저장"을 누르면 올라가요: ' + pendingThumb.name;
  } else {
    setPreview('pj-thumb-preview', 'pj-thumb-empty', current);
    $('pj-thumb-note').textContent = current ? '지금 썸네일이에요.' : '썸네일이 없어요. (이미지, 10MB까지)';
  }
}

function showFileState() {
  const note = $('pj-file-note');
  const current = editing && !removeAttachment ? editing.file_url : null;
  note.textContent = '';
  if (pendingFile) {
    note.textContent = '"카드 저장"을 누르면 올라가요: ' + pendingFile.name;
  } else if (current) {
    note.append('지금 첨부 파일: ');
    const link = el('a', '', '열어 보기');
    link.href = current;
    link.target = '_blank';
    link.rel = 'noopener';
    note.append(link);
  } else {
    note.textContent = '첨부 파일이 없어요. (이미지 또는 PDF, 10MB까지)';
  }
}

$('pj-thumb-file').addEventListener('change', () => {
  const file = $('pj-thumb-file').files[0];
  if (!file) return;
  const problem = checkFile(file, IMAGE_TYPES);
  $('pj-thumb-file').value = '';
  if (problem) {
    $('pj-thumb-note').textContent = problem;
    return;
  }
  pendingThumb = file;
  removeThumb = false;
  showThumbState();
});

$('pj-file-file').addEventListener('change', () => {
  const file = $('pj-file-file').files[0];
  if (!file) return;
  const problem = checkFile(file, FILE_TYPES);
  $('pj-file-file').value = '';
  if (problem) {
    $('pj-file-note').textContent = problem;
    return;
  }
  pendingFile = file;
  removeAttachment = false;
  showFileState();
});

$('pj-thumb-remove').addEventListener('click', () => {
  pendingThumb = null;
  removeThumb = true;
  showThumbState();
});

$('pj-file-remove').addEventListener('click', () => {
  pendingFile = null;
  removeAttachment = true;
  showFileState();
});

$('pj-new').addEventListener('click', () => openEditor(null));
$('pj-cancel').addEventListener('click', closeEditor);

$('pj-save').addEventListener('click', () => run('pj-status', async () => {
  const title = $('pj-title').value.trim();
  if (!title) throw new Error('제목을 적어 주세요.');
  const sortOrder = parseInt($('pj-sort').value, 10);
  setStatus('pj-status', '저장하는 중…');

  const oldThumb = editing ? editing.thumbnail_url : null;
  const oldFile = editing ? editing.file_url : null;
  let thumbnailUrl = removeThumb ? null : oldThumb;
  let fileUrl = removeAttachment ? null : oldFile;
  if (pendingThumb) thumbnailUrl = await uploadFile('projects', pendingThumb, IMAGE_TYPES);
  if (pendingFile) fileUrl = await uploadFile('projects', pendingFile, FILE_TYPES);

  const body = {
    number: $('pj-number').value.trim(),
    category: $('pj-category').value.trim(),
    title,
    description: $('pj-description').value.trim(),
    tags: $('pj-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    sort_order: isNaN(sortOrder) ? 0 : sortOrder,
    thumbnail_url: thumbnailUrl,
    file_url: fileUrl,
  };

  const rows = editing
    ? await dbWrite('projects?id=eq.' + editing.id, 'PATCH', body)
    : await dbWrite('projects', 'POST', body);
  if (rows.length === 0) throw new Error('저장되지 않았어요. 권한을 확인해 주세요.');

  // 바뀐 옛 파일은 보관함에서 지운다
  removeFiles([
    oldThumb !== thumbnailUrl ? oldThumb : null,
    oldFile !== fileUrl ? oldFile : null,
  ]);

  closeEditor();
  await loadProjects();
  setStatus('pj-status', '저장했어요. 홈페이지에 바로 보여요.');
}));

// ===== 좋아요 =====
function renderLikes() {
  const list = $('lk-list');
  list.textContent = '';
  if (projects.length === 0) {
    list.innerHTML = '<li class="empty">카드가 없어요.</li>';
    return;
  }
  projects.forEach((p) => {
    const count = likeCounts[p.id] || 0;
    const li = el('li', 'admin-item');
    const info = el('div', 'info');
    info.append(
      el('p', 'meta', [p.number, p.category].filter(Boolean).join(' · ')),
      el('p', 'title', p.title)
    );
    const actions = el('div', 'actions');
    const reset = button('좋아요 초기화', 'danger-button small', () => resetLikes(p));
    reset.disabled = count === 0;
    actions.append(reset);
    li.append(info, el('span', 'likes-count', '♥ ' + count), actions);
    list.append(li);
  });
}

function resetLikes(p) {
  const count = likeCounts[p.id] || 0;
  if (!confirm('"' + p.title + '" 카드의 좋아요 ' + count + '개를 모두 지울까요?')) return;
  run('lk-status', async () => {
    await dbWrite('likes?project_id=eq.' + p.id, 'DELETE');
    await loadProjects();
    setStatus('lk-status', '"' + p.title + '" 카드의 좋아요를 초기화했어요.');
  });
}

// ===== 방명록 =====
async function loadGuestbook() {
  const list = $('gb-list');
  try {
    const rows = await db('resume_guestbook?select=id,nickname,message,created_at&order=created_at.desc&limit=500');
    list.textContent = '';
    if (rows.length === 0) {
      list.innerHTML = '<li class="empty">방명록 글이 없어요.</li>';
      return;
    }
    rows.forEach((row) => list.append(createGuestbookItem(row)));
  } catch (e) {
    if (!(e instanceof AuthError)) list.innerHTML = '<li class="empty">방명록을 불러오지 못했어요.</li>';
  }
}

function createGuestbookItem(row) {
  const li = el('li', 'admin-item');
  const info = el('div', 'info');
  const head = el('p', 'title', row.nickname);
  const date = el('span', 'sub', '  ' + formatDate(row.created_at));
  date.style.fontWeight = '400';
  head.append(date);
  info.append(head, el('p', 'message', row.message));
  const actions = el('div', 'actions');
  actions.append(button('삭제', 'danger-button small', () => deleteGuestbook(row, li)));
  li.append(info, actions);
  return li;
}

function deleteGuestbook(row, li) {
  if (!confirm(row.nickname + ' 님의 글을 지울까요?\n"' + row.message.slice(0, 40) + '"')) return;
  run('gb-status', async () => {
    const rows = await dbWrite('resume_guestbook?id=eq.' + row.id, 'DELETE');
    if (rows.length === 0) throw new Error('지우지 못했어요. 권한을 확인해 주세요.');
    li.remove();
    if (!$('gb-list').children.length) $('gb-list').innerHTML = '<li class="empty">방명록 글이 없어요.</li>';
    setStatus('gb-status', '글을 지웠어요.');
  });
}

// ===== 시작 =====
$('login-button').addEventListener('click', login);
$('login-password').addEventListener('keydown', (e) => { if (e.key === 'Enter') login(); });
document.querySelectorAll('.js-logout').forEach((b) => b.addEventListener('click', logout));

if (session) enter();
else showView('login');
