// 壁纸源配置（数据驱动）
// 使用方式：
// 1) 把你找到的壁纸接口按下方结构添加到 WALLPAPER_SOURCES
// 2) enabled: true 表示启用，false 表示禁用
// 3) imageFields/titleFields/copyrightFields 支持点路径，如 data.url
// 4) proxyImage: true 时由后端代理图片，避免防盗链403

const WALLPAPER_SOURCES = [
    {
        id: 'beauty-cunyu',
        name: '堆糖美女',
        enabled: true,
        urlTemplate: 'https://www.cunyuapi.top/beauty',
        headers: { 'Referer': 'https://www.cunyuapi.top' },
        proxyImage: true,
        imageFields: ['img'],
        titleFields: ['source'],
        copyrightFields: ['source']
    },
    {
        id: 'beauty-xxapi',
        name: 'XX美女',
        enabled: true,
        urlTemplate: 'https://v2.xxapi.cn/api/meinvpic?return=302',
        headers: { 'Accept': 'application/json' },
        proxyImage: true,
        imageFields: ['data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'genshin-suyanw',
        name: '原神壁纸',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/ys.php',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'jk-suyanw',
        name: 'JK制服',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/jk.php',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'stockings-suyanw',
        name: '黑丝美女',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/hs.php',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'comic3-suyanw',
        name: '二次元动漫',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/comic3.php',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'xjj-suyanw',
        name: '小姐姐',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/ksxjj.php?return=json',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'legs-suyanw',
        name: '美腿小姐姐',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/meitui.php?type=json',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'meinv-suyanw',
        name: '随机美女',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/meinv.php',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    },
    {
        id: 'meizi-suyanw',
        name: '随机妹子',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/meizi.php?type=json',
        headers: {},
        proxyImage: true,
        imageFields: ['img', 'url', 'data'],
        titleFields: [],
        copyrightFields: []
    }
];

module.exports = {
    WALLPAPER_SOURCES
};
