// ===== Supabase 연결 정보 (공개 키만 사용) =====
const SUPABASE_URL = 'https://oaykirgacvcirlzuzswg.supabase.co';
const SUPABASE_KEY = 'sb_publishable_7eTegj-JaAkkR7tz6miD6A_exl5n2Qi';
const REST_URL = SUPABASE_URL + '/rest/v1/';

// Supabase 표에 요청을 보내는 함수
function api(path, options = {}) {
  return fetch(REST_URL + path, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
}

// ===== 브라우저 저장소 (막혀 있어도 화면은 동작) =====
function storageGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { /* 저장 못 해도 괜찮음 */ }
}

// 이 브라우저를 구분하는 무작위 글자 (좋아요를 카드마다 한 번만 누르게 함)
function getClientId() {
  let id = storageGet('resume_client_id');
  if (!id || id.length < 8 || id.length > 64) {
    if (window.crypto && crypto.randomUUID) {
      id = crypto.randomUUID();
    } else {
      const bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    storageSet('resume_client_id', id);
  }
  return id;
}

// 이 브라우저에서 좋아요를 누른 카드 번호 목록
function loadLiked() {
  try {
    const list = JSON.parse(storageGet('resume_liked') || '[]');
    return new Set(Array.isArray(list) ? list : []);
  } catch (e) {
    return new Set();
  }
}
function saveLiked() {
  storageSet('resume_liked', JSON.stringify([...liked]));
}

const clientId = getClientId();
const liked = loadLiked();

// ===== 작은 도우미 =====
const $ = (id) => document.getElementById(id);

// http/https 주소만 사용 (이상한 주소는 무시)
function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch (e) {
    return null;
  }
}

function setText(id, value) {
  $(id).textContent = value || '';
}

// 한 줄 소개에서 이름 부분에만 파란 밑줄을 붙인다
function setHeadline(text, name) {
  const el = $('p-headline');
  el.textContent = '';
  if (!name || !text.includes(name)) {
    el.textContent = text;
    return;
  }
  text.split(name).forEach((part, i) => {
    if (i > 0) {
      const mark = document.createElement('span');
      mark.className = 'name-mark';
      mark.textContent = name;
      el.append(mark);
    }
    el.append(part);
  });
}

function formatDate(value) {
  const date = new Date(value);
  if (isNaN(date)) return '';
  return date.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

// ===== 프로필 =====
async function loadProfile() {
  try {
    const res = await api('profile?id=eq.1&select=*');
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    const p = rows[0];
    if (!p) {
      setText('p-name', '프로필이 아직 없어요');
      return;
    }

    document.title = p.name ? p.name + ' | 포트폴리오' : '포트폴리오';

    // 프로필 사진 (없으면 회색 자리 표시)
    const photo = safeUrl(p.photo_url);
    if (photo) {
      $('photo-img').src = photo;
      $('photo-img').hidden = false;
      $('photo-empty').hidden = true;
    }

    setText('p-name', p.name);
    setText('p-title', p.title);
    setText('p-badge', p.career_badge);
    $('p-badge').hidden = !p.career_badge;

    setText('c-name', p.name);
    setText('c-email', p.email);
    if (p.email) $('c-email').href = 'mailto:' + p.email;
    setText('c-phone', p.phone);
    if (p.phone) $('c-phone').href = 'tel:' + p.phone.replace(/[^0-9+]/g, '');
    setText('c-location', p.location);

    setHeadline(p.headline || '', p.name);
    setText('p-intro', p.intro);
    setText('p-education', p.education);
    setText('p-skills', p.skills);
    setText('p-experience', p.experience);
    setText('p-quote', p.quote);
    $('p-quote').hidden = !p.quote;
  } catch (e) {
    setText('p-name', '프로필을 불러오지 못했어요');
  }
}

// ===== 좋아요 수 =====
// 카드 하나의 좋아요 줄 수를 센다 (Content-Range: 0-0/5 → 5)
async function countLikes(projectId) {
  try {
    const res = await api('likes?select=id&project_id=eq.' + projectId, {
      method: 'HEAD',
      headers: { Prefer: 'count=exact', Range: '0-0' },
    });
    const range = res.headers.get('Content-Range') || '';
    const total = parseInt(range.split('/')[1], 10);
    return isNaN(total) ? 0 : total;
  } catch (e) {
    return 0;
  }
}

async function sendLike(project, button, countEl) {
  if (liked.has(project.id) || button.disabled) return;
  button.disabled = true;
  try {
    const res = await api('likes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ project_id: project.id, client_id: clientId }),
    });
    if (res.ok) {
      countEl.textContent = String(Number(countEl.textContent) + 1);
    } else if (res.status !== 409) {
      // 409는 "이미 눌렀음"이라 숫자는 그대로 두고 눌린 모양만 보여 준다
      throw new Error(res.status);
    }
    liked.add(project.id);
    saveLiked();
    markLiked(button);
  } catch (e) {
    button.disabled = false;
    alert('좋아요를 남기지 못했어요. 잠시 뒤 다시 눌러 주세요.');
  }
}

