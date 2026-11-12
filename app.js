const shell = document.getElementById('shell');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const levels = ['无记录', '< 30 分', '30–59 分', '≥ 60 分'];
// DESIGN.md 固定含义，主题不能改。
const READING_DAY_MINUTES = 5;
const BLUE_RING_MINUTES = 30;
const GOLD_RING_MINUTES = 60;
const WEEK_GOAL_MINUTES = 210;
const SHELL_VERSION = 'r26';
const SHARE_LABELS = {day:'当天',week:'本周',month:'本月',year:'今年'};
const PUBLIC_BOARD_URL = 'https://sankeyuk.github.io/Blue-FamilyReadingBoard/';
const fallback = {
  site: {name:'共读星图', short_name:'共读星图', subtitle:'BLUE 家庭共读',
    galaxy_tagline:'一小时一颗星，一起读出一片星空', footer_note:'', theme:'starmap'},
  defaults: {
    minor:{badge:'第 {hours} 小时', celebration:'由孩子挑一份礼物，拍一张全家合照。'},
    major:{badge:'我们读了 {hours} 小时', celebration:'由孩子挑一份礼物，拍一张全家合照。'},
  },
  milestones:{},
  photo:{
    zh:{before:'我们一起读了',after:'小时'},
    en:{before:"Together we've read",after:'hours'},
  },
  conversions:[
    {unit:'天', hours_each:24, text:'不吃不睡，连着读了 {n} 天', show:true},
    {unit:'个学校日', hours_each:4, text:'按每天 6 节课、每节 40 分钟算，相当于上了 {n} 天学', show:true},
    {unit:'个暑假', hours_each:60, text:'暑假每天读 1 小时，要读 {n} 个暑假', show:true},
  ],
};
const number = new Intl.NumberFormat('zh-CN', {maximumFractionDigits:2});
const n = (value) => number.format(value);
const p = (value) => `${n(value * 100)}%`;
const hours = (value) => {
  const minutes = Math.round(value * 60);
  if (minutes < 60) return `${minutes} 分`;
  return `${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}`;
};
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'})[char]);
const dateValue = (value) => new Date(`${value}T00:00:00Z`);
const dayMonth = (value) => value.slice(5).split('-').map(Number).join('/');
const firstReadingYear = (live) => (live.lifetime.first_record || live.lifetime.since).slice(0,4);
const shortDate = (value) => `${Number(value.slice(5,7))} 月 ${Number(value.slice(8))} 日`;
const minutesLabel = (value) => `${n(Math.floor(value))} 分钟`;
const weekdayLabel = (date) => `周${weekdays[(dateValue(date).getUTCDay() + 6) % 7]}`;
const offsetDate = (start, offset) => new Date(start.getTime() + offset * 86400000).toISOString().slice(0,10);
const weekReadingDays = (live) => live.week.days
  .filter(day => day.date <= live.data_through && day.minutes >= READING_DAY_MINUTES).length;
const dateHTML = (value, label = value) => `<time datetime="${esc(value)}">${esc(label)}</time>`;
function readingStart(live) {
  const date = live.lifetime.first_record;
  if (!date) return {date:null,dayLabel:'—'};
  const elapsed = Math.round((dateValue(live.data_through) - dateValue(date)) / 86400000) + 1;
  return {date,dayLabel:`第 ${n(elapsed)} 天`};
}
const heading = (title, meta = '') => `<div class="heading"><h2>${title}</h2>${meta}</div>`;
const legend = () => `<div class="legend">${levels.map((label, i) =>
  `<span><i class="level-${i}" aria-hidden="true"></i>${esc(label)}</span>`).join('')}</div>`;
const achievementURL = (value) => `#achievements${value ? `/${value}` : ''}`;

let state = {live:null, content:fallback, memories:{}, offline:false, preview:null, theme:null};
let avatarVisit = null;
let photoSet = null;
let avatarSwap = false;
let lastAvatarSwap = -Infinity;
let motionState = 'idle';
let ignorePhotoClickUntil = 0;
let motionPeak = false;
let homeScroll = 0;
let readerFamily;
let familyWarmup = false;
const warmedFaces = new Set();
const recentFamilyKey = 'coreading:last-reader-family';
let readerFaceFailed = false;
let roadPlayed = false;
let analyticsEnabled = false;
const analyticsOptOutKey = 'coreading:analytics-opt-out';
history.scrollRestoration = 'manual';
let photoObserver, backTimer, gesture;
let postcardObserver, postcardTimer;

function analyticsAllowed() {
  const address = new URL(location.href);
  const preference = address.searchParams.get('notrack');
  let optedOut = preference === '1';
  try {
    if (preference === '1') localStorage.setItem(analyticsOptOutKey,'1');
    if (preference === '0') localStorage.removeItem(analyticsOptOutKey);
    optedOut ||= localStorage.getItem(analyticsOptOutKey) === '1';
  } catch {
    // Storage can be unavailable. The explicit opt-out still applies to this open page.
  }
  if (preference === '1' || preference === '0') {
    address.searchParams.delete('notrack');
    history.replaceState(history.state,'',address);
  }
  const hashQuery = new URLSearchParams(address.hash.split('?')[1]);
  return address.hostname === 'sankeyuk.github.io' && !optedOut &&
    !address.searchParams.has('face') && address.searchParams.get('shot') !== '1' &&
    !address.searchParams.has('celebrate') && !hashQuery.has('celebrate');
}

function enableAnalytics(configuration, allowed) {
  if (!allowed || analyticsEnabled || configuration?.provider !== 'cloudflare' ||
      !/^[a-f0-9]{32}$/i.test(configuration.token)) return;
  const beacon = document.createElement('script');
  beacon.type = 'module';
  beacon.src = 'https://static.cloudflareinsights.com/beacon.min.js';
  beacon.setAttribute('data-cf-beacon',JSON.stringify({token:configuration.token,spa:false}));
  document.head.append(beacon);
  analyticsEnabled = true;
}

function chooseReaderFamily(family) {
  const sets = family?.sets ?? [];
  if (!sets.length) return null;
  const forced = new URLSearchParams(location.search).get('face');
  let previous;
  try { previous = sessionStorage.getItem(recentFamilyKey); } catch {}
  const choices = sets.length > 1 ? sets.filter((set) => set.id !== previous) : sets;
  const forcedGroup = sets.find((item) => item.faces.includes(forced + '.png'));
  const group = forcedGroup ?? choices[Math.floor(Math.random() * choices.length)];
  if (!forcedGroup) {
    try { sessionStorage.setItem(recentFamilyKey,group.id); } catch {}
  }
  const faces = group.faces.map((path,index) => ({path,name:family.people[index]}));
  const blue = faces.findIndex((face) => face.name.toLowerCase() === 'blue');
  const [reader] = faces.splice(blue < 0 ? 1 : blue,1);
  return {group:group.id,faces:[faces[0],reader,faces[1]],reader};
}
function readerPortrait() {
  const reader = readerFamily?.reader;
  return reader && !readerFaceFailed
    ? `<img class="reader-portrait" data-reader-face src="${esc(faceURL(reader.path))}" alt="">`
    : '';
}
function pageLinks(current = '') {
  return `<span class="page-links"><a href="#about"${current === 'about' ? ' aria-current="page"' : ''}>关于</a>
    <span aria-hidden="true">·</span><a href="#changelog"${current === 'changelog' ? ' aria-current="page"' : ''}>更新</a></span>`;
}
const bookArt = () => `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path class="book-line" d="M12 20c-2.2-2-5-3-9-3V8c4 0 6.8 1 9 3 2.2-2 5-3 9-3v9c-4 0-6.8 1-9 3Zm0 0v-9"/>
</svg>`;
function renderHeader(live, content) {
  const portraits = readerFamily ? readerFamily.faces.map((face) =>
    `<img class="reader-portrait" data-header-face src="${esc(faceURL(face.path))}" alt="${esc(face.name)}">`).join('') : '';
  const badge = `<div class="header-badge"><span class="header-family">${portraits}</span><span class="badge-book">${bookArt()}</span>
    ${portraits ? `<svg class="badge-arc" viewBox="0 0 104 64" aria-hidden="true">
      <circle cx="10" cy="19" r="1.5"/><circle cx="27" cy="10" r="1.7"/><circle class="arc-gold" cx="47" cy="4" r="2.5"/><circle cx="66" cy="8" r="1.8"/><circle cx="84" cy="16" r="1.5"/>
    </svg>` : ''}</div>`;
  return `<header class="mast">${badge}
    <div class="mast-brand"><p class="eyebrow">${esc(content.site.subtitle)}</p><h1>${esc(content.site.name)}</h1></div>
    <div class="mast-status"><nav aria-label="看板页面">${pageLinks()}</nav>${state.offline ? '<span class="pill" role="status">离线</span>' : ''}</div></header>`;
}
function renderArrival(live, content) {
  const milestone = live.celebrate;
  if (!milestone) return '';
  return `<a class="arrival-banner" href="${achievementURL(milestone.hours)}">
    <span>🎉 我们读了 <strong>${n(milestone.hours)} 小时</strong></span><span aria-hidden="true">↗</span></a>`;
}

