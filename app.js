const API_BASE = '/api';
const AUTO_SYNC_INTERVAL = 30000;
const SELECTED_USER_STORAGE_KEY = 'overtime_selected_user_id';

let users = [];
let overtimeDataByUser = {};
let userProfilesByUser = {};
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
let editingUserId = null;
let realtimeEventSource = null;
let realtimeReconnectTimer = null;
let realtimeRefreshTimer = null;
let lastRealtimeToken = '';
let currentDataToken = '';
const overtimeReasonDraftByKey = new Map();
const overtimeStartTimeDraftByKey = new Map();
const overtimeEndTimeDraftByKey = new Map();
const WALLPAPER_SELECTED_SOURCE_STORAGE_KEY = 'wallpaper_selected_source';
const VIDEO_SELECTED_SOURCE_STORAGE_KEY = 'video_selected_source';
const DAILY_MEDIA_VISIBLE_STORAGE_KEY = 'daily_media_visible';
const OVERTIME_PDF_PROFILE_STORAGE_KEY = 'overtime_pdf_profile_by_user';
const ANNUAL_HOURS_PER_DAY = 8;
const DEFAULT_ANNUAL_DAYS = 5;
const DEFAULT_START_TIME = '17:30';
const DEFAULT_END_TIME = '20:30';
const PDF_TEXT_FONT_NAME = 'SimSun';
const PDF_TEXT_FONT_FILE = 'SimSun.ttf';
const PDF_TEXT_FONT_BOLD_NAME = 'SimSunBold';
const PDF_TEXT_FONT_BOLD_FILE = 'SimSun-Bold.ttf';
const PDF_TEXT_FONT_SOURCES = [
    '/assets/fonts/SimSun.ttf',
    '/assets/fonts/STSONG.TTF',
    '/assets/fonts/NotoSansSC-Subset-VF.ttf',
    'https://github.com/googlefonts/noto-cjk/raw/main/Sans/Variable/TTF/Subset/NotoSansSC-VF.ttf'
];
const PDF_TEXT_FONT_BOLD_SOURCES = [
    '/assets/fonts/SimSun-Bold.ttf',
    '/assets/fonts/simsunb.ttf',
    '/assets/fonts/STSONG.TTF'
];
let pdfTextFontBase64Promise = null;
let pdfTextFontBoldBase64Promise = null;

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

function scheduleRealtimeBootstrap(token) {
    const tokenText = String(token || '').trim();
    if (tokenText && tokenText === lastRealtimeToken) {
        return;
    }
    if (tokenText) {
        lastRealtimeToken = tokenText;
    }
    if (realtimeRefreshTimer) {
        clearTimeout(realtimeRefreshTimer);
    }
    realtimeRefreshTimer = setTimeout(() => {
        loadBootstrap({ preserveSelection: true, silent: true }).catch(() => {});
    }, 200);
}

