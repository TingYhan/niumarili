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
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/+$/, '');
const OLLAMA_MODEL = String(process.env.OLLAMA_MODEL || 'qwen3.5-uncensored:4b').trim();
const OLLAMA_DEFAULT_OPTIONS = {
    num_ctx: 4096,
    temperature: 0.7,
    top_p: 0.9
};

const OLLAMA_MODEL_PRESETS = {
    'deepseek-r1:7b': { num_ctx: 8192, temperature: 0.6, top_p: 0.9 },
    'qwen2.5:7b': { num_ctx: 8192, temperature: 0.7, top_p: 0.9 },
    'qwen3.5-uncensored:4b': { num_ctx: 4096, temperature: 0.7, top_p: 0.9 }
};

function getOllamaOptionsForModel(modelName) {
    const normalizedName = String(modelName || '').trim();
    return {
        ...OLLAMA_DEFAULT_OPTIONS,
        ...(OLLAMA_MODEL_PRESETS[normalizedName] || {})
    };
}

function normalizeModelName(modelName) {
    return String(modelName || '').trim() || OLLAMA_MODEL;
}

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

    CREATE TABLE IF NOT EXISTS announcement_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        announcement_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        read_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(announcement_id, user_id),
        FOREIGN KEY (announcement_id) REFERENCES announcements(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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
if (!hasAgreeCount) {
    db.exec('ALTER TABLE announcements ADD COLUMN agree_count INTEGER NOT NULL DEFAULT 0');
}
if (!hasDisagreeCount) {
    db.exec('ALTER TABLE announcements ADD COLUMN disagree_count INTEGER NOT NULL DEFAULT 0');
}
if (!hasImageData) {
    db.exec('ALTER TABLE announcements ADD COLUMN image_data TEXT');
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

if (!process.env.ADMIN_PASSWORD) {
    console.warn('未设置 ADMIN_PASSWORD，当前默认管理员密码为：admin123456，请尽快修改。');
}

app.use(express.json({ limit: '15mb' }));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/index.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/app.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'app.js'));
});

app.get('/ai-directory-data.js', (req, res) => {
    res.type('application/javascript');
    res.sendFile(path.join(__dirname, 'ai-directory-data.js'));
});

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