function markLiked(button) {
  button.classList.add('is-liked');
  button.disabled = true;
  button.setAttribute('aria-pressed', 'true');
}

// ===== 포트폴리오 카드 =====
const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.5 3 4.5 6.9 4.5c2.1 0 3.6 1.1 5.1 3 1.5-1.9 3-3 5.1-3 3.9 0 6 4 4.5 7.3C19.5 16.4 12 21 12 21z"/></svg>';

function createCard(project, likeCount) {
  const card = document.createElement('article');
  card.className = 'project';

  // 카드 윗부분: 누르면 첨부 파일(없으면 썸네일)을 새 탭으로 연다
  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'project-open';
  const target = safeUrl(project.file_url) || safeUrl(project.thumbnail_url);
  if (target) {
    openButton.addEventListener('click', () => window.open(target, '_blank', 'noopener'));
    openButton.setAttribute('aria-label', (project.title || '프로젝트') + ' 새 탭에서 열기');
  } else {
    openButton.disabled = true;
  }

  // 브라우저 창 모양 썸네일
  const browser = document.createElement('div');
  browser.className = 'browser';
  browser.innerHTML = '<div class="browser-bar"><i></i><i></i><i></i></div>';
  const view = document.createElement('div');
  view.className = 'browser-view';
  const thumb = safeUrl(project.thumbnail_url);
  if (thumb) {
    const img = document.createElement('img');
    img.src = thumb;
    img.alt = '';
    img.loading = 'lazy';
    view.append(img);
  } else {
    const placeholder = document.createElement('span');
    placeholder.className = 'placeholder';
    placeholder.textContent = 'NO IMAGE';
    view.append(placeholder);
  }
  browser.append(view);

  // 번호 · 분류, 제목, 설명
  const body = document.createElement('div');
  body.className = 'project-body';
  const meta = document.createElement('p');
  meta.className = 'project-meta';
  meta.textContent = [project.number, project.category].filter(Boolean).join(' · ');
  const title = document.createElement('h4');
  title.className = 'project-title';
  title.textContent = project.title;
  const desc = document.createElement('p');
  desc.className = 'project-desc';
  desc.textContent = project.description;
  body.append(meta, title, desc);

  openButton.append(browser, body);

  // 아랫부분: 태그와 좋아요
  const foot = document.createElement('div');
  foot.className = 'project-foot';
  const tags = document.createElement('div');
  tags.className = 'tags';
  (project.tags || []).forEach((t) => {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.textContent = t;
    tags.append(tag);
  });

  const likeButton = document.createElement('button');
  likeButton.type = 'button';
  likeButton.className = 'like';
  likeButton.setAttribute('aria-label', '좋아요');
  likeButton.setAttribute('aria-pressed', 'false');
  likeButton.innerHTML = HEART_SVG;
  const countEl = document.createElement('span');
  countEl.textContent = String(likeCount);
  likeButton.append(countEl);
  if (liked.has(project.id)) markLiked(likeButton);
  likeButton.addEventListener('click', () => sendLike(project, likeButton, countEl));

  foot.append(tags, likeButton);
  card.append(openButton, foot);
  return card;
}