function connectRealtimeStream() {
    if (typeof window.EventSource !== 'function') {
        return;
    }
    if (realtimeEventSource) {
        realtimeEventSource.close();
        realtimeEventSource = null;
    }

    const streamUrl = `${API_BASE}/stream`;
    realtimeEventSource = new EventSource(streamUrl);
    realtimeEventSource.addEventListener('connected', (event) => {
        try {
            const payload = JSON.parse(String(event?.data || '{}'));
            if (payload?.token) {
                lastRealtimeToken = String(payload.token);
            }
        } catch {
            // Ignore malformed bootstrap stream events.
        }
    });
    realtimeEventSource.addEventListener('data-changed', (event) => {
        try {
            const payload = JSON.parse(String(event?.data || '{}'));
            scheduleRealtimeBootstrap(payload?.token || '');
        } catch {
            scheduleRealtimeBootstrap('');
        }
    });
    realtimeEventSource.onerror = () => {
        if (realtimeEventSource) {
            realtimeEventSource.close();
            realtimeEventSource = null;
        }
        if (realtimeReconnectTimer) {
            clearTimeout(realtimeReconnectTimer);
        }
        realtimeReconnectTimer = setTimeout(() => {
            connectRealtimeStream();
        }, 3000);
    };
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
    dom.annualLeaveRemaining = document.getElementById('annualLeaveRemaining');
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
    dom.overtimeReason = document.getElementById('overtimeReason');
    dom.exportCurrentPdfBtn = document.getElementById('exportCurrentPdfBtn');
    dom.exportAllPdfBtn = document.getElementById('exportAllPdfBtn');
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
    dom.userNickname = document.getElementById('userNickname');
    dom.userDisplayName = document.getElementById('userDisplayName');
    dom.userEmpId = document.getElementById('userEmpId');
    dom.userDept = document.getElementById('userDept');
    dom.saveUserBtn = document.getElementById('saveUserBtn');
    dom.cancelEditUserBtn = document.getElementById('cancelEditUserBtn');
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
    dom.exportPdfModal = document.getElementById('exportPdfModal');
    dom.exportScopeCurrent = document.getElementById('exportScopeCurrent');
    dom.exportScopeAll = document.getElementById('exportScopeAll');
    dom.pdfName = document.getElementById('pdfName');
    dom.pdfEmpId = document.getElementById('pdfEmpId');
    dom.pdfDept = document.getElementById('pdfDept');
    dom.pdfDefaultReason = document.getElementById('pdfDefaultReason');
    dom.pdfStartDate = document.getElementById('pdfStartDate');
    dom.pdfEndDate = document.getElementById('pdfEndDate');
    dom.savePdfBtn = document.getElementById('savePdfBtn');
    dom.printPdfBtn = document.getElementById('printPdfBtn');
    dom.useAnnualBtn = document.getElementById('useAnnualBtn');
    dom.undoAnnualBtn = document.getElementById('undoAnnualBtn');
    dom.resetAnnualBtn = document.getElementById('resetAnnualBtn');
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

function getCurrentUserProfile() {
    const user = getCurrentUser();
    if (!user) return null;
    const profile = userProfilesByUser[String(user.id)] || {};
    return {
        userId: user.id,
        displayName: String(profile.displayName || user.name || '').trim(),
        empId: String(profile.empId || '').trim(),
        dept: String(profile.dept || '').trim(),
        annualRemainingHours: Number(profile.annualRemainingHours) || 0,
        annualLastResetYear: Number(profile.annualLastResetYear) || new Date().getFullYear(),
        annualHistory: Array.isArray(profile.annualHistory) ? profile.annualHistory : []
    };
}

function formatAnnualHistoryTime(timestamp) {
    const time = Number(timestamp);
    if (!Number.isFinite(time) || time <= 0) return '未知时间';
    return new Date(time).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function getLatestAnnualHistoryEntry(profile) {
    const history = Array.isArray(profile?.annualHistory) ? profile.annualHistory : [];
    if (!history.length) return null;
    return history.reduce((latest, current) => {
        const latestTime = Number(latest?.timestamp || 0);
        const currentTime = Number(current?.timestamp || 0);
        return currentTime > latestTime ? current : latest;
    }, history[0]);
}

function getProfileForUser(userId) {
    const user = users.find((item) => item.id === userId);
    const profile = userProfilesByUser[String(userId)] || {};
    return {
        displayName: String(profile.displayName || user?.name || '').trim(),
        empId: String(profile.empId || '').trim(),
        dept: String(profile.dept || '').trim(),
        annualRemainingHours: Number(profile.annualRemainingHours) || 0,
        annualHistory: Array.isArray(profile.annualHistory) ? profile.annualHistory : []
    };
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
    const method = String(options.method || 'GET').toUpperCase();

    if (body && typeof body === 'object' && !(body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
        body = JSON.stringify(body);
    }

    if (adminToken) {
        headers.set('Authorization', `Bearer ${adminToken}`);
    }

    if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(method) && currentDataToken) {
        headers.set('X-Data-Token', currentDataToken);
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
        if (response.status === 409 && payload && typeof payload === 'object' && payload.code === 'DATA_CONFLICT') {
            currentDataToken = String(payload.currentToken || currentDataToken || '');
            try {
                await loadBootstrap({ preserveSelection: true, silent: true });
            } catch {
                // Ignore refresh errors and keep original conflict message.
            }
            if (!silent) {
                alert('检测到他人已更新数据，你当前页面已自动刷新，请确认后重新提交');
            }
            throw new Error('DATA_CONFLICT');
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

function getReasonDraftKey(userId, dateKey) {
    const uid = Number(userId);
    const day = String(dateKey || '').trim();
    if (!Number.isInteger(uid) || uid <= 0 || !day) return '';
    return `${uid}::${day}`;
}

function syncReasonDraftFromDom() {
    if (!selectedDate || !currentUserId) return;
    const key = getReasonDraftKey(currentUserId, getDateKey(selectedDate));
    if (!key) return;
    overtimeReasonDraftByKey.set(key, String(dom.overtimeReason?.value || ''));
    overtimeStartTimeDraftByKey.set(key, String(dom.startTime?.value || ''));
    overtimeEndTimeDraftByKey.set(key, String(dom.endTime?.value || ''));
}

function clearReasonDraft(userId, dateKey) {
    const key = getReasonDraftKey(userId, dateKey);
    if (!key) return;
    overtimeReasonDraftByKey.delete(key);
    overtimeStartTimeDraftByKey.delete(key);
    overtimeEndTimeDraftByKey.delete(key);
}

function getReasonInputValue(dateKey) {
    const key = getReasonDraftKey(currentUserId, dateKey);
    if (key && overtimeReasonDraftByKey.has(key)) {
        return overtimeReasonDraftByKey.get(key);
    }
    const records = getCurrentUserData()[dateKey] || [];
    return records[0]?.reason || '';
}

function getStartTimeInputValue(dateKey) {
    const key = getReasonDraftKey(currentUserId, dateKey);
    if (key && overtimeStartTimeDraftByKey.has(key)) {
        return overtimeStartTimeDraftByKey.get(key);
    }
    const records = getCurrentUserData()[dateKey] || [];
    return records[0]?.startTime || DEFAULT_START_TIME;
}

function getEndTimeInputValue(dateKey) {
    const key = getReasonDraftKey(currentUserId, dateKey);
    if (key && overtimeEndTimeDraftByKey.has(key)) {
        return overtimeEndTimeDraftByKey.get(key);
    }
    const records = getCurrentUserData()[dateKey] || [];
    return records[0]?.endTime || DEFAULT_END_TIME;
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

function dateKeyToDate(dateKey) {
    return new Date(`${dateKey}T00:00:00`);
}

function formatDateToDateKey(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatApplyDateTime(dateKey, time) {
    const date = dateKeyToDate(dateKey);
    if (Number.isNaN(date.getTime())) {
        return `${dateKey} ${time || ''}`.trim();
    }
    const safeTime = String(time || '').trim() || '00:00';
    return `${date.getFullYear()}年 ${date.getMonth() + 1} 月 ${date.getDate()}日${safeTime}时`;
}

function getPdfProfileMap() {
    try {
        const raw = localStorage.getItem(OVERTIME_PDF_PROFILE_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
}

function savePdfProfileMap(profileMap) {
    localStorage.setItem(OVERTIME_PDF_PROFILE_STORAGE_KEY, JSON.stringify(profileMap || {}));
}

function getPdfProfileByUserId(userId) {
    const profileMap = getPdfProfileMap();
    const localProfile = profileMap[String(userId)] || { name: '', empId: '', dept: '', defaultReason: '' };
    const serverProfile = getProfileForUser(userId);
    return {
        name: localProfile.name || serverProfile.displayName || '',
        empId: localProfile.empId || serverProfile.empId || '',
        dept: localProfile.dept || serverProfile.dept || '',
        defaultReason: localProfile.defaultReason || ''
    };
}

function savePdfProfileByUserId(userId, profile) {
    const profileMap = getPdfProfileMap();
    profileMap[String(userId)] = {
        name: String(profile?.name || '').trim(),
        empId: String(profile?.empId || '').trim(),
        dept: String(profile?.dept || '').trim(),
        defaultReason: String(profile?.defaultReason || '').trim()
    };
    savePdfProfileMap(profileMap);
}

function getRecordsByUserInRange(userId, startDateKey, endDateKey) {
    const userData = overtimeDataByUser[String(userId)] || {};
    const start = dateKeyToDate(startDateKey);
    const end = dateKeyToDate(endDateKey);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        return [];
    }

    const results = [];
    Object.entries(userData).forEach(([dateKey, records]) => {
        const date = dateKeyToDate(dateKey);
        if (Number.isNaN(date.getTime())) return;
        if (date < start || date > end) return;
        records.forEach((record) => {
            results.push({ ...record, date: dateKey, userId });
        });
    });

    results.sort((a, b) => {
        if (a.date === b.date) return Number(a.id || 0) - Number(b.id || 0);
        return a.date.localeCompare(b.date);
    });
    return results;
}

const APPLY_FORMS_PER_PDF_PAGE = 4;

const APPLY_FORM_EXCEL_ROW_PT = 36;
const APPLY_FORM_EXCEL_GAP_PT = [18, 18, 22];

function ptToMm(pt) {
    return (Number(pt) || 0) * 25.4 / 72;
}

function buildApplyFormItemHtml(record, profile, fallbackReason, extraStyle = '') {
    const safeProfile = profile || {};
    const overtimeReason = String(record.reason || '').trim() || String(fallbackReason || '').trim() || '工作需要加班';
    const startText = formatApplyDateTime(record.date, record.startTime);
    const endText = formatApplyDateTime(record.date, record.endTime);

    return `
        <section class="apply-form-item"${extraStyle ? ` style="${escapeHtml(extraStyle)}"` : ''}>
            <div class="apply-form-wrap">
                <h2 class="apply-form-title">加班申请单</h2>
                <table class="apply-form-table">
                    <colgroup>
                        <col style="width: 14.15%;">
                        <col style="width: 19.41%;">
                        <col style="width: 15.58%;">
                        <col style="width: 17.29%;">
                        <col style="width: 8.77%;">
                        <col style="width: 24.80%;">
                    </colgroup>
                    <tr class="row-name">
                        <td class="label">姓名</td>
                        <td class="value">${escapeHtml(safeProfile.name || '')}</td>
                        <td class="label">工号</td>
                        <td class="value">${escapeHtml(safeProfile.empId || '')}</td>
                        <td class="label">部门</td>
                        <td class="value">${escapeHtml(safeProfile.dept || '')}</td>
                    </tr>
                    <tr class="row-time">
                        <td class="label">加班时间</td>
                        <td colspan="5" class="value" style="white-space: normal;">自${escapeHtml(startText)}至${escapeHtml(endText)}</td>
                    </tr>
                    <tr class="row-reason">
                        <td class="label">加班事由</td>
                        <td colspan="5" class="value" style="text-align: left; padding-left: 10px; padding-right: 10px;">${escapeHtml(overtimeReason)}</td>
                    </tr>
                    <tr class="row-sign">
                        <td colspan="3" style="padding-left: 8px;">部门领导签字或盖章</td>
                        <td colspan="3"></td>
                    </tr>
                </table>
            </div>
        </section>
    `;
}

function buildApplyFormPagesHtml(exportList) {
    const pages = [];
    for (let i = 0; i < exportList.length; i += APPLY_FORMS_PER_PDF_PAGE) {
        pages.push(exportList.slice(i, i + APPLY_FORMS_PER_PDF_PAGE));
    }

    const pageGapStyles = ['', 'margin-top: 6.35mm;', 'margin-top: 6.35mm;', 'margin-top: 7.76mm;'];

    const pageHtml = pages.map((items) => {
        const itemHtml = items.map((item, index) => buildApplyFormItemHtml(
            item.record,
            item.profile,
            item.fallbackReason,
            pageGapStyles[index] || ''
        )).join('');
        return `
            <section class="apply-form-page">
                ${itemHtml}
            </section>
        `;
    }).join('');

    return `
        <style>
            @font-face {
                font-family: 'SimSunLocal';
                src: url('/assets/fonts/SimSun.ttf') format('truetype');
                font-weight: 400;
                font-style: normal;
            }
            @font-face {
                font-family: 'SimSunLocal';
                src: url('/assets/fonts/SimSun-Bold.ttf') format('truetype');
                font-weight: 700;
                font-style: normal;
            }
            .apply-form-page {
                width: 210mm;
                min-height: 297mm;
                height: 297mm;
                padding: 3mm 17.8mm;
                background: #fff;
                page-break-after: always;
                font-family: 'SimSunLocal','SimSun','NSimSun','Songti SC','宋体','STSong',serif;
                color: #000;
                overflow: hidden;
                box-sizing: border-box;
            }
            .apply-form-item {
                width: 100%;
                margin: 0 auto;
                break-inside: avoid;
            }
            .apply-form-page .apply-form-wrap { width: 100%; margin: 0 auto; }
            .apply-form-page .apply-form-title { text-align: center; font-size: 16pt; line-height: 12.7mm; height: 12.7mm; margin: 0; font-weight: 700; font-family: 'SimSunLocal','SimSun','NSimSun','Songti SC','宋体','STSong',serif !important; }
            .apply-form-page .apply-form-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 14pt; line-height: 1.05; font-family: 'SimSunLocal','SimSun','NSimSun','Songti SC','宋体','STSong',serif !important; }
            .apply-form-page .apply-form-table td { border: 0.5pt solid #000; padding: 0 2px; text-align: center; vertical-align: middle; word-break: break-word; overflow-wrap: anywhere; font-family: 'SimSunLocal','SimSun','NSimSun','Songti SC','宋体','STSong',serif !important; font-weight: 400; }
            .apply-form-page .apply-form-table .label { white-space: nowrap; }
            .apply-form-page .apply-form-table .value { white-space: normal; }
            .apply-form-page .row-name td { height: 12.7mm; }
            .apply-form-page .row-time td { height: 12.7mm; }
            .apply-form-page .row-reason td { height: 12.7mm; }
            .apply-form-page .row-sign td { height: 12.7mm; text-align: left; }
        </style>
        ${pageHtml}
    `;
}

function setExportFormByCurrentUser() {
    const currentUser = getCurrentUser();
    if (!currentUser) return;
    const profile = getPdfProfileByUserId(currentUser.id);
    dom.pdfName.value = profile.name || currentUser.name || '';
    dom.pdfEmpId.value = profile.empId || '';
    dom.pdfDept.value = profile.dept || '';
    dom.pdfDefaultReason.value = profile.defaultReason || '';
}

function getGlobalDateRangeFromAllRecords() {
    const allDateKeys = [];
    Object.values(overtimeDataByUser).forEach((userData) => {
        Object.keys(userData || {}).forEach((dateKey) => allDateKeys.push(dateKey));
    });
    if (!allDateKeys.length) {
        const todayKey = formatDateToDateKey(new Date());
        return { startDateKey: todayKey, endDateKey: todayKey };
    }
    allDateKeys.sort((a, b) => a.localeCompare(b));
    return { startDateKey: allDateKeys[0], endDateKey: allDateKeys[allDateKeys.length - 1] };
}

function getDefaultExportDateRange(refDate = new Date()) {
    const year = refDate.getFullYear();
    const month = refDate.getMonth();
    const day = refDate.getDate();
    if (day <= 14) {
        return {
            startDateKey: `${year}-${String(month + 1).padStart(2, '0')}-01`,
            endDateKey: `${year}-${String(month + 1).padStart(2, '0')}-14`
        };
    }

    function openPrintableApplyFormsWindow(exportList, titleText) {
        const printWindow = window.open('', '_blank', 'noopener,noreferrer,width=980,height=720');
        if (!printWindow) {
            alert('浏览器拦截了打印窗口，请允许弹窗后重试');
            return;
        }

        const title = String(titleText || '加班申请表').trim();
        const contentHtml = buildApplyFormPagesHtml(exportList);
        printWindow.document.open();
        printWindow.document.write(`
            <!DOCTYPE html>
            <html lang="zh-CN">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>${escapeHtml(title)}</title>
                <style>
                    html, body { margin: 0; padding: 0; background: #f3f4f6; }
                    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                    @page { size: A4 portrait; margin: 0; }
                    @media print {
                        body { background: #fff; }
                        .apply-form-page { page-break-after: always; }
                        .apply-form-page:last-child { page-break-after: auto; }
                    }
                </style>
            </head>
            <body>
                ${contentHtml}
                <script>
                    window.addEventListener('load', () => {
                        setTimeout(() => {
                            window.focus();
                            window.print();
                        }, 250);
                    });
                </script>
            </body>
            </html>
        `);
        printWindow.document.close();
    }
    if (day <= 25) {
        return {
            startDateKey: `${year}-${String(month + 1).padStart(2, '0')}-15`,
            endDateKey: `${year}-${String(month + 1).padStart(2, '0')}-24`
        };
    }
    const lastDay = new Date(year, month + 1, 0).getDate();
    return {
        startDateKey: `${year}-${String(month + 1).padStart(2, '0')}-25`,
        endDateKey: `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`
    };
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
    if (dom.useAnnualBtn) dom.useAnnualBtn.disabled = !hasUsers;
    if (dom.undoAnnualBtn) dom.undoAnnualBtn.disabled = !hasUsers;
    if (dom.resetAnnualBtn) dom.resetAnnualBtn.disabled = !hasUsers;
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
        const profile = getProfileForUser(user.id);
        button.innerHTML = `<i class="fas fa-user"></i> ${escapeHtml(profile.nickname || user.name)}`;
        button.addEventListener('click', () => switchUser(user.id));
        dom.personSwitchBar.appendChild(button);
    });
}

function switchUser(userId) {
    if (userId === currentUserId) return;
    syncReasonDraftFromDom();
    currentUserId = userId;
    setStoredSelectedUserId(userId);
    renderAll();
}

function updatePersonTitle() {
    const user = getCurrentUser();
    const profile = getCurrentUserProfile();
    const nickname = profile?.nickname || profile?.displayName || user?.name || '';
    dom.currentPersonTitle.innerHTML = user ? `👤 ${escapeHtml(nickname)} · 加班统计` : '👤 暂无用户';
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
    const profile = getCurrentUserProfile();
    if (dom.annualLeaveRemaining) {
        dom.annualLeaveRemaining.innerText = `${Math.floor(profile?.annualRemainingHours || 0)}`;
    }
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
        const reason = String(record.reason || '').trim();
        dayMinutes += minutes;
        dayAmount += amount;
        html += `
            <div class="overtime-item">
                <div class="overtime-item-header">
                    <span class="overtime-type">${escapeHtml(record.type)}</span>
                    <div><span>${formatMinutes(minutes)}</span> | <span>${formatAmount(amount)}元</span></div>
                </div>
                <div class="overtime-time-range">${escapeHtml(record.startTime)} - ${escapeHtml(record.endTime)}</div>
                ${reason ? `<div class="helper-text" style="margin-top: 6px; color: #475569;">事由：${escapeHtml(reason)}</div>` : ''}
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
    syncReasonDraftFromDom();
    selectedDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dateKey = getDateKey(selectedDate);
    if (dom.startTime) {
        dom.startTime.value = getStartTimeInputValue(dateKey);
    }
    if (dom.endTime) {
        dom.endTime.value = getEndTimeInputValue(dateKey);
    }
    if (dom.overtimeReason) {
        dom.overtimeReason.value = getReasonInputValue(dateKey);
    }
    updateResultDisplay();
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

    dom.userManagerList.innerHTML = users.map((user) => {
        const profile = getProfileForUser(user.id);
        const annualHours = Number(profile.annualRemainingHours) || 0;
        return `
        <div class="user-manager-item">
            <div style="flex:1; min-width: 0;">
                <div class="user-manager-name">${escapeHtml(profile.nickname || user.name || '')}</div>
                <div class="helper-text">打印姓名：${escapeHtml(profile.displayName || user.name || '-')} · 工号：${escapeHtml(profile.empId || '-')} · 部门：${escapeHtml(profile.dept || '-')}</div>
                <div class="helper-text">年假余额：${annualHours.toFixed(1)} 小时</div>
            </div>
            <div class="user-manager-actions">
                <button class="btn btn-rename edit-user-btn" data-user-id="${user.id}" ${!isAdmin ? 'disabled' : ''}>编辑资料</button>
                <button class="btn btn-delete delete-user-btn" data-user-id="${user.id}" data-user-name="${escapeHtml(profile.nickname || user.name || '')}" ${!isAdmin ? 'disabled' : ''}>删除</button>
            </div>
        </div>`;
    }).join('');
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

    dom.compareModalTitle.innerHTML = `<i class="fas fa-users"></i> ${escapeHtml(users.map((user) => getProfileForUser(user.id).nickname || user.name).join(' · '))} 数据对比 & 加班之星`;

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
        const profile = getProfileForUser(user.id);
        html += `
            <tr>
                <td><span class="person-name-badge">${escapeHtml(profile.nickname || user.name)}</span></td>
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
    const dateKey = selectedDate ? getDateKey(selectedDate) : '';
    if (dom.startTime) {
        dom.startTime.value = dateKey ? getStartTimeInputValue(dateKey) : DEFAULT_START_TIME;
    }
    if (dom.endTime) {
        dom.endTime.value = dateKey ? getEndTimeInputValue(dateKey) : DEFAULT_END_TIME;
    }
    if (dom.overtimeReason) {
        dom.overtimeReason.value = dateKey ? getReasonInputValue(dateKey) : '';
    }
    renderUserManager();
    renderBanners();
    renderAnnouncements();
    dom.monthSelector.value = formatMonthInput(currentDate);
    updateResultDisplay();
}

async function loadBootstrap({ preserveSelection = true, silent = false } = {}) {
    syncReasonDraftFromDom();
    const previousUserId = preserveSelection ? currentUserId : null;
    const storedUserId = getStoredSelectedUserId();
    const preferredUserId = previousUserId ?? storedUserId;
    const previousSelectedDate = selectedDate ? new Date(selectedDate) : null;

    const payload = await apiFetch('/bootstrap', {}, { silent });
    users = Array.isArray(payload?.users) ? payload.users : [];
    overtimeDataByUser = payload?.overtimeData || {};
    userProfilesByUser = payload?.userProfiles || {};
    announcements = Array.isArray(payload?.announcements) ? payload.announcements : [];
    isAdmin = Boolean(payload?.isAdmin);
    currentDataToken = String(payload?.dataToken || currentDataToken || '');

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
    const reason = String(dom.overtimeReason?.value || '').trim();
    if (!startTime || !endTime) {
        alert('请填写时间');
        return;
    }
    if (reason.length > 120) {
        alert('加班事由不能超过120个字符');
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
            endTime,
            reason
        }
    });

    clearReasonDraft(currentUserId, getDateKey(selectedDate));

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
    clearReasonDraft(currentUserId, dateKey);
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

function renderProfileManagerModal() {
    const user = getCurrentUser();
    if (!user) {
        if (dom.profileNickname) dom.profileNickname.value = '';
        if (dom.profileDisplayName) dom.profileDisplayName.value = '';
        if (dom.profileEmpId) dom.profileEmpId.value = '';
        if (dom.profileDept) dom.profileDept.value = '';
        if (dom.profileAnnualSummary) dom.profileAnnualSummary.innerText = '暂无用户';
        if (dom.annualHistoryList) dom.annualHistoryList.innerHTML = '<div class="list-empty">暂无年假使用记录</div>';
        return;
    }

    const profile = getCurrentUserProfile();
    dom.profileNickname.value = profile?.nickname || '';
    dom.profileDisplayName.value = profile?.displayName || user.name || '';
    dom.profileEmpId.value = profile?.empId || '';
    dom.profileDept.value = profile?.dept || '';
    const annualHours = Number(profile?.annualRemainingHours) || 0;
    const annualDays = annualHours / ANNUAL_HOURS_PER_DAY;
    dom.profileAnnualSummary.innerText = `当前用户：${profile?.nickname || profile?.displayName || user.name} | 打印姓名：${profile?.displayName || user.name} | 年假余额：${annualHours.toFixed(1)} 小时（${annualDays.toFixed(2)} 天）`;

    const history = Array.isArray(profile?.annualHistory) ? [...profile.annualHistory] : [];
    history.sort((a, b) => Number(b?.timestamp || 0) - Number(a?.timestamp || 0));
    if (!history.length) {
        dom.annualHistoryList.innerHTML = '<div class="list-empty">暂无年假使用记录</div>';
    } else {
        dom.annualHistoryList.innerHTML = history.map((item) => {
            const used = Number(item?.used) || 0;
            const when = formatAnnualHistoryTime(item?.timestamp);
            return `<div class="profile-history-item"><span>${escapeHtml(when)}</span><strong>使用 ${used.toFixed(1)} 小时</strong></div>`;
        }).join('');
    }

    if (!dom.allUsersAnnualOverview) return;
    if (!users.length) {
        dom.allUsersAnnualOverview.innerHTML = '<div class="list-empty">暂无用户数据</div>';
        return;
    }

    const cardsHtml = users.map((item) => {
        const itemProfile = getProfileForUser(item.id);
        const remainingHours = Number(itemProfile.annualRemainingHours) || 0;
        const latest = getLatestAnnualHistoryEntry(itemProfile);
        const latestText = latest
            ? `${formatAnnualHistoryTime(latest.timestamp)} 使用 ${Number(latest.used || 0).toFixed(1)} 小时`
            : '暂无使用记录';

        return `
            <div class="all-users-overview-card">
                <div class="all-users-overview-name">
                    <span>${escapeHtml(itemProfile.nickname || itemProfile.displayName || item.name)}</span>
                    <span class="all-users-overview-annual">${remainingHours.toFixed(1)}h</span>
                </div>
                <div class="all-users-overview-meta">打印名：${escapeHtml(itemProfile.displayName || item.name)}</div>
                <div class="all-users-overview-meta">工号：${escapeHtml(itemProfile.empId || '-')}</div>
                <div class="all-users-overview-meta">部门：${escapeHtml(itemProfile.dept || '-')}</div>
                <div class="all-users-overview-meta">最近使用：${escapeHtml(latestText)}</div>
            </div>
        `;
    }).join('');

    dom.allUsersAnnualOverview.innerHTML = cardsHtml;
}

function openProfileManagerModal() {
    if (!getCurrentUser()) {
        alert('请先选择用户');
        return;
    }
    renderProfileManagerModal();
    openModal('profileManagerModal');
}

async function saveCurrentUserProfile() {
    const user = getCurrentUser();
    if (!user) {
        alert('请先选择用户');
        return;
    }

    const nickname = String(dom.profileNickname?.value || '').trim();
    const displayName = String(dom.profileDisplayName?.value || '').trim();
    const empId = String(dom.profileEmpId?.value || '').trim();
    const dept = String(dom.profileDept?.value || '').trim();
    if (!displayName) {
        alert('打印姓名不能为空');
        return;
    }

    await apiFetch(`/users/${user.id}/profile`, {
        method: 'PATCH',
        body: { nickname, displayName, empId, dept }
    });
    await loadBootstrap({ preserveSelection: true, silent: true });
    renderProfileManagerModal();
    alert('资料已保存');
}

async function useAnnualLeaveFromPanel() {
    const user = getCurrentUser();
    if (!user) return;
    const profile = getCurrentUserProfile();
    const remaining = Number(profile?.annualRemainingHours) || 0;
    if (remaining <= 0) {
        alert('年假余额不足');
        return;
    }

    const raw = prompt(`当前剩余 ${remaining.toFixed(1)} 小时，输入本次使用小时数`, '1');
    if (raw === null) return;
    const hours = Number(raw);
    if (!Number.isFinite(hours) || hours <= 0) {
        alert('请输入大于0的数字');
        return;
    }

    await apiFetch(`/users/${user.id}/annual/use`, {
        method: 'POST',
        body: { hours }
    });
    await loadBootstrap({ preserveSelection: true, silent: true });
    renderProfileManagerModal();
}

async function undoAnnualLeaveFromPanel() {
    const user = getCurrentUser();
    if (!user) return;
    await apiFetch(`/users/${user.id}/annual/undo`, { method: 'POST' });
    await loadBootstrap({ preserveSelection: true, silent: true });
    renderProfileManagerModal();
}

async function resetAnnualLeaveFromPanel() {
    const user = getCurrentUser();
    if (!user) return;
    const rawDays = prompt('输入重置后的年假天数（1天=8小时）', String(DEFAULT_ANNUAL_DAYS));
    if (rawDays === null) return;
    const days = Number(rawDays);
    if (!Number.isFinite(days) || days < 0) {
        alert('请输入大于等于0的数字');
        return;
    }

    if (!confirm(`确认将年假重置为 ${days.toFixed(2)} 天吗？`)) {
        return;
    }

    await apiFetch(`/users/${user.id}/annual/reset`, {
        method: 'POST',
        body: { days }
    });
    await loadBootstrap({ preserveSelection: true, silent: true });
    renderProfileManagerModal();
}

function updateExportScopeUi() {
    if (!dom.exportScopeCurrent || !dom.exportScopeAll) return;
    const isAll = dom.exportScopeAll.checked;
    dom.pdfName.disabled = isAll;
    dom.pdfEmpId.disabled = isAll;
    dom.pdfDept.disabled = isAll;
    if (isAll) {
        dom.pdfName.placeholder = '全员模式自动使用每位用户资料';
        dom.pdfEmpId.placeholder = '全员模式自动使用每位用户资料';
        dom.pdfDept.placeholder = '全员模式自动使用每位用户资料';
    } else {
        dom.pdfName.placeholder = '当前人员姓名';
        dom.pdfEmpId.placeholder = '例如 T1762';
        dom.pdfDept.placeholder = '例如 天乐达软件部';
    }
}

function openExportPdfModal(scope = 'current') {
    if (!users.length || !getCurrentUser()) {
        alert('暂无可导出的用户数据');
        return;
    }

    if (scope === 'all') {
        dom.exportScopeAll.checked = true;
    } else {
        dom.exportScopeCurrent.checked = true;
    }

    setExportFormByCurrentUser();
    const { startDateKey, endDateKey } = getDefaultExportDateRange(new Date());
    dom.pdfStartDate.value = startDateKey;
    dom.pdfEndDate.value = endDateKey;
    updateExportScopeUi();
    openModal('exportPdfModal');
}

function buildExportRecords(scope, startDateKey, endDateKey, fallbackReason) {
    if (scope === 'all') {
        const list = [];
        users.forEach((user) => {
            const profile = getPdfProfileByUserId(user.id);
            const records = getRecordsByUserInRange(user.id, startDateKey, endDateKey);
            records.forEach((record) => {
                list.push({
                    record,
                    profile: {
                        name: profile.name || user.name,
                        empId: profile.empId || '',
                        dept: profile.dept || ''
                    },
                    fallbackReason: profile.defaultReason || fallbackReason || ''
                });
            });
        });

        list.sort((a, b) => {
            if (a.record.date === b.record.date) {
                return Number(a.record.userId || 0) - Number(b.record.userId || 0);
            }
            return a.record.date.localeCompare(b.record.date);
        });
        return list;
    }

    const currentUser = getCurrentUser();
    if (!currentUser) return [];
    const profile = {
        name: String(dom.pdfName.value || '').trim() || currentUser.name,
        empId: String(dom.pdfEmpId.value || '').trim(),
        dept: String(dom.pdfDept.value || '').trim()
    };
    const records = getRecordsByUserInRange(currentUser.id, startDateKey, endDateKey);
    return records.map((record) => ({
        record,
        profile,
        fallbackReason
    }));
}

function chunkArray(source, size) {
    const list = Array.isArray(source) ? source : [];
    const step = Math.max(1, Number(size) || 1);
    const result = [];
    for (let i = 0; i < list.length; i += step) {
        result.push(list.slice(i, i + step));
    }
    return result;
}

function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer || new ArrayBuffer(0));
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.subarray(i, i + chunkSize);
        binary += String.fromCharCode(...chunk);
    }
    return btoa(binary);
}

async function loadPdfTextFontBase64(sources = PDF_TEXT_FONT_SOURCES, cacheKey = 'regular') {
    const promiseKey = cacheKey === 'bold' ? 'pdfTextFontBoldBase64Promise' : 'pdfTextFontBase64Promise';
    const existingPromise = cacheKey === 'bold' ? pdfTextFontBoldBase64Promise : pdfTextFontBase64Promise;
    if (!existingPromise) {
        const promise = (async () => {
            let lastError = null;
            for (const fontUrl of sources) {
                try {
                    const response = await fetch(fontUrl, { cache: 'force-cache' });
                    if (!response.ok) {
                        throw new Error(`字体下载失败: ${response.status}`);
                    }
                    const buffer = await response.arrayBuffer();
                    return arrayBufferToBase64(buffer);
                } catch (error) {
                    lastError = error;
                }
            }
            throw lastError || new Error('字体下载失败');
        })().catch((error) => {
            if (cacheKey === 'bold') {
                pdfTextFontBoldBase64Promise = null;
            } else {
                pdfTextFontBase64Promise = null;
            }
            throw error;
        });
        if (cacheKey === 'bold') {
            pdfTextFontBoldBase64Promise = promise;
        } else {
            pdfTextFontBase64Promise = promise;
        }
    }
    return cacheKey === 'bold' ? pdfTextFontBoldBase64Promise : pdfTextFontBase64Promise;
}

async function ensurePdfTextFont(pdf) {
    if (!pdf || typeof pdf.addFileToVFS !== 'function' || typeof pdf.addFont !== 'function') {
        throw new Error('当前 jsPDF 版本不支持自定义字体');
    }
    const fontList = pdf.getFontList ? pdf.getFontList() : {};

    // Register normal font
    if (!fontList[PDF_TEXT_FONT_NAME]) {
        const regularBase64 = await loadPdfTextFontBase64(PDF_TEXT_FONT_SOURCES, 'regular');
        pdf.addFileToVFS(PDF_TEXT_FONT_FILE, regularBase64);
        pdf.addFont(PDF_TEXT_FONT_FILE, PDF_TEXT_FONT_NAME, 'normal');
    }

    // Register bold font as a separate font family
    if (!fontList[PDF_TEXT_FONT_BOLD_NAME]) {
        try {
            const boldBase64 = await loadPdfTextFontBase64(PDF_TEXT_FONT_BOLD_SOURCES, 'bold');
            pdf.addFileToVFS(PDF_TEXT_FONT_BOLD_FILE, boldBase64);
            pdf.addFont(PDF_TEXT_FONT_BOLD_FILE, PDF_TEXT_FONT_BOLD_NAME, 'normal');
        } catch (error) {
            // Keep export available even when bold font embedding fails.
            console.warn('粗体字体加载失败，标题将使用宋体描边加粗回退。', error);
        }
    }

    pdf.setFont(PDF_TEXT_FONT_NAME, 'normal');
}

function drawPdfCellText(pdf, text, x, y, width, height, options = {}) {
    const value = String(text || '').trim();
    const align = options.align || 'center';
    const fontSize = Number(options.fontSize || 10);
    const paddingX = Number(options.paddingX || 1.8);
    const maxTextWidth = Math.max(1, width - paddingX * 2);
    const lines = value ? pdf.splitTextToSize(value, maxTextWidth) : [''];
    const lineHeight = fontSize * 0.3528 * 1.2;
    const textBlockHeight = lines.length * lineHeight;
    let cursorY = y + (height - textBlockHeight) / 2 + lineHeight * 0.78;

    pdf.setFontSize(fontSize);
    lines.forEach((line) => {
        let textX = x + width / 2;
        let textAlign = 'center';
        if (align === 'left') {
            textX = x + paddingX;
            textAlign = 'left';
        } else if (align === 'right') {
            textX = x + width - paddingX;
            textAlign = 'right';
        }
        pdf.text(String(line || ''), textX, cursorY, { align: textAlign, baseline: 'alphabetic' });
        cursorY += lineHeight;
    });
}

function drawApplyFormTextPage(pdf, item, originY, formHeight) {
    // 对标原 Excel 表格格式：
    // - 列宽：A=12.56, B=17.22, C=13.81, D=15.33, E=7.78, F=22（单位：字符宽）
    // - 比例：A:B:C:D:E:F ≈ 14.15:19.41:15.58:17.29:8.77:24.80
    // - 行高：标题 36pt，表体 4 行各 36pt
    // - 空白分隔：18pt、18pt、22pt
    // - 边框：thin（0.35pt）黑色
    // - 字体：宋体 14pt，标题 16pt 加粗
    // - 页边距：左右各 10mm

    const pageWidth = 210;
    const marginLR = 17.8;
    const tableWidth = pageWidth - marginLR * 2;

    const left = marginLR;
    const width = tableWidth;
    const titleHeight = ptToMm(APPLY_FORM_EXCEL_ROW_PT);
    const rowHeight = ptToMm(APPLY_FORM_EXCEL_ROW_PT);
    const tableTop = originY + titleHeight;
    const tableHeight = rowHeight * 4;
    const rowHeights = [rowHeight, rowHeight, rowHeight, rowHeight];

    // 列宽比例（来自原表的归一化）
    const colPercents = [14.15, 19.41, 15.58, 17.29, 8.77, 24.80];
    const colWidths = colPercents.map((percent) => (width * percent) / 100);
    const colX = [left];
    colWidths.forEach((w) => colX.push(colX[colX.length - 1] + w));

    const safeProfile = item?.profile || {};
    const record = item?.record || {};
    const reason = String(record.reason || '').trim() || String(item?.fallbackReason || '').trim() || '工作需要加班';
    const startText = formatApplyDateTime(record.date, record.startTime);
    const endText = formatApplyDateTime(record.date, record.endTime);
    const timeRangeText = `自${startText}至${endText}`;

    pdf.setLineWidth(0.35);  // thin 边框
    pdf.setDrawColor(0, 0, 0);  // 黑色
    pdf.setTextColor(0, 0, 0);

    // 标题：固定使用可稳定出字的宋体正常体，并用描边增强字重，避免粗体字形映射导致标题消失。
    const titleX = left + width / 2;
    const titleLineHeight = 16 * 0.3528 * 1.1;
    const titleY = originY + (titleHeight - titleLineHeight) / 2 + titleLineHeight * 0.82;
    pdf.setFont(PDF_TEXT_FONT_NAME, 'normal');
    pdf.setFontSize(16);
    pdf.setLineWidth(0.12);
    pdf.text('加班申请单', titleX, titleY, {
        align: 'center',
        baseline: 'alphabetic',
        renderingMode: 'fillThenStroke'
    });
    pdf.setFont(PDF_TEXT_FONT_NAME, 'normal');

    // 外框
    const tableBottom = tableTop + rowHeights.reduce((sum, h) => sum + h, 0);
    pdf.rect(left, tableTop, width, tableBottom - tableTop);

    // 3 条横线（分隔 4 行）
    const y1 = tableTop + rowHeights[0];
    const y2 = y1 + rowHeights[1];
    const y3 = y2 + rowHeights[2];
    pdf.line(left, y1, left + width, y1);
    pdf.line(left, y2, left + width, y2);
    pdf.line(left, y3, left + width, y3);

    // 第一行（标题行）的 6 列竖线
    for (let i = 1; i <= 5; i += 1) {
        pdf.line(colX[i], tableTop, colX[i], y1);
    }
    
    // 第二、三行的 A-B 列分隔线
    pdf.line(colX[1], y1, colX[1], y3);
    
    // 第四行的 A-C / D-F 分隔线
    pdf.line(colX[3], y3, colX[3], tableBottom);

    // 第一行数据（姓名、工号、部门）
    const row1Y = tableTop;
    drawPdfCellText(pdf, '姓名', colX[0], row1Y, colWidths[0], rowHeights[0], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, safeProfile.name || '', colX[1], row1Y, colWidths[1], rowHeights[0], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, '工号', colX[2], row1Y, colWidths[2], rowHeights[0], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, safeProfile.empId || '', colX[3], row1Y, colWidths[3], rowHeights[0], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, '部门', colX[4], row1Y, colWidths[4], rowHeights[0], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, safeProfile.dept || '', colX[5], row1Y, colWidths[5], rowHeights[0], { fontSize: 14, align: 'center' });

    // 第二行数据（加班时间）
    drawPdfCellText(pdf, '加班时间', colX[0], y1, colWidths[0], rowHeights[1], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, timeRangeText, colX[1], y1, width - colWidths[0], rowHeights[1], { fontSize: 14, align: 'center' });

    // 第三行数据（加班事由）
    drawPdfCellText(pdf, '加班事由', colX[0], y2, colWidths[0], rowHeights[2], { fontSize: 14, align: 'center' });
    drawPdfCellText(pdf, reason, colX[1], y2, width - colWidths[0], rowHeights[2], { fontSize: 14, align: 'left', paddingX: 2 });

    // 第四行数据（签字栏）
    drawPdfCellText(pdf, '部门领导签字或盖章', colX[0], y3, colWidths[0] + colWidths[1] + colWidths[2], rowHeights[3], { fontSize: 14, align: 'left', paddingX: 2 });
}

async function exportApplyFormsPdf(mode = 'save') {
    if (!window.jspdf?.jsPDF) {
        alert('PDF依赖加载失败，请刷新页面后重试');
        return;
    }

    const startDateKey = String(dom.pdfStartDate.value || '').trim();
    const endDateKey = String(dom.pdfEndDate.value || '').trim();
    if (!startDateKey || !endDateKey) {
        alert('请先选择导出日期范围');
        return;
    }
    if (dateKeyToDate(startDateKey) > dateKeyToDate(endDateKey)) {
        alert('开始日期不能晚于结束日期');
        return;
    }

    const scope = dom.exportScopeAll.checked ? 'all' : 'current';
    const defaultReason = String(dom.pdfDefaultReason.value || '').trim();
    const exportList = buildExportRecords(scope, startDateKey, endDateKey, defaultReason);
    if (!exportList.length) {
        alert('所选日期范围内没有加班记录');
        return;
    }

    const currentUser = getCurrentUser();
    if (scope === 'current' && currentUser) {
        savePdfProfileByUserId(currentUser.id, {
            name: String(dom.pdfName.value || '').trim() || currentUser.name,
            empId: String(dom.pdfEmpId.value || '').trim(),
            dept: String(dom.pdfDept.value || '').trim(),
            defaultReason
        });
    }

    closeModal('exportPdfModal');

    const loading = document.createElement('div');
    loading.style.cssText = 'position:fixed; inset:0; background:rgba(0,0,0,0.65); z-index:2500; display:flex; align-items:center; justify-content:center; color:#fff; font-size:18px;';
    const pageCount = Math.ceil(exportList.length / APPLY_FORMS_PER_PDF_PAGE);
    loading.textContent = `正在生成PDF（共${exportList.length}张申请单，${pageCount}页），请稍候...`;
    document.body.appendChild(loading);

    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
        await ensurePdfTextFont(pdf);

        const marginTop = 3;
        const titleHeight = ptToMm(APPLY_FORM_EXCEL_ROW_PT);
        const bodyRowHeight = ptToMm(APPLY_FORM_EXCEL_ROW_PT);
        const formHeight = titleHeight + bodyRowHeight * 4;
        const gapHeights = APPLY_FORM_EXCEL_GAP_PT.map((pt) => ptToMm(pt));
        
        const pages = chunkArray(exportList, APPLY_FORMS_PER_PDF_PAGE);

        for (let pageIndex = 0; pageIndex < pages.length; pageIndex += 1) {
            if (pageIndex > 0) pdf.addPage();
            const formItems = pages[pageIndex];
            formItems.forEach((item, index) => {
                const gapBefore = gapHeights.slice(0, index).reduce((sum, value) => sum + value, 0);
                const y = marginTop + index * formHeight + gapBefore;
                drawApplyFormTextPage(pdf, item, y, formHeight);
            });
        }

        const fileSuffix = scope === 'all'
            ? '全员'
            : (String(dom.pdfName.value || '').trim() || String(currentUser?.name || '当前人员'));
        const fileName = `加班申请表_${fileSuffix}_${startDateKey}_${endDateKey}.pdf`;

        if (mode === 'print') {
            const blobUrl = pdf.output('bloburl');
            const previewWindow = window.open(blobUrl, '_blank', 'noopener');
            if (!previewWindow) {
                alert('浏览器拦截了新窗口，请允许弹窗后重试打印');
            }
        } else {
            pdf.save(fileName);
        }
    } catch (error) {
        console.error('导出文本PDF失败:', error);
        const fallbackTitle = scope === 'all' ? '全员加班申请表' : '当前人员加班申请表';
        openPrintableApplyFormsWindow(exportList, fallbackTitle);
    } finally {
        loading.remove();
    }
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

function resetUserManagerForm() {
    editingUserId = null;
    if (dom.userNickname) dom.userNickname.value = '';
    if (dom.userDisplayName) dom.userDisplayName.value = '';
    if (dom.userEmpId) dom.userEmpId.value = '';
    if (dom.userDept) dom.userDept.value = '';
    if (dom.saveUserBtn) dom.saveUserBtn.innerHTML = '<i class="fas fa-user-plus"></i> 新增用户';
    if (dom.cancelEditUserBtn) dom.cancelEditUserBtn.style.display = 'none';
}

function startEditUser(userId) {
    const user = users.find((item) => item.id === userId);
    if (!user) return;

    const profile = getProfileForUser(userId);
    editingUserId = userId;
    if (dom.userNickname) dom.userNickname.value = profile.nickname || user.name || '';
    if (dom.userDisplayName) dom.userDisplayName.value = profile.displayName || user.name || '';
    if (dom.userEmpId) dom.userEmpId.value = profile.empId || '';
    if (dom.userDept) dom.userDept.value = profile.dept || '';
    if (dom.saveUserBtn) dom.saveUserBtn.innerHTML = '<i class="fas fa-save"></i> 保存修改';
    if (dom.cancelEditUserBtn) dom.cancelEditUserBtn.style.display = '';
}

async function handleSaveUser(event) {
    event.preventDefault();
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    const nickname = String(dom.userNickname?.value || '').trim();
    const displayName = String(dom.userDisplayName?.value || '').trim();
    const empId = String(dom.userEmpId?.value || '').trim();
    const dept = String(dom.userDept?.value || '').trim();
    if (!nickname) {
        alert('请输入主页昵称');
        return;
    }
    if (!displayName) {
        alert('请输入打印姓名');
        return;
    }

    const payload = { nickname, displayName, empId, dept };
    if (editingUserId) {
        await apiFetch(`/users/${editingUserId}`, {
            method: 'PATCH',
            body: payload
        });
    } else {
        await apiFetch('/users', {
            method: 'POST',
            body: payload
        });
    }

    resetUserManagerForm();
    await loadBootstrap({ preserveSelection: true, silent: true });
}

async function handleRenameUser(userId) {
    if (!isAdmin) {
        alert('请先登录管理员');
        return;
    }

    startEditUser(userId);
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
    if (!dom.bannerType || !dom.bannerContent) {
        alert('当前页面未启用条幅编辑功能');
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
    if (!dom.bannerContent) {
        alert('当前页面未启用条幅编辑功能');
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

    dom.startTime.addEventListener('input', syncReasonDraftFromDom);
    dom.endTime.addEventListener('input', syncReasonDraftFromDom);
    dom.startTime.addEventListener('change', () => {
        syncReasonDraftFromDom();
        updateResultDisplay();
    });
    dom.endTime.addEventListener('change', () => {
        syncReasonDraftFromDom();
        updateResultDisplay();
    });
    if (dom.overtimeReason) {
        dom.overtimeReason.addEventListener('input', syncReasonDraftFromDom);
        dom.overtimeReason.addEventListener('change', syncReasonDraftFromDom);
    }
    dom.addOvertimeBtn.addEventListener('click', addOvertimeRecord);
    dom.clearAllBtn.addEventListener('click', clearDayOvertimeBtn);
    if (dom.exportCurrentPdfBtn) {
        dom.exportCurrentPdfBtn.addEventListener('click', () => openExportPdfModal('current'));
    }
    if (dom.exportAllPdfBtn) {
        dom.exportAllPdfBtn.addEventListener('click', () => openExportPdfModal('all'));
    }
    dom.openCompareModalBtn.addEventListener('click', () => {
        renderCompareModal();
        openModal('compareModal');
    });
    dom.adminActionBtn.addEventListener('click', handleAdminAction);
    dom.manageUsersBtn.addEventListener('click', () => {
        resetUserManagerForm();
        openModal('userManagerModal');
    });
    dom.adminLoginForm.addEventListener('submit', handleAdminLogin);
    dom.addUserForm.addEventListener('submit', handleSaveUser);
    if (dom.cancelEditUserBtn) {
        dom.cancelEditUserBtn.addEventListener('click', () => resetUserManagerForm());
    }
    if (dom.exportScopeCurrent) {
        dom.exportScopeCurrent.addEventListener('change', updateExportScopeUi);
    }
    if (dom.exportScopeAll) {
        dom.exportScopeAll.addEventListener('change', updateExportScopeUi);
    }
    if (dom.savePdfBtn) {
        dom.savePdfBtn.addEventListener('click', () => exportApplyFormsPdf('save'));
    }
    if (dom.printPdfBtn) {
        dom.printPdfBtn.addEventListener('click', () => exportApplyFormsPdf('print'));
    }
    if (dom.useAnnualBtn) {
        dom.useAnnualBtn.addEventListener('click', useAnnualLeaveFromPanel);
    }
    if (dom.undoAnnualBtn) {
        dom.undoAnnualBtn.addEventListener('click', undoAnnualLeaveFromPanel);
    }
    if (dom.resetAnnualBtn) {
        dom.resetAnnualBtn.addEventListener('click', resetAnnualLeaveFromPanel);
    }

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

    if (dom.editBannerForm) {
        dom.editBannerForm.addEventListener('submit', handleSaveBanner);
    }
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
        const editButton = event.target.closest('.edit-user-btn');
        if (editButton && !editButton.disabled) {
            startEditUser(Number(editButton.dataset.userId));
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
    connectRealtimeStream();
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
