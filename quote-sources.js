// 每日一言/每日文案源配置（数据驱动）
// 使用方式：
// 1) enabled: true 表示启用，false 表示禁用
// 2) dayOfWeek: 0-6 表示星期日-星期六，留空表示每天都启用
// 3) contentFields/fromFields 支持点路径

const QUOTE_SOURCES = [
    {
        name: '网易云音乐',
        enabled: true,
        dayOfWeek: [],  // 每天都启用
        urlTemplate: 'https://api.baiwumm.com/api/hitokoto?format=json',
        headers: {},
        contentFields: ['data.content'],
        fromFields: ['data.from'],
        fromWhoFields: ['data.from_who']
    },
    {
        name: '疯狂星期四',
        enabled: true,
        dayOfWeek: [4],  // 只在星期四（4）启用
        urlTemplate: 'https://api.suyanw.cn/api/kfcyl.php?type=json',
        headers: {},
        contentFields: ['text', 'content', 'data'],
        fromFields: ['from'],
        fromWhoFields: []
    }
];

module.exports = {
    QUOTE_SOURCES
};
