const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { WALLPAPER_SOURCES } = require('./wallpaper-sources');
const { VIDEO_SOURCES } = require('./video-sources');
const { QUOTE_SOURCES } = require('./quote-sources');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'overtime.db');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123456';
const TOKEN_SECRET = process.env.ADMIN_SECRET || 'change-this-admin-secret';
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;
const ANNUAL_HOURS_PER_DAY = 8;
const DEFAULT_ANNUAL_DAYS = Number(process.env.DEFAULT_ANNUAL_DAYS || 5);
const DEFAULT_ANNUAL_HOURS = Math.max(0, DEFAULT_ANNUAL_DAYS) * ANNUAL_HOURS_PER_DAY;
const NODE_ID = String(process.env.NODE_ID || crypto.randomBytes(6).toString('hex'));
const SYNC_PEER_URL = String(process.env.SYNC_PEER_URL || '').trim().replace(/\/+$/, '');
const SYNC_SHARED_SECRET = String(process.env.SYNC_SHARED_SECRET || '').trim();
const ENABLE_PEER_SYNC = Boolean(SYNC_PEER_URL && SYNC_SHARED_SECRET);

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS overtime_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        work_date TEXT NOT NULL,
        type TEXT NOT NULL,
        start_time TEXT NOT NULL,
        end_time TEXT NOT NULL,
        reason TEXT NOT NULL DEFAULT '',
        minutes INTEGER NOT NULL,
        amount REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        image_data TEXT,
        agree_count INTEGER NOT NULL DEFAULT 0,
        disagree_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcement_votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        option TEXT NOT NULL CHECK(option IN ('agree', 'disagree')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(announcement_id, user_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS user_profiles (
        user_id INTEGER PRIMARY KEY,
        nickname TEXT NOT NULL DEFAULT '',
        display_name TEXT NOT NULL DEFAULT '',
        emp_id TEXT NOT NULL DEFAULT '',
        dept TEXT NOT NULL DEFAULT '',
        annual_remaining_hours REAL NOT NULL DEFAULT 40,
        annual_last_reset_year INTEGER NOT NULL,
        annual_history_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS announcement_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(announcement_id, user_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_overtime_user_date ON overtime_records(user_id, work_date);
    CREATE INDEX IF NOT EXISTS idx_announcement_votes_announcement ON announcement_votes(announcement_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_votes_unique_user ON announcement_votes(announcement_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_announcement_reads_announcement ON announcement_reads(announcement_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_announcement_reads_unique_user ON announcement_reads(announcement_id, user_id);
`);

const announcementColumns = db.prepare('PRAGMA table_info(announcements)').all();
const hasAgreeCount = announcementColumns.some((column) => column.name === 'agree_count');
const hasDisagreeCount = announcementColumns.some((column) => column.name === 'disagree_count');
const hasImageData = announcementColumns.some((column) => column.name === 'image_data');
const overtimeColumns = db.prepare('PRAGMA table_info(overtime_records)').all();
const hasOvertimeReason = overtimeColumns.some((column) => column.name === 'reason');
const userProfileColumns = db.prepare('PRAGMA table_info(user_profiles)').all();
const hasAnnualLastResetYear = userProfileColumns.some((column) => column.name === 'annual_last_reset_year');
const hasNickname = userProfileColumns.some((column) => column.name === 'nickname');
if (!hasAgreeCount) {
    db.exec('ALTER TABLE announcements ADD COLUMN agree_count INTEGER NOT NULL DEFAULT 0');
}
if (!hasDisagreeCount) {
    db.exec('ALTER TABLE announcements ADD COLUMN disagree_count INTEGER NOT NULL DEFAULT 0');
}
if (!hasImageData) {
    db.exec('ALTER TABLE announcements ADD COLUMN image_data TEXT');
}
if (!hasOvertimeReason) {
    db.exec("ALTER TABLE overtime_records ADD COLUMN reason TEXT NOT NULL DEFAULT ''");
}
if (!hasAnnualLastResetYear) {
    db.exec(`
        DROP TABLE IF EXISTS user_profiles;
        CREATE TABLE user_profiles (
            user_id INTEGER PRIMARY KEY,
            nickname TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            emp_id TEXT NOT NULL DEFAULT '',
            dept TEXT NOT NULL DEFAULT '',
            annual_remaining_hours REAL NOT NULL DEFAULT 40,
            annual_last_reset_year INTEGER NOT NULL,
            annual_history_json TEXT NOT NULL DEFAULT '[]',
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        );
    `);
}
if (!hasNickname && hasAnnualLastResetYear) {
    db.exec("ALTER TABLE user_profiles ADD COLUMN nickname TEXT NOT NULL DEFAULT ''");
}

const defaultAnnouncements = [
    { type: 'banner_left', content: '反对内卷' },
    { type: 'banner_right', content: '内卷大四' }
];
const countAnnouncements = db.prepare('SELECT COUNT(*) AS count FROM announcements').get();
if (countAnnouncements.count === 0) {
    const insertAnnouncement = db.prepare('INSERT INTO announcements (type, content) VALUES (?, ?)');
    const insertMany = db.transaction((announcements) => {
        announcements.forEach((item) => insertAnnouncement.run(item.type, item.content));
    });
    insertMany(defaultAnnouncements);
}

const defaultUsers = ['徐', '贺', '任', '路'];
const countRow = db.prepare('SELECT COUNT(*) AS count FROM users').get();
if (countRow.count === 0) {
    const insertUser = db.prepare('INSERT INTO users (name) VALUES (?)');
    const insertMany = db.transaction((names) => {
        names.forEach((name) => insertUser.run(name));
    });
    insertMany(defaultUsers);
}

const ensureUserProfilesForAllUsers = db.transaction(() => {
    const currentYear = new Date().getFullYear();
    const allUsers = db.prepare('SELECT id, name FROM users ORDER BY id').all();
    const insertProfile = db.prepare(`
        INSERT OR IGNORE INTO user_profiles (
            user_id,
            nickname,
            display_name,
            emp_id,
            dept,
            annual_remaining_hours,
            annual_last_reset_year,
            annual_history_json
        ) VALUES (?, '', ?, '', '', ?, ?, '[]')
    `);
    const resetAnnual = db.prepare(`
        UPDATE user_profiles
        SET annual_remaining_hours = ?,
            annual_last_reset_year = ?,
            annual_history_json = '[]',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `);

    allUsers.forEach((user) => {
        insertProfile.run(user.id, user.name, DEFAULT_ANNUAL_HOURS, currentYear);
        const profile = db.prepare('SELECT annual_last_reset_year AS annualLastResetYear FROM user_profiles WHERE user_id = ?').get(user.id);
        if (!profile || Number(profile.annualLastResetYear) !== currentYear) {
            resetAnnual.run(DEFAULT_ANNUAL_HOURS, currentYear, user.id);
        }
    });
});

ensureUserProfilesForAllUsers();

db.prepare(`
    INSERT OR IGNORE INTO sync_meta (key, value)
    VALUES ('data_change_token', '0-${NODE_ID}')
`).run();

const sseClients = new Set();
let peerSyncRunning = false;
let peerSyncPending = false;

function parseChangeToken(token) {
    const raw = String(token || '').trim();
    const dashIndex = raw.indexOf('-');
    if (!raw || dashIndex <= 0) {
        return { ts: 0, nodeId: '' };
    }
    const ts = Number(raw.slice(0, dashIndex));
    const nodeId = raw.slice(dashIndex + 1);
    return {
        ts: Number.isFinite(ts) ? ts : 0,
        nodeId
    };
}

function isIncomingTokenNewer(incomingToken, currentToken) {
    const incoming = parseChangeToken(incomingToken);
    const current = parseChangeToken(currentToken);
    if (incoming.ts !== current.ts) {
        return incoming.ts > current.ts;
    }
    return String(incoming.nodeId || '') > String(current.nodeId || '');
}

function getDataChangeToken() {
    const row = db.prepare("SELECT value FROM sync_meta WHERE key = 'data_change_token'").get();
    return row?.value || `0-${NODE_ID}`;
}

function setDataChangeToken(token) {
    db.prepare(`
        INSERT INTO sync_meta (key, value)
        VALUES ('data_change_token', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(String(token || `0-${NODE_ID}`));
}

function markLocalDataChanged() {
    const nextToken = `${Date.now()}-${NODE_ID}`;
    setDataChangeToken(nextToken);
    return nextToken;
}

function shouldVerifyDataToken(req) {
    const method = String(req.method || 'GET').toUpperCase();
    if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) {
        return false;
    }
    const path = String(req.path || '');
    if (!path.startsWith('/api/')) {
        return false;
    }
    if (path === '/api/admin/login' || path === '/api/internal/sync/snapshot') {
        return false;
    }
    return true;
}

function verifyRequestDataToken(req, res) {
    if (!shouldVerifyDataToken(req)) return true;

    const expectedToken = String(req.headers['x-data-token'] || req.body?.dataToken || '').trim();
    const currentToken = getDataChangeToken();
    if (!expectedToken) {
        res.status(409).json({
            error: '检测到数据版本冲突，请刷新后重试',
            code: 'DATA_CONFLICT',
            currentToken
        });
        return false;
    }

    if (expectedToken !== currentToken) {
        res.status(409).json({
            error: '当前页面数据已过期，请刷新后重试',
            code: 'DATA_CONFLICT',
            currentToken
        });
        return false;
    }
    return true;
}

function emitSyncEvent(event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload || {})}\n\n`;
    sseClients.forEach((clientRes) => {
        try {
            clientRes.write(data);
        } catch {
            sseClients.delete(clientRes);
        }
    });
}

function buildSyncSnapshot() {
    return {
        users: db.prepare('SELECT id, name, created_at AS createdAt FROM users ORDER BY id').all(),
        userProfiles: db.prepare(`
            SELECT
                user_id AS userId,
                nickname,
                display_name AS displayName,
                emp_id AS empId,
                dept,
                annual_remaining_hours AS annualRemainingHours,
                annual_last_reset_year AS annualLastResetYear,
                annual_history_json AS annualHistoryJson,
                updated_at AS updatedAt
            FROM user_profiles
            ORDER BY user_id
        `).all(),
        overtimeRecords: db.prepare(`
            SELECT
                id,
                user_id AS userId,
                work_date AS date,
                type,
                start_time AS startTime,
                end_time AS endTime,
                reason,
                minutes,
                amount,
                created_at AS createdAt
            FROM overtime_records
            ORDER BY id
        `).all(),
        announcements: db.prepare(`
            SELECT
                id,
                type,
                content,
                image_data AS imageData,
                agree_count AS agreeCount,
                disagree_count AS disagreeCount,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM announcements
            ORDER BY id
        `).all(),
        announcementVotes: db.prepare(`
            SELECT
                id,
                announcement_id AS announcementId,
                user_id AS userId,
                option,
                created_at AS createdAt
            FROM announcement_votes
            ORDER BY id
        `).all(),
        announcementReads: db.prepare(`
            SELECT
                id,
                announcement_id AS announcementId,
                user_id AS userId,
                read_at AS readAt
            FROM announcement_reads
            ORDER BY id
        `).all()
    };
}

const replaceSnapshotTx = db.transaction((snapshot) => {
    const payload = snapshot || {};
    const users = Array.isArray(payload.users) ? payload.users : [];
    const profiles = Array.isArray(payload.userProfiles) ? payload.userProfiles : [];
    const records = Array.isArray(payload.overtimeRecords) ? payload.overtimeRecords : [];
    const announcements = Array.isArray(payload.announcements) ? payload.announcements : [];
    const votes = Array.isArray(payload.announcementVotes) ? payload.announcementVotes : [];
    const reads = Array.isArray(payload.announcementReads) ? payload.announcementReads : [];

    db.prepare('DELETE FROM announcement_votes').run();
    db.prepare('DELETE FROM announcement_reads').run();
    db.prepare('DELETE FROM overtime_records').run();
    db.prepare('DELETE FROM user_profiles').run();
    db.prepare('DELETE FROM announcements').run();
    db.prepare('DELETE FROM users').run();

    const insertUser = db.prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)');
    const insertProfile = db.prepare(`
        INSERT INTO user_profiles (
            user_id,
            nickname,
            display_name,
            emp_id,
            dept,
            annual_remaining_hours,
            annual_last_reset_year,
            annual_history_json,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRecord = db.prepare(`
        INSERT INTO overtime_records (
            id,
            user_id,
            work_date,
            type,
            start_time,
            end_time,
            reason,
            minutes,
            amount,
            created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAnnouncement = db.prepare(`
        INSERT INTO announcements (
            id,
            type,
            content,
            image_data,
            agree_count,
            disagree_count,
            created_at,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertVote = db.prepare(`
        INSERT INTO announcement_votes (
            id,
            announcement_id,
            user_id,
            option,
            created_at
        ) VALUES (?, ?, ?, ?, ?)
    `);
    const insertRead = db.prepare(`
        INSERT INTO announcement_reads (
            id,
            announcement_id,
            user_id,
            read_at
        ) VALUES (?, ?, ?, ?)
    `);

    users.forEach((row) => {
        insertUser.run(row.id, row.name, row.createdAt || null);
    });
    profiles.forEach((row) => {
        insertProfile.run(
            row.userId,
            row.nickname || '',
            row.displayName || '',
            row.empId || '',
            row.dept || '',
            Number(row.annualRemainingHours) || 0,
            Number(row.annualLastResetYear) || new Date().getFullYear(),
            row.annualHistoryJson || '[]',
            row.updatedAt || null
        );
    });
    records.forEach((row) => {
        insertRecord.run(
            row.id,
            row.userId,
            row.date,
            row.type,
            row.startTime,
            row.endTime,
            row.reason || '',
            Number(row.minutes) || 0,
            Number(row.amount) || 0,
            row.createdAt || null
        );
    });
    announcements.forEach((row) => {
        insertAnnouncement.run(
            row.id,
            row.type,
            row.content,
            row.imageData || null,
            Number(row.agreeCount) || 0,
            Number(row.disagreeCount) || 0,
            row.createdAt || null,
            row.updatedAt || null
        );
    });
    votes.forEach((row) => {
        insertVote.run(row.id, row.announcementId, row.userId, row.option, row.createdAt || null);
    });
    reads.forEach((row) => {
        insertRead.run(row.id, row.announcementId, row.userId, row.readAt || null);
    });
});

async function pushSnapshotToPeer(reason) {
    if (!ENABLE_PEER_SYNC) return;
    const token = getDataChangeToken();
    const body = {
        sourceNodeId: NODE_ID,
        reason: String(reason || 'unknown'),
        token,
        generatedAt: Date.now(),
        snapshot: buildSyncSnapshot()
    };

    try {
        const response = await fetch(`${SYNC_PEER_URL}/api/internal/sync/snapshot`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Sync-Secret': SYNC_SHARED_SECRET
            },
            body: JSON.stringify(body)
        });
        if (!response.ok) {
            const text = await response.text().catch(() => '');
            console.error('[sync] peer rejected snapshot:', response.status, text);
        }
    } catch (error) {
        console.error('[sync] push snapshot failed:', error.message || error);
    }
}

function schedulePeerSync(reason) {
    if (!ENABLE_PEER_SYNC) return;
    peerSyncPending = true;
    if (peerSyncRunning) return;

    peerSyncRunning = true;
    (async () => {
        while (peerSyncPending) {
            peerSyncPending = false;
            await pushSnapshotToPeer(reason);
        }
        peerSyncRunning = false;
    })().catch((error) => {
        peerSyncRunning = false;
        console.error('[sync] scheduler error:', error.message || error);
    });
}

function notifyDataChanged(reason, options = {}) {
    const skipPeerSync = Boolean(options.skipPeerSync);
    const token = String(options.token || markLocalDataChanged());
    emitSyncEvent('data-changed', {
        reason: String(reason || 'unknown'),
        token,
        nodeId: NODE_ID,
        at: Date.now()
    });
    if (!skipPeerSync) {
        schedulePeerSync(reason);
    }
}

function verifySyncSecret(req) {
    if (!SYNC_SHARED_SECRET) return false;
    const incoming = String(req.headers['x-sync-secret'] || '').trim();
    if (!incoming) return false;
    const incomingBuffer = Buffer.from(incoming);
    const expectedBuffer = Buffer.from(SYNC_SHARED_SECRET);
    if (incomingBuffer.length !== expectedBuffer.length) return false;
    return crypto.timingSafeEqual(incomingBuffer, expectedBuffer);
}

if (!process.env.ADMIN_PASSWORD) {
    console.warn('未设置 ADMIN_PASSWORD，当前默认管理员密码为：admin123456，请尽快修改。');
}

app.use(express.json({ limit: '30mb' }));

app.use((req, res, next) => {
    if (!verifyRequestDataToken(req, res)) {
        return;
    }
    next();
});

function sendNoCacheFile(res, filePath, contentType) {
    if (contentType) {
        res.type(contentType);
    }
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');
    res.sendFile(filePath);
}

app.get('/', (req, res) => {
    sendNoCacheFile(res, path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    sendNoCacheFile(res, path.join(__dirname, 'index.html'));
});

app.get('/app.js', (req, res) => {
    sendNoCacheFile(res, path.join(__dirname, 'app.js'), 'application/javascript');
});

app.get('/ai-directory-data.js', (req, res) => {
    sendNoCacheFile(res, path.join(__dirname, 'ai-directory-data.js'), 'application/javascript');
});

app.use('/assets/fonts', express.static(path.join(__dirname, 'assets/fonts')));

app.get('/api/external/wallpaper/sources', (req, res) => {
    const enabledSources = (Array.isArray(WALLPAPER_SOURCES) ? WALLPAPER_SOURCES : [])
        .filter((source) => source && source.enabled !== false && source.urlTemplate)
        .map((source) => ({
            id: String(source.id || ''),
            name: String(source.name || source.id || '未命名图源')
        }));

    res.json({
        sources: enabledSources
    });
});

app.get('/api/external/wallpaper/health', async (req, res) => {
    const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*'
    };

    const toPathArray = (input) => String(input || '').split('.').filter(Boolean);
    const getByPath = (obj, pathSegments) => {
        if (!obj || !pathSegments.length) return undefined;
        let current = obj;
        for (const segment of pathSegments) {
            if (current == null || typeof current !== 'object') return undefined;
            current = current[segment];
        }
        return current;
    };
    const pickStringByPaths = (payload, paths) => {
        for (const pathExpr of paths) {
            const value = getByPath(payload, toPathArray(pathExpr));
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return '';
    };
    const pickNestedUrl = (payload) => {
        const queue = [payload];
        while (queue.length) {
            const current = queue.shift();
            if (!current) continue;
            if (typeof current === 'string' && /^https?:\/\//i.test(current)) {
                return current;
            }
            if (Array.isArray(current)) {
                queue.push(...current);
                continue;
            }
            if (typeof current === 'object') {
                queue.push(...Object.values(current));
            }
        }
        return '';
    };

    try {
        const enabledSources = (Array.isArray(WALLPAPER_SOURCES) ? WALLPAPER_SOURCES : [])
            .filter((source) => source && source.enabled !== false && source.urlTemplate);

        const checks = enabledSources.map(async (source) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(String(source.urlTemplate || ''), {
                    headers: {
                        ...requestHeaders,
                        ...(source.headers || {})
                    },
                    redirect: 'follow',
                    signal: controller.signal
                });

                if (!response.ok) {
                    return {
                        id: String(source.id || ''),
                        ok: false,
                        status: response.status
                    };
                }

                const contentType = String(response.headers.get('content-type') || '').toLowerCase();
                if (contentType.startsWith('image/')) {
                    return {
                        id: String(source.id || ''),
                        ok: true,
                        status: response.status
                    };
                }

                const rawText = await response.text();
                let payload;
                try {
                    payload = JSON.parse(rawText);
                } catch (error) {
                    payload = rawText;
                }

                let imageUrl = '';
                if (typeof payload === 'string') {
                    const text = payload.trim();
                    imageUrl = /^https?:\/\//i.test(text) ? text : '';
                } else {
                    const imageFields = Array.isArray(source.imageFields) && source.imageFields.length
                        ? source.imageFields
                        : ['url', 'img', 'imgurl', 'image', 'pic', 'src', 'data.url', 'result.url'];
                    imageUrl = pickStringByPaths(payload, imageFields) || pickNestedUrl(payload);
                }

                return {
                    id: String(source.id || ''),
                    ok: Boolean(imageUrl && /^https?:\/\//i.test(imageUrl)),
                    status: response.status
                };
            } catch (error) {
                return {
                    id: String(source.id || ''),
                    ok: false,
                    status: 0
                };
            } finally {
                clearTimeout(timer);
            }
        });

        const result = await Promise.all(checks);
        return res.json({
            sources: result
        });
    } catch (error) {
        return res.status(500).json({ error: '图源健康检查失败' });
    }
});

app.get('/api/external/wallpaper', async (req, res) => {
    const selectedSource = String(req.query.source || '').trim();
    const requestHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json,text/plain,*/*'
    };

    try {
        const toPathArray = (input) => String(input || '').split('.').filter(Boolean);
        const getByPath = (obj, pathSegments) => {
            if (!obj || !pathSegments.length) return undefined;
            let current = obj;
            for (const segment of pathSegments) {
                if (current == null || typeof current !== 'object') return undefined;
                current = current[segment];
            }
            return current;
        };

        const pickStringByPaths = (payload, paths) => {
            for (const pathExpr of paths) {
                const value = getByPath(payload, toPathArray(pathExpr));
                if (typeof value === 'string' && value.trim()) {
                    return value.trim();
                }
            }
            return '';
        };

        const pickNestedUrl = (payload) => {
            const queue = [payload];
            while (queue.length) {
                const current = queue.shift();
                if (!current) continue;
                if (typeof current === 'string' && /^https?:\/\//i.test(current)) {
                    return current;
                }
                if (Array.isArray(current)) {
                    queue.push(...current);
                    continue;
                }
                if (typeof current === 'object') {
                    queue.push(...Object.values(current));
                }
            }
            return '';
        };

        const enabledSources = (Array.isArray(WALLPAPER_SOURCES) ? WALLPAPER_SOURCES : [])
            .filter((source) => source && source.enabled !== false && source.urlTemplate);

        if (!enabledSources.length) {
            return res.status(502).json({ error: '未配置可用壁纸源，请在 wallpaper-sources.js 中添加并启用图源' });
        }

        const sourceCandidates = selectedSource
            ? enabledSources.filter((source) => String(source.id || source.name || '') === selectedSource)
            : enabledSources;

        if (!sourceCandidates.length) {
            return res.status(400).json({ error: '指定图源不存在或未启用' });
        }

        for (const source of sourceCandidates) {
            const endpoint = String(source.urlTemplate || '');
            const mergedHeaders = {
                ...requestHeaders,
                ...(source.headers || {})
            };

            try {
                const response = await fetch(endpoint, {
                    headers: mergedHeaders,
                    redirect: 'follow'
                });

                if (!response.ok) {
                    continue;
                }

                const contentType = String(response.headers.get('content-type') || '').toLowerCase();
                let imageUrl = '';
                let title = '';
                let copyright = '';

                if (contentType.startsWith('image/')) {
                    imageUrl = String(response.url || '').trim();
                } else {
                    const rawText = await response.text();
                    let payload;
                    try {
                        payload = JSON.parse(rawText);
                    } catch (e) {
                        payload = rawText;
                    }

                    if (typeof payload === 'string') {
                        const plainUrl = payload.trim();
                        imageUrl = /^https?:\/\//i.test(plainUrl) ? plainUrl : '';
                    } else {
                        const imageFields = Array.isArray(source.imageFields) && source.imageFields.length
                            ? source.imageFields
                            : ['url', 'img', 'imgurl', 'image', 'pic', 'src', 'data.url', 'result.url'];
                        const titleFields = Array.isArray(source.titleFields) && source.titleFields.length
                            ? source.titleFields
                            : ['title', 'msg', 'message', 'data.title'];
                        const copyrightFields = Array.isArray(source.copyrightFields) && source.copyrightFields.length
                            ? source.copyrightFields
                            : ['copyright', 'author', 'from', 'data.copyright'];

                        imageUrl = pickStringByPaths(payload, imageFields) || pickNestedUrl(payload);
                        title = pickStringByPaths(payload, titleFields);
                        copyright = pickStringByPaths(payload, copyrightFields);
                    }
                }

                if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
                    continue;
                }

                const sourceKey = encodeURIComponent(String(source.id || source.name || ''));
                const encodedImageUrl = encodeURIComponent(imageUrl);
                const proxyUrl = `/api/external/wallpaper-image?url=${encodedImageUrl}&source=${sourceKey}`;

                return res.json({
                    source: String(source.name || 'custom-wallpaper-source'),
                    sourceId: String(source.id || source.name || ''),
                    title: title || '每日壁纸',
                    copyright: copyright || '',
                    url: imageUrl,
                    url4k: imageUrl,
                    proxyUrl,
                    resolution: '',
                    detailUrl: endpoint
                });
            } catch (sourceError) {
                // current source failed, continue with next source
            }
        }

        return res.status(502).json({ error: '当前壁纸源均不可用，请检查 wallpaper-sources.js 中的接口配置' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '壁纸服务暂不可用' });
    }
});

app.get('/api/external/wallpaper-image', async (req, res) => {
    const rawUrl = String(req.query.url || '').trim();
    const sourceId = String(req.query.source || '').trim();
    if (!/^https?:\/\//i.test(rawUrl)) {
        return res.status(400).send('invalid image url');
    }

    const source = (Array.isArray(WALLPAPER_SOURCES) ? WALLPAPER_SOURCES : [])
        .find((item) => item && String(item.id || item.name || '') === sourceId);

    const imageOrigin = (() => {
        try {
            return new URL(rawUrl).origin;
        } catch {
            return '';
        }
    })();

    const baseHeaders = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    };

    const headerCandidates = [
        { ...baseHeaders, ...(source?.headers || {}) },
        imageOrigin ? { ...baseHeaders, Referer: imageOrigin } : { ...baseHeaders },
        { ...baseHeaders }
    ];

    try {
        let imageResponse = null;
        for (const headers of headerCandidates) {
            try {
                const response = await fetch(rawUrl, {
                    headers,
                    redirect: 'follow'
                });
                if (response.ok) {
                    imageResponse = response;
                    break;
                }
            } catch (error) {
                // try next header strategy
            }
        }

        if (!imageResponse) {
            return res.status(502).send('image fetch failed');
        }

        const contentType = String(imageResponse.headers.get('content-type') || 'image/jpeg');
        const buffer = Buffer.from(await imageResponse.arrayBuffer());
        res.setHeader('Content-Type', contentType);
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.send(buffer);
    } catch (error) {
        return res.status(500).send('image proxy unavailable');
    }
});

app.get('/api/external/hitokoto', async (req, res) => {
    const toPathArray = (input) => String(input || '').split('.').filter(Boolean);
    const getByPath = (obj, pathSegments) => {
        if (!obj || !pathSegments.length) return undefined;
        let current = obj;
        for (const segment of pathSegments) {
            if (current == null || typeof current !== 'object') return undefined;
            current = current[segment];
        }
        return current;
    };
    const pickStringByPaths = (payload, paths) => {
        for (const pathExpr of paths) {
            const value = getByPath(payload, toPathArray(pathExpr));
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return '';
    };

    try {
        const now = new Date();
        const dayOfWeek = now.getDay();
        
        // 过滤可用的源（根据星期几），并优先今天专属源
        const enabledSources = (Array.isArray(QUOTE_SOURCES) ? QUOTE_SOURCES : [])
            .filter((source) => {
                if (source.enabled === false) return false;
                if (!source.dayOfWeek || source.dayOfWeek.length === 0) return true;
                return source.dayOfWeek.includes(dayOfWeek);
            })
            .sort((a, b) => {
                const aSpecific = Array.isArray(a?.dayOfWeek) && a.dayOfWeek.length > 0 ? 1 : 0;
                const bSpecific = Array.isArray(b?.dayOfWeek) && b.dayOfWeek.length > 0 ? 1 : 0;
                return bSpecific - aSpecific;
            });

        if (!enabledSources.length) {
            return res.status(502).json({ error: '未配置可用的每日一言源' });
        }

        // 尝试每个源
        for (const source of enabledSources) {
            try {
                const response = await fetch(source.urlTemplate, {
                    headers: source.headers || {}
                });
                if (!response.ok) continue;

                const payload = await response.json();
                const content = pickStringByPaths(payload, source.contentFields || []);
                if (!content) continue;

                res.json({
                    content: content || '今天也要加油。',
                    from: pickStringByPaths(payload, source.fromFields || []) || source.name || '每日一言',
                    fromWho: pickStringByPaths(payload, source.fromWhoFields || []) || '',
                    type: source.name || ''
                });
                return;
            } catch (sourceError) {
                // 继续尝试下一个源
            }
        }

        res.status(502).json({ error: '所有每日一言源均不可用' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '每日一言服务暂不可用' });
    }
});

app.get('/api/external/video/sources', (req, res) => {
    const enabledSources = (Array.isArray(VIDEO_SOURCES) ? VIDEO_SOURCES : [])
        .filter((source) => source && source.enabled !== false && source.urlTemplate)
        .map((source) => ({
            id: String(source.id || ''),
            name: String(source.name || source.id || '未命名视频源')
        }));

    res.json({
        sources: enabledSources
    });
});

app.get('/api/external/video/health', async (req, res) => {
    const toPathArray = (input) => String(input || '').split('.').filter(Boolean);
    const getByPath = (obj, pathSegments) => {
        if (!obj || !pathSegments.length) return undefined;
        let current = obj;
        for (const segment of pathSegments) {
            if (current == null || typeof current !== 'object') return undefined;
            current = current[segment];
        }
        return current;
    };
    const pickStringByPaths = (payload, paths) => {
        for (const pathExpr of paths) {
            const value = getByPath(payload, toPathArray(pathExpr));
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return '';
    };

    try {
        const enabledSources = (Array.isArray(VIDEO_SOURCES) ? VIDEO_SOURCES : [])
            .filter((source) => source && source.enabled !== false && source.urlTemplate);

        const checks = enabledSources.map(async (source) => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 8000);
            try {
                const response = await fetch(String(source.urlTemplate || ''), {
                    headers: {
                        'Accept': 'application/json',
                        ...(source.headers || {})
                    },
                    redirect: 'follow',
                    signal: controller.signal
                });

                if (!response.ok) {
                    return {
                        id: String(source.id || ''),
                        ok: false,
                        status: response.status
                    };
                }

                const payload = await response.json();
                const videoUrl = pickStringByPaths(payload, source.videoFields || []);

                return {
                    id: String(source.id || ''),
                    ok: Boolean(videoUrl && /^https?:\/\//i.test(videoUrl)),
                    status: response.status
                };
            } catch (error) {
                return {
                    id: String(source.id || ''),
                    ok: false,
                    status: 0
                };
            } finally {
                clearTimeout(timer);
            }
        });

        const result = await Promise.all(checks);
        return res.json({
            sources: result
        });
    } catch (error) {
        return res.status(500).json({ error: '视频源健康检查失败' });
    }
});

app.get('/api/external/video', async (req, res) => {
    const selectedSource = String(req.query.source || '').trim();
    const toPathArray = (input) => String(input || '').split('.').filter(Boolean);
    const getByPath = (obj, pathSegments) => {
        if (!obj || !pathSegments.length) return undefined;
        let current = obj;
        for (const segment of pathSegments) {
            if (current == null || typeof current !== 'object') return undefined;
            current = current[segment];
        }
        return current;
    };
    const pickStringByPaths = (payload, paths) => {
        for (const pathExpr of paths) {
            const value = getByPath(payload, toPathArray(pathExpr));
            if (typeof value === 'string' && value.trim()) {
                return value.trim();
            }
        }
        return '';
    };

    try {
        const enabledSources = (Array.isArray(VIDEO_SOURCES) ? VIDEO_SOURCES : [])
            .filter((source) => source && source.enabled !== false && source.urlTemplate);

        if (!enabledSources.length) {
            return res.status(502).json({ error: '未配置可用视频源，请在 video-sources.js 中添加并启用视频源' });
        }

        const sourceCandidates = selectedSource
            ? enabledSources.filter((source) => String(source.id || source.name || '') === selectedSource)
            : enabledSources;

        if (!sourceCandidates.length) {
            return res.status(400).json({ error: '指定视频源不存在或未启用' });
        }

        for (const source of sourceCandidates) {
            try {
                const response = await fetch(source.urlTemplate, {
                    headers: source.headers || {}
                });
                if (!response.ok) continue;

                const payload = await response.json();
                const videoUrl = pickStringByPaths(payload, source.videoFields || []);
                if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) continue;

                res.json({
                    source: String(source.name || 'custom-video-source'),
                    url: videoUrl,
                    title: pickStringByPaths(payload, source.titleFields || []) || '视频'
                });
                return;
            } catch (sourceError) {
                // 继续尝试下一个源
            }
        }

        res.status(502).json({ error: '当前视频源均不可用，请检查 video-sources.js 中的接口配置' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '视频服务暂不可用' });
    }
});

function isValidDateString(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function isValidTimeString(value) {
    return /^\d{2}:\d{2}$/.test(String(value || ''));
}

function calculateTimeDifference(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end < start) end += 24 * 60;
    return end - start;
}

function calculateOvertimeAmount(startTime, endTime) {
    const [sh, sm] = startTime.split(':').map(Number);
    const [eh, em] = endTime.split(':').map(Number);
    let start = sh * 60 + sm;
    let end = eh * 60 + em;
    if (end < start) end += 24 * 60;

    const billingStart = 17 * 60 + 30;
    const effectiveStart = Math.max(start, billingStart);
    const billableMinutes = Math.max(0, end - effectiveStart);
    const blocks = Math.floor(billableMinutes / 20);
    return Number((blocks * 5).toFixed(2));
}

function base64UrlEncode(input) {
    return Buffer.from(input)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlDecode(input) {
    let normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    while (normalized.length % 4) normalized += '=';
    return Buffer.from(normalized, 'base64').toString('utf8');
}

function signToken(encodedPayload) {
    return crypto.createHmac('sha256', TOKEN_SECRET).update(encodedPayload).digest('hex');
}

function createAdminToken() {
    const payload = { role: 'admin', exp: Date.now() + TOKEN_TTL_MS };
    const encodedPayload = base64UrlEncode(JSON.stringify(payload));
    const signature = signToken(encodedPayload);
    return `${encodedPayload}.${signature}`;
}

function getTokenFromRequest(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) return '';
    return authHeader.slice(7).trim();
}

function verifyAdminToken(token) {
    if (!token) return false;
    const [encodedPayload, signature] = token.split('.');
    if (!encodedPayload || !signature) return false;

    const expectedSignature = signToken(encodedPayload);
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return false;

    try {
        const payload = JSON.parse(base64UrlDecode(encodedPayload));
        return payload.role === 'admin' && Number(payload.exp) > Date.now();
    } catch {
        return false;
    }
}

function isAdminRequest(req) {
    return verifyAdminToken(getTokenFromRequest(req));
}

function requireAdmin(req, res, next) {
    if (!isAdminRequest(req)) {
        return res.status(401).json({ error: '需要管理员登录' });
    }
    next();
}

function getAllUsers() {
    return db.prepare('SELECT id, name, created_at AS createdAt FROM users ORDER BY id').all();
}

function parseAnnualHistory(historyJson) {
    if (!historyJson) return [];
    try {
        const parsed = JSON.parse(historyJson);
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getNormalizedUserProfile(userId) {
    const row = db.prepare(`
        SELECT
            user_id AS userId,
            nickname,
            display_name AS displayName,
            emp_id AS empId,
            dept,
            annual_remaining_hours AS annualRemainingHours,
            annual_last_reset_year AS annualLastResetYear,
            annual_history_json AS annualHistoryJson,
            updated_at AS updatedAt
        FROM user_profiles
        WHERE user_id = ?
    `).get(userId);

    if (!row) return null;
    return {
        userId: row.userId,
        nickname: row.nickname || '',
        displayName: row.displayName || '',
        empId: row.empId || '',
        dept: row.dept || '',
        annualRemainingHours: Number(row.annualRemainingHours) || 0,
        annualLastResetYear: Number(row.annualLastResetYear) || new Date().getFullYear(),
        annualHistory: parseAnnualHistory(row.annualHistoryJson),
        updatedAt: row.updatedAt
    };
}

function buildBootstrapPayload(req) {
    ensureUserProfilesForAllUsers();
    const users = getAllUsers();
    const records = db.prepare(`
        SELECT
            id,
            user_id AS userId,
            work_date AS date,
            type,
            start_time AS startTime,
            end_time AS endTime,
            reason,
            minutes,
            amount,
            created_at AS createdAt
        FROM overtime_records
        ORDER BY work_date ASC, id ASC
    `).all();

    const announcements = db.prepare(`
        SELECT
            id,
            type,
            content,
            image_data AS imageData,
            agree_count AS agreeCount,
            disagree_count AS disagreeCount,
            created_at AS createdAt,
            updated_at AS updatedAt
        FROM announcements
        ORDER BY id ASC
    `).all();

    const readRows = db.prepare(`
        SELECT
            ar.announcement_id AS announcementId,
            u.id,
            u.name,
            ar.read_at AS readAt
        FROM announcement_reads ar
        JOIN users u ON ar.user_id = u.id
        ORDER BY ar.read_at ASC
    `).all();

    const readMap = new Map();
    readRows.forEach((row) => {
        if (!readMap.has(row.announcementId)) {
            readMap.set(row.announcementId, []);
        }
        readMap.get(row.announcementId).push({
            id: row.id,
            name: row.name,
            readAt: row.readAt
        });
    });

    const announcementsWithReads = announcements.map((announcement) => ({
        ...announcement,
        readUsers: readMap.get(announcement.id) || []
    }));

    const overtimeData = {};
    users.forEach((user) => {
        overtimeData[String(user.id)] = {};
    });

    records.forEach((record) => {
        const userKey = String(record.userId);
        if (!overtimeData[userKey]) overtimeData[userKey] = {};
        if (!overtimeData[userKey][record.date]) overtimeData[userKey][record.date] = [];
        overtimeData[userKey][record.date].push(record);
    });

    const profileRows = db.prepare(`
        SELECT
            user_id AS userId,
            nickname,
            display_name AS displayName,
            emp_id AS empId,
            dept,
            annual_remaining_hours AS annualRemainingHours,
            annual_last_reset_year AS annualLastResetYear,
            annual_history_json AS annualHistoryJson,
            updated_at AS updatedAt
        FROM user_profiles
        ORDER BY user_id
    `).all();

    const userProfiles = {};
    profileRows.forEach((row) => {
        userProfiles[String(row.userId)] = {
            userId: row.userId,
            nickname: row.nickname || '',
            displayName: row.displayName || '',
            empId: row.empId || '',
            dept: row.dept || '',
            annualRemainingHours: Number(row.annualRemainingHours) || 0,
            annualLastResetYear: Number(row.annualLastResetYear) || new Date().getFullYear(),
            annualHistory: parseAnnualHistory(row.annualHistoryJson),
            updatedAt: row.updatedAt
        };
    });

    return {
        users,
        overtimeData,
        userProfiles,
        announcements: announcementsWithReads,
        isAdmin: isAdminRequest(req),
        dataToken: getDataChangeToken()
    };
}

app.get('/api/bootstrap', (req, res) => {
    res.json(buildBootstrapPayload(req));
});

app.get('/api/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`event: connected\ndata: ${JSON.stringify({ nodeId: NODE_ID, token: getDataChangeToken() })}\n\n`);
    sseClients.add(res);

    const heartbeat = setInterval(() => {
        try {
            res.write('event: ping\\ndata: {}\\n\\n');
        } catch {
            clearInterval(heartbeat);
            sseClients.delete(res);
        }
    }, 20000);

    req.on('close', () => {
        clearInterval(heartbeat);
        sseClients.delete(res);
    });
});

app.post('/api/internal/sync/snapshot', (req, res) => {
    if (!verifySyncSecret(req)) {
        return res.status(401).json({ error: '同步鉴权失败' });
    }

    const sourceNodeId = String(req.body?.sourceNodeId || '').trim();
    const incomingToken = String(req.body?.token || '').trim();
    const snapshot = req.body?.snapshot;
    if (!sourceNodeId || !incomingToken || !snapshot || typeof snapshot !== 'object') {
        return res.status(400).json({ error: '同步负载无效' });
    }
    if (sourceNodeId === NODE_ID) {
        return res.json({ skipped: true, reason: 'self' });
    }

    const currentToken = getDataChangeToken();
    if (!isIncomingTokenNewer(incomingToken, currentToken)) {
        return res.json({ skipped: true, reason: 'stale', currentToken });
    }

    try {
        replaceSnapshotTx(snapshot);
        setDataChangeToken(incomingToken);
        notifyDataChanged('peer-sync-applied', { skipPeerSync: true, token: incomingToken });
        return res.json({ ok: true, token: incomingToken });
    } catch (error) {
        console.error('[sync] apply snapshot failed:', error);
        return res.status(500).json({ error: '同步落库失败' });
    }
});

app.get('/api/admin/status', (req, res) => {
    res.json({ isAdmin: isAdminRequest(req) });
});

app.post('/api/admin/login', (req, res) => {
    const password = String(req.body?.password || '');
    if (password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: '管理员密码错误' });
    }
    res.json({ token: createAdminToken() });
});

app.post('/api/users', requireAdmin, (req, res) => {
    const nickname = String(req.body?.nickname || req.body?.name || '').trim();
    const displayName = String(req.body?.displayName || nickname || '').trim();
    const empId = String(req.body?.empId || '').trim();
    const dept = String(req.body?.dept || '').trim();
    if (!nickname) {
        return res.status(400).json({ error: '主页昵称不能为空' });
    }
    if (nickname.length > 30) {
        return res.status(400).json({ error: '主页昵称不能超过30个字符' });
    }
    if (displayName.length > 30) {
        return res.status(400).json({ error: '打印姓名不能超过30个字符' });
    }
    if (empId.length > 30) {
        return res.status(400).json({ error: '工号不能超过30个字符' });
    }
    if (dept.length > 60) {
        return res.status(400).json({ error: '部门不能超过60个字符' });
    }

    try {
        const result = db.prepare('INSERT INTO users (name) VALUES (?)').run(nickname);
        db.prepare(`
            INSERT OR IGNORE INTO user_profiles (
                user_id,
                nickname,
                display_name,
                emp_id,
                dept,
                annual_remaining_hours,
                annual_last_reset_year,
                annual_history_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]')
        `).run(result.lastInsertRowid, nickname, displayName, empId, dept, DEFAULT_ANNUAL_HOURS, new Date().getFullYear());
        const user = db.prepare('SELECT id, name, created_at AS createdAt FROM users WHERE id = ?').get(result.lastInsertRowid);
        notifyDataChanged('user-created');
        res.status(201).json(user);
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
            return res.status(409).json({ error: '用户已存在' });
        }
        console.error(error);
        res.status(500).json({ error: '新增用户失败' });
    }
});

app.patch('/api/users/:id', requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    const nickname = String(req.body?.nickname || req.body?.name || '').trim();
    const displayName = String(req.body?.displayName || nickname || '').trim();
    const empId = String(req.body?.empId || '').trim();
    const dept = String(req.body?.dept || '').trim();
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (!nickname) {
        return res.status(400).json({ error: '主页昵称不能为空' });
    }
    if (nickname.length > 30) {
        return res.status(400).json({ error: '主页昵称不能超过30个字符' });
    }
    if (displayName.length > 30) {
        return res.status(400).json({ error: '打印姓名不能超过30个字符' });
    }
    if (empId.length > 30) {
        return res.status(400).json({ error: '工号不能超过30个字符' });
    }
    if (dept.length > 60) {
        return res.status(400).json({ error: '部门不能超过60个字符' });
    }

    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    try {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(nickname, userId);
        db.prepare(`
            INSERT OR IGNORE INTO user_profiles (
                user_id,
                nickname,
                display_name,
                emp_id,
                dept,
                annual_remaining_hours,
                annual_last_reset_year,
                annual_history_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]')
        `).run(userId, nickname, displayName, empId, dept, DEFAULT_ANNUAL_HOURS, new Date().getFullYear());
        db.prepare(`
            UPDATE user_profiles
            SET nickname = ?,
                display_name = ?,
                emp_id = ?,
                dept = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
        `).run(nickname, displayName, empId, dept, userId);
        const updatedUser = db.prepare('SELECT id, name, created_at AS createdAt FROM users WHERE id = ?').get(userId);
        notifyDataChanged('user-updated');
        res.json(updatedUser);
    } catch (error) {
        if (String(error.message).includes('UNIQUE')) {
            return res.status(409).json({ error: '用户已存在' });
        }
        console.error(error);
        res.status(500).json({ error: '重命名用户失败' });
    }
});

app.delete('/api/users/:id', requireAdmin, (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }

    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(userId);
    notifyDataChanged('user-deleted');
    res.json({ success: true });
});

app.patch('/api/users/:id/profile', (req, res) => {
    const userId = Number(req.params.id);
    const nickname = String(req.body?.nickname || '').trim();
    const displayName = String(req.body?.displayName || '').trim();
    const empId = String(req.body?.empId || '').trim();
    const dept = String(req.body?.dept || '').trim();

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (nickname.length > 30) {
        return res.status(400).json({ error: '主页昵称不能超过30个字符' });
    }
    if (displayName.length > 30) {
        return res.status(400).json({ error: '姓名不能超过30个字符' });
    }
    if (empId.length > 30) {
        return res.status(400).json({ error: '工号不能超过30个字符' });
    }
    if (dept.length > 60) {
        return res.status(400).json({ error: '部门不能超过60个字符' });
    }

    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    db.prepare(`
        INSERT OR IGNORE INTO user_profiles (
            user_id,
            nickname,
            display_name,
            emp_id,
            dept,
            annual_remaining_hours,
            annual_last_reset_year,
            annual_history_json
        ) VALUES (?, '', ?, '', '', ?, ?, '[]')
    `).run(userId, user.name, DEFAULT_ANNUAL_HOURS, new Date().getFullYear());

    db.prepare(`
        UPDATE user_profiles
        SET display_name = ?,
            nickname = ?,
            emp_id = ?,
            dept = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(displayName, nickname, empId, dept, userId);

    notifyDataChanged('profile-updated');
    return res.json(getNormalizedUserProfile(userId));
});

app.post('/api/users/:id/annual/use', (req, res) => {
    const userId = Number(req.params.id);
    const hours = Number(req.body?.hours);

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (!Number.isFinite(hours) || hours <= 0) {
        return res.status(400).json({ error: '使用小时数必须大于0' });
    }

    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    ensureUserProfilesForAllUsers();
    const profile = getNormalizedUserProfile(userId);
    if (!profile) {
        return res.status(500).json({ error: '读取年假数据失败' });
    }
    if (hours > profile.annualRemainingHours) {
        return res.status(400).json({ error: '年假余额不足' });
    }

    const annualHistory = Array.isArray(profile.annualHistory) ? [...profile.annualHistory] : [];
    annualHistory.push({ used: Number(hours.toFixed(2)), timestamp: Date.now() });
    const nextRemaining = Number((profile.annualRemainingHours - hours).toFixed(2));

    db.prepare(`
        UPDATE user_profiles
        SET annual_remaining_hours = ?,
            annual_history_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(nextRemaining, JSON.stringify(annualHistory), userId);

    notifyDataChanged('annual-used');
    return res.json(getNormalizedUserProfile(userId));
});

app.post('/api/users/:id/annual/undo', (req, res) => {
    const userId = Number(req.params.id);
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    ensureUserProfilesForAllUsers();
    const profile = getNormalizedUserProfile(userId);
    if (!profile) {
        return res.status(500).json({ error: '读取年假数据失败' });
    }
    const annualHistory = Array.isArray(profile.annualHistory) ? [...profile.annualHistory] : [];
    if (!annualHistory.length) {
        return res.status(400).json({ error: '没有可撤销的年假记录' });
    }

    const last = annualHistory.pop();
    const undoHours = Number(last?.used) || 0;
    const nextRemaining = Number((profile.annualRemainingHours + undoHours).toFixed(2));

    db.prepare(`
        UPDATE user_profiles
        SET annual_remaining_hours = ?,
            annual_history_json = ?,
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(nextRemaining, JSON.stringify(annualHistory), userId);

    notifyDataChanged('annual-undo');
    return res.json(getNormalizedUserProfile(userId));
});

app.post('/api/users/:id/annual/reset', (req, res) => {
    const userId = Number(req.params.id);
    const daysRaw = req.body?.days;
    const days = daysRaw === undefined || daysRaw === null || daysRaw === '' ? DEFAULT_ANNUAL_DAYS : Number(daysRaw);

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (!Number.isFinite(days) || days < 0 || days > 100) {
        return res.status(400).json({ error: '年假天数范围应为 0-100' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const currentYear = new Date().getFullYear();
    const resetHours = Number((days * ANNUAL_HOURS_PER_DAY).toFixed(2));
    db.prepare(`
        INSERT OR IGNORE INTO user_profiles (
            user_id,
            display_name,
            emp_id,
            dept,
            annual_remaining_hours,
            annual_last_reset_year,
            annual_history_json
        ) VALUES (?, '', '', '', ?, ?, '[]')
    `).run(userId, resetHours, currentYear);

    db.prepare(`
        UPDATE user_profiles
        SET annual_remaining_hours = ?,
            annual_last_reset_year = ?,
            annual_history_json = '[]',
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
    `).run(resetHours, currentYear, userId);

    notifyDataChanged('annual-reset');
    return res.json(getNormalizedUserProfile(userId));
});

app.post('/api/overtime', (req, res) => {
    const userId = Number(req.body?.userId);
    const date = String(req.body?.date || '').trim();
    const type = String(req.body?.type || '').trim();
    const startTime = String(req.body?.startTime || '').trim();
    const endTime = String(req.body?.endTime || '').trim();
    const reason = String(req.body?.reason || '').trim();

    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (!isValidDateString(date)) {
        return res.status(400).json({ error: '日期格式无效' });
    }
    if (!type) {
        return res.status(400).json({ error: '加班类型不能为空' });
    }
    if (!isValidTimeString(startTime) || !isValidTimeString(endTime)) {
        return res.status(400).json({ error: '时间格式无效' });
    }
    if (reason.length > 120) {
        return res.status(400).json({ error: '加班事由不能超过120个字符' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const minutes = calculateTimeDifference(startTime, endTime);
    if (minutes <= 0) {
        return res.status(400).json({ error: '加班时长必须大于0' });
    }

    const amount = calculateOvertimeAmount(startTime, endTime);
    
    // 一天只保留一条记录：先删除该用户当天的旧记录
    db.prepare('DELETE FROM overtime_records WHERE user_id = ? AND work_date = ?').run(userId, date);
    
    const result = db.prepare(`
        INSERT INTO overtime_records (user_id, work_date, type, start_time, end_time, reason, minutes, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, date, type, startTime, endTime, reason, minutes, amount);

    const record = db.prepare(`
        SELECT
            id,
            user_id AS userId,
            work_date AS date,
            type,
            start_time AS startTime,
            end_time AS endTime,
            reason,
            minutes,
            amount,
            created_at AS createdAt
        FROM overtime_records
        WHERE id = ?
    `).get(result.lastInsertRowid);

    notifyDataChanged('overtime-upsert');
    res.status(201).json(record);
});

app.delete('/api/overtime/:id', (req, res) => {
    const recordId = Number(req.params.id);
    if (!Number.isInteger(recordId) || recordId <= 0) {
        return res.status(400).json({ error: '记录 ID 无效' });
    }

    const result = db.prepare('DELETE FROM overtime_records WHERE id = ?').run(recordId);
    if (!result.changes) {
        return res.status(404).json({ error: '记录不存在' });
    }
    notifyDataChanged('overtime-deleted');
    res.json({ success: true });
});

app.post('/api/overtime/clear-day', (req, res) => {
    const userId = Number(req.body?.userId);
    const date = String(req.body?.date || '').trim();
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (!isValidDateString(date)) {
        return res.status(400).json({ error: '日期格式无效' });
    }

    db.prepare('DELETE FROM overtime_records WHERE user_id = ? AND work_date = ?').run(userId, date);
    notifyDataChanged('overtime-day-cleared');
    res.json({ success: true });
});

// 获取所有公告
app.get('/api/announcements', (req, res) => {
    const announcements = db.prepare(`
        SELECT
            id,
            type,
            content,
            image_data AS imageData,
            agree_count AS agreeCount,
            disagree_count AS disagreeCount,
            created_at AS createdAt,
            updated_at AS updatedAt
        FROM announcements
        ORDER BY id ASC
    `).all();

    const readRows = db.prepare(`
        SELECT
            ar.announcement_id AS announcementId,
            u.id,
            u.name,
            ar.read_at AS readAt
        FROM announcement_reads ar
        JOIN users u ON ar.user_id = u.id
        ORDER BY ar.read_at ASC
    `).all();

    const readMap = new Map();
    readRows.forEach((row) => {
        if (!readMap.has(row.announcementId)) {
            readMap.set(row.announcementId, []);
        }
        readMap.get(row.announcementId).push({
            id: row.id,
            name: row.name,
            readAt: row.readAt
        });
    });

    res.json(announcements.map((announcement) => ({
        ...announcement,
        readUsers: readMap.get(announcement.id) || []
    })));
});

// 更新公告（仅管理员）
app.patch('/api/announcements/:id', requireAdmin, (req, res) => {
    const announcementId = Number(req.params.id);
    const type = String(req.body?.type || '').trim();
    const content = String(req.body?.content || '').trim();
    const imageData = String(req.body?.imageData || '').trim();

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({ error: '公告 ID 无效' });
    }
    if (!content) {
        return res.status(400).json({ error: '公告内容不能为空' });
    }
    if (content.length > 200) {
        return res.status(400).json({ error: '公告内容不能超过200个字符' });
    }
    if (imageData && imageData.length > 12_000_000) {
        return res.status(400).json({ error: '公告图片过大' });
    }

    const announcement = db.prepare('SELECT id, type FROM announcements WHERE id = ?').get(announcementId);
    if (!announcement) {
        return res.status(404).json({ error: '公告不存在' });
    }

    const finalType = type || String(announcement.type || '').trim();
    if (!finalType) {
        return res.status(400).json({ error: '公告类型不能为空' });
    }
    if (finalType.length > 30) {
        return res.status(400).json({ error: '公告名称不能超过30个字符' });
    }

    // 条幅类型只能通过条幅编辑入口维护，不允许普通公告改成条幅。
    const isBannerType = finalType === 'banner_left' || finalType === 'banner_right';
    const isCurrentBanner = announcement.type === 'banner_left' || announcement.type === 'banner_right';
    if (!isCurrentBanner && isBannerType) {
        return res.status(400).json({ error: '普通公告不能修改为条幅类型' });
    }
    if (isCurrentBanner && finalType !== announcement.type) {
        return res.status(400).json({ error: '条幅类型不可修改' });
    }

    db.prepare('UPDATE announcements SET type = ?, content = ?, image_data = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(finalType, content, imageData || null, announcementId);
    const updated = db.prepare(`
        SELECT
            id,
            type,
            content,
            image_data AS imageData,
            agree_count AS agreeCount,
            disagree_count AS disagreeCount,
            created_at AS createdAt,
            updated_at AS updatedAt
        FROM announcements
        WHERE id = ?
    `).get(announcementId);
    notifyDataChanged('announcement-updated');
    res.json(updated);
});

// 创建新公告（仅管理员）
app.post('/api/announcements', requireAdmin, (req, res) => {
    const type = String(req.body?.type || '').trim();
    const content = String(req.body?.content || '').trim();
    const imageData = String(req.body?.imageData || '').trim();

    if (!type) {
        return res.status(400).json({ error: '公告类型不能为空' });
    }
    if (type.length > 30) {
        return res.status(400).json({ error: '公告名称不能超过30个字符' });
    }
    if (!content) {
        return res.status(400).json({ error: '公告内容不能为空' });
    }
    if (content.length > 200) {
        return res.status(400).json({ error: '公告内容不能超过200个字符' });
    }
    if (imageData && imageData.length > 12_000_000) {
        return res.status(400).json({ error: '公告图片过大' });
    }

    try {
        const result = db.prepare('INSERT INTO announcements (type, content, image_data, agree_count, disagree_count) VALUES (?, ?, ?, 0, 0)').run(type, content, imageData || null);
        const announcement = db.prepare(`
            SELECT
                id,
                type,
                content,
                image_data AS imageData,
                agree_count AS agreeCount,
                disagree_count AS disagreeCount,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM announcements
            WHERE id = ?
        `).get(result.lastInsertRowid);
        notifyDataChanged('announcement-created');
        res.status(201).json(announcement);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '创建公告失败' });
    }
});

// 删除公告（仅管理员）
app.delete('/api/announcements/:id', requireAdmin, (req, res) => {
    const announcementId = Number(req.params.id);
    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({ error: '公告 ID 无效' });
    }

    const result = db.prepare('DELETE FROM announcements WHERE id = ?').run(announcementId);
    if (!result.changes) {
        return res.status(404).json({ error: '公告不存在' });
    }
    notifyDataChanged('announcement-deleted');
    res.json({ success: true });
});

// 公告投票（同意/反对）
app.post('/api/announcements/:id/vote', (req, res) => {
    const announcementId = Number(req.params.id);
    const userId = Number(req.body?.userId);
    const option = String(req.body?.option || '').trim();

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({ error: '公告 ID 无效' });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (option !== 'agree' && option !== 'disagree') {
        return res.status(400).json({ error: '投票选项无效' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const announcement = db.prepare('SELECT id, type FROM announcements WHERE id = ?').get(announcementId);
    if (!announcement) {
        return res.status(404).json({ error: '公告不存在' });
    }
    if (announcement.type !== '投票系统') {
        return res.status(400).json({ error: '该公告不是投票类型' });
    }

    const existedVote = db.prepare('SELECT id FROM announcement_votes WHERE announcement_id = ? AND user_id = ?').get(announcementId, userId);
    if (existedVote) {
        return res.status(409).json({ error: '你已经投过票了，每人仅限一次' });
    }

    try {
        const saveVote = db.transaction(() => {
            db.prepare('INSERT INTO announcement_votes (announcement_id, user_id, option) VALUES (?, ?, ?)').run(announcementId, userId, option);
            const sql = option === 'agree'
                ? 'UPDATE announcements SET agree_count = agree_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?'
                : 'UPDATE announcements SET disagree_count = disagree_count + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?';
            db.prepare(sql).run(announcementId);
        });
        saveVote();
    } catch (error) {
        if (String(error?.message || '').includes('UNIQUE')) {
            return res.status(409).json({ error: '你已经投过票了，每人仅限一次' });
        }
        console.error(error);
        return res.status(500).json({ error: '投票失败，请稍后重试' });
    }

    const updated = db.prepare(`
        SELECT
            id,
            type,
            content,
            image_data AS imageData,
            agree_count AS agreeCount,
            disagree_count AS disagreeCount,
            created_at AS createdAt,
            updated_at AS updatedAt
        FROM announcements
        WHERE id = ?
    `).get(announcementId);

    notifyDataChanged('announcement-voted');
    res.json(updated);
});

// 标记公告已读
app.post('/api/announcements/:id/read', (req, res) => {
    const announcementId = Number(req.params.id);
    const userId = Number(req.body?.userId);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({ error: '公告 ID 无效' });
    }
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }

    const user = db.prepare('SELECT id FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    const announcement = db.prepare('SELECT id FROM announcements WHERE id = ?').get(announcementId);
    if (!announcement) {
        return res.status(404).json({ error: '公告不存在' });
    }

    try {
        db.prepare(`
            INSERT OR IGNORE INTO announcement_reads (announcement_id, user_id, read_at)
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `).run(announcementId, userId);

        // 返回已读者列表
        const readUsers = db.prepare(`
            SELECT u.id, u.name
            FROM announcement_reads ar
            JOIN users u ON ar.user_id = u.id
            WHERE ar.announcement_id = ?
            ORDER BY ar.read_at ASC
        `).all(announcementId);

        notifyDataChanged('announcement-read');
        res.json({ success: true, readUsers });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: '标记已读失败' });
    }
});

// 获取公告详情（包括已读用户列表和投票详情）
app.get('/api/announcements/:id/details', (req, res) => {
    const announcementId = Number(req.params.id);

    if (!Number.isInteger(announcementId) || announcementId <= 0) {
        return res.status(400).json({ error: '公告 ID 无效' });
    }

    const announcement = db.prepare(`
        SELECT
            id,
            type,
            content,
            image_data AS imageData,
            image_data AS imageData,
            agree_count AS agreeCount,
            disagree_count AS disagreeCount,
            created_at AS createdAt,
            updated_at AS updatedAt
        FROM announcements
        WHERE id = ?
    `).get(announcementId);

    if (!announcement) {
        return res.status(404).json({ error: '公告不存在' });
    }

    // 获取已读用户列表
    const readUsers = db.prepare(`
        SELECT u.id, u.name, ar.read_at AS readAt
        FROM announcement_reads ar
        JOIN users u ON ar.user_id = u.id
        WHERE ar.announcement_id = ?
        ORDER BY ar.read_at ASC
    `).all(announcementId);

    // 获取投票详情（显示用户名）
    const voteDetails = db.prepare(`
        SELECT
            av.id,
            av.user_id AS userId,
            u.name AS userName,
            av.option,
            av.created_at AS createdAt
        FROM announcement_votes av
        JOIN users u ON av.user_id = u.id
        WHERE av.announcement_id = ?
        ORDER BY av.created_at ASC
    `).all(announcementId);

    // 按选项分组
    const agreeVotes = voteDetails.filter(v => v.option === 'agree');
    const disagreeVotes = voteDetails.filter(v => v.option === 'disagree');

    res.json({
        ...announcement,
        readUsers,
        votes: {
            agree: agreeVotes,
            disagree: disagreeVotes
        }
    });
});

app.listen(PORT, () => {
    console.log(`共享加班系统服务已启动: http://localhost:${PORT}`);
    console.log(`数据库文件: ${DB_PATH}`);
    console.log(`节点标识: ${NODE_ID}`);
    console.log(`双机同步: ${ENABLE_PEER_SYNC ? `已启用 -> ${SYNC_PEER_URL}` : '未启用（需配置 SYNC_PEER_URL + SYNC_SHARED_SECRET）'}`);
});
