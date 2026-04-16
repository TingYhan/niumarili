const API_BASE = '/api';
const AUTO_SYNC_INTERVAL = 30000;
const SELECTED_USER_STORAGE_KEY = 'overtime_selected_user_id';

let users = [];
let overtimeDataByUser = {};
let announcements = [];
let currentUserId = null;
let currentDate = new Date();
let selectedDate = null;
let adminToken = localStorage.getItem('overtime_admin_token') || '';
let isAdmin = false;
let editingAnnouncementId = null;
let countdownInterval = null;
let currentWallpaperUrl = '';
let currentWallpaperTitle = '';
let lastNormalAnnouncementType = '普通公告';
let wallpaperSourcesCache = [];
let videoSourcesCache = [];
let dailyMediaInitialized = false;
let currentAnnouncementImageDataList = [];
const WALLPAPER_SELECTED_SOURCE_STORAGE_KEY = 'wallpaper_selected_source';
const VIDEO_SELECTED_SOURCE_STORAGE_KEY = 'video_selected_source';
const DAILY_MEDIA_VISIBLE_STORAGE_KEY = 'daily_media_visible';

function getStoredSelectedUserId() {
    const rawValue = localStorage.getItem(SELECTED_USER_STORAGE_KEY);
    const parsedValue = Number(rawValue);
    return Number.isInteger(parsedValue) && parsedValue > 0 ? parsedValue : null;
}

function setStoredSelectedUserId(userId) {
    if (Number.isInteger(userId) && userId > 0) {
        localStorage.setItem(SELECTED_USER_STORAGE_KEY, String(userId));
        return;
    }
    localStorage.removeItem(SELECTED_USER_STORAGE_KEY);
}

function getStoredDailyMediaVisible() {
    return localStorage.getItem(DAILY_MEDIA_VISIBLE_STORAGE_KEY) === '1';
}

function setStoredDailyMediaVisible(visible) {
    if (visible) {
        localStorage.setItem(DAILY_MEDIA_VISIBLE_STORAGE_KEY, '1');
        return;
    }
    localStorage.removeItem(DAILY_MEDIA_VISIBLE_STORAGE_KEY);
}

const dom = {};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderAiDirectory() {
    if (!dom.aiDirectoryGrid) return;

    const groups = Array.isArray(window.AI_DIRECTORY_GROUPS) ? window.AI_DIRECTORY_GROUPS : [];
    if (!groups.length) {
        dom.aiDirectoryGrid.innerHTML = '<div class="list-empty">暂无 AI 工具数据</div>';
        return;
    }

    const groupHtml = groups.map((group) => {
        const title = escapeHtml(group?.title || '未命名分组');
        const items = Array.isArray(group?.items) ? group.items : [];

        const itemsHtml = items.map((item) => {
            const name = escapeHtml(item?.name || '未命名工具');
            const url = escapeHtml(item?.url || '#');
            const desc = escapeHtml(item?.desc || '暂无描述');
            return `
                <div class="ai-item">
                    <div class="ai-item-header">
                        <span class="ai-item-name">${name}</span>
                        <a class="ai-item-link" href="${url}" target="_blank" rel="noopener">官网</a>
                    </div>
                    <div class="ai-item-desc">${desc}</div>
                </div>
            `;
        }).join('');

        return `
            <div class="ai-group-card">
                <div class="ai-group-title">${title}</div>
                <div class="ai-list">${itemsHtml}</div>
            </div>
        `;
    }).join('');

    dom.aiDirectoryGrid.innerHTML = groupHtml;
}

function cacheDom() {
    dom.personSwitchBar = document.getElementById('personSwitchBar');
    dom.adminStatusText = document.getElementById('adminStatusText');
    dom.adminActionBtn = document.getElementById('adminActionBtn');
    dom.manageUsersBtn = document.getElementById('manageUsersBtn');
    dom.openCompareModalBtn = document.getElementById('openCompareModalBtn');
    dom.currentPersonTitle = document.getElementById('currentPersonTitle');
    dom.selectedMonthLabel = document.getElementById('selectedMonthLabel');
    dom.selectedMonthAmountLabel = document.getElementById('selectedMonthAmountLabel');
    dom.selectedMonthDaysLabel = document.getElementById('selectedMonthDaysLabel');
    dom.monthlyTotalMinutes = document.getElementById('monthlyTotalMinutes');
    dom.monthlyAmount = document.getElementById('monthlyAmount');
    dom.overtimeDays = document.getElementById('overtimeDays');
    dom.yearlyAmount = document.getElementById('yearlyAmount');
    dom.prevMonth = document.getElementById('prevMonth');
    dom.nextMonth = document.getElementById('nextMonth');
    dom.monthSelector = document.getElementById('monthSelector');
    dom.calendarDays = document.getElementById('calendarDays');
    dom.selectedDateInfo = document.getElementById('selectedDateInfo');
    dom.overtimeType = document.getElementById('overtimeType');
    dom.startTime = document.getElementById('startTime');
    dom.endTime = document.getElementById('endTime');
    dom.timeDisplay = document.getElementById('timeDisplay');
    dom.salaryDisplay = document.getElementById('salaryDisplay');
    dom.addOvertimeBtn = document.getElementById('addOvertimeBtn');
    dom.clearAllBtn = document.getElementById('clearAllBtn');
    dom.dayTotalAmount = document.getElementById('dayTotalAmount');
    dom.overtimeRecords = document.getElementById('overtimeRecords');
    dom.compareModal = document.getElementById('compareModal');
    dom.compareModalTitle = document.getElementById('compareModalTitle');
    dom.compareModalBody = document.getElementById('compareModalBody');
    dom.adminLoginModal = document.getElementById('adminLoginModal');
    dom.adminLoginForm = document.getElementById('adminLoginForm');
    dom.adminPassword = document.getElementById('adminPassword');
    dom.userManagerModal = document.getElementById('userManagerModal');
    dom.addUserForm = document.getElementById('addUserForm');
    dom.newUserName = document.getElementById('newUserName');
    dom.userManagerList = document.getElementById('userManagerList');
    dom.bannerLeft = document.getElementById('bannerLeft');
    dom.bannerRight = document.getElementById('bannerRight');
    dom.announcementList = document.getElementById('announcementList');
    dom.addAnnouncementBtn = document.getElementById('addAnnouncementBtn');
    dom.editBannerModal = document.getElementById('editBannerModal');
    dom.editBannerForm = document.getElementById('editBannerForm');
    dom.bannerType = document.getElementById('bannerType');
    dom.bannerContent = document.getElementById('bannerContent');
    dom.announcementModal = document.getElementById('announcementModal');
    dom.announcementForm = document.getElementById('announcementForm');
    dom.announcementCategory = document.getElementById('announcementCategory');
    dom.announcementTypeGroup = document.getElementById('announcementTypeGroup');
    dom.announcementType = document.getElementById('announcementType');
    dom.announcementTypeLabel = document.getElementById('announcementTypeLabel');
    dom.announcementTypeHint = document.getElementById('announcementTypeHint');
    dom.announcementContentLabel = document.getElementById('announcementContentLabel');
    dom.announcementContent = document.getElementById('announcementContent');
    dom.announcementImage = document.getElementById('announcementImage');
    dom.announcementImageDropzone = document.getElementById('announcementImageDropzone');
    dom.announcementImagePreviewWrap = document.getElementById('announcementImagePreviewWrap');
    dom.announcementImagePreviewPlaceholder = document.getElementById('announcementImagePreviewPlaceholder');
    dom.announcementImagePreviewList = document.getElementById('announcementImagePreviewList');
    dom.announcementImageZoomModal = document.getElementById('announcementImageZoomModal');
    dom.announcementImageZoom = document.getElementById('announcementImageZoom');
    dom.countdownCard = document.getElementById('countdownCard');
    dom.countdownLabel = document.getElementById('countdownLabel');
    dom.countdownTimer = document.getElementById('countdownTimer');
    dom.countdownSublabel = document.getElementById('countdownSublabel');
    dom.wallpaperSource = document.getElementById('wallpaperSource');
    dom.refreshWallpaperBtn = document.getElementById('refreshWallpaperBtn');
    dom.viewWallpaperBtn = document.getElementById('viewWallpaperBtn');
    dom.downloadWallpaperBtn = document.getElementById('downloadWallpaperBtn');
    dom.dailyWallpaperImage = document.getElementById('dailyWallpaperImage');
    dom.wallpaperMeta = document.getElementById('wallpaperMeta');
    dom.dailyVideoPlayer = document.getElementById('dailyVideoPlayer');
    dom.videoMeta = document.getElementById('videoMeta');
    dom.videoSource = document.getElementById('videoSource');
    dom.refreshVideoBtn = document.getElementById('refreshVideoBtn');
    dom.dailyQuoteContent = document.getElementById('dailyQuoteContent');
    dom.dailyQuoteFrom = document.getElementById('dailyQuoteFrom');
    dom.refreshQuoteBtn = document.getElementById('refreshQuoteBtn');
    dom.aiDirectoryGrid = document.getElementById('aiDirectoryGrid');
    dom.dailyMediaSection = document.getElementById('dailyMediaSection');
    dom.toggleDailyMediaBtn = document.getElementById('toggleDailyMediaBtn');
}

