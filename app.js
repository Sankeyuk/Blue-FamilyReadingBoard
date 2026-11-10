const shell = document.getElementById('shell');
const weekdays = ['一', '二', '三', '四', '五', '六', '日'];
const levels = ['无记录', '< 30 分', '30–59 分', '≥ 60 分'];
// DESIGN.md 固定含义，主题不能改。
const READING_DAY_MINUTES = 5;
const BLUE_RING_MINUTES = 30;
const GOLD_RING_MINUTES = 60;
const WEEK_GOAL_MINUTES = 210;
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
const dateHTML = (value, label = value) => `<time datetime="${esc(value)}">${esc(label)}</time>`;
const heading = (title, meta = '') => `<div class="heading"><h2>${title}</h2>${meta}</div>`;
const legend = () => `<div class="legend">${levels.map((label, i) =>
  `<span><i class="level-${i}" aria-hidden="true"></i>${esc(label)}</span>`).join('')}</div>`;
const achievementURL = (value) => `#achievements${value ? `/${value}` : ''}`;

let state = {live:null, content:fallback, offline:false, preview:null, theme:null};
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
let headerFamilyFailed = false;
let readerFaceFailed = false;
let roadPlayed = false;
let analyticsEnabled = false;
const analyticsOptOutKey = 'coreading:analytics-opt-out';
history.scrollRestoration = 'manual';
let photoObserver, backTimer, gesture;

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
const bookArt = (star = false) => `<svg viewBox="0 0 24 24" aria-hidden="true">
  <path class="book-line" d="M12 20c-2.2-2-5-3-9-3V8c4 0 6.8 1 9 3 2.2-2 5-3 9-3v9c-4 0-6.8 1-9 3Zm0 0v-9"/>
  ${star ? '<path class="book-star" d="M12 1l1.25 3.75L17 6l-3.75 1.25L12 11l-1.25-3.75L7 6l3.75-1.25Z"/>' : ''}</svg>`;