function randomForStar(index) {
  let seed = index;
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
function starPoints(total, config) {
  const [width, height] = config.viewBox;
  const weights = config.weights.reduce((sum, weight) => sum + weight, 0);
  return Array.from({length: Math.floor(Math.max(0,total))}, (_, i) => {
    const index = i + 1;
    const random = randomForStar(index);
    const x = (0.035 + random() * 0.93) * width;
    const offset = ((random() + random() + random()) / 1.5 - 1) * height * config.spread;
    const y = height / 2 + (0.5 - x / width) * height * config.slope + offset;
    const gold = index % config.goldEvery === 0;
    let threshold = random() * weights;
    const color = config.colors.find((_, colorIndex) => (threshold -= config.weights[colorIndex]) < 0)
      || config.colors[0];
    const radius = gold ? config.goldRadius : config.radius[0] + random() * (config.radius[1] - config.radius[0]);
    const opacity = gold ? 1 : 0.38 + random() * 0.62;
    return {x,y,gold,color,radius,opacity};
  });
}
const systemDark = matchMedia('(prefers-color-scheme: dark)');
const landscapePhoto = matchMedia('(orientation: landscape)');
const documentTheme = document.documentElement.dataset;

function displayMode(forceLight) {
  return forceLight || !systemDark.matches ? 'light' : 'dark';
}

function photoUsesLight(current) {
  return current.photoMode || current.lang === 'en' || landscapePhoto.matches;
}

function refreshDisplayMode() {
  const celebration = shell.querySelector('.celebration');
  const mode = displayMode(documentTheme.postcard !== undefined || (celebration && photoUsesLight(route())));
  if (documentTheme.mode === mode) return;
  documentTheme.mode = mode;
  for (const sky of shell.querySelectorAll('.stars')) {
    sky.outerHTML = renderStars(Number(sky.dataset.total),sky.getAttribute('preserveAspectRatio') === 'none');
  }
  if (celebration) {
    photoObserver?.disconnect();
    watchPhotoStars();
  }
}

systemDark.addEventListener('change',refreshDisplayMode);
landscapePhoto.addEventListener('change',refreshDisplayMode);

// Resolve export colors without changing the visible page or its color scheme.
const exportPalette = document.createElement('div');
exportPalette.hidden = true;
exportPalette.dataset.mode = 'light';

function lightThemeTokenReader() {
  exportPalette.dataset.theme = documentTheme.theme;
  if (!exportPalette.isConnected) document.body.append(exportPalette);
  const style = getComputedStyle(exportPalette);
  return (key) => style.getPropertyValue('--ds-' + key).trim();
}

function renderStars(total, photo = false) {
  const config = state.theme?.stars?.[documentTheme.mode];
  if (!config) return '';
  const [width,height] = config.viewBox;
  const circles = starPoints(total,config).map(({x,y,gold,color,radius,opacity}) =>
    `<circle class="${gold ? 'gold-star' : 'star'}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" ${gold ? '' : `fill="${esc(color)}"`} opacity="${(photo ? opacity * .6 : opacity).toFixed(2)}"/>`).join('');
  return `<svg class="stars" data-total="${total}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="${photo ? 'none' : 'xMidYMid slice'}" aria-hidden="true">${circles}</svg>`;
}
function renderGalaxy(live, content) {
  const {lifetime, streak} = live;
  const {date:first, dayLabel} = readingStart(live);
  const longest = streak.longest;
  const streakChip = streak.current >= 1
    ? `<span>连续共读</span><strong>${n(streak.current)} 天</strong>`
    : longest?.days
      ? `<span>最长连续 <strong>${n(longest.days)} 天</strong></span><span>${dateHTML(longest.from, dayMonth(longest.from))}–${dateHTML(longest.to, dayMonth(longest.to))}</span>`
      : '<span>暂无连续共读记录</span>';
  return `<section class="hero galaxy">
    ${renderStars(lifetime.total_hours)}
    <div class="hero-content"><div class="galaxy-heading"><h2>${n(lifetime.record_days)} 个共读日</h2>
      <p>${esc(content.site.galaxy_tagline)}</p></div>
      <div class="galaxy-number"><strong>${n(lifetime.total_hours)}</strong> <span>时</span></div>
      <div class="hero-chips">
        <div><span aria-hidden="true">◈</span><span>开始共读 ${first ? dateHTML(first) : '待记录'}</span><strong>${dayLabel}</strong></div>
        <div><span aria-hidden="true">✦</span>${streakChip}</div>
      </div>
    </div></section>`;
}
const shanghaiDate = new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'});
const shanghaiTime = new Intl.DateTimeFormat('zh-CN',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
let syncStatus = '';
let syncInFlight = false;
let nextSyncAt = 0;
let lastReadAt = 0;
let syncLabelTimer;
let selectedWeekDate = null;
let heatmapYear = null;
let heatmapDate = null;
let heatmapBubble = false;
const homeScrollPositions = new Map();
let ringObserver;
const animatedRingSections = new Set();

const ringGradient = `<svg class="ring-definitions" width="0" height="0" aria-hidden="true" focusable="false"><defs>
  <linearGradient id="reading-ring-blue" x1="0" x2="1" y1="0" y2="1" gradientUnits="objectBoundingBox">
    <stop class="ring-accent"/><stop class="ring-accent-end" offset="1"/>
  </linearGradient></defs></svg>`;

function readingRing(fraction, center, gold = false) {
  const fill = Math.min(1, fraction) * 100;
  return `<span class="reading-ring${gold ? ' ring-gold' : ''}">
    <svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <circle class="ring-track" cx="50" cy="50" r="44"/>
      ${fill > 0 ? `<circle class="ring-progress" cx="50" cy="50" r="44" pathLength="100"
        transform="rotate(-90 50 50)" stroke-dasharray="${fill} 100"/>` : ''}
    </svg><span class="ring-center">${center}</span></span>`;
}
function dayRing(minutes, today = false) {
  const mark = minutes >= READING_DAY_MINUTES ? '✓' : today && !minutes ? '今' : '';
  return readingRing(minutes / BLUE_RING_MINUTES, mark, minutes >= GOLD_RING_MINUTES);
}
function animateReadingRings() {
  if (!('IntersectionObserver' in window)) return;
  ringObserver = new IntersectionObserver((entries) => {
    for (const {target, isIntersecting} of entries) {
      if (!isIntersecting || animatedRingSections.has(target.dataset.rings)) continue;
      animatedRingSections.add(target.dataset.rings);
      target.classList.add('draw-reading-rings');
      ringObserver.unobserve(target);
    }
  });
  for (const section of shell.querySelectorAll('[data-rings]')) {
    if (!animatedRingSections.has(section.dataset.rings)) ringObserver.observe(section);
  }
}

function updatedLabel(fetched) {
  const date = new Date(fetched);
  if (!fetched || !Number.isFinite(date.getTime())) return '待同步';
  const today = shanghaiDate.format(new Date());
  const yesterday = shanghaiDate.format(new Date(dateValue(today).getTime() - 86400000));
  const local = shanghaiDate.format(date);
  const label = local === today ? '今天' : local === yesterday ? '昨天' : shortDate(local);
  return `${label} ${shanghaiTime.format(date)}`;
}
function syncCaption(live) {
  if (syncStatus === 'pending') return '同步中…';
  if (syncStatus === 'offline') return '离线，显示的是上次的数据';
  if (syncStatus === 'unchanged') return `已是最新 · 数据更新于 ${updatedLabel(live.fetched_at)}`;
  return `数据更新于 ${updatedLabel(live.fetched_at)}`;
}
function paintSyncControls() {
  const button = shell.querySelector('.sync-button');
  if (!button || !state.live) return;
  button.disabled = syncInFlight || Date.now() < nextSyncAt;
  button.dataset.pending = String(syncInFlight);
  shell.querySelector('.sync-caption').textContent = syncCaption(state.live);
  shell.querySelector('.sync-result').textContent = syncStatus === 'updated' ? '已更新' : '';
  shell.querySelector('.sync-tip').hidden = syncStatus !== 'unchanged';
}
async function syncToday() {
  if (syncInFlight || Date.now() < nextSyncAt) return;
  lastReadAt = Date.now();
  nextSyncAt = lastReadAt + 5000;
  setTimeout(paintSyncControls,5000);
  clearTimeout(syncLabelTimer);
  syncInFlight = true;
  syncStatus = 'pending';
  requestId++;
  paintSyncControls();
  try {
    const previous = state.live?.fetched_at;
    const [response, memories] = await Promise.all([loadLive(Date.now()), loadMemories()]);
    if (response.cached || !navigator.onLine) throw new Error('Offline');
    state.live = response.data;
    state.memories = memories;
    state.offline = false;
    syncStatus = response.data.fetched_at !== previous ? 'updated' : 'unchanged';
  } catch {
    state.offline = true;
    syncStatus = 'offline';
  } finally {
    syncInFlight = false;
    render();
    if (syncStatus === 'updated') syncLabelTimer = setTimeout(() => {
      syncStatus = '';
      paintSyncControls();
    },2000);
  }
}

function shareEntry(type) {
  return `<a class="share-entry" href="#share/${type}" aria-label="分享${SHARE_LABELS[type]}">
    <svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.65"
      stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M12 15V3m-4 4 4-4 4 4M7 10H5v10h14V10h-2"/>
    </svg></a>`;
}
function shareHeading(title, type, meta = '') {
  return `<div class="heading has-share"><h2>${title}</h2><div class="heading-actions">${meta}${shareEntry(type)}</div></div>`;
}

function renderToday(live) {
  const {today, yesterday} = live;
  const stale = live.fetched_at && today.date > live.fetched_at.slice(0,10);
  const note = today.read ? '今天已共读' : today.is_partial
    ? (stale ? '暂未同步到今日记录 · 今日未结束' : '今天还没记录 · 今日未结束') : '这一天没有共读记录';
  const column = (day, label, current) => `<div class="today-column${current ? ' is-today' : ''}">
    <span aria-hidden="true">${dayRing(day.minutes,current)}</span>
    <div><b>${label}</b><p><strong>${n(Math.floor(day.minutes))}</strong> 分钟</p></div></div>`;
  return `<section class="panel today" data-rings="today">
    ${shareHeading('今天','day',`<div class="today-actions">${dateHTML(today.date, shortDate(today.date))}
      <span class="sync-result" role="status"></span><button class="sync-button" type="button"><span aria-hidden="true">↻</span> 同步</button></div>`)}
    <div class="today-columns${yesterday ? ' has-yesterday' : ''}">${yesterday ? column(yesterday,'昨天',false) : ''}
      ${column(today,'今天',true)}</div>
    <p class="today-note">${note}</p>
    <p class="sync-caption" role="status"></p>
    <p class="sync-tip" hidden>晚上每 5 分钟取一次数，读完记得在 aTimeLogger 停表</p></section>`;
}
function renderNext(data, content) {
  const {next, lifetime} = data;
  const target = next.next_milestone_hours;
  const progress = Math.max(0, Math.min(100, lifetime.total_hours / target * 100));
  const major = next.next_major_hours === target ? target + 100 : next.next_major_hours;
  const toMajor = major === next.next_major_hours ? next.hours_to_major : major - lifetime.total_hours;
  const remaining = next.hours_to_milestone;
  const reached = data.milestones_reached.some((entry) => entry.hours === target);
  const goalURL = achievementURL(target) + (reached ? '' : `?celebrate=${target}`);
  const beans = remaining > 15 ? 12 : Math.max(0,Math.ceil(remaining));
  const position = `clamp(20px, calc(20px + (100% - 40px) * ${progress / 100}), calc(100% - ${59 + beans * 7}px))`;
  return `<section class="panel next">
    ${heading('下一站', `<span>${n(target)} 小时里程碑</span>`)}
    <p class="next-main"><small>还差</small> ${hours(remaining)}</p>
    <div class="bean-road">
      <span class="road-trail" style="width:${position}" role="progressbar" aria-label="下一站累计进度" aria-valuemin="0" aria-valuemax="${target}" aria-valuenow="${Math.min(lifetime.total_hours,target)}" aria-valuetext="${n(lifetime.total_hours)} / ${n(target)} 小时"></span>
      <span class="road-beans" style="left:${position}" aria-hidden="true">${'<i></i>'.repeat(beans)}</span>
      <span class="road-face" style="left:${position}" aria-hidden="true">${readerPortrait() || '<span>✦</span>'}</span>
      <a class="road-target" href="${goalURL}" aria-label="${reached ? '打开' : '预演'} ${n(target)} 小时庆祝页"><span class="road-goal ${target % 100 === 0 ? 'major' : 'minor'}">${n(target)}</span></a>
    </div>
    <p class="track-labels"><span>已读 ${n(lifetime.total_hours)} 小时</span><span>${n(target)} 小时</span></p>
    <p class="next-meta"><span>预计到站 <strong>${next.next_milestone_eta ? dateHTML(next.next_milestone_eta, shortDate(next.next_milestone_eta)) : '待定'}</strong></span>
      <span>距 ${n(major)} 小时还有 ${n(toMajor)} 小时</span></p>
  </section>`;
}

function playBeanRoad() {
  const road = shell.querySelector('.bean-road');
  if (!road || roadPlayed) return;
  roadPlayed = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const rider = road.querySelector('.road-face');
  const trail = road.querySelector('.road-trail');
  const distance = rider.offsetLeft - 20;
  if (distance < 4) return;
  const duration = 1060;
  const count = Math.min(7,Math.floor(distance / 18));
  const steps = [{offset:0,transform:`translateX(${-distance}px)`}];
  for (let i = 1; i <= count; i++) {
    const fraction = i/(count+1);
    const x = -distance*(1-fraction);
    const bean = document.createElement('i');
    bean.className = 'road-passed';
    bean.style.left = `${20+distance*fraction}px`;
    bean.setAttribute('aria-hidden','true');
    road.append(bean);
    bean.animate([{transform:'scale(1)',opacity:1},{transform:'scale(0)',opacity:0}],
      {duration:100,delay:duration*fraction,fill:'forwards'});
    steps.push({offset:fraction,transform:`translateX(${x}px) scale(1.1)`},
      {offset:fraction+.045,transform:`translateX(${x+distance*.045}px)`});
  }
  steps.push({offset:1,transform:'translateX(0)'});
  trail.animate([{transform:`scaleX(${20/rider.offsetLeft})`},{transform:'scaleX(1)'}],duration);
  rider.animate(steps,duration);
  setTimeout(() => road.querySelectorAll('.road-passed').forEach((bean) => bean.remove()),duration);
}

function comparisonText(current, prior, label, monthly = false) {
  if (!prior?.days_elapsed) return `${label}暂无数据`;
  const diff = Math.round((current.total_minutes - prior.total_minutes) * 100) / 100;
  const change = Math.floor(Math.abs(diff)) ? `${diff > 0 ? '+' : '−'}${minutesLabel(Math.abs(diff))}` : '时长持平';
  const reference = monthly ? `${prior.record_days} 天 · 覆盖率 ${p(prior.coverage)}` :
    `${prior.record_days} 天 · ${minutesLabel(prior.total_minutes)}`;
  return `${label} ${reference} · ${change}`;
}
function comparison(...args) {
  return `<p class="compare">${comparisonText(...args)}</p>`;
}

function renderWeek(live) {
  const {week, data_through: through} = live;
  const [first,last] = week.range;
  const start = dateValue(first);
  const minutesByDay = new Map(week.days.map((day) => [day.date,day.minutes]));
  const readDays = weekReadingDays(live);
  const total = Math.floor(week.total_minutes);
  const duration = total < GOLD_RING_MINUTES ? `${n(total)} 分` :
    `${n(Math.floor(total / GOLD_RING_MINUTES))} 时 ${total % GOLD_RING_MINUTES} 分`;
  const rings = weekdays.map((day,index) => {
    const date = offsetDate(start,index);
    const future = date > through;
    const minutes = future ? 0 : minutesByDay.get(date) ?? 0;
    const today = date === through;
    const label = `周${day} ${shortDate(date)} · ${future ? '未到统计日' : minutesLabel(minutes)}`;
    return `<button type="button" class="week-day${today ? ' is-today' : ''}" data-week-date="${date}"
      aria-label="${label}" aria-pressed="${!future && date === selectedWeekDate}"${future ? ' disabled' : ''}>
      ${dayRing(minutes,today)}<span>${day}</span></button>`;
  }).join('');
  return `<section class="panel week" data-rings="week">
    ${shareHeading('本周进度','week',`<span>${dayMonth(first)} – ${dayMonth(last)}</span>`)}
    <div class="week-progress">
      <div>${readingRing(week.total_minutes / WEEK_GOAL_MINUTES,`<b>${duration}</b><small>本周时长</small>`)}
        <p>目标 ${WEEK_GOAL_MINUTES} 分钟（3.5 小时）</p></div>
      <div>${readingRing(readDays / weekdays.length,`<b>${readDays}/${weekdays.length} 天</b><small>阅读日</small>`)}
        <p>一天读满 ${READING_DAY_MINUTES} 分钟算一天</p></div>
    </div>
    ${first === through && !week.total_minutes ? '<p class="week-start">这周从今天开始</p>' : ''}
    <div class="week-rhythm">
      <div class="heading"><h3>本周节奏</h3><span>勾 ${READING_DAY_MINUTES} 分钟 · 蓝环 ${BLUE_RING_MINUTES} 分钟 · 金环 1 小时</span></div>
      <div class="week-days">${rings}</div>
      <p class="reading-detail week-detail" role="status" hidden></p>
    </div>
    ${comparison(week,week.prev_same_period,'上周同期')}
  </section>`;
}

function paintReadingDetail(section, button) {
  const detail = section.querySelector('.reading-detail');
  detail.textContent = button?.getAttribute('aria-label') ?? '';
  detail.hidden = !button;
}
function selectReadingDay(section, button) {
  section.querySelector('[aria-pressed="true"]')?.setAttribute('aria-pressed','false');
  button?.setAttribute('aria-pressed','true');
  paintReadingDetail(section,button);
}
function renderYears(live, content) {
  const latestByYear = new Map();
  for (const month of live.cumulative_by_month) latestByYear.set(month.month.slice(0,4), month.cum_hours);
  let previous = 0;
  const years = Array.from(latestByYear, ([year, cumulative]) => {
    const total = Math.round((cumulative - previous) * 100) / 100;
    previous = cumulative;
    return {year,total};
  }).filter(({year}) => year >= firstReadingYear(live));
  const max = Math.max(1, ...years.map((year) => year.total));
  const current = live.data_through.slice(0,4);
  return `<section class="panel annual">${shareHeading('每年共读','year','<span>小时</span>')}
    <div class="annual-chart">${years.map(({year,total}) => `<div class="year-col ${year === current ? 'current-year' : ''}">
      <div class="year-track"><div class="year-fill ${total === 0 ? 'zero-year' : ''}" style="height:${total / max * 100}%"><b>${n(Math.floor(total))}</b></div></div>
      <span>${esc(year)}</span></div>`).join('')}</div></section>`;
}
function conversionNumber(value) {
  const whole = Math.floor(value);
  const fraction = value - whole;
  if (value < 10) {
    // Only quarter values are exact binary ties when rounding to a tenth.
    if (fraction === 0.25) return `${whole}.2`;
    if (fraction === 0.75) return `${whole}.8`;
    return value.toFixed(1);
  }
  return n(fraction === 0.5 ? whole + whole % 2 : Math.round(value));
}
function renderConversions(live, content) {
  const total = live.lifetime.total_hours;
  const visible = content.conversions.filter((row) => row.show).slice(0,3);
  if (!visible.length) return '';
  return `<section class="panel conversions">${heading(`${n(total)} 小时，是什么概念`)}
    ${visible.map((row) => {
      const value = conversionNumber(total / row.hours_each);
      return `<div class="conversion"><span><strong>${value}</strong> ${esc(row.unit)}</span>
        <b aria-hidden="true">=</b><p>${esc(row.text.replaceAll('{n}', value))}</p></div>`;
    }).join('')}</section>`;
}

function resolve(content, value, dayBased = false) {
  const defaults = dayBased ? content.day_defaults : content.defaults;
  const overrides = dayBased ? content.day_milestones : content.milestones;
  const base = defaults?.[value % (dayBased ? 500 : 100) === 0 ? 'major' : 'minor'];
  const own = overrides?.[value];
  return Object.fromEntries(['badge','celebration','message'].map((key) =>
    [key, (own?.[key] || base?.[key] || '').replaceAll(dayBased ? '{days}' : '{hours}', String(value))]));
}
function achievementEntries(live, dayBased = false) {
  const reached = dayBased ? live.day_milestones_reached ?? [] : live.milestones_reached;
  const entries = new Map(reached.map((milestone) => {
    const value = dayBased ? milestone.days : milestone.hours;
    const id = dayBased ? `d${value}` : String(value);
    return [id,{id,value,dayBased,date:milestone.date}];
  }));
  if (state.preview && state.preview.startsWith('d') === dayBased) {
    const id = state.preview;
    const value = Number(dayBased ? id.slice(1) : id);
    entries.set(id,{...entries.get(id),id,value,dayBased,preview:true,
      eta:dayBased ? null : live.roadmap.find((station) => station.hours === value)?.eta});
  }
  const next = dayBased ? live.next_day : live.roadmap.find((station) =>
    !station.reached && !entries.has(String(station.hours)));
  if (next && !entries.has(dayBased ? `d${next.days}` : String(next.hours))) {
    const value = dayBased ? next.days : next.hours;
    const id = dayBased ? `d${value}` : String(value);
    entries.set(id,{id,value,dayBased,locked:true,eta:next.eta,
      left:dayBased ? next.remaining :
        next.hours === live.next.next_milestone_hours ? live.next.hours_to_milestone :
        Math.round((next.hours - live.lifetime.total_hours) * 100) / 100});
  }
  return [...entries.values()].sort((a,b) => a.value - b.value);
}
function medal(entry, unit = entry.dayBased ? '天' : '小时') {
  const type = entry.locked ? 'locked' : entry.value % (entry.dayBased ? 500 : 100) === 0 ? 'major' : 'minor';
  return `<span class="medal ${type}" aria-hidden="true"><span class="medal-star">✦</span><strong>${n(entry.value)}</strong><small>${esc(unit)}</small></span>`;
}
const memoryKey = (entry) => `${entry.value}${entry.dayBased ? 'd' : 'h'}`;
const memoryPhoto = (entry) => entry?.date ? state.memories[memoryKey(entry)]?.photo : null;

function memoryImage(source, className, {compact = false, lazy = false} = {}) {
  return `<div class="memory-image ${className}" data-memory-source="${esc(source)}" data-memory-state="loading">
    <img alt="${compact ? '' : '共读纪念照'}"${lazy ? ' loading="lazy"' : ''}>
    <span class="memory-image-status" role="status" aria-label="照片加载中…">${compact ? '…' : '照片加载中…'}</span>
    <button class="memory-image-retry" type="button" aria-label="照片没加载出来，轻点重试"
      title="照片没加载出来，轻点重试" hidden>${compact ? '!' : '照片没加载出来，轻点重试'}</button>
  </div>`;
}

function mountMemoryImage(frame, onReady) {
  const image = frame.querySelector('img');
  const status = frame.querySelector('.memory-image-status');
  const retry = frame.querySelector('button');
  const compact = frame.classList.contains('memory-thumbnail');
  let attempts = 0;
  image.addEventListener('load',() => {
    frame.dataset.memoryState = 'ready';
    onReady?.();
  });
  image.addEventListener('error',() => {
    frame.dataset.memoryState = 'error';
    retry.hidden = attempts >= 3;
    status.textContent = compact ? '!' : '照片没加载出来';
    status.setAttribute('aria-label','照片没加载出来');
  });
  retry.addEventListener('click',() => {
    if (attempts >= 3 || frame.dataset.memoryState !== 'error') return;
    const address = new URL(frame.dataset.memorySource,location.href);
    address.searchParams.set('retry',`${Date.now()}-${++attempts}`);
    frame.dataset.memoryState = 'loading';
    status.textContent = compact ? '…' : '照片加载中…';
    status.setAttribute('aria-label','照片加载中…');
    retry.hidden = true;
    image.src = address.href;
  });
  image.src = frame.dataset.memorySource;
}

function renderMedals(entries, content, strip = false) {
  return `<div class="${strip ? 'achievement-strip' : 'medals'}"${strip ? ` data-scroll-key="medals-${entries[0].dayBased ? 'days' : 'hours'}"` : ''}>${entries.map((entry) => {
    const copy = resolve(content,entry.value,entry.dayBased);
    const longDate = entry.date?.replace(/^(\d+)-(\d+)-(\d+)$/,(_,year,month,day) => `${year} 年 ${Number(month)} 月 ${Number(day)} 日`);
    const status = entry.date ? dateHTML(entry.date,longDate) : entry.preview ? '<span class="preview-label">预演</span>' :
      `下一站 · 还差 ${entry.dayBased ? `${entry.left} 个共读日` : hours(entry.left)}${entry.eta ? `<br>预计 ${dateHTML(entry.eta,dayMonth(entry.eta))}` : ''}`;
    const photo = memoryPhoto(entry);
    const link = `<a class="achievement ${entry.locked ? 'is-locked' : 'is-reached'}" data-achievement="${entry.id}" href="${achievementURL(entry.id)}">
      ${medal(entry)}<b>${esc(copy.badge || `第 ${entry.value} ${entry.dayBased ? '天' : '小时'}`)}</b><span>${status}</span>
      <span class="memory-slot" aria-hidden="true"></span></a>`;
    return photo ? `<div class="achievement-with-memory">${link}${memoryImage(photo,'memory-thumbnail',{compact:true,lazy:true})}</div>` : link;
  }).join('')}</div>`;
}
function renderAchievementBlock(live, content) {
  const row = (dayBased) => {
    const entries = achievementEntries(live,dayBased).filter((entry) => entry.date);
    const next = dayBased ? live.next_day : {days:live.next.next_milestone_hours,remaining:live.next.hours_to_milestone};
    const summary = dayBased ? `下一枚：${next.days} 天 · 还差 ${next.remaining} 个共读日` :
      `下一枚：${next.days} 小时 · 还差 ${n(next.remaining)} 小时`;
    return `<section class="achievement-group" data-kind="${dayBased ? 'days' : 'hours'}">
      <div class="heading"><h3>${dayBased ? '天数' : '时长'}</h3><p>${summary}</p></div>
      ${entries.length ? renderMedals(entries,content,true) : ''}</section>`;
  };
  return `<section class="panel achievement-block">${heading('成就','<a class="text-link" href="#achievements">全部成就 ↗</a>')}
    ${row(false)}${live.next_day && live.day_milestones_reached ? row(true) : ''}</section>`;
}
function renderHeatmap(live) {
  const {month, data_through: through} = live;
  const summary = `<p class="heat-month-summary">本月 ${month.record_days} 天 · 覆盖率 ${p(month.coverage)}</p>
    ${comparison(month,month.prev_same_period,'上月同期',true)}`;
  if (!live.minutes_by_year || !live.years) {
    return `<section class="panel heatmap">${shareHeading('共读热力图','month')}
      <p class="heat-updating">数据更新中</p>${summary}</section>`;
  }
  const availableYears = Object.keys(live.minutes_by_year).sort();
  if (!availableYears.includes(heatmapYear)) {
    heatmapYear = through.slice(0,4);
    heatmapDate = null;
  }
  const year = Number(heatmapYear);
  const minutes = live.minutes_by_year[heatmapYear];
  const start = dateValue(`${year}-01-01`);
  const offset = (start.getUTCDay() + 6) % 7;
  const currentYear = heatmapYear === through.slice(0,4);
  let selection = heatmapDate;
  if (!selection || !selection.startsWith(heatmapYear)) {
    const lastRead = minutes.map((value) => value !== null && value > 0).lastIndexOf(true);
    selection = currentYear ? through : lastRead >= 0 ? offsetDate(start,lastRead) : null;
  }
  const lastDate = currentYear ? dateValue(through) : dateValue(`${year}-12-31`);
  const lastIndex = Math.round((lastDate - start) / 86400000);
  const columns = Math.floor((offset + lastIndex) / 7) + 1;
  const since = dateValue(live.lifetime.since);
  const levelOffset = Math.max(0, Math.round((since - start) / 86400000));
  const rows = Array.from({length:columns},(_,column) => {
    let monthLabel = '';
    const cells = Array.from({length:7},(_,weekday) => {
      const index = column * 7 + weekday - offset;
      if (index < 0 || index >= minutes.length) return '<span class="heat-empty" aria-hidden="true"></span>';
      const date = offsetDate(start,index);
      if (date.endsWith('-01')) monthLabel = `${Number(date.slice(5,7))} 月`;
      const future = date > through;
      const value = minutes[index];
      if (!future && value === null) return '<span class="heat-empty" aria-hidden="true"></span>';
      const level = live.levels_by_year[heatmapYear]?.[index - levelOffset] ?? '0';
      const label = `${shortDate(date)} · ${weekdayLabel(date)} · ${future ? '未到统计日' : minutesLabel(value)}`;
      return `<button type="button" class="heat-day ${future ? 'future' : `level-${level}`}${date === through ? 'is-today' : ''}"
        data-heat-date="${date}" aria-label="${label}" aria-pressed="${date === selection}"${future ? ' disabled' : ''}></button>`;
    }).join('');
    return `<div class="heat-week">${monthLabel ? `<span class="heat-month-label">${monthLabel}</span>` : ''}${cells}</div>`;
  }).join('');
  const stats = live.years[heatmapYear];
  return `<section class="panel heatmap">
    ${shareHeading(`${year} 年 · 共读热力图`,'month',`<div class="heat-year-tabs" role="group" aria-label="热力图年份">${availableYears.map((y) =>
      `<button type="button" data-heat-year="${y}" aria-pressed="${y === heatmapYear}">${y}</button>`).join('')}</div>`)}
    <p class="heat-statistics">共读 ${stats.record_days} 天 · 读满 30 分钟 ${stats.days_30} 天</p>
    <p class="reading-detail heat-detail" role="status"></p>
    <div class="heat-frame">
      <div class="heat-weekdays" aria-hidden="true">${weekdays.map((day,index) => `<span>${index % 2 ? '' : day}</span>`).join('')}</div>
      <div class="heat-scroll" data-scroll-key="heat-${year}" tabindex="0" aria-label="${year} 年共读热力图，左右滑动查看">${rows}</div>
      <span class="heat-tooltip" aria-hidden="true" hidden></span>
    </div>${summary}${legend()}</section>`;
}
function positionHeatTooltip() {
  const frame = shell.querySelector('.heat-frame');
  if (!frame) return;
  const selected = frame.querySelector('[aria-pressed="true"]');
  const bubble = frame.querySelector('.heat-tooltip');
  const viewport = frame.querySelector('.heat-scroll').getBoundingClientRect();
  const rect = selected?.getBoundingClientRect();
  bubble.hidden = !heatmapBubble || !rect || rect.right < viewport.left || rect.left > viewport.right;
  if (bubble.hidden) return;
  bubble.textContent = selected.getAttribute('aria-label');
  const bounds = frame.getBoundingClientRect();
  bubble.style.left = `${Math.max(0,Math.min(bounds.width - bubble.offsetWidth,rect.left - bounds.left + rect.width / 2 - bubble.offsetWidth / 2))}px`;
  bubble.style.top = `${rect.top - bounds.top - bubble.offsetHeight - 5}px`;
}
function restoreHomeScroll() {
  for (const strip of shell.querySelectorAll('[data-scroll-key]')) {
    const saved = homeScrollPositions.get(strip.dataset.scrollKey);
    if (saved) {
      strip.scrollLeft = saved.end ? strip.scrollWidth : saved.left;
    } else {
      const selected = strip.querySelector('[aria-pressed="true"]');
      strip.scrollLeft = selected ? selected.getBoundingClientRect().right - strip.getBoundingClientRect().left +
        strip.scrollLeft - strip.clientWidth : strip.scrollWidth;
    }
  }
  const heatmap = shell.querySelector('.heatmap');
  if (heatmap?.querySelector('.heat-detail')) {
    paintReadingDetail(heatmap,heatmap.querySelector('[aria-pressed="true"][data-heat-date]'));
    heatmap.querySelector('.heat-scroll').addEventListener('scroll',positionHeatTooltip,{passive:true});
    positionHeatTooltip();
  }
}
function renderModules(live, content) {
  const names = {gifts:'礼物', booklist:'书单', allowance:'零花钱'};
  return `<section class="panel">${heading('即将上线')}
    <div class="modules">${Object.entries(names).filter(([key]) => live.modules[key])
      .map(([,name]) => `<div class="module"><b>${name}</b><span>即将上线</span></div>`).join('')}</div></section>`;
}
function renderFooter(live, content) {
  const fetched = live?.fetched_at;
  const stamp = fetched ? updatedLabel(fetched) : '';
  const version = content.diary?.[0]?.version;
  return `<footer class="footer">${content.site.footer_note ? `<p>${esc(content.site.footer_note)}</p>` : ''}
    数据更新于 ${stamp ? dateHTML(fetched,stamp) : '待同步'}
    ${live || version ? `<span>${live ? `统计截至 ${dateHTML(live.data_through)}` : ''}${live && version ? ' · ' : ''}${version ? `<a class="version-link" href="#changelog">${esc(version)}</a>` : ''}</span>` : ''}
    ${analyticsEnabled ? '<span>本站使用无 Cookie 的匿名访问统计</span>' : ''}</footer>`;
}

const backBar = (extra = '') => `<nav class="backbar" aria-label="返回"><a href="#" data-home>‹ 返回首页</a>${extra}
  ${state.offline ? '<span class="pill" role="status">离线</span>' : ''}</nav>`;
function renderAboutCard(kind, live) {
  if (!live || !kind) return '';
  const {date:first, dayLabel} = readingStart(live);
  const cards = {
    record_days:{label:'共读日',value:`${n(live.lifetime.record_days)} 天`},
    total_hours:{label:'累计小时',value:`${n(Math.floor(live.lifetime.total_hours))} 小时`},
    longest_streak:{label:'最长连续',value:`${n(live.streak.longest?.days ?? 0)} 天`},
    week_reading_days:{label:'本周阅读日',value:`${weekReadingDays(live)}/7 天`},
    since:{label:'开始共读',value:first ?? '待记录',detail:dayLabel},
  };
  const card = cards[kind];
  return card ? `<div class="about-data" data-card="${esc(kind)}"><span>${card.label}</span>
    <strong>${esc(card.value)}</strong>${card.detail ? `<span>${esc(card.detail)}</span>` : ''}</div>` : '';
}
function renderAbout(live, content) {
  const about = content.about;
  const back = backBar(pageLinks('about'));
  if (!about) return `${back}<main><section class="panel placeholder-page"><h1>关于 · 即将上线</h1></section></main>`;
  const paragraphs = (values) => values.map(text => `<p>${esc(text)}</p>`).join('');
  const links = (about.links ?? []).filter(link => link.url.startsWith('https://'));
  return `${back}<main class="about-page">
    <section class="hero page-hero">${renderStars(live?.lifetime.total_hours ?? 0)}
      <div class="hero-content"><p class="page-tagline">${esc(about.tagline)}</p>
        <h1>${esc(about.title)}</h1><div class="page-intro">${paragraphs(about.paragraphs)}</div></div></section>
    ${(about.sections ?? []).map((section,index) => `<section class="panel about-section">
      <p class="section-number">${String(index + 1).padStart(2,'0')} · ${esc(section.en)}</p>
      <h2>${esc(section.title)}</h2><div class="about-prose">${paragraphs(section.paragraphs)}</div>
      ${renderAboutCard(section.card,live)}</section>`).join('')}
    ${links.length ? `<section class="panel about-links" aria-label="相关链接">${links.map(link =>
      `<a href="${esc(link.url)}" target="_blank" rel="noopener"><span><strong>${esc(link.name)}</strong>
        ${link.paid ? '<small class="paid-label">付费</small>' : ''}${link.desc ? `<span class="link-description">${esc(link.desc)}</span>` : ''}</span>
        <span aria-hidden="true">↗</span></a>`).join('')}</section>` : ''}
    <a class="panel about-updates" href="#changelog">看看我们一路做了什么 <span aria-hidden="true">›</span></a>
  </main>`;
}
function renderChangelog(live, content) {
  const diary = content.diary ?? [];
  const first = diary[diary.length - 1]?.date;
  const today = shanghaiDate.format(new Date());
  const days = first ? Math.max(1,Math.floor((dateValue(today) - dateValue(first)) / 86400000) + 1) : 0;
  const groups = new Map();
  for (const entry of diary) {
    if (!groups.has(entry.date)) groups.set(entry.date,[]);
    groups.get(entry.date).push(entry);
  }
  return `${backBar(pageLinks('changelog'))}<main class="changelog-page">
    <section class="hero page-hero">${renderStars(live?.lifetime.total_hours ?? 0)}
      <div class="hero-content"><h1>共读星图在长大</h1>
        <p class="page-intro">这里记下看板的每一次更新：一个想法怎么变成数据、界面，再回到我们家的晚上。</p>
        <div class="changelog-counts"><span>第 ${n(days)} 天</span><span>第 ${n(diary.length)} 次更新</span></div>
      </div></section>
    ${diary.length ? `<section class="panel changelog-timeline">${[...groups].map(([date,entries]) => `<section class="changelog-group">
      <h2>${dateHTML(date,`${date.slice(0,4)} 年 ${shortDate(date)}`)}</h2>
      ${entries.map(entry => `<article class="change-entry${entry === diary[0] ? ' latest-change' : ''}">
        <span class="change-star" aria-hidden="true">✦</span><span class="change-version">${esc(entry.version)}</span>
        <h3>${esc(entry.title)}</h3><p>${esc(entry.text)}</p></article>`).join('')}
      </section>`).join('')}</section>` : '<p class="panel empty-changelog">还没有记录</p>'}
  </main>`;
}
function renderAchievementPage(live, content) {
  return `${backBar()}<main><section class="hero achievement-hero">${renderStars(live.lifetime.total_hours)}
    <div class="hero-content"><p class="eyebrow">共读里程碑</p><h1>全部成就</h1><p>${esc(content.site.galaxy_tagline)}</p></div></section>
    <section class="panel achievement-group">${heading('时长')}${renderMedals(achievementEntries(live),content)}</section>
    ${live.next_day && live.day_milestones_reached ? `<section class="panel achievement-group">${heading('天数')}
      ${renderMedals(achievementEntries(live,true),content)}</section>` : ''}</main>`;
}
function chooseFamilySet() {
  const sets = state.content.family?.sets ?? [];
  const choices = sets.length > 1 ? sets.filter((group) => group.id !== photoSet) : sets;
  return choices[Math.floor(Math.random() * choices.length)];
}
function faceURL(face) {
  const [group] = face.split('/');
  const version = state.content.family?.sets.find((item) => item.id === group)?.revision;
  return './family/' + face.split('/').map(encodeURIComponent).join('/') +
    (version ? `?v=${encodeURIComponent(version)}` : '');
}
function scheduleFamilyWarmup() {
  if (familyWarmup || !navigator.onLine || !navigator.serviceWorker?.controller) return;
  familyWarmup = true;
  const warm = async () => {
    try {
      // Give the three visible portraits first use of the connection.
      const visible = [...shell.querySelectorAll('.road-face img, .photo-avatar-strip img')];
      await Promise.allSettled(visible.map((image) => image.decode()));
      const urls = (state.content.family?.sets ?? []).filter((set) => set.revision)
        .flatMap((set) => set.faces.map(faceURL)).filter((url) => !warmedFaces.has(url));
      for (let index = 0; index < urls.length && navigator.onLine; index += 2) {
        await Promise.allSettled(urls.slice(index,index+2).map(async (url) => {
          const response = await fetch(url,{priority:'low'});
          if (response.ok) warmedFaces.add(url);
        }));
      }
    } finally {
      familyWarmup = false;
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(() => void warm(),{timeout:1200});
  else setTimeout(() => void warm(),350);
}
function familyFaces(group) {
  return group.faces.map((face,index) =>
    `<img src="${esc(faceURL(face))}" width="256" height="256" alt="${esc(state.content.family.people[index])}">`).join('');
}
function celebrationAvatars() {
  const group = state.content.family?.sets.find((set) => set.id === photoSet);
  return group ? `<button type="button" class="photo-avatar-strip" data-avatar-set="${esc(group.id)}"
    aria-label="${shell.dataset.photoLang === 'en' ? 'Change family portraits' : '换一组全家头像'}">${familyFaces(group)}</button>` : '';
}
async function swapFamily() {
  const strip = shell.querySelector('.photo-avatar-strip');
  if (!strip || avatarSwap || performance.now() - lastAvatarSwap < 1000 ||
      (state.content.family?.sets.length ?? 0) < 2) return;
  const group = chooseFamilySet();
  avatarSwap = true;
  const delay = (ms) => new Promise((resolve) => setTimeout(resolve,ms));
  try {
    const images = await Promise.all(group.faces.map(async (face,index) => {
      const img = new Image();
      img.width = img.height = 256;
      img.alt = state.content.family.people[index];
      img.src = faceURL(face);
      await img.decode();
      return img;
    }));
    if (!strip.isConnected) return;
    lastAvatarSwap = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduced) {
      strip.classList.add('faces-out');
      await delay(140);
      if (!strip.isConnected) return;
    }
    photoSet = group.id;
    strip.dataset.avatarSet = group.id;
    strip.replaceChildren(...images);
    strip.classList.remove('faces-out');
    if (!reduced) {
      strip.classList.add('faces-in');
      await delay(730);
      strip.classList.remove('faces-in');
    }
  } catch {
    // Keep the current set if the next one cannot be loaded.
  } finally {
    avatarSwap = false;
  }
}
function onFamilyMotion(event) {
  const acceleration = event.acceleration;
  const linear = acceleration && [acceleration.x,acceleration.y,acceleration.z].every(Number.isFinite);
  const reading = linear ? acceleration : event.accelerationIncludingGravity;
  if (!reading || ![reading.x,reading.y,reading.z].every(Number.isFinite)) return;
  const high = Math.hypot(reading.x,reading.y,reading.z) >= (linear ? 17 : 23);
  if (high && !motionPeak) void swapFamily();
  motionPeak = high;
}
const motionLabels = {
  idle:'启用摇一摇', pending:'正在请求权限…', enabled:'摇一摇已启用',
  denied:'动作访问未获允许', unavailable:'此处仅支持轻点换组',
};
function paintMotionState() {
  const button = shell.querySelector('.motion-toggle');
  if (!button) return;
  button.textContent = motionLabels[motionState];
  button.disabled = motionState === 'pending' || motionState === 'enabled' || motionState === 'unavailable';
}
async function enableFamilyMotion() {
  if (motionState === 'pending' || motionState === 'enabled' || motionState === 'unavailable') return;
  const motion = window.DeviceMotionEvent;
  if (!motion) {
    motionState = 'unavailable';
  } else {
    try {
      // The permission call must happen directly in the tap handler on iPhone.
      const permission = typeof motion.requestPermission === 'function' ? motion.requestPermission() : null;
      motionState = 'pending';
      paintMotionState();
      if (permission && await permission !== 'granted') {
        motionState = 'denied';
      } else {
        window.addEventListener('devicemotion',onFamilyMotion);
        motionState = 'enabled';
      }
    } catch {
      motionState = 'denied';
    }
  }
  paintMotionState();
}
function revealPhotoControls(card) {
  const back = card.querySelector('.photo-back');
  back.classList.add('is-visible');
  card.classList.add('show-photo-controls');
  clearTimeout(backTimer);
  backTimer = setTimeout(() => {
    back.classList.remove('is-visible');
    card.classList.remove('show-photo-controls');
  },5000);
}

function renderCelebrationPage(live, content, entry, lang) {
  const copy = resolve(content,entry.value,entry.dayBased);
  const reached = entry.date || entry.preview;
  const unit = entry.dayBased ? '天' : '小时';
  const titlePrefix = reached ? entry.dayBased ? '第' : '我们读了' : '下一站';
  const badge = copy.badge.trim().replace(/\s+/g, ' ');
  const showBadge = badge && badge !== `${titlePrefix} ${n(entry.value)} ${unit}` &&
    badge !== `${titlePrefix} ${entry.value} ${unit}`;
  const eta = entry.eta ? `预计 ${dateHTML(entry.eta)} 到站` : '预计日期待定';
  const arrival = entry.date ? `到站于 ${dateHTML(entry.date)}` : eta;
  const photo = entry.dayBased ? content.photo_days?.[lang] ?? {
    before:lang === 'en' ? 'Our reading day' : '一起读到第',after:lang === 'en' ? 'days' : '天',
  } : content.photo?.[lang] ?? fallback.photo[lang];
  const before = entry.locked ? (lang === 'en' ? 'Next milestone' : '下一站') : photo.before;
  const stars = Math.max(live.lifetime.total_hours, entry.preview && !entry.dayBased ? Math.min(entry.value, 5000) : 0);
  const faces = celebrationAvatars();
  return `<div class="celebration-nav">${backBar('<a href="#achievements">全部成就</a>')}</div><main>
    <section class="hero celebration ${faces ? '' : 'no-family'}">${renderStars(stars, true)}
      ${entry.preview ? '<span class="preview-label">预演</span>' : ''}
      <a class="photo-back" href="#achievements" aria-label="返回全部成就">‹ ${lang === 'en' ? 'Back' : '返回'}</a>
      <div class="celebration-layout hero-content">
        <div class="photo-feature"><div class="photo-medal">${medal(entry,lang === 'en' ? entry.dayBased ? 'days' : 'hours' : unit)}</div>${faces}</div>
        <div class="photo-copy" lang="${lang}">
          <h1><span>${esc(before)}</span><strong class="photo-number">${n(entry.value)}</strong><span>${esc(photo.after)}</span></h1>
        </div>
        <div class="celebration-copy">
          ${showBadge ? `<p class="eyebrow">${esc(copy.badge)}</p>` : ''}
          <h1>${titlePrefix} <strong>${n(entry.value)}</strong> ${unit}</h1>
          <p class="arrival-date">${entry.locked ? entry.dayBased ? `还差 ${entry.left} 个共读日` : `还差 ${hours(entry.left)} · ${eta}` : arrival}</p>
          ${copy.celebration ? `<p class="celebration-note">${esc(copy.celebration)}</p>` : ''}
          ${copy.message ? `<p class="celebration-message">${esc(copy.message)}</p>` : ''}
        </div>
      </div>
      <div class="photo-motion"><button type="button" class="motion-toggle"></button></div>
      <div class="photo-languages" role="group" aria-label="庆祝页语言">
        <button type="button" data-lang="zh" aria-label="中文" aria-pressed="${lang === 'zh'}"></button>
        <button type="button" data-lang="en" aria-label="English" aria-pressed="${lang === 'en'}"></button>
      </div>
    </section>
    <p class="rotate-hint">横过来拍照更好看</p>
  </main>`;
}

function postcardMessage(content, entry) {
  const {value,dayBased} = entry;
  const own = (dayBased ? content.day_milestones : content.milestones)?.[value]?.message;
  if (own) return own;
  const major = value % (dayBased ? 500 : 100) === 0;
  const pool = content.memory_messages?.[major ? 'thanks' : 'encourage'];
  if (!pool?.length) return '';
  const sum = new TextEncoder().encode(memoryKey(entry)).reduce((total, byte) => total + byte, 0);
  return pool[sum % pool.length].replaceAll('{n}',String(value)).replaceAll('{unit}',dayBased ? '天' : '小时');
}

function canvasLines(ctx, text, width) {
  return text.split('\n').flatMap((paragraph) => {
    const lines = [];
    let line = '';
    for (const char of paragraph) {
      if (line && ctx.measureText(line + char).width > width) {
        lines.push(line.trimEnd());
        line = '';
      }
      line += char;
    }
    lines.push(line.trimEnd());
    const last = lines.length - 1;
    if (last > 0 && /^\p{L}[\p{P}\s]*$/u.test(lines[last].trimStart())) {
      const previous = lines[last - 1].match(/^(.+?)(\p{L}[\p{P}\s]*)$/u);
      if (previous && ctx.measureText(previous[2] + lines[last]).width <= width) {
        lines[last - 1] = previous[1].trimEnd();
        lines[last] = previous[2] + lines[last];
      }
    }
    return lines;
  });
}

function canvasPNG(canvas) {
  // Keep the click's transient activation for the iPhone share sheet.
  const encoded = canvas.toDataURL('image/png').split(',')[1];
  return new Blob([Uint8Array.from(atob(encoded), char => char.charCodeAt(0))],{type:'image/png'});
}

function canShareImage(file) {
  return Boolean(navigator.share && navigator.canShare?.({files:[file]}));
}
function shareImage(file) {
  if (canShareImage(file)) navigator.share({files:[file]}).catch(() => {});
}
function saveImage(file, container) {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.hidden = true;
  container.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url),1000);
}

const shareCardCache = new Map();
let shareCardRevision;

function sharedDay(live, selection) {
  if (selection === 'today' || !live.yesterday) return 'today';
  return selection === 'yesterday' || !live.today.read ? 'yesterday' : 'today';
}

function yesterdayStreak(live) {
  if (live.today.read) return Math.max(0,live.streak.current - 1);
  if (live.today.is_partial) return live.streak.current;
  let streak = 0;
  const start = dateValue(live.yesterday.date);
  for (let date = live.yesterday.date; ; date = offsetDate(start,-streak)) {
    const year = date.slice(0,4);
    const index = Math.round((dateValue(date) - dateValue(year + '-01-01')) / 86400000);
    if (!(live.minutes_by_year?.[year]?.[index] > 0)) return streak;
    streak++;
  }
}

async function loadShareFaces() {
  if (readerFamily?.faces.length !== 3) return null;
  try {
    return await Promise.all(readerFamily.faces.map(async ({path}) => {
      const image = new Image();
      image.src = faceURL(path);
      await image.decode();
      return image;
    }));
  } catch {
    return null;
  }
}

function shareCardImage(live, site, type, day, portraits) {
  const width = 360;
  const height = 480;
  const middle = width / 2;
  const canvas = document.createElement('canvas');
  canvas.width = width * 3;
  canvas.height = height * 3;
  const ctx = canvas.getContext('2d');
  ctx.scale(3,3);
  const token = lightThemeTokenReader();
  const font = token('font');
  const ink = token('hero-text');
  const secondary = token('text');
  const blue = token('accent');
  const gold = token('gold');
  const strong = token('weight-strong');
  const heatColors = levels.map((_,i) => token(`level-${i}`));
  const alt = [site.name];
  // Make room for portraits while keeping the type sizes and footer fixed.
  let body = false;
  const bodyY = (y) => body && portraits ? 110 + (y - 80) * .92 : y;
  const setFont = (size, weight) => { ctx.font = `${weight} ${size}px ${font}`; };
  const label = (text, x, y, size = 11, weight = 400, color = secondary, maxWidth = 302) => {
    setFont(size,weight);
    ctx.fillStyle = color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(text,x,bodyY(y),maxWidth);
  };
  const copy = (text, y, size = 11, weight = 400, color = secondary) => {
    setFont(size,weight);
    const lines = canvasLines(ctx,text,288);
    lines.forEach((line,i) => label(line,middle,y + i * (size + 4),size,weight,color,288));
    alt.push(text);
    return lines.length * (size + 4);
  };
  const ring = (x, y, radius, fraction, lineWidth, color = blue) => {
    y = bodyY(y);
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.strokeStyle = token('line');
    ctx.beginPath();
    ctx.arc(x,y,radius,0,Math.PI * 2);
    ctx.stroke();
    if (fraction > 0) {
      ctx.strokeStyle = color;
      ctx.beginPath();
      ctx.arc(x,y,radius,-Math.PI / 2,Math.PI * 2 * Math.min(fraction,1) - Math.PI / 2);
      ctx.stroke();
    }
  };
  const tile = (x, y, size, level) => {
    ctx.fillStyle = heatColors[level] || heatColors[0];
    ctx.beginPath();
    ctx.roundRect(x,bodyY(y),size,size,Math.min(3,size / 4));
    ctx.fill();
  };
  const heatLegend = (y) => levels.forEach((level,i) => {
    const x = 40 + i * 73;
    tile(x,y - 4,8,i);
    label(level,x + 32,y,9,400,secondary,51);
  });
  const metric = (value, caption, x, y, unit = '') => {
    label(`${value}${unit ? ' ' + unit : ''}`,x,y,22,strong,ink,91);
    label(caption,x,y + 24,10);
    alt.push(`${caption} ${value}${unit}`);
  };

  const background = ctx.createLinearGradient(35,0,325,height);
  background.addColorStop(0,token('surface'));
  background.addColorStop(.52,token('accent-soft'));
  background.addColorStop(1,token('hero-line'));
  ctx.fillStyle = background;
  ctx.fillRect(0,0,width,height);
  const stars = state.theme?.stars?.light;
  if (stars) {
    const [starWidth,starHeight] = stars.viewBox;
    ctx.save();
    const margins = new Path2D();
    margins.rect(0,0,width,height);
    margins.rect(24,26,312,428);
    ctx.clip(margins,'evenodd');
    for (const point of starPoints(live.lifetime.total_hours,stars)) {
      ctx.fillStyle = point.gold ? token('hero-gold') : point.color;
      ctx.globalAlpha = point.opacity * .55;
      ctx.beginPath();
      ctx.arc(point.x * width / starWidth,point.y * height / starHeight,point.radius,0,Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.strokeStyle = token('hero-line');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(13,13,334,454,15);
  ctx.stroke();
  if (portraits) {
    for (const index of [0,2,1]) {
      const image = portraits[index];
      const radius = index === 1 ? 128 / 6 : 16;
      const x = middle + (index - 1) * 30;
      const y = index === 1 ? 43 : 46;
      const size = Math.min(image.naturalWidth,image.naturalHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x,y,radius,0,Math.PI * 2);
      ctx.clip();
      ctx.drawImage(image,(image.naturalWidth - size) / 2,(image.naturalHeight - size) / 2,size,size,
        x - radius,y - radius,radius * 2,radius * 2);
      ctx.restore();
      ctx.strokeStyle = token('hero-gold');
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  label(site.short_name || site.name,middle,portraits ? 77 : 40,12,strong);
  body = true;
  const through = live.data_through;
  const year = through.slice(0,4);

  if (type === 'day') {
    const selected = live[day];
    const subtractToday = day === 'yesterday' && live.today.read;
    const streak = day === 'yesterday' ? yesterdayStreak(live) : live.streak.current;
    const recordDays = live.lifetime.record_days - Number(subtractToday);
    const totalHours = Math.max(0,live.lifetime.total_hours - (subtractToday ? live.today.minutes / 60 : 0));
    copy(`${shortDate(selected.date)} · ${weekdayLabel(selected.date)}`,80,25,strong,ink);
    ring(middle,211,75,selected.minutes / BLUE_RING_MINUTES,10,selected.minutes >= GOLD_RING_MINUTES ? gold : blue);
    const minutes = n(Math.floor(selected.minutes));
    label(minutes,middle,205,50,strong,ink);
    label('分钟',middle,241,14);
    alt.push(`${minutes} 分钟`);
    metric(n(streak),'连续共读',70,340,'天');
    if (selected.minutes > 0 || (day === 'today' && live.today.read)) {
      label(n(recordDays),middle,340,22,strong,ink);
      label(`第 ${n(recordDays)} 个共读日`,middle,364,10);
      alt.push(`第 ${n(recordDays)} 个共读日`);
    } else {
      metric(n(recordDays),'累计共读日',middle,340);
    }
    metric(n(totalHours),'累计共读',290,340,'小时');
  } else if (type === 'week') {
    const {week} = live;
    const [start,end] = week.range;
    const count = weekReadingDays(live);
    const minutes = Math.floor(week.total_minutes);
    const duration = minutes < GOLD_RING_MINUTES ? `${n(minutes)} 分` :
      `${n(Math.floor(minutes / GOLD_RING_MINUTES))} 时 ${minutes % GOLD_RING_MINUTES} 分`;
    copy(`${dayMonth(start)} – ${dayMonth(end)} · 第 ${Number(week.period.split('W')[1])} 周`,80,23,strong,ink);
    ring(108,185,57,week.total_minutes / WEEK_GOAL_MINUTES,8);
    ring(252,185,57,count / 7,8);
    label(duration,108,180,20,strong,ink,95);
    label('本周时长',108,205,11);
    label(`${count}/7 天`,252,180,22,strong,ink);
    label('阅读日',252,205,11);
    alt.push(`本周时长 ${duration}`,`阅读日 ${count}/7 天`);
    label(`目标 ${WEEK_GOAL_MINUTES} 分钟`,108,262,10);
    label(`读满 ${READING_DAY_MINUTES} 分钟算一天`,252,262,10);
    const minutesByDay = new Map(week.days.map(({date,minutes}) => [date,minutes]));
    weekdays.forEach((weekday,i) => {
      const date = offsetDate(dateValue(start),i);
      const minutes = date > through ? 0 : minutesByDay.get(date) ?? 0;
      const x = 51 + i * 43;
      ring(x,314,14,minutes / BLUE_RING_MINUTES,3,minutes >= GOLD_RING_MINUTES ? gold : blue);
      label(minutes >= READING_DAY_MINUTES ? '✓' : date === through && !minutes ? '今' : '',x,314,10,strong);
      label(weekday,x,340,11);
    });
    copy(comparisonText(week,week.prev_same_period,'上周同期'),376);
  } else if (type === 'month') {
    const {month} = live;
    const [first,last] = month.range;
    const start = dateValue(first);
    const offset = (start.getUTCDay() + 6) % 7;
    copy(`${year} 年 ${Number(first.slice(5,7))} 月`,80,26,strong,ink);
    weekdays.forEach((weekday,i) => label(weekday,57 + i * 41,122,10));
    const dayLevels = new Map(month.calendar.map(({date,level}) => [date,level]));
    for (let i = 0; i < Number(last.slice(8)); i++) {
      const index = i + offset;
      const x = 42 + index % 7 * 41;
      const y = 136 + Math.floor(index / 7) * 25;
      const date = offsetDate(start,i);
      if (date <= through) tile(x,y,22,dayLevels.get(date));
      label(String(i + 1),x + 11,y + 11,10,400,date <= through ? ink : secondary);
    }
    heatLegend(298);
    metric(n(month.record_days),'本月共读',70,332,'天');
    metric(p(month.coverage),'覆盖率',middle,332);
    metric(n(month.total_hours),'本月时长',290,332,'小时');
    copy(comparisonText(month,month.prev_same_period,'上月同期',true),379);
  } else {
    copy(`${year} 年`,80,28,strong,ink);
    const stats = live.years?.[year];
    const minutes = live.minutes_by_year?.[year];
    if (!stats || !minutes) {
      copy('数据更新中',221,22,strong,ink);
    } else {
      const start = dateValue(`${year}-01-01`);
      const offset = (start.getUTCDay() + 6) % 7;
      const since = Math.max(0,Math.round((dateValue(live.lifetime.since) - start) / 86400000));
      const step = 5.62;
      const left = 32;
      minutes.forEach((value,i) => {
        const date = offsetDate(start,i);
        const column = Math.floor((i + offset) / 7);
        const x = left + column * step;
        if (date.endsWith('-01') && [1,3,5,7,9,11].includes(Number(date.slice(5,7)))) {
          label(`${Number(date.slice(5,7))} 月`,x + 6,151,9);
        }
        if (value !== null && date <= through) {
          tile(x,167 + (i + offset) % 7 * step,4.7,live.levels_by_year[year]?.[i - since]);
        }
      });
      heatLegend(228);
      label(n(stats.total_hours),middle,287,48,strong,ink);
      label('今年共读 · 小时',middle,323,12);
      alt.push(`今年 ${n(stats.total_hours)} 小时`);
      metric(n(stats.record_days),'共读',108,359,'天');
      metric(n(stats.days_30),'读满 30 分钟',252,359,'天');
    }
  }
  ctx.strokeStyle = token('hero-line');
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  body = false;
  ctx.moveTo(36,400);
  ctx.lineTo(324,400);
  ctx.stroke();
  // Fit the signature above the date while sharing the postcard's wrapping rules.
  if (site.share_signature) {
    let size = 10;
    setFont(size,400);
    while (canvasLines(ctx,site.share_signature,288).length > 2 && size > 5) setFont(--size,400);
    const lines = canvasLines(ctx,site.share_signature,288);
    const lineHeight = Math.min(size + 4,24 / lines.length);
    lines.forEach((line,i) => label(line,middle,413 + i * lineHeight,size,400,secondary,288));
    alt.push(site.share_signature);
  }
  copy(`数据截至 ${shortDate(through)}`,site.share_signature ? 440 : 423,10);
  if (site.share_show_url) copy(PUBLIC_BOARD_URL,453,9);
  return {blob:canvasPNG(canvas),description:alt.join(' · ')};
}

function cachedShareCard(live, site, type, day, portraits) {
  const revision = JSON.stringify([live.data_through,live.fetched_at,live.generated_at,
    documentTheme.theme,'light',site.name,site.short_name,site.share_signature,site.share_show_url,readerFamily?.group,Boolean(portraits)]);
  if (shareCardRevision !== revision) {
    for (const {url} of shareCardCache.values()) URL.revokeObjectURL(url);
    shareCardCache.clear();
    shareCardRevision = revision;
  }
  const key = type === 'day' ? day : type;
  if (!shareCardCache.has(key)) {
    const {blob,description} = shareCardImage(live,site,type,day,portraits);
    const date = type === 'day' ? live[day].date : live.data_through;
    const file = new File([blob],`${site.name}-${SHARE_LABELS[type]}-${date}.png`,{type:'image/png'});
    shareCardCache.set(key,{file,description,url:URL.createObjectURL(file)});
  }
  return shareCardCache.get(key);
}

function mountSharePage(live, site, type, daySelection) {
  const day = live && sharedDay(live,daySelection);
  const isDay = type === 'day';
  const address = `#share/day?d=${day}`;
  if (isDay && day && location.hash !== address) history.replaceState(history.state,'',address);
  const tabs = Object.entries(SHARE_LABELS).map(([key,label]) =>
    `<a href="#share/${key}"${key === type ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  shell.innerHTML = `${backBar()}<main class="share-page">
    <nav class="share-tabs" aria-label="分享卡类型">${tabs}</nav>
    ${isDay && live ? `<nav class="share-tabs share-days" aria-label="选择共读日">
      <a href="#share/day?d=today"${day === 'today' ? ' aria-current="page"' : ''}>今天</a>
      ${live.yesterday ? `<a href="#share/day?d=yesterday"${day === 'yesterday' ? ' aria-current="page"' : ''}>昨天</a>` : ''}</nav>` : ''}
    ${live ? `<img class="share-preview" width="1080" height="1440" alt="" hidden>
      <p class="panel notice share-status" role="status">正在生成分享卡…</p>
      <div class="share-actions">
        <button class="postcard-control share-send" type="button" hidden>分享</button>
        <button class="postcard-control share-save" type="button" disabled>保存图片</button>
      </div>` : '<p class="panel notice" role="status">暂时无法读取共读数据，请联网后重试。</p>'}
  </main>`;
  if (!live) return;
  const panel = shell.querySelector('.share-page');
  const status = panel.querySelector('.share-status');
  Promise.all([document.fonts.ready,loadShareFaces()]).then(([,portraits]) => {
    if (!panel.isConnected) return;
    const {file,description,url} = cachedShareCard(live,site,type,day,portraits);
    const image = panel.querySelector('.share-preview');
    image.alt = description;
    image.src = url;
    image.hidden = false;
    status.hidden = true;
    const save = panel.querySelector('.share-save');
    const share = panel.querySelector('.share-send');
    save.disabled = false;
    share.hidden = !canShareImage(file);
    save.addEventListener('click',() => saveImage(file,panel));
    share.addEventListener('click',() => shareImage(file));
  }).catch(() => { status.textContent = '暂时无法生成分享卡，请稍后重试。'; });
}

function postcardImage(image, entry, message, signature, orientation) {
  const landscape = orientation === 'landscape';
  const width = landscape ? 480 : 360;
  const height = landscape ? 360 : 480;
  const photoWidth = landscape ? width * .58 : width;
  const photoHeight = landscape ? height : height * .62;
  const canvas = document.createElement('canvas');
  canvas.width = width * 3;
  canvas.height = height * 3;
  const ctx = canvas.getContext('2d');
  ctx.scale(3,3);
  const token = lightThemeTokenReader();
  const font = token('font');
  const inset = 22;
  const gap = 7;
  const left = (landscape ? photoWidth : 0) + inset;
  const copyTop = landscape ? 0 : photoHeight;
  const textWidth = width - left - inset;
  const textHeight = height - copyTop - 2 * 14;

  ctx.fillStyle = token('surface');
  ctx.fillRect(0,0,width,height);
  const scale = Math.max(photoWidth / image.naturalWidth, photoHeight / image.naturalHeight);
  const cropWidth = photoWidth / scale;
  const cropHeight = photoHeight / scale;
  ctx.drawImage(image,(image.naturalWidth-cropWidth)*.5,(image.naturalHeight-cropHeight)*.35,
    cropWidth,cropHeight,0,0,photoWidth,photoHeight);

  const strong = token('weight-strong');
  const heavy = token('weight-heavy');
  let numberSize = 61;
  let unitSize = 19;
  const pieces = entry.dayBased ? ['第', n(entry.value), '天'] : [n(entry.value), '小时'];
  const numberIndex = entry.dayBased ? 1 : 0;
  const titleFont = (index) => index === numberIndex ? `${heavy} ${numberSize}px ${font}` : `${strong} ${unitSize}px ${font}`;
  const titleWidth = pieces.reduce((total, piece, index) => {
    ctx.font = titleFont(index);
    return total + ctx.measureText(piece).width;
  }, (pieces.length-1)*5);
  const titleScale = Math.min(1,textWidth / titleWidth);
  numberSize *= titleScale;
  unitSize *= titleScale;

  let messageSize = 14;
  let lines;
  const dateHeight = 14;
  const signatureHeight = signature ? 12 : 0;
  const fixedHeight = numberSize + dateHeight + signatureHeight + gap * (signature ? 3 : 2);
  do {
    ctx.font = `${strong} ${messageSize}px ${font}`;
    lines = message ? canvasLines(ctx,message,textWidth) : [];
    if (lines.length * messageSize * 1.4 <= textHeight - fixedHeight) break;
    messageSize *= .9;
  } while (messageSize > 1);
  const lineHeight = messageSize * 1.4;
  const totalHeight = fixedHeight + lines.length * lineHeight;
  const top = copyTop + (height - copyTop - totalHeight) / 2;
  let x = left;
  ctx.fillStyle = token('photo-number');
  pieces.forEach((piece,index) => {
    ctx.font = titleFont(index);
    ctx.fillText(piece,x,top+numberSize*.84);
    x += ctx.measureText(piece).width + 5*titleScale;
  });

  ctx.textBaseline = 'middle';
  let y = top + numberSize + gap;
  ctx.fillStyle = token('text-strong');
  ctx.font = `${strong} ${messageSize}px ${font}`;
  for (const line of lines) {
    ctx.fillText(line,left,y+lineHeight/2);
    y += lineHeight;
  }
  y += gap;
  ctx.fillStyle = token('text');
  ctx.font = `400 11px ${font}`;
  ctx.fillText(`到站于 ${entry.date}`,left,y+dateHeight/2);
  if (signature) {
    ctx.fillStyle = token('text-muted');
    ctx.font = `400 10px ${font}`;
    ctx.fillText(signature,left,y+dateHeight+gap+signatureHeight/2,textWidth);
  }
  return canvasPNG(canvas);
}

function mountPhotoMode(live, content, entry, lang) {
  document.documentElement.removeAttribute('data-postcard');
  shell.dataset.photoLang = lang;
  shell.innerHTML = renderCelebrationPage(live,content,entry,lang);
  const photo = memoryPhoto(entry);
  if (photo) {
    const card = shell.querySelector('.celebration');
    card.insertAdjacentHTML('beforeend',memoryImage(photo,'photo-mode-memory'));
    mountMemoryImage(card.querySelector('.photo-mode-memory'));
  }
  paintMotionState();
  watchPhotoStars();
}

function fitPostcardCopy(copy) {
  const text = copy.querySelector('.postcard-text');
  const message = copy.querySelector('.postcard-message');
  message.style.removeProperty('font-size');
  const style = getComputedStyle(copy);
  const available = copy.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  if (text.offsetHeight <= available) return;
  let high = parseFloat(getComputedStyle(message).fontSize);
  let low = 4;
  for (let i=0;i<8;i++) {
    const size = (low+high)/2;
    message.style.fontSize = `${size}px`;
    if (text.offsetHeight <= available) low = size;
    else high = size;
  }
  message.style.fontSize = `${low}px`;
}

function mountPostcard(entry, source, message, signature, key) {
  const label = entry.dayBased ? `第 ${n(entry.value)} 天` : `${n(entry.value)} 小时`;
  document.documentElement.setAttribute('data-postcard','');
  shell.innerHTML = `<main class="postcard" tabindex="0" aria-label="${esc(label)}纪念明信片">
    ${memoryImage(source,'postcard-photo')}
    <section class="postcard-copy"><div class="postcard-text">
      <h1 class="postcard-title" aria-label="${esc(label)}">${entry.dayBased ? '<span>第</span>' : ''}
        <strong class="postcard-value">${n(entry.value)}</strong> <span>${entry.dayBased ? '天' : '小时'}</span></h1>
      <p class="postcard-message">${esc(message)}</p>
      <p class="postcard-date">到站于 ${dateHTML(entry.date)}</p>
      ${signature ? `<p class="postcard-signature">${esc(signature)}</p>` : ''}
    </div></section>
    <div class="postcard-controls" aria-hidden="false">
      <a class="postcard-control postcard-back" href="#achievements">‹ 返回</a>
      <a class="postcard-control postcard-mode" href="${achievementURL(entry.id)}?photo=1">拍照模式</a>
      <div class="postcard-actions">
        <button class="postcard-control postcard-share" type="button" hidden disabled>分享</button>
        <button class="postcard-control postcard-save" type="button" disabled>保存图片</button>
      </div>
    </div>
  </main>`;
  const panel = shell.querySelector('.postcard');
  panel.dataset.key = key;
  const copy = panel.querySelector('.postcard-copy');
  const frame = panel.querySelector('.postcard-photo');
  const image = frame.querySelector('img');
  const controls = panel.querySelector('.postcard-controls');
  const save = panel.querySelector('.postcard-save');
  const share = panel.querySelector('.postcard-share');
  const filename = `coreading-${memoryKey(entry)}.png`;
  share.hidden = !canShareImage(new File([new Uint8Array([137,80,78,71])],filename,{type:'image/png'}));
  const setControls = (visible) => {
    controls.setAttribute('aria-hidden',String(!visible));
    controls.inert = !visible;
  };
  const toggle = () => {
    clearTimeout(postcardTimer);
    setControls(controls.getAttribute('aria-hidden') === 'true');
  };

  controls.addEventListener('focusin',() => clearTimeout(postcardTimer));
  panel.addEventListener('click',(event) => {
    if (!event.target.closest('button,a')) toggle();
  });
  panel.addEventListener('keydown',(event) => {
    if (event.target === panel && ['Enter',' '].includes(event.key)) {
      event.preventDefault();
      toggle();
    }
  });
  mountMemoryImage(frame,() => {
    document.fonts.ready.then(() => {
      if (!panel.isConnected) return;
      save.disabled = share.disabled = false;
      if (!controls.contains(document.activeElement)) {
        postcardTimer = setTimeout(() => setControls(false),2000);
      }
    });
  });

  const exportFile = () => {
    const orientation = matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
    return new File([postcardImage(image,entry,message,signature,orientation)],filename,{type:'image/png'});
  };
  save.addEventListener('click',() => saveImage(exportFile(),panel));
  share.addEventListener('click',() => shareImage(exportFile()));

  const fit = () => { if (panel.isConnected) fitPostcardCopy(copy); };
  postcardObserver = new ResizeObserver(fit);
  postcardObserver.observe(copy);
  document.fonts.ready.then(fit);
  fit();
}

document.addEventListener('keydown',(event) => {
  const back = shell.querySelector('.postcard-back');
  if (event.key === 'Escape' && back) {
    event.preventDefault();
    location.hash = back.hash;
  }
});

function watchPhotoStars() {
  const card = shell.querySelector('.celebration');
  const sky = card.querySelector('.stars');
  if (!sky) return;
  const subjects = [...card.querySelectorAll('.photo-medal, .photo-avatar-strip, .photo-copy h1')];
  const copy = card.querySelector('.photo-copy');
  const {width,height} = sky.viewBox.baseVal;
  const dots = [...sky.querySelectorAll('circle')].map((dot) => ({
    dot,x:dot.cx.baseVal.value / width,y:dot.cy.baseVal.value / height,radius:dot.r.baseVal.value,
  }));
  const update = () => {
    const frame = sky.getBoundingClientRect();
    if (!frame.width || !frame.height) return;
    const regions = copy.getClientRects().length ? subjects.filter((element) => element.getClientRects().length).map((element) => element.getBoundingClientRect()) : [];
    sky.setAttribute('viewBox',`0 0 ${frame.width} ${frame.height}`);
    for (const {dot,x,y,radius} of dots) {
      const cx = x * frame.width;
      const cy = y * frame.height;
      dot.cx.baseVal.value = cx;
      dot.cy.baseVal.value = cy;
      const px = frame.left + cx;
      const py = frame.top + cy;
      const gap = 16 + radius;
      const covered = regions.some((r) => px >= r.left-gap && px <= r.right+gap && py >= r.top-gap && py <= r.bottom+gap);
      dot.style.visibility = covered ? 'hidden' : '';
    }
  };
  photoObserver = new ResizeObserver(update);
  [card,copy,...subjects].forEach((element) => photoObserver.observe(element));
  update();
}

function setPhotoLanguage(lang) {
  if (shell.dataset.photoLang === lang) return;
  const address = new URL(location.href);
  address.searchParams.set('lang',lang);
  history.replaceState(history.state,'',address);
  render();
}

shell.addEventListener('pointerdown',(event) => {
  const card = event.target.closest('.celebration');
  if (!event.isPrimary || event.button !== 0 || !card || event.target.closest('a,button')) return;
  gesture = {id:event.pointerId,x:event.clientX,y:event.clientY,card,touch:event.pointerType === 'touch'};
});
shell.addEventListener('pointercancel',() => { gesture = null; });
shell.addEventListener('pointerup',(event) => {
  if (gesture?.id !== event.pointerId) return;
  const {card,x,y,touch} = gesture;
  gesture = null;
  if (!card.isConnected || event.target.closest('a,button')) return;
  const dx = event.clientX-x;
  const dy = event.clientY-y;
  const awayFromEdge = x > 28 && x < innerWidth-28;
  if (touch && awayFromEdge && Math.abs(dx) >= 80 && Math.abs(dx) > Math.abs(dy) * 1.7) {
    ignorePhotoClickUntil = performance.now()+400;
    setPhotoLanguage(shell.dataset.photoLang === 'en' ? 'zh' : 'en');
  } else if (Math.hypot(dx,dy) < 12 && card.querySelector('.photo-copy').getClientRects().length) {
    revealPhotoControls(card);
  }
});

const homeBlocks = [renderArrival,renderGalaxy,renderToday,renderNext,renderWeek,renderHeatmap,
  renderYears,renderConversions,renderAchievementBlock,renderModules];
function route() {
  let [path, query] = location.hash.slice(1).split('?');
  if (path === 'diary') {
    path = 'changelog';
    const address = new URL(location.href);
    address.hash = `changelog${query ? '?' + query : ''}`;
    history.replaceState(history.state,'',address);
  }
  const search = new URLSearchParams(location.search);
  const hashSearch = new URLSearchParams(query);
  const requested = hashSearch.get('celebrate') ?? search.get('celebrate');
  const isDay = requested?.startsWith('d');
  const value = Number(isDay ? requested.slice(1) : requested);
  const preview = requested && /^(?:d)?\d+$/.test(requested) &&
    Number.isSafeInteger(value) && value > 0 && value % (isDay ? 100 : 50) === 0 ? requested : null;
  const lang = search.get('lang') === 'en' ? 'en' : 'zh';
  const page = path === 'about' || path === 'changelog' ? path : null;
  const share = path.match(/^share\/(day|week|month|year)$/)?.[1];
  const match = path.match(/^achievements(?:\/(d?\d+))?$/);
  const achievement = match?.[1] ?? (match || page || share ? null : preview);
  return {preview, lang, page, share, daySelection:hashSearch.get('d'), achievement, photoMode:hashSearch.get('photo') === '1',
    subpage:Boolean(page || share || match || achievement)};
}
function render({background = false} = {}) {
  const {live,content} = state;
  const current = route();
  state.preview = current.preview;
  const entry = live && current.subpage
    ? achievementEntries(live,Boolean(current.achievement?.startsWith('d'))).find((item) => item.id === current.achievement) : null;
  const photo = !current.photoMode && memoryPhoto(entry);
  const message = photo ? postcardMessage(content,entry) : '';
  const signature = content.site.share_signature ?? '';
  const postcardKey = photo && JSON.stringify([photo,entry.date,message,signature,documentTheme.theme,'light']);
  if (background && (postcardKey ? shell.querySelector('.postcard')?.dataset.key === postcardKey :
    shell.querySelector('.celebration') && shell.dataset.route === String(current.achievement) &&
    shell.dataset.photoLang === current.lang)) return;
  documentTheme.mode = displayMode(photo || (entry && photoUsesLight(current)));
  document.documentElement.removeAttribute('data-postcard');
  postcardObserver?.disconnect();
  clearTimeout(postcardTimer);
  if (entry && (entry.id !== avatarVisit || !content.family?.sets.some((set) => set.id === photoSet))) {
    const warmGroup = !photoSet && content.family?.sets.find((set) => set.id === readerFamily?.group);
    photoSet = (warmGroup || chooseFamilySet())?.id ?? null;
  }
  avatarVisit = entry?.id ?? null;
  for (const strip of shell.querySelectorAll('[data-scroll-key]')) {
    homeScrollPositions.set(strip.dataset.scrollKey,{
      left:strip.scrollLeft,end:strip.scrollWidth - strip.clientWidth - strip.scrollLeft < 2,
    });
  }
  photoObserver?.disconnect();
  ringObserver?.disconnect();
  clearTimeout(backTimer);
  delete shell.dataset.photoLang;
  const previousRoute = shell.dataset.route;
  shell.dataset.page = current.subpage ? 'detail' : 'home';
  shell.dataset.route = current.subpage ? String(current.page ?? (current.share && `share/${current.share}`) ?? current.achievement ?? 'achievements') : 'home';
  document.title = content.site.name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = content.site.short_name || content.site.name;
  if (current.page) {
    shell.innerHTML = current.page === 'about' ? renderAbout(live,content) : renderChangelog(live,content);
  } else if (current.share) {
    mountSharePage(live,content.site,current.share,current.daySelection);
  } else if (!live) {
    shell.innerHTML = `${renderHeader(live,content)}<main><p class="panel notice" role="status">暂时无法读取共读数据，请联网后重试。</p></main>${renderFooter(live,content)}`;
  } else if (current.subpage) {
    if (entry) {
      if (photo) mountPostcard(entry,photo,message,signature,postcardKey);
      else mountPhotoMode(live,content,entry,current.lang);
    } else {
      shell.innerHTML = renderAchievementPage(live,content);
    }
  } else {
    shell.innerHTML = `${renderHeader(live,content)}${ringGradient}<main>${homeBlocks.map((block) => block(live,content)).join('')}</main>${renderFooter(live,content)}`;
    restoreHomeScroll();
    playBeanRoad();
    paintSyncControls();
    for (const section of shell.querySelectorAll('.week')) {
      paintReadingDetail(section,section.querySelector('[aria-pressed="true"]'));
    }
    animateReadingRings();
  }
  for (const thumbnail of shell.querySelectorAll('.memory-thumbnail')) mountMemoryImage(thumbnail);
  if (previousRoute !== shell.dataset.route) window.scrollTo(0,current.subpage ? 0 : homeScroll);
}
shell.addEventListener('error', (event) => {
  if (event.target.matches?.('[data-reader-face]') && !readerFaceFailed) {
    readerFaceFailed = true;
    render();
    return;
  }
  const image = event.target;
  if (image.matches?.('[data-header-face]')) {
    image.classList.add('face-failed');
    const badge = image.closest('.header-badge');
    if (!badge.querySelector('[data-header-face]:not(.face-failed)')) badge.classList.add('badge-book-only');
  }
  if (image.matches?.('.photo-avatar-strip img')) {
    if (!image.dataset.retried && navigator.onLine) {
      image.dataset.retried = 'true';
      const retry = new URL(image.src);
      retry.searchParams.set('retry','1');
      image.src = retry.href;
    } else {
      const placeholder = document.createElement('span');
      placeholder.className = 'photo-face-fallback';
      placeholder.textContent = image.alt;
      image.replaceWith(placeholder);
    }
  }
}, true);
shell.addEventListener('click', (event) => {
  const yearButton = event.target.closest('button[data-heat-year]');
  if (yearButton) {
    heatmapYear = yearButton.dataset.heatYear;
    heatmapDate = null;
    heatmapBubble = false;
    homeScrollPositions.delete(`heat-${heatmapYear}`);
    render();
    return;
  }
  const dateButton = event.target.closest('button[data-heat-date]:not(:disabled)');
  if (dateButton) {
    heatmapDate = dateButton.dataset.heatDate;
    heatmapBubble = true;
    selectReadingDay(dateButton.closest('.heatmap'),dateButton);
    positionHeatTooltip();
    return;
  }
  if (event.target.closest('.sync-button')) {
    void syncToday();
    return;
  }
  if (performance.now() < ignorePhotoClickUntil && event.target.closest('.celebration')) {
    event.preventDefault();
    return;
  }
  if (event.target.closest('.motion-toggle')) {
    void enableFamilyMotion();
    return;
  }
  const strip = event.target.closest('.photo-avatar-strip');
  if (strip) {
    revealPhotoControls(strip.closest('.celebration'));
    void enableFamilyMotion();
    void swapFamily();
    return;
  }
  const language = event.target.closest('button[data-lang]');
  if (language) {
    setPhotoLanguage(language.dataset.lang);
    return;
  }
  const link = event.target.closest('a');
  if (link?.matches('[data-home]')) {
    event.preventDefault();
    const address = new URL(location.href);
    address.searchParams.delete('celebrate');
    address.hash = '';
    history.pushState(null,'',address);
    render();
  } else if (link && /^#(?:achievements|about|changelog|diary|share\/)/.test(link.hash) && shell.dataset.page === 'home') {
    homeScroll = window.scrollY;
  }
});
document.addEventListener('click', (event) => {
  const week = shell.querySelector('.week');
  if (!week) return;
  const button = event.target.closest('button[data-week-date]:not(:disabled)');
  const next = button?.dataset.weekDate ?? null;
  if (!next && !selectedWeekDate) return;
  selectedWeekDate = next === selectedWeekDate ? null : next;
  selectReadingDay(week,selectedWeekDate ? button : null);
});
window.addEventListener('hashchange', render);
window.addEventListener('popstate', render);

async function jsonResource(path, validate) {
  const response = await fetch(path,{cache:'no-store'});
  if (!response.ok) throw new Error('Resource unavailable');
  const data = await response.json();
  if (!validate(data)) throw new Error('Invalid resource');
  return {data,cached:response.headers.get('X-Coreading-Source') === 'cache'};
}
const validContent = (data) => data?.schema_version === 1 && data.site &&
  data.defaults?.minor && data.defaults?.major && data.milestones && Array.isArray(data.conversions);
const validLive = (data) => data?.schema_version === 1 && data.today && data.lifetime && data.streak &&
  data.next && data.week && data.month && data.modules && data.levels_by_year &&
  Array.isArray(data.roadmap) && Array.isArray(data.milestones_reached) && Array.isArray(data.cumulative_by_month);

async function loadMemories() {
  try {
    const {data} = await jsonResource('./memories.json',
      (index) => index && typeof index === 'object' && !Array.isArray(index));
    return Object.fromEntries(Object.entries(data).filter(([key, entry]) =>
      /^[1-9]\d*[hd]$/.test(key) &&
      new RegExp(`^memories/${key}\\.jpg\\?v=[a-f0-9]{8}$`).test(entry?.photo)));
  } catch {
    return {};
  }
}

async function loadLive(stamp) {
  const suffix = stamp === undefined ? '' : `?t=${stamp}`;
  try {
    return await jsonResource('./live.json'+suffix,validLive);
  } catch (error) {
    if (!['127.0.0.1','localhost','[::1]'].includes(location.hostname)) throw error;
    return jsonResource('./sample/live.json'+suffix,validLive);
  }
}
async function loadTheme(registry, preference) {
  const id = /^[a-z][a-z0-9-]*$/.test(preference) &&
    registry?.themes.some((theme) => theme.id === preference) ? preference : 'starmap';
  try {
    const {data} = await jsonResource(`./themes/${id}/theme.json`, (config) => Boolean(config?.stars?.light && config.stars.dark));
    if (id !== 'starmap' && !document.getElementById(`theme-${id}`)) {
      await new Promise((resolve,reject) => {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = `theme-${id}`;
        link.href = `./themes/${id}/theme.css`;
        link.onload = resolve;
        link.onerror = () => { link.remove(); reject(new Error('Theme stylesheet unavailable')); };
        document.head.append(link);
      });
    }
    document.documentElement.dataset.theme = id;
    state.theme = data;
  } catch {
    if (id !== 'starmap') await loadTheme(null,'starmap');
  }
}

let requestId = 0;
let analyticsEligible = false;
async function update() {
  if (syncInFlight) return;
  lastReadAt = Date.now();
  const id = ++requestId;
  const [live,content,registry,memories] = await Promise.allSettled([
    loadLive(),jsonResource('./content.json',validContent),
    jsonResource('./themes/registry.json',(data) => Array.isArray(data?.themes)),loadMemories(),
  ]);
  if (id !== requestId) return;
  if (memories.status === 'fulfilled') state.memories = memories.value;
  if (live.status === 'fulfilled') state.live = live.value.data;
  if (content.status === 'fulfilled') {
    state.content = {...content.value.data,site:{...fallback.site,...content.value.data.site}};
    enableAnalytics(state.content.site.analytics,analyticsEligible);
  }
  if (readerFamily === undefined && content.status === 'fulfilled') readerFamily = chooseReaderFamily(state.content.family);
  state.offline = !navigator.onLine || live.status === 'rejected' || Boolean(live.value?.cached);
  if (!state.offline && syncStatus === 'offline') syncStatus = '';
  const preference = new URLSearchParams(location.search).get('theme') || state.content.site.theme;
  await loadTheme(registry.value?.data,preference);
  if (id === requestId) {
    render({background:true});
    scheduleFamilyWarmup();
  }
}
let shellReloading = false;
function checkShellVersion(controller) {
  if (!controller || shellReloading) return;
  const channel = new MessageChannel();
  const port = channel.port1;
  const timer = setTimeout(() => port.close(),3000);
  port.onmessage = ({data:version}) => {
    clearTimeout(timer);
    port.close();
    if (shellReloading || controller !== navigator.serviceWorker.controller ||
        !/^r\d+$/.test(version) || version === SHELL_VERSION) return;
    const key = 'coreading:shell-reload';
    try {
      if (sessionStorage.getItem(key) === version) return;
      sessionStorage.setItem(key,version);
    } catch {}
    shellReloading = true;
    location.reload();
  };
  controller.postMessage('coreading:shell-version',[channel.port2]);
}

async function start() {
  analyticsEligible = analyticsAllowed();
  if ('serviceWorker' in navigator) {
    const worker = navigator.serviceWorker;
    worker.addEventListener('controllerchange',scheduleFamilyWarmup);
    const workerURL = new URL('./sw.js',location.href).href;
    const controlled = () => worker.controller?.scriptURL === workerURL;
    worker.addEventListener('controllerchange',() => {
      if (controlled()) checkShellVersion(worker.controller);
    });
    const register = worker.register('./sw.js').catch(() => null);
    if (!controlled()) {
      let listener, timer;
      try {
        await Promise.race([
          register.then((registration) => registration ? new Promise((resolve) => {
            listener = () => { if (controlled()) resolve(); };
            worker.addEventListener('controllerchange',listener);
            listener();
          }) : null),
          new Promise((resolve) => { timer = setTimeout(resolve,2000); }),
        ]);
      } finally {
        clearTimeout(timer);
        if (listener) worker.removeEventListener('controllerchange',listener);
      }
    }
  }
  await update();
}
function refreshForeground() {
  // The initial load belongs to start(), which waits for Service Worker control.
  if (lastReadAt && document.visibilityState === 'visible' && Date.now() - lastReadAt >= 60000) void update();
}
document.addEventListener('visibilitychange',refreshForeground);
window.addEventListener('pageshow',refreshForeground);
window.addEventListener('online',() => { if (lastReadAt) void update(); });
window.addEventListener('offline',() => { state.offline = true; render({background:true}); });
void start();