function updateDailyMediaVisibility(visible) {
    if (!dom.dailyMediaSection || !dom.toggleDailyMediaBtn) return;
    dom.dailyMediaSection.classList.toggle('is-hidden', !visible);
    dom.toggleDailyMediaBtn.textContent = visible ? '隐藏每日内容' : '显示每日内容';
    dom.toggleDailyMediaBtn.setAttribute('aria-expanded', visible ? 'true' : 'false');
}

function resetAnnouncementImageState() {
    currentAnnouncementImageDataList = [];
    if (dom.announcementImage) {
        dom.announcementImage.value = '';
    }
    if (dom.announcementImagePreviewWrap) {
        dom.announcementImagePreviewWrap.style.display = 'none';
    }
    if (dom.announcementImagePreviewPlaceholder) {
        dom.announcementImagePreviewPlaceholder.style.display = '';
    }
    if (dom.announcementImagePreviewList) {
        dom.announcementImagePreviewList.innerHTML = '';
    }
}

function normalizeAnnouncementImageList(value) {
    if (!value) return [];
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string' && item.trim());
    }

    const rawValue = String(value).trim();
    if (!rawValue) return [];

    try {
        const parsed = JSON.parse(rawValue);
        if (Array.isArray(parsed)) {
            return parsed.filter((item) => typeof item === 'string' && item.trim());
        }
    } catch {
        // Fall back to legacy single-image format.
    }

    return [rawValue];
}

function renderAnnouncementImagePreview() {
    if (!dom.announcementImagePreviewWrap || !dom.announcementImagePreviewList || !dom.announcementImagePreviewPlaceholder) {
        return;
    }

    if (!currentAnnouncementImageDataList.length) {
        dom.announcementImagePreviewWrap.style.display = 'none';
        dom.announcementImagePreviewPlaceholder.style.display = '';
        dom.announcementImagePreviewList.innerHTML = '';
        return;
    }

    dom.announcementImagePreviewWrap.style.display = '';
    dom.announcementImagePreviewPlaceholder.style.display = 'none';
    dom.announcementImagePreviewList.innerHTML = currentAnnouncementImageDataList.map((src, index) => `
        <button type="button" class="announcement-image-thumb" data-image-src="${src}" data-image-index="${index}" title="点击放大查看">
            <img src="${src}" alt="公告图片 ${index + 1}" loading="lazy">
            ${currentAnnouncementImageDataList.length > 1 ? `<span class="image-count-badge">${index + 1}/${currentAnnouncementImageDataList.length}</span>` : ''}
        </button>
    `).join('');
}

function openAnnouncementImageZoom(imageSrc) {
    if (!dom.announcementImageZoomModal || !dom.announcementImageZoom) return;
    dom.announcementImageZoom.src = imageSrc;
    openModal('announcementImageZoomModal');
}

async function filesToDataUrls(files) {
    const fileList = Array.from(files || []);
    if (!fileList.length) return [];

    if (fileList.length > 5) {
        alert('最多一次上传 5 张图片');
        return [];
    }

    const validFiles = [];
    for (const file of fileList) {
        if (!file.type.startsWith('image/')) {
            alert('请选择图片文件');
            return [];
        }
        if (file.size > 1.5 * 1024 * 1024) {
            alert('图片不能超过 1.5MB');
            return [];
        }
        validFiles.push(file);
    }

    const readers = validFiles.map((file) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(new Error('图片读取失败'));
        reader.readAsDataURL(file);
    }));

    return Promise.all(readers);
}

async function ensureDailyMediaLoaded() {
    if (dailyMediaInitialized) return;
    await loadWallpaperSources({ silent: true }).catch(() => {});
    await loadVideoSources({ silent: true }).catch(() => {});
    await Promise.allSettled([
        loadWallpaper({ silent: true }),
        loadVideo({ silent: true })
    ]);
    dailyMediaInitialized = true;
}

function getCurrentUser() {
    return users.find((user) => user.id === currentUserId) || null;
}

function getCurrentUserData() {
    return overtimeDataByUser[String(currentUserId)] || {};
}

function setAdminToken(token) {
    adminToken = token || '';
    if (adminToken) {
        localStorage.setItem('overtime_admin_token', adminToken);
        return;
    }
    localStorage.removeItem('overtime_admin_token');
}

async function apiFetch(path, options = {}, config = {}) {
    const { silent = false } = config;
    const headers = new Headers(options.headers || {});
    let body = options.body;

    if (body && typeof body === 'object' && !(body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
    }

    if (adminToken) {
        headers.set('Authorization', `Bearer ${adminToken}`);
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        body
    });

    let payload = null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
        payload = await response.json();
    } else if (response.status !== 204) {
        payload = await response.text();
    }

    if (!response.ok) {
        const errorMessage = payload && typeof payload === 'object' ? payload.error : '请求失败';
        if (response.status === 401) {
            setAdminToken('');
            isAdmin = false;
            updateAdminUI();
        }
        if (!silent) {
            alert(errorMessage || '请求失败');
        }
        throw new Error(errorMessage || '请求失败');
    }

    return payload;
}

function formatMonthInput(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatAmount(amount) {
    const parsed = Number(amount) || 0;
    return parsed.toFixed(2);
}

function formatMinutes(minutes) {
    const parsed = Number(minutes);
    if (!parsed || parsed <= 0) return '0分钟';
    const hours = Math.floor(parsed / 60);
    const mins = parsed % 60;
    if (hours === 0) return `${mins}分钟`;
    if (mins === 0) return `${hours}小时`;
    return `${hours}小时${mins}分钟`;
}

function formatMinutesShort(minutes) {
    const parsed = Number(minutes);
    if (!parsed || parsed <= 0) return '0分钟';
    const hours = Math.floor(parsed / 60);
    const mins = parsed % 60;
    if (hours === 0) return `${mins}分钟`;
    if (mins === 0) return `${hours}小时`;
    return `${hours}小时${mins}分`;
}

function calculateTimeDifference(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end < start) end += 24 * 60;
    return end - start;
}

function calculateOvertimeAmountByRange(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end < start) end += 24 * 60;

    const billingStart = 17 * 60 + 30;
    const effectiveStart = Math.max(start, billingStart);
    const billableMinutes = Math.max(0, end - effectiveStart);
    const blocks = Math.floor(billableMinutes / 20);
    return (blocks * 5).toFixed(2);
}

function calculateOvertimeAmount(minutes, startTime, endTime) {
    if (startTime && endTime) {
        return calculateOvertimeAmountByRange(startTime, endTime);
    }
    const blocks = Math.floor((Number(minutes) || 0) / 20);
    return (blocks * 5).toFixed(2);
}

function getWeekRange(refDate = new Date()) {
    const today = new Date(refDate);
    const dayOfWeek = today.getDay();
    const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const monday = new Date(today);
    monday.setDate(today.getDate() - diffToMonday);
    monday.setHours(0, 0, 0, 0);
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    sunday.setHours(23, 59, 59, 999);
    return { start: monday, end: sunday };
}

function getMonthRange(year, month) {
    return {
        start: new Date(year, month, 1, 0, 0, 0, 0),
        end: new Date(year, month + 1, 0, 23, 59, 59, 999)
    };
}

function getYearRange(year) {
    return {
        start: new Date(year, 0, 1, 0, 0, 0, 0),
        end: new Date(year, 11, 31, 23, 59, 59, 999)
    };
}

function getUserTotalMinutesBetween(userId, startDate, endDate) {
    const userData = overtimeDataByUser[String(userId)] || {};
    let total = 0;
    Object.entries(userData).forEach(([dateKey, records]) => {
        const recordDate = new Date(`${dateKey}T00:00:00`);
        if (Number.isNaN(recordDate.getTime())) return;
        if (recordDate >= startDate && recordDate <= endDate) {
            total += records.reduce((sum, record) => sum + (Number(record.minutes) || 0), 0);
        }
    });
    return total;
}

function getUserTotalAmountBetween(userId, startDate, endDate) {
    const userData = overtimeDataByUser[String(userId)] || {};
    let total = 0;
    Object.entries(userData).forEach(([dateKey, records]) => {
        const recordDate = new Date(`${dateKey}T00:00:00`);
        if (Number.isNaN(recordDate.getTime())) return;
        if (recordDate >= startDate && recordDate <= endDate) {
            total += records.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
        }
    });
    return total;
}

function getStarOfPeriod(rangeGetter, ...args) {
    if (!users.length) {
        return { person: '暂无', minutes: 0, amount: '0.00' };
    }

    const { start, end } = rangeGetter(...args);
    let bestUser = users[0];
    let bestMinutes = getUserTotalMinutesBetween(bestUser.id, start, end);

    users.forEach((user) => {
        const totalMinutes = getUserTotalMinutesBetween(user.id, start, end);
        if (totalMinutes > bestMinutes) {
            bestMinutes = totalMinutes;
            bestUser = user;
        }
    });

    return {
        person: bestUser?.name || '暂无',
        minutes: bestMinutes,
        amount: formatAmount(getUserTotalAmountBetween(bestUser.id, start, end)),
        start,
        end
    };
}