function readerPortrait() {
  const reader = readerFamily?.reader;
  return reader && !readerFaceFailed
    ? `<img class="reader-portrait" data-reader-face src="${esc(faceURL(reader.path))}" alt="">`
    : '';
}
function renderHeader(live, content) {
  const portraits = readerFamily && !headerFamilyFailed ? readerFamily.faces.map((face) =>
    `<img class="reader-portrait" data-header-face src="${esc(faceURL(face.path))}" alt="${esc(face.name)}">`).join('') : '';
  const badge = portraits ? `<div class="header-badge"><span class="header-family">${portraits}</span><span class="badge-book">${bookArt()}</span>
    <svg class="badge-arc" viewBox="0 0 104 64" aria-hidden="true">
      <circle cx="10" cy="19" r="1.5"/><circle cx="27" cy="10" r="1.7"/><circle class="arc-gold" cx="47" cy="4" r="2.5"/><circle cx="66" cy="8" r="1.8"/><circle cx="84" cy="16" r="1.5"/>
    </svg></div>` : '<div class="header-badge"><img class="mark" src="./assets/icon-192.png" width="52" height="52" alt=""></div>';
  return `<header class="mast"><div class="identity">${badge}
    <div><p class="eyebrow">${esc(content.site.subtitle)}</p><h1>${esc(content.site.name)}</h1></div></div>
    <div class="identity mast-actions">${state.offline ? '<span class="pill" role="status">离线</span>' : ''}
    <a class="about-icon" href="#about" aria-label="缘起">${bookArt(true)}</a></div></header>`;
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
function renderStars(total, photo = false) {
  const config = state.theme?.stars;
  if (!config) return '';
  const [width, height] = config.viewBox;
  const weights = config.weights.reduce((sum, weight) => sum + weight, 0);
  const circles = Array.from({length: Math.floor(Math.max(0,total))}, (_, i) => {
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
    return `<circle class="${gold ? 'gold-star' : 'star'}" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${radius.toFixed(2)}" ${gold ? '' : `fill="${esc(color)}"`} opacity="${(photo ? opacity * .6 : opacity).toFixed(2)}"/>`;
  }).join('');
  return `<svg class="stars" viewBox="0 0 ${width} ${height}" preserveAspectRatio="${photo ? 'none' : 'xMidYMid slice'}" aria-hidden="true">${circles}</svg>`;
}
function renderGalaxy(live, content) {
  const {lifetime, streak} = live;
  const first = lifetime.first_record;
  const elapsed = first ? Math.round((dateValue(live.data_through) - dateValue(first)) / 86400000) + 1 : 0;
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
        <div><span aria-hidden="true">◈</span><span>开始共读 ${first ? dateHTML(first) : '待记录'}</span><strong>${first ? `第 ${n(elapsed)} 天` : '—'}</strong></div>
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
let selectedMonthDate = null;
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
    const response = await loadLive(Date.now());
    if (response.cached || !navigator.onLine) throw new Error('Offline');
    state.live = response.data;
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

function renderToday(live) {
  const {today, yesterday} = live;
  const stale = live.fetched_at && today.date > live.fetched_at.slice(0,10);
  const note = today.read ? '今天已共读' : today.is_partial
    ? (stale ? '暂未同步到今日记录 · 今日未结束' : '今天还没记录 · 今日未结束') : '这一天没有共读记录';
  const column = (day, label, current) => `<div class="today-column${current ? ' is-today' : ''}">
    <span aria-hidden="true">${dayRing(day.minutes,current)}</span>
    <div><b>${label}</b><p><strong>${n(Math.floor(day.minutes))}</strong> 分钟</p></div></div>`;
  return `<section class="panel today" data-rings="today">
    <div class="heading"><h2>今天</h2><div class="today-actions">${dateHTML(today.date, shortDate(today.date))}
      <span class="sync-result" role="status"></span><button class="sync-button" type="button"><span aria-hidden="true">↻</span> 同步</button></div></div>
    <div class="today-columns${yesterday ? ' has-yesterday' : ''}">${column(today,'今天',true)}
      ${yesterday ? column(yesterday,'昨天',false) : ''}</div>
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

function comparison(current, prior, label, monthly = false) {
  if (!prior?.days_elapsed) return `<p class="compare">${label}暂无数据</p>`;
  const diff = Math.round((current.total_minutes - prior.total_minutes) * 100) / 100;
  const change = Math.floor(Math.abs(diff)) ? `${diff > 0 ? '+' : '−'}${minutesLabel(Math.abs(diff))}` : '时长持平';
  const reference = monthly ? `${prior.record_days} 天 · 覆盖率 ${p(prior.coverage)}` :
    `${prior.record_days} 天 · ${minutesLabel(prior.total_minutes)}`;
  return `<p class="compare">${label} ${reference} · ${change}</p>`;
}

function renderWeek(live) {
  const {week, data_through: through} = live;
  const [first,last] = week.range;
  const start = dateValue(first);
  const minutesByDay = new Map(week.days.map((day) => [day.date,day.minutes]));
  const readDays = week.days.filter((day) => day.date <= through && day.minutes >= READING_DAY_MINUTES).length;
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
    ${heading('本周进度',`<span>${dayMonth(first)} – ${dayMonth(last)}</span>`)}
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

function renderMonth(live) {
  const {month, data_through: through} = live;
  const [first,last] = month.range;
  const days = new Map(month.calendar.map((day) => [day.date,day]));
  const start = dateValue(first);
  const count = dateValue(last).getUTCDate();
  const offset = (start.getUTCDay() + 6) % 7;
  if (selectedMonthDate && (selectedMonthDate < first || selectedMonthDate > through)) selectedMonthDate = null;
  const selection = selectedMonthDate ?? through;
  const headers = weekdays.map((day) => `<span class="week-head">${day}</span>`).join('');
  const cells = Array.from({length:count},(_,index) => {
    const date = offsetDate(start,index);
    const day = days.get(date);
    const future = date > through;
    const label = `${shortDate(date)} · ${weekdayLabel(date)} · ${future ? '未到统计日' : minutesLabel(day?.minutes ?? 0)}`;
    return `<button type="button" class="day ${future ? 'future' : `level-${day?.level ?? 0}`}" data-month-date="${date}"
      aria-label="${label}" aria-pressed="${date === selection}"${future ? ' disabled' : ''}>${index + 1}</button>`;
  }).join('');
  return `<section class="panel month">
    ${heading('本月',`<span>${start.getUTCFullYear()} 年 ${start.getUTCMonth() + 1} 月</span>`)}
    <p class="summary"><strong>${month.record_days}</strong><span>天</span><span>覆盖率 ${p(month.coverage)}</span></p>
    <div class="calendar" aria-label="本月共读日历">
      ${headers}${'<span aria-hidden="true"></span>'.repeat(offset)}${cells}</div>
    <p class="reading-detail month-detail" role="status"></p>
    ${comparison(month,month.prev_same_period,'上月同期',true)}
    ${legend()}
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
  return `<section class="panel annual">${heading('每年共读','<span>小时</span>')}
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

function resolve(content, value) {
  const base = content.defaults[value % 100 === 0 ? 'major' : 'minor'];
  const own = content.milestones[value];
  return Object.fromEntries(['badge','celebration','message'].map((key) =>
    [key, (own?.[key] || base?.[key] || '').replaceAll('{hours}', String(value))]));
}
function achievementEntries(live) {
  const entries = new Map(live.milestones_reached.map((milestone) =>
    [milestone.hours, {hours:milestone.hours, date:milestone.date}]));
  if (state.preview) {
    const value = state.preview;
    entries.set(value, {...entries.get(value), hours:value, preview:true,
      eta:live.roadmap.find((station) => station.hours === value)?.eta});
  }
  const next = live.roadmap.find((station) => !station.reached && !entries.has(station.hours));
  if (next) {
    entries.set(next.hours, {hours:next.hours, locked:true, eta:next.eta,
      left:next.hours === live.next.next_milestone_hours ? live.next.hours_to_milestone :
        Math.round((next.hours - live.lifetime.total_hours) * 100) / 100});
  }
  return [...entries.values()].sort((a,b) => a.hours - b.hours);
}
function medal(entry, unit = '小时') {
  const type = entry.locked ? 'locked' : entry.hours % 100 === 0 ? 'major' : 'minor';
  return `<span class="medal ${type}" aria-hidden="true"><span class="medal-star">✦</span><strong>${n(entry.hours)}</strong><small>${esc(unit)}</small></span>`;
}
function renderMedals(live, content) {
  return `<div class="medals">${achievementEntries(live).map((entry) => {
    const copy = resolve(content, entry.hours);
    const status = entry.date ? dateHTML(entry.date) : entry.preview ? '<span class="preview-label">预演</span>' :
      `下一站 · 还差 ${hours(entry.left)}${entry.eta ? `<br>预计 ${dateHTML(entry.eta, dayMonth(entry.eta))}` : ''}`;
    return `<a class="achievement ${entry.locked ? 'is-locked' : 'is-reached'}" data-hours="${entry.hours}" href="${achievementURL(entry.hours)}">
      ${medal(entry)}<b>${esc(copy.badge)}</b><span>${status}</span></a>`;
  }).join('')}</div>`;
}
function renderAchievementBlock(live, content) {
  return `<section class="panel achievement-block">${heading('成就','<a class="text-link" href="#achievements">全部成就 ↗</a>')}
    ${renderMedals(live,content)}</section>`;
}
function renderHeatmap(live, content) {
  const years = Object.entries(live.levels_by_year).filter(([year]) => year >= firstReadingYear(live));
  return `<section class="panel heatmap">${heading('多年热力图','<span>一格一天</span>')}
    <div class="heat-years">${years.map(([year, days]) =>
      `<div class="heat-row"><span>${esc(year)}</span><canvas width="732" height="16" data-year="${esc(year)}" role="img" aria-label="${esc(year)} 年，${(days.match(/[123]/g) || []).length} 个共读日"></canvas></div>`).join('')}</div>
    ${legend()}</section>`;
}
function drawHeatmap(live) {
  const style = getComputedStyle(document.documentElement);
  const palette = levels.map((_, index) => style.getPropertyValue(`--ds-level-${index}`).trim());
  const since = dateValue(live.lifetime.since).getTime();
  for (const canvas of shell.querySelectorAll('.heat-row canvas')) {
    const offset = Math.max(0, Math.round((since - Date.UTC(Number(canvas.dataset.year),0,1)) / 86400000));
    const ctx = canvas.getContext('2d');
    [...live.levels_by_year[canvas.dataset.year]].forEach((level,i) => {
      ctx.fillStyle = palette[Number(level)];
      ctx.fillRect((i + offset) * 2,0,2,canvas.height);
    });
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
  return `<footer class="footer">${content.site.footer_note ? `<p>${esc(content.site.footer_note)}</p>` : ''}
    数据更新于 ${stamp ? dateHTML(fetched,stamp) : '待同步'}
    <span>${live ? `统计截至 ${dateHTML(live.data_through)} · ` : ''}<a class="version-link" href="#diary">v0.1.1</a></span>
    ${analyticsEnabled ? '<span>本站使用无 Cookie 的匿名访问统计</span>' : ''}</footer>`;
}

const backBar = (extra = '') => `<nav class="backbar" aria-label="返回"><a href="#" data-home>‹ 返回首页</a>${extra}
  ${state.offline ? '<span class="pill" role="status">离线</span>' : ''}</nav>`;
function renderPlaceholder(page) {
  const title = page === 'about' ? '缘起' : '开发日记';
  return `${backBar()}<main><section class="panel placeholder-page">
    <h1>${title} · 即将上线</h1>
  </section></main>`;
}
function renderAchievementPage(live, content) {
  return `${backBar()}<main><section class="hero achievement-hero">${renderStars(live.lifetime.total_hours)}
    <div class="hero-content"><p class="eyebrow">共读里程碑</p><h1>全部成就</h1><p>${esc(content.site.galaxy_tagline)}</p></div></section>
    <section class="panel">${heading('共读勋章')}${renderMedals(live,content)}</section></main>`;
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
      const visible = [...shell.querySelectorAll('.header-family img, .photo-avatar-strip img')];
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
  const copy = resolve(content,entry.hours);
  const reached = entry.date || entry.preview;
  const titlePrefix = reached ? '我们读了' : '下一站';
  const badge = copy.badge.trim().replace(/\s+/g, ' ');
  const showBadge = badge && badge !== `${titlePrefix} ${n(entry.hours)} 小时` &&
    badge !== `${titlePrefix} ${entry.hours} 小时`;
  const eta = entry.eta ? `预计 ${dateHTML(entry.eta)} 到站` : '预计日期待定';
  const arrival = entry.date ? `到站于 ${dateHTML(entry.date)}` : eta;
  const photo = content.photo?.[lang] ?? fallback.photo[lang];
  const before = entry.locked ? (lang === 'en' ? 'Next milestone' : '下一站') : photo.before;
  const stars = Math.max(live.lifetime.total_hours, entry.preview ? Math.min(entry.hours, 5000) : 0);
  const faces = celebrationAvatars();
  return `<div class="celebration-nav">${backBar('<a href="#achievements">全部成就</a>')}</div><main>
    <section class="hero celebration ${faces ? '' : 'no-family'}">${renderStars(stars, true)}
      ${entry.preview ? '<span class="preview-label">预演</span>' : ''}
      <a class="photo-back" href="#achievements" aria-label="返回全部成就">‹ ${lang === 'en' ? 'Back' : '返回'}</a>
      <div class="celebration-layout hero-content">
        <div class="photo-feature"><div class="photo-medal">${medal(entry, lang === 'en' ? 'hours' : '小时')}</div>${faces}</div>
        <div class="photo-copy" lang="${lang}">
          <h1><span>${esc(before)}</span><strong class="photo-number">${n(entry.hours)}</strong><span>${esc(photo.after)}</span></h1>
        </div>
        <div class="celebration-copy">
          ${showBadge ? `<p class="eyebrow">${esc(copy.badge)}</p>` : ''}
          <h1>${titlePrefix} <strong>${n(entry.hours)}</strong> 小时</h1>
          <p class="arrival-date">${entry.locked ? `还差 ${hours(entry.left)} · ${eta}` : arrival}</p>
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

const homeBlocks = [renderArrival,renderGalaxy,renderToday,renderNext,renderWeek,renderMonth,
  renderYears,renderConversions,renderAchievementBlock,renderHeatmap,renderModules];
function route() {
  const [path, query] = location.hash.slice(1).split('?');
  const search = new URLSearchParams(location.search);
  const hashSearch = new URLSearchParams(query);
  const requested = Number(hashSearch.get('celebrate') ?? search.get('celebrate'));
  const preview = Number.isSafeInteger(requested) && requested > 0 && requested % 50 === 0 ? requested : null;
  const lang = search.get('lang') === 'en' ? 'en' : 'zh';
  const page = path === 'about' || path === 'diary' ? path : null;
  const match = path.match(/^achievements(?:\/(\d+))?$/);
  const achievement = match?.[1] ? Number(match[1]) : (match || page ? null : preview);
  return {preview, lang, page, achievement, subpage:Boolean(page || match || achievement)};
}
function render({background = false} = {}) {
  const {live,content} = state;
  const current = route();
  if (background && shell.querySelector('.celebration') &&
      shell.dataset.route === String(current.achievement) && shell.dataset.photoLang === current.lang) return;
  state.preview = current.preview;
  const entry = live && current.subpage
    ? achievementEntries(live).find((item) => item.hours === current.achievement) : null;
  if (entry && (entry.hours !== avatarVisit || !content.family?.sets.some((set) => set.id === photoSet))) {
    const warmGroup = !photoSet && content.family?.sets.find((set) => set.id === readerFamily?.group);
    photoSet = (warmGroup || chooseFamilySet())?.id ?? null;
  }
  avatarVisit = entry?.hours ?? null;
  photoObserver?.disconnect();
  ringObserver?.disconnect();
  clearTimeout(backTimer);
  delete shell.dataset.photoLang;
  const previousRoute = shell.dataset.route;
  shell.dataset.page = current.subpage ? 'detail' : 'home';
  shell.dataset.route = current.subpage ? String(current.page ?? current.achievement ?? 'achievements') : 'home';
  document.title = content.site.name;
  document.querySelector('meta[name="apple-mobile-web-app-title"]').content = content.site.short_name || content.site.name;
  if (current.page) {
    shell.innerHTML = renderPlaceholder(current.page);
  } else if (!live) {
    shell.innerHTML = `${renderHeader(live,content)}<main><p class="panel notice" role="status">暂时无法读取共读数据，请联网后重试。</p></main>${renderFooter(live,content)}`;
  } else if (current.subpage) {
    if (entry) {
      shell.dataset.photoLang = current.lang;
      shell.innerHTML = renderCelebrationPage(live,content,entry,current.lang);
      paintMotionState();
      watchPhotoStars();
    } else {
      shell.innerHTML = renderAchievementPage(live,content);
    }
  } else {
    shell.innerHTML = `${renderHeader(live,content)}${ringGradient}<main>${homeBlocks.map((block) => block(live,content)).join('')}</main>${renderFooter(live,content)}`;
    drawHeatmap(live);
    playBeanRoad();
    paintSyncControls();
    for (const section of shell.querySelectorAll('.week, .month')) {
      paintReadingDetail(section,section.querySelector('[aria-pressed="true"]'));
    }
    animateReadingRings();
  }
  if (previousRoute !== shell.dataset.route) window.scrollTo(0,current.subpage ? 0 : homeScroll);
}
shell.addEventListener('error', (event) => {
  if (event.target.matches?.('[data-header-face]') && !headerFamilyFailed) {
    headerFamilyFailed = true;
    render();
    return;
  }
  if (event.target.matches?.('[data-reader-face]') && !readerFaceFailed) {
    readerFaceFailed = true;
    render();
    return;
  }
  const image = event.target;
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
  const dateButton = event.target.closest('button[data-month-date]:not(:disabled)');
  if (dateButton) {
    selectedMonthDate = dateButton.dataset.monthDate;
    selectReadingDay(dateButton.closest('.month'),dateButton);
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
  } else if (link && /^#(?:achievements|about|diary)/.test(link.hash) && shell.dataset.page === 'home') {
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
    const {data} = await jsonResource(`./themes/${id}/theme.json`, (config) => Boolean(config?.stars));
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
  const [live,content,registry] = await Promise.allSettled([
    loadLive(),jsonResource('./content.json',validContent),
    jsonResource('./themes/registry.json',(data) => Array.isArray(data?.themes)),
  ]);
  if (id !== requestId) return;
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
async function start() {
  analyticsEligible = analyticsAllowed();
  if ('serviceWorker' in navigator) {
    const worker = navigator.serviceWorker;
    worker.addEventListener('controllerchange',scheduleFamilyWarmup);
    const workerURL = new URL('./sw.js',location.href).href;
    const controlled = () => worker.controller?.scriptURL === workerURL;
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
  if (document.visibilityState === 'visible' && Date.now() - lastReadAt >= 60000) void update();
}
document.addEventListener('visibilitychange',refreshForeground);
window.addEventListener('pageshow',refreshForeground);
window.addEventListener('online',update);
window.addEventListener('offline',() => { state.offline = true; render({background:true}); });
void start();