app.get('/api/ollama/status', async (req, res) => {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' });
        if (!response.ok) {
            return res.status(502).json({
                ok: false,
                model: OLLAMA_MODEL,
                message: 'Ollama 服务不可用'
            });
        }

        const payload = await response.json();
        const models = Array.isArray(payload?.models) ? payload.models : [];
        const installedModels = models.map((item) => String(item?.name || '')).filter(Boolean);
        const hasModel = installedModels.some((name) => name === OLLAMA_MODEL || name.endsWith(`/${OLLAMA_MODEL}`));
        res.json({
            ok: true,
            model: OLLAMA_MODEL,
            hasModel,
            installedModels,
            defaultOptions: getOllamaOptionsForModel(OLLAMA_MODEL)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({
            ok: false,
            model: OLLAMA_MODEL,
            message: '无法连接 Ollama，请检查服务和端口'
        });
    }
});

app.get('/api/ollama/models', async (req, res) => {
    try {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' });
        if (!response.ok) {
            return res.status(502).json({ error: 'Ollama 模型列表获取失败' });
        }

        const payload = await response.json();
        const models = Array.isArray(payload?.models) ? payload.models : [];
        const installedModels = models.map((item) => String(item?.name || '')).filter(Boolean);

        res.json({
            ok: true,
            defaultModel: OLLAMA_MODEL,
            installedModels,
            presets: Object.keys(OLLAMA_MODEL_PRESETS)
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: '无法获取 Ollama 模型列表' });
    }
});

app.post('/api/ollama/chat', async (req, res) => {
    const prompt = String(req.body?.prompt || '').trim();
    const selectedModel = normalizeModelName(req.body?.model);
    const systemPrompt = String(req.body?.systemPrompt || '').trim();
    if (!prompt) {
        return res.status(400).json({ error: 'prompt 不能为空' });
    }

    try {
        const userMessage = { role: 'user', content: prompt };

        const messages = [];
        if (systemPrompt) {
            messages.push({ role: 'system', content: systemPrompt });
        }
        messages.push(userMessage);

        res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');

        const modelOptions = getOllamaOptionsForModel(selectedModel);

        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: selectedModel,
                messages,
                stream: true,
                options: modelOptions
            })
        });

        if (!response.ok) {
            const errText = await response.text();
            res.write(JSON.stringify({ type: 'error', error: `Ollama 调用失败: ${errText || response.status}` }) + '\n');
            res.end();
            return;
        }

        let heartbeatTimer = null;
        let clientClosed = false;
        let reader = null;

        // 监听客户端断开连接
        res.on('close', () => {
            clientClosed = true;
            if (heartbeatTimer !== null) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
            if (reader) {
                reader.cancel().catch(() => {});
            }
        });

        res.write(JSON.stringify({ type: 'start' }) + '\n');
        heartbeatTimer = setInterval(() => {
            if (!clientClosed) {
                res.write(JSON.stringify({ type: 'heartbeat', ts: Date.now() }) + '\n');
            }
        }, 1000);

        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let hasContent = false;

        try {
            while (!clientClosed) {
                const { done, value } = await reader.read();
                if (value) {
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop() || '';

                    for (const line of lines) {
                        if (!line.trim()) continue;
                        try {
                            const chunk = JSON.parse(line);
                            const msgContent = String(chunk?.message?.content || '');
                            const reasoning = String(
                                chunk?.message?.reasoning_content ||
                                chunk?.message?.thinking ||
                                chunk?.thinking ||
                                ''
                            );
                            const altResponse = String(chunk?.response || '');

                            if (reasoning) {
                                hasContent = true;
                                res.write(JSON.stringify({ type: 'thinking', content: reasoning }) + '\n');
                            }
                            if (msgContent) {
                                hasContent = true;
                                res.write(JSON.stringify({ type: 'chunk', content: msgContent }) + '\n');
                            }
                            if (altResponse) {
                                hasContent = true;
                                res.write(JSON.stringify({ type: 'chunk', content: altResponse }) + '\n');
                            }
                            if (chunk?.done === true) {
                                res.write(JSON.stringify({ type: 'done', final: hasContent }) + '\n');
                            }
                        } catch (e) {
                            // invalid json line, skip
                        }
                    }
                }
                if (done) break;
            }
        } catch (streamError) {
            console.error('Stream error:', streamError);
        }

        if (buffer.trim()) {
            try {
                const chunk = JSON.parse(buffer);
                const msgContent = String(chunk?.message?.content || '');
                const reasoning = String(
                    chunk?.message?.reasoning_content ||
                    chunk?.message?.thinking ||
                    chunk?.thinking ||
                    ''
                );
                const altResponse = String(chunk?.response || '');
                if (reasoning) {
                    hasContent = true;
                    res.write(JSON.stringify({ type: 'thinking', content: reasoning }) + '\n');
                }
                if (msgContent) {
                    hasContent = true;
                    res.write(JSON.stringify({ type: 'chunk', content: msgContent }) + '\n');
                }
                if (altResponse) {
                    hasContent = true;
                    res.write(JSON.stringify({ type: 'chunk', content: altResponse }) + '\n');
                }
                if (chunk?.done === true) {
                    res.write(JSON.stringify({ type: 'done', final: hasContent }) + '\n');
                }
            } catch (e) {
                // ignore final buffer parse error
            }
        }

        if (!hasContent) {
            res.write(JSON.stringify({ type: 'error', error: 'Ollama 未返回有效内容' }) + '\n');
        }
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
        res.end();
    } catch (error) {
        console.error(error);
        try {
            if (heartbeatTimer) clearInterval(heartbeatTimer);
        } catch (e) {
            // ignore
        }
        res.write(JSON.stringify({ type: 'error', error: 'Ollama 服务不可用，请检查 OLLAMA_BASE_URL' }) + '\n');
        res.end();
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

function buildBootstrapPayload(req) {
    const users = getAllUsers();
    const records = db.prepare(`
        SELECT
            id,
            user_id AS userId,
            work_date AS date,
            type,
            start_time AS startTime,
            end_time AS endTime,
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

    return {
        users,
        overtimeData,
        announcements: announcementsWithReads,
        isAdmin: isAdminRequest(req)
    };
}

app.get('/api/bootstrap', (req, res) => {
    res.json(buildBootstrapPayload(req));
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
    const name = String(req.body?.name || '').trim();
    if (!name) {
        return res.status(400).json({ error: '用户名称不能为空' });
    }
    if (name.length > 20) {
        return res.status(400).json({ error: '用户名称不能超过20个字符' });
    }

    try {
        const result = db.prepare('INSERT INTO users (name) VALUES (?)').run(name);
        const user = db.prepare('SELECT id, name, created_at AS createdAt FROM users WHERE id = ?').get(result.lastInsertRowid);
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
    const name = String(req.body?.name || '').trim();
    if (!Number.isInteger(userId) || userId <= 0) {
        return res.status(400).json({ error: '用户 ID 无效' });
    }
    if (!name) {
        return res.status(400).json({ error: '用户名称不能为空' });
    }
    if (name.length > 20) {
        return res.status(400).json({ error: '用户名称不能超过20个字符' });
    }

    const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
    if (!user) {
        return res.status(404).json({ error: '用户不存在' });
    }

    try {
        db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
        const updatedUser = db.prepare('SELECT id, name, created_at AS createdAt FROM users WHERE id = ?').get(userId);
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
    res.json({ success: true });
});

app.post('/api/overtime', (req, res) => {
    const userId = Number(req.body?.userId);
    const date = String(req.body?.date || '').trim();
    const type = String(req.body?.type || '').trim();
    const startTime = String(req.body?.startTime || '').trim();
    const endTime = String(req.body?.endTime || '').trim();

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
        INSERT INTO overtime_records (user_id, work_date, type, start_time, end_time, minutes, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(userId, date, type, startTime, endTime, minutes, amount);

    const record = db.prepare(`
        SELECT
            id,
            user_id AS userId,
            work_date AS date,
            type,
            start_time AS startTime,
            end_time AS endTime,
            minutes,
            amount,
            created_at AS createdAt
        FROM overtime_records
        WHERE id = ?
    `).get(result.lastInsertRowid);

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
});