function getAllUsersStats(year, month) {
    const stats = {};
    users.forEach((user) => {
        const rawData = overtimeDataByUser[String(user.id)] || {};
        let monthMinutes = 0;
        let monthAmount = 0;
        let overtimeDays = 0;
        let yearAmount = 0;

        Object.entries(rawData).forEach(([dateKey, records]) => {
            const date = new Date(`${dateKey}T00:00:00`);
            if (Number.isNaN(date.getTime())) return;
            const dayMinutes = records.reduce((sum, record) => sum + (Number(record.minutes) || 0), 0);
            const dayAmount = records.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
            if (date.getFullYear() === year && date.getMonth() === month) {
                monthMinutes += dayMinutes;
                monthAmount += dayAmount;
                if (records.length > 0) overtimeDays += 1;
            }
            if (date.getFullYear() === year) {
                yearAmount += dayAmount;
            }
        });

        stats[user.id] = {
            monthMinutes,
            monthAmount: formatAmount(monthAmount),
            overtimeDays,
            yearAmount: formatAmount(yearAmount)
        };
    });
    return stats;
}

function updateResultDisplay() {
    const start = dom.startTime.value;
    const end = dom.endTime.value;
    if (!start || !end) {
        dom.timeDisplay.innerText = '0分钟';
        dom.salaryDisplay.innerText = '0.00元';
        return;
    }

    const minutes = calculateTimeDifference(start, end);
    if (minutes <= 0) {
        dom.timeDisplay.innerText = '0分钟';
        dom.salaryDisplay.innerText = '0.00元';
        return;
    }

    dom.timeDisplay.innerText = formatMinutes(minutes);
    dom.salaryDisplay.innerText = `${calculateOvertimeAmount(minutes, start, end)}元`;
}

