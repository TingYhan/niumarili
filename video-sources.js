// 视频源配置（数据驱动）
// 使用方式：
// 1) enabled: true 表示启用，false 表示禁用
// 2) videoFields 支持点路径，返回视频URL

const VIDEO_SOURCES = [
    {
        id: 'xiaojiejie-kuleu',
        name: '美女小姐姐',
        enabled: true,
        urlTemplate: 'https://api.kuleu.com/api/MP4_xiaojiejie?type=json',
        headers: { 'Accept': 'application/json' },
        videoFields: ['mp4_video'],
        titleFields: []
    },
    {
        id: 'jk-video-suyanw',
        name: 'JK小姐姐视频',
        enabled: true,
        urlTemplate: 'https://api.suyanw.cn/api/jksp.php',
        headers: {},
        videoFields: ['mp4_video', 'video', 'url', 'data'],
        titleFields: []
    }
];

module.exports = {
    VIDEO_SOURCES
};