async function loadProjects() {
  const box = $('cards');
  try {
    const res = await api('projects?select=*&order=sort_order.asc,id.asc');
    if (!res.ok) throw new Error(res.status);
    const projects = await res.json();
    const counts = await Promise.all(projects.map((p) => countLikes(p.id)));

    box.textContent = '';
    if (projects.length === 0) {
      box.innerHTML = '<p class="empty">아직 등록된 프로젝트가 없어요.</p>';
      return;
    }
    projects.forEach((p, i) => box.append(createCard(p, counts[i])));
  } catch (e) {
    box.innerHTML = '<p class="empty">프로젝트를 불러오지 못했어요.</p>';
  }
}

// ===== 방명록 =====
function createGuestbookItem(entry) {
  const li = document.createElement('li');
  li.className = 'guestbook-item';
  const head = document.createElement('div');
  head.className = 'guestbook-item-head';
  const nick = document.createElement('span');
  nick.className = 'guestbook-nick';
  nick.textContent = entry.nickname;
  const date = document.createElement('span');
  date.className = 'guestbook-date';
  date.textContent = formatDate(entry.created_at);
  head.append(nick, date);
  const msg = document.createElement('p');
  msg.className = 'guestbook-msg';
  msg.textContent = entry.message;
  li.append(head, msg);
  return li;
}

function showGuestbookEmpty() {
  $('gb-list').innerHTML = '<li class="empty">아직 남겨진 글이 없어요. 첫 글을 남겨 주세요!</li>';
}

async function loadGuestbook() {
  const list = $('gb-list');
  try {
    const res = await api('resume_guestbook?select=id,nickname,message,created_at&order=created_at.desc&limit=100');
    if (!res.ok) throw new Error(res.status);
    const rows = await res.json();
    list.textContent = '';
    if (rows.length === 0) return showGuestbookEmpty();
    rows.forEach((row) => list.append(createGuestbookItem(row)));
  } catch (e) {
    list.innerHTML = '<li class="empty">방명록을 불러오지 못했어요.</li>';
  }
}

function setStatus(message, isError) {
  $('gb-status').textContent = message;
  $('gb-status').classList.toggle('is-error', Boolean(isError));
}

async function submitGuestbook() {
  const nickname = $('gb-nickname').value.trim();
  const message = $('gb-message').value.trim();
  if (!nickname || nickname.length > 20) return setStatus('별명을 1~20자로 적어 주세요.', true);
  if (!message || message.length > 200) return setStatus('한마디를 1~200자로 적어 주세요.', true);

  const button = $('gb-submit');
  button.disabled = true;
  setStatus('남기는 중…');
  try {
    const res = await api('resume_guestbook?select=id,nickname,message,created_at', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ nickname, message }),
    });
    if (!res.ok) throw new Error(res.status);
    const [entry] = await res.json();

    // 목록 맨 위에 붙인다
    const list = $('gb-list');
    const empty = list.querySelector('.empty');
    if (empty) empty.remove();
    list.prepend(createGuestbookItem(entry));

    $('gb-message').value = '';
    setStatus('남겼어요. 고마워요!');
  } catch (e) {
    setStatus('남기지 못했어요. 잠시 뒤 다시 해 주세요.', true);
  } finally {
    button.disabled = false;
  }
}

$('gb-submit').addEventListener('click', submitGuestbook);

// ===== 시작 =====
loadProfile();
loadProjects();
loadGuestbook();