function applyWallpaperToBackground(url) {
    if (!url) {
        document.body.style.backgroundImage = 'linear-gradient(135deg, #f5f7fb 0%, #eef1f7 100%)';
        return;
    }

    const safeUrl = String(url).replace(/"/g, '\\"');
    document.body.style.backgroundImage = `linear-gradient(rgba(245, 247, 251, 0.72), rgba(238, 241, 247, 0.72)), url("${safeUrl}")`;
}

function getStoredWallpaperSourceId() {
    const value = localStorage.getItem(WALLPAPER_SELECTED_SOURCE_STORAGE_KEY);
    return value ? String(value) : '';
}

function setStoredWallpaperSourceId(sourceId) {
    const value = String(sourceId || '').trim();
    if (value) {
        localStorage.setItem(WALLPAPER_SELECTED_SOURCE_STORAGE_KEY, value);
        return;
    }
    localStorage.removeItem(WALLPAPER_SELECTED_SOURCE_STORAGE_KEY);
}

function getStoredVideoSourceId() {
    const value = localStorage.getItem(VIDEO_SELECTED_SOURCE_STORAGE_KEY);
    return value ? String(value) : '';
}

function setStoredVideoSourceId(sourceId) {
    const value = String(sourceId || '').trim();
    if (value) {
        localStorage.setItem(VIDEO_SELECTED_SOURCE_STORAGE_KEY, value);
        return;
    }
    localStorage.removeItem(VIDEO_SELECTED_SOURCE_STORAGE_KEY);
}

async function loadVideoSources({ silent = true } = {}) {
    if (!dom.videoSource) return;

    const payload = await apiFetch('/external/video/sources', {}, { silent });
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    videoSourcesCache = sources;
    const storedSourceId = getStoredVideoSourceId();

    dom.videoSource.innerHTML = '<option value="">自动选择（按顺序）</option>';
    sources.forEach((source) => {
        const option = document.createElement('option');
        option.value = String(source.id || '');
        option.textContent = String(source.name || source.id || '未命名视频源');
        dom.videoSource.appendChild(option);
    });

    if (storedSourceId && sources.some((source) => String(source.id || '') === storedSourceId)) {
        dom.videoSource.value = storedSourceId;
    } else {
        dom.videoSource.value = '';
        if (storedSourceId) setStoredVideoSourceId('');
    }

    dom.videoSource.disabled = false;
    await refreshVideoSourceHealth({ silent: true }).catch(() => {});
}

async function refreshVideoSourceHealth({ silent = true } = {}) {
    if (!dom.videoSource) return;

    const payload = await apiFetch('/external/video/health', {}, { silent });
    const healthItems = Array.isArray(payload?.sources) ? payload.sources : [];
    const healthMap = new Map(healthItems.map((item) => [String(item.id || ''), Boolean(item.ok)]));
    const nameMap = new Map((videoSourcesCache || []).map((source) => [String(source.id || ''), String(source.name || source.id || '未命名视频源')]));

    Array.from(dom.videoSource.options).forEach((option) => {
        if (!option.value) {
            option.textContent = '自动选择（按顺序）';
            return;
        }

        const sourceId = String(option.value || '');
        const sourceName = nameMap.get(sourceId) || option.textContent.replace(/^[●○]\s+/, '');
        if (!healthMap.has(sourceId)) {
            option.textContent = `○ ${sourceName}`;
            return;
        }

        const ok = healthMap.get(sourceId);
        option.textContent = `${ok ? '●' : '○'} ${sourceName}`;
    });
}

async function loadWallpaperSources({ silent = true } = {}) {
    if (!dom.wallpaperSource) return;

    const payload = await apiFetch('/external/wallpaper/sources', {}, { silent });
    const sources = Array.isArray(payload?.sources) ? payload.sources : [];
    wallpaperSourcesCache = sources;
    const storedSourceId = getStoredWallpaperSourceId();

    dom.wallpaperSource.innerHTML = '<option value="">自动选择（按顺序）</option>';
    sources.forEach((source) => {
        const option = document.createElement('option');
        option.value = String(source.id || '');
        option.textContent = String(source.name || source.id || '未命名图源');
        dom.wallpaperSource.appendChild(option);
    });

    if (storedSourceId && sources.some((source) => String(source.id || '') === storedSourceId)) {
        dom.wallpaperSource.value = storedSourceId;
    } else {
        dom.wallpaperSource.value = '';
        if (storedSourceId) setStoredWallpaperSourceId('');
    }

    dom.wallpaperSource.disabled = false;
    await refreshWallpaperSourceHealth({ silent: true }).catch(() => {});
}

async function refreshWallpaperSourceHealth({ silent = true } = {}) {
    if (!dom.wallpaperSource) return;

    const payload = await apiFetch('/external/wallpaper/health', {}, { silent });
    const healthItems = Array.isArray(payload?.sources) ? payload.sources : [];
    const healthMap = new Map(healthItems.map((item) => [String(item.id || ''), Boolean(item.ok)]));
    const nameMap = new Map((wallpaperSourcesCache || []).map((source) => [String(source.id || ''), String(source.name || source.id || '未命名图源')]));

    Array.from(dom.wallpaperSource.options).forEach((option) => {
        if (!option.value) {
            option.textContent = '自动选择（按顺序）';
            return;
        }

        const sourceId = String(option.value || '');
        const sourceName = nameMap.get(sourceId) || option.textContent.replace(/^[●○]\s+/, '');
        if (!healthMap.has(sourceId)) {
            option.textContent = `○ ${sourceName}`;
            return;
        }

        const ok = healthMap.get(sourceId);
        option.textContent = `${ok ? '●' : '○'} ${sourceName}`;
    });
}

async function loadWallpaper({ silent = true } = {}) {
    if (!dom.wallpaperMeta) return;

    const selectedSourceId = String(dom.wallpaperSource?.value || '').trim();
    const params = new URLSearchParams();
    if (selectedSourceId) {
        params.set('source', selectedSourceId);
    }

    const payload = await apiFetch(`/external/wallpaper?${params.toString()}`, {}, { silent });
    const wallpaperUrl = payload?.proxyUrl || payload?.url4k || payload?.url || '';
    const title = payload?.title || '每日壁纸';
    const copyright = payload?.copyright || '';
    const source = payload?.source || '未知来源';

    currentWallpaperUrl = wallpaperUrl;
    currentWallpaperTitle = title;

    if (dom.dailyWallpaperImage) {
        dom.dailyWallpaperImage.src = wallpaperUrl || '';
        dom.dailyWallpaperImage.alt = title || '每日壁纸预览';
    }

    dom.wallpaperMeta.innerText = `${source} | ${title}${copyright ? ` | ${copyright}` : ''}`;
}

async function loadVideo({ silent = true } = {}) {
    if (!dom.dailyVideoPlayer || !dom.videoMeta) return;

    const selectedSourceId = String(dom.videoSource?.value || '').trim();
    const params = new URLSearchParams();
    if (selectedSourceId) {
        params.set('source', selectedSourceId);
    }

    const payload = await apiFetch(`/external/video?${params.toString()}`, {}, { silent });
    const videoUrl = payload?.url || '';
    const title = payload?.title || '每日视频';
    const source = payload?.source || '未知来源';

    if (dom.dailyVideoPlayer && dom.dailyVideoPlayer.querySelector('source')) {
        dom.dailyVideoPlayer.querySelector('source').src = videoUrl;
        dom.dailyVideoPlayer.load();
    }

    dom.videoMeta.innerText = `${source} | ${title}`;
}

async function loadDailyQuote({ silent = true } = {}) {
    if (!dom.dailyQuoteContent || !dom.dailyQuoteFrom) return;

    const payload = await apiFetch('/external/hitokoto', {}, { silent });
    const content = payload?.content || '今天也要加油。';
    const from = payload?.from || '每日一言';
    const fromWho = payload?.fromWho ? ` · ${payload.fromWho}` : '';

    dom.dailyQuoteContent.innerText = `“${content}”`;
    dom.dailyQuoteFrom.innerText = `—— ${from}${fromWho}`;
}

function openCurrentWallpaper() {
    if (!currentWallpaperUrl) {
        alert('当前暂无可查看的壁纸');
        return;
    }
    window.open(currentWallpaperUrl, '_blank', 'noopener');
}

function downloadCurrentWallpaper() {
    if (!currentWallpaperUrl) {
        alert('当前暂无可下载的壁纸');
        return;
    }

    const link = document.createElement('a');
    link.href = currentWallpaperUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.download = `${(currentWallpaperTitle || 'daily-wallpaper').replace(/\s+/g, '-')}.jpg`;
    document.body.appendChild(link);
    link.click();
    link.remove();
}

function updateAdminUI() {
    dom.adminStatusText.innerText = isAdmin ? '管理员已登录' : '普通访客';
    dom.adminActionBtn.innerHTML = isAdmin
        ? '<i class="fas fa-right-from-bracket"></i> 管理员退出'
        : '<i class="fas fa-lock"></i> 管理员登录';
    dom.manageUsersBtn.classList.toggle('hide', !isAdmin);
    dom.addAnnouncementBtn.style.display = isAdmin ? 'inline-flex' : 'none';
    dom.bannerLeft.style.opacity = isAdmin ? '0.8' : '1';
    dom.bannerRight.style.opacity = isAdmin ? '0.8' : '1';
    dom.bannerLeft.style.cursor = isAdmin ? 'pointer' : 'not-allowed';
    dom.bannerRight.style.cursor = isAdmin ? 'pointer' : 'not-allowed';
}

function updateActionAvailability() {
    const hasUsers = users.length > 0 && getCurrentUser();
    dom.openCompareModalBtn.disabled = !users.length;
    dom.addOvertimeBtn.disabled = !hasUsers;
    dom.clearAllBtn.disabled = !hasUsers;
    dom.prevMonth.disabled = !hasUsers;
    dom.nextMonth.disabled = !hasUsers;
    dom.monthSelector.disabled = !hasUsers;
}

function buildUserButtons() {
    dom.personSwitchBar.innerHTML = '';

    if (!users.length) {
        dom.personSwitchBar.innerHTML = '<div class="list-empty" style="width:100%;">暂无用户，请先以管理员身份添加用户</div>';
        return;
    }

    users.forEach((user) => {
        const button = document.createElement('button');
        button.className = `person-btn ${user.id === currentUserId ? 'active' : ''}`;
        button.dataset.userId = String(user.id);
        button.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(user.name)}`;
        button.addEventListener('click', () => switchUser(user.id));
        dom.personSwitchBar.appendChild(button);
    });
}

function switchUser(userId) {
    if (userId === currentUserId) return;
    currentUserId = userId;
    setStoredSelectedUserId(userId);
    renderAll();
}

function updatePersonTitle() {
    const user = getCurrentUser();
    dom.currentPersonTitle.innerHTML = user ? `👤 ${escapeHtml(user.name)} · 加班统计` : '👤 暂无用户';
}

function updateStats() {
    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthLabel = `${year}年${month + 1}月`;
    dom.selectedMonthLabel.innerText = `${monthLabel}加班总时长`;
    dom.selectedMonthAmountLabel.innerText = `${monthLabel}加班薪资`;
    dom.selectedMonthDaysLabel.innerText = `${monthLabel}加班天数`;

    const userData = getCurrentUserData();
    let monthlyMinutes = 0;
    let monthlyAmount = 0;
    let overtimeDays = 0;
    let yearlyAmount = 0;

    Object.entries(userData).forEach(([dateKey, records]) => {
        const date = new Date(`${dateKey}T00:00:00`);
        if (Number.isNaN(date.getTime())) return;
        const dayMinutes = records.reduce((sum, record) => sum + (Number(record.minutes) || 0), 0);
        const dayAmount = records.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
        if (date.getFullYear() === year && date.getMonth() === month) {
            monthlyMinutes += dayMinutes;
            monthlyAmount += dayAmount;
            if (records.length > 0) overtimeDays += 1;
        }
        if (date.getFullYear() === year) {
            yearlyAmount += dayAmount;
        }
    });

    dom.monthlyTotalMinutes.innerText = String(monthlyMinutes);
    dom.monthlyAmount.innerText = formatAmount(monthlyAmount);
    dom.overtimeDays.innerText = String(overtimeDays);
    dom.yearlyAmount.innerText = formatAmount(yearlyAmount);
}

function updateCalendar() {
    dom.calendarDays.innerHTML = '';

    if (!getCurrentUser()) {
        dom.calendarDays.innerHTML = '<div class="calendar-empty">暂无用户可显示日历</div>';
        return;
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const firstWeekday = firstDay.getDay();
    const prevMonthDays = new Date(year, month, 0).getDate();
    const currentUserData = getCurrentUserData();

    for (let i = firstWeekday - 1; i >= 0; i -= 1) {
        const div = document.createElement('div');
        div.className = 'day other-month';
        div.textContent = String(prevMonthDays - i);
        dom.calendarDays.appendChild(div);
    }

    const today = new Date();
    const isCurrentMonthYear = today.getFullYear() === year && today.getMonth() === month;

    for (let day = 1; day <= lastDay.getDate(); day += 1) {
        const dateKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayDiv = document.createElement('div');
        dayDiv.className = 'day';

        const numberSpan = document.createElement('div');
        numberSpan.className = 'day-number';
        numberSpan.textContent = String(day);
        dayDiv.appendChild(numberSpan);

        if (isCurrentMonthYear && day === today.getDate()) {
            dayDiv.classList.add('today');
        }

        const records = currentUserData[dateKey] || [];
        if (records.length > 0) {
            const indicator = document.createElement('div');
            indicator.className = 'overtime-indicator';
            dayDiv.appendChild(indicator);

            const totalAmount = records.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
            const badge = document.createElement('div');
            badge.className = 'day-amount';
            badge.textContent = `${formatAmount(totalAmount)}元`;
            dayDiv.appendChild(badge);
        }

        if (
            selectedDate &&
            selectedDate.getFullYear() === year &&
            selectedDate.getMonth() === month &&
            selectedDate.getDate() === day
        ) {
            dayDiv.classList.add('selected');
        }

        dayDiv.addEventListener('click', () => selectDate(new Date(year, month, day)));
        dayDiv.addEventListener('dblclick', (event) => {
            event.stopPropagation();
            clearDayByDoubleClick(new Date(year, month, day));
        });
        dom.calendarDays.appendChild(dayDiv);
    }

    const totalCells = 42;
    const remaining = totalCells - (firstWeekday + lastDay.getDate());
    for (let i = 1; i <= remaining; i += 1) {
        const div = document.createElement('div');
        div.className = 'day other-month';
        div.textContent = String(i);
        dom.calendarDays.appendChild(div);
    }
}

function updateSelectedDateInfo() {
    if (!selectedDate || !getCurrentUser()) {
        dom.selectedDateInfo.innerText = '未选择日期';
        return;
    }
    dom.selectedDateInfo.innerText = selectedDate.toLocaleDateString('zh-CN', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
    });
}

function updateOvertimeList() {
    if (!getCurrentUser()) {
        dom.overtimeRecords.innerHTML = '<div class="list-empty">暂无用户，请管理员先添加用户</div>';
        dom.dayTotalAmount.innerText = '';
        return;
    }

    if (!selectedDate) {
        dom.overtimeRecords.innerHTML = '<div class="list-empty">请选择日期</div>';
        dom.dayTotalAmount.innerText = '';
        return;
    }

    const dateKey = getDateKey(selectedDate);
    const records = getCurrentUserData()[dateKey] || [];
    if (!records.length) {
        dom.overtimeRecords.innerHTML = '<div class="list-empty">当天暂无加班记录</div>';
        dom.dayTotalAmount.innerText = '';
        return;
    }

    let dayMinutes = 0;
    let dayAmount = 0;
    let html = '';

    records.forEach((record) => {
        const minutes = Number(record.minutes) || 0;
        const amount = Number(record.amount) || 0;
        dayMinutes += minutes;
        dayAmount += amount;
        html += `
            <div class="overtime-item">
                <div class="overtime-item-header">
                    <span class="overtime-type">${escapeHtml(record.type)}</span>
                    <div><span>${formatMinutes(minutes)}</span> | <span>${formatAmount(amount)}元</span></div>
                </div>
                <div class="overtime-time-range">${escapeHtml(record.startTime)} - ${escapeHtml(record.endTime)}</div>
                <button class="btn btn-delete record-delete-btn" data-record-id="${record.id}" style="margin-top:8px; padding:4px 12px;">删除</button>
            </div>`;
    });

    dom.overtimeRecords.innerHTML = html;
    dom.dayTotalAmount.innerText = `总计: ${formatMinutes(dayMinutes)} | ${formatAmount(dayAmount)}元`;
}

function updateCountdown() {
    // 清理旧的倒计时
    if (countdownInterval) {
        clearInterval(countdownInterval);
        countdownInterval = null;
    }

    if (!getCurrentUser() || !selectedDate) {
        dom.countdownCard.style.display = 'none';
        return;
    }

    // 判断是否是今天
    const today = new Date();
    const isTodaySelected = selectedDate.getFullYear() === today.getFullYear() &&
                            selectedDate.getMonth() === today.getMonth() &&
                            selectedDate.getDate() === today.getDate();

    if (!isTodaySelected) {
        dom.countdownCard.style.display = 'none';
        return;
    }

    // 获取当天加班记录，计算结束时间
    const dateKey = getDateKey(selectedDate);
    const records = getCurrentUserData()[dateKey] || [];
    let endTime = '17:10'; // 默认下班时间

    if (records.length > 0) {
        // 使用最后一条记录的结束时间
        endTime = records[records.length - 1].endTime;
        dom.countdownLabel.innerText = '加班倒计时';
        dom.countdownSublabel.innerText = `从 ${endTime} 开始下班`;
    } else {
        dom.countdownLabel.innerText = '距离下班倒计时';
        dom.countdownSublabel.innerText = '默认下班时间 17:10';
    }

    // 显示倒计时卡片
    dom.countdownCard.style.display = 'block';

    // 更新倒计时函数
    function updateTimer() {
        const now = new Date();
        const targetTime = new Date(
            today.getFullYear(),
            today.getMonth(),
            today.getDate(),
            parseInt(endTime.split(':')[0]),
            parseInt(endTime.split(':')[1]),
            0
        );

        let totalSeconds;
        if (now >= targetTime) {
            // 已经下班了
            totalSeconds = 0;
            dom.countdownTimer.style.color = '#4CAF50';
            dom.countdownTimer.innerText = '已下班';
        } else {
            totalSeconds = Math.floor((targetTime - now) / 1000);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            const seconds = totalSeconds % 60;
            dom.countdownTimer.style.color = 'white';
            dom.countdownTimer.innerText = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
        }
    }

    // 立即执行一次
    updateTimer();

    // 每秒更新一次
    countdownInterval = setInterval(updateTimer, 1000);
}

function selectDate(date) {
    selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    updateCalendar();
    updateOvertimeList();
    updateSelectedDateInfo();
    updateCountdown();
}

function renderUserManager() {
    if (!users.length) {
        dom.userManagerList.innerHTML = '<div class="list-empty">暂无用户</div>';
        return;
    }

    dom.userManagerList.innerHTML = users.map((user) => `
        <div class="user-manager-item">
            <div>
                <div class="user-manager-name">${escapeHtml(user.name)}</div>
                <div class="helper-text">用户 ID：${user.id}</div>
            </div>
            <div class="user-manager-actions">
                <button class="btn btn-rename rename-user-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(user.name)}" ${!isAdmin ? 'disabled' : ''}>重命名</button>
                <button class="btn btn-delete delete-user-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(user.name)}" ${!isAdmin ? 'disabled' : ''}>删除</button>
            </div>
        </div>`).join('');
}

function renderCompareModal() {
    if (!users.length) {
        dom.compareModalBody.innerHTML = '<div class="list-empty">暂无用户可对比</div>';
        dom.compareModalTitle.innerHTML = '<i class="fas fa-users"></i> 人员数据对比 & 加班之星';
        return;
    }

    const year = currentDate.getFullYear();
    const month = currentDate.getMonth();
    const monthLabel = `${year}年${month + 1}月`;
    const stats = getAllUsersStats(year, month);
    const weekRange = getWeekRange(new Date());
    const weekStar = getStarOfPeriod(() => getWeekRange(new Date()));
    const monthStar = getStarOfPeriod((selectedYear, selectedMonth) => getMonthRange(selectedYear, selectedMonth), year, month);
    const yearStar = getStarOfPeriod((selectedYear) => getYearRange(selectedYear), year);

    dom.compareModalTitle.innerHTML = `<i class="fas fa-users"></i> ${escapeHtml(users.map((user) => user.name).join(' · '))} 数据对比 & 加班之星`;

    let html = `
        <div class="star-cards">
            <div class="star-card">
                <div class="star-icon"><i class="fas fa-calendar-week"></i></div>
                <div class="star-title">🏆 本周加班之星</div>
                <div class="star-person">${escapeHtml(weekStar.person)}</div>
                <div class="star-detail">${formatMinutesShort(weekStar.minutes)} (${weekStar.amount}元)</div>
                <div class="star-period">${weekRange.start.toLocaleDateString()} - ${weekRange.end.toLocaleDateString()}</div>
            </div>
            <div class="star-card">
                <div class="star-icon"><i class="fas fa-calendar-alt"></i></div>
                <div class="star-title">🏆 本月加班之星</div>
                <div class="star-person">${escapeHtml(monthStar.person)}</div>
                <div class="star-detail">${formatMinutesShort(monthStar.minutes)} (${monthStar.amount}元)</div>
                <div class="star-period">${monthLabel}</div>
            </div>
            <div class="star-card">
                <div class="star-icon"><i class="fas fa-calendar"></i></div>
                <div class="star-title">🏆 年度加班之星</div>
                <div class="star-person">${escapeHtml(yearStar.person)}</div>
                <div class="star-detail">${formatMinutesShort(yearStar.minutes)} (${yearStar.amount}元)</div>
                <div class="star-period">${year}年</div>
            </div>
        </div>
        <hr />
        <h4 style="margin: 16px 0 12px 0;"><i class="fas fa-chart-line"></i> 详细对比表 (${monthLabel} & ${year}年累计)</h4>
        <table class="compare-table">
            <thead>
                <tr><th>姓名</th><th>当月加班时长</th><th>当月薪资(元)</th><th>当月加班天数</th><th>${year}年累计薪资(元)</th></tr>
            </thead>
            <tbody>`;

    users.forEach((user) => {
        const summary = stats[user.id] || { monthMinutes: 0, monthAmount: '0.00', overtimeDays: 0, yearAmount: '0.00' };
        html += `
            <tr>
                <td><span class="person-name-badge">${escapeHtml(user.name)}</span></td>
                <td><strong>${formatMinutesShort(summary.monthMinutes)}</strong></td>
                <td class="compare-highlight">${summary.monthAmount}</td>
                <td>${summary.overtimeDays} 天</td>
                <td class="compare-highlight">${summary.yearAmount}</td>
            </tr>`;
    });

    html += `
            </tbody>
        </table>
        <div style="margin-top:16px; font-size:0.76rem; color:gray;"><i class="fas fa-info-circle"></i> 薪资规则：17:30 起算，每满 20 分钟 +5 元，不满 20 分钟不计费。本周之星基于当前实时日期，本月/年度之星基于当前日历所选月份与年份。</div>`;

    dom.compareModalBody.innerHTML = html;
}

function renderBanners() {
    const bannerLeftAnnouncement = announcements.find((a) => a.type === 'banner_left');
    const bannerRightAnnouncement = announcements.find((a) => a.type === 'banner_right');

    if (bannerLeftAnnouncement) {
        dom.bannerLeft.textContent = escapeHtml(bannerLeftAnnouncement.content);
    }

    if (bannerRightAnnouncement) {
        dom.bannerRight.textContent = escapeHtml(bannerRightAnnouncement.content);
    }
}

function renderAnnouncements() {
    const announcementList = announcements.filter((a) => a.type !== 'banner_left' && a.type !== 'banner_right');

    if (!announcementList.length) {
        dom.announcementList.innerHTML = '<div class="announcements-empty">暂无公告</div>';
        return;
    }

    let html = announcementList.map((announcement) => {
        const readUsers = Array.isArray(announcement.readUsers) ? announcement.readUsers : [];
        const hasRead = readUsers.some((u) => Number(u.id) === Number(currentUserId));
        const readUsersList = readUsers.map((u) => escapeHtml(u.name)).join('、');
        const agreeCount = Number(announcement.agreeCount) || 0;
        const disagreeCount = Number(announcement.disagreeCount) || 0;
        const voteArea = announcement.type === '投票系统'
            ? `
                <div class="vote-summary">同意：${agreeCount} | 反对：${disagreeCount}</div>
                <div class="vote-details" id="vote-details-${announcement.id}" style="display: none;">
                    <div class="vote-details-title"><strong>投票详情</strong></div>
                </div>
                <div class="vote-actions">
                    <button class="vote-btn agree vote-announcement-btn" data-announcement-id="${announcement.id}" data-option="agree">同意</button>
                    <button class="vote-btn disagree vote-announcement-btn" data-announcement-id="${announcement.id}" data-option="disagree">反对</button>
                    <button class="vote-info-toggle-btn" data-announcement-id="${announcement.id}">查看投票</button>
                </div>`
            : '';

        const announcementImages = normalizeAnnouncementImageList(announcement.imageData);
        const imageArea = announcementImages.length
            ? `
                <div class="announcement-image-block">
                    <div class="announcement-image-gallery">
                        ${announcementImages.map((src, index) => `
                            <button type="button" class="announcement-image-thumb" data-image-src="${src}" data-image-index="${index}" title="点击放大查看">
                                <img src="${src}" alt="公告图片 ${index + 1}" loading="lazy">
                                ${announcementImages.length > 1 ? `<span class="image-count-badge">${index + 1}/${announcementImages.length}</span>` : ''}
                            </button>
                        `).join('')}
                    </div>
                </div>`
            : '';

        const readReceiptArea = announcement.type === '投票系统'
            ? ''
            : `
                <div class="read-receipt-area">
                    <div class="read-receipt-users ${readUsers.length ? 'is-visible' : ''}" id="read-users-${announcement.id}">
                        ${readUsers.length ? `<strong>已读：</strong>${readUsersList}` : ''}
                    </div>
                    <button class="read-receipt-btn ${hasRead ? 'is-read' : ''}" data-announcement-id="${announcement.id}" ${hasRead ? 'disabled' : ''}>
                        ${hasRead ? '已收到' : '收到'}
                    </button>
                </div>`;

        return `
        <div class="announcement-item">
            <div class="announcement-content">
                <strong style="color: var(--primary-color);">${escapeHtml(announcement.type)}</strong><br>
                ${escapeHtml(announcement.content)}
                ${imageArea}
                ${voteArea}
                ${readReceiptArea}
            </div>
            <div class="announcement-actions">
                <button class="btn btn-rename btn-sm edit-announcement-btn" data-announcement-id="${announcement.id}">编辑</button>
                <button class="btn btn-delete btn-sm delete-announcement-btn" data-announcement-id="${announcement.id}" ${!isAdmin ? 'disabled' : ''}>删除</button>
            </div>
        </div>`;
    }).join('');

    dom.announcementList.innerHTML = html;
}

async function handleVoteAnnouncement(announcementId, option) {
    if (!getCurrentUser()) {
        alert('请先选择用户后再投票');
        return;
    }

    const voteButtons = Array.from(document.querySelectorAll(`.vote-announcement-btn[data-announcement-id="${announcementId}"]`));
    voteButtons.forEach((button) => {
        button.disabled = true;
    });

    try {
        await apiFetch(`/announcements/${announcementId}/vote`, {
            method: 'POST',
            body: { userId: currentUserId, option }
        });
        await loadBootstrap({ preserveSelection: true, silent: true });
    } finally {
        voteButtons.forEach((button) => {
            button.disabled = false;
        });
    }
}

async function handleReadReceipt(announcementId) {
    if (!getCurrentUser()) {
        alert('请先选择用户后再点击收到');
        return;
    }

    const readBtn = document.querySelector(`.read-receipt-btn[data-announcement-id="${announcementId}"]`);
    if (readBtn) {
        readBtn.disabled = true;
    }

    try {
        const result = await apiFetch(`/announcements/${announcementId}/read`, {
            method: 'POST',
            body: { userId: currentUserId }
        });

        // 显示已读用户列表
        const readUsersContainer = document.getElementById(`read-users-${announcementId}`);
        if (readUsersContainer && result?.readUsers) {
            const readUsersList = result.readUsers.map((u) => escapeHtml(u.name)).join('、');
            readUsersContainer.classList.add('is-visible');
            readUsersContainer.innerHTML = `<strong>已读：</strong>${readUsersList}`;
        }

        // 更新按钮状态
        if (readBtn) {
            readBtn.textContent = '已收到';
            readBtn.classList.add('is-read');
            readBtn.disabled = true;
        }
    } catch (error) {
        console.error('标记已读失败:', error);
        alert('标记已读失败，请稍后重试');
    } finally {
        if (readBtn && readBtn.textContent !== '已收到') {
            readBtn.disabled = false;
        }
    }
}

async function toggleVoteDetails(announcementId) {
    const detailsContainer = document.getElementById(`vote-details-${announcementId}`);
    if (!detailsContainer) return;

    // 如果已经显示，直接切换
    if (detailsContainer.style.display !== 'none') {
        detailsContainer.style.display = 'none';
        return;
    }

    // 加载投票详情
    detailsContainer.innerHTML = '<div class="vote-loading">加载中...</div>';
    detailsContainer.style.display = 'block';

    try {
        const details = await apiFetch(`/announcements/${announcementId}/details`);
        
        let detailsHtml = '<div class="vote-details-title"><strong>投票详情</strong></div>';
        
        // 显示同意用户
        if (details?.votes?.agree?.length > 0) {
            const agreeNames = details.votes.agree.map((v) => escapeHtml(v.userName)).join('、');
            detailsHtml += `<div class="vote-detail-agree">同意：${agreeNames}</div>`;
        }
        
        // 显示反对用户
        if (details?.votes?.disagree?.length > 0) {
            const disagreeNames = details.votes.disagree.map((v) => escapeHtml(v.userName)).join('、');
            detailsHtml += `<div class="vote-detail-disagree">反对：${disagreeNames}</div>`;
        }

        if (!details?.votes?.agree?.length && !details?.votes?.disagree?.length) {
            detailsHtml += '<div class="vote-detail-empty">暂无投票</div>';
        }

        detailsContainer.innerHTML = detailsHtml;
    } catch (error) {
        console.error('加载投票详情失败:', error);
        detailsContainer.innerHTML = '<div class="vote-detail-error">加载失败</div>';
    }
}

function updateAnnouncementTypeInputState() {
    if (!dom.announcementCategory || !dom.announcementType) return;
    const isVote = dom.announcementCategory.value === '投票系统';

    if (isVote) {
        const currentType = String(dom.announcementType.value || '').trim();
        if (currentType && currentType !== '投票系统') {
            lastNormalAnnouncementType = currentType;
        }
        if (dom.announcementTypeGroup) {
            dom.announcementTypeGroup.style.display = 'none';
        }
        dom.announcementType.value = '投票系统';
        dom.announcementType.readOnly = true;
        dom.announcementType.disabled = true;
        dom.announcementType.style.opacity = '0.75';
        dom.announcementType.style.cursor = 'not-allowed';
        dom.announcementType.placeholder = '投票公告固定名称';
        if (dom.announcementTypeLabel) {
            dom.announcementTypeLabel.textContent = '公告名（投票固定）';
        }
        if (dom.announcementTypeHint) {
            dom.announcementTypeHint.textContent = '投票模式下公告名固定为“投票系统”，请在下方填写投票主题。';
        }
        if (dom.announcementContentLabel) {
            dom.announcementContentLabel.textContent = '投票主题（最多200字）';
        }
        if (dom.announcementContent) {
            dom.announcementContent.placeholder = '例如：是否同意本周六加班？';
        }
    } else {
        const currentType = String(dom.announcementType.value || '').trim();
        if (!currentType || currentType === '投票系统') {
            dom.announcementType.value = lastNormalAnnouncementType || '普通公告';
        } else {
            lastNormalAnnouncementType = currentType;
        }
        if (dom.announcementTypeGroup) {
            dom.announcementTypeGroup.style.display = '';
        }
        dom.announcementType.readOnly = false;
        dom.announcementType.disabled = false;
        dom.announcementType.style.opacity = '1';
        dom.announcementType.style.cursor = '';
        dom.announcementType.placeholder = '输入公告名';
        if (dom.announcementTypeLabel) {
            dom.announcementTypeLabel.textContent = '公告名（最多30字）';
        }
        if (dom.announcementTypeHint) {
            dom.announcementTypeHint.textContent = '普通公告可自定义公告名。';
        }
        if (dom.announcementContentLabel) {
            dom.announcementContentLabel.textContent = '公告内容（最多200字）';
        }
        if (dom.announcementContent) {
            dom.announcementContent.placeholder = '输入公告内容';
        }
    }
}

function renderAll() {
    buildUserButtons();
    updateAdminUI();
    updateActionAvailability();
    updatePersonTitle();
    updateStats();
    updateCalendar();
    updateSelectedDateInfo();
    updateOvertimeList();
    updateCountdown();
    renderUserManager();
    renderBanners();
    renderAnnouncements();
    dom.monthSelector.value = formatMonthInput(currentDate);
    updateResultDisplay();
}

async function loadBootstrap({ preserveSelection = true, silent = false } = {}) {
    const previousUserId = preserveSelection ? currentUserId : null;
    const storedUserId = getStoredSelectedUserId();
    const preferredUserId = previousUserId ?? storedUserId;
    const previousSelectedDate = selectedDate ? new Date(selectedDate) : null;

    const payload = await apiFetch('/bootstrap', {}, { silent });
    users = Array.isArray(payload?.users) ? payload.users : [];
    overtimeDataByUser = payload?.overtimeData || {};
    announcements = Array.isArray(payload?.announcements) ? payload.announcements : [];
    isAdmin = Boolean(payload?.isAdmin);

    if (users.length) {
        const matchedUser = users.find((user) => user.id === preferredUserId);
        currentUserId = matchedUser ? matchedUser.id : users[0].id;
        setStoredSelectedUserId(currentUserId);
    } else {
        currentUserId = null;
        setStoredSelectedUserId(null);
    }

    selectedDate = previousSelectedDate || new Date();
    renderAll();
}

async function addOvertimeRecord() {
    if (!getCurrentUser()) {
        alert('请先选择用户');
        return;
    }
    if (!selectedDate) {
        alert('请先点击日历选择日期');
        return;
    }

    const type = dom.overtimeType.value;
    const startTime = dom.startTime.value;
    const endTime = dom.endTime.value;
    if (!startTime || !endTime) {
        alert('请填写时间');
        return;
    }

    const minutes = calculateTimeDifference(startTime, endTime);
    if (minutes <= 0) {
        alert('加班时长必须大于0');
        return;
    }

    await apiFetch('/overtime', {
        method: 'POST',
        body: {
            userId: currentUserId,
            date: getDateKey(selectedDate),
            type,
            startTime,
            endTime
        }
    });

    await loadBootstrap({ preserveSelection: true, silent: true });
    const dateKey = getDateKey(selectedDate);
    const newRecords = getCurrentUserData()[dateKey] || [];
    const isReplaced = newRecords.length > 0 ? '（已更新当天记录）' : '';
    alert(`保存成功！${formatMinutes(minutes)} 薪资 ${calculateOvertimeAmount(minutes, startTime, endTime)}元${isReplaced}\n提示：一天只能保留一条加班记录。`);
}

async function clearDayRecords(date) {
    if (!getCurrentUser()) return;
    const dateKey = getDateKey(date);
    const records = getCurrentUserData()[dateKey] || [];
    if (!records.length) {
        alert('当天没有加班记录');
        return;
    }

    await apiFetch('/overtime/clear-day', {
        method: 'POST',
        body: { userId: currentUserId, date: dateKey }
    });
    await loadBootstrap({ preserveSelection: true, silent: true });
}

async function clearDayByDoubleClick(date) {
    const dateKey = getDateKey(date);
    const records = getCurrentUserData()[dateKey] || [];
    if (!records.length) {
        alert('当天无记录可清空');
        return;
    }

    if (!confirm(`清空 ${date.getMonth() + 1}月${date.getDate()}日 所有加班记录？`)) {
        return;
    }

    await clearDayRecords(date);
}

async function clearDayOvertimeBtn() {
    if (!selectedDate) {
        alert('请选择日期');
        return;
    }

    if (!confirm('清空当天所有加班记录？')) {
        return;
    }

    await clearDayRecords(selectedDate);
}

async function deleteOvertimeRecord(recordId) {
    if (!confirm('删除这条加班记录？')) {
        return;
    }
    await apiFetch(`/overtime/${recordId}`, { method: 'DELETE' });
    await loadBootstrap({ preserveSelection: true, silent: true });
}

function openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) modal.classList.remove('active');
}

async function handleAdminAction() {
    if (isAdmin) {
        setAdminToken('');
        isAdmin = false;
        updateAdminUI();
        alert('已退出管理员状态');
        return;
    }
    dom.adminPassword.value = '';
    openModal('adminLoginModal');
}

async function handleAdminLogin(event) {
    event.preventDefault();
    const password = dom.adminPassword.value.trim();
    if (!password) {
        alert('请输入管理员密码');
        return;
    }

    const payload = await apiFetch('/admin/login', {
        method: 'POST',
        body: { password }
    });

    setAdminToken(payload.token);
    isAdmin = true;
    closeModal('adminLoginModal');
    await loadBootstrap({ preserveSelection: true, silent: true });
    alert('管理员登录成功');
}

async function handleAddUser(event) {
    event.preventDefault();
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    const name = dom.newUserName.value.trim();
    if (!name) {
        alert('请输入用户名称');
        return;
    }

    await apiFetch('/users', {
        method: 'POST',
        body: { name }
    });

    dom.newUserName.value = '';
    await loadBootstrap({ preserveSelection: true, silent: true });
}

async function handleRenameUser(userId, userName) {
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    const nextName = prompt(`请输入“${userName}”的新名称`, userName);
    if (nextName === null) {
        return;
    }

    const trimmedName = nextName.trim();
    if (!trimmedName) {
        alert('用户名称不能为空');
        return;
    }
    if (trimmedName === userName) {
        return;
    }

    await apiFetch(`/users/${userId}`, {
        method: 'PATCH',
        body: { name: trimmedName }
    });
    await loadBootstrap({ preserveSelection: true, silent: true });
}

async function handleDeleteUser(userId, userName) {
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }
    if (!confirm(`确认删除用户“${userName}”？该用户所有加班记录也会被删除。`)) {
        return;
    }

    await apiFetch(`/users/${userId}`, { method: 'DELETE' });
    await loadBootstrap({ preserveSelection: true, silent: true });
}

async function handleEditBanner(announcementId, bannerType) {
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    const announcement = announcements.find((a) => a.id === announcementId);
    if (!announcement) {
        alert('公告不存在');
        return;
    }

    editingAnnouncementId = announcementId;
    dom.bannerType.value = bannerType === 'banner_left' ? '左侧条幅' : '右侧条幅';
    dom.bannerContent.value = announcement.content;
    openModal('editBannerModal');
}

async function handleSaveBanner(event) {
    event.preventDefault();

    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    if (!editingAnnouncementId) {
        alert('无效的编辑状态');
        return;
    }

    const content = dom.bannerContent.value.trim();
    if (!content) {
        alert('条幅文案不能为空');
        return;
    }

    await apiFetch(`/announcements/${editingAnnouncementId}`, {
        method: 'PATCH',
        body: { content }
    });

    editingAnnouncementId = null;
    closeModal('editBannerModal');
    await loadBootstrap({ preserveSelection: true, silent: true });
    alert('条幅已更新');
}

async function handleAddAnnouncement(event) {
    event.preventDefault();

    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    const category = dom.announcementCategory ? dom.announcementCategory.value : '普通公告';
    const type = category === '投票系统' ? '投票系统' : dom.announcementType.value.trim();
    const content = dom.announcementContent.value.trim();

    if (!type) {
        alert('公告名不能为空');
        return;
    }

    if (!content) {
        alert('公告内容不能为空');
        return;
    }

    await apiFetch('/announcements', {
        method: 'POST',
        body: { type, content, imageData: JSON.stringify(currentAnnouncementImageDataList) }
    });

    if (dom.announcementCategory) {
        dom.announcementCategory.value = '普通公告';
    }
    lastNormalAnnouncementType = '普通公告';
    dom.announcementType.value = '普通公告';
    dom.announcementContent.value = '';
    resetAnnouncementImageState();
    updateAnnouncementTypeInputState();
    closeModal('announcementModal');
    await loadBootstrap({ preserveSelection: true, silent: true });
}

async function handleEditAnnouncement(announcementId) {
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    const announcement = announcements.find((a) => a.id === announcementId);
    if (!announcement) {
        alert('公告不存在');
        return;
    }

    editingAnnouncementId = announcementId;
    const isVote = announcement.type === '投票系统';
    if (dom.announcementCategory) {
        dom.announcementCategory.value = isVote ? '投票系统' : '普通公告';
    }
    if (!isVote) {
        lastNormalAnnouncementType = announcement.type;
    }
    dom.announcementType.value = announcement.type;
    updateAnnouncementTypeInputState();
    dom.announcementContent.value = announcement.content;
    currentAnnouncementImageDataList = normalizeAnnouncementImageList(announcement.imageData);
    if (dom.announcementImage) dom.announcementImage.value = '';
    renderAnnouncementImagePreview();
    document.getElementById('announcementModalTitle').textContent = '编辑';
    openModal('announcementModal');
}

async function handleSaveAnnouncement(event) {
    event.preventDefault();

    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    if (!editingAnnouncementId) {
        alert('无效的编辑状态');
        return;
    }

    const content = dom.announcementContent.value.trim();
    const category = dom.announcementCategory ? dom.announcementCategory.value : '普通公告';
    const type = category === '投票系统' ? '投票系统' : dom.announcementType.value.trim();
    if (!type) {
        alert('公告名不能为空');
        return;
    }
    if (!content) {
        alert('公告内容不能为空');
        return;
    }

    await apiFetch(`/announcements/${editingAnnouncementId}`, {
        method: 'PATCH',
        body: { type, content, imageData: JSON.stringify(currentAnnouncementImageDataList) }
    });

    editingAnnouncementId = null;
    resetAnnouncementImageState();
    closeModal('announcementModal');
    document.getElementById('announcementModalTitle').textContent = '新增';
    await loadBootstrap({ preserveSelection: true, silent: true });
    alert('公告已更新');
}

async function handleDeleteAnnouncement(announcementId) {
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    if (!confirm('删除这条公告？')) {
        return;
    }

    await apiFetch(`/announcements/${announcementId}`, { method: 'DELETE' });
    await loadBootstrap({ preserveSelection: true, silent: true });
}

function bindEvents() {
    dom.prevMonth.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() - 1);
        renderAll();
    });

    dom.nextMonth.addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        renderAll();
    });

    dom.monthSelector.addEventListener('change', (event) => {
        const [year, month] = event.target.value.split('-').map(Number);
        currentDate.setFullYear(year, month - 1, 1);
        renderAll();
    });

    dom.startTime.addEventListener('change', updateResultDisplay);
    dom.endTime.addEventListener('change', updateResultDisplay);
    dom.addOvertimeBtn.addEventListener('click', addOvertimeRecord);
    dom.clearAllBtn.addEventListener('click', clearDayOvertimeBtn);
    dom.openCompareModalBtn.addEventListener('click', () => {
        renderCompareModal();
        openModal('compareModal');
    });
    dom.adminActionBtn.addEventListener('click', handleAdminAction);
    dom.manageUsersBtn.addEventListener('click', () => openModal('userManagerModal'));
    dom.adminLoginForm.addEventListener('submit', handleAdminLogin);
    dom.addUserForm.addEventListener('submit', handleAddUser);

    if (dom.toggleDailyMediaBtn) {
        dom.toggleDailyMediaBtn.addEventListener('click', async () => {
            const nextVisible = dom.dailyMediaSection?.classList.contains('is-hidden');
            updateDailyMediaVisibility(Boolean(nextVisible));
            setStoredDailyMediaVisible(Boolean(nextVisible));

            if (nextVisible) {
                await ensureDailyMediaLoaded().catch(() => {});
            }
        });
    }

    if (dom.wallpaperSource) {
        dom.wallpaperSource.addEventListener('change', () => {
            setStoredWallpaperSourceId(dom.wallpaperSource.value || '');
            refreshWallpaperSourceHealth({ silent: true }).catch(() => {});
            loadWallpaper({ silent: true }).catch(() => {});
        });
    }

    if (dom.refreshWallpaperBtn) {
        dom.refreshWallpaperBtn.addEventListener('click', () => loadWallpaper({ silent: false }));
    }

    if (dom.viewWallpaperBtn) {
        dom.viewWallpaperBtn.addEventListener('click', openCurrentWallpaper);
    }

    if (dom.downloadWallpaperBtn) {
        dom.downloadWallpaperBtn.addEventListener('click', downloadCurrentWallpaper);
    }

    if (dom.videoSource) {
        dom.videoSource.addEventListener('change', () => {
            setStoredVideoSourceId(dom.videoSource.value || '');
            refreshVideoSourceHealth({ silent: true }).catch(() => {});
            loadVideo({ silent: true }).catch(() => {});
        });
    }

    if (dom.refreshVideoBtn) {
        dom.refreshVideoBtn.addEventListener('click', () => loadVideo({ silent: false }));
    }

    if (dom.refreshQuoteBtn) {
        dom.refreshQuoteBtn.addEventListener('click', () => loadDailyQuote({ silent: false }));
    }

    if (dom.announcementImage) {
        const handleFiles = async (files) => {
            const dataUrls = await filesToDataUrls(files);
            if (!dataUrls.length) {
                if (!files || !files.length) {
                    resetAnnouncementImageState();
                }
                return;
            }
            currentAnnouncementImageDataList = dataUrls;
            renderAnnouncementImagePreview();
        };

        dom.announcementImage.addEventListener('change', async () => {
            const files = dom.announcementImage.files || [];
            await handleFiles(files);
        });
    }

    if (dom.announcementImageDropzone) {
        dom.announcementImageDropzone.addEventListener('dragover', (event) => {
            event.preventDefault();
            dom.announcementImageDropzone.classList.add('is-dragover');
        });
        dom.announcementImageDropzone.addEventListener('dragleave', () => {
            dom.announcementImageDropzone.classList.remove('is-dragover');
        });
        dom.announcementImageDropzone.addEventListener('drop', async (event) => {
            event.preventDefault();
            dom.announcementImageDropzone.classList.remove('is-dragover');
            const files = event.dataTransfer?.files || [];
            const dataUrls = await filesToDataUrls(files);
            if (!dataUrls.length) return;
            currentAnnouncementImageDataList = dataUrls;
            renderAnnouncementImagePreview();
        });
        dom.announcementImageDropzone.addEventListener('click', (event) => {
            if (event.target && event.target.tagName === 'INPUT') return;
            dom.announcementImage?.click();
        });
    }

    if (dom.announcementImagePreviewList) {
        dom.announcementImagePreviewList.addEventListener('click', (event) => {
            const thumb = event.target.closest('.announcement-image-thumb');
            if (thumb?.dataset?.imageSrc) {
                openAnnouncementImageZoom(thumb.dataset.imageSrc);
            }
        });
    }

    if (dom.announcementCategory) {
        dom.announcementCategory.addEventListener('change', updateAnnouncementTypeInputState);
    }

    // Banner events
    dom.bannerLeft.addEventListener('click', () => {
        if (isAdmin) {
            const announcement = announcements.find((a) => a.type === 'banner_left');
            if (announcement) {
                handleEditBanner(announcement.id, 'banner_left');
            }
        }
    });

    dom.bannerRight.addEventListener('click', () => {
        if (isAdmin) {
            const announcement = announcements.find((a) => a.type === 'banner_right');
            if (announcement) {
                handleEditBanner(announcement.id, 'banner_right');
            }
        }
    });

    dom.editBannerForm.addEventListener('submit', handleSaveBanner);
    dom.addAnnouncementBtn.addEventListener('click', () => {
        editingAnnouncementId = null;
        if (dom.announcementCategory) {
            dom.announcementCategory.value = '普通公告';
        }
        dom.announcementType.value = '普通公告';
        updateAnnouncementTypeInputState();
        dom.announcementContent.value = '';
        resetAnnouncementImageState();
        document.getElementById('announcementModalTitle').textContent = '新增';
        openModal('announcementModal');
    });
    dom.announcementForm.addEventListener('submit', (event) => {
        if (editingAnnouncementId) {
            handleSaveAnnouncement(event);
        } else {
            handleAddAnnouncement(event);
        }
    });

    dom.announcementList.addEventListener('click', (event) => {
        const imageThumb = event.target.closest('.announcement-image-thumb');
        if (imageThumb && imageThumb.dataset.imageSrc) {
            openAnnouncementImageZoom(imageThumb.dataset.imageSrc);
            return;
        }

        const voteButton = event.target.closest('.vote-announcement-btn');
        if (voteButton) {
            handleVoteAnnouncement(Number(voteButton.dataset.announcementId), voteButton.dataset.option);
            return;
        }

        const readReceiptButton = event.target.closest('.read-receipt-btn');
        if (readReceiptButton) {
            handleReadReceipt(Number(readReceiptButton.dataset.announcementId));
            return;
        }

        const voteToggleButton = event.target.closest('.vote-info-toggle-btn');
        if (voteToggleButton) {
            toggleVoteDetails(Number(voteToggleButton.dataset.announcementId));
            return;
        }

        const editButton = event.target.closest('.edit-announcement-btn');
        if (editButton) {
            handleEditAnnouncement(Number(editButton.dataset.announcementId));
            return;
        }

        const deleteButton = event.target.closest('.delete-announcement-btn');
        if (deleteButton && !deleteButton.disabled) {
            handleDeleteAnnouncement(Number(deleteButton.dataset.announcementId));
        }
    });

    document.querySelectorAll('[data-close-modal]').forEach((button) => {
        button.addEventListener('click', () => closeModal(button.dataset.closeModal));
    });

    document.querySelectorAll('.modal-overlay').forEach((modal) => {
        modal.addEventListener('click', (event) => {
            if (event.target === modal) closeModal(modal.id);
        });
    });

    dom.overtimeRecords.addEventListener('click', (event) => {
        const deleteButton = event.target.closest('.record-delete-btn');
        if (deleteButton) {
            deleteOvertimeRecord(Number(deleteButton.dataset.recordId));
        }
    });

    dom.userManagerList.addEventListener('click', (event) => {
        const renameButton = event.target.closest('.rename-user-btn');
        if (renameButton && !renameButton.disabled) {
            handleRenameUser(Number(renameButton.dataset.userId), renameButton.dataset.userName);
            return;
        }

        const deleteButton = event.target.closest('.delete-user-btn');
        if (deleteButton && !deleteButton.disabled) {
            handleDeleteUser(Number(deleteButton.dataset.userId), deleteButton.dataset.userName);
        }
    });

    window.addEventListener('focus', () => {
        loadBootstrap({ preserveSelection: true, silent: true }).catch(() => {});
    });

    setInterval(() => {
        loadBootstrap({ preserveSelection: true, silent: true }).catch(() => {});
    }, AUTO_SYNC_INTERVAL);
}

async function init() {
    cacheDom();
    renderAiDirectory();
    selectedDate = new Date();
    dom.manageUsersBtn.classList.add('hide');
    dom.monthSelector.value = formatMonthInput(currentDate);
    updateResultDisplay();
    bindEvents();
    updateAnnouncementTypeInputState();
    const mediaVisible = getStoredDailyMediaVisible();
    updateDailyMediaVisibility(mediaVisible);

    try {
        await loadBootstrap({ preserveSelection: false, silent: false });
        await loadDailyQuote({ silent: true });
        if (mediaVisible) {
            await ensureDailyMediaLoaded().catch(() => {});
        }
    } catch (error) {
        console.error(error);
        dom.personSwitchBar.innerHTML = '<div class="list-empty" style="width:100%;">无法连接后端服务，请先启动共享数据库服务</div>';
        dom.calendarDays.innerHTML = '<div class="calendar-empty">无法加载日历</div>';
        dom.overtimeRecords.innerHTML = '<div class="list-empty">无法加载记录</div>';
    }
}

document.addEventListener('DOMContentLoaded', init);
